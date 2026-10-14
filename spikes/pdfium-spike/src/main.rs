// Spike 2 (Wegwerf): PDFium rendern, alle Seiten nacheinander, Bitmap sofort freigeben.
// pdfium.dll: github.com/bblanchon/pdfium-binaries (pdfium-win-x64.tgz), nicht im Repo.
// Aufruf: pdfium-spike <pdfium.dll-Ordner> <pdf> <scale> [edit-out.pdf]
use pdfium_render::prelude::*;
use std::time::Instant;
#[path = "../../peak.rs"]
mod peak;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&a[1])).unwrap(),
    );
    let scale: f32 = a[3].parse().unwrap();
    let t = Instant::now();
    let doc = pdfium.load_pdf_from_file(&a[2], None).unwrap();
    let open_ms = t.elapsed().as_secs_f64() * 1e3;

    if let Some(out) = a.get(4) {
        // Fallback-Check Text-Edit: erstes Textobjekt Seite 1 ändern + verschieben
        let mut page = doc.pages().get(0).unwrap();
        for mut o in page.objects_mut().iter() {
            if let Some(t) = o.as_text_object_mut() {
                let old = t.text();
                t.set_text(format!("{old} ÄÖü€ edit")).unwrap();
                o.translate(PdfPoints::new(30.0), PdfPoints::new(-30.0))
                    .unwrap();
                println!("pdfium edit: {old:?}");
                break;
            }
        }
        page.regenerate_content().unwrap();
        doc.save_to_file(out).unwrap();
        return;
    }

    let cfg = PdfRenderConfig::new().scale_page_by_factor(scale);
    let (mut times, mut px) = (vec![], 0usize);
    let t = Instant::now();
    for page in doc.pages().iter() {
        let t1 = Instant::now();
        let bytes = page.render_with_config(&cfg).unwrap().as_raw_bytes();
        px = px.max(bytes.len());
        times.push(t1.elapsed().as_secs_f64() * 1e3);
    }
    let total = t.elapsed().as_secs_f64() * 1e3;
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "pdfium scale={scale} pages={} open={open_ms:.0}ms total={total:.0}ms median={:.1}ms p95={:.1}ms max={:.1}ms maxbitmap={}KB peak(ws,private)={:?}MB",
        times.len(),
        times[times.len() / 2],
        times[times.len() * 95 / 100],
        times[times.len() - 1],
        px / 1024,
        peak::mb()
    );
}
