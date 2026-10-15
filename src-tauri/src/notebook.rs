//! PDF als Notizbuch: neue leere PDF, Seitenvorlagen, Markdown-Seiten, Lesezeichen.
//! Alles steckt in der PDF selbst (Seiteninhalt, Seiten-Dictionary, `/Outlines`), keine Zusatzdateien.

use crate::text::{emit, reflow, substitute, Fonts, SetLine};
use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::{Error, Matrix, Size};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Marked-Content-Tag für festen Seiteninhalt (Vorlage, Markdown-Satz): nicht als Original-Objekt wählbar.
pub const FIXED: &str = "PDFNoteFix";
/// Seiten-Dictionary-Schlüssel mit dem Markdown-Quelltext; vorhanden = Markdown-Seite.
const MD_KEY: &str = "PDFNoteMD";
const MD_LIMIT: usize = 200_000;
const MAX_HEIGHT: f32 = 14_400.0; // PDF-Grenze für Seitenlänge (200 inch)
const MM: f32 = 72.0 / 25.4;

fn err(e: Error) -> String {
    e.to_string()
}

/// Neue Notiz-PDF mit einer leeren A4-Seite, atomar geschrieben.
pub fn new_pdf(path: &Path) -> Result<(), String> {
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        return Err("Dateiname muss auf .pdf enden".into());
    }
    let mut d = PdfDocument::new();
    d.new_page(Size::A4).map_err(err)?;
    crate::pdf::save_atomic(&d, path)
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Template {
    Lined,
    Grid,
    Dots,
}

fn f(v: f32) -> String {
    format!("{v:.2}")
}

/// Vorlage als Content-Stream (PDF-Koordinaten, Ursprung unten links).
fn template_ops(t: Template, w: f32, h: f32) -> String {
    let mut s = String::new();
    match t {
        Template::Lined => {
            s += "0.75 G 0.5 w\n";
            let mut y = h - 72.0;
            while y >= 36.0 {
                s += &format!("36 {y} m {} {y} l S\n", f(w - 36.0), y = f(y));
                y -= 8.0 * MM;
            }
        }
        Template::Grid => {
            s += "0.85 G 0.4 w\n";
            let step = 5.0 * MM;
            let mut x = step;
            while x < w {
                s += &format!("{x} 0 m {x} {} l S\n", f(h), x = f(x));
                x += step;
            }
            let mut y = h - step;
            while y > 0.0 {
                s += &format!("0 {y} m {} {y} l S\n", f(w), y = f(y));
                y -= step;
            }
        }
        Template::Dots => {
            s += "0.6 G 1.2 w 1 J\n";
            let step = 5.0 * MM;
            let mut y = h - step;
            while y > 0.0 {
                let mut x = step;
                while x < w {
                    s += &format!("{x} {y} m {x} {y} l S\n", x = f(x), y = f(y));
                    x += step;
                }
                y -= step;
            }
        }
    }
    s
}

fn fixed(inner: &str) -> String {
    format!("/{FIXED} BMC\nq\n{inner}Q\nEMC\n")
}

/// Vorlage auf eine (frisch eingefügte, leere) Seite zeichnen.
pub fn template(doc: &mut PdfDocument, index: i32, t: Template) -> Result<(), String> {
    let page = doc.load_pdf_page(index).map_err(err)?;
    let b = page.bounds().map_err(err)?;
    let s = fixed(&template_ops(t, b.x1 - b.x0, b.y1 - b.y0));
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(s.as_bytes()).map_err(err)?, None, false).map_err(err)?;
    page.object().dict_put("Contents", stream).map_err(err)
}

/// Markdown-Quelltext einer Seite, `None` = keine Markdown-Seite.
pub fn markdown(doc: &PdfDocument, index: i32) -> Result<Option<String>, String> {
    if !(0..doc.page_count().map_err(err)?).contains(&index) {
        return Err("ungültige Seite".into());
    }
    let page = doc.find_page(index).map_err(err)?;
    match page.get_dict(MD_KEY).map_err(err)? {
        Some(s) => Ok(Some(s.as_string().map_err(err)?)),
        None => Ok(None),
    }
}

#[derive(Debug, PartialEq)]
enum Kind {
    Head(usize),
    Para,
    Item { marker: String, level: usize },
    Code,
    Quote,
    Rule,
}

#[derive(Debug)]
struct Block {
    kind: Kind,
    text: String,
}

/// Inline-Auszeichnung entfernen.
// ponytail: fett/kursiv/Code inline nur entfernt, nicht gesetzt; Links bleiben als Quelltext
fn plain(s: &str) -> String {
    s.replace("**", "").replace("__", "").replace('`', "")
}

fn list_marker(line: &str) -> Option<(String, &str)> {
    for b in ["- ", "* ", "+ "] {
        if let Some(rest) = line.strip_prefix(b) {
            return Some(("•".into(), rest));
        }
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    let rest = &line[digits..];
    if (1..=9).contains(&digits) {
        for b in [". ", ") "] {
            if let Some(r) = rest.strip_prefix(b) {
                return Some((format!("{}.", &line[..digits]), r));
            }
        }
    }
    None
}

/// Minimaler Block-Parser: Überschriften, Absätze, Listen, Code-Blöcke, Zitate, Trennlinien.
fn blocks(src: &str) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let mut code: Option<Vec<String>> = None;
    // Absatz/Listenpunkt/Zitat kann in der nächsten Zeile weitergehen
    let mut open = false;
    for raw in src.lines() {
        if let Some(c) = code.as_mut() {
            if raw.trim_start().starts_with("```") {
                out.push(Block { kind: Kind::Code, text: code.take().unwrap_or_default().join("\n") });
            } else {
                c.push(raw.replace('\t', "    "));
            }
            continue;
        }
        let line = raw.trim();
        if line.starts_with("```") {
            code = Some(Vec::new());
            open = false;
            continue;
        }
        if line.is_empty() {
            open = false;
            continue;
        }
        let hashes = line.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
            out.push(Block { kind: Kind::Head(hashes), text: plain(line[hashes..].trim()) });
            open = false;
            continue;
        }
        if line.len() >= 3 && ["-", "*", "_"].iter().any(|c| line.chars().all(|x| x.to_string() == *c || x == ' ')) {
            out.push(Block { kind: Kind::Rule, text: String::new() });
            open = false;
            continue;
        }
        if let Some(q) = line.strip_prefix('>') {
            let q = plain(q.trim());
            match out.last_mut() {
                Some(b) if open && b.kind == Kind::Quote => b.text = format!("{} {q}", b.text),
                _ => out.push(Block { kind: Kind::Quote, text: q }),
            }
            open = true;
            continue;
        }
        let indent = raw.replace('\t', "    ").chars().take_while(|&c| c == ' ').count();
        if let Some((marker, rest)) = list_marker(line) {
            out.push(Block { kind: Kind::Item { marker, level: (indent / 2).min(6) }, text: plain(rest) });
            open = true;
            continue;
        }
        match out.last_mut() {
            Some(b) if open && matches!(b.kind, Kind::Para | Kind::Item { .. } | Kind::Quote) => b.text = format!("{} {}", b.text, plain(line)),
            _ => out.push(Block { kind: Kind::Para, text: plain(line) }),
        }
        open = true;
    }
    if let Some(c) = code {
        out.push(Block { kind: Kind::Code, text: c.join("\n") });
    }
    out
}

const PAGE_W: f32 = 595.0;
const MARGIN: f32 = 56.0;

fn font_of(k: &Kind) -> (&'static str, f32) {
    match k {
        Kind::Head(1) => ("Helvetica-Bold", 22.0),
        Kind::Head(2) => ("Helvetica-Bold", 18.0),
        Kind::Head(3) => ("Helvetica-Bold", 15.0),
        Kind::Head(_) => ("Helvetica-Bold", 13.0),
        Kind::Code => ("Courier", 10.0),
        Kind::Quote => ("Helvetica-Oblique", 11.0),
        _ => ("Helvetica", 11.0),
    }
}

const NAMES: [&str; 4] = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Courier"];

/// Markdown-Seite setzen: `insert` → neue A4-Seite bei `index`, sonst bestehende Markdown-Seite neu setzen.
/// Rückgabe = Hinweis (zu lang, fehlende Zeichen).
pub fn render(doc: &mut PdfDocument, index: i32, source: &str, insert: bool) -> Result<Option<String>, String> {
    if source.chars().count() > MD_LIMIT {
        return Err(format!("Markdown zu lang (max. {MD_LIMIT} Zeichen)"));
    }
    if source.contains('\0') {
        return Err("Markdown enthält ein Nullzeichen".into());
    }
    let count = doc.page_count().map_err(err)?;
    if insert {
        if !(0..=count).contains(&index) {
            return Err("ungültige Position".into());
        }
        doc.new_page_at(index, Size::A4).map_err(err)?;
    } else if markdown(doc, index)?.is_none() {
        return Err("keine Markdown-Seite".into());
    }
    let page = doc.load_pdf_page(index).map_err(err)?;
    let mut obj = page.object();
    // alter Satz/alte Ressourcen weg, Ersatzschriften landen in frischen Ressourcen
    obj.dict_put("Resources", doc.new_dict().map_err(err)?).map_err(err)?;
    obj.dict_delete("CropBox").map_err(err)?;
    obj.dict_delete("Rotate").map_err(err)?;
    obj.dict_put(MD_KEY, doc.new_string(source).map_err(err)?).map_err(err)?;

    let bl = blocks(source);
    let mut missing = Vec::new();
    let mut fonts: Vec<Fonts> = Vec::new();
    for name in NAMES {
        let text: String = bl.iter().filter(|b| font_of(&b.kind).0 == name).map(|b| b.text.as_str()).chain(["•0123456789."]).collect();
        fonts.push(substitute(doc, &page, name, &text, &mut missing).map_err(err)?);
    }
    let fnt = |name: &str| &fonts[NAMES.iter().position(|n| *n == name).unwrap_or(0)];

    // Satz in App-Koordinaten (y nach unten); Hintergründe sammeln, Höhe steht erst am Ende fest
    let mut y = MARGIN;
    let mut runs: Vec<(Vec<SetLine>, &'static str, f32, [f32; 3])> = Vec::new();
    let mut shapes: Vec<(&str, [f32; 4])> = Vec::new(); // ("bg"/"bar"/"rule", [x0,y0,x1,y1])
    for (i, b) in bl.iter().enumerate() {
        let (name, size) = font_of(&b.kind);
        let fo = fnt(name);
        let lh = 1.35 * size;
        let space = fo.map.get(&' ').map_or(0.27 * size, |g| g.width / 1000.0 * size);
        let measure = |w: &str| w.chars().filter_map(|c| fo.map.get(&c)).map(|g| g.width / 1000.0 * size).sum::<f32>();
        if matches!(b.kind, Kind::Head(_)) && i > 0 {
            y += 0.6 * size;
        }
        let (x, color) = match &b.kind {
            Kind::Item { level, .. } => (MARGIN + 18.0 * (*level as f32 + 1.0), [0.0; 3]),
            Kind::Quote => (MARGIN + 12.0, [0.3; 3]),
            Kind::Code => (MARGIN + 6.0, [0.0; 3]),
            _ => (MARGIN, [0.0; 3]),
        };
        let width = PAGE_W - MARGIN - x;
        let mut lines: Vec<SetLine> = Vec::new();
        match &b.kind {
            Kind::Rule => {
                shapes.push(("rule", [MARGIN, y + 6.0, PAGE_W - MARGIN, y + 6.0]));
                y += 12.0;
                continue;
            }
            Kind::Code => {
                // je Codezeile eigener Umbruch, Einrückung als Versatz der ersten Teilzeile
                for cl in b.text.split('\n') {
                    let lead = cl.chars().take_while(|&c| c == ' ').count() as f32 * space;
                    for (words, gap, ind) in reflow(cl, width, lead, space, false, measure) {
                        lines.push(SetLine { words, gap, x: x + ind, base: 0.0 });
                    }
                }
            }
            _ => {
                for (words, gap, ind) in reflow(&b.text, width, 0.0, space, false, measure) {
                    lines.push(SetLine { words, gap, x: x + ind, base: 0.0 });
                }
            }
        }
        let top = y;
        for (n, l) in lines.iter_mut().enumerate() {
            l.base = top + n as f32 * lh + size;
        }
        let bottom = top + lines.len().max(1) as f32 * lh;
        match &b.kind {
            Kind::Code => shapes.push(("bg", [MARGIN, top - 3.0, PAGE_W - MARGIN, bottom + 3.0])),
            Kind::Quote => shapes.push(("bar", [MARGIN, top, MARGIN + 2.0, bottom])),
            Kind::Item { marker, level } => {
                let mx = MARGIN + 18.0 * *level as f32 + if marker == "•" { 6.0 } else { 0.0 };
                runs.push((vec![SetLine { words: vec![marker.clone()], gap: space, x: mx, base: top + size }], name, size, color));
            }
            _ => {}
        }
        runs.push((lines, name, size, color));
        y = bottom + if matches!(b.kind, Kind::Code) { 0.9 } else { 0.5 } * size;
    }

    let mut notes = Vec::new();
    let need = y + MARGIN;
    let h = if need > MAX_HEIGHT {
        notes.push("Markdown-Seite zu lang: Ende abgeschnitten – auf mehrere Seiten aufteilen".to_string());
        MAX_HEIGHT
    } else {
        need.max(842.0)
    };
    if !missing.is_empty() {
        notes.push(format!("Zeichen fehlen in der Schrift: {}", missing.iter().collect::<String>()));
    }

    let mut s = String::new();
    for (k, r) in &shapes {
        let (x0, y0, x1, y1) = (r[0], h - r[3], r[2], h - r[1]);
        s += &match *k {
            "bg" => format!("0.94 g {} {} {} {} re f\n", f(x0), f(y0), f(x1 - x0), f(y1 - y0)),
            "bar" => format!("0.7 g {} {} {} {} re f\n", f(x0), f(y0), f(x1 - x0), f(y1 - y0)),
            _ => format!("0.7 G 0.8 w {} {} m {} {} l S\n", f(x0), f(y0), f(x1), f(y0)),
        };
    }
    let inv = Matrix::new(1.0, 0.0, 0.0, -1.0, 0.0, h);
    for (lines, name, size, color) in &runs {
        s += &emit(lines, fnt(name), *size, *color, &inv);
    }
    let mut mb = doc.new_array().map_err(err)?;
    for v in [0.0, 0.0, PAGE_W, h] {
        mb.array_push(doc.new_real(v).map_err(err)?).map_err(err)?;
    }
    obj.dict_put("MediaBox", mb).map_err(err)?;
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(fixed(&s).as_bytes()).map_err(err)?, None, false).map_err(err)?;
    obj.dict_put("Contents", stream).map_err(err)?;
    Ok((!notes.is_empty()).then(|| notes.join("; ")))
}

/// Lesezeichen, flach in Dokumentreihenfolge; `level` 0 = oberste Ebene, `page` −1 = kein (internes) Ziel.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Mark {
    pub title: String,
    pub page: i32,
    pub level: u32,
}

pub fn outline(doc: &PdfDocument) -> Result<Vec<Mark>, String> {
    fn walk(o: &[mupdf::Outline], level: u32, out: &mut Vec<Mark>) {
        for e in o {
            let page = e.dest.as_ref().map_or(-1, |d| d.loc.page_number as i32);
            out.push(Mark { title: e.title.clone(), page, level });
            walk(&e.down, level + 1, out);
        }
    }
    let mut out = Vec::new();
    walk(&doc.outlines().map_err(err)?, 0, &mut out);
    Ok(out)
}

/// `/Outlines` komplett neu aufbauen (leer → entfernen).
// ponytail: Einträge mit externem Link (URI) verlieren beim Neuschreiben ihre Aktion; erst nötig, wenn jemand das nutzt
pub fn set_outline(doc: &mut PdfDocument, marks: &[Mark]) -> Result<(), String> {
    let count = doc.page_count().map_err(err)?;
    if marks.len() > 5000 {
        return Err("zu viele Lesezeichen".into());
    }
    let mut prev: i64 = -1;
    for m in marks {
        let ok = i64::from(m.level) <= prev + 1 && m.level <= 20 && m.title.chars().count() <= 500 && !m.title.contains('\0') && (-1..count).contains(&m.page);
        if !ok {
            return Err(format!("ungültiges Lesezeichen: {}", m.title));
        }
        prev = i64::from(m.level);
    }
    let mut cat = doc.catalog().map_err(err)?;
    if marks.is_empty() {
        return cat.dict_delete("Outlines").map_err(err);
    }
    let mut root = doc.add_object(&doc.new_dict().map_err(err)?).map_err(err)?;
    root.dict_put("Type", doc.new_name("Outlines").map_err(err)?).map_err(err)?;
    let mut nodes: Vec<PdfObject> = Vec::new();
    let mut parent: Vec<Option<usize>> = Vec::new();
    let mut path: Vec<usize> = Vec::new();
    for (i, m) in marks.iter().enumerate() {
        let mut n = doc.add_object(&doc.new_dict().map_err(err)?).map_err(err)?;
        n.dict_put("Title", doc.new_string(&m.title).map_err(err)?).map_err(err)?;
        if m.page >= 0 {
            let mut dest = doc.new_array().map_err(err)?;
            dest.array_push(doc.find_page(m.page).map_err(err)?).map_err(err)?;
            dest.array_push(doc.new_name("Fit").map_err(err)?).map_err(err)?;
            n.dict_put("Dest", dest).map_err(err)?;
        }
        path.truncate(m.level as usize);
        parent.push(path.last().copied());
        path.push(i);
        nodes.push(n);
    }
    // Nachkommen je Knoten (rückwärts aufsummiert) → positives /Count = aufgeklappt
    let mut desc = vec![0i32; marks.len()];
    for i in (0..marks.len()).rev() {
        if let Some(p) = parent[i] {
            desc[p] += 1 + desc[i];
        }
    }
    let group = |p: Option<usize>| (0..marks.len()).filter(|&i| parent[i] == p).collect::<Vec<_>>();
    for p in std::iter::once(None).chain((0..marks.len()).map(Some)) {
        let kids = group(p);
        let (Some(&first), Some(&last)) = (kids.first(), kids.last()) else { continue };
        let mut up = match p {
            Some(i) => nodes[i].clone(),
            None => root.clone(),
        };
        up.dict_put("First", nodes[first].clone()).map_err(err)?;
        up.dict_put("Last", nodes[last].clone()).map_err(err)?;
        let c = match p {
            Some(i) => desc[i],
            None => marks.len() as i32,
        };
        up.dict_put("Count", doc.new_int(c).map_err(err)?).map_err(err)?;
        for (j, &k) in kids.iter().enumerate() {
            let mut n = nodes[k].clone();
            n.dict_put("Parent", up.clone()).map_err(err)?;
            if j > 0 {
                n.dict_put("Prev", nodes[kids[j - 1]].clone()).map_err(err)?;
            }
            if let Some(&nx) = kids.get(j + 1) {
                n.dict_put("Next", nodes[nx].clone()).map_err(err)?;
            }
        }
    }
    cat.dict_put("Outlines", root).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(pages: i32) -> PdfDocument {
        let mut d = PdfDocument::new();
        for _ in 0..pages {
            d.new_page(Size::A4).unwrap();
        }
        d
    }

    fn reopen(d: &PdfDocument) -> PdfDocument {
        PdfDocument::from_bytes(&crate::pdf::to_bytes(d).unwrap()).unwrap()
    }

    #[test]
    fn vorlagen_nicht_waehlbar() {
        for t in [Template::Lined, Template::Grid, Template::Dots] {
            let mut d = doc(1);
            template(&mut d, 0, t).unwrap();
            let d = reopen(&d);
            assert!(crate::orig::contents(&d.load_pdf_page(0).unwrap()).unwrap().len() > 100, "{t:?}");
            assert_eq!(crate::orig::boxes(&d, 0).unwrap(), Vec::<[f32; 4]>::new(), "{t:?}");
        }
        // außerhalb der Markierung bleibt alles wählbar
        assert!(template_ops(Template::Lined, 595.0, 842.0).contains(" l S"));
    }

    #[test]
    fn markdown_bloecke() {
        let b = blocks("# Titel\nText eins\nweiter\n\n- a\n  - b **fett**\n1. c\n\n> zitat\n---\n```\n  code x\n```");
        let k: Vec<_> = b.iter().map(|b| (&b.kind, b.text.as_str())).collect();
        assert_eq!(k[0], (&Kind::Head(1), "Titel"));
        assert_eq!(k[1], (&Kind::Para, "Text eins weiter"));
        assert_eq!(k[2], (&Kind::Item { marker: "•".into(), level: 0 }, "a"));
        assert_eq!(k[3], (&Kind::Item { marker: "•".into(), level: 1 }, "b fett"));
        assert_eq!(k[4], (&Kind::Item { marker: "1.".into(), level: 0 }, "c"));
        assert_eq!(k[5], (&Kind::Quote, "zitat"));
        assert_eq!(k[6].0, &Kind::Rule);
        assert_eq!(k[7], (&Kind::Code, "  code x"));
    }

    #[test]
    fn markdown_seite() {
        let mut d = doc(1);
        let src = "# Überschrift\n\nAbsatz mit Umlauten äöü und €.\n\n- Punkt eins\n";
        assert_eq!(render(&mut d, 1, src, true).unwrap(), None);
        assert_eq!(d.page_count().unwrap(), 2);
        let d2 = reopen(&d);
        assert_eq!(markdown(&d2, 1).unwrap().as_deref(), Some(src));
        assert_eq!(markdown(&d2, 0).unwrap(), None);
        let t = &crate::pdf::page_texts(&d2).unwrap()[1];
        assert!(t.contains("Überschrift") && t.contains("Umlauten äöü") && t.contains("Punkt eins"), "{t}");
        // nicht wählbar, nicht als Original-Text bearbeitbar
        assert!(crate::orig::boxes(&d2, 1).unwrap().is_empty());
        assert!(crate::text::paragraphs(&d2, 1).unwrap().is_empty());
        // neu setzen: langer Text → Seite wächst, Quelltext ersetzt
        let mut d = d2;
        let long = "Zeile\n\n".repeat(120);
        render(&mut d, 1, &long, false).unwrap();
        let b = d.load_pdf_page(1).unwrap().bounds().unwrap();
        assert!(b.y1 - b.y0 > 842.0, "{b:?}");
        assert_eq!(markdown(&d, 1).unwrap().as_deref(), Some(long.as_str()));
        // nur Markdown-Seiten neu setzen; Grenzen
        assert!(render(&mut d, 0, "x", false).is_err());
        assert!(render(&mut d, 0, "a\0b", true).is_err());
        assert!(render(&mut d, 9, "x", true).is_err());
        assert!(render(&mut d, 1, &"x\n\n".repeat(3000), false).unwrap().unwrap().contains("zu lang"));
    }

    #[test]
    fn lesezeichen() {
        let mut d = doc(3);
        assert!(outline(&d).unwrap().is_empty());
        let m = |t: &str, page, level| Mark { title: t.into(), page, level };
        let marks = vec![m("Kapitel 1", 0, 0), m("Teil a", 1, 1), m("Tief", 2, 2), m("Teil b", -1, 1), m("Kapitel 2 – ü", 2, 0)];
        set_outline(&mut d, &marks).unwrap();
        assert_eq!(outline(&reopen(&d)).unwrap(), marks);
        // Ebene springt, Seite außerhalb
        assert!(set_outline(&mut d, &[m("x", 0, 1)]).is_err());
        assert!(set_outline(&mut d, &[m("x", 3, 0)]).is_err());
        assert_eq!(outline(&d).unwrap(), marks, "Fehler lässt Gliederung unverändert");
        set_outline(&mut d, &[]).unwrap();
        assert!(outline(&reopen(&d)).unwrap().is_empty());
    }

    #[test]
    fn neue_pdf() {
        let p = std::env::temp_dir().join("pdf-note-unit-neu.pdf");
        new_pdf(&p).unwrap();
        let d = crate::pdf::open(&p).unwrap();
        assert_eq!(d.page_count().unwrap(), 1);
        assert!(new_pdf(&p.with_extension("txt")).is_err());
        let _ = std::fs::remove_file(p);
    }
}
