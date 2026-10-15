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
    // Garbage-Collect: durch Original-Objekt-Änderungen verwaiste alte Content-Streams fallen weg
    let mut opts = mupdf::pdf::PdfWriteOptions::default();
    opts.set_garbage_level(1).set_compress(true);
    doc.write_to_with_options(&mut buf, opts).map_err(|e| e.to_string())?;
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

/// Scan-Seite: kein Text, nur ein Bild über (fast) die ganze Seite → Seite ist fester Hintergrund,
/// Elemente darin werden nicht auswählbar.
pub fn is_scan(doc: &PdfDocument, index: i32) -> Result<bool, Error> {
    use mupdf::text_page::TextBlockType;
    let page = doc.load_page(index)?;
    let area = |r: Rect| (r.x1 - r.x0).max(0.0) * (r.y1 - r.y0).max(0.0);
    let full = area(page.bounds()?);
    let mut images = 0;
    for b in page.to_text_page(TextPageFlags::PRESERVE_IMAGES)?.blocks() {
        match b.r#type() {
            TextBlockType::Image if area(b.bounds()) >= 0.9 * full => images += 1,
            _ => return Ok(false),
        }
    }
    Ok(images == 1)
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
    Image,
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
    /// Bild: PNG/JPEG als Base64. Liegt in der PDF nur als Stamp-Bild, nicht doppelt in den Daten.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub image: String,
}

const IMAGE_MAX: usize = 64 << 20; // Base64-Länge

impl Item {
    fn valid(&self, pages: i32) -> bool {
        let need = if self.kind == Kind::Ink || self.kind == Kind::Marker { 1 } else { 2 };
        (0..pages).contains(&self.page)
            && self.points.len() >= need
            && self.points.len() <= 100_000
            && self.text.len() <= 100_000
            && (self.kind == Kind::Image) == !self.image.is_empty()
            && self.image.len() <= IMAGE_MAX
            && self.points.iter().flatten().chain(&self.color).chain([&self.opacity, &self.size, &self.width]).all(|v| v.is_finite())
    }

    /// Gespeicherte Daten: auf 0,01 gerundet, damit die PDF nicht unnötig wächst.
    fn data(&self) -> String {
        let r = |v: f32| (v * 100.0).round() / 100.0;
        let it = Item { points: self.points.iter().map(|p| p.map(r)).collect(), image: String::new(), ..self.clone() };
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

/// Eigener Stamp-Name: MuPDF erzeugt das Erscheinungsbild nur für Standardstempel neu,
/// unseres mit dem Bild bleibt stehen.
const STAMP_NAME: &str = "PDFNoteImage";

/// Bild als Stamp: Erscheinungsbild = Formular mit dem Bild auf dem Einheitsquadrat (wie MuPDFs
/// `pdf_set_annot_stamp_image`, das die Crate nicht anbietet) → fremde Reader zeigen es, `stamp_png` liest es zurück.
/// Bild-Datei fürs Einfügen-Menü: nur PNG/JPEG (kann der Stamp direkt einbetten), muss dekodierbar sein.
pub fn image_b64(bytes: &[u8]) -> Result<String, String> {
    use base64::Engine;
    if !(bytes.starts_with(b"\x89PNG") || bytes.starts_with(b"\xFF\xD8\xFF")) {
        return Err("nur PNG oder JPEG".into());
    }
    if bytes.len() / 3 * 4 > IMAGE_MAX {
        return Err("Bild zu groß".into());
    }
    Image::from_bytes(bytes).map_err(|e| format!("Bild nicht lesbar: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn add_stamp(doc: &mut PdfDocument, page: &mut PdfPage, rect: Rect, it: &Item) -> Result<PdfAnnotation, Error> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&it.image)
        .map_err(|e| Error::InvalidArgument(e.to_string()))?;
    let img_ref = doc.add_image(&Image::from_bytes(&bytes)?)?;
    let mut xobj = doc.new_dict()?;
    xobj.dict_put("I", img_ref)?;
    let mut res = doc.new_dict()?;
    res.dict_put("XObject", xobj)?;
    let mut bbox = doc.new_array()?;
    for v in [0, 0, 1, 1] {
        bbox.array_push(PdfObject::new_int(v)?)?;
    }
    let mut form = doc.new_dict()?;
    form.dict_put("Type", PdfObject::new_name("XObject")?)?;
    form.dict_put("Subtype", PdfObject::new_name("Form")?)?;
    form.dict_put("BBox", bbox)?;
    form.dict_put("Resources", res)?;
    let n = doc.add_stream(&mupdf::Buffer::from_bytes(b"/I Do")?, Some(&form), false)?;
    let mut ap = doc.new_dict()?;
    ap.dict_put("N", n)?;

    let mut a = page.create_annotation(mupdf::pdf::PdfAnnotationType::Stamp)?;
    a.set_rect(rect)?;
    let mut obj = a.object();
    obj.dict_put("Name", PdfObject::new_name(STAMP_NAME)?)?;
    obj.dict_put("AP", ap)?;
    Ok(a)
}

/// Stamp-Bild zurück als PNG. Nur was `add_stamp` schreibt (8 bit, Grau/RGB, optional SMask);
/// sonst Fehler → Annotation bleibt als fremde stehen.
fn stamp_png(annot: &PdfAnnotation) -> Result<Vec<u8>, Error> {
    let bad = || Error::InvalidArgument("Stamp-Bild nicht lesbar".into());
    let mut o = annot.object();
    for k in ["AP", "N", "Resources", "XObject", "I"] {
        o = o.get_dict(k)?.ok_or_else(bad)?;
    }
    let int = |k: &str| -> Result<usize, Error> {
        let v = o.get_dict(k)?.ok_or_else(bad)?.as_int()?;
        usize::try_from(v).map_err(|_| bad())
    };
    let (w, h) = (int("Width")?, int("Height")?);
    let px = w.checked_mul(h).filter(|&p| p > 0 && p <= 1 << 28).ok_or_else(bad)?;
    if int("BitsPerComponent")? != 8 {
        return Err(bad());
    }
    let samples = o.read_stream()?;
    let n = samples.len() / px;
    if !(n == 1 || n == 3) || samples.len() != n * px {
        return Err(bad());
    }
    let alpha = match o.get_dict("SMask")? {
        Some(m) => Some(m.read_stream()?).filter(|a| a.len() == px).ok_or_else(bad).map(Some)?,
        None => None,
    };
    let cs = if n == 1 { Colorspace::device_gray() } else { Colorspace::device_rgb() };
    let mut pix = mupdf::Pixmap::new_with_w_h(&cs, w as i32, h as i32, alpha.is_some())?;
    let stride = pix.stride() as usize;
    let pn = n + alpha.is_some() as usize;
    let dst = pix.samples_mut();
    for y in 0..h {
        for x in 0..w {
            let (s, d) = (y * w + x, y * stride + x * pn);
            let a = alpha.as_ref().map_or(255, |a| a[s]);
            for c in 0..n {
                // Pixmaps mit Alpha sind vormultipliziert; der PNG-Schreiber rechnet zurück
                dst[d + c] = (samples[s * n + c] as u16 * a as u16 / 255) as u8;
            }
            if alpha.is_some() {
                dst[d + n] = a;
            }
        }
    }
    let mut out = Vec::new();
    pix.write_to(&mut out, ImageFormat::PNG)?;
    Ok(out)
}

fn add_item(doc: &mut PdfDocument, page: &mut PdfPage, it: &Item) -> Result<(), Error> {
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
        Kind::Image => add_stamp(doc, page, rect(), it)?,
    };
    match it.kind {
        Kind::Image => {}
        Kind::Text => annot.set_border_width(0.0)?,
        _ => {
            annot.set_color(rgb(it.color))?;
            annot.set_border_width(width)?;
        }
    }
    // Stamp: Erscheinungsbild wird nicht neu erzeugt → Deckkraft fest 1
    if it.kind != Kind::Image {
        annot.set_opacity(it.opacity.clamp(0.05, 1.0))?;
    }
    annot.object().dict_put(OWN_KEY, PdfObject::new_string(&it.data())?)?;
    annot.update()?;
    if it.kind == Kind::Marker {
        set_multiply(&annot)?;
    }
    Ok(())
}

/// Fügt jedes Objekt als eigene Annotation ein (Radierer löscht später ganze Objekte).
pub fn add_items(doc: &mut PdfDocument, items: &[Item]) -> Result<(), String> {
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
                add_item(doc, &mut page, it)?;
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
                if it.kind == Kind::Image {
                    use base64::Engine;
                    it.image = stamp_png(&a).map(|p| base64::engine::general_purpose::STANDARD.encode(p)).unwrap_or_default();
                }
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
    add_items(&mut copy, items)?;
    if flat {
        copy.bake(true, false).map_err(|e| e.to_string())?;
    }
    save_atomic(&copy, path)
}

pub fn tmp_path(path: &Path) -> std::path::PathBuf {
    path.with_extension("pdfnote-tmp")
}

/// Schreibt komplett neu in `<pdf>.pdfnote-tmp`, auf die Platte gezwungen, und benennt dann um:
/// bricht das Schreiben ab (Absturz, Kill, Strom), bleibt das Original heil.
pub fn save_atomic(doc: &PdfDocument, path: &Path) -> Result<(), String> {
    use std::io::Write;
    let buf = to_bytes(doc)?;
    let tmp = tmp_path(path);
    let res = std::fs::File::create(&tmp)
        .and_then(|mut f| f.write_all(&buf).and_then(|_| f.sync_all()))
        .and_then(|_| std::fs::rename(&tmp, path));
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(|e| e.to_string())
}

/// Seitenoperationen. Indizes 0-basiert; `at` = Einfügeposition (= Seitenzahl → anhängen).
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PageOp {
    Blank {
        at: i32,
        width: f32,
        height: f32,
        /// Notizseiten-Vorlage; fehlt = leer
        #[serde(default)]
        template: Option<crate::notebook::Template>,
    },
    InsertFile { at: i32, path: std::path::PathBuf },
    Rotate { index: i32 },
    Delete { index: i32 },
    Move { from: i32, to: i32 },
    /// Original-Objekte einer Seite verschieben/skalieren/löschen
    Orig { page: i32, edits: Vec<crate::orig::Edit> },
    /// Original-Textabsatz ändern/verschieben
    Text { page: i32, edit: crate::text::TextEdit },
    /// Formularfeld ausfüllen
    Field { page: i32, xref: i32, value: String },
    /// Formularfeld anlegen
    NewField { page: i32, field: crate::form::NewField },
    /// Markdown-Seite einfügen (`insert`) oder neu setzen
    Markdown { page: i32, source: String, insert: bool },
    /// Lesezeichen komplett ersetzen
    Outline { marks: Vec<crate::notebook::Mark> },
    /// Anker-Link `rect` auf `from` → Stelle (`to`, `x`, `y`) samt Rücksprung-Link
    Link { from: i32, rect: [f32; 4], to: i32, x: f32, y: f32 },
    /// `n`-ten Link einer Seite löschen
    Unlink { page: i32, n: usize },
    /// Text auf allen Seiten ohne Text erkennen (OCR), unsichtbar einbetten
    Ocr,
}

/// Ergebnis einer Seitenoperation: eingefügte Seiten (für Objekt-Umnummerierung im Frontend)
/// und eigene Objekte aus einer angehängten PDF.
#[derive(Serialize, Debug, Default)]
pub struct OpResult {
    pub inserted: i32,
    pub items: Vec<Item>,
    /// Hinweis ans Frontend (Überlauf, Ersatzschrift, fehlende Zeichen)
    pub warning: Option<String>,
}

const IMAGE_LONG_SIDE: f32 = 842.0; // Bildseite: lange Seite = A4-Höhe, Seitenverhältnis bleibt

pub fn page_op(doc: &mut PdfDocument, op: &PageOp) -> Result<OpResult, String> {
    let count = doc.page_count().map_err(|e| e.to_string())?;
    let at_ok = |at: i32| (0..=count).contains(&at);
    let idx_ok = |i: i32| (0..count).contains(&i);
    let err = |e: Error| e.to_string();
    match op {
        PageOp::Blank { at, width, height, template } => {
            let ok = at_ok(*at) && [width, height].iter().all(|v| v.is_finite() && (10.0..=14_400.0).contains(*v));
            if !ok {
                return Err("ungültige Seite".into());
            }
            doc.new_page_at(*at, Size::new(*width, *height)).map_err(err)?;
            if let Some(t) = template {
                crate::notebook::template(doc, *at, *t)?;
            }
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
                Ok(OpResult { inserted: n, items, warning: None })
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
        PageOp::Orig { page, edits } => {
            crate::orig::edit(doc, *page, edits)?;
            Ok(OpResult::default())
        }
        PageOp::Markdown { page, source, insert } => {
            let warning = crate::notebook::render(doc, *page, source, *insert)?;
            Ok(OpResult { inserted: *insert as i32, warning, ..Default::default() })
        }
        PageOp::Outline { marks } => crate::notebook::set_outline(doc, marks).map(|_| OpResult::default()),
        PageOp::Link { from, rect, to, x, y } => crate::nav::link(doc, *from, *rect, *to, *x, *y).map(|_| OpResult::default()),
        PageOp::Ocr => Ok(OpResult { warning: crate::ocr::ocr(doc)?, ..Default::default() }),
        PageOp::Unlink { page, n } if idx_ok(*page) => crate::nav::unlink(doc, *page, *n).map(|_| OpResult::default()),
        PageOp::Text { page, edit } => Ok(OpResult { warning: crate::text::edit(doc, *page, edit)?, ..Default::default() }),
        PageOp::Field { page, xref, value } if idx_ok(*page) => crate::form::set(doc, *page, *xref, value).map(|_| OpResult::default()),
        PageOp::NewField { page, field } if idx_ok(*page) => crate::form::create(doc, *page, field).map(|_| OpResult::default()),
        PageOp::Field { .. } | PageOp::NewField { .. } | PageOp::Unlink { .. } => Err("ungültige Seite".into()),
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
        Item { page: 0, kind, color: [1.0, 0.0, 0.0], opacity: 1.0, size: 2.0, width: 2.0, simulated: false, points, text: String::new(), image: String::new() }
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
        // Textfelder nutzen Helvetica (Base-14) → keine eingebettete Schrift, Subsetting unnötig
        let raw = std::fs::read(&path).unwrap();
        assert!(!raw.windows(8).any(|w| w == b"FontFile"), "Schrift eingebettet");
        let _ = std::fs::remove_file(path);
    }

    /// 3×2-PNG mit Teiltransparenz.
    fn test_png() -> (Vec<u8>, Vec<u8>) {
        let mut pix = mupdf::Pixmap::new_with_w_h(&Colorspace::device_rgb(), 3, 2, true).unwrap();
        let px: [[u8; 4]; 6] = [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0], [10, 20, 30, 255], [200, 100, 50, 255], [255, 255, 255, 64]];
        let stride = pix.stride() as usize;
        for (i, p) in px.iter().enumerate() {
            let d = (i / 3) * stride + (i % 3) * 4;
            for c in 0..3 {
                pix.samples_mut()[d + c] = (p[c] as u16 * p[3] as u16 / 255) as u8;
            }
            pix.samples_mut()[d + 3] = p[3];
        }
        let mut out = Vec::new();
        pix.write_to(&mut out, ImageFormat::PNG).unwrap();
        let back = Image::from_bytes(&out).unwrap().to_pixmap().unwrap();
        (out, back.samples().to_vec())
    }

    #[test]
    fn bild_als_stamp_zurueck() {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD;
        let (png, want) = test_png();
        assert_eq!(image_b64(&png).unwrap(), b64.encode(&png));
        assert!(image_b64(b"GIF89a").is_err());
        assert!(image_b64(&png[..20]).is_err(), "abgeschnittenes PNG");
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let img = Item { image: b64.encode(&png), ..item(Kind::Image, vec![[50.0, 50.0, 0.5], [350.0, 250.0, 0.5]]) };
        let path = tmp("stamp");
        save(&doc, std::slice::from_ref(&img), &path, false).unwrap();
        let back = open(&path).unwrap();
        let ann = annotations(&back, 0).unwrap();
        assert_eq!(ann.len(), 1);
        assert_eq!(ann[0].0, T::Stamp);
        assert!(!ann[0].1.as_ref().unwrap().contains("\"image\":"), "Bild nicht doppelt in den Daten");
        // gerendert: Mitte des Stamps nicht weiß
        let pix = back.load_page(0).unwrap()
            .to_pixmap(&Matrix::IDENTITY, &Colorspace::device_rgb(), false, true).unwrap();
        let (x, y) = (50 + 50, 50 + 50); // linke obere Kachel (rot)
        let p = pix.pixel(x, y).unwrap();
        assert_eq!(&p.components()[..3], &[255, 0, 0], "Bild nicht gerendert");

        let taken = take_own(&back, 0..1).unwrap();
        assert_eq!(taken.len(), 1);
        let got = Image::from_bytes(&b64.decode(&taken[0].image).unwrap()).unwrap().to_pixmap().unwrap();
        assert_eq!(got.samples(), &want[..], "Pixel inkl. Alpha");
        assert_eq!(Item { image: String::new(), ..taken[0].clone() }, Item { image: String::new(), ..img });
        // Bild ohne Daten / Daten ohne Bild abgelehnt
        assert!(add_items(&mut doc, &[item(Kind::Image, vec![[1.0, 1.0, 0.5], [2.0, 2.0, 0.5]])]).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn scan_seiten() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        let png = tmp("scan-img").with_extension("png");
        std::fs::write(&png, test_png().0).unwrap();
        page_op(&mut doc, &PageOp::InsertFile { at: 1, path: png.clone() }).unwrap();
        save(&doc, &all_kinds()[6..], &png.with_extension("pdf"), true).unwrap();
        let text = open(&png.with_extension("pdf")).unwrap();
        assert!(!is_scan(&doc, 0).unwrap(), "leere Seite");
        assert!(is_scan(&doc, 1).unwrap(), "Bildseite");
        assert!(!is_scan(&text, 0).unwrap(), "Textseite");
        let _ = std::fs::remove_file(png.with_extension("pdf"));
        let _ = std::fs::remove_file(png);
    }

    #[test]
    fn marker_multipliziert() {
        let mut doc = PdfDocument::new();
        doc.new_page(Size::A4).unwrap();
        add_items(&mut doc, &all_kinds()[1..2]).unwrap();
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
        add_items(&mut doc, &all_kinds()[..1]).unwrap();
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
        assert!(add_items(&mut doc, &[Item { page: 5, ..ok.clone() }]).is_err());
        assert!(add_items(&mut doc, &[Item { points: vec![[f32::NAN, 0.0, 0.5]], ..ok.clone() }]).is_err());
        assert!(add_items(&mut doc, &[item(Kind::Rect, vec![[1.0, 1.0, 0.5]])]).is_err());
        assert!(add_items(&mut doc, &[ok]).is_ok());
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
        let blank = |at| PageOp::Blank { at, width: 300.0, height: 200.0, template: None };
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
        assert!(page_op(&mut doc, &PageOp::Blank { at: 0, width: f32::NAN, height: 1.0, template: None }).is_err());

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
