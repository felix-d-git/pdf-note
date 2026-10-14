// Spikes 1+2 (Wegwerf): MuPDF rendern bzw. Text-Edit per Redact + Neu-Einfügen mit Originalschrift.
// Aufruf: mupdf-spike render <pdf> <scale>
//         mupdf-spike edit <pdf> <out.pdf> <out.png> [systemschrift.ttf]
//         mupdf-spike png <pdf> <out.png>
use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::shape::{Shape, TextOptions};
use mupdf::{Colorspace, Document, ImageFormat, Matrix, Point, TextPageFlags};
use std::time::Instant;
#[path = "../../peak.rs"]
mod peak;

const ADD: &str = " ÄÖüß€ edit";

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a[1].as_str() {
        "render" => render(&a[2], a[3].parse().unwrap()),
        "png" => png(&a[2], &a[3]),
        _ => edit(&a[2], &a[3], &a[4]),
    }
}

fn render(path: &str, scale: f32) {
    let t = Instant::now();
    let doc = Document::open(path).unwrap();
    let open_ms = t.elapsed().as_secs_f64() * 1e3;
    let (cs, m) = (Colorspace::device_rgb(), Matrix::new_scale(scale, scale));
    let (mut times, mut px) = (vec![], 0usize);
    let t = Instant::now();
    for i in 0..doc.page_count().unwrap() {
        let t1 = Instant::now();
        let pix = doc
            .load_page(i)
            .unwrap()
            .to_pixmap(&m, &cs, true, false)
            .unwrap();
        px = px.max(pix.samples().len());
        times.push(t1.elapsed().as_secs_f64() * 1e3);
    }
    let total = t.elapsed().as_secs_f64() * 1e3;
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = times.len();
    println!(
        "mupdf scale={scale} pages={n} open={open_ms:.0}ms total={total:.0}ms median={:.1}ms p95={:.1}ms max={:.1}ms maxbitmap={}KB peak(ws,private)={:?}MB",
        times[n / 2],
        times[n * 95 / 100],
        times[n - 1],
        px / 1024,
        peak::mb()
    );
}

// Gegenprobe für fremd bearbeitete PDFs: Text mit "edit" + Seite 1 als PNG
fn png(path: &str, png: &str) {
    let p = Document::open(path).unwrap().load_page(0).unwrap();
    let txt = p
        .to_text_page(TextPageFlags::empty())
        .unwrap()
        .to_text()
        .unwrap();
    for l in txt.lines().filter(|l| l.contains("edit")) {
        println!("    | {l}");
    }
    p.to_pixmap(
        &Matrix::new_scale(1.5, 1.5),
        &Colorspace::device_rgb(),
        false,
        false,
    )
    .unwrap()
    .save_as(png, ImageFormat::PNG)
    .unwrap();
}

// Eingebettetes Font-Programm zur BaseFont suchen (Resources/Font, auch Type0-Nachfahren).
fn font_file(page: &PdfObject, name: &str) -> Option<(String, Vec<u8>)> {
    let fonts = page
        .get_dict_inheritable("Resources")
        .ok()??
        .get_dict("Font")
        .ok()??;
    for i in 0..fonts.dict_len().ok()? {
        let mut f = fonts.get_dict_val(i as i32).ok()??;
        let base =
            String::from_utf8_lossy(&f.get_dict("BaseFont").ok()??.as_name().ok()?).to_string();
        if !base.ends_with(name) && !name.ends_with(&base) {
            continue;
        }
        if let Some(d) = f.get_dict("DescendantFonts").ok()? {
            f = d.get_array(0).ok()??;
        }
        let desc = f.get_dict("FontDescriptor").ok()??;
        for k in ["FontFile2", "FontFile3", "FontFile"] {
            if let Some(s) = desc.get_dict(k).ok()? {
                return Some((format!("{base} ({k})"), s.read_stream().ok()?));
            }
        }
        return Some((format!("{base} (nicht eingebettet)"), vec![]));
    }
    None
}

fn edit(path: &str, out: &str, png: &str) {
    let mut doc = PdfDocument::open(path).unwrap();
    let mut page = doc.load_pdf_page(0).unwrap();
    let tp = page.to_text_page(TextPageFlags::empty()).unwrap();
    // erste Zeile mit >= 5 Zeichen
    let blocks: Vec<_> = tp.blocks().collect();
    let line = blocks
        .iter()
        .flat_map(|b| b.lines())
        .find(|l| l.chars().count() >= 5);
    let Some(line) = line else {
        println!("{path}: kein Text (Scan) -> Text-Edit entfällt");
        return;
    };
    let c0 = line.chars().next().unwrap();
    let old: String = line.chars().filter_map(|c| c.char()).collect();
    let font = c0.font().unwrap();
    let fname = font.name().to_string();
    let missing: String = ADD
        .chars()
        .filter(|&ch| ch != ' ' && font.encode_character(ch as i32).unwrap_or(0) == 0)
        .collect();
    let ff = font_file(&page.object(), &fname);
    println!(
        "{path}: zeile={old:?} font={fname} size={:.1} datei={:?} fehlende_glyphen={missing:?}",
        c0.size(),
        ff.as_ref().map(|(n, b)| format!("{n} {}B", b.len()))
    );

    // Alte Zeile entfernen (nur Text der Zeile), neue Zeile 30 pt tiefer mit derselben Schrift.
    page.add_redact_annotation(line.bounds()).unwrap();
    page.apply_redactions().unwrap();
    // optional 5. Argument: vollständige Systemschrift statt eingebettetem Subset
    let bytes = match std::env::args().nth(5) {
        Some(sys) => Some(std::fs::read(sys).unwrap()),
        None => ff.map(|(_, b)| b).filter(|b| !b.is_empty()),
    };
    let opts = TextOptions {
        fontsize: c0.size(),
        fontname: "FEdit".into(),
        fontfile: bytes.as_deref(),
        simple: false,
        ..Default::default()
    };
    let o = c0.origin();
    let mut shape = Shape::new(&mut page).unwrap();
    let r = shape
        .insert_text(Point::new(o.x, o.y + 30.0), &format!("{old}{ADD}"), &opts)
        .and_then(|s| s.commit(&mut doc, true));
    if let Err(e) = r {
        println!("  insert_text FEHLER: {e}");
        return;
    }
    doc.save(out).unwrap();

    // Gegenprobe: neu öffnen, Text extrahieren, Seite als PNG
    let d2 = Document::open(out).unwrap();
    let p2 = d2.load_page(0).unwrap();
    let txt = p2
        .to_text_page(TextPageFlags::empty())
        .unwrap()
        .to_text()
        .unwrap();
    println!("  neu geöffnet: enthält Edit={}", txt.contains(ADD.trim()));
    for l in txt
        .lines()
        .filter(|l| l.contains("edit") || l.contains(&old[..old.len().min(8)]))
        .take(3)
    {
        println!("    | {l}");
    }
    p2.to_pixmap(
        &Matrix::new_scale(1.5, 1.5),
        &Colorspace::device_rgb(),
        false,
        false,
    )
    .unwrap()
    .save_as(png, ImageFormat::PNG)
    .unwrap();
}
