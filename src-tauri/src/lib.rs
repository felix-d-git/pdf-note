pub mod pdf;

use mupdf::pdf::PdfDocument;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::ipc::Response;

/// Eine offene PDF (ein Tab). Mehrere leben nebeneinander im Worker-Thread, jede mit eigenem Undo-Stand.
pub struct Open {
    path: PathBuf,
    doc: PdfDocument,
    /// Stände für Undo von Seitenoperationen; `None` = wegen Speichergrenze verworfen.
    snaps: Vec<Option<Vec<u8>>>,
    rev: usize,
}

/// ponytail: ganze PDF je Seitenoperation im RAM; Deltas erst, wenn große PDFs das sprengen
const SNAP_LIMIT: usize = 256 << 20;

impl Open {
    /// Öffnen: eigene Annotationen werden zu bearbeitbaren Objekten, fremde bleiben im Seitenbild.
    pub fn open(path: PathBuf) -> Result<(Self, PageState), String> {
        let doc = pdf::open(&path)?;
        let n = doc.page_count().map_err(|e| e.to_string())?;
        let items = pdf::take_own(&doc, 0..n).map_err(|e| e.to_string())?;
        let open = Open { path, doc, snaps: Vec::new(), rev: 0 };
        let sizes = open.sizes()?;
        Ok((open, PageState { sizes, rev: 0, inserted: 0, items }))
    }

    /// Kopie des Arbeitsdokuments + Objekte atomar schreiben. Ohne `target` in die offene PDF.
    pub fn save(&self, items: &[pdf::Item], target: Option<&std::path::Path>, flat: bool) -> Result<(), String> {
        // flach über die offene Datei: eigene Objekte wären danach doppelt (eingebrannt + bearbeitbar)
        if flat && target.is_none_or(|t| same_file(t, &self.path)) {
            return Err("Flach nicht über die offene Datei speichern".into());
        }
        pdf::save(&self.doc, items, target.unwrap_or(&self.path), flat)
    }

    pub fn page_op(&mut self, op: &pdf::PageOp) -> Result<PageState, String> {
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

    pub fn load(&mut self, rev: usize) -> Result<(), String> {
        let bytes = self.snaps.get(rev).and_then(Option::as_ref).ok_or("Stand nicht mehr verfügbar")?;
        self.doc = PdfDocument::from_bytes(bytes).map_err(|e| e.to_string())?;
        self.rev = rev;
        Ok(())
    }

    pub fn sizes(&self) -> Result<Vec<[f32; 2]>, String> {
        pdf::page_sizes(&self.doc).map_err(|e| e.to_string())
    }
}

#[derive(serde::Serialize)]
pub struct PageState {
    pub sizes: Vec<[f32; 2]>,
    pub rev: usize,
    pub inserted: i32,
    pub items: Vec<pdf::Item>,
}

/// Offene PDFs nach Tab-ID (vergibt das Frontend).
type Docs = HashMap<u32, Open>;
type Job = Box<dyn FnOnce(&mut Docs) + Send>;

/// MuPDF-Objekte sind nicht `Send` (Kontext pro Thread) → ein fester Thread besitzt das Dokument,
/// Befehle schicken ihm Aufträge.
struct Worker(mpsc::Sender<Job>);

impl Worker {
    fn start() -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::spawn(move || {
            let mut docs = Docs::new();
            for job in rx {
                // Panik in einem Auftrag darf den Thread nicht beenden; Aufrufer bekommt Fehler (Antwortkanal fällt weg)
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut docs)));
            }
        });
        Worker(tx)
    }

    // ponytail: ein Thread für alle Dokumente, Rendern blockiert Speichern; Thread je Dokument, wenn Split-View hakt
    async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Docs) -> Result<T, String> + Send + 'static,
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

fn doc(d: &mut Docs, id: u32) -> Result<&mut Open, String> {
    d.get_mut(&id).ok_or_else(|| "PDF nicht geöffnet".into())
}

#[tauri::command]
async fn open_pdf(w: tauri::State<'_, Worker>, id: u32, path: PathBuf) -> Result<PageState, String> {
    w.run(move |d| {
        let (open, state) = Open::open(path)?;
        d.insert(id, open);
        Ok(state)
    })
    .await
}

/// Tab geschlossen: Dokument und Undo-Stände freigeben.
#[tauri::command]
async fn close_pdf(w: tauri::State<'_, Worker>, id: u32) -> Result<(), String> {
    w.run(move |d| {
        d.remove(&id);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn render_page(w: tauri::State<'_, Worker>, id: u32, index: i32, scale: f32) -> Result<Response, String> {
    w.run(move |d| pdf::render_png(&doc(d, id)?.doc, index, scale).map_err(|e| e.to_string()))
        .await
        .map(Response::new)
}

/// „Speichern unter" schreibt nach `target`, gearbeitet wird weiter an der offenen PDF.
#[tauri::command]
async fn save_pdf(
    w: tauri::State<'_, Worker>,
    id: u32,
    items: Vec<pdf::Item>,
    target: Option<PathBuf>,
    flat: bool,
) -> Result<(), String> {
    w.run(move |d| doc(d, id)?.save(&items, target.as_deref(), flat)).await
}

#[tauri::command]
async fn page_op(w: tauri::State<'_, Worker>, id: u32, op: pdf::PageOp) -> Result<PageState, String> {
    w.run(move |d| doc(d, id)?.page_op(&op)).await
}

/// Undo/Redo von Seitenoperationen: Stand `rev` laden.
#[tauri::command]
async fn goto_rev(w: tauri::State<'_, Worker>, id: u32, rev: usize) -> Result<Vec<[f32; 2]>, String> {
    w.run(move |d| {
        let open = doc(d, id)?;
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
        .invoke_handler(tauri::generate_handler![open_pdf, close_pdf, render_page, save_pdf, page_op, goto_rev, startup_path])
        .run(tauri::generate_context!())
        .expect("Tauri-Start fehlgeschlagen");
}
