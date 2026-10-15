//! OCR gescannter Seiten (auf Anforderung): MuPDFs eingebautes Tesseract erkennt den Text, er wird unsichtbar
//! (Rendermodus 3) über das Seitenbild gelegt → Seite durchsuchbar und markierbar, Aussehen unverändert.
//! Sprachdaten (deu+eng) liegen der App bei, kein Download.

use crate::orig::{contents, mul};
use crate::text::{base_matrix, substitute};
use mupdf::pdf::PdfDocument;
use mupdf::{DocumentWriter, Error, Matrix, Rect, TextPageFlags};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};

/// Ordner mit `deu.traineddata`/`eng.traineddata`; setzt `run()` auf das Ressourcenverzeichnis der App.
pub static TESSDATA: OnceLock<PathBuf> = OnceLock::new();
const DPI: u32 = 300;

fn err(e: Error) -> String {
    e.to_string()
}

fn datadir() -> PathBuf {
    TESSDATA.get().cloned().unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/tessdata"))
}

/// Erkanntes Wort in App-Koordinaten: Grundlinie links (`x`, `base`), Breite, Schriftgröße.
struct Word {
    text: String,
    x: f32,
    base: f32,
    width: f32,
    size: f32,
}

/// Seite rendern + erkennen. MuPDF bietet OCR nur als Dokument-Writer → Wegwerf-PDF im Temp-Ordner (nicht neben
/// der PDF), sofort wieder gelöscht; deren unsichtbarer Text liefert Wörter samt Lage.
fn recognize(doc: &PdfDocument, index: i32) -> Result<Vec<Word>, String> {
    let dir = datadir();
    let dir_s = dir.to_str().filter(|s| !s.contains(',')).ok_or("OCR-Sprachdaten: Pfad nicht verwendbar")?;
    if !dir.join("deu.traineddata").is_file() {
        return Err("OCR-Sprachdaten fehlen".into());
    }
    let page = doc.load_page(index).map_err(err)?;
    let b = page.bounds().map_err(err)?;
    // eigener Name je Aufruf: Windows (Virenscanner/Indexer) hält frisch geschriebene Dateien kurz fest
    static N: AtomicU32 = AtomicU32::new(0);
    let tmp = std::env::temp_dir().join(format!("pdf-note-ocr-{}-{}.pdf", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let res = (|| -> Result<Vec<Word>, Error> {
        {
            let opts = format!("ocr-language=deu+eng,ocr-datadir={dir_s},resolution={DPI},compression=flate");
            let mut w = DocumentWriter::with_ocr(tmp.to_str().ok_or(Error::UnexpectedNullPtr)?, &opts)?;
            let dev = w.begin_page(Rect::new(0.0, 0.0, b.x1 - b.x0, b.y1 - b.y0))?;
            page.run(&dev, &Matrix::new_translate(-b.x0, -b.y0))?;
            w.end_page(dev)?;
        }
        let out = mupdf::Document::open(tmp.to_str().ok_or(Error::UnexpectedNullPtr)?)?;
        let mut words = Vec::new();
        for block in out.load_page(0)?.to_text_page(TextPageFlags::empty())?.blocks() {
            for line in block.lines() {
                let mut cur: Option<Word> = None;
                for c in line.chars() {
                    let ch = c.char().unwrap_or(' ');
                    let q = c.quad();
                    let right = q.ur.x.max(q.lr.x);
                    match (&mut cur, ch.is_whitespace()) {
                        (_, true) => words.extend(cur.take()),
                        (Some(w), false) => {
                            w.text.push(ch);
                            w.width = right - w.x;
                        }
                        (None, false) => {
                            let o = c.origin();
                            cur = Some(Word { text: ch.into(), x: o.x, base: o.y, width: right - o.x, size: c.size() });
                        }
                    }
                }
                words.extend(cur);
            }
        }
        Ok(words)
    })();
    for _ in 0..20 {
        if std::fs::remove_file(&tmp).is_ok() || !tmp.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    res.map_err(err)
}

/// Seite hat schon Text → kein OCR (sonst doppelt).
fn has_text(doc: &PdfDocument, index: i32) -> Result<bool, Error> {
    let t = doc.load_page(index)?.to_text_page(TextPageFlags::empty())?;
    Ok(t.blocks().any(|b| b.lines().any(|l| l.chars().any(|c| c.char().is_some_and(|ch| !ch.is_whitespace())))))
}

/// Alle Seiten ohne Text erkennen. Rückgabe = Hinweis für den Nutzer.
// ponytail: läuft im PDF-Thread am Stück (≈ 1–3 s/Seite), Rendern wartet; eigener Thread + Fortschritt, wenn lange Scans nerven
pub fn ocr(doc: &mut PdfDocument) -> Result<Option<String>, String> {
    let (mut done, mut empty) = (0, 0);
    for i in 0..doc.page_count().map_err(err)? {
        if has_text(doc, i).map_err(err)? {
            continue;
        }
        let words = recognize(doc, i)?;
        if words.is_empty() {
            empty += 1;
            continue;
        }
        embed(doc, i, &words)?;
        done += 1;
    }
    Ok(Some(match (done, empty) {
        (0, 0) => "Alle Seiten haben bereits Text – nichts zu erkennen".into(),
        (d, 0) => format!("Text auf {d} Seite(n) erkannt"),
        (0, e) => format!("Auf {e} Seite(n) ohne Text nichts erkannt"),
        (d, e) => format!("Text auf {d} Seite(n) erkannt, auf {e} Seite(n) nichts gefunden"),
    }))
}

/// Wörter unsichtbar auf die Seite legen: je Wort Grundlinie + Größe, Breite per Tz an die erkannte angepasst.
fn embed(doc: &mut PdfDocument, index: i32, words: &[Word]) -> Result<(), String> {
    let page = doc.load_pdf_page(index).map_err(err)?;
    let all: String = words.iter().map(|w| w.text.as_str()).collect();
    let fonts = substitute(doc, &page, "Helvetica", &all, &mut Vec::new()).map_err(err)?;
    let inv = base_matrix(&page).map_err(err)?.invert().ok_or("Seite nicht abbildbar")?;
    let mut s = b"q\n".to_vec();
    s.extend(contents(&page).map_err(err)?);
    let mut t = format!("\nQ\nBT\n3 Tr\n/{} 1 Tf\n", fonts.keys[0]);
    for w in words {
        let glyphs: Vec<_> = w.text.chars().filter_map(|c| fonts.map.get(&c)).collect();
        let natural: f32 = glyphs.iter().map(|g| g.width / 1000.0 * w.size).sum();
        if glyphs.is_empty() || natural <= 0.0 || w.size <= 0.0 {
            continue;
        }
        let tz = (100.0 * w.width / natural).clamp(10.0, 1000.0);
        // Größe in die Matrix, Tf bleibt 1
        let m = mul(&Matrix::new(w.size, 0.0, 0.0, -w.size, w.x, w.base), &inv);
        let hex: String = glyphs.iter().flat_map(|g| g.code.iter()).map(|x| format!("{x:02X}")).collect();
        t += &format!("{tz:.1} Tz {} {} {} {} {} {} Tm <{hex}> Tj\n", m.a, m.b, m.c, m.d, m.e, m.f);
    }
    t += "ET\n";
    s.extend(t.into_bytes());
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(&s).map_err(err)?, None, false).map_err(err)?;
    page.object().dict_put("Contents", stream).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mupdf::{Colorspace, Image, Size};

    /// Seite mit gerendertem Text als Bild (kein Text-Objekt) → OCR → Text gefunden, Seitenbild unverändert.
    #[test]
    fn scan_wird_durchsuchbar() {
        // Text erst als Markdown-Seite setzen, dann als Bild auf eine neue Seite = künstlicher Scan
        let mut src = PdfDocument::new();
        crate::notebook::render(&mut src, 0, "# Rechnung Nummer 4711\n\n# Hello World Scanner", true).unwrap();
        let pix = src.load_page(0).unwrap().to_pixmap(&Matrix::new_scale(3.0, 3.0), &Colorspace::device_gray(), false, false).unwrap();
        let img = Image::from_pixmap(&pix).unwrap();

        let mut d = PdfDocument::new();
        let mut page = d.new_page(Size::A4).unwrap();
        page.insert_image(&mut d, Rect::new(0.0, 0.0, 595.0, 842.0), mupdf::pdf::PageImageSource::Image(&img), Default::default()).unwrap();
        assert!(!has_text(&d, 0).unwrap());
        let before = crate::pdf::render_png(&d, 0, 0.5).unwrap();

        let note = ocr(&mut d).unwrap().unwrap();
        assert!(note.contains("1 Seite"), "{note}");
        let text = crate::pdf::page_texts(&d).unwrap().join(" ");
        for w in ["Rechnung", "4711", "Hello", "World"] {
            assert!(text.contains(w), "„{w}“ fehlt in {text:?}");
        }
        assert!(!crate::nav::search(&d, "Rechnung").unwrap().is_empty());
        assert_eq!(crate::pdf::render_png(&d, 0, 0.5).unwrap(), before, "Text muss unsichtbar sein");
        // zweiter Lauf: Seite hat jetzt Text → nichts doppelt
        assert!(ocr(&mut d).unwrap().unwrap().contains("bereits Text"));
    }
}
