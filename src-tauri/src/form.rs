//! Formularfelder (AcroForm): vorhandene ausfüllen, neue anlegen. Werte setzt MuPDF (`pdf_set_field_value`),
//! danach erzeugt `update` das Erscheinungsbild neu – andere Reader zeigen den Wert ohne eigenes Rendern.
use mupdf::pdf::{PdfAnnotationType, PdfDocument, PdfObject, PdfWidget, WidgetType};
use mupdf::{Error, Rect};
use serde::{Deserialize, Serialize};

/// Feld für das Frontend; `rect` in App-Koordinaten (pt, oben links).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Field {
    pub xref: i32,
    /// text | check | radio | combo | list
    pub kind: &'static str,
    pub name: String,
    pub rect: [f32; 4],
    pub value: String,
    /// Ein-Zustand bei Checkbox/Radio (Wert = `on` → angehakt, sonst „Off")
    pub on: String,
    /// Auswahlliste: [Exportwert, Anzeige]
    pub options: Vec<[String; 2]>,
    pub readonly: bool,
    pub multiline: bool,
}

fn kind(w: &PdfWidget) -> Result<Option<&'static str>, Error> {
    Ok(match w.r#type()? {
        WidgetType::Text => Some("text"),
        WidgetType::Checkbox => Some("check"),
        WidgetType::RadioButton => Some("radio"),
        WidgetType::Combobox => Some("combo"),
        WidgetType::Listbox => Some("list"),
        _ => None, // Schaltflächen, Signaturen: nicht ausfüllbar
    })
}

/// Ein-Zustand = Schlüssel in `/AP /N` außer `Off`.
fn on_state(o: &PdfObject) -> Result<String, Error> {
    let Some(n) = o.get_dict("AP")?.and_then(|ap| ap.get_dict("N").transpose()).transpose()? else { return Ok("Yes".into()) };
    for i in 0..n.dict_len()? as i32 {
        if let Some(k) = n.get_dict_key(i)? {
            let k = String::from_utf8_lossy(&k.as_name()?).into_owned();
            if k != "Off" {
                return Ok(k);
            }
        }
    }
    Ok("Yes".into())
}

fn options(o: &PdfObject) -> Result<Vec<[String; 2]>, Error> {
    let Some(opt) = o.get_dict_inheritable("Opt")? else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for i in 0..opt.len()? as i32 {
        let Some(e) = opt.get_array(i)? else { continue };
        if e.is_array()? {
            let s = |j| -> Result<String, Error> { e.get_array(j)?.map(|x| x.as_string()).transpose().map(Option::unwrap_or_default) };
            out.push([s(0)?, s(1)?]);
        } else {
            let s = e.as_string()?;
            out.push([s.clone(), s]);
        }
    }
    Ok(out)
}

pub fn fields(doc: &PdfDocument, index: i32) -> Result<Vec<Field>, String> {
    let run = || -> Result<Vec<Field>, Error> {
        let page = doc.load_pdf_page(index)?;
        let mut out = Vec::new();
        for w in page.widgets() {
            let Some(kind) = kind(&w)? else { continue };
            let o = w.annotation().object();
            let r = w.annotation().bounds()?;
            let flags = w.field_flags()?;
            out.push(Field {
                xref: w.xref()?,
                kind,
                name: w.name()?.unwrap_or_default(),
                rect: [r.x0, r.y0, r.x1, r.y1],
                value: w.value()?.unwrap_or_default(),
                on: if matches!(kind, "check" | "radio") { on_state(&o)? } else { String::new() },
                options: if matches!(kind, "combo" | "list") { options(&o)? } else { Vec::new() },
                readonly: w.is_readonly()?,
                multiline: flags.contains(mupdf::pdf::FieldFlags::MULTILINE),
            });
        }
        Ok(out)
    };
    run().map_err(|e| e.to_string())
}

/// Wert eines Felds setzen; Checkbox/Radio: Ein-Zustand oder „Off".
pub fn set(doc: &mut PdfDocument, page: i32, xref: i32, value: &str) -> Result<(), String> {
    let err = |e: Error| e.to_string();
    let p = doc.load_pdf_page(page).map_err(err)?;
    let mut w = p.load_widget(xref).map_err(err)?.ok_or("Feld nicht gefunden")?;
    if w.is_readonly().map_err(err)? {
        return Err("Feld ist schreibgeschützt".into());
    }
    if !w.set_value(doc, value, true).map_err(err)? {
        return Err("Wert abgelehnt".into());
    }
    w.update().map_err(err)?;
    Ok(())
}

/// Neues Feld vom Frontend.
#[derive(Deserialize, Debug, Clone)]
pub struct NewField {
    /// text | check | combo
    pub kind: String,
    pub name: String,
    pub rect: [f32; 4],
    #[serde(default)]
    pub options: Vec<String>,
}

/// Alle Feldnamen des Dokuments (voll qualifiziert) – Namen müssen eindeutig sein,
/// sonst teilen sich zwei Felder einen Wert.
fn all_names(doc: &PdfDocument) -> Result<Vec<String>, Error> {
    let mut out = Vec::new();
    for i in 0..doc.page_count()? {
        for w in doc.load_pdf_page(i)?.widgets() {
            out.extend(w.name()?);
        }
    }
    Ok(out)
}

/// Standardschrift fürs Formular (`/DR /Font /<key>`), falls noch nicht da.
fn ensure_font(doc: &mut PdfDocument, form: &mut PdfObject, key: &str, base: &str) -> Result<(), Error> {
    let mut dr = match form.get_dict("DR")? {
        Some(d) => d,
        None => {
            let d = doc.new_dict()?;
            form.dict_put("DR", d.clone())?;
            d
        }
    };
    let mut fonts = match dr.get_dict("Font")? {
        Some(f) => f,
        None => {
            let d = doc.new_dict()?;
            dr.dict_put("Font", d.clone())?;
            d
        }
    };
    if fonts.get_dict(key)?.is_none() {
        let mut f = doc.new_dict()?;
        f.dict_put("Type", PdfObject::new_name("Font")?)?;
        f.dict_put("Subtype", PdfObject::new_name("Type1")?)?;
        f.dict_put("BaseFont", PdfObject::new_name(base)?)?;
        if base == "Helvetica" {
            f.dict_put("Encoding", PdfObject::new_name("WinAnsiEncoding")?)?;
        }
        let f = doc.add_object(&f)?;
        fonts.dict_put(key, f)?;
    }
    Ok(())
}

pub fn create(doc: &mut PdfDocument, page: i32, f: &NewField) -> Result<(), String> {
    let name = f.name.trim();
    if name.is_empty() || name.contains('.') {
        return Err("Feldname fehlt oder enthält einen Punkt".into());
    }
    let [x0, y0, x1, y1] = f.rect;
    let size = *crate::pdf::page_sizes(doc).map_err(|e| e.to_string())?.get(page as usize).ok_or("ungültige Seite")?;
    let ok = f.rect.iter().all(|v| v.is_finite()) && x1 - x0 >= 4.0 && y1 - y0 >= 4.0
        && x0 >= -1.0 && y0 >= -1.0 && x1 <= size[0] + 1.0 && y1 <= size[1] + 1.0;
    if !ok {
        return Err("Feld liegt nicht auf der Seite oder ist zu klein".into());
    }
    let options: Vec<&str> = f.options.iter().map(|o| o.trim()).filter(|o| !o.is_empty()).collect();
    let (ft, ff, da) = match f.kind.as_str() {
        "text" => ("Tx", 0, "/Helv 0 Tf 0 g"),
        "check" => ("Btn", 0, "/ZaDb 0 Tf 0 g"),
        "combo" if !options.is_empty() => ("Ch", 1 << 17, "/Helv 0 Tf 0 g"),
        "combo" => return Err("Auswahlliste braucht mindestens eine Option".into()),
        _ => return Err("unbekannte Feldart".into()),
    };
    let mut run = || -> Result<Result<(), String>, Error> {
        if all_names(doc)?.iter().any(|n| n == name) {
            return Ok(Err(format!("Feldname „{name}\" ist schon vergeben")));
        }
        let mut form = match doc.catalog()?.get_dict("AcroForm")? {
            Some(a) => a,
            None => {
                let a = doc.add_object(&doc.new_dict()?)?;
                doc.catalog()?.dict_put("AcroForm", a.clone())?;
                a
            }
        };
        let mut fields = match form.get_dict("Fields")? {
            Some(f) => f,
            None => {
                let f = doc.new_array()?;
                form.dict_put("Fields", f.clone())?;
                f
            }
        };
        ensure_font(doc, &mut form, "Helv", "Helvetica")?;
        ensure_font(doc, &mut form, "ZaDb", "ZapfDingbats")?;
        if form.get_dict("DA")?.is_none() {
            form.dict_put("DA", PdfObject::new_string("/Helv 0 Tf 0 g")?)?;
        }

        let mut p = doc.load_pdf_page(page)?;
        let mut a = p.create_annotation(PdfAnnotationType::Widget)?;
        a.set_rect(Rect::new(x0, y0, x1, y1))?;
        let mut o = a.object();
        o.dict_put("FT", PdfObject::new_name(ft)?)?;
        o.dict_put("T", PdfObject::new_string(name)?)?;
        o.dict_put("DA", PdfObject::new_string(da)?)?;
        o.dict_put("F", PdfObject::new_int(4)?)?; // drucken
        if ff != 0 {
            o.dict_put("Ff", PdfObject::new_int(ff)?)?;
        }
        let mut mk = doc.new_dict()?;
        let mut border = doc.new_array()?;
        for _ in 0..3 {
            border.array_push(PdfObject::new_real(0.4)?)?;
        }
        mk.dict_put("BC", border)?;
        match f.kind.as_str() {
            "check" => {
                mk.dict_put("CA", PdfObject::new_string("4")?)?; // ZapfDingbats-Haken
                o.dict_put("V", PdfObject::new_name("Off")?)?;
                o.dict_put("AS", PdfObject::new_name("Off")?)?;
            }
            "combo" => {
                let mut opt = doc.new_array()?;
                for s in &options {
                    opt.array_push(PdfObject::new_string(s)?)?;
                }
                o.dict_put("Opt", opt)?;
                o.dict_put("V", PdfObject::new_string(options[0])?)?;
            }
            _ => {}
        }
        o.dict_put("MK", mk)?;
        let xref = a.xref()?;
        fields.array_push(doc.new_indirect(xref, 0)?)?;
        a.update()?;
        p.update()?;
        Ok(Ok(()))
    };
    run().map_err(|e| e.to_string())?
}

/// Verweis auf Objekt `num` aus einem Array entfernen (indirekte Einträge).
fn drop_ref(arr: &mut PdfObject, num: i32) -> Result<(), Error> {
    let mut i = 0;
    while i < arr.len()? as i32 {
        let hit = match arr.get_array(i)? {
            Some(e) => e.is_indirect()? && e.as_indirect()? == num,
            None => false,
        };
        if hit {
            arr.array_delete(i)?;
        } else {
            i += 1;
        }
    }
    Ok(())
}

/// Feld löschen: Widget von der Seite und aus `/AcroForm /Fields` (bzw. `/Kids` der Gruppe) nehmen –
/// sonst bliebe ein Feld ohne Widget (bzw. ein Widget-Rest) zurück.
pub fn delete(doc: &mut PdfDocument, page: i32, xref: i32) -> Result<(), String> {
    let run = || -> Result<Result<(), String>, Error> {
        let mut p = doc.load_pdf_page(page)?;
        let Some(w) = p.load_widget(xref)? else { return Ok(Err("Feld nicht gefunden".into())) };
        let parent = w.annotation().object().get_dict("Parent")?;
        let mut owner = parent.as_ref().and_then(|x| x.resolve().ok().flatten()).or(parent.clone());
        let mut lists = Vec::new();
        if let Some(a) = doc.catalog()?.get_dict("AcroForm")? {
            lists.extend(a.get_dict("Fields")?);
        }
        if let Some(o) = owner.as_mut() {
            lists.extend(o.get_dict("Kids")?);
        }
        for mut l in lists {
            drop_ref(&mut l, xref)?;
        }
        // Gruppe ohne Knöpfe → Gruppe selbst auch aus den Feldern
        if let (Some(o), Some(pn)) = (&owner, parent.as_ref().filter(|x| x.is_indirect().unwrap_or(false))) {
            if o.get_dict("Kids")?.is_none_or(|k| k.len().unwrap_or(0) == 0) {
                if let Some(mut f) = doc.catalog()?.get_dict("AcroForm")?.and_then(|a| a.get_dict("Fields").ok().flatten()) {
                    drop_ref(&mut f, pn.as_indirect()?)?;
                }
            }
        }
        p.delete_widget(w)?;
        p.update()?;
        Ok(Ok(()))
    };
    run().map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kleine PDF mit Radiogruppe (2 Knöpfe) und Liste [Export, Anzeige]; Xref-Tabelle repariert MuPDF.
    fn sample() -> PdfDocument {
        let ap = |s: &str| format!("/AP << /N << /{s} 9 0 R /Off 9 0 R >> >> /AS /Off");
        let pdf = format!(
            "%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 7 0 R] >> >> endobj\n\
             2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n\
             3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [5 0 R 6 0 R 7 0 R] >> endobj\n\
             4 0 obj << /FT /Btn /Ff 49152 /T (Wahl) /V /Off /Kids [5 0 R 6 0 R] >> endobj\n\
             5 0 obj << /Type /Annot /Subtype /Widget /Parent 4 0 R /Rect [10 170 20 180] {} >> endobj\n\
             6 0 obj << /Type /Annot /Subtype /Widget /Parent 4 0 R /Rect [30 170 40 180] {} >> endobj\n\
             7 0 obj << /Type /Annot /Subtype /Widget /FT /Ch /T (Liste) /Rect [10 100 100 150] /DA (/Helv 0 Tf 0 g) \
             /Opt [[(a) (Apfel)] [(b) (Birne)]] /V (a) >> endobj\n\
             9 0 obj << /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length 0 >> stream\n\nendstream endobj\n\
             trailer << /Root 1 0 R >>\n%%EOF\n",
            ap("A"),
            ap("B")
        );
        PdfDocument::from_bytes(pdf.as_bytes()).unwrap()
    }

    #[test]
    fn radio_und_liste() {
        let mut doc = sample();
        let fs = fields(&doc, 0).unwrap();
        let radios: Vec<_> = fs.iter().filter(|f| f.kind == "radio").collect();
        assert_eq!(radios.iter().map(|f| f.on.as_str()).collect::<Vec<_>>(), ["A", "B"]);
        let list = fs.iter().find(|f| f.kind == "list").unwrap();
        assert_eq!(list.options, [["a".to_string(), "Apfel".into()], ["b".into(), "Birne".into()]]);
        // App-Koordinaten: oben links → Radio bei y = 200 − 180
        assert_eq!(radios[0].rect, [10.0, 20.0, 20.0, 30.0]);

        let (r2, l) = (radios[1].xref, list.xref);
        set(&mut doc, 0, r2, "B").unwrap();
        set(&mut doc, 0, l, "b").unwrap();
        let doc = PdfDocument::from_bytes(&crate::pdf::to_bytes(&doc).unwrap()).unwrap();
        let fs = fields(&doc, 0).unwrap();
        // Gruppe teilt den Wert: beide Knöpfe melden „B"
        assert!(fs.iter().filter(|f| f.kind == "radio").all(|f| f.value == "B"));
        assert_eq!(fs.iter().find(|f| f.kind == "list").unwrap().value, "b");
    }

    #[test]
    fn feld_loeschen() {
        let mut doc = sample();
        let f = |kind: &str, name: &str, rect: [f32; 4]| NewField { kind: kind.into(), name: name.into(), rect, options: vec![] };
        create(&mut doc, 0, &f("check", "H", [20.0, 60.0, 32.0, 72.0])).unwrap();
        create(&mut doc, 0, &f("text", "T", [20.0, 80.0, 90.0, 95.0])).unwrap();
        let h = fields(&doc, 0).unwrap().into_iter().find(|f| f.name == "H").unwrap().xref;
        delete(&mut doc, 0, h).unwrap();
        assert!(delete(&mut doc, 0, h).is_err(), "zweites Mal");
        // Radiogruppe: beide Knöpfe weg → Gruppe nicht mehr in Fields
        let radios: Vec<i32> = fields(&doc, 0).unwrap().iter().filter(|f| f.kind == "radio").map(|f| f.xref).collect();
        for r in radios {
            delete(&mut doc, 0, r).unwrap();
        }
        let doc = PdfDocument::from_bytes(&crate::pdf::to_bytes(&doc).unwrap()).unwrap();
        let names: Vec<_> = fields(&doc, 0).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.contains(&"T".to_string()) && names.contains(&"Liste".to_string()));
        let acro = doc.catalog().unwrap().get_dict("AcroForm").unwrap().unwrap().get_dict("Fields").unwrap().unwrap();
        assert_eq!(acro.len().unwrap(), 2, "Fields: Radio-Gruppe und Haken müssen raus");
    }

    #[test]
    fn neues_feld_ungueltig() {
        let mut doc = sample();
        let f = |kind: &str, name: &str, rect: [f32; 4], options: Vec<String>| NewField { kind: kind.into(), name: name.into(), rect, options };
        let ok = [10.0, 10.0, 60.0, 30.0];
        assert!(create(&mut doc, 0, &f("text", "", ok, vec![])).is_err());
        assert!(create(&mut doc, 0, &f("text", "a.b", ok, vec![])).is_err());
        assert!(create(&mut doc, 0, &f("text", "Liste", ok, vec![])).is_err(), "Name vergeben");
        assert!(create(&mut doc, 0, &f("combo", "C", ok, vec![])).is_err(), "ohne Optionen");
        assert!(create(&mut doc, 0, &f("text", "X", [10.0, 10.0, 500.0, 30.0], vec![])).is_err(), "außerhalb");
        assert!(create(&mut doc, 0, &f("knopf", "X", ok, vec![])).is_err());
        create(&mut doc, 0, &f("text", "X", ok, vec![])).unwrap();
        assert!(fields(&doc, 0).unwrap().iter().any(|f| f.name == "X" && f.kind == "text"));
        assert!(create(&mut doc, 0, &f("combo", "C", ok, vec!["  ".into()])).is_err(), "nur leere Optionen");
        create(&mut doc, 0, &f("combo", "C", [20.0, 40.0, 90.0, 55.0], vec![" Eins ".into(), "".into(), "Zwei".into()])).unwrap();
        create(&mut doc, 0, &f("check", "H", [20.0, 60.0, 32.0, 72.0], vec![])).unwrap();
        let fs = fields(&doc, 0).unwrap();
        let c = fs.iter().find(|f| f.name == "C").unwrap();
        assert_eq!((c.kind, c.value.as_str(), c.options.len()), ("combo", "Eins", 2));
        assert!(c.rect.iter().zip([20.0, 40.0, 90.0, 55.0]).all(|(a, b)| (a - b).abs() < 0.5), "Position {:?}", c.rect);
        let h = fs.iter().find(|f| f.name == "H").unwrap();
        assert!(h.kind == "check" && !h.on.is_empty() && h.value != h.on);
    }
}
