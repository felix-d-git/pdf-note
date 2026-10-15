//! Original-Objekte der PDF (Bilder, Formulare/Diagramme, Vektorpfade) im Content-Stream der Seite
//! finden, verschieben/skalieren (`q <M> cm … Q` um das Objekt) und löschen (Operatoren herausschneiden).
//! Das Objekt bleibt dabei genau einmal im Stream – nichts wird überdeckt oder doppelt eingefügt.
use mupdf::pdf::{PdfDocument, PdfObject, PdfPage};
use mupdf::{Error, Matrix, Rect};
use serde::Deserialize;

fn is_ws(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r' | 0 | 0x0c)
}
fn is_delim(c: u8) -> bool {
    b"()<>[]{}/%".contains(&c)
}

#[derive(Debug, PartialEq)]
enum Arg {
    Num(f32),
    Name(Vec<u8>),
    Other,
}

/// Ein Operator mit seinen Operanden; `start..end` = Bytes im Stream inkl. Operanden.
#[derive(Debug)]
struct Op<'a> {
    start: usize,
    end: usize,
    name: &'a [u8],
    args: Vec<Arg>,
}

/// Zerlegt einen Content-Stream in Operatoren. Kaputte Eingabe bricht nicht ab, jeder Schritt rückt vor.
fn ops(s: &[u8]) -> Vec<Op<'_>> {
    let mut out = Vec::new();
    let mut args = Vec::new();
    let mut start = None;
    let mut i = 0;
    let skip_word = |mut i: usize| {
        while i < s.len() && !is_ws(s[i]) && !is_delim(s[i]) {
            i += 1;
        }
        i
    };
    while i < s.len() {
        let c = s[i];
        if is_ws(c) {
            i += 1;
            continue;
        }
        if c == b'%' {
            while i < s.len() && s[i] != b'\n' && s[i] != b'\r' {
                i += 1;
            }
            continue;
        }
        let t0 = i;
        let op_start = *start.get_or_insert(t0);
        match c {
            b'/' => {
                i = skip_word(i + 1);
                args.push(Arg::Name(s[t0 + 1..i].to_vec()));
            }
            b'(' => {
                let mut depth = 0;
                while i < s.len() {
                    match s[i] {
                        b'\\' => i += 1,
                        b'(' => depth += 1,
                        b')' => {
                            depth -= 1;
                            if depth == 0 {
                                i += 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                    i += 1;
                }
                args.push(Arg::Other);
            }
            b'<' | b'>' if s.get(i + 1) == Some(&c) => {
                i += 2;
                args.push(Arg::Other);
            }
            b'<' => {
                while i < s.len() && s[i] != b'>' {
                    i += 1;
                }
                i += 1;
                args.push(Arg::Other);
            }
            _ if is_delim(c) => {
                i += 1;
                args.push(Arg::Other);
            }
            _ => {
                i = skip_word(i);
                let w = &s[t0..i];
                if matches!(c, b'0'..=b'9' | b'+' | b'-' | b'.') {
                    let v = std::str::from_utf8(w).ok().and_then(|t| t.parse::<f32>().ok()).filter(|v| v.is_finite());
                    args.push(Arg::Num(v.unwrap_or(0.0)));
                } else if matches!(w, b"true" | b"false" | b"null") {
                    args.push(Arg::Other);
                } else {
                    if w == b"BI" {
                        i = inline_image_end(s, i);
                    }
                    out.push(Op { start: op_start, end: i.min(s.len()), name: w, args: std::mem::take(&mut args) });
                    start = None;
                }
            }
        }
    }
    out
}

/// Ende eines Inline-Bilds `BI … ID <Daten> EI` ab hinter `BI`.
// ponytail: erstes „EI" zwischen Leerraum zählt, wie bei MuPDF ohne /L; Binärdaten mit „ EI " darin werden zu früh beendet
fn inline_image_end(s: &[u8], from: usize) -> usize {
    let ws_at = |k: usize| k >= s.len() || is_ws(s[k]);
    let find = |pat: &[u8], from: usize| (from..s.len().saturating_sub(1)).find(|&k| s[k..].starts_with(pat) && k > 0 && is_ws(s[k - 1]) && (ws_at(k + 2) || is_delim(s[k + 2])));
    let Some(id) = find(b"ID", from) else { return s.len() };
    find(b"EI", id + 3).map_or(s.len(), |k| k + 2)
}

/// Gefundenes Objekt: Bytes im Stream, Box in App-Koordinaten (pt ab linker oberer Seitenecke),
/// `ctm` = Objekt-Koordinaten → App-Koordinaten.
#[derive(Debug, Clone)]
struct Found {
    start: usize,
    end: usize,
    bbox: Rect,
    ctm: Matrix,
}

pub(crate) fn mul(a: &Matrix, b: &Matrix) -> Matrix {
    let mut m = a.clone();
    m.concat(b.clone());
    m
}

fn bounds(pts: &[(f32, f32)], m: &Matrix, pad: f32) -> Rect {
    let mut r = Rect::new(f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for &(x, y) in pts {
        let (x, y) = m.transform_xy(x, y);
        r = Rect::new(r.x0.min(x - pad), r.y0.min(y - pad), r.x1.max(x + pad), r.y1.max(y + pad));
    }
    r
}

/// Objekte eines Streams. `base` = Benutzerraum der Seite → App-Koordinaten;
/// `xobject(name)` = Box eines XObjects im eigenen Raum (Bild: Einheitsquadrat), `None` = unbekannt → nicht wählbar.
fn scan(s: &[u8], base: Matrix, xobject: impl Fn(&[u8]) -> Option<Rect>) -> Vec<Found> {
    let mut ctm = base;
    let mut lw = 1.0f32;
    let mut stack = Vec::new();
    // laufender Pfad: Start-Byte, Punkte, Clip (`W`) → kein Objekt
    let mut path: Option<(usize, Vec<(f32, f32)>, bool)> = None;
    let mut out = Vec::new();
    for op in ops(s) {
        let n: Vec<f32> = op.args.iter().filter_map(|a| if let Arg::Num(v) = a { Some(*v) } else { None }).collect();
        let pts = |k: usize| n.chunks_exact(2).take(k).map(|p| (p[0], p[1])).collect::<Vec<_>>();
        let mut add_pts = |p: Vec<(f32, f32)>| path.get_or_insert((op.start, Vec::new(), false)).1.extend(p);
        match op.name {
            b"q" => stack.push((ctm.clone(), lw)),
            b"Q" => {
                if let Some((m, w)) = stack.pop() {
                    (ctm, lw) = (m, w);
                }
            }
            b"cm" => {
                if let [a, b, c, d, e, f] = n[..] {
                    ctm = mul(&Matrix::new(a, b, c, d, e, f), &ctm);
                }
            }
            b"w" => lw = n.first().copied().unwrap_or(lw),
            b"m" | b"l" => add_pts(pts(1)),
            b"c" => add_pts(pts(3)),
            b"v" | b"y" => add_pts(pts(2)),
            b"re" => {
                if let [x, y, w, h] = n[..] {
                    add_pts(vec![(x, y), (x + w, y), (x, y + h), (x + w, y + h)]);
                }
            }
            b"W" | b"W*" => {
                if let Some(p) = &mut path {
                    p.2 = true;
                }
            }
            b"S" | b"s" | b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*" | b"n" => {
                if let Some((start, pts, clip)) = path.take() {
                    if !clip && op.name != b"n" && !pts.is_empty() {
                        let stroke = matches!(op.name, b"S" | b"s" | b"B" | b"B*" | b"b" | b"b*");
                        let scale = (ctm.a * ctm.d - ctm.b * ctm.c).abs().sqrt();
                        let pad = if stroke { (lw * scale / 2.0).max(0.5) } else { 0.0 };
                        out.push(Found { start, end: op.end, bbox: bounds(&pts, &ctm, pad), ctm: ctm.clone() });
                    }
                }
            }
            b"Do" => {
                let name = op.args.iter().find_map(|a| if let Arg::Name(v) = a { Some(v.as_slice()) } else { None });
                if let Some(r) = name.and_then(&xobject) {
                    let bbox = bounds(&[(r.x0, r.y0), (r.x1, r.y0), (r.x0, r.y1), (r.x1, r.y1)], &ctm, 0.0);
                    out.push(Found { start: op.start, end: op.end, bbox, ctm: ctm.clone() });
                }
            }
            b"BI" => {
                let bbox = bounds(&[(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)], &ctm, 0.0);
                out.push(Found { start: op.start, end: op.end, bbox, ctm: ctm.clone() });
            }
            _ => {}
        }
    }
    out.retain(|f| [f.bbox.x0, f.bbox.y0, f.bbox.x1, f.bbox.y1].iter().all(|v| v.is_finite()));
    out
}

/// Alle Content-Streams der Seite hintereinander.
pub(crate) fn contents(page: &PdfPage) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    let Some(c) = page.object().get_dict("Contents")? else { return Ok(out) };
    if c.is_array()? {
        for i in 0..c.len()? as i32 {
            if let Some(s) = c.get_array(i)? {
                out.extend(s.read_stream()?);
                out.push(b'\n');
            }
        }
    } else {
        out = c.read_stream()?;
    }
    Ok(out)
}

/// Box eines XObjects im eigenen Raum: Bild = Einheitsquadrat, Formular = /BBox über /Matrix.
fn xobject_box(xobjects: &Option<PdfObject>, name: &[u8]) -> Option<Rect> {
    let x = xobjects.as_ref()?.get_dict(std::str::from_utf8(name).ok()?).ok()??;
    match x.get_dict("Subtype").ok()??.as_name().ok()?.as_slice() {
        b"Image" => Some(Rect::new(0.0, 0.0, 1.0, 1.0)),
        b"Form" => {
            let nums = |k: &str| -> Option<Vec<f32>> {
                let a = x.get_dict(k).ok()??;
                (0..a.len().ok()? as i32).map(|i| a.get_array(i).ok()?.map(|v| v.as_float().ok()).flatten()).collect()
            };
            let b = nums("BBox")?;
            let [x0, y0, x1, y1] = b[..] else { return None };
            let m = match nums("Matrix").as_deref() {
                Some(&[a, b, c, d, e, f]) => Matrix::new(a, b, c, d, e, f),
                _ => Matrix::IDENTITY,
            };
            Some(bounds(&[(x0, y0), (x1, y0), (x0, y1), (x1, y1)], &m, 0.0))
        }
        _ => None,
    }
}

fn find(doc: &PdfDocument, index: i32) -> Result<(PdfPage, Vec<u8>, Vec<Found>), Error> {
    let page = doc.load_pdf_page(index)?;
    let s = contents(&page)?;
    let xobjects = page.object().get_dict_inheritable("Resources")?.and_then(|r| r.get_dict("XObject").ok().flatten());
    let b = page.bounds()?;
    let base = mul(&page.ctm()?, &Matrix::new_translate(-b.x0, -b.y0));
    let found = scan(&s, base, |n| xobject_box(&xobjects, n));
    Ok((page, s, found))
}

/// Boxen der wählbaren Original-Objekte einer Seite `[x0, y0, x1, y1]`, Reihenfolge = Zeichenreihenfolge.
/// Scan-Seiten: keine.
pub fn boxes(doc: &PdfDocument, index: i32) -> Result<Vec<[f32; 4]>, String> {
    let err = |e: Error| e.to_string();
    if !(0..doc.page_count().map_err(err)?).contains(&index) {
        return Err("ungültige Seite".into());
    }
    if crate::pdf::is_scan(doc, index).map_err(err)? {
        return Ok(Vec::new());
    }
    let (_, _, found) = find(doc, index).map_err(err)?;
    Ok(found.iter().map(|f| [f.bbox.x0, f.bbox.y0, f.bbox.x1, f.bbox.y1]).collect())
}

/// Änderung an Objekt `index` (Reihenfolge wie `boxes`): `matrix` = Abbildung in App-Koordinaten
/// `[a, b, c, d, e, f]` (x' = a·x + c·y + e, y' = b·x + d·y + f); fehlt sie → löschen.
#[derive(Deserialize, Debug, Clone)]
pub struct Edit {
    pub index: usize,
    #[serde(default)]
    pub matrix: Option<[f32; 6]>,
}

pub fn edit(doc: &mut PdfDocument, index: i32, edits: &[Edit]) -> Result<(), String> {
    let err = |e: Error| e.to_string();
    if !(0..doc.page_count().map_err(err)?).contains(&index) || crate::pdf::is_scan(doc, index).map_err(err)? {
        return Err("Seite nicht bearbeitbar".into());
    }
    let (page, mut s, found) = find(doc, index).map_err(err)?;
    let mut todo: Vec<(&Found, Option<Matrix>)> = Vec::new();
    for e in edits {
        let f = found.get(e.index).ok_or("Objekt nicht gefunden")?;
        if todo.iter().any(|(t, _)| std::ptr::eq(*t, f)) {
            return Err("Objekt doppelt geändert".into());
        }
        let m = match e.matrix {
            None => None,
            Some(v) => {
                let ok = v.iter().all(|x| x.is_finite() && x.abs() < 1e5) && (v[0] * v[3] - v[1] * v[2]).abs() > 1e-6;
                if !ok {
                    return Err("ungültige Abbildung".into());
                }
                let inv = f.ctm.invert().ok_or("Objekt nicht abbildbar")?;
                // im Objektraum: erst in App-Koordinaten, dort abbilden, zurück
                Some(mul(&mul(&f.ctm, &Matrix::new(v[0], v[1], v[2], v[3], v[4], v[5])), &inv))
            }
        };
        todo.push((f, m));
    }
    // von hinten nach vorn, damit die Byte-Positionen davor gültig bleiben
    todo.sort_by_key(|(f, _)| std::cmp::Reverse(f.start));
    // kaputter Stream kann verschachtelte Bereiche liefern → nicht schneiden
    if todo.windows(2).any(|w| w[1].0.end > w[0].0.start) {
        return Err("Objekte überlappen im Stream".into());
    }
    for (f, m) in todo {
        match m {
            None => drop(s.splice(f.start..f.end, *b" ")),
            Some(m) => {
                s.splice(f.end..f.end, *b"\nQ\n");
                let pre = format!("q {} {} {} {} {} {} cm\n", m.a, m.b, m.c, m.d, m.e, m.f);
                s.splice(f.start..f.start, pre.into_bytes());
            }
        }
    }
    // neuer Stream statt Überschreiben: Streams können zwischen Seiten geteilt sein; der alte fällt beim Speichern weg
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(&s).map_err(err)?, None, false).map_err(err)?;
    page.object().dict_put("Contents", stream).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_robust() {
        let s = b"q (a Do \\) (c) ) Tj <</A [1 2]>> BDC %Q Q\n 1 0 0 1 5 6 cm BI /W 1 /H 1 ID \x00EI\x01 EI Q (unclosed";
        let names: Vec<_> = ops(s).iter().map(|o| String::from_utf8_lossy(o.name).into_owned()).collect();
        assert_eq!(names, ["q", "Tj", "BDC", "cm", "BI", "Q"]);
        let cm = &ops(s)[3];
        assert_eq!(cm.args, [1.0, 0.0, 0.0, 1.0, 5.0, 6.0].map(Arg::Num));
        assert!(std::str::from_utf8(&s[cm.start..cm.end]).unwrap().starts_with("1 0 0 1"));
        // kaputte Eingabe: kein Absturz, keine Endlosschleife
        for bad in [&b")>>]}{"[..], b"<", b"(", b"BI", b"BI ID", b"/", b"%"] {
            ops(bad);
        }
    }

    fn doc_with(content: &[u8]) -> PdfDocument {
        let mut d = PdfDocument::new();
        let page = d.new_page(mupdf::Size::new(200.0, 100.0)).unwrap();
        let stream = d.add_stream(&mupdf::Buffer::from_bytes(content).unwrap(), None, false).unwrap();
        page.object().dict_put("Contents", stream).unwrap();
        d
    }

    fn near(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.01)
    }

    #[test]
    fn pfade_finden_verschieben_skalieren_loeschen() {
        // Rechteck 10..60 × 10..30 im PDF-Raum (y nach oben) → App: y = 100 − y; Clip-Pfad und Text zählen nicht
        let mut d = doc_with(b"0 0 200 100 re W n 1 0 0 rg 10 10 50 20 re f BT /F1 12 Tf (x) Tj ET 2 w 0 50 m 100 50 l S");
        let b = boxes(&d, 0).unwrap();
        assert_eq!(b.len(), 2);
        assert!(near(b[0], [10.0, 70.0, 60.0, 90.0]), "{b:?}");
        assert!(near(b[1], [-1.0, 49.0, 101.0, 51.0]), "{b:?}");

        // verschieben um (5, −7), Linie um ihre linke obere Ecke verdoppeln
        let m = |v: [f32; 6]| Edit { index: 0, matrix: Some(v) };
        edit(&mut d, 0, &[m([1.0, 0.0, 0.0, 1.0, 5.0, -7.0]), Edit { index: 1, matrix: Some([2.0, 0.0, 0.0, 2.0, 1.0, -49.0]) }]).unwrap();
        let b = boxes(&d, 0).unwrap();
        assert!(near(b[0], [15.0, 63.0, 65.0, 83.0]), "{b:?}");
        assert!(near(b[1], [-1.0, 49.0, 203.0, 53.0]), "{b:?}");

        // nach Speichern/Öffnen gleich, Stream enthält jedes Objekt genau einmal
        let mut d = PdfDocument::from_bytes(&crate::pdf::to_bytes(&d).unwrap()).unwrap();
        assert!(near(boxes(&d, 0).unwrap()[0], [15.0, 63.0, 65.0, 83.0]));
        let s = contents(&d.load_pdf_page(0).unwrap()).unwrap();
        assert_eq!(String::from_utf8_lossy(&s).matches(" re f").count(), 1);

        edit(&mut d, 0, &[Edit { index: 0, matrix: None }]).unwrap();
        let b = boxes(&d, 0).unwrap();
        assert_eq!(b.len(), 1);
        assert!(near(b[0], [-1.0, 49.0, 203.0, 53.0]));
        assert!(page_text(&d).contains('x'), "Text bleibt");

        // ungültig: fremder Index, doppelt, singuläre Matrix
        assert!(edit(&mut d, 0, &[Edit { index: 5, matrix: None }]).is_err());
        assert!(edit(&mut d, 0, &[Edit { index: 0, matrix: None }, Edit { index: 0, matrix: None }]).is_err());
        assert!(edit(&mut d, 0, &[m([0.0; 6])]).is_err());
        assert!(edit(&mut d, 1, &[]).is_err());
    }

    fn page_text(d: &PdfDocument) -> String {
        d.load_page(0).unwrap().to_text_page(mupdf::TextPageFlags::empty()).unwrap().to_text().unwrap()
    }

    #[test]
    fn bild_auf_gedrehter_seite() {
        use mupdf::pdf::page::{InsertImageOptions, PageImageSource};
        let mut d = PdfDocument::new();
        let mut page = d.new_page(mupdf::Size::new(200.0, 100.0)).unwrap();
        let mut pix = mupdf::Pixmap::new_with_w_h(&mupdf::Colorspace::device_rgb(), 2, 2, false).unwrap();
        pix.clear_with(128).unwrap();
        let img = mupdf::Image::from_pixmap(&pix).unwrap();
        page.insert_image(&mut d, Rect::new(20.0, 10.0, 60.0, 30.0), PageImageSource::Image(&img), InsertImageOptions::default()).unwrap();
        page.set_rotation(90).unwrap();
        let b0 = boxes(&d, 0).unwrap();
        assert_eq!(b0.len(), 1);
        // App-Koordinaten der gedrehten Seite: Verschieben um (3, 4) verschiebt die Box genau so
        edit(&mut d, 0, &[Edit { index: 0, matrix: Some([1.0, 0.0, 0.0, 1.0, 3.0, 4.0]) }]).unwrap();
        let b1 = boxes(&d, 0).unwrap();
        assert!(near(b1[0], [b0[0][0] + 3.0, b0[0][1] + 4.0, b0[0][2] + 3.0, b0[0][3] + 4.0]), "{b0:?} → {b1:?}");
    }
}
