use mupdf::{Document, Error, TextPageFlags};

/// Text jeder Seite – Prüfgröße für Speichern → Neu-Öffnen.
pub fn page_texts(doc: &Document) -> Result<Vec<String>, Error> {
    doc.pages()?
        .map(|p| p?.to_text_page(TextPageFlags::empty())?.to_text())
        .collect()
}
