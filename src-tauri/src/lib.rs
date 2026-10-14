pub mod pdf;

use mupdf::pdf::PdfDocument;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::ipc::Response;

struct Open {
    path: PathBuf,
    doc: PdfDocument,
    /// Stände für Undo von Seitenoperationen; `None` = wegen Speichergrenze verworfen.
    snaps: Vec<Option<Vec<u8>>>,
    rev: usize,
}

/// ponytail: ganze PDF je Seitenoperation im RAM; Deltas erst, wenn große PDFs das sprengen
const SNAP_LIMIT: usize = 256 << 20;

impl Open {
    fn new(path: PathBuf, doc: PdfDocument) -> Self {
        Open { path, doc, snaps: Vec::new(), rev: 0 }
    }

    fn page_op(&mut self, op: &pdf::PageOp) -> Result<PageState, String> {
        if self.snaps.is_empty() {
            self.snaps.push(Some(pdf::to_bytes(&self.doc)?));
        }
        let res = pdf::page_op(&mut self.doc, op);
        // auch bei Fehler kann das Dokument halb geändert sein → Stand von vorher zurückholen
        let r = match res {
            Ok(r) => r,
            Err(e) => {
                let _ = self.load(self.rev);
                return Err(e);
            }
        };
        let bytes = match pdf::to_bytes(&self.doc) {
            Ok(b) => b,
            Err(e) => {
                let _ = self.load(self.rev);
                return Err(e);
            }
        };
        self.snaps.truncate(self.rev + 1);
        self.snaps.push(Some(bytes));
        self.rev += 1;
        let mut total: usize = self.snaps.iter().flatten().map(Vec::len).sum();
        for s in self.snaps.iter_mut().take(self.rev) {
            if total <= SNAP_LIMIT {
                break;
            }
            total -= s.take().map_or(0, |b| b.len());
        }
        Ok(PageState { sizes: self.sizes()?, rev: self.rev, inserted: r.inserted, items: r.items })
    }

    fn load(&mut self, rev: usize) -> Result<(), String> {
        let bytes = self.snaps.get(rev).and_then(Option::as_ref).ok_or("Stand nicht mehr verfügbar")?;
        self.doc = PdfDocument::from_bytes(bytes).map_err(|e| e.to_string())?;
        self.rev = rev;
        Ok(())
    }

    fn sizes(&self) -> Result<Vec<[f32; 2]>, String> {
        pdf::page_sizes(&self.doc).map_err(|e| e.to_string())
    }
}

#[derive(serde::Serialize)]
struct PageState {
    sizes: Vec<[f32; 2]>,
    rev: usize,
    inserted: i32,
    items: Vec<pdf::Item>,
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

fn same_file(a: &std::path::Path, b: &std::path::Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn doc(o: &mut Option<Open>) -> Result<&mut Open, String> {
    o.as_mut().ok_or_else(|| "keine PDF geöffnet".into())
}

/// Öffnen: eigene Annotationen werden zu bearbeitbaren Objekten, fremde bleiben im Seitenbild.
#[tauri::command]
async fn open_pdf(w: tauri::State<'_, Worker>, path: PathBuf) -> Result<PageState, String> {
    w.run(move |o| {
        let d = pdf::open(&path)?;
        let n = d.page_count().map_err(|e| e.to_string())?;
        let items = pdf::take_own(&d, 0..n).map_err(|e| e.to_string())?;
        let open = Open::new(path, d);
        let sizes = open.sizes()?;
        *o = Some(open);
        Ok(PageState { sizes, rev: 0, inserted: 0, items })
    })
    .await
}

#[tauri::command]
async fn render_page(w: tauri::State<'_, Worker>, index: i32, scale: f32) -> Result<Response, String> {
    w.run(move |o| pdf::render_png(&doc(o)?.doc, index, scale).map_err(|e| e.to_string()))
        .await
        .map(Response::new)
}

/// Speichern: Kopie des Arbeitsdokuments + Objekte atomar schreiben. Ohne `target` in die offene PDF;
/// „Speichern unter" schreibt nach `target`, gearbeitet wird weiter an der offenen PDF.
#[tauri::command]
async fn save_pdf(
    w: tauri::State<'_, Worker>,
    items: Vec<pdf::Item>,
    target: Option<PathBuf>,
    flat: bool,
) -> Result<(), String> {
    w.run(move |o| {
        let open = doc(o)?;
        // flach über die offene Datei: eigene Objekte wären danach doppelt (eingebrannt + bearbeitbar)
        if flat && target.as_ref().is_none_or(|t| same_file(t, &open.path)) {
            return Err("Flach nicht über die offene Datei speichern".into());
        }
        pdf::save(&open.doc, &items, target.as_ref().unwrap_or(&open.path), flat)
    })
    .await
}

#[tauri::command]
async fn page_op(w: tauri::State<'_, Worker>, op: pdf::PageOp) -> Result<PageState, String> {
    w.run(move |o| doc(o)?.page_op(&op)).await
}

/// Undo/Redo von Seitenoperationen: Stand `rev` laden.
#[tauri::command]
async fn goto_rev(w: tauri::State<'_, Worker>, rev: usize) -> Result<Vec<[f32; 2]>, String> {
    w.run(move |o| {
        let open = doc(o)?;
        open.load(rev)?;
        open.sizes()
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
        .invoke_handler(tauri::generate_handler![open_pdf, render_page, save_pdf, page_op, goto_rev, startup_path])
        .run(tauri::generate_context!())
        .expect("Tauri-Start fehlgeschlagen");
}
