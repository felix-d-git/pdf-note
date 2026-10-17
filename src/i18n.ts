/** Oberflächentexte DE/EN; Sprache = Windows-Sprache (WebView2 `navigator.language`), sonst Englisch. */
const de = {
  ctrl: "Strg", shift: "Umschalt",
  newFile: "Neue Notiz-PDF", open: "Öffnen", close: "Schließen", split: "Split View",
  auto: "Gerät bestimmt Werkzeug", settings: "Einstellungen", sidebar: "Seitenleiste",
  save: "Speichern", saveFlat: "Speichern unter (eingebrannt)", undo: "Rückgängig", redo: "Wiederholen",
  pen: "Stift", marker: "Textmarker", eraser: "Radierer", lasso: "Auswahl/Text", line: "Linie", arrow: "Pfeil",
  rect: "Rechteck", ellipse: "Kreis/Ellipse", axes: "Koordinatensystem", form: "Formular", link: "Anker-Link", space: "Platz einfügen",
  locked: "bleibt aktiv", penMark: "Stift-Werkzeug",
  layer1: "Ebene 1: PDF-Inhalt", layer2: "Ebene 2: Elemente", layer3: "Ebene 3: Notizen",
  image: "Bild einfügen", insert: "Einfügen", imageFile: "Bild-Datei", textBox: "Textfeld",
  style: "Stärke, Farbe, Presets", size: "Stärke", textSize: "Textgröße", color: "Farbe",
  presetAdd: "Als Preset speichern", presetSet: "Preset überschreiben", custom: "Eigenes",
  axesXy: "xy", axesXyz: "xyz (Schrägbild)", grid: "Karo-Gitter",
  pageAdd: "Seite einfügen", blank: "Leer", lined: "Liniert", squared: "Kariert", dots: "Punkte", markdownPage: "Markdown-Seite",
  markdownEdit: "Markdown bearbeiten", appendPdf: "PDF anhängen", imagePage: "Bild als Seite", rotate: "Seite drehen",
  ocr: "Text erkennen (OCR)", pageDelete: "Seite löschen", zoomOut: "Verkleinern", zoomIn: "Vergrößern", page: "Seite",
  search: "Suchen", searchClose: "Suche schließen", linkTarget: "Ziel anklicken (Esc bricht ab)",
  pages: "Seiten", marks: "Lesezeichen", markAdd: "Lesezeichen auf aktuelle Seite", up: "Nach oben", down: "Nach unten",
  outdent: "Ausrücken", indent: "Einrücken", markTarget: "Ziel = aktuelle Seite", del: "Löschen", noMarks: "Keine Lesezeichen",
  cancel: "Abbrechen", apply: "Übernehmen", title: "Titel",
  cut: "Ausschneiden", copy: "Kopieren", paste: "Einfügen", front: "Nach vorn", back: "Nach hinten",
  crop: "Zuschneiden", rotate90: "Drehen 90°", textHere: "Textfeld hier", imageHere: "Bild hier", selection: "Auswahl",
  fontSize: "Schriftgröße", fontColor: "Schriftfarbe", unlink: "Link löschen", move: "Verschieben", width: "Breite", turn: "Drehen",
  create: "Anlegen", font: "Schrift", fieldName: "Name (eindeutig, ohne Punkt)", fieldOptions: "Optionen der Auswahlliste, eine je Zeile",
  view: "Ansicht", light: "Hell", dark: "Dunkel", system: "System", stylus: "Stift",
  keyLasso: "Taste Auswahl", keyEraser: "Taste Radierer", learn: "Neu lernen", pressKey: "Taste jetzt drücken …", pressure: "Druck-Maximum",
  divider: "Trennlinie verschieben", empty: "Keine PDF geöffnet", emptyHint: "Strg+O oder Datei hierher ziehen",
  unsaved: (f: string) => `„${f}" hat ungespeicherte Änderungen. Speichern?`, discard: "Verwerfen",
  extern: "Die PDF wurde seit dem Öffnen außerhalb von PDF Note geändert. Beim Speichern gehen diese Änderungen verloren.",
  saveAnyway: "Trotzdem speichern",
};
type Strings = typeof de;

const en: Strings = {
  ctrl: "Ctrl", shift: "Shift",
  newFile: "New note PDF", open: "Open", close: "Close", split: "Split View",
  auto: "Device picks tool", settings: "Settings", sidebar: "Sidebar",
  save: "Save", saveFlat: "Save as (flattened)", undo: "Undo", redo: "Redo",
  pen: "Pen", marker: "Highlighter", eraser: "Eraser", lasso: "Select/Text", line: "Line", arrow: "Arrow",
  rect: "Rectangle", ellipse: "Circle/Ellipse", axes: "Coordinate system", form: "Form", link: "Anchor link", space: "Insert space",
  locked: "stays active", penMark: "Pen tool",
  layer1: "Layer 1: PDF content", layer2: "Layer 2: Elements", layer3: "Layer 3: Notes",
  image: "Insert image", insert: "Insert", imageFile: "Image file", textBox: "Text box",
  style: "Width, colour, presets", size: "Width", textSize: "Text size", color: "Colour",
  presetAdd: "Save as preset", presetSet: "Overwrite preset", custom: "Custom",
  axesXy: "xy", axesXyz: "xyz (oblique)", grid: "Square grid",
  pageAdd: "Insert page", blank: "Blank", lined: "Lined", squared: "Squared", dots: "Dots", markdownPage: "Markdown page",
  markdownEdit: "Edit Markdown", appendPdf: "Append PDF", imagePage: "Image as page", rotate: "Rotate page",
  ocr: "Recognise text (OCR)", pageDelete: "Delete page", zoomOut: "Zoom out", zoomIn: "Zoom in", page: "Page",
  search: "Search", searchClose: "Close search", linkTarget: "Click the target (Esc cancels)",
  pages: "Pages", marks: "Bookmarks", markAdd: "Bookmark current page", up: "Move up", down: "Move down",
  outdent: "Outdent", indent: "Indent", markTarget: "Target = current page", del: "Delete", noMarks: "No bookmarks",
  cancel: "Cancel", apply: "Apply", title: "Title",
  cut: "Cut", copy: "Copy", paste: "Paste", front: "Bring forward", back: "Send backward",
  crop: "Crop", rotate90: "Rotate 90°", textHere: "Text box here", imageHere: "Image here", selection: "Selection",
  fontSize: "Font size", fontColor: "Font colour", unlink: "Delete link", move: "Move", width: "Width", turn: "Rotate",
  create: "Create", font: "Font", fieldName: "Name (unique, no dot)", fieldOptions: "List options, one per line",
  view: "View", light: "Light", dark: "Dark", system: "System", stylus: "Pen",
  keyLasso: "Select button", keyEraser: "Eraser button", learn: "Learn again", pressKey: "Press the button now …", pressure: "Pressure maximum",
  divider: "Move divider", empty: "No PDF open", emptyHint: "Ctrl+O or drop a file here",
  unsaved: (f: string) => `"${f}" has unsaved changes. Save?`, discard: "Discard",
  extern: "The PDF was changed outside PDF Note since it was opened. Saving discards those changes.",
  saveAnyway: "Save anyway",
};

export const STRINGS = { de, en };
export const T: Strings = /^de\b/i.test(globalThis.navigator?.language ?? "") ? de : en;

/** Tooltip „Name (Taste)"; `key` mit `Strg+`/`Umschalt+` wird übersetzt */
export const tip = (name: string, key?: string) =>
  key ? `${name} (${key.replace("Strg", T.ctrl).replace("Umschalt", T.shift)})` : name;
