pub mod pdf;

use mupdf::pdf::PdfDocument;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::ipc::Response;

struct Open {
    path: PathBuf,
    doc: PdfDocument,
}

type Job = Box<dyn FnOnce(&mut Option<Open>) + Send>;

/// MuPDF-Objekte sind nicht `Send` (Kontext pro Thread) → ein fester Thread besitzt das Dokument,
/// Befehle schicken ihm Aufträge.
struct Worker(mpsc::Sender<Job>);

impl Worker {
    fn start() -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::spawn(move || {
            let mut open = None;
            for job in rx {
                // Panik in einem Auftrag darf den Thread nicht beenden; Aufrufer bekommt Fehler (Antwortkanal fällt weg)
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut open)));
            }
        });
        Worker(tx)
    }

    // ponytail: ein Thread für alle Aufträge, Rendern blockiert Speichern; reicht für eine offene PDF
    async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Option<Open>) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.0
            .send(Box::new(move |o| {
                let _ = tx.send(f(o));
            }))
            .map_err(|e| e.to_string())?;
        // Warten nicht auf einem Tokio-Worker blockieren
        tauri::async_runtime::spawn_blocking(move || rx.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "PDF-Auftrag abgebrochen".to_string())?
    }
}

fn doc(o: &mut Option<Open>) -> Result<&mut Open, String> {
    o.as_mut().ok_or_else(|| "keine PDF geöffnet".into())
}

#[tauri::command]
async fn open_pdf(w: tauri::State<'_, Worker>, path: PathBuf) -> Result<Vec<[f32; 2]>, String> {
    w.run(move |o| {
        let d = pdf::open(&path)?;
        let sizes = pdf::page_sizes(&d).map_err(|e| e.to_string())?;
        *o = Some(Open { path, doc: d });
        Ok(sizes)
    })
    .await
}

#[tauri::command]
async fn render_page(w: tauri::State<'_, Worker>, index: i32, scale: f32) -> Result<Response, String> {
    w.run(move |o| pdf::render_png(&doc(o)?.doc, index, scale).map_err(|e| e.to_string()))
        .await
        .map(Response::new)
}

/// Striche als Ink-Annotationen einfügen, atomar in dieselbe PDF schreiben, neu laden.
#[tauri::command]
async fn save_pdf(w: tauri::State<'_, Worker>, strokes: Vec<pdf::Stroke>) -> Result<(), String> {
    w.run(move |o| {
        let open = doc(o)?;
        let res = pdf::add_ink(&open.doc, &strokes).and_then(|_| pdf::save_atomic(&open.doc, &open.path));
        // auch bei Fehler neu laden: halb eingefügte Striche dürfen beim nächsten Versuch nicht doppelt landen
        match (pdf::open(&open.path), &res) {
            (Ok(d), _) => open.doc = d,
            // gespeichert, Neu-Laden scheitert: Dokument im Speicher entspricht trotzdem der Datei
            (Err(_), Ok(())) => {}
            (Err(e), Err(r)) => {
                *o = None;
                return Err(format!("{r}; PDF bitte neu öffnen ({e})"));
            }
        }
        res
    })
    .await
}

/// „Öffnen mit": Pfad aus der Kommandozeile.
#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args().nth(1).filter(|a| !a.starts_with('-'))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Worker::start())
        .invoke_handler(tauri::generate_handler![open_pdf, render_page, save_pdf, startup_path])
        .run(tauri::generate_context!())
        .expect("Tauri-Start fehlgeschlagen");
}
