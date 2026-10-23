//! PDF als Notizbuch: neue leere PDF, Seitenvorlagen, Markdown-Seiten, Lesezeichen.
//! Alles steckt in der PDF selbst (Seiteninhalt, Seiten-Dictionary, `/Outlines`), keine Zusatzdateien.

use crate::text::{hex, substitute, Fonts};
use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::{Error, Size};
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
    crate::pdf::save_atomic(&d, path, crate::pdf::Crypt::Keep)
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
    /// `$$…$$`, Text = TeX
    Math,
    /// Zellen roh; `align` je Spalte `l`/`c`/`r`; `head` = erste Zeile ist Kopf (Trennzeile vorhanden)
    Table { rows: Vec<Vec<String>>, align: Vec<u8>, head: bool },
}

#[derive(Debug)]
struct Block {
    kind: Kind,
    text: String,
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

/// Tabellenzeile `| a | b |` → Zellen; `\|` = senkrechter Strich im Text.
fn cells(line: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut esc = false;
    for c in line.trim().trim_start_matches('|').chars() {
        match c {
            '|' if !esc => out.push(String::new()),
            '\\' if !esc => esc = true,
            _ => {
                if esc && c != '|' {
                    out.last_mut().unwrap().push('\\');
                }
                esc = false;
                out.last_mut().unwrap().push(c);
            }
        }
    }
    if out.len() > 1 && out.last().is_some_and(|c| c.trim().is_empty()) {
        out.pop();
    }
    out.iter().map(|c| c.trim().to_string()).collect()
}

/// Trennzeile `|---|:--:|` → Ausrichtung je Spalte.
fn separator(row: &[String]) -> Option<Vec<u8>> {
    row.iter()
        .map(|c| {
            let core = c.trim_start_matches(':').trim_end_matches(':');
            (!core.is_empty() && core.chars().all(|x| x == '-')).then(|| match (c.starts_with(':'), c.ends_with(':')) {
                (true, true) => b'c',
                (false, true) => b'r',
                _ => b'l',
            })
        })
        .collect()
}

/// Minimaler Block-Parser: Überschriften, Absätze, Listen, Code-Blöcke, Zitate, Trennlinien, Formelblöcke, Tabellen.
/// Formelblöcke müssen zu `extract` in `src/math.ts` passen (sonst roh als Code).
fn blocks(src: &str) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let mut code: Option<Vec<String>> = None;
    let mut math: Option<Vec<String>> = None;
    let tex = |m: Vec<String>| m.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
    // Absatz/Listenpunkt/Zitat/Tabelle kann in der nächsten Zeile weitergehen
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
        if let Some(m) = math.as_mut() {
            match line.strip_suffix("$$") {
                Some(p) => {
                    m.push(p.trim().into());
                    out.push(Block { kind: Kind::Math, text: tex(math.take().unwrap_or_default()) });
                }
                None => m.push(line.into()),
            }
            continue;
        }
        if line.starts_with("```") {
            code = Some(Vec::new());
            open = false;
            continue;
        }
        if line.is_empty() {
            open = false;
            continue;
        }
        if let Some(rest) = line.strip_prefix("$$") {
            open = false;
            match rest.strip_suffix("$$") {
                Some(t) => out.push(Block { kind: Kind::Math, text: t.trim().into() }),
                None => math = Some(vec![rest.trim().into()]),
            }
            continue;
        }
        let hashes = line.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
            out.push(Block { kind: Kind::Head(hashes), text: line[hashes..].trim().into() });
            open = false;
            continue;
        }
        if line.len() >= 3 && ["-", "*", "_"].iter().any(|c| line.chars().all(|x| x.to_string() == *c || x == ' ')) {
            out.push(Block { kind: Kind::Rule, text: String::new() });
            open = false;
            continue;
        }
        if line.starts_with('|') {
            let row = cells(line);
            match out.last_mut() {
                Some(Block { kind: Kind::Table { rows, align, head }, .. }) if open => match separator(&row) {
                    Some(a) if rows.len() == 1 && !*head => {
                        *align = a;
                        *head = true;
                    }
                    _ => rows.push(row),
                },
                _ => out.push(Block { kind: Kind::Table { rows: vec![row], align: Vec::new(), head: false }, text: String::new() }),
            }
            open = true;
            continue;
        }
        if let Some(q) = line.strip_prefix('>') {
            let q = q.trim();
            match out.last_mut() {
                Some(b) if open && b.kind == Kind::Quote => b.text = format!("{} {q}", b.text),
                _ => out.push(Block { kind: Kind::Quote, text: q.into() }),
            }
            open = true;
            continue;
        }
        let indent = raw.replace('\t', "    ").chars().take_while(|&c| c == ' ').count();
        if let Some((marker, rest)) = list_marker(line) {
            out.push(Block { kind: Kind::Item { marker, level: (indent / 2).min(6) }, text: rest.into() });
            open = true;
            continue;
        }
        match out.last_mut() {
            Some(b) if open && matches!(b.kind, Kind::Para | Kind::Item { .. } | Kind::Quote) => b.text = format!("{} {line}", b.text),
            _ => out.push(Block { kind: Kind::Para, text: line.into() }),
        }
        open = true;
    }
    if let Some(c) = code {
        out.push(Block { kind: Kind::Code, text: c.join("\n") });
    }
    if let Some(m) = math {
        out.push(Block { kind: Kind::Math, text: tex(m) });
    }
    out
}

/// Formel aus dem Frontend (MathJax → PDF-Pfade): Maße in 1/1000 em, `h` über / `d` unter der Grundlinie,
/// `ops` = Pfadoperatoren (y nach oben, Ursprung auf der Grundlinie).
#[derive(Deserialize, Debug, Clone, Default)]
pub struct Formula {
    pub tex: String,
    pub display: bool,
    pub w: f32,
    pub h: f32,
    pub d: f32,
    pub ops: String,
}

impl Formula {
    /// Landet ungeprüft im Content-Stream → nur Zahlen und Pfadoperatoren.
    fn valid(&self) -> bool {
        let num = |v: f32| v.is_finite() && v.abs() <= 1e6;
        num(self.w)
            && num(self.h)
            && num(self.d)
            && self.w >= 0.0
            && self.ops.len() <= 2_000_000
            && self.ops.split_ascii_whitespace().all(|t| matches!(t, "m" | "l" | "c" | "h" | "re" | "f") || (t.bytes().all(|b| b == b'-' || b == b'.' || b.is_ascii_digit()) && t.parse::<f32>().is_ok_and(num)))
    }
}

const PAGE_W: f32 = 595.0;
const MARGIN: f32 = 56.0;
const FONTS: [&str; 5] = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Courier"];
const COURIER: usize = 4;
const LINK: [f32; 3] = [0.05, 0.3, 0.75];

#[derive(Clone, Copy, Default, PartialEq)]
struct Style {
    bold: bool,
    italic: bool,
    code: bool,
}

fn font_ix(st: Style) -> usize {
    if st.code {
        COURIER
    } else {
        st.bold as usize + 2 * st.italic as usize
    }
}

fn style_of(k: &Kind) -> (Style, f32) {
    let d = Style::default();
    match k {
        Kind::Head(n) => (Style { bold: true, ..d }, [22.0, 18.0, 15.0].get(n - 1).copied().unwrap_or(13.0)),
        Kind::Code => (Style { code: true, ..d }, 10.0),
        Kind::Quote => (Style { italic: true, ..d }, 11.0),
        _ => (d, 11.0),
    }
}

/// Textstück: Schrift (Index in `FONTS`) + Text, oder Formel (Index in `Cx.math`).
#[derive(Clone)]
struct Piece {
    font: usize,
    text: String,
    link: Option<usize>,
    code: bool,
    math: Option<usize>,
}

type Word = Vec<Piece>;

struct Cx<'a> {
    math: Vec<&'a Formula>,
    links: Vec<String>,
}

impl Cx<'_> {
    fn find(&self, tex: &str, display: bool) -> Option<usize> {
        self.math.iter().position(|f| f.tex == tex && f.display == display)
    }
}

fn text_piece(st: Style, text: String, link: Option<usize>) -> Piece {
    Piece { font: font_ix(st), text, link, code: st.code, math: None }
}

/// Inline-Auszeichnung → Wörter (Stücke ohne Leerraum dazwischen). `**`/`__` fett, `*`/`_` kursiv, `` ` `` Code,
/// `[Text](URL)`, `$TeX$`, `\` maskiert. Formel-Regel (`$` bis zum nächsten `$`) muss zu `src/math.ts` passen.
fn inline(s: &str, base: Style, cx: &mut Cx) -> Vec<Word> {
    let mut runs: Vec<Piece> = Vec::new();
    inline_runs(s, base, None, cx, &mut runs);
    let mut out: Vec<Word> = Vec::new();
    let mut cur: Word = Vec::new();
    for r in runs {
        if r.math.is_some() {
            cur.push(r);
            continue;
        }
        for (n, part) in r.text.split(char::is_whitespace).enumerate() {
            if n > 0 && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            if !part.is_empty() {
                cur.push(Piece { text: part.into(), ..r.clone() });
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn inline_runs(s: &str, base: Style, link: Option<usize>, cx: &mut Cx, out: &mut Vec<Piece>) {
    let c: Vec<char> = s.chars().collect();
    let find = |from: usize, pat: &[char]| (from..c.len()).find(|&j| c[j..].starts_with(pat));
    let str_of = |a: usize, b: usize| c[a..b].iter().collect::<String>();
    let mut st = base;
    let mut buf = String::new();
    let flush = |buf: &mut String, st: Style, out: &mut Vec<Piece>| {
        if !buf.is_empty() {
            out.push(text_piece(st, std::mem::take(buf), link));
        }
    };
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let next = c.get(i + 1).copied();
        match ch {
            '\\' if next.is_some_and(|n| n.is_ascii_punctuation()) => {
                buf.push(next.unwrap_or(ch));
                i += 2;
                continue;
            }
            '`' => {
                if let Some(j) = find(i + 1, &['`']) {
                    flush(&mut buf, st, out);
                    out.push(text_piece(Style { code: true, ..st }, str_of(i + 1, j), link));
                    i = j + 1;
                    continue;
                }
            }
            '$' => {
                if let Some(j) = find(i + 1, &['$']) {
                    let tex = str_of(i + 1, j);
                    if tex.starts_with(|x: char| !x.is_whitespace()) && tex.ends_with(|x: char| !x.is_whitespace()) {
                        flush(&mut buf, st, out);
                        out.push(match cx.find(&tex, false) {
                            Some(k) => Piece { font: 0, text: String::new(), link, code: false, math: Some(k) },
                            None => text_piece(Style { code: true, ..st }, format!("${tex}$"), link),
                        });
                        i = j + 1;
                        continue;
                    }
                }
            }
            '*' | '_' => {
                let n = if next == Some(ch) { 2 } else { 1 };
                let prev = i.checked_sub(1).map(|p| c[p]);
                let after = c.get(i + n).copied();
                let intraword = ch == '_' && prev.is_some_and(char::is_alphanumeric) && after.is_some_and(char::is_alphanumeric);
                let on = if n == 2 { st.bold } else { st.italic };
                let tok = &c[i..i + n];
                let ok = !intraword
                    && if on { prev.is_some_and(|p| !p.is_whitespace()) } else { after.is_some_and(|a| !a.is_whitespace()) && find(i + n + 1, tok).is_some() };
                if ok {
                    flush(&mut buf, st, out);
                    if n == 2 {
                        st.bold = !st.bold;
                    } else {
                        st.italic = !st.italic;
                    }
                    i += n;
                    continue;
                }
                buf.extend(tok);
                i += n;
                continue;
            }
            '[' if link.is_none() => {
                if let Some(k) = find(i + 1, &[']', '(']) {
                    if let Some(e) = find(k + 2, &[')']) {
                        let url = str_of(k + 2, e);
                        if !url.is_empty() && !url.contains(char::is_whitespace) {
                            flush(&mut buf, st, out);
                            let lk = ["http://", "https://", "mailto:"].iter().any(|p| url.to_ascii_lowercase().starts_with(p)).then(|| {
                                cx.links.push(url);
                                cx.links.len() - 1
                            });
                            inline_runs(&str_of(i + 1, k), st, lk, cx, out);
                            i = e + 1;
                            continue;
                        }
                    }
                }
            }
            _ => {}
        }
        buf.push(ch);
        i += 1;
    }
    flush(&mut buf, st, out);
}

/// Inhalt eines Blocks nach dem Inline-Parsen (vor dem Umbruch, damit die Schriften vorher feststehen).
enum Body {
    Words(Vec<Word>),
    /// Codezeilen, Leerzeichen bleiben erhalten
    Code(Vec<String>),
    Math(usize),
    Table { cells: Vec<Vec<Vec<Word>>>, align: Vec<u8>, head: bool },
    Rule,
}

struct Item {
    x: f32,
    w: f32,
    /// Schriftgröße bzw. em der Formel
    size: f32,
    p: Piece,
    /// Leerzeichen-Glyph anhängen (Kopieren/Suchen)
    sp: bool,
}

#[derive(Default)]
struct Line {
    items: Vec<Item>,
}

impl Line {
    fn width(&self) -> f32 {
        self.items.last().map_or(0.0, |i| i.x + i.w)
    }
}

struct Laid<'a> {
    cx: &'a Cx<'a>,
    fonts: &'a [Option<Fonts>],
    /// Text: (Schrift, Größe, Farbe, x, Grundlinie, Text)
    text: Vec<(usize, f32, [f32; 3], f32, f32, String)>,
    /// Formeln: (Index, em, Farbe, x, Grundlinie)
    math: Vec<(usize, f32, [f32; 3], f32, f32)>,
    /// Flächen (`fill`) bzw. Linien: ([x0,y0,x1,y1], Farbe, Linienbreite)
    shapes: Vec<([f32; 4], [f32; 3], Option<f32>)>,
    links: Vec<(usize, [f32; 4])>,
}

impl Laid<'_> {
    fn width(&self, p: &Piece, size: f32) -> f32 {
        if let Some(k) = p.math {
            return self.cx.math[k].w * size / 1000.0;
        }
        let Some(f) = &self.fonts[p.font] else { return 0.0 };
        p.text.chars().filter_map(|c| f.map.get(&c)).map(|g| g.width * size / 1000.0).sum()
    }

    fn space(&self, font: usize, size: f32) -> f32 {
        self.fonts[font].as_ref().and_then(|f| f.map.get(&' ')).map_or(0.27 * size, |g| g.width * size / 1000.0)
    }

    /// Greedy-Umbruch; zu lange Wörter stehen allein (ragen über).
    fn wrap(&self, words: &[Word], width: f32, size: f32, space: f32) -> Vec<Line> {
        let mut lines = vec![Line::default()];
        for w in words {
            let ww: f32 = w.iter().map(|p| self.width(p, size)).sum();
            let mut x = lines.last().map_or(0.0, Line::width);
            if x > 0.0 && x + space + ww > width {
                lines.push(Line::default());
                x = 0.0;
            }
            let cur = lines.last_mut().unwrap();
            if let Some(last) = cur.items.last_mut() {
                last.sp = true;
                x += space;
            }
            for p in w {
                let pw = self.width(p, size);
                cur.items.push(Item { x, w: pw, size, p: p.clone(), sp: false });
                x += pw;
            }
        }
        lines
    }

    /// Abstand Oberkante → Grundlinie und Grundlinie → Unterkante; Formeln dürfen die Zeile vergrößern.
    fn metrics(&self, l: &Line, size: f32) -> (f32, f32) {
        let m = l.items.iter().filter_map(|i| i.p.math.map(|k| (self.cx.math[k].h * i.size / 1000.0, self.cx.math[k].d * i.size / 1000.0)));
        m.fold((size, 0.35 * size), |(a, b), (h, d)| (a.max(h + 1.0), b.max(d + 1.0)))
    }

    fn put(&mut self, l: &Line, x0: f32, base: f32, color: [f32; 3]) {
        for it in &l.items {
            let x = x0 + it.x;
            if let Some(k) = it.p.math {
                self.math.push((k, it.size, color, x, base));
                continue;
            }
            let s = it.size;
            if it.p.code {
                self.shapes.push(([x - 1.0, base - 0.8 * s, x + it.w + 1.0, base + 0.25 * s], [0.93; 3], None));
            }
            let col = if it.p.link.is_some() { LINK } else { color };
            if let Some(k) = it.p.link {
                self.shapes.push(([x, base + 1.5, x + it.w, base + 1.5], LINK, Some(0.6)));
                self.links.push((k, [x, base - 0.85 * s, x + it.w + if it.sp { self.space(it.p.font, s) } else { 0.0 }, base + 0.3 * s]));
            }
            self.text.push((it.p.font, s, col, x, base, if it.sp { format!("{} ", it.p.text) } else { it.p.text.clone() }));
        }
    }

    /// Zeilen ab `y` untereinander setzen, Rückgabe = Unterkante.
    fn stack(&mut self, lines: &[Line], x0: f32, y: f32, size: f32, color: [f32; 3]) -> f32 {
        let mut y = y;
        for l in lines {
            let (a, b) = self.metrics(l, size);
            self.put(l, x0, y + a, color);
            y += a + b;
        }
        y
    }
}

/// Markdown-Seite setzen: `insert` → neue A4-Seite bei `index`, sonst bestehende Markdown-Seite neu setzen.
/// Die Oberkante der Seite bleibt beim Neusetzen fest → Striche/Objekte behalten ihre Lage zum Text.
/// Rückgabe = Hinweis (zu lang, fehlende Zeichen, Objekte unterhalb des Seitenendes).
pub fn render(doc: &mut PdfDocument, index: i32, source: &str, insert: bool, formulas: &[Formula]) -> Result<Option<String>, String> {
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
    let top = match obj.get_dict_inheritable("MediaBox").map_err(err)? {
        Some(mb) if !insert => mb.get_array(3).map_err(err)?.map_or(Ok(842.0), |v| v.as_float()).map_err(err)?,
        _ => 842.0,
    };
    // alter Satz/alte Ressourcen/eigene URL-Links weg, Ersatzschriften landen in frischen Ressourcen
    obj.dict_put("Resources", doc.new_dict().map_err(err)?).map_err(err)?;
    obj.dict_delete("CropBox").map_err(err)?;
    obj.dict_delete("Rotate").map_err(err)?;
    obj.dict_put(MD_KEY, doc.new_string(source).map_err(err)?).map_err(err)?;
    // `PdfObject::clone` kopiert tief → Annots jeweils frisch holen
    if let Some(mut a) = annots_of(&obj).map_err(err)? {
        for i in (0..a.len().map_err(err)? as i32).rev() {
            if annot_is(&a, i, true).map_err(err)? {
                a.array_delete(i).map_err(err)?;
            }
        }
    }

    let mut cx = Cx { math: formulas.iter().filter(|f| f.valid()).take(5000).collect(), links: Vec::new() };
    let bl = blocks(source);
    let mut bodies = Vec::new();
    for b in &bl {
        let (st, _) = style_of(&b.kind);
        bodies.push(match &b.kind {
            Kind::Rule => Body::Rule,
            Kind::Code => Body::Code(b.text.split('\n').map(String::from).collect()),
            Kind::Math => match cx.find(&b.text, true) {
                Some(k) => Body::Math(k),
                None => Body::Code(std::iter::once("$$").chain(b.text.lines()).chain(["$$"]).map(String::from).collect()),
            },
            Kind::Table { rows, align, head } => {
                let cells = rows.iter().enumerate().map(|(r, row)| row.iter().map(|c| inline(c, Style { bold: *head && r == 0, ..st }, &mut cx)).collect()).collect();
                Body::Table { cells, align: align.clone(), head: *head }
            }
            _ => Body::Words(inline(&b.text, st, &mut cx)),
        });
    }

    // Schriften nur einbetten, wenn benutzt (Helvetica immer: Listenzeichen)
    let mut texts = vec![String::from("•0123456789."), String::new(), String::new(), String::new(), String::new()];
    for b in &bodies {
        let words: Vec<&Word> = match b {
            Body::Words(ws) => ws.iter().collect(),
            Body::Table { cells, .. } => cells.iter().flatten().flatten().collect(),
            Body::Code(ls) => {
                ls.iter().for_each(|l| texts[COURIER] += l);
                continue;
            }
            _ => continue,
        };
        words.into_iter().flatten().filter(|p| p.math.is_none()).for_each(|p| texts[p.font] += &p.text);
    }
    let mut missing = Vec::new();
    let mut fonts: Vec<Option<Fonts>> = Vec::new();
    for (name, text) in FONTS.iter().zip(&texts) {
        fonts.push(if text.is_empty() { None } else { Some(substitute(doc, &page, name, text, &mut missing).map_err(err)?) });
    }

    // Satz in App-Koordinaten (y nach unten ab Oberkante), Höhe steht erst am Ende fest
    let mut ly = Laid { cx: &cx, fonts: &fonts, text: Vec::new(), math: Vec::new(), shapes: Vec::new(), links: Vec::new() };
    let mut y = MARGIN;
    for (i, (b, body)) in bl.iter().zip(&bodies).enumerate() {
        let (st, size) = style_of(&b.kind);
        let font = font_ix(st);
        let space = ly.space(font, size);
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
        let top_y = y;
        match body {
            Body::Rule => {
                ly.shapes.push(([MARGIN, y + 6.0, PAGE_W - MARGIN, y + 6.0], [0.7; 3], Some(0.8)));
                y += 12.0;
                continue;
            }
            Body::Code(ls) => {
                let (size, x) = (10.0, MARGIN + 6.0);
                // Courier: alle Zeichen 600/1000 em → Umbruch nach Zeichenzahl
                let per = ((PAGE_W - MARGIN - x) / (0.6 * size)).floor().max(1.0) as usize;
                let mut lines = Vec::new();
                for l in ls {
                    let ch: Vec<char> = l.chars().collect();
                    if ch.is_empty() {
                        lines.push(Line::default());
                    }
                    for part in ch.chunks(per) {
                        let p = Piece { font: COURIER, text: part.iter().collect(), link: None, code: false, math: None };
                        lines.push(Line { items: vec![Item { x: 0.0, w: part.len() as f32 * 0.6 * size, size, p, sp: false }] });
                    }
                }
                let bottom = ly.stack(&lines, x, y, size, color);
                ly.shapes.push(([MARGIN, top_y - 3.0, PAGE_W - MARGIN, bottom + 3.0], [0.94; 3], None));
                y = bottom + 0.9 * size;
                continue;
            }
            Body::Math(k) => {
                let f = cx.math[*k];
                let mut em = 13.0;
                if f.w * em / 1000.0 > width {
                    em = width * 1000.0 / f.w;
                }
                let w = f.w * em / 1000.0;
                let p = Piece { font: 0, text: String::new(), link: None, code: false, math: Some(*k) };
                let l = Line { items: vec![Item { x: 0.0, w, size: em, p, sp: false }] };
                y = ly.stack(&[l], MARGIN + (width - w) / 2.0, y + 0.3 * size, size, color) + 0.8 * size;
                continue;
            }
            Body::Table { cells, align, head } => {
                let ncol = cells.iter().map(Vec::len).max().unwrap_or(0);
                let pad = 4.0;
                let natural = |c: usize| {
                    cells.iter().filter_map(|r| r.get(c)).map(|ws| ws.iter().map(|w| w.iter().map(|p| ly.width(p, size)).sum::<f32>() + space).sum::<f32>()).fold(0.0, f32::max) + 2.0 * pad
                };
                let nat: Vec<f32> = (0..ncol).map(natural).collect();
                let total: f32 = nat.iter().sum();
                let cols: Vec<f32> = if total <= width { nat } else { nat.iter().map(|n| n * width / total).collect() };
                let tw: f32 = cols.iter().sum();
                ly.shapes.push(([MARGIN, y, MARGIN + tw, y], [0.6; 3], Some(0.6)));
                for (r, row) in cells.iter().enumerate() {
                    let mut bottom = y + pad;
                    let mut cx0 = MARGIN;
                    for (c, cw) in cols.iter().enumerate() {
                        if let Some(ws) = row.get(c) {
                            let lines = ly.wrap(ws, cw - 2.0 * pad, size, space);
                            let mut yy = y + pad;
                            for l in &lines {
                                let slack = cw - 2.0 * pad - l.width();
                                let dx = match align.get(c) {
                                    Some(b'r') => slack,
                                    Some(b'c') => slack / 2.0,
                                    _ => 0.0,
                                };
                                yy = ly.stack(std::slice::from_ref(l), cx0 + pad + dx.max(0.0), yy, size, color);
                            }
                            bottom = bottom.max(yy);
                        }
                        cx0 += cw;
                    }
                    y = bottom + pad;
                    let w = if *head && r == 0 { 0.9 } else { 0.4 };
                    ly.shapes.push(([MARGIN, y, MARGIN + tw, y], [0.6; 3], Some(w)));
                }
                let mut cx0 = MARGIN;
                for cw in std::iter::once(&0.0).chain(&cols) {
                    cx0 += cw;
                    ly.shapes.push(([cx0, top_y, cx0, y], [0.6; 3], Some(0.4)));
                }
                y += 0.8 * size;
                continue;
            }
            Body::Words(ws) => {
                let lines = ly.wrap(ws, width, size, space);
                let bottom = ly.stack(&lines, x, y, size, color);
                match &b.kind {
                    Kind::Quote => ly.shapes.push(([MARGIN, top_y, MARGIN + 2.0, bottom], [0.7; 3], None)),
                    Kind::Item { marker, level } => {
                        let mx = MARGIN + 18.0 * *level as f32 + if marker == "•" { 6.0 } else { 0.0 };
                        let a = lines.first().map_or(size, |l| ly.metrics(l, size).0);
                        ly.text.push((0, size, color, mx, top_y + a, marker.clone()));
                    }
                    _ => {}
                }
                y = bottom + 0.5 * size;
            }
        }
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
    let bottom = top - h;
    if let Some(a) = annots_of(&obj).map_err(err)? {
        if below(&a, bottom).map_err(err)? {
            notes.push("Objekte liegen unterhalb des Seitenendes".to_string());
        }
    }

    // App-y → PDF-y
    let py = |v: f32| top - v;
    let mut s = String::new();
    for (r, c, lw) in &ly.shapes {
        s += &match lw {
            None => format!("{} {} {} rg {} {} {} {} re f\n", c[0], c[1], c[2], f(r[0]), f(py(r[3])), f(r[2] - r[0]), f(r[3] - r[1])),
            Some(w) => format!("{} {} {} RG {w} w {} {} m {} {} l S\n", c[0], c[1], c[2], f(r[0]), f(py(r[1])), f(r[2]), f(py(r[3]))),
        };
    }
    s += "BT\n";
    for (font, size, c, x, base, text) in &ly.text {
        let Some(fo) = &fonts[*font] else { continue };
        let glyphs: Vec<_> = text.chars().filter_map(|ch| fo.map.get(&ch)).collect();
        let Some(g0) = glyphs.first() else { continue };
        let codes: String = glyphs.iter().map(|g| hex(&g.code)).collect();
        s += &format!("{} {} {} rg /{} {size} Tf 1 0 0 1 {} {} Tm [<{codes}>] TJ\n", c[0], c[1], c[2], fo.keys[g0.key], f(*x), f(py(*base)));
    }
    s += "ET\n";
    for (k, em, c, x, base) in &ly.math {
        let sc = em / 1000.0;
        s += &format!("q {} {} {} rg {sc} 0 0 {sc} {} {} cm\n{}\nQ\n", c[0], c[1], c[2], f(*x), f(py(*base)), cx.math[*k].ops);
    }
    let mut mb = doc.new_array().map_err(err)?;
    for v in [0.0, bottom, PAGE_W, top] {
        mb.array_push(doc.new_real(v).map_err(err)?).map_err(err)?;
    }
    obj.dict_put("MediaBox", mb).map_err(err)?;
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(fixed(&s).as_bytes()).map_err(err)?, None, false).map_err(err)?;
    obj.dict_put("Contents", stream).map_err(err)?;
    for (k, r) in &ly.links {
        if r[1] > h {
            continue;
        }
        let mut a = doc.new_dict().map_err(err)?;
        a.dict_put("S", doc.new_name("URI").map_err(err)?).map_err(err)?;
        a.dict_put("URI", doc.new_string(&cx.links[*k]).map_err(err)?).map_err(err)?;
        let mut l = doc.new_dict().map_err(err)?;
        l.dict_put("Type", doc.new_name("Annot").map_err(err)?).map_err(err)?;
        l.dict_put("Subtype", doc.new_name("Link").map_err(err)?).map_err(err)?;
        let mut rect = doc.new_array().map_err(err)?;
        for v in [r[0], py(r[3]), r[2], py(r[1])] {
            rect.array_push(doc.new_real(v).map_err(err)?).map_err(err)?;
        }
        l.dict_put("Rect", rect).map_err(err)?;
        let mut border = doc.new_array().map_err(err)?;
        for _ in 0..3 {
            border.array_push(doc.new_int(0).map_err(err)?).map_err(err)?;
        }
        l.dict_put("Border", border).map_err(err)?;
        l.dict_put("A", a).map_err(err)?;
        let l = doc.add_object(&l).map_err(err)?;
        let mut arr = match annots_of(&obj).map_err(err)? {
            Some(a) => a,
            None => {
                obj.dict_put("Annots", doc.new_array().map_err(err)?).map_err(err)?;
                annots_of(&obj).map_err(err)?.ok_or("Annots fehlt")?
            }
        };
        arr.array_push(l).map_err(err)?;
    }
    Ok((!notes.is_empty()).then(|| notes.join("; ")))
}

fn annots_of(page: &PdfObject) -> Result<Option<PdfObject>, Error> {
    Ok(match page.get_dict("Annots")? {
        Some(a) => Some(a.resolve()?.unwrap_or(a)),
        None => None,
    })
}

/// Eintrag `i` ist ein Link (`uri` = nur URL-Links, wie sie der Markdown-Satz anlegt).
fn annot_is(annots: &PdfObject, i: i32, uri: bool) -> Result<bool, Error> {
    let Some(e) = annots.get_array(i)? else { return Ok(false) };
    let Some(e) = e.resolve()? else { return Ok(false) };
    let name = |o: Option<PdfObject>| -> Result<Vec<u8>, Error> { o.map_or(Ok(Vec::new()), |o| o.as_name().map(|n| n.to_vec())) };
    if name(e.get_dict("Subtype")?)? != b"Link" {
        return Ok(false);
    }
    Ok(!uri || name(e.get_dict("A")?.map(|a| a.get_dict("S")).transpose()?.flatten())? == b"URI")
}

/// Liegt eine Annotation (außer Links) ganz oder teilweise unter `bottom` (PDF-y)?
fn below(annots: &PdfObject, bottom: f32) -> Result<bool, Error> {
    for i in 0..annots.len()? as i32 {
        let Some(e) = annots.get_array(i)? else { continue };
        let Some(e) = e.resolve()? else { continue };
        if annot_is(annots, i, false)? {
            continue;
        }
        let Some(r) = e.get_dict("Rect")? else { continue };
        let y = |k| r.get_array(k).ok().flatten().and_then(|v| v.as_float().ok()).unwrap_or(f32::MAX);
        if y(1).min(y(3)) < bottom {
            return Ok(true);
        }
    }
    Ok(false)
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
        assert_eq!(k[3], (&Kind::Item { marker: "•".into(), level: 1 }, "b **fett**"));
        assert_eq!(k[4], (&Kind::Item { marker: "1.".into(), level: 0 }, "c"));
        assert_eq!(k[5], (&Kind::Quote, "zitat"));
        assert_eq!(k[6].0, &Kind::Rule);
        assert_eq!(k[7], (&Kind::Code, "  code x"));
    }

    #[test]
    fn markdown_seite() {
        let mut d = doc(1);
        let src = "# Überschrift\n\nAbsatz mit Umlauten äöü und €.\n\n- Punkt eins\n";
        assert_eq!(render(&mut d, 1, src, true, &[]).unwrap(), None);
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
        render(&mut d, 1, &long, false, &[]).unwrap();
        let b = d.load_pdf_page(1).unwrap().bounds().unwrap();
        assert!(b.y1 - b.y0 > 842.0, "{b:?}");
        assert_eq!(markdown(&d, 1).unwrap().as_deref(), Some(long.as_str()));
        // nur Markdown-Seiten neu setzen; Grenzen
        assert!(render(&mut d, 0, "x", false, &[]).is_err());
        assert!(render(&mut d, 0, "a\0b", true, &[]).is_err());
        assert!(render(&mut d, 9, "x", true, &[]).is_err());
        assert!(render(&mut d, 1, &"x\n\n".repeat(3000), false, &[]).unwrap().unwrap().contains("zu lang"));
    }

    fn formula(tex: &str, display: bool) -> Formula {
        Formula { tex: tex.into(), display, w: 2000.0, h: 700.0, d: 200.0, ops: "0 -200 m 2000 -200 l 2000 700 l 0 700 l h f".into() }
    }

    fn content(d: &PdfDocument, i: i32) -> String {
        String::from_utf8_lossy(&crate::orig::contents(&d.load_pdf_page(i).unwrap()).unwrap()).into_owned()
    }

    #[test]
    fn markdown_bloecke_formel_tabelle() {
        let b = blocks("$$\\frac{1}{2}$$\n$$\n\\begin{pmatrix} 1 & 2 \\\\\n 3 & 4 \\end{pmatrix}\n$$\n| A | B \\| C |\n|:-:|--:|\n| 1 | 2 |\n\n$$ offen");
        assert_eq!((&b[0].kind, b[0].text.as_str()), (&Kind::Math, "\\frac{1}{2}"));
        assert_eq!((&b[1].kind, b[1].text.as_str()), (&Kind::Math, "\\begin{pmatrix} 1 & 2 \\\\\n3 & 4 \\end{pmatrix}"));
        let rows = vec![vec!["A".to_string(), "B | C".into()], vec!["1".into(), "2".into()]];
        assert_eq!(b[2].kind, Kind::Table { rows, align: vec![b'c', b'r'], head: true });
        assert_eq!((&b[3].kind, b[3].text.as_str()), (&Kind::Math, "offen"));
    }

    #[test]
    fn markdown_inline() {
        let f = [formula("a^2", false)];
        let mut cx = Cx { math: f.iter().collect(), links: Vec::new() };
        let w = inline("**fett** *kursiv* `c d` snake_case_x $a^2$ $x$ \\*n\\* [hier](https://a.de) [lok](x.md) 5 * 3", Style::default(), &mut cx);
        let t = |w: &Word| w.iter().map(|p| if p.math.is_some() { "<M>".to_string() } else { format!("{}{}", p.font, p.text) }).collect::<String>();
        let got: Vec<String> = w.iter().map(t).collect();
        assert_eq!(got, ["1fett", "2kursiv", "4c", "4d", "0snake_case_x", "<M>", "4$x$", "0*n*", "0hier", "0lok", "05", "0*", "03"]);
        assert!(w[2][0].code && !w[0][0].code);
        assert_eq!(w[8][0].link, Some(0));
        assert_eq!(w[9][0].link, None);
        assert_eq!(cx.links, ["https://a.de"]);
    }

    #[test]
    fn formel_pruefung() {
        assert!(formula("x", false).valid());
        for ops in ["0 0 m Q", "1 0 0 1 0 0 cm", "0 0 m (x) Tj", "nan 0 m", "1e5 0 m", "+1 0 m"] {
            assert!(!Formula { ops: ops.into(), ..formula("x", false) }.valid(), "{ops}");
        }
        assert!(!Formula { w: f32::INFINITY, ..formula("x", false) }.valid());
        assert!(!Formula { w: -1.0, ..formula("x", false) }.valid());
    }

    #[test]
    fn markdown_formeln_format() {
        let src = "# Satz des Pythagoras\n\nEs gilt $a^2+b^2=c^2$ im **rechtwinkligen** Dreieck, *kursiv* und `code`.\n\n$$\\frac{a}{b}$$\n\n$$\\sum_{i=1}^n i$$\n\n$$\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n$$\n\n| Name | Wert |\n|---|---:|\n| Alpha | 1,5 |\n| Beta | **2** |\n\nKaputt: $\\frac{$ ende\n\n$$\\undefinedmacro$$\n";
        let fs = [
            formula("a^2+b^2=c^2", false),
            formula("\\frac{a}{b}", true),
            formula("\\sum_{i=1}^n i", true),
            formula("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", true),
            // ungültig → roh als Code
            Formula { ops: "0 0 m BT".into(), ..formula("\\undefinedmacro", true) },
        ];
        let mut d = doc(1);
        assert_eq!(render(&mut d, 1, src, true, &fs).unwrap(), None);
        let d = reopen(&d);
        let t = &crate::pdf::page_texts(&d).unwrap()[1];
        for w in ["Satz des Pythagoras", "Es gilt", "rechtwinkligen", "kursiv", "code", "Name", "Wert", "Alpha", "1,5", "Beta", "$\\frac{$", "$$", "\\undefinedmacro"] {
            assert!(t.contains(w), "{w} fehlt in {t}");
        }
        let c = content(&d, 1);
        // 4 gültige Formeln als Pfade, Tabelle mit Linien
        assert_eq!(c.matches("2000 700 l").count(), 4, "{c}");
        assert!(c.contains(" l S"));
        assert!(!c.contains("BT\n0 0 m"));
        assert_eq!(markdown(&d, 1).unwrap().as_deref(), Some(src));
        let fonts = d.load_pdf_page(1).unwrap().object().get_dict_inheritable("Resources").unwrap().unwrap().get_dict("Font").unwrap().unwrap();
        assert!(fonts.dict_len().unwrap() >= 4, "Normal, Fett, Kursiv, Courier");
    }

    #[test]
    fn markdown_vorschau_leeres_dokument() {
        // wie `markdown_preview`: Wegwerf-PDF ohne Seiten
        let mut d = PdfDocument::new();
        render(&mut d, 0, "# Titel\n\n$x$ und **fett**", true, &[formula("x", false)]).unwrap();
        assert_eq!(d.page_count().unwrap(), 1);
        assert!(crate::pdf::render_png(&d, 0, 1.0).unwrap().starts_with(b"\x89PNG"));
    }

    #[test]
    fn markdown_neu_setzen_oberkante_links() {
        let mut d = doc(1);
        render(&mut d, 1, &"Zeile\n\n".repeat(120), true, &[]).unwrap();
        let mb = |d: &PdfDocument| {
            let m = d.load_pdf_page(1).unwrap().object().get_dict_inheritable("MediaBox").unwrap().unwrap();
            [1, 3].map(|i| m.get_array(i).unwrap().unwrap().as_float().unwrap())
        };
        let [y0, top] = mb(&d);
        assert!(y0 < 0.0 && top == 842.0, "{y0} {top}");
        // Objekt ganz unten, dann kürzer setzen → Oberkante bleibt, Hinweis
        let mut a = d.new_dict().unwrap();
        a.dict_put("Subtype", d.new_name("Square").unwrap()).unwrap();
        let mut r = d.new_array().unwrap();
        for v in [10.0, y0 + 5.0, 20.0, y0 + 15.0] {
            r.array_push(d.new_real(v).unwrap()).unwrap();
        }
        a.dict_put("Rect", r).unwrap();
        let a = d.add_object(&a).unwrap();
        let mut arr = d.new_array().unwrap();
        arr.array_push(a).unwrap();
        d.load_pdf_page(1).unwrap().object().dict_put("Annots", arr).unwrap();
        let src = "Siehe [Web](https://example.org/a) und [lokal](datei.md).";
        let note = render(&mut d, 1, src, false, &[]).unwrap().unwrap();
        assert!(note.contains("unterhalb des Seitenendes"), "{note}");
        assert_eq!(mb(&d), [0.0, 842.0]);
        let d = reopen(&d);
        let uris = |d: &PdfDocument| crate::nav::links(d, 1).unwrap().into_iter().filter_map(|l| l.uri).collect::<Vec<_>>();
        assert_eq!(uris(&d), ["https://example.org/a"]);
        // neu setzen ersetzt eigene Links, fremde Annotation bleibt
        let mut d = d;
        render(&mut d, 1, "[Neu](https://example.org/b)", false, &[]).unwrap();
        assert_eq!(uris(&d), ["https://example.org/b"]);
        assert_eq!(annots_of(&d.load_pdf_page(1).unwrap().object()).unwrap().unwrap().len().unwrap(), 2);
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
