use mupdf::pdf::{PdfAnnotationType, PdfDocument};
use mupdf::color::AnnotationColor;
use mupdf::{Colorspace, Document, Error, ImageFormat, Matrix, Point, TextPageFlags};
use serde::Deserialize;
use std::path::Path;

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

/// Seitengrößen in pt (gedrehte Seiten bereits gedreht).
pub fn page_sizes(doc: &PdfDocument) -> Result<Vec<[f32; 2]>, Error> {
    (0..doc.page_count()?)
        .map(|i| {
            let b = doc.load_page(i)?.bounds()?;
            Ok([b.x1 - b.x0, b.y1 - b.y0])
        })
        .collect()
}

/// Seite als PNG, inkl. vorhandener Annotationen.
pub fn render_png(doc: &PdfDocument, index: i32, scale: f32) -> Result<Vec<u8>, Error> {
    let scale = scale.clamp(0.05, 8.0);
    let page = doc.load_page(index)?;
    let pix = page.to_pixmap(&Matrix::new_scale(scale, scale), &Colorspace::device_rgb(), false, true)?;
    let mut out = Vec::new();
    pix.write_to(&mut out, ImageFormat::PNG)?;
    Ok(out)
}

/// Strich aus dem Frontend. Punkte in pt relativ zur linken oberen Seitenecke.
#[derive(Deserialize, Debug, Clone)]
pub struct Stroke {
    pub page: i32,
    pub color: [f32; 3],
    pub opacity: f32,
    pub width: f32,
    pub points: Vec<[f32; 2]>,
}

/// Fügt jeden Strich als eigene Ink-Annotation ein (Radierer löscht später ganze Striche).
pub fn add_ink(doc: &PdfDocument, strokes: &[Stroke]) -> Result<(), String> {
    let count = doc.page_count().map_err(|e| e.to_string())?;
    for s in strokes {
        let ok = (0..count).contains(&s.page)
            && !s.points.is_empty()
            && s.points.iter().flatten().all(|v| v.is_finite())
            && s.width.is_finite()
            && s.opacity.is_finite()
            && s.color.iter().all(|c| c.is_finite());
        if !ok {
            return Err(format!("ungültiger Strich auf Seite {}", s.page));
        }
        let run = || -> Result<(), Error> {
            let mut page = doc.load_pdf_page(s.page)?;
            let b = page.bounds()?;
            let pts = s.points.iter().map(|[x, y]| Point::new(b.x0 + x, b.y0 + y));
            let mut annot = page.add_ink_annotation([pts])?;
            let [red, green, blue] = s.color.map(|c| c.clamp(0.0, 1.0));
            annot.set_color(AnnotationColor::Rgb { red, green, blue })?;
            annot.set_border_width(s.width.clamp(0.1, 100.0))?;
            annot.set_opacity(s.opacity.clamp(0.05, 1.0))?;
            annot.update()?;
            page.update()?;
            Ok(())
        };
        run().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Schreibt komplett neu in `<pdf>.pdfnote-tmp` und benennt dann um:
/// bricht das Schreiben ab, bleibt das Original heil.
pub fn save_atomic(doc: &PdfDocument, path: &Path) -> Result<(), String> {
    let mut buf = Vec::new();
    doc.write_to(&mut buf).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("pdfnote-tmp");
    let res = std::fs::write(&tmp, &buf).and_then(|_| std::fs::rename(&tmp, path));
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(|e| e.to_string())
}

/// Ink-Annotationen einer Seite: (Punktanzahl je Strich, Farbe) – für Tests.
pub fn ink_annotations(doc: &PdfDocument, index: i32) -> Result<Vec<(usize, Option<AnnotationColor>)>, Error> {
    let page = doc.load_pdf_page(index)?;
    let mut out = Vec::new();
    for a in page.annotations() {
        if a.r#type()? == PdfAnnotationType::Ink {
            out.push((a.ink_list()?.iter().map(Vec::len).sum(), a.color()?));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strich_speichern_und_neu_laden() {
        let mut doc = PdfDocument::new();
        doc.new_page(mupdf::Size::A4).unwrap();
        let stroke = Stroke { page: 0, color: [1.0, 0.0, 0.0], opacity: 1.0, width: 2.0, points: vec![[10.0, 10.0], [50.0, 60.0], [90.0, 20.0]] };
        add_ink(&doc, &[stroke.clone()]).unwrap();
        let path = std::env::temp_dir().join("pdf-note-unit-ink.pdf");
        save_atomic(&doc, &path).unwrap();
        let back = open(&path).unwrap();
        let inks = ink_annotations(&back, 0).unwrap();
        assert_eq!(inks.len(), 1);
        assert_eq!(inks[0].0, 3);
        assert!(!render_png(&back, 0, 0.5).unwrap().is_empty());
        assert!(add_ink(&doc, &[Stroke { page: 5, ..stroke.clone() }]).is_err());
        assert!(add_ink(&doc, &[Stroke { points: vec![[f32::NAN, 0.0]], ..stroke }]).is_err());
        let _ = std::fs::remove_file(path);
    }
}
