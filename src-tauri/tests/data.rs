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

fn item(page: i32, kind: pdf::Kind, points: Vec<[f32; 3]>, text: &str) -> pdf::Item {
    pdf::Item { page, kind, color: [0.0, 0.0, 1.0], opacity: 1.0, size: 12.0, width: 1.5, simulated: false, points, text: text.into() }
}

/// Alle Schreibpfade der App gegen jede Test-PDF (Kopie): Objekte speichern → neu öffnen → identisch zurück,
/// Text unverändert; flach speichern; Seitenoperationen + Speichern.
#[test]
#[ignore]
fn alle_schreibpfade() {
    use pdf::{Kind, PageOp};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let tmp = std::env::temp_dir().join("pdf-note-test-write");
    std::fs::create_dir_all(&tmp).unwrap();
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let name = src.display();
        let copy = tmp.join(src.file_name().unwrap());
        std::fs::copy(&src, &copy).unwrap();

        // Öffnen wie in der App
        let doc = pdf::open(&copy).unwrap();
        let pages = doc.page_count().unwrap();
        let text = page_texts(&doc).unwrap();
        let own_before = pdf::take_own(&doc, 0..pages).unwrap();
        let foreign: Vec<_> = (0..pages).map(|i| pdf::annotations(&doc, i).unwrap().len()).collect();

        let last = pages - 1;
        let two = vec![[30.0, 30.0, 0.5], [120.0, 90.0, 0.5]];
        let mut items = own_before.clone();
        items.extend([
            item(last, Kind::Ink, vec![[20.0, 20.0, 0.2], [60.0, 45.0, 0.5], [120.0, 30.0, 0.9]], ""),
            pdf::Item { opacity: 0.35, color: [1.0, 0.9, 0.0], ..item(last, Kind::Marker, vec![[20.0, 100.0, 0.5], [200.0, 100.0, 0.5]], "") },
            item(last, Kind::Line, two.clone(), ""),
            item(last, Kind::Arrow, two.clone(), ""),
            item(last, Kind::Rect, two.clone(), ""),
            item(last, Kind::Ellipse, two.clone(), ""),
            item(0, Kind::Text, vec![[40.0, 200.0, 0.5], [200.0, 230.0, 0.5]], "Notiz ÄÖÜ"),
        ]);
        pdf::save(&doc, &items, &copy, false).unwrap();
        assert!(!copy.with_extension("pdfnote-tmp").exists(), "{name}: Temp-Datei übrig");

        let back = pdf::open(&copy).unwrap();
        assert_eq!(page_texts(&back).unwrap(), text, "{name}: Text");
        let mut got = pdf::take_own(&back, 0..pages).unwrap();
        let mut want = items.clone();
        for v in [&mut got, &mut want] {
            v.sort_by_key(|it| it.page);
        }
        assert_eq!(got.len(), want.len(), "{name}: Objektanzahl");
        let fg: Vec<_> = (0..pages).map(|i| pdf::annotations(&back, i).unwrap().len()).collect();
        assert_eq!(fg, foreign, "{name}: fremde Annotationen");

        // Speichern unter (flach): keine eigenen Annotationen mehr, Original-Kopie unverändert
        let flat = tmp.join(format!("flach-{}", src.file_name().unwrap().to_string_lossy()));
        let saved = std::fs::read(&copy).unwrap();
        pdf::save(&back, &got, &flat, true).unwrap();
        assert_eq!(std::fs::read(&copy).unwrap(), saved, "{name}: Speichern unter ändert Quelle");
        let f = pdf::open(&flat).unwrap();
        assert!(pdf::take_own(&f, 0..pages).unwrap().is_empty(), "{name}: flach hat eigene Objekte");
        assert!(page_texts(&f).unwrap()[0].contains("Notiz"), "{name}: Textfeld nicht eingebrannt");

        // Seitenoperationen
        let mut d = pdf::open(&copy).unwrap();
        pdf::take_own(&d, 0..pages).unwrap();
        pdf::page_op(&mut d, &PageOp::Blank { at: 0, width: 595.0, height: 842.0 }).unwrap();
        pdf::page_op(&mut d, &PageOp::Rotate { index: 1 }).unwrap();
        pdf::page_op(&mut d, &PageOp::Move { from: 0, to: pages }).unwrap();
        let r = pdf::page_op(&mut d, &PageOp::InsertFile { at: pages + 1, path: copy.clone() }).unwrap();
        assert_eq!(r.inserted, pages, "{name}: angehängte Seiten");
        assert_eq!(r.items.len(), items.len(), "{name}: Objekte der angehängten PDF");
        pdf::page_op(&mut d, &PageOp::Delete { index: pages }).unwrap();
        let ops = tmp.join(format!("seiten-{}", src.file_name().unwrap().to_string_lossy()));
        pdf::save(&d, &[], &ops, false).unwrap();
        let o = pdf::open(&ops).unwrap();
        assert_eq!(o.page_count().unwrap(), 2 * pages, "{name}: Seitenzahl nach Operationen");
        assert_eq!(page_texts(&o).unwrap()[pages as usize..], text[..], "{name}: angehängter Text");

        println!("{name}: {pages} Seiten, alle Schreibpfade OK");
        n += 1;
    }
    assert!(n > 0, "keine PDFs in {}", dir.display());
}
