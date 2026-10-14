// Kein Konsolenfenster im Release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pdf_note_lib::run()
}
