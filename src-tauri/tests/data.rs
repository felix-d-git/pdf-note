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

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn item(page: i32, kind: pdf::Kind, points: Vec<[f32; 3]>, text: &str) -> pdf::Item {
    pdf::Item { page, kind, color: [0.0, 0.0, 1.0], opacity: 1.0, size: 12.0, width: 1.5, simulated: false, points, text: text.into(), image: String::new(), layer: 0 }
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
        // eigener Ordner je Kopie → nach dem Speichern darf dort nur die PDF liegen
        let solo = tmp.join("solo");
        let _ = std::fs::remove_dir_all(&solo);
        std::fs::create_dir_all(&solo).unwrap();
        let copy = solo.join(src.file_name().unwrap());
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
            pdf::Item { image: b64(&pdf::render_png(&doc, 0, 0.1).unwrap()), ..item(0, Kind::Image, two.clone(), "") },
        ]);
        pdf::save(&doc, &items, &copy, false).unwrap();
        assert_eq!(std::fs::read_dir(&solo).unwrap().count(), 1, "{name}: Zusatzdatei neben der PDF");

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
        pdf::page_op(&mut d, &PageOp::Blank { at: 0, width: 595.0, height: 842.0, template: None }).unwrap();
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

        assert_eq!(std::fs::read_dir(&solo).unwrap().count(), 1, "{name}: Zusatzdatei nach Sitzung");
        println!("{name}: {pages} Seiten, alle Schreibpfade OK");
        n += 1;
    }
    assert!(n > 0, "keine PDFs in {}", dir.display());
}

/// v1.0.0-Fehler „Striche verschwinden": 50 kurze Striche/Formen gemischt (wie aus dem Frontend-Test) →
/// Speichern → Neu-Öffnen → alle 50 da.
#[test]
#[ignore]
fn fuenfzig_schnelle_striche() {
    use pdf::Kind;
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs/word.pdf");
    let tmp = std::env::temp_dir().join("pdf-note-test-50");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let copy = tmp.join("word.pdf");
    std::fs::copy(&src, &copy).expect("testdata/pdfs/word.pdf fehlt");
    let doc = pdf::open(&copy).unwrap();
    let before = pdf::take_own(&doc, 0..doc.page_count().unwrap()).unwrap().len();
    let kinds = [Kind::Ink, Kind::Rect, Kind::Ink, Kind::Line, Kind::Ink, Kind::Ellipse, Kind::Arrow];
    let items: Vec<_> = (0..50)
        .map(|i| {
            let (x, y) = (30.0 + (i % 10) as f32 * 50.0, 60.0 + (i / 10) as f32 * 60.0);
            item(0, kinds[i % kinds.len()], vec![[x, y, 0.5], [x + 20.0, y + 15.0, 0.6], [x + 35.0, y + 5.0, 0.5]], "")
        })
        .collect();
    pdf::save(&doc, &items, &copy, false).unwrap();
    let back = pdf::open(&copy).unwrap();
    let got = pdf::take_own(&back, 0..back.page_count().unwrap()).unwrap();
    assert_eq!(got.len(), before + 50, "Objektanzahl nach Neu-Öffnen");
    assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 1, "Zusatzdatei neben der PDF");
}

/// Tabs: zwei Dokumente gleichzeitig im selben Thread; Seitenoperation + Undo in einem lässt das andere unberührt,
/// beide speichern in ihre eigene Datei.
#[test]
#[ignore]
fn zwei_dokumente_gleichzeitig() {
    use pdf::{Kind, PageOp};
    use pdf_note_lib::Open;
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let mut srcs: Vec<_> = std::fs::read_dir(&dir)
        .expect("testdata/pdfs/ fehlt")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "pdf"))
        .collect();
    srcs.sort();
    let first = srcs.first().expect("keine PDFs").clone();
    let second = srcs.get(1).unwrap_or(&first).clone();
    let tmp = std::env::temp_dir().join("pdf-note-test-two");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let (pa, pb) = (tmp.join("a.pdf"), tmp.join("b.pdf"));
    std::fs::copy(&first, &pa).unwrap();
    std::fs::copy(&second, &pb).unwrap();

    let (mut a, sa) = Open::open(pa.clone()).unwrap();
    let (mut b, sb) = Open::open(pb.clone()).unwrap();
    let (na, nb) = (sa.sizes.len(), sb.sizes.len());

    // A: Seite einfügen und rückgängig; B: Seite einfügen und behalten
    let r = a.page_op(&PageOp::Blank { at: 0, width: 595.0, height: 842.0, template: None }).unwrap();
    assert_eq!(r.sizes.len(), na + 1);
    b.page_op(&PageOp::Blank { at: 0, width: 595.0, height: 842.0, template: None }).unwrap();
    a.load(0).unwrap();
    assert_eq!(a.sizes().unwrap().len(), na, "A: Undo");
    assert_eq!(b.sizes().unwrap().len(), nb + 1, "B: von Undo in A betroffen");

    let mut items_a = sa.items.clone();
    items_a.push(item(0, Kind::Text, vec![[40.0, 200.0, 0.5], [200.0, 230.0, 0.5]], "nur A"));
    a.save(&items_a, None, false, false).unwrap();
    b.save(&sb.items, None, false, false).unwrap();
    drop((a, b));

    let (_, ra) = Open::open(pa).unwrap();
    let (_, rb) = Open::open(pb).unwrap();
    assert_eq!(ra.sizes.len(), na, "A: Seitenzahl");
    assert_eq!(rb.sizes.len(), nb + 1, "B: Seitenzahl");
    assert_eq!(ra.items.len(), items_a.len(), "A: Objekte");
    assert_eq!(rb.items.len(), sb.items.len(), "B: Objekt aus A gelandet");
    assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 2, "Zusatzdatei neben den PDFs");
    println!("{} + {}: zwei Dokumente OK", first.display(), second.display());
}

/// Kindprozess für den Kill-Test: speichert endlos in die PDF aus `PDF_NOTE_KILL` (ohne Variable: nichts).
#[test]
#[ignore]
fn kill_kind() {
    let Ok(p) = std::env::var("PDF_NOTE_KILL") else { return };
    let p = std::path::PathBuf::from(p);
    let doc = pdf::open(&p).unwrap();
    loop {
        pdf::save(&doc, &[], &p, false).unwrap();
    }
}

/// Prozess wird mitten im Speichern hart beendet → PDF öffnet weiter mit unverändertem Text,
/// der Temp-Rest verschwindet beim nächsten Öffnen.
#[test]
#[ignore]
fn kill_waehrend_speichern() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let src = std::fs::read_dir(&dir)
        .expect("testdata/pdfs/ fehlt")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "pdf"))
        .max_by_key(|p| std::fs::metadata(p).unwrap().len())
        .expect("keine PDFs");
    let tmp = std::env::temp_dir().join("pdf-note-test-kill");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let copy = tmp.join("kill.pdf");
    std::fs::copy(&src, &copy).unwrap();
    let text = page_texts(&pdf::open(&copy).unwrap()).unwrap();

    let mut mid = 0;
    for i in 0..10u64 {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "kill_kind", "--ignored", "--nocapture"])
            .env("PDF_NOTE_KILL", &copy)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(400 + 137 * i));
        child.kill().unwrap();
        child.wait().unwrap();
        mid += pdf::tmp_path(&copy).exists() as u32;
        let back = pdf::open(&copy).unwrap_or_else(|e| panic!("Runde {i}: PDF kaputt: {e}"));
        assert_eq!(page_texts(&back).unwrap(), text, "Runde {i}: Text");
    }
    pdf_note_lib::Open::open(copy.clone()).unwrap();
    assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 1, "Temp-Rest nach dem Öffnen");
    println!("{}: 10 Kills, {mid} davon mitten im Schreiben, PDF heil", src.display());
}

/// Original-Objekte je Test-PDF (Kopie): erstes Objekt verschieben, letztes löschen → speichern → neu öffnen:
/// Box verschoben, Anzahl −1, andere Seiten unverändert, keine Zusatzdatei, Original unverändert.
#[test]
#[ignore]
fn original_objekte() {
    use pdf::PageOp;
    use pdf_note_lib::orig::{self, Edit};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-orig");
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let name = src.display();
        let original = std::fs::read(&src).unwrap();
        let _ = std::fs::remove_dir_all(&solo);
        std::fs::create_dir_all(&solo).unwrap();
        let copy = solo.join(src.file_name().unwrap());
        std::fs::copy(&src, &copy).unwrap();

        let mut doc = pdf::open(&copy).unwrap();
        let pages = doc.page_count().unwrap();
        let texts = page_texts(&doc).unwrap();
        let Some((page, b)) = (0..pages).map(|i| (i, orig::boxes(&doc, i).unwrap())).find(|(_, b)| !b.is_empty()) else {
            println!("{name}: keine Original-Objekte");
            continue;
        };
        let mut edits = vec![Edit { index: 0, matrix: Some([1.0, 0.0, 0.0, 1.0, 5.0, 5.0]) }];
        if b.len() > 1 {
            edits.push(Edit { index: b.len() - 1, matrix: None });
        }
        pdf::page_op(&mut doc, &PageOp::Orig { page, edits }).unwrap();
        pdf::save(&doc, &[], &copy, false).unwrap();

        let doc = pdf::open(&copy).unwrap();
        let after = orig::boxes(&doc, page).unwrap();
        assert_eq!(after.len(), b.len().max(2) - 1, "{name}: Anzahl");
        let moved = [b[0][0] + 5.0, b[0][1] + 5.0, b[0][2] + 5.0, b[0][3] + 5.0];
        assert!(after[0].iter().zip(moved).all(|(x, y)| (x - y).abs() < 0.05), "{name}: {:?} → {:?}", b[0], after[0]);
        let t = page_texts(&doc).unwrap();
        for i in (0..pages as usize).filter(|&i| i != page as usize) {
            assert_eq!(texts[i], t[i], "{name}: Text Seite {i}");
        }
        assert_eq!(std::fs::read_dir(&solo).unwrap().count(), 1, "{name}: Zusatzdatei");
        assert_eq!(original, std::fs::read(&src).unwrap(), "{name}: Original verändert");
        println!("{name}: Seite {page}, {} Objekte OK", b.len());
        n += 1;
    }
    assert!(n > 0, "keine PDFs mit Original-Objekten in {}", dir.display());
}

#[test]
#[ignore]
fn text_bearbeiten() {
    use pdf::PageOp;
    use pdf_note_lib::text::{paragraphs, TextEdit};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-text");
    let words = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    for f in ["latex.pdf", "word.pdf"] {
        let src = dir.join(f);
        let original = std::fs::read(&src).expect("testdata/pdfs/ fehlt");
        let _ = std::fs::remove_dir_all(&solo);
        std::fs::create_dir_all(&solo).unwrap();
        let copy = solo.join(f);
        std::fs::copy(&src, &copy).unwrap();

        let mut doc = pdf::open(&copy).unwrap();
        let texts = page_texts(&doc).unwrap();
        let annots = |d: &PdfDocument| d.load_pdf_page(0).unwrap().annotations().count();
        let n_annots = annots(&doc);
        let before = paragraphs(&doc, 0).unwrap();
        // Fließtext-Absatz (≥ 2 Zeilen, ≥ 8 Wörter): zwei Wörter mehr; einzeiliger Absatz: Sonderzeichen dazu
        let body = before.iter().position(|p| p.text.split_whitespace().count() >= 8 && p.bbox[3] - p.bbox[1] > 1.8 * p.size).unwrap();
        let single = before.iter().position(|p| p.bbox[3] - p.bbox[1] < 1.6 * p.size && p.text.len() > 3).unwrap();
        let new_body = format!("{} zwei mehr", before[body].text);
        let new_single = format!("{} Maß 5 €", before[single].text);
        let mut warnings = Vec::new();
        for (para, text) in [(body, &new_body), (single, &new_single)] {
            // Absatzreihenfolge ändert sich nach jeder Änderung → Index neu bestimmen
            let old = if para == body { &before[body].text } else { &before[single].text };
            let i = paragraphs(&doc, 0).unwrap().iter().position(|p| &p.text == old).unwrap();
            let edit = TextEdit { para: i, text: text.clone(), dx: 0.0, dy: 0.0, size: None, font: None };
            warnings.push(pdf::page_op(&mut doc, &PageOp::Text { page: 0, edit }).unwrap().warning);
        }
        pdf::save(&doc, &[], &copy, false).unwrap();

        let doc = pdf::open(&copy).unwrap();
        let after = paragraphs(&doc, 0).unwrap();
        let all = words(&page_texts(&doc).unwrap()[0]);
        for t in [&new_body, &new_single] {
            assert!(all.contains(&words(t)), "{f}: neuer Text fehlt: {t}\n{all}");
        }
        for (i, p) in before.iter().enumerate().filter(|(i, _)| ![body, single].contains(i)) {
            assert!(after.iter().any(|q| q.text == p.text), "{f}: Absatz {i} verändert: {}", p.text);
        }
        let t = page_texts(&doc).unwrap();
        for i in 1..texts.len() {
            assert_eq!(texts[i], t[i], "{f}: Text Seite {i}");
        }
        assert_eq!(annots(&doc), n_annots, "{f}: Annotationen");
        assert_eq!(std::fs::read_dir(&solo).unwrap().count(), 1, "{f}: Zusatzdatei");
        assert_eq!(original, std::fs::read(&src).unwrap(), "{f}: Original verändert");
        println!("{f}: Absätze {body}+{single} geändert, Hinweise {warnings:?}, {} → {} Bytes", original.len(), std::fs::metadata(&copy).unwrap().len());
    }
}

/// Formular (Kopie von formular.pdf): vorhandene Felder ausfüllen + neue anlegen → speichern → neu öffnen:
/// Werte da, neue Felder in AcroForm, Erscheinungsbild vorhanden; Text der Seiten unverändert.
#[test]
#[ignore]
fn formular() {
    use pdf::PageOp;
    use pdf_note_lib::form::{fields, NewField};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-form");
    let _ = std::fs::remove_dir_all(&solo);
    std::fs::create_dir_all(&solo).unwrap();
    let src = dir.join("formular.pdf");
    let original = std::fs::read(&src).expect("testdata/pdfs/ fehlt");
    let copy = solo.join("formular.pdf");
    std::fs::copy(&src, &copy).unwrap();

    let mut doc = pdf::open(&copy).unwrap();
    let texts = page_texts(&doc).unwrap();
    let all = fields(&doc, 0).unwrap();
    for f in &all {
        println!("{:?}", f);
    }
    // je Art das erste beschreibbare Feld ausfüllen
    let mut want = Vec::new();
    for kind in ["text", "check", "radio", "combo", "list"] {
        let Some(f) = all.iter().find(|f| f.kind == kind && !f.readonly) else { continue };
        let value = match kind {
            "text" => "Grüße – Maß 5 €".to_string(),
            "check" | "radio" => f.on.clone(),
            _ => f.options.last().unwrap()[0].clone(),
        };
        pdf::page_op(&mut doc, &PageOp::Field { page: 0, xref: f.xref, value: value.clone() }).unwrap();
        want.push((f.xref, value));
    }
    assert!(want.len() >= 2, "formular.pdf: zu wenige Feldarten");
    let new = [("text", "Neu Text", vec![]), ("check", "Neu Haken", vec![]), ("combo", "Neu Liste", vec!["Eins".into(), "Zwei".into()])];
    for (i, (kind, name, options)) in new.iter().enumerate() {
        let y = 20.0 + 30.0 * i as f32;
        let field = NewField { kind: kind.to_string(), name: name.to_string(), rect: [20.0, y, 160.0, y + 20.0], options: options.clone() };
        pdf::page_op(&mut doc, &PageOp::NewField { page: 0, field }).unwrap();
    }
    // doppelter Name wird abgelehnt
    let dup = NewField { kind: "text".into(), name: "Neu Text".into(), rect: [20.0, 200.0, 160.0, 220.0], options: vec![] };
    assert!(pdf::page_op(&mut doc, &PageOp::NewField { page: 0, field: dup }).is_err());
    pdf::save(&doc, &[], &copy, false).unwrap();

    let mut doc = pdf::open(&copy).unwrap();
    assert_eq!(page_texts(&doc).unwrap(), texts, "Seitentext verändert");
    let after = fields(&doc, 0).unwrap();
    for (xref, value) in &want {
        let f = after.iter().find(|f| f.xref == *xref).unwrap();
        assert_eq!(&f.value, value, "{}: Wert", f.name);
        assert!(f.kind == "radio" || f.kind == "check" || doc.load_pdf_page(0).unwrap().load_widget(*xref).unwrap().unwrap().annotation().object().get_dict("AP").unwrap().is_some());
    }
    for (kind, name, _) in &new {
        let f = after.iter().find(|f| f.name == *name).unwrap_or_else(|| panic!("{name} fehlt"));
        assert_eq!(f.kind, *kind);
        let o = doc.load_pdf_page(0).unwrap().load_widget(f.xref).unwrap().unwrap().annotation().object();
        assert!(o.get_dict("AP").unwrap().is_some(), "{name}: kein Erscheinungsbild");
    }
    let acro = doc.catalog().unwrap().get_dict("AcroForm").unwrap().unwrap().get_dict("Fields").unwrap().unwrap();
    let in_acro = (0..acro.len().unwrap() as i32).filter_map(|i| acro.get_array(i).unwrap()).filter_map(|o| o.get_dict("T").unwrap()).map(|t| t.as_string().unwrap()).collect::<Vec<_>>();
    for (_, name, _) in &new {
        assert!(in_acro.iter().any(|t| t == name), "{name} nicht in AcroForm/Fields");
    }
    // neues Feld ausfüllbar: Haken setzen, Liste wählen
    let check = after.iter().find(|f| f.name == "Neu Haken").unwrap().clone();
    assert_ne!(check.on, "Off");
    pdf::page_op(&mut doc, &PageOp::Field { page: 0, xref: check.xref, value: check.on.clone() }).unwrap();
    let combo = after.iter().find(|f| f.name == "Neu Liste").unwrap().clone();
    assert_eq!(combo.options.len(), 2);
    pdf::page_op(&mut doc, &PageOp::Field { page: 0, xref: combo.xref, value: "Zwei".into() }).unwrap();
    let again = fields(&doc, 0).unwrap();
    assert_eq!(again.iter().find(|f| f.xref == check.xref).unwrap().value, check.on);
    assert_eq!(again.iter().find(|f| f.xref == combo.xref).unwrap().value, "Zwei");

    assert_eq!(original, std::fs::read(&src).unwrap(), "Original verändert");
    let extra: Vec<_> = std::fs::read_dir(&solo).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(extra.len(), 1, "Zusatzdatei neben der PDF: {extra:?}");
}

/// Notizbuch an jeder Test-PDF: Vorlagenseiten + Markdown-Seite + Lesezeichen anhängen, speichern, neu öffnen.
/// Original-Seiten unverändert, vorhandene Gliederung bleibt beim Neuschreiben gleich, keine Zusatzdatei.
#[test]
#[ignore]
fn notizbuch() {
    use pdf::PageOp;
    use pdf_note_lib::notebook::{markdown, outline, Mark, Template};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-notebook");
    let _ = std::fs::remove_dir_all(&solo);
    std::fs::create_dir_all(&solo).unwrap();
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let copy = solo.join(src.file_name().unwrap());
        std::fs::copy(&src, &copy).unwrap();
        let mut doc = pdf::open(&copy).unwrap();
        let texts = page_texts(&doc).unwrap();
        let count = texts.len() as i32;
        // vorhandene Gliederung unverändert zurückschreiben
        let old = outline(&doc).unwrap();
        if !old.is_empty() {
            pdf::page_op(&mut doc, &PageOp::Outline { marks: old.clone() }).unwrap();
            assert_eq!(outline(&doc).unwrap(), old, "{}: Gliederung", src.display());
        }
        for (i, t) in [Template::Lined, Template::Grid, Template::Dots].into_iter().enumerate() {
            pdf::page_op(&mut doc, &PageOp::Blank { at: count + i as i32, width: 595.0, height: 842.0, template: Some(t) }).unwrap();
        }
        let md = "# Notiz\n\nText mit **fett** und Ümlaut.\n\n- eins\n- zwei\n";
        pdf::page_op(&mut doc, &PageOp::Markdown { page: count + 3, source: md.into(), insert: true }).unwrap();
        let mut marks = old.clone();
        marks.push(Mark { title: "Notizen".into(), page: count, level: 0 });
        marks.push(Mark { title: "Markdown".into(), page: count + 3, level: 1 });
        pdf::page_op(&mut doc, &PageOp::Outline { marks: marks.clone() }).unwrap();
        pdf::save(&doc, &[], &copy, false).unwrap();

        let doc = pdf::open(&copy).unwrap();
        let after = page_texts(&doc).unwrap();
        assert_eq!(after.len() as i32, count + 4, "{}: Seitenzahl", src.display());
        assert_eq!(after[..texts.len()], texts[..], "{}: Original-Seiten", src.display());
        assert!(after[count as usize + 3].contains("Ümlaut"), "{}: Markdown-Text", src.display());
        assert_eq!(markdown(&doc, count + 3).unwrap().as_deref(), Some(md));
        assert_eq!(outline(&doc).unwrap(), marks, "{}: Lesezeichen", src.display());
        for i in count..count + 4 {
            assert!(pdf_note_lib::orig::boxes(&doc, i).unwrap().is_empty(), "{}: Seite {i} wählbar", src.display());
        }
        println!("{}: OK", src.display());
        n += 1;
    }
    let files = std::fs::read_dir(&solo).unwrap().count();
    assert_eq!(files, n, "Zusatzdateien neben den PDFs");
    assert!(n > 0);
}

/// Suche findet vorhandenen Text; Link-Paar auf Notizseite ↔ Seite 1 überlebt Speichern, vorhandene Links bleiben.
#[test]
#[ignore]
fn suche_und_links() {
    use pdf::PageOp;
    use pdf_note_lib::nav::{links, search};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-nav");
    let _ = std::fs::remove_dir_all(&solo);
    std::fs::create_dir_all(&solo).unwrap();
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).expect("testdata/pdfs/ fehlt") {
        let src = entry.unwrap().path();
        if src.extension().is_none_or(|e| e != "pdf") {
            continue;
        }
        let copy = solo.join(src.file_name().unwrap());
        std::fs::copy(&src, &copy).unwrap();
        let mut doc = pdf::open(&copy).unwrap();
        let texts = page_texts(&doc).unwrap();
        let count = texts.len() as i32;
        let word = texts.iter().enumerate().find_map(|(i, t)| {
            t.split_whitespace().find(|w| w.chars().count() >= 4 && w.chars().all(char::is_alphanumeric)).map(|w| (i as i32, w.to_string()))
        });
        if let Some((page, w)) = &word {
            let hits = search(&doc, w).unwrap();
            assert!(hits.iter().any(|h| h.page == *page), "{}: „{w}“ nicht gefunden", src.display());
        }
        let old = links(&doc, 0).unwrap();
        pdf::page_op(&mut doc, &PageOp::Blank { at: count, width: 595.0, height: 842.0, template: None }).unwrap();
        pdf::page_op(&mut doc, &PageOp::Link { from: count, rect: [50.0, 50.0, 200.0, 70.0], to: 0, x: 40.0, y: 100.0 }).unwrap();
        pdf::save(&doc, &[], &copy, false).unwrap();

        let mut doc = pdf::open(&copy).unwrap();
        assert_eq!(page_texts(&doc).unwrap()[..texts.len()], texts[..], "{}: Original-Seiten", src.display());
        let hin = links(&doc, count).unwrap();
        assert_eq!(hin.len(), 1, "{}: Link", src.display());
        assert!(hin[0].page == 0 && (hin[0].y - 100.0).abs() < 0.5, "{}: Ziel {hin:?}", src.display());
        let back = links(&doc, 0).unwrap();
        assert_eq!(back[..old.len()], old[..], "{}: vorhandene Links", src.display());
        assert_eq!(back.len(), old.len() + 1, "{}: Rücksprung", src.display());
        pdf::page_op(&mut doc, &PageOp::Unlink { page: 0, n: old.len() }).unwrap();
        assert_eq!(links(&doc, 0).unwrap(), old, "{}: Rücksprung gelöscht", src.display());
        println!("{}: OK ({} Links, Suche {:?})", src.display(), old.len(), word.map(|w| w.1));
        n += 1;
    }
    assert!(n > 0);
}

/// OCR: Gescannt.pdf wird durchsuchbar (auch nach Speichern), Seiten mit Text bleiben unverändert.
#[test]
#[ignore]
fn ocr_scan() {
    use pdf::PageOp;
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-ocr");
    let _ = std::fs::remove_dir_all(&solo);
    std::fs::create_dir_all(&solo).unwrap();
    for name in ["Gescannt.pdf", "word.pdf"] {
        let copy = solo.join(name);
        std::fs::copy(dir.join(name), &copy).unwrap();
        let mut doc = pdf::open(&copy).unwrap();
        let before = page_texts(&doc).unwrap();
        let r = pdf::page_op(&mut doc, &PageOp::Ocr).unwrap();
        pdf::save(&doc, &[], &copy, false).unwrap();
        let doc = pdf::open(&copy).unwrap();
        let after = page_texts(&doc).unwrap();
        if before.iter().all(|t| t.trim().is_empty()) {
            let word = after.iter().flat_map(|t| t.split_whitespace()).find(|w| w.chars().count() >= 4 && w.chars().all(char::is_alphanumeric));
            let word = word.unwrap_or_else(|| panic!("{name}: nichts erkannt ({:?})", r.warning));
            assert!(!pdf_note_lib::nav::search(&doc, word).unwrap().is_empty(), "{name}: „{word}“ nicht suchbar");
            // Ebene 1: Scan-Bild bleibt unwählbar, OCR-Text ist markierbar
            assert!(pdf::is_scan(&doc, 0).unwrap(), "{name}: nach OCR kein Scan mehr");
            let chars: String = pdf_note_lib::text::chars(&doc, 0).unwrap().into_iter().map(|l| l.text).collect();
            assert!(chars.contains(word), "{name}: OCR-Text nicht markierbar");
        } else {
            assert_eq!(after, before, "{name}: Seiten mit Text verändert");
        }
        println!("{name}: OK ({:?})", r.warning);
    }
    assert!(solo.join("Gescannt.pdf").is_file() && std::fs::read_dir(&solo).unwrap().count() == 2, "Fremddateien neben der PDF");
}

/// Ebenen als echte PDF-Ebenen (OCGs): `/OC` je Annotation, nach Neu-Öffnen richtig, keine doppelten OCGs,
/// flach ohne Ebenen.
#[test]
#[ignore]
fn ebenen() {
    use pdf::{Kind, LAYER_NAMES};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../testdata/pdfs");
    let solo = std::env::temp_dir().join("pdf-note-test-ebenen");
    let _ = std::fs::remove_dir_all(&solo);
    std::fs::create_dir_all(&solo).unwrap();
    let copy = solo.join("word.pdf");
    std::fs::copy(dir.join("word.pdf"), &copy).unwrap();
    let doc = pdf::open(&copy).unwrap();
    let foreign = pdf::annotations(&doc, 0).unwrap().len();
    let two = vec![[30.0, 30.0, 0.5], [120.0, 90.0, 0.5]];
    let items = vec![
        item(0, Kind::Ink, vec![[20.0, 20.0, 0.2], [60.0, 45.0, 0.5]], ""),
        item(0, Kind::Rect, two.clone(), ""),
        pdf::Item { layer: 3, ..item(0, Kind::Ellipse, two.clone(), "") },
        item(0, Kind::Text, vec![[40.0, 200.0, 0.5], [200.0, 230.0, 0.5]], "Notiz"),
    ];
    let want = [3, 2, 3, 3];
    for round in 0..3 {
        let d = pdf::open(&copy).unwrap();
        let mut back = pdf::take_own(&d, 0..1).unwrap();
        if round == 0 {
            back = items.clone();
        } else {
            assert_eq!(back.iter().map(|it| it.layer).collect::<Vec<_>>(), want, "Ebenen nach Neu-Öffnen (Runde {round})");
        }
        pdf::save(&d, &back, &copy, false).unwrap();
        let d = pdf::open(&copy).unwrap();
        assert_eq!(pdf::layer_names(&d).unwrap(), LAYER_NAMES.to_vec(), "doppelte/fehlende OCGs (Runde {round})");
        let oc = pdf::annotation_layers(&d, 0).unwrap();
        let own = &oc[oc.len() - items.len()..];
        let exp: Vec<_> = want.iter().map(|l| Some(LAYER_NAMES[*l as usize - 2].to_string())).collect();
        assert_eq!(own, &exp[..], "/OC je Annotation (Runde {round})");
        assert!(oc[..foreign].iter().all(Option::is_none), "fremde Annotationen bekommen kein /OC");
    }
    let flat = solo.join("flach.pdf");
    let d = pdf::open(&copy).unwrap();
    let back = pdf::take_own(&d, 0..1).unwrap();
    pdf::save(&d, &back, &flat, true).unwrap();
    assert!(pdf::layer_names(&pdf::open(&flat).unwrap()).unwrap().is_empty(), "flach: Ebenen bleiben");
    println!("word.pdf: Ebenen OK");
}
