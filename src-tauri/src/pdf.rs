use mupdf::color::AnnotationColor;
use mupdf::pdf::{InsertPdfOptions, InsertPosition, LineEndingStyle, PdfAnnotation, PdfDocument, PdfObject, PdfPage};
use mupdf::pdf::page::{InsertImageOptions, PageImageSource};
use mupdf::{Colorspace, Document, Error, Image, ImageFormat, Matrix, Point, Rect, Size, TextPageFlags};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Schlüssel im Annotations-Dictionary: markiert eigene Objekte und hält die Sitzungsdaten
/// (Druckpunkte, Größe). Fremde Reader ignorieren unbekannte Schlüssel.
const OWN_KEY: &str = "PDFNote";

/// Text jeder Seite – Prüfgröße für Speichern → Neu-Öffnen.
pub fn page_texts(doc: &Document) -> Result<Vec<String>, Error> {
    doc.pages()?
        .map(|p| p?.to_text_page(TextPageFlags::empty())?.to_text())
        .collect()
}

/// Liest die PDF komplett in den RAM: hält keinen Datei-Handle offen,
/// sonst kann Windows die Datei beim Speichern nicht ersetzen.
pub fn open(path: &Path) -> Result<PdfDocument, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    PdfDocument::from_bytes(&bytes).map_err(|e| e.to_string())
}

pub fn to_bytes(doc: &PdfDocument) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    doc.write_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Seitengrößen in pt (gedrehte Seiten bereits gedreht).
pub fn page_sizes(doc: &PdfDocument) -> Result<Vec<[f32; 2]>, Error> {
    (0..doc.page_count()?)
        .map(|i| {
            let b = doc.load_page(i)?.bounds()?;
            Ok([b.x1 - b.x0, b.y1 - b.y0])
        })
        .collect()
}

/// Seite als PNG, inkl. fremder Annotationen (eigene sind beim Öffnen herausgenommen).
pub fn render_png(doc: &PdfDocument, index: i32, scale: f32) -> Result<Vec<u8>, Error> {
    let scale = scale.clamp(0.05, 8.0);
    let page = doc.load_page(index)?;
    let pix = page.to_pixmap(&Matrix::new_scale(scale, scale), &Colorspace::device_rgb(), false, true)?;
    let mut out = Vec::new();
    pix.write_to(&mut out, ImageFormat::PNG)?;
    Ok(out)
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Ink,
    Marker,
    Line,
    Arrow,
    Rect,
    Ellipse,
    Text,
}

/// Eigenes Objekt. Punkte in pt relativ zur linken oberen Seitenecke, dritter Wert = Druck.
/// Formen/Text: zwei Punkte (Ecken bzw. Anfang/Ende). `size` = Grundbreite bzw. Schriftgröße,
/// `width` = Linienbreite in der PDF (Ink kennt nur eine Breite je Strich).
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct Item {
    pub page: i32,
    pub kind: Kind,
    pub color: [f32; 3],
    pub opacity: f32,
    pub size: f32,
    pub width: f32,
    #[serde(default)]
    pub simulated: bool,
    pub points: Vec<[f32; 3]>,
    #[serde(default)]
    pub text: String,
}

impl Item {
    fn valid(&self, pages: i32) -> bool {
        let need = if self.kind == Kind::Ink || self.kind == Kind::Marker { 1 } else { 2 };
        (0..pages).contains(&self.page)
            && self.points.len() >= need
            && self.points.len() <= 100_000
            && self.text.len() <= 100_000
            && self.points.iter().flatten().chain(&self.color).chain([&self.opacity, &self.size, &self.width]).all(|v| v.is_finite())
    }

    /// Gespeicherte Daten: auf 0,01 gerundet, damit die PDF nicht unnötig wächst.
    fn data(&self) -> String {
        let r = |v: f32| (v * 100.0).round() / 100.0;
        let it = Item { points: self.points.iter().map(|p| p.map(r)).collect(), ..self.clone() };
        serde_json::to_string(&it).unwrap_or_default()
    }
}

fn rgb(c: [f32; 3]) -> AnnotationColor {
    let [red, green, blue] = c.map(|v| v.clamp(0.0, 1.0));
    AnnotationColor::Rgb { red, green, blue }
}

/// Textmarker: Füllmodus Multiply in alle ExtGStates des Erscheinungsbilds, wie bei Highlight.
fn set_multiply(annot: &PdfAnnotation) -> Result<(), Error> {
    let gs = annot
        .object()
        .get_dict("AP")?
        .and_then(|ap| ap.get_dict("N").ok().flatten())
        .and_then(|n| n.get_dict("Resources").ok().flatten())
        .and_then(|r| r.get_dict("ExtGState").ok().flatten());
    if let Some(gs) = gs {
        for i in 0..gs.dict_len()? as i32 {
            if let Some(mut g) = gs.get_dict_val(i)? {
                g.dict_put("BM", PdfObject::new_name("Multiply")?)?;
            }
        }
    }
    Ok(())
}

fn add_item(page: &mut PdfPage, it: &Item) -> Result<(), Error> {
    let b = page.bounds()?;
    let pt = |p: &[f32; 3]| Point::new(b.x0 + p[0], b.y0 + p[1]);
    let rect = || {
        let (a, c) = (pt(&it.points[0]), pt(&it.points[1]));
        Rect::new(a.x.min(c.x), a.y.min(c.y), a.x.max(c.x), a.y.max(c.y))
    };
    let width = it.width.clamp(0.1, 200.0);
    let mut annot = match it.kind {
        Kind::Ink | Kind::Marker => page.add_ink_annotation([it.points.iter().map(pt)])?,
        Kind::Line | Kind::Arrow => {
            let mut a = page.add_line_annotation(pt(&it.points[0]), pt(&it.points[1]))?;
            if it.kind == Kind::Arrow {
                a.set_line_ending_styles(LineEndingStyle::None, LineEndingStyle::OpenArrow)?;
            }
            a
        }
        Kind::Rect => page.add_rect_annotation(rect())?,
        Kind::Ellipse => page.add_circle_annotation(rect())?,
        Kind::Text => {
            let mut a = page.add_free_text_annotation(rect(), &it.text)?;
            a.set_default_appearance("Helv", it.size.clamp(2.0, 200.0), Some(rgb(it.color)))?;
            a
        }
    };
    if it.kind == Kind::Text {
        annot.set_border_width(0.0)?;
    } else {
        annot.set_color(rgb(it.color))?;
        annot.set_border_width(width)?;
    }
    annot.set_opacity(it.opacity.clamp(0.05, 1.0))?;
    annot.object().dict_put(OWN_KEY, PdfObject::new_string(&it.data())?)?;
    annot.update()?;
    if it.kind == Kind::Marker {
        set_multiply(&annot)?;
    }
    Ok(())
}

/// Fügt jedes Objekt als eigene Annotation ein (Radierer löscht später ganze Objekte).
pub fn add_items(doc: &PdfDocument, items: &[Item]) -> Result<(), String> {
    let count = doc.page_count().map_err(|e| e.to_string())?;
    if let Some(bad) = items.iter().find(|it| !it.valid(count)) {
        return Err(format!("ungültiges Objekt auf Seite {}", bad.page + 1));
    }
    for page_no in 0..count {
        let on_page: Vec<_> = items.iter().filter(|it| it.page == page_no).collect();
        if on_page.is_empty() {
            continue;
        }
        let run = || -> Result<(), Error> {
            let mut page = doc.load_pdf_page(page_no)?;
            for it in on_page {
                add_item(&mut page, it)?;
            }
            page.update()?;
            Ok(())
        };
        run().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Nimmt die eigenen Annotationen der Seiten `pages` aus dem Dokument und gibt sie als Objekte zurück.
/// Nicht lesbare Daten → Annotation bleibt als fremde stehen (kein Verlust).
pub fn take_own(doc: &PdfDocument, pages: std::ops::Range<i32>) -> Result<Vec<Item>, Error> {
    let mut out = Vec::new();
    for page_no in pages {
        let mut page = doc.load_pdf_page(page_no)?;
        let mut own = Vec::new();
        for a in page.annotations() {
            let data = a.object().get_dict(OWN_KEY)?.map(|d| d.as_string()).transpose()?;
            if let Some(mut it) = data.and_then(|d| serde_json::from_str::<Item>(&d).ok()) {
                it.page = page_no;
                if it.valid(page_no + 1) {
                    out.push(it);
                    own.push(a);
                }
            }
        }
        if !own.is_empty() {
            for a in own {
                page.delete_annotation(a)?;
            }
            page.update()?;
        }
    }
    Ok(out)
}

/// Speichern: Kopie des Arbeitsdokuments + Objekte, optional eingebrannt (flach), atomar nach `path`.
pub fn save(doc: &PdfDocument, items: &[Item], path: &Path, flat: bool) -> Result<(), String> {
    let mut copy = PdfDocument::from_bytes(&to_bytes(doc)?).map_err(|e| e.to_string())?;
    add_items(&copy, items)?;
    if flat {
        copy.bake(true, false).map_err(|e| e.to_string())?;
    }
    save_atomic(&copy, path)
}

/// Schreibt komplett neu in `<pdf>.pdfnote-tmp` und benennt dann um:
/// bricht das Schreiben ab, bleibt das Original heil.
pub fn save_atomic(doc: &PdfDocument, path: &Path) -> Result<(), String> {
    let buf = to_bytes(doc)?;
    let tmp = path.with_extension("pdfnote-tmp");
    let res = std::fs::write(&tmp, &buf).and_then(|_| std::fs::rename(&tmp, path));
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(|e| e.to_string())
}

/// Seitenoperationen. Indizes 0-basiert; `at` = Einfügeposition (= Seitenzahl → anhängen).
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PageOp {
    Blank { at: i32, width: f32, height: f32 },
    InsertFile { at: i32, path: std::path::PathBuf },
    Rotate { index: i32 },
    Delete { index: i32 },
    Move { from: i32, to: i32 },
}

/// Ergebnis einer Seitenoperation: eingefügte Seiten (für Objekt-Umnummerierung im Frontend)
/// und eigene Objekte aus einer angehängten PDF.
#[derive(Serialize, Debug, Default)]
pub struct OpResult {
    pub inserted: i32,
    pub items: Vec<Item>,
}

const IMAGE_LONG_SIDE: f32 = 842.0; // Bildseite: lange Seite = A4-Höhe, Seitenverhältnis bleibt

pub fn page_op(doc: &mut PdfDocument, op: &PageOp) -> Result<OpResult, String> {
    let count = doc.page_count().map_err(|e| e.to_string())?;
    let at_ok = |at: i32| (0..=count).contains(&at);
    let idx_ok = |i: i32| (0..count).contains(&i);
    let err = |e: Error| e.to_string();
    match op {
        PageOp::Blank { at, width, height } => {
            let ok = at_ok(*at) && [width, height].iter().all(|v| v.is_finite() && (10.0..=14_400.0).contains(*v));
            if !ok {
                return Err("ungültige Seite".into());
            }
            doc.new_page_at(*at, Size::new(*width, *height)).map_err(err)?;
            Ok(OpResult { inserted: 1, ..Default::default() })
        }
        PageOp::InsertFile { at, path } => {
            if !at_ok(*at) {
                return Err("ungültige Position".into());
            }
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let is_pdf = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
            if is_pdf {
                let src = PdfDocument::from_bytes(&bytes).map_err(err)?;
                let annots = page_annots(&src).map_err(err)?;
                let opts = InsertPdfOptions { target: InsertPosition::Before(*at as usize), ..Default::default() };
                let n = doc.insert_pdf(&src, opts).map_err(err)?.page_count as i32;
                copy_annots(doc, *at, &annots).map_err(err)?;
                let items = take_own(doc, *at..*at + n).map_err(err)?;
                Ok(OpResult { inserted: n, items })
            } else {
                let img = Image::from_bytes(&bytes).map_err(err)?;
                let (w, h) = (img.width() as f32, img.height() as f32);
                if w < 1.0 || h < 1.0 {
                    return Err("leeres Bild".into());
                }
                let s = IMAGE_LONG_SIDE / w.max(h);
                let (pw, ph) = (w * s, h * s);
                let mut page = doc.new_page_at(*at, Size::new(pw, ph)).map_err(err)?;
                page.insert_image(doc, Rect::new(0.0, 0.0, pw, ph), PageImageSource::Image(&img), InsertImageOptions::default())
                    .map_err(err)?;
                Ok(OpResult { inserted: 1, ..Default::default() })
            }
        }
        PageOp::Rotate { index } => {
            if !idx_ok(*index) {
                return Err("ungültige Seite".into());
            }
            let mut page = doc.load_pdf_page(*index).map_err(err)?;
            let r = page.rotation().map_err(err)?;
            page.set_rotation((r + 90).rem_euclid(360)).map_err(err)?;
            Ok(OpResult::default())
        }
        PageOp::Delete { index } => {
            if !idx_ok(*index) || count == 1 {
                return Err("letzte Seite kann nicht gelöscht werden".into());
            }
            doc.delete_page(*index).map_err(err)?;
            Ok(OpResult::default())
        }
        PageOp::Move { from, to } => {
            if !idx_ok(*from) || !idx_ok(*to) {
                return Err("ungültige Seite".into());
            }
            doc.move_page(*from as usize, *to as usize).map_err(err)?;
            Ok(OpResult::default())
        }
    }
}

/// `Annots` je Seite, ohne `/P`: sonst zieht das Grafting die Quellseite als Waisenobjekt mit.
fn page_annots(src: &PdfDocument) -> Result<Vec<Option<PdfObject>>, Error> {
    (0..src.page_count()?)
        .map(|i| {
            let annots = src.load_pdf_page(i)?.object().get_dict("Annots")?;
            if let Some(a) = &annots {
                for j in 0..a.len()? as i32 {
                    if let Some(mut x) = a.get_array(j)? {
                        x.dict_delete("P")?;
                    }
                }
            }
            Ok(annots)
        })
        .collect()
}

/// MuPDFs graft_page übernimmt keine Annotationen (nur Inhalt/Ressourcen/Boxen) → nachträglich kopieren.
fn copy_annots(doc: &PdfDocument, at: i32, annots: &[Option<PdfObject>]) -> Result<(), Error> {
    for (i, a) in annots.iter().enumerate() {
        let Some(a) = a else { continue };
        let mut page = doc.load_pdf_page(at + i as i32)?.object();
        let copy = doc.graft_object(a)?;
        for j in 0..copy.len()? as i32 {
            if let Some(mut x) = copy.get_array(j)? {
                x.dict_put("P", page.clone())?;
            }
        }
        page.dict_put("Annots", copy)?;
    }
    Ok(())
}

/// Annotationstypen + eigene Daten einer Seite – für Tests.
pub fn annotations(doc: &PdfDocument, index: i32) -> Result<Vec<(mupdf::pdf::PdfAnnotationType, Option<String>)>, Error> {
    let page = doc.load_pdf_page(index)?;
    page.annotations()
        .map(|a| Ok((a.r#type()?, a.object().get_dict(OWN_KEY)?.map(|d| d.as_string()).transpose()?)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mupdf::pdf::PdfAnnotationType as T;

    fn item(kind: Kind, points: Vec<[f32; 3]>) -> Item {
        Item { page: 0, kind, color: [1.0, 0.0, 0.0], opacity: 1.0, size: 2.0, width: 2.0, simulated: false, points, text: String::new() }
    }

    fn all_kinds() -> Vec<Item> {
        let two = vec![[100.0, 100.0, 0.5], [200.0, 160.0, 0.5]];
        vec![
            item(Kind::Ink, vec![[10.0, 10.0, 0.3], [50.0, 60.0, 0.6], [90.0, 20.0, 0.9]]),
            Item { opacity: 0.35, size: 12.0, width: 12.0, color: [1.0, 0.9, 0.0], ..item(Kind::Marker, vec![[20.0, 300.0, 0.5], [300.0, 300.0, 0.5]]) },
            item(Kind::Line, two.clone()),
            item(Kind::Arrow, two.clone()),
            item(Kind::Rect, two.clone()),
            item(Kind::Ellipse, two.clone()),
            Item { size: 14.0, text: "Grüße €".into(), ..item(Kind::Text, vec![[300.0, 400.0, 0.5], [450.0, 430.0, 0.5]]) },
        ]
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("pdf-note-unit-{name}.pdf"))
    }

    #[test]
    fn alle_objektarten_speichern_und_zuruecklesen() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let items = all_kinds();
        let path = tmp("kinds");
        save(&doc, &items, &path, false).unwrap();
        // Arbeitsdokument bleibt unverändert (gespeichert wird eine Kopie)
        assert!(annotations(&doc, 0).unwrap().is_empty());

        let back = open(&path).unwrap();
        let types: Vec<_> = annotations(&back, 0).unwrap().into_iter().map(|(t, own)| (t, own.is_some())).collect();
        assert_eq!(types, vec![
            (T::Ink, true), (T::Ink, true), (T::Line, true), (T::Line, true), (T::Square, true), (T::Circle, true), (T::FreeText, true),
        ]);
        let taken = take_own(&back, 0..1).unwrap();
        assert_eq!(taken, items, "Objekte gehen beim Zurücklesen nicht verloren");
        assert!(annotations(&back, 0).unwrap().is_empty(), "eigene Annotationen herausgenommen");
        assert!(!render_png(&back, 0, 0.5).unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn marker_multipliziert() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        add_items(&doc, &all_kinds()[1..2]).unwrap();
        let page = doc.load_pdf_page(0).unwrap();
        let a = page.annotations().next().unwrap();
        let gs = a.object().get_dict("AP").unwrap().unwrap().get_dict("N").unwrap().unwrap()
            .get_dict("Resources").unwrap().unwrap().get_dict("ExtGState").unwrap().unwrap();
        let g = gs.get_dict_val(0).unwrap().unwrap();
        assert_eq!(g.get_dict("BM").unwrap().unwrap().as_name().unwrap(), b"Multiply");
    }

    #[test]
    fn fremde_annotationen_bleiben() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let mut page = doc.load_pdf_page(0).unwrap();
        page.add_ink_annotation([[Point::new(1.0, 1.0), Point::new(5.0, 5.0)]]).unwrap();
        page.update().unwrap();
        add_items(&doc, &all_kinds()[..1]).unwrap();
        // kaputte eigene Daten → bleibt als fremde Annotation stehen
        let mut page = doc.load_pdf_page(0).unwrap();
        let bad = page.add_rect_annotation(Rect::new(1.0, 1.0, 9.0, 9.0)).unwrap();
        bad.object().dict_put(OWN_KEY, PdfObject::new_string("{kaputt").unwrap()).unwrap();
        page.update().unwrap();
        assert_eq!(take_own(&doc, 0..1).unwrap().len(), 1);
        assert_eq!(annotations(&doc, 0).unwrap().len(), 2);
    }

    #[test]
    fn ungueltige_objekte_abgelehnt() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let ok = item(Kind::Ink, vec![[1.0, 1.0, 0.5]]);
        assert!(add_items(&doc, &[Item { page: 5, ..ok.clone() }]).is_err());
        assert!(add_items(&doc, &[Item { points: vec![[f32::NAN, 0.0, 0.5]], ..ok.clone() }]).is_err());
        assert!(add_items(&doc, &[item(Kind::Rect, vec![[1.0, 1.0, 0.5]])]).is_err());
        assert!(add_items(&doc, &[ok]).is_ok());
    }

    #[test]
    fn flach_speichern_brennt_ein() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let path = tmp("flat");
        save(&doc, &all_kinds(), &path, true).unwrap();
        let back = open(&path).unwrap();
        assert!(annotations(&back, 0).unwrap().is_empty(), "keine Annotationen mehr");
        // Inhalt jetzt im Seiteninhalt: Text des Textfelds ist Seitentext
        assert!(page_texts(&back).unwrap()[0].contains("Grüße"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn seitenoperationen() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let blank = |at| PageOp::Blank { at, width: 300.0, height: 200.0 };
        assert_eq!(page_op(&mut doc, &blank(1)).unwrap().inserted, 1);
        assert_eq!(page_sizes(&doc).unwrap(), vec![[595.0, 842.0], [300.0, 200.0]]);
        page_op(&mut doc, &PageOp::Move { from: 1, to: 0 }).unwrap();
        assert_eq!(page_sizes(&doc).unwrap()[0], [300.0, 200.0]);
        page_op(&mut doc, &PageOp::Rotate { index: 0 }).unwrap();
        assert_eq!(page_sizes(&doc).unwrap()[0], [200.0, 300.0]);
        page_op(&mut doc, &PageOp::Delete { index: 0 }).unwrap();
        assert_eq!(page_sizes(&doc).unwrap(), vec![[595.0, 842.0]]);
        assert!(page_op(&mut doc, &PageOp::Delete { index: 0 }).is_err(), "letzte Seite bleibt");
        assert!(page_op(&mut doc, &blank(5)).is_err());
        assert!(page_op(&mut doc, &PageOp::Blank { at: 0, width: f32::NAN, height: 1.0 }).is_err());

        // PDF mit eigenen Objekten einfügen → Objekte kommen als Items zurück, Seiten sauber
        let mut other = PdfDocument::new();
        other.new_page(Size::A4).unwrap();
        other.new_page(Size::A4).unwrap();
        let mut p0 = other.load_pdf_page(0).unwrap();
        p0.add_rect_annotation(Rect::new(1.0, 1.0, 9.0, 9.0)).unwrap();
        p0.update().unwrap();
        let src = tmp("insert-src");
        save(&other, &[Item { page: 1, ..all_kinds()[0].clone() }], &src, false).unwrap();
        let r = page_op(&mut doc, &PageOp::InsertFile { at: 0, path: src.clone() }).unwrap();
        assert_eq!(r.inserted, 2);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].page, 1);
        assert_eq!(doc.page_count().unwrap(), 3);
        assert!(annotations(&doc, 1).unwrap().is_empty());
        assert_eq!(annotations(&doc, 0).unwrap(), vec![(T::Square, None)], "fremde Annotation mitkopiert");

        // Bild als Seite: PNG aus gerenderter Seite
        let png = tmp("insert-img").with_extension("png");
        std::fs::write(&png, render_png(&doc, 2, 0.2).unwrap()).unwrap();
        page_op(&mut doc, &PageOp::InsertFile { at: 3, path: png.clone() }).unwrap();
        let [w, h] = page_sizes(&doc).unwrap()[3];
        assert!((h - 842.0).abs() < 0.5 && (w / h - 595.0 / 842.0).abs() < 0.02, "{w}x{h}");

        // alles zusammen speichern und neu öffnen
        let out = tmp("ops-out");
        save(&doc, &[], &out, false).unwrap();
        assert_eq!(open(&out).unwrap().page_count().unwrap(), 4);
        for p in [src, png, out] {
            let _ = std::fs::remove_file(p);
        }
    }
}
