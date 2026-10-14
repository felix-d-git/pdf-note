// npm run test:data – gegen die echten Test-PDFs in testdata/pdfs/ (gitignored, daher #[ignore]).
// Originale werden nur gelesen; gespeichert wird in eine Kopie im Temp-Ordner.
use mupdf::Document;
use mupdf::pdf::PdfDocument;
use pdf_note_lib::pdf::page_texts;
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
