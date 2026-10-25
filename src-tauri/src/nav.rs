//! Volltextsuche und Anker-Links. Suche läuft bei jeder Anfrage über die Seiten (kein gespeicherter Index),
//! Links sind normale PDF-Link-Annotationen (`/Subtype /Link`, GoTo) → auch in anderen Readern klickbar.

use mupdf::pdf::{LinkAction, PdfAction, PdfDestination, PdfDocument, PdfLink};
use mupdf::{DestinationKind, Error, Rect};
use serde::{Deserialize, Serialize};

const HITS_MAX: usize = 1000;
/// Größe des Rücksprung-Links an der Zielstelle (pt).
const BACK: f32 = 18.0;

fn err(e: Error) -> String {
    e.to_string()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Hit {
    pub page: i32,
    /// pt relativ zur linken oberen Seitenecke
    pub rect: [f32; 4],
}

/// Treffer in Seitentext (inkl. Markdown-Seiten und fremder Annotationen); Groß-/Kleinschreibung egal (MuPDF).
pub fn search(doc: &PdfDocument, query: &str) -> Result<Vec<Hit>, String> {
    let q = query.trim();
    if q.is_empty() || q.len() > 500 {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for page in 0..doc.page_count().map_err(err)? {
        let p = doc.load_page(page).map_err(err)?;
        let b = p.bounds().map_err(err)?;
        for qd in p.search(q, (HITS_MAX - out.len()) as u32).map_err(err)?.iter() {
            let xs = [qd.ul.x, qd.ur.x, qd.ll.x, qd.lr.x];
            let ys = [qd.ul.y, qd.ur.y, qd.ll.y, qd.lr.y];
            let (min, max) = (|v: [f32; 4]| v.into_iter().fold(f32::MAX, f32::min), |v: [f32; 4]| v.into_iter().fold(f32::MIN, f32::max));
            out.push(Hit { page, rect: [min(xs) - b.x0, min(ys) - b.y0, max(xs) - b.x0, max(ys) - b.y0] });
        }
        if out.len() >= HITS_MAX {
            break;
        }
    }
    Ok(out)
}

/// Link auf eine Stelle im selben Dokument (`page` ≥ 0) oder auf eine Adresse (`uri`, `page` −1).
/// Launch und andere Dateien werden nie geliefert; die App führt nichts davon selbst aus.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Anchor {
    pub rect: [f32; 4],
    pub page: i32,
    pub y: f32,
    #[serde(default)]
    pub uri: Option<String>,
}

/// Nur http/https, ASCII ohne Leer-/Steuerzeichen, Anführungszeichen und Shell-/Kommandozeilen-Metazeichen.
/// Die Frontend-Adresse ist `new URL(…).href` (schon prozentkodiert); hier wird trotzdem alles erneut geprüft.
pub fn web_url(s: &str) -> Result<&str, String> {
    let rest = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).ok_or("nur http/https")?;
    let ok = !rest.is_empty()
        && !rest.starts_with(['/', ':', '?', '#'])
        && s.len() <= 2048
        && s.bytes().all(|b| (0x21..=0x7e).contains(&b) && !br#""'`<>^|\{}"#.contains(&b));
    if ok { Ok(s) } else { Err("ungültige Adresse".into()) }
}

/// Adresse im Standard-Browser öffnen: ohne Shell, die Adresse ist ein einzelnes Argument.
pub fn open_url(s: &str) -> Result<(), String> {
    let url = web_url(s)?;
    let mut c = std::process::Command::new("rundll32");
    c.args(["url.dll,FileProtocolHandler", url]);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut c, 0x0800_0000); // CREATE_NO_WINDOW
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn top(kind: &DestinationKind) -> Option<f32> {
    match *kind {
        DestinationKind::XYZ { top, .. } | DestinationKind::FitH { top } | DestinationKind::FitBH { top } => top,
        DestinationKind::FitR { top, .. } => Some(top),
        _ => None,
    }
}

/// Obere linke Ecke der Seite im MuPDF-Raum (meist 0/0) → Umrechnung in pt relativ zur Seite.
fn origin(doc: &PdfDocument, index: i32) -> Result<(f32, f32), Error> {
    let b = doc.load_page(index)?.bounds()?;
    Ok((b.x0, b.y0))
}

/// Ein Eintrag je Link-Annotation in `/Annots`-Reihenfolge (wie `unlink` zählt);
/// nicht lesbare/externe Links als Platzhalter mit `page` −1.
pub fn links(doc: &PdfDocument, index: i32) -> Result<Vec<Anchor>, String> {
    let page = doc.load_pdf_page(index).map_err(err)?;
    let (ox, oy) = origin(doc, index).map_err(err)?;
    let count = doc.page_count().map_err(err)?;
    let ctm = page.ctm().map_err(err)?;
    let page_no = doc.lookup_page_number(&page.object()).ok();
    let none = Anchor { rect: [0.0; 4], page: -1, y: 0.0, uri: None };
    let mut out = Vec::new();
    for annot in page.link_annotations().map_err(err)? {
        let Ok(Some(l)) = annot.and_then(|a| a.to_pdf_link(doc, page_no, Some(&ctm))) else {
            out.push(none.clone());
            continue;
        };
        let rect = [l.bounds.x0 - ox, l.bounds.y0 - oy, l.bounds.x1 - ox, l.bounds.y1 - oy];
        if let LinkAction::Action(PdfAction::Uri(u)) = &l.action {
            out.push(Anchor { rect, page: -1, y: 0.0, uri: Some(u.clone()) });
            continue;
        }
        let dest = match l.action {
            LinkAction::Dest(d) | LinkAction::Action(PdfAction::GoTo(d)) => Some(d),
            _ => None,
        };
        let anchor = match dest {
            Some(PdfDestination::Page { page, kind }) if (page as i32) < count => {
                let ty = origin(doc, page as i32).map_err(err)?.1;
                Some(Anchor {
                    rect,
                    page: page as i32,
                    y: top(&kind).map_or(0.0, |t| t - ty).max(0.0),
                    uri: None,
                })
            }
            _ => None,
        };
        out.push(anchor.unwrap_or(none.clone()));
    }
    Ok(out)
}

/// Link `rect` auf Seite `from` → Höhe `y` auf Seite `to` (alles pt relativ zur jeweiligen Seite).
fn add(doc: &mut PdfDocument, from: i32, rect: [f32; 4], to: i32, y: f32) -> Result<(), Error> {
    let (ox, oy) = origin(doc, from)?;
    let ty = origin(doc, to)?.1;
    let mut page = doc.load_pdf_page(from)?;
    let link = PdfLink {
        bounds: Rect::new(rect[0] + ox, rect[1] + oy, rect[2] + ox, rect[3] + oy),
        action: LinkAction::Dest(PdfDestination::Page { page: to as u32, kind: DestinationKind::XYZ { left: None, top: Some(y + ty), zoom: None } }),
    };
    page.add_links(doc, &[link])
}

/// Link `rect` auf Seite `from` → Stelle (`to`, `x`, `y`), dazu ein kleiner Rücksprung-Link an der Zielstelle.
pub fn link(doc: &mut PdfDocument, from: i32, rect: [f32; 4], to: i32, x: f32, y: f32) -> Result<(), String> {
    let count = doc.page_count().map_err(err)?;
    let finite = rect.iter().chain([&x, &y]).all(|v| v.is_finite() && v.abs() < 1e5);
    if !(0..count).contains(&from) || !(0..count).contains(&to) || !finite || rect[2] - rect[0] < 1.0 || rect[3] - rect[1] < 1.0 {
        return Err("ungültiger Link".into());
    }
    add(doc, from, rect, to, y).map_err(err)?;
    let h = BACK / 2.0;
    add(doc, to, [x - h, y - h, x + h, y + h], from, rect[1]).map_err(err)
}

/// `n`-ten Link der Seite (Reihenfolge wie `links`) entfernen. Zählt wie `PdfLinkAnnotIter`:
/// leere Einträge und andere Subtypen überspringen, unlesbare Einträge mitzählen (nie löschen).
pub fn unlink(doc: &mut PdfDocument, index: i32, n: usize) -> Result<(), String> {
    let page = doc.load_pdf_page(index).map_err(err)?;
    let Some(annots) = page.object().get_dict("Annots").map_err(err)? else { return Err("Link nicht gefunden".into()) };
    let mut annots = annots.resolve().map_err(err)?.unwrap_or(annots);
    let is_link = |annots: &mupdf::pdf::PdfObject, i: i32| -> Result<Option<bool>, Error> {
        let Some(e) = annots.get_array(i)? else { return Ok(None) };
        let Some(e) = e.resolve()? else { return Ok(None) };
        let Some(s) = e.get_dict("Subtype")? else { return Ok(None) };
        Ok((s.as_name()? == b"Link").then_some(true))
    };
    let mut seen = 0;
    for i in 0..annots.len().map_err(err)? as i32 {
        match is_link(&annots, i) {
            Ok(None) => continue,
            Ok(Some(_)) if seen == n => return annots.array_delete(i).map_err(err),
            _ if seen == n => break,
            _ => seen += 1,
        }
    }
    Err("Link nicht gefunden".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(pages: usize) -> PdfDocument {
        let mut d = PdfDocument::new();
        for _ in 0..pages {
            d.new_page(mupdf::Size::A4).unwrap();
        }
        d
    }

    #[test]
    fn link_hin_und_zurueck_ueberlebt_speichern() {
        let mut d = doc(3);
        link(&mut d, 2, [50.0, 60.0, 150.0, 80.0], 0, 100.0, 300.0).unwrap();
        let d = PdfDocument::from_bytes(&crate::pdf::to_bytes(&d).unwrap()).unwrap();
        let hin = links(&d, 2).unwrap();
        assert_eq!(hin.len(), 1);
        assert_eq!(hin[0].page, 0);
        assert!((hin[0].y - 300.0).abs() < 0.5, "{hin:?}");
        assert!((hin[0].rect[0] - 50.0).abs() < 0.5 && (hin[0].rect[3] - 80.0).abs() < 0.5, "{hin:?}");
        let back = links(&d, 0).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].page, 2);
        assert!((back[0].y - 60.0).abs() < 0.5, "{back:?}");
        assert!(links(&d, 1).unwrap().is_empty());
    }

    #[test]
    fn link_loeschen_und_ungueltig() {
        let mut d = doc(2);
        link(&mut d, 0, [10.0, 10.0, 60.0, 30.0], 1, 0.0, 0.0).unwrap();
        link(&mut d, 0, [10.0, 100.0, 60.0, 130.0], 1, 0.0, 400.0).unwrap();
        unlink(&mut d, 0, 0).unwrap();
        let l = links(&d, 0).unwrap();
        assert_eq!(l.len(), 1);
        assert!((l[0].rect[1] - 100.0).abs() < 0.5);
        assert!(unlink(&mut d, 0, 5).is_err());
        assert!(link(&mut d, 0, [0.0, 0.0, 50.0, 50.0], 7, 0.0, 0.0).is_err());
        assert!(link(&mut d, 0, [0.0, 0.0, f32::NAN, 50.0], 1, 0.0, 0.0).is_err());
    }

    #[test]
    fn externe_links_nie_geliefert() {
        let mut d = doc(1);
        let mut page = d.load_pdf_page(0).unwrap();
        let ext = PdfLink { bounds: Rect::new(0.0, 0.0, 50.0, 20.0), action: LinkAction::Action(PdfAction::Uri("https://example.org".into())) };
        page.add_links(&mut d, &[ext]).unwrap();
        let l = links(&d, 0).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].page, -1);
    }

    #[test]
    fn suche_findet_markdown_text() {
        let mut d = doc(2);
        crate::notebook::render(&mut d, 1, "# Titel\n\nDer Zaunkönig singt.", true, &[]).unwrap();
        let hits = search(&d, "zaunkönig").unwrap();
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].page, 1);
        assert!(hits[0].rect[2] > hits[0].rect[0] && hits[0].rect[3] > hits[0].rect[1]);
        assert!(search(&d, "  ").unwrap().is_empty());
        assert!(search(&d, "nichtda").unwrap().is_empty());
    }

    #[test]
    fn externer_link_dazwischen_haelt_indizes() {
        let mut d = doc(2);
        link(&mut d, 0, [10.0, 10.0, 60.0, 30.0], 1, 0.0, 0.0).unwrap();
        let mut page = d.load_pdf_page(0).unwrap();
        let ext = PdfLink { bounds: Rect::new(10.0, 50.0, 60.0, 70.0), action: LinkAction::Action(PdfAction::Uri("https://example.org".into())) };
        page.add_links(&mut d, &[ext]).unwrap();
        link(&mut d, 0, [10.0, 100.0, 60.0, 130.0], 1, 0.0, 400.0).unwrap();
        let l = links(&d, 0).unwrap();
        assert_eq!(l.iter().map(|a| a.page).collect::<Vec<_>>(), [1, -1, 1]);
        unlink(&mut d, 0, 2).unwrap();
        let l = links(&d, 0).unwrap();
        assert_eq!(l.iter().map(|a| a.page).collect::<Vec<_>>(), [1, -1]);
        assert!((l[0].rect[1] - 10.0).abs() < 0.5);
    }

    #[test]
    fn verschobene_mediabox_ziel_relativ() {
        let mut d = doc(2);
        let mut p1 = d.load_pdf_page(1).unwrap().object();
        let mut mb = d.new_array().unwrap();
        for v in [0.0, 100.0, 595.0, 942.0] {
            mb.array_push(d.new_real(v).unwrap()).unwrap();
        }
        p1.dict_put("MediaBox", mb).unwrap();
        link(&mut d, 0, [10.0, 10.0, 60.0, 30.0], 1, 50.0, 200.0).unwrap();
        let d = PdfDocument::from_bytes(&crate::pdf::to_bytes(&d).unwrap()).unwrap();
        assert!((links(&d, 0).unwrap()[0].y - 200.0).abs() < 0.5, "{:?}", links(&d, 0));
        let back = links(&d, 1).unwrap();
        assert!((back[0].rect[1] - 191.0).abs() < 0.5, "{back:?}");
    }

    #[test]
    fn web_url_nur_http_ohne_metazeichen() {
        for ok in ["https://a.de", "http://a.de/x?y=1&z=%20#f", "HTTPS://a.de".to_lowercase().as_str()] {
            assert!(web_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "javascript:alert(1)", "file:///C:/x.exe", "ftp://a.de", "mailto:a@b.de", "https://", "https:///x", "//a.de", "a.de",
            "https://a.de x", "https://a.de\"x", "https://a.de&calc|calc", "https://a.de^&calc", "https://a.de/\n", "https://a.de/\t",
            "https://a.de`x`", "https://a.de\\x", "https://ä.de", "http://a.de<x>", "http://a.de'x",
        ] {
            assert!(web_url(bad).is_err(), "{bad}");
        }
        assert!(web_url(&format!("https://a.de/{}", "a".repeat(2100))).is_err());
    }

    #[test]
    fn uri_link_wird_geliefert() {
        let mut d = doc(1);
        let mut page = d.load_pdf_page(0).unwrap();
        let l = PdfLink { bounds: Rect::new(10.0, 20.0, 110.0, 40.0), action: LinkAction::Action(PdfAction::Uri("https://example.org/".into())) };
        page.add_links(&mut d, &[l]).unwrap();
        let d = PdfDocument::from_bytes(&crate::pdf::to_bytes(&d).unwrap()).unwrap();
        let a = links(&d, 0).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!((a[0].page, a[0].uri.as_deref()), (-1, Some("https://example.org/")));
        assert!((a[0].rect[2] - 110.0).abs() < 0.5, "{a:?}");
    }
}
