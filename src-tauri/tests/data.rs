// npm run test:data – gegen die echten Test-PDFs in testdata/pdfs/ (gitignored, daher #[ignore]).
// Originale werden nur gelesen; gespeichert wird in eine Kopie im Temp-Ordner.
use mupdf::Document;
use mupdf::pdf::PdfDocument;
use pdf_note_lib::pdf::{self, page_texts};
use std::path::Path;

#[test]
#[ignore]
fn speichern_und_neu_oeffnen_aendert_nichts() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let tmp = std::env::temp_dir().join("pdf-note-test-data");
    std::fs::create_dir_all(&tmp).unwrap();
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let original = std::fs::read(&src).unwrap();
        let out = tmp.join(src.file_name().unwrap());

        let doc = PdfDocument::open(src.to_str().unwrap()).unwrap();
        let before = page_texts(&doc).unwrap();
        doc.save(out.to_str().unwrap()).unwrap();
        let after = page_texts(&Document::open(out.to_str().unwrap()).unwrap()).unwrap();

        assert_eq!(before.len(), after.len(), "{}: Seitenzahl", src.display());
        assert_eq!(before, after, "{}: Text", src.display());
        assert_eq!(original, std::fs::read(&src).unwrap(), "{}: Original verändert", src.display());
        println!("{}: {} Seiten OK", src.display(), before.len());
        n += 1;
    }
    assert!(n > 0, "keine PDFs in {}", dir.display());
}

/// Wie in der App: Strich als Ink-Annotation in die (kopierte) PDF speichern → neu laden → vorhanden, Text gleich.
#[test]
#[ignore]
fn annotation_speichern_und_neu_laden() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let tmp = std::env::temp_dir().join("pdf-note-test-ink");
    std::fs::create_dir_all(&tmp).unwrap();
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let copy = tmp.join(src.file_name().unwrap());
        std::fs::copy(&src, &copy).unwrap();

        let doc = pdf::open(&copy).unwrap();
        let before_text = page_texts(&doc).unwrap();
        let last = doc.page_count().unwrap() - 1;
        let inks_before = pdf::ink_annotations(&doc, last).unwrap().len();
        let stroke = pdf::Stroke { page: last, color: [0.0, 0.0, 1.0], opacity: 1.0, width: 1.5, points: vec![[20.0, 20.0], [60.0, 45.0], [120.0, 30.0], [150.0, 80.0]] };
        pdf::add_ink(&doc, &[stroke]).unwrap();
        pdf::save_atomic(&doc, &copy).unwrap();

        let back = pdf::open(&copy).unwrap();
        let inks = pdf::ink_annotations(&back, last).unwrap();
        assert_eq!(inks.len(), inks_before + 1, "{}: Ink fehlt", src.display());
        assert_eq!(inks.last().unwrap().0, 4, "{}: Punkte", src.display());
        assert_eq!(page_texts(&back).unwrap(), before_text, "{}: Text", src.display());
        assert!(!copy.with_extension("pdfnote-tmp").exists(), "Temp-Datei übrig");
        println!("{}: Ink auf Seite {} OK", src.display(), last + 1);
        n += 1;
    }
    assert!(n > 0, "keine PDFs in {}", dir.display());
}
