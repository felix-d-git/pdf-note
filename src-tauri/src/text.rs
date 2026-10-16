//! Original-Text bearbeiten: Absätze erkennen (gleiche Schrift + Zeilenabstand + linker Rand), alten Text per
//! Redaction entfernen (nur Text – Bilder/Vektoren bleiben), neuen Text im Absatz umbrechen und in einem eigenen
//! Textobjekt an dieselbe Stelle setzen. Schrift-Kaskade: 1. Original-Fontressourcen gleichen Namens, wenn sie alle
//! Zeichen haben → 2. eingebettete URW-Base-14-Ersatzschrift (passend Serif/Sans/Mono, Fett/Kursiv) + Hinweis.
use crate::orig::{contents, mul};
use mupdf::pdf::{PdfDocument, PdfObject, PdfPage, PdfRedactImageMethod, PdfRedactLineArtMethod, PdfRedactOptions, PdfRedactTextMethod};
use mupdf::{Error, Font, Matrix, Rect, Size, TextPageFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Eine Textzeile in App-Koordinaten (pt, Ursprung oben links).
#[derive(Debug, Clone)]
struct Line {
    bbox: [f32; 4],
    /// Grundlinie und Anfang der Zeile (Ursprung des ersten Zeichens)
    base: f32,
    x0: f32,
    font: String,
    size: f32,
    color: [f32; 3],
    /// Serif, Mono, Fett, Kursiv der Originalschrift – für die Ersatzschrift
    style: [bool; 4],
    text: String,
}

/// Absatz für das Frontend; `lines` nur intern.
#[derive(Serialize, Debug, Clone)]
pub struct Para {
    pub bbox: [f32; 4],
    pub text: String,
    pub font: String,
    pub size: f32,
    pub color: [f32; 3],
    #[serde(skip)]
    lines: Vec<Line>,
}

impl Para {
    fn left(&self) -> f32 {
        self.lines.get(1).unwrap_or(&self.lines[0]).x0
    }
    fn leading(&self) -> f32 {
        match &self.lines[..] {
            [a, b, ..] => b.base - a.base,
            _ => self.size * 1.2,
        }
    }
}

/// Untergruppen-Präfix „ABCDEF+" weg: Teilschriften desselben Fonts (Word: Type0 + TrueType) gehören zusammen.
fn font_name(n: &str) -> String {
    match n.split_once('+') {
        Some((p, rest)) if p.len() == 6 && p.bytes().all(|c| c.is_ascii_uppercase()) => rest.to_string(),
        _ => n.to_string(),
    }
}

/// Seitenraum der PDF → App-Koordinaten (wie `orig`).
pub(crate) fn base_matrix(page: &PdfPage) -> Result<Matrix, Error> {
    let b = page.bounds()?;
    Ok(mul(&page.ctm()?, &Matrix::new_translate(-b.x0, -b.y0)))
}

fn lines(page: &PdfPage) -> Result<Vec<Line>, Error> {
    let b = page.bounds()?;
    let (ox, oy) = (b.x0, b.y0);
    let mut out = Vec::new();
    for block in page.to_text_page(TextPageFlags::empty())?.blocks() {
        for l in block.lines() {
            let chars: Vec<_> = l.chars().collect();
            let (Some(first), Some(last)) = (chars.first(), chars.last()) else { continue };
            let (a, z) = (first.origin(), last.origin());
            // nur waagerechte Zeilen von links nach rechts (gedrehte Seiten/Text: nicht bearbeitbar)
            if (a.y - z.y).abs() > 0.5 || z.x < a.x {
                continue;
            }
            let mut count: HashMap<String, usize> = HashMap::new();
            for c in &chars {
                *count.entry(c.font().map(|f| font_name(f.name())).unwrap_or_default()).or_default() += 1;
            }
            let font = count.into_iter().max_by_key(|(_, n)| *n).map(|(f, _)| f).unwrap_or_default();
            let main = chars.iter().find(|c| c.font().is_some_and(|f| font_name(f.name()) == font)).unwrap_or(first);
            let style = main.font().map_or([false; 4], |f| {
                let (serif, mono) = family(&font, f.is_serif(), f.is_monospaced());
                [serif, mono, f.is_bold(), f.is_italic()]
            });
            let argb = main.argb();
            let ch = |s: u32| ((argb >> s) & 0xff) as f32 / 255.0;
            let text: String = chars.iter().filter_map(|c| c.char()).collect();
            let text = text.trim_end().to_string();
            if text.is_empty() {
                continue;
            }
            let r = l.bounds();
            out.push(Line {
                bbox: [r.x0 - ox, r.y0 - oy, r.x1 - ox, r.y1 - oy],
                base: a.y - oy,
                x0: a.x - ox,
                font,
                size: main.size(),
                color: [ch(16), ch(8), ch(0)],
                style,
                text,
            });
        }
    }
    Ok(out)
}

/// Textzeile zum Markieren/Kopieren: ein Rechteck je Zeichen (`text` zeichenweise gleich lang wie `boxes`).
#[derive(Serialize, Debug, Clone)]
pub struct CharLine {
    pub text: String,
    pub boxes: Vec<[f32; 4]>,
}

/// Alle Zeichen einer Seite inkl. unsichtbarem OCR-Text (auch auf Scan-Seiten) – für die Textauswahl in Ebene 1.
pub fn chars(doc: &PdfDocument, index: i32) -> Result<Vec<CharLine>, String> {
    let err = |e: Error| e.to_string();
    if !(0..doc.page_count().map_err(err)?).contains(&index) {
        return Err("ungültige Seite".into());
    }
    let page = doc.load_page(index).map_err(err)?;
    let b = page.bounds().map_err(err)?;
    let mut out = Vec::new();
    for block in page.to_text_page(TextPageFlags::empty()).map_err(err)?.blocks() {
        for l in block.lines() {
            let mut line = CharLine { text: String::new(), boxes: Vec::new() };
            for c in l.chars() {
                let q = c.quad();
                let xs = [q.ul.x, q.ur.x, q.ll.x, q.lr.x].map(|v| v - b.x0);
                let ys = [q.ul.y, q.ur.y, q.ll.y, q.lr.y].map(|v| v - b.y0);
                let (lo, hi) = (|v: [f32; 4]| v.into_iter().fold(f32::MAX, f32::min), |v: [f32; 4]| v.into_iter().fold(f32::MIN, f32::max));
                line.text.push(c.char().unwrap_or(char::REPLACEMENT_CHARACTER));
                line.boxes.push([lo(xs), lo(ys), hi(xs), hi(ys)]);
            }
            if !line.boxes.is_empty() {
                out.push(line);
            }
        }
    }
    Ok(out)
}

/// Serif/Mono der Originalschrift. MuPDF meldet Serif auch für Aptos/Calibri/URW-Sans (Word setzt in
/// `/Flags` kein Serif-Bit, auch nicht bei Times) → zuerst bekannte Namen.
// ponytail: Namensliste; unbekannte Schriften → MuPDF-Flag, mehr Namen ergänzen, wenn Ersatz danebenliegt
fn family(name: &str, serif: bool, mono: bool) -> (bool, bool) {
    let n = name.to_lowercase();
    let has = |l: &[&str]| l.iter().any(|k| n.contains(k));
    if mono || has(&["mono", "courier", "consol", "code", "cmtt"]) {
        return (false, true);
    }
    if has(&["sans", "arial", "helvet", "aptos", "calibri", "biolinum", "verdana", "segoe", "tahoma", "gothic", "grotesk", "roboto", "open", "lato", "cmss"]) {
        return (false, false);
    }
    (serif || has(&["roman", "times", "serif", "libertine", "georgia", "garamond", "cambria", "palatino", "book"]), false)
}

/// Listenpunkt am Zeilenanfang → eigener Absatz, auch bei gleichem Abstand.
fn bullet(t: &str) -> bool {
    let mut c = t.chars();
    matches!(c.next(), Some('•' | '◦' | '▪' | '‣' | '–' | '-' | '*')) && c.next().is_some_and(char::is_whitespace)
}

fn group(lines: Vec<Line>) -> Vec<Para> {
    let mut out: Vec<Para> = Vec::new();
    for l in lines {
        let fits = out.last().is_some_and(|p| {
            let last = &p.lines[p.lines.len() - 1];
            let tol = (0.1 * l.size).max(1.0);
            let gap = l.base - last.base;
            let same = l.font == p.font && (l.size - p.size).abs() < 0.5;
            let gap_ok = (0.9 * p.size..=2.0 * p.size).contains(&gap)
                && (p.lines.len() < 2 || (gap - p.leading()).abs() < 0.2 * p.size);
            // erste Zeile darf eingerückt sein, danach gemeinsamer linker Rand
            let left_ok = if p.lines.len() == 1 {
                l.x0 <= last.x0 + tol && l.x0 >= last.x0 - 4.0 * p.size
            } else {
                (l.x0 - p.left()).abs() < tol
            };
            same && gap_ok && left_ok && !bullet(&l.text)
        });
        match out.last_mut() {
            Some(p) if fits => {
                // Silbentrennung am Zeilenende auflösen, sonst mit Leerzeichen verbinden
                let lower = l.text.chars().next().is_some_and(char::is_lowercase);
                if p.text.ends_with('-') && lower {
                    p.text.pop();
                } else {
                    p.text.push(' ');
                }
                p.text.push_str(&l.text);
                p.bbox = [p.bbox[0].min(l.bbox[0]), p.bbox[1].min(l.bbox[1]), p.bbox[2].max(l.bbox[2]), p.bbox[3].max(l.bbox[3])];
                p.lines.push(l);
            }
            _ => out.push(Para { bbox: l.bbox, text: l.text.clone(), font: l.font.clone(), size: l.size, color: l.color, lines: vec![l] }),
        }
    }
    out
}

fn check_page(doc: &PdfDocument, index: i32) -> Result<(), String> {
    let err = |e: Error| e.to_string();
    if !(0..doc.page_count().map_err(err)?).contains(&index) {
        return Err("ungültige Seite".into());
    }
    if crate::pdf::is_scan(doc, index).map_err(err)? {
        return Err("Scan-Seite: kein Text".into());
    }
    if crate::notebook::markdown(doc, index)?.is_some() {
        return Err("Markdown-Seite: Text im Markdown-Editor ändern".into());
    }
    Ok(())
}

/// Absätze einer Seite in Lesereihenfolge. Scan- und Markdown-Seiten: keine.
pub fn paragraphs(doc: &PdfDocument, index: i32) -> Result<Vec<Para>, String> {
    match check_page(doc, index) {
        Err(e) if e.starts_with("Scan") || e.starts_with("Markdown") => return Ok(Vec::new()),
        r => r?,
    }
    Ok(group(lines(&doc.load_pdf_page(index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?))
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Sans,
    Serif,
    Mono,
}

/// Änderung an Absatz `para` (Reihenfolge wie `paragraphs`): neuer Text (leer = löschen), Verschiebung in pt,
/// optional andere Größe/Schrift (dann immer Ersatzschrift), Breite (Umbruch, pt) und Farbe (0…1).
#[derive(Deserialize, Debug, Clone, Default)]
pub struct TextEdit {
    pub para: usize,
    pub text: String,
    #[serde(default)]
    pub dx: f32,
    #[serde(default)]
    pub dy: f32,
    #[serde(default)]
    pub size: Option<f32>,
    #[serde(default)]
    pub font: Option<Family>,
    #[serde(default)]
    pub width: Option<f32>,
    #[serde(default)]
    pub color: Option<[f32; 3]>,
}

/// Glyph einer Schrift: Fontressource, Code-Bytes, Breite in 1/1000 em.
#[derive(Clone)]
pub(crate) struct Glyph {
    pub(crate) key: usize,
    pub(crate) code: Vec<u8>,
    pub(crate) width: f32,
}

/// Zeichen → Glyph je Fontressource. MuPDF dekodiert dazu jeden Code selbst (ToUnicode, Encoding/Differences,
/// Glyphnamen) in einer Wegwerf-PDF – keine eigene CMap-Auswertung.
fn decode_font(font: &PdfObject) -> Result<HashMap<char, (Vec<u8>, f32)>, Error> {
    let name = |o: &PdfObject, k: &str| -> Result<Vec<u8>, Error> { Ok(o.get_dict(k)?.map(|n| n.as_name()).transpose()?.unwrap_or_default()) };
    let num = |o: Option<PdfObject>| o.map_or(Ok(0.0), |v| v.as_float());
    let subtype = name(font, "Subtype")?;
    let mut codes: Vec<(u32, f32)> = Vec::new();
    let two = subtype == b"Type0";
    if two {
        // ponytail: nur Identity-H (Word, LibreOffice); andere CMaps → Ersatzschrift
        let desc = font.get_dict("DescendantFonts")?.and_then(|a| a.get_array(0).ok().flatten());
        let (Some(desc), true) = (desc, name(font, "Encoding")? == b"Identity-H") else { return Ok(HashMap::new()) };
        let Some(w) = desc.get_dict("W")? else { return Ok(HashMap::new()) };
        let n = w.len()? as i32;
        let mut i = 0;
        while i + 1 < n && codes.len() < 65_536 {
            let c = w.get_array(i)?.map_or(Ok(0), |v| v.as_int())?.max(0) as u32;
            let Some(next) = w.get_array(i + 1)? else { break };
            if next.is_array()? {
                for k in 0..next.len()? as i32 {
                    codes.push((c + k as u32, num(next.get_array(k)?)?));
                }
                i += 2;
            } else {
                let c2 = (next.as_int()?.max(0) as u32).min(c + 65_535);
                let wv = num(w.get_array(i + 2)?)?;
                codes.extend((c..=c2).map(|c| (c, wv)));
                i += 3;
            }
        }
    } else if matches!(&subtype[..], b"Type1" | b"MMType1" | b"TrueType") {
        let first = font.get_dict("FirstChar")?.map_or(Ok(0), |v| v.as_int())?;
        let Some(w) = font.get_dict("Widths")? else { return Ok(HashMap::new()) };
        for k in 0..(w.len()? as i32).min(256) {
            codes.push(((first + k).clamp(0, 255) as u32, num(w.get_array(k)?)?));
        }
    } else {
        return Ok(HashMap::new());
    }
    // Leerzeichen hat oft Breite > 0, Glyphen ohne Breite fehlen meist im Subset
    codes.retain(|&(_, w)| w > 0.0);
    if codes.is_empty() {
        return Ok(HashMap::new());
    }

    const COLS: usize = 100;
    let rows = codes.len().div_ceil(COLS);
    let h = rows as f32 * 20.0 + 40.0;
    let mut d = PdfDocument::new();
    let f = d.graft_object(font)?;
    let page = d.new_page(Size::new(COLS as f32 * 20.0 + 20.0, h))?;
    let mut res = d.new_dict()?;
    let mut fonts = d.new_dict()?;
    fonts.dict_put("F", f)?;
    res.dict_put("Font", fonts)?;
    page.object().dict_put("Resources", res)?;
    let mut s = String::from("BT /F 10 Tf\n");
    for (i, (c, _)) in codes.iter().enumerate() {
        let (x, y) = ((i % COLS) as f32 * 20.0 + 10.0, h - ((i / COLS) as f32 * 20.0 + 20.0));
        let hex = if two { format!("{c:04X}") } else { format!("{c:02X}") };
        s += &format!("1 0 0 1 {x} {y} Tm <{hex}> Tj\n");
    }
    s += "ET\n";
    let stream = d.add_stream(&mupdf::Buffer::from_bytes(s.as_bytes())?, None, false)?;
    page.object().dict_put("Contents", stream)?;

    let mut hits: Vec<Vec<char>> = vec![Vec::new(); codes.len()];
    let page = d.load_page(0)?;
    let is_type1 = subtype != b"TrueType" && !two;
    for b in page.to_text_page(TextPageFlags::empty())?.blocks() {
        for l in b.lines() {
            for c in l.chars() {
                let o = c.origin();
                let (col, row) = (((o.x - 10.0) / 20.0).round(), ((o.y - 20.0) / 20.0).round());
                let i = row as usize * COLS + col as usize;
                let Some(ch) = c.char() else { continue };
                // Type1-Subset: Glyph muss wirklich vorhanden sein (Glyphnamen-Charmap von FreeType)
                let present = !is_type1 || ch == ' ' || c.font().is_some_and(|f| f.encode_character(ch as i32).is_ok_and(|g| g > 0));
                if col >= 0.0 && row >= 0.0 && i < hits.len() && present {
                    hits[i].push(ch);
                }
            }
        }
    }
    let mut map = HashMap::new();
    for ((c, w), h) in codes.into_iter().zip(hits) {
        // Ligaturen (ein Code → mehrere Zeichen) nicht verwenden
        if let [ch] = h[..] {
            let code = if two { vec![(c >> 8) as u8, c as u8] } else { vec![c as u8] };
            map.entry(ch).or_insert((code, w));
        }
    }
    Ok(map)
}

fn base_font(font: &PdfObject) -> Result<String, Error> {
    let b = font.get_dict("BaseFont")?.map(|n| n.as_name()).transpose()?.unwrap_or_default();
    Ok(String::from_utf8_lossy(&b).into_owned())
}

/// Fontressourcen der Seite.
fn page_fonts(page: &PdfPage) -> Result<Vec<(String, PdfObject)>, Error> {
    let mut out = Vec::new();
    let Some(fonts) = page.object().get_dict_inheritable("Resources")?.and_then(|r| r.get_dict("Font").ok().flatten()) else {
        return Ok(out);
    };
    for i in 0..fonts.dict_len()? as i32 {
        if let (Some(k), Some(v)) = (fonts.get_dict_key(i)?, fonts.get_dict_val(i)?) {
            out.push((String::from_utf8_lossy(&k.as_name()?).into_owned(), v));
        }
    }
    Ok(out)
}

const SUBSTITUTES: [[&str; 4]; 3] = [
    ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
    ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
    ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
];

/// Schrift für den Neusatz: Ressourcenschlüssel je `Glyph.key` + Zeichentabelle.
pub(crate) struct Fonts {
    pub(crate) keys: Vec<String>,
    pub(crate) map: HashMap<char, Glyph>,
}

/// Stufe 1: Original-Fontressourcen gleichen Namens, nur wenn sie alle Zeichen (außer Leerzeichen) haben.
fn original_fonts(page: &PdfPage, name: &str, text: &str) -> Result<Option<Fonts>, Error> {
    let mut f = Fonts { keys: Vec::new(), map: HashMap::new() };
    for (key, obj) in page_fonts(page)? {
        // Type0: Name steht auch im Descendant (eigene Ersatzschrift: oben „Helvetica", unten „NimbusSans-Regular")
        let desc = obj.get_dict("DescendantFonts")?.and_then(|a| a.get_array(0).ok().flatten());
        let names = [Some(obj.clone()), desc].into_iter().flatten().map(|o| base_font(&o));
        if !names.collect::<Result<Vec<_>, _>>()?.iter().any(|b| font_name(b) == name) {
            continue;
        }
        let k = f.keys.len();
        f.keys.push(key);
        for (ch, (code, width)) in decode_font(&obj)? {
            f.map.entry(ch).or_insert(Glyph { key: k, code, width });
        }
    }
    Ok(text.chars().all(|c| c.is_whitespace() || f.map.contains_key(&c)).then_some(f))
}

/// Stufe 2: URW-Ersatzschrift, eingebettet (CID, Identity-H). Pro Dokument nur einmal: vorhandene eigene Ressource
/// (`PNF…` mit gleichem BaseFont) auf irgendeiner Seite wird wiederverwendet. Fehlende Zeichen → `missing`.
pub(crate) fn substitute(doc: &mut PdfDocument, page: &PdfPage, name: &str, text: &str, missing: &mut Vec<char>) -> Result<Fonts, Error> {
    let font = Font::new(name)?;
    let mut obj = None;
    'pages: for i in 0..doc.page_count()? {
        for (k, v) in page_fonts(&doc.load_pdf_page(i)?)? {
            if k.starts_with("PNF") && base_font(&v)? == name {
                obj = Some(v);
                break 'pages;
            }
        }
    }
    let obj = match obj {
        Some(o) => o,
        None => doc.add_font(&font)?,
    };
    let key = put_font(doc, page, obj)?;
    let mut map = HashMap::new();
    for ch in text.chars().filter(|c| !c.is_whitespace()) {
        if map.contains_key(&ch) {
            continue;
        }
        match font.encode_character(ch as i32) {
            Ok(g) if g > 0 => {
                let width = font.advance_glyph(g)? * 1000.0;
                map.insert(ch, Glyph { key: 0, code: vec![(g >> 8) as u8, g as u8], width });
            }
            _ if !missing.contains(&ch) => missing.push(ch),
            _ => {}
        }
    }
    if let Ok(g @ 1..) = font.encode_character(' ' as i32) {
        map.insert(' ', Glyph { key: 0, code: vec![(g >> 8) as u8, g as u8], width: font.advance_glyph(g)? * 1000.0 });
    }
    Ok(Fonts { keys: vec![key], map })
}

/// Font in die Ressourcen der Seite eintragen (eigene `/Resources` + `/Font` anlegen, falls nur geerbt/fehlend).
fn put_font(doc: &mut PdfDocument, page: &PdfPage, font: PdfObject) -> Result<String, Error> {
    let mut p = page.object();
    let mut res = match p.get_dict("Resources")? {
        Some(r) => r,
        None => {
            let r = match p.get_dict_inheritable("Resources")? {
                Some(r) => r.copy_dict()?,
                None => doc.new_dict()?,
            };
            p.dict_put("Resources", r)?;
            p.get_dict("Resources")?.ok_or(Error::UnexpectedNullPtr)?
        }
    };
    let mut fonts = match res.get_dict("Font")? {
        Some(f) => f,
        None => {
            res.dict_put("Font", doc.new_dict()?)?;
            res.get_dict("Font")?.ok_or(Error::UnexpectedNullPtr)?
        }
    };
    for i in 0..fonts.dict_len()? as i32 {
        if let (Some(k), Some(v)) = (fonts.get_dict_key(i)?, fonts.get_dict_val(i)?) {
            if v.as_indirect().ok() == font.as_indirect().ok() && k.as_name()?.starts_with(b"PNF") {
                return Ok(String::from_utf8_lossy(&k.as_name()?).into_owned());
            }
        }
    }
    let mut n = 0;
    let key = loop {
        let k = format!("PNF{n}");
        if fonts.get_dict(k.as_str())?.is_none() {
            break k;
        }
        n += 1;
    };
    fonts.dict_put(key.as_str(), font)?;
    Ok(key)
}

/// Gesetzte Zeile: Wörter mit Abstand dazwischen (pt), Breite in pt.
pub(crate) struct SetLine {
    pub(crate) words: Vec<String>,
    pub(crate) gap: f32,
    pub(crate) x: f32,
    pub(crate) base: f32,
}

/// Umbruch: Zeilenbreite `width`, erste Zeile um `indent` eingerückt; `\n` erzwingt Umbruch.
/// Blocksatz verteilt den Rest auf die Wortabstände (nicht in der letzten Zeile eines Absatzes).
pub(crate) fn reflow(text: &str, width: f32, indent: f32, space: f32, justify: bool, measure: impl Fn(&str) -> f32) -> Vec<(Vec<String>, f32, f32)> {
    let mut out = Vec::new();
    for hard in text.split('\n') {
        let words: Vec<&str> = hard.split_whitespace().collect();
        if words.is_empty() {
            out.push((Vec::new(), space, if out.is_empty() { indent } else { 0.0 }));
            continue;
        }
        let mut cur: Vec<String> = Vec::new();
        let mut w = 0.0;
        for word in words {
            let ww = measure(word);
            let ind = if out.is_empty() { indent } else { 0.0 };
            if !cur.is_empty() && ind + w + space + ww > width {
                let slack = width - ind - w;
                let gap = if justify && cur.len() > 1 { space + slack / (cur.len() - 1) as f32 } else { space };
                out.push((std::mem::take(&mut cur), gap, ind));
                w = 0.0;
            }
            w += if cur.is_empty() { ww } else { space + ww };
            cur.push(word.to_string());
        }
        let ind = if out.is_empty() { indent } else { 0.0 };
        // letzte Zeile des harten Absatzes bleibt linksbündig
        out.push((cur, space, ind));
    }
    out
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02X}")).collect()
}

/// Neusatz als Content-Stream-Stück: je Zeile `Tm` + TJ-Läufe je Fontressource; Abstände über TJ-Zahlen.
pub(crate) fn emit(lines: &[SetLine], f: &Fonts, size: f32, color: [f32; 3], inv_base: &Matrix) -> String {
    let mut s = format!("BT\n{} {} {} rg\n", color[0], color[1], color[2]);
    let space = f.map.get(&' ');
    for l in lines {
        let m = mul(&Matrix::new(1.0, 0.0, 0.0, -1.0, l.x, l.base), inv_base);
        s += &format!("{} {} {} {} {} {} Tm\n", m.a, m.b, m.c, m.d, m.e, m.f);
        let mut cur: Option<usize> = None;
        let mut run = String::new();
        let flush = |s: &mut String, run: &mut String, key: Option<usize>| {
            if let (Some(k), false) = (key, run.is_empty()) {
                *s += &format!("/{} {size} Tf [{}] TJ\n", f.keys[k], run);
            }
            run.clear();
        };
        for (i, w) in l.words.iter().enumerate() {
            if i > 0 {
                // Leerzeichen-Glyph der laufenden Schrift, Rest bzw. alles als Abstand
                let mut gap = l.gap;
                if let Some(sp) = space.filter(|g| Some(g.key) == cur) {
                    run += &format!("<{}>", hex(&sp.code));
                    gap -= sp.width / 1000.0 * size;
                }
                if gap.abs() > 1e-3 {
                    run += &format!(" {} ", -gap / size * 1000.0);
                }
            }
            for ch in w.chars() {
                let Some(g) = f.map.get(&ch) else { continue };
                if cur != Some(g.key) {
                    flush(&mut s, &mut run, cur);
                    cur = Some(g.key);
                }
                run += &format!("<{}>", hex(&g.code));
            }
        }
        flush(&mut s, &mut run, cur);
    }
    s + "ET\n"
}

fn overlaps(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/// Absatz ändern; Rückgabe = Hinweis (Überlauf, fehlende Zeichen, Ersatzschrift) oder `None`.
pub fn edit(doc: &mut PdfDocument, index: i32, e: &TextEdit) -> Result<Option<String>, String> {
    let err = |e: Error| e.to_string();
    check_page(doc, index)?;
    let ok = [e.dx, e.dy].iter().all(|v| v.is_finite() && v.abs() < 1e4)
        && e.size.is_none_or(|s| s.is_finite() && (2.0..=500.0).contains(&s))
        && e.width.is_none_or(|w| w.is_finite() && (1.0..=1e4).contains(&w))
        && e.color.is_none_or(|c| c.iter().all(|v| (0.0..=1.0).contains(v)))
        && e.text.chars().count() <= 20_000;
    if !ok {
        return Err("ungültige Textänderung".into());
    }
    let page = doc.load_pdf_page(index).map_err(err)?;
    let all = lines(&page).map_err(err)?;
    let paras = group(all.clone());
    let p = paras.get(e.para).ok_or("Absatz nicht gefunden")?;
    let others: Vec<[f32; 4]> = all.iter().filter(|l| !p.lines.iter().any(|m| m.bbox == l.bbox && m.text == l.text)).map(|l| l.bbox).collect();

    // alten Text entfernen: schmales Band je Zeile (Grundlinie bis Mittellänge) trifft nur Glyphen dieser Zeile
    let mut page = page;
    let base = base_matrix(&page).map_err(err)?;
    let inv = base.invert().ok_or("Seite nicht abbildbar")?;
    let b = page.bounds().map_err(err)?;
    for l in &p.lines {
        let r = Rect::new(l.bbox[0] + b.x0, l.base - 0.5 * l.size + b.y0, l.bbox[2] + b.x0, l.base + 0.05 * l.size + b.y0);
        page.add_redact_annotation(r).map_err(err)?;
    }
    let opts = PdfRedactOptions {
        black_boxes: false,
        image_method: PdfRedactImageMethod::None,
        line_art: PdfRedactLineArtMethod::None,
        text: PdfRedactTextMethod::Remove,
    };
    page.redact_with_options(opts).map_err(err)?;
    let text = e.text.trim_end();
    if text.trim().is_empty() {
        return Ok(None);
    }

    // Schrift
    let mut notes = Vec::new();
    let mut missing = Vec::new();
    let page = doc.load_pdf_page(index).map_err(err)?;
    let first = &p.lines[0];
    let orig = match (e.font, e.size) {
        (None, None) => original_fonts(&page, &p.font, text).map_err(err)?,
        _ => None,
    };
    let fonts = match orig {
        Some(f) => f,
        None => {
            let [serif, mono, bold, italic] = first.style;
            let fam = e.font.unwrap_or(if mono { Family::Mono } else if serif { Family::Serif } else { Family::Sans });
            let name = SUBSTITUTES[fam as usize][bold as usize + 2 * italic as usize];
            if e.font.is_none() && e.size.is_none() {
                notes.push(format!("Ersatzschrift {name}: Originalschrift hat nicht alle Zeichen"));
            }
            substitute(doc, &page, name, text, &mut missing).map_err(err)?
        }
    };
    if !missing.is_empty() {
        notes.push(format!("Zeichen fehlen in der Schrift: {}", missing.iter().collect::<String>()));
    }

    // Umbruch im alten Absatzrahmen
    let size = e.size.unwrap_or(p.size);
    let k = size / p.size;
    let left = p.left();
    let right = p.lines.iter().map(|l| l.bbox[2]).fold(f32::MIN, f32::max);
    // einzeilig (Überschrift, kurze Zeile): Rahmen = Textbreite wäre zu eng → bis zum Rand gegenüber dem linken
    let right = match e.width {
        Some(w) => left + w,
        None if p.lines.len() == 1 => right.max(b.x1 - b.x0 - left),
        None => right,
    };
    let width = (right - left).max(size);
    let indent = first.x0 - left;
    let justify = p.lines.len() > 2 && p.lines[..p.lines.len() - 1].iter().all(|l| (l.bbox[2] - right).abs() < 0.3 * p.size);
    let space = fonts.map.get(&' ').map_or(0.27 * size, |g| g.width / 1000.0 * size);
    let measure = |w: &str| w.chars().filter_map(|c| fonts.map.get(&c)).map(|g| g.width / 1000.0 * size).sum::<f32>();
    let set: Vec<SetLine> = reflow(text, width, indent, space, justify, measure)
        .into_iter()
        .enumerate()
        .map(|(i, (words, gap, ind))| SetLine { words, gap, x: left + ind + e.dx, base: first.base + i as f32 * p.leading() * k + e.dy })
        .collect();

    // Überlauf: neue Zeilen überdecken anderen Text oder verlassen die Seite
    let (pw, ph) = (b.x1 - b.x0, b.y1 - b.y0);
    let line_w = |l: &SetLine| l.words.iter().map(|w| measure(w)).sum::<f32>() + l.gap * l.words.len().saturating_sub(1) as f32;
    let boxes: Vec<[f32; 4]> = set.iter().map(|l| [l.x, l.base - 0.7 * size, l.x + line_w(l), l.base + 0.2 * size]).collect();
    let off = boxes.iter().any(|r| r[0] < 0.0 || r[1] < 0.0 || r[2] > pw + 0.5 || r[3] > ph);
    let hit = boxes.iter().any(|r| others.iter().any(|o| overlaps(*r, [o[0] + 0.5, o[1] + 0.2 * size, o[2] - 0.5, o[3] - 0.2 * size])));
    if hit || off {
        notes.insert(0, "Absatz läuft über (überdeckt anderen Text oder den Seitenrand) – Strg+Z nimmt es zurück".into());
    }

    let mut s = b"q\n".to_vec();
    s.extend(contents(&page).map_err(err)?);
    s.extend(b"\nQ\n");
    s.extend(emit(&set, &fonts, size, e.color.unwrap_or(p.color), &inv).into_bytes());
    let stream = doc.add_stream(&mupdf::Buffer::from_bytes(&s).map_err(err)?, None, false).map_err(err)?;
    page.object().dict_put("Contents", stream).map_err(err)?;
    Ok((!notes.is_empty()).then(|| notes.join("; ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 300×200-Seite, F1 = Helvetica (WinAnsi, Breiten 32…126) wie eine echte, nicht eingebettete Type1-Schrift.
    fn doc_with(content: &str) -> PdfDocument {
        let f = Font::new("Helvetica").unwrap();
        let w: Vec<String> = (32..=126).map(|c| (f.advance_glyph(f.encode_character(c).unwrap()).unwrap() * 1000.0).round().to_string()).collect();
        let mut d = PdfDocument::new();
        let font = d
            .new_object_from_str(&format!("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding/FirstChar 32/LastChar 126/Widths[{}]>>", w.join(" ")))
            .unwrap();
        let font = d.add_object(&font).unwrap();
        let page = d.new_page(Size::new(300.0, 200.0)).unwrap();
        let mut res = d.new_dict().unwrap();
        let mut fonts = d.new_dict().unwrap();
        fonts.dict_put("F1", font).unwrap();
        res.dict_put("Font", fonts).unwrap();
        page.object().dict_put("Resources", res).unwrap();
        let stream = d.add_stream(&mupdf::Buffer::from_bytes(content.as_bytes()).unwrap(), None, false).unwrap();
        page.object().dict_put("Contents", stream).unwrap();
        d
    }

    /// Absatz aus drei Zeilen (Abstand 14, Silbentrennung) + einzelne Zeile weiter unten.
    const PAGE: &str = "BT /F1 12 Tf 20 180 Td (Erste Zeile mit Ab-) Tj 0 -14 Td (satz und noch mehr) Tj 0 -14 Td (Ende hier.) Tj ET \
                        BT /F1 12 Tf 20 110 Td (Zweiter Absatz) Tj ET";

    fn edit_of(para: usize, text: &str) -> TextEdit {
        TextEdit { para, text: text.into(), ..Default::default() }
    }

    #[test]
    fn absaetze_erkennen() {
        let p = paragraphs(&doc_with(PAGE), 0).unwrap();
        assert_eq!(p.len(), 2, "{p:?}");
        assert_eq!(p[0].text, "Erste Zeile mit Absatz und noch mehr Ende hier.");
        assert_eq!(p[0].font, "Helvetica");
        assert!((p[0].leading() - 14.0).abs() < 0.01 && (p[0].bbox[1] - 10.0).abs() < 3.0, "{:?}", p[0].bbox);
        assert_eq!(p[1].text, "Zweiter Absatz");
        // Listenpunkt beginnt eigenen Absatz
        let d = doc_with("BT /F1 12 Tf 20 180 Td (Text davor) Tj 0 -14 Td (- Punkt) Tj ET");
        assert_eq!(paragraphs(&d, 0).unwrap().len(), 2);
    }

    #[test]
    fn schriftfamilie() {
        assert_eq!(family("Aptos", true, false), (false, false));
        assert_eq!(family("TimesNewRomanPS-BoldMT", false, false), (true, false));
        assert_eq!(family("LinLibertineT", false, false), (true, false));
        assert_eq!(family("CourierNewPSMT", true, false), (false, true));
        assert_eq!(family("Unbekannt", true, false), (true, false));
    }

    #[test]
    fn umbruch_und_blocksatz() {
        let r = reflow("aa bb cc dd\nee", 5.0, 0.0, 1.0, true, |w| w.len() as f32);
        let words: Vec<_> = r.iter().map(|l| l.0.join(" ")).collect();
        assert_eq!(words, ["aa bb", "cc dd", "ee"]);
        // Blocksatz: Rest 0 bei 5 = 2+1+2; mit Einzug 1 passt nur ein Wort in Zeile 1
        assert_eq!(r[0].1, 1.0);
        let r = reflow("aa b cc", 6.0, 0.0, 1.0, true, |w| w.len() as f32);
        assert_eq!((r[0].0.len(), r[0].1), (2, 3.0), "Lücke streckt auf volle Breite");
        assert_eq!(r[1].1, 1.0, "letzte Zeile nicht gestreckt");
        assert_eq!(reflow("aa bb", 5.0, 1.0, 1.0, false, |w| w.len() as f32).len(), 2);
    }

    #[test]
    fn text_aendern_mit_originalschrift() {
        let mut d = doc_with(PAGE);
        let w = edit(&mut d, 0, &edit_of(0, "Erste Zeile mit Absatz und noch mehr Ende hier, zwei mehr.")).unwrap();
        assert_eq!(w, None);
        // neuer Text steht im Stream hinten → Absatzreihenfolge ändert sich (Frontend lädt danach neu)
        let p = paragraphs(&d, 0).unwrap();
        assert_eq!(p.len(), 2, "{p:?}");
        assert_eq!(p[0].text, "Zweiter Absatz", "Nachbarabsatz unverändert");
        assert_eq!(p[1].text, "Erste Zeile mit Absatz und noch mehr Ende hier, zwei mehr.");
        assert_eq!(p[1].font, "Helvetica");
        let page = d.load_pdf_page(0).unwrap();
        assert!(page_fonts(&page).unwrap().iter().all(|(k, _)| !k.starts_with("PNF")), "keine Ersatzschrift");
        // löschen
        edit(&mut d, 0, &edit_of(0, "")).unwrap();
        assert_eq!(paragraphs(&d, 0).unwrap().len(), 1);
    }

    #[test]
    fn ersatzschrift_fehlende_zeichen_ueberlauf() {
        let mut d = doc_with(PAGE);
        // € fehlt in F1 (Breiten nur bis 126) → Helvetica-Ersatz eingebettet; 漢 hat auch der Ersatz nicht
        let w = edit(&mut d, 0, &edit_of(1, "Preis 5 € 漢")).unwrap().unwrap();
        assert!(w.contains("Ersatzschrift Helvetica") && w.contains("Zeichen fehlen") && w.contains('漢'), "{w}");
        assert!(!w.contains("läuft über"), "{w}");
        let p = paragraphs(&d, 0).unwrap();
        assert_eq!(p[1].text, "Preis 5 €");
        // zweite Änderung nutzt dieselbe Ersatzschrift-Ressource, ohne erneuten Hinweis
        assert_eq!(edit(&mut d, 0, &edit_of(1, "Preis 6 €")).unwrap(), None);
        let page = d.load_pdf_page(0).unwrap();
        assert_eq!(page_fonts(&page).unwrap().iter().filter(|(k, _)| k.starts_with("PNF")).count(), 1);

        // viel längerer Text wächst in den Absatz darunter
        let long = "Wort ".repeat(60);
        let w = edit(&mut d, 0, &edit_of(0, &long)).unwrap().unwrap_or_default();
        assert!(w.contains("läuft über"), "{w}");
    }

    #[test]
    fn verschieben_groesse_schrift() {
        let mut d = doc_with(PAGE);
        let e = TextEdit { dx: 30.0, dy: 20.0, size: Some(10.0), font: Some(Family::Serif), ..edit_of(1, "Zweiter Absatz") };
        assert_eq!(edit(&mut d, 0, &e).unwrap(), None, "gewählte Schrift: kein Hinweis");
        let p = paragraphs(&d, 0).unwrap();
        let q = p.iter().find(|p| p.text == "Zweiter Absatz").unwrap();
        assert_eq!(q.font, "NimbusRoman-Regular");
        assert!((q.size - 10.0).abs() < 0.01);
        assert!((q.lines[0].x0 - 50.0).abs() < 0.5 && (q.lines[0].base - 110.0).abs() < 0.5, "{:?}", q.lines[0]);
    }

    #[test]
    fn ungueltige_eingaben() {
        let mut d = doc_with(PAGE);
        assert!(edit(&mut d, 0, &edit_of(9, "x")).is_err());
        assert!(edit(&mut d, 1, &edit_of(0, "x")).is_err());
        assert!(edit(&mut d, 0, &TextEdit { size: Some(0.0), ..edit_of(0, "x") }).is_err());
        assert!(edit(&mut d, 0, &TextEdit { dx: f32::NAN, ..edit_of(0, "x") }).is_err());
    }

    #[test]
    fn enger_zeilenabstand_nachbarzeilen_bleiben() {
        // Abstand = Schriftgröße: Redaction der Mittelzeile darf Ober-/Unterlängen der Nachbarn nicht treffen
        let mut d = doc_with("BT /F1 12 Tf 20 180 Td (gjpqy oben) Tj ET BT /F1 12 Tf 60 168 Td (Mitte) Tj ET BT /F1 12 Tf 120 156 Td (Hdlkb unten) Tj ET");
        let p = paragraphs(&d, 0).unwrap();
        assert_eq!(p.len(), 3, "{p:?}");
        edit(&mut d, 0, &edit_of(1, "Neu")).unwrap();
        let t: Vec<_> = paragraphs(&d, 0).unwrap().into_iter().map(|p| p.text).collect();
        assert_eq!(t, ["gjpqy oben", "Hdlkb unten", "Neu"]);
    }
}
