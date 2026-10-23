import {
  ArrowLeftRight, BetweenHorizontalStart, Bookmark, CircleHelp, ClipboardPen, Columns2, Copy, Crop, FileCode, FilePenLine, FileOutput, FilePlus, Files, Flame,
  FolderOpen, Grid3x3, Hand, History, ImagePlus, Keyboard, Layers, Lock, MousePointer2, NotebookPen, Palette, PenTool, Redo2, RotateCw,
  Save, ScanText, Search, Type, Undo2, Wrench, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { STRINGS, T, keyText } from "./i18n";
import { KEYS, LAYERS, TOOL_LABELS } from "./keys";
import { BTN, FIELD, IconBtn, on } from "./ui";

/** Zeile: Text oder Symbol + Text (Symbol wie in der App) */
type Line = string | [LucideIcon, string];
interface Chapter { id: string; icon: LucideIcon; title: string; lines: Line[] }

const DE: Chapter[] = [
  { id: "basics", icon: Save, title: "Grundprinzip", lines: [
    "Alles, was du schreibst, zeichnest und einfügst, steht in der PDF selbst – keine Zusatzdateien, keine Cloud, kein Netzwerk.",
    "Andere PDF-Programme zeigen deine Notizen ebenfalls; PDF Note öffnet sie wieder bearbeitbar.",
    [FolderOpen, "Öffnen (oder PDF ins Fenster ziehen); jede PDF bekommt einen Tab."],
    [NotebookPen, "Neue Notiz-PDF: legt eine leere A4-Seite an."],
  ] },
  { id: "layers", icon: Layers, title: "Ebenen 1/2/3", lines: [
    ...LAYERS.map(([l, icon, name]): Line => [icon, `${name} – Taste ${l}`]),
    "Ebene 1: Text und Inhalt der Original-PDF. Ebene 2: Bilder, Linien, Pfeile, Rechtecke, Kreise, Koordinatensysteme. Ebene 3: Handschrift und Textfelder.",
    "Werkzeuge wechseln die Ebene selbst; ein Klick allein ändert sie nicht. Auswählen und Radieren wirken nur auf der aktuellen Ebene.",
  ] },
  { id: "auto", icon: ArrowLeftRight, title: "Gerät bestimmt Werkzeug", lines: [
    [ArrowLeftRight, "An: Stift und Maus haben je ein eigenes Werkzeug (Stift = Stift, Maus = Auswahl/Text). Rahmen = Maus-Werkzeug, Punkt = Stift-Werkzeug."],
    "Aus: alle Geräte nutzen dasselbe Werkzeug.",
  ] },
  { id: "tools", icon: PenTool, title: "Werkzeuge", lines: [
    "Ein Form-Werkzeug (Linie, Pfeil, Rechteck, Kreis, Koordinatensystem, Platz) gilt für eine Form, danach kehrt das vorige Werkzeug zurück. Doppelklick auf das Symbol = Schloss (bleibt aktiv).",
  ] },
  { id: "text", icon: Type, title: "Text tippen und PDF-Text ändern", lines: [
    [MousePointer2, "Auswahl/Text: auf freie Fläche klicken und tippen → Textfeld (Ebene 3)."],
    "Ausgewähltes Textfeld: einfach weitertippen; Doppelklick bearbeitet es.",
    "Ebene 1: Doppelklick in einen Absatz der PDF bearbeitet den Originaltext direkt; Verlassen oder Esc übernimmt.",
  ] },
  { id: "select", icon: MousePointer2, title: "Auswahl, Griffe, Mini-Leiste, Rechtsklick", lines: [
    "Klicken oder Rahmen ziehen wählt aus; Umschalt fügt hinzu (Ebene 1: Umschalt+Ziehen zieht den Rahmen auch über Text; mehrere Absätze/Bilder verschieben sich zusammen). Griffe ändern Größe, der runde Griff dreht.",
    [Copy, "Über der Auswahl erscheint die Mini-Leiste (Kopieren, Ausschneiden, Löschen, Stil …)."],
    "Rechtsklick, Menütaste oder Umschalt+F10 öffnet das Kontextmenü (Einfügen, Textfeld hier, Bild hier, nach vorn/hinten).",
    "Pfeiltasten schieben die Auswahl um 1 pt, mit Umschalt um 10 pt.",
  ] },
  { id: "space", icon: BetweenHorizontalStart, title: "Platz einfügen", lines: [
    [BetweenHorizontalStart, "Platz einfügen: Linie aufziehen – alles darunter rückt nach unten (oder nach rechts). Verschoben werden nur eigene Objekte (Ebene 2/3), der PDF-Inhalt bleibt."],
  ] },
  { id: "images", icon: ImagePlus, title: "Bilder", lines: [
    [ImagePlus, "Bild einfügen (Taste I), aus der Zwischenablage (Strg+V) oder per Ziehen aus dem Explorer an die Drop-Stelle."],
    [Crop, "Zuschneiden: Doppelklick aufs Bild, Ränder ziehen; ✓ oder Enter übernimmt, Esc bricht ab. Der Zuschnitt ist endgültig."],
    [RotateCw, "Drehen mit dem runden Griff (Umschalt = 15°-Schritte); die Drehung wird gespeichert."],
  ] },
  { id: "axes", icon: Grid3x3, title: "Koordinatensysteme", lines: [
    "Werkzeug Koordinatensystem (X): Rechteck aufziehen → Achsen. Im Stil-Menü: xy oder xyz (Schrägbild), Karo-Gitter.",
  ] },
  { id: "marker", icon: Palette, title: "Stifte, Textmarker, Farbe, Breite", lines: [
    "Beginnt ein Textmarker-Strich auf PDF-Text, rastet er auf die Textzeilen ein.",
    [Palette, "Leiste: Stifte und Marker. Rechtsklick → Farbe, Breite, Entfernen; „+“ → neuer Stift; Ziehen ordnet um. Q W E = erste drei Stifte, Umschalt+Q W E = erste drei Marker."],
  ] },
  { id: "tabs", icon: Columns2, title: "Tabs und Split View", lines: [
    "Tabs per Ziehen umsortieren; Strg+Tab wechselt.",
    [Columns2, "Split View: zwei Hälften mit eigener Tab-Leiste über alle offenen PDFs – Tab-Klick wählt nur für diese Hälfte, dieselbe PDF geht in beiden; + öffnet in dieser Hälfte. Trennlinie verschieben."],
  ] },
  { id: "pages", icon: Files, title: "Seiten", lines: [
    [Files, "Seitenleiste: Vorschaubilder ziehen sortiert um, Rechtsklick löscht oder dreht."],
    [FilePlus, "Seite einfügen: leer, liniert, kariert, Punkte, Markdown-Seite, PDF anhängen, Bild als Seite."],
    [Bookmark, "Lesezeichen: auf die aktuelle Seite setzen, ein-/ausrücken, umbenennen."],
  ] },
  { id: "notebook", icon: NotebookPen, title: "Notizbuch, Vorlagen, Markdown", lines: [
    [NotebookPen, "Neue Notiz-PDF anlegen und beliebig Seiten mit Vorlage (liniert, kariert, Punkte) anfügen."],
    [FileCode, "Markdown-Seite: Text in Markdown schreiben, wird als Seite gesetzt – **fett**, *kursiv*, `Code`, [Link](https://…), Listen, Tabellen, Formeln $…$ und $$…$$ (offline, als Vektor). Fehlerhafte Formel bleibt als Code stehen."],
    [FilePenLine, "Bearbeiten: Doppelklick mit dem Lasso, Kontextmenü der Miniatur oder Knopf „Markdown bearbeiten“. Links Quelltext, rechts Vorschau; Esc/Fertig übernimmt (ein Undo-Schritt), Abbrechen verwirft. Striche und Objekte bleiben; liegen sie unter dem neuen Seitenende, kommt ein Hinweis."],
  ] },
  { id: "search", icon: Search, title: "Suche und Anker-Links", lines: [
    "Strg+F sucht im Text der PDF; Enter = nächster, Umschalt+Enter = voriger Treffer.",
    "Anker-Link (G): Quellbereich aufziehen, dann ins Ziel klicken (auch andere Seite); Esc bricht ab.",
  ] },
  { id: "ocr", icon: ScanText, title: "Texterkennung (OCR)", lines: [
    [ScanText, "Text erkennen: macht gescannte Seiten durchsuch- und markierbar; läuft lokal mit Windows-Texterkennung."],
  ] },
  { id: "forms", icon: ClipboardPen, title: "Formulare", lines: [
    "Vorhandene Formularfelder direkt ausfüllen; Strg+S speichert auch aus dem Feld.",
    [ClipboardPen, "Formular-Werkzeug (O): Rechteck aufziehen → neues Feld (Text, Kontrollkästchen, Auswahlliste)."],
  ] },
  { id: "save", icon: FileOutput, title: "Speichern und Speichern unter", lines: [
    [Save, "Speichern (Strg+S) schreibt in dieselbe PDF; verschlüsselte PDFs bleiben verschlüsselt."],
    [FileOutput, "Speichern unter (Strg+Umschalt+S): neues Ziel, wahlweise"],
    [Flame, "Einbrennen: Objekte fest in die Seite, Ebenen entfallen."],
    [Lock, "Mit Passwort verschlüsseln (AES-256); ohne Haken entsteht eine unverschlüsselte Kopie."],
  ] },
  { id: "undo", icon: Undo2, title: "Rückgängig", lines: [
    [Undo2, "Rückgängig (Strg+Z) und"],
    [Redo2, "Wiederholen (Strg+Y) – je Dokument, auch über Speichern hinweg."],
  ] },
  { id: "session", icon: History, title: "Wiederherstellen beim Start", lines: [
    "Beim Start ist alles wie beim Schließen: Fenster, Ansicht, Seitenleiste, Split View, Tabs, je Dokument Seite, Zoom, Ebene und Werkzeug.",
    "Das bleibt nur auf diesem Gerät, nie in der PDF. Fehlt eine Datei, fällt ihr Tab weg (Hinweis-Symbol oben); verschlüsselte PDFs fragen nach dem Passwort.",
  ] },
  { id: "pen", icon: Hand, title: "Stifttasten und Handballen", lines: [
    "Stifttasten: obere = Auswahl, untere/Radierer-Ende = Radierer; in den Einstellungen neu lernen.",
    "Handballen: Finger zählt nicht, solange der Stift aufliegt und 0,5 s danach, oder wenn die Berührung breiter als 40 px ist.",
    [Wrench, "Einstellungen: Ansicht Hell/Dunkel/System, Stifttasten, Druck an/aus, Druck-Maximum, Glättung (aus = exakt wie gezeichnet) – gilt für alle Stifte."],
  ] },
];

const EN: Chapter[] = [
  { id: "basics", icon: Save, title: "Core principle", lines: [
    "Everything you write, draw and insert is stored in the PDF itself – no extra files, no cloud, no network.",
    "Other PDF programs show your notes too; PDF Note opens them editable again.",
    [FolderOpen, "Open (or drop a PDF onto the window); each PDF gets a tab."],
    [NotebookPen, "New note PDF: creates a blank A4 page."],
  ] },
  { id: "layers", icon: Layers, title: "Layers 1/2/3", lines: [
    ...LAYERS.map(([l, icon, name]): Line => [icon, `${name} – key ${l}`]),
    "Layer 1: text and content of the original PDF. Layer 2: images, lines, arrows, rectangles, circles, coordinate systems. Layer 3: handwriting and text boxes.",
    "Tools switch the layer on their own; a click alone does not. Selecting and erasing only affect the current layer.",
  ] },
  { id: "auto", icon: ArrowLeftRight, title: "Device picks tool", lines: [
    [ArrowLeftRight, "On: pen and mouse each keep their own tool (pen = pen, mouse = select/text). Frame = mouse tool, dot = pen tool."],
    "Off: every device uses the same tool.",
  ] },
  { id: "tools", icon: PenTool, title: "Tools", lines: [
    "A shape tool (line, arrow, rectangle, circle, coordinate system, space) draws one shape, then the previous tool returns. Double-click its icon = lock (stays active).",
  ] },
  { id: "text", icon: Type, title: "Typing and editing PDF text", lines: [
    [MousePointer2, "Select/Text: click on an empty spot and type → text box (layer 3)."],
    "Selected text box: just keep typing; double-click edits it.",
    "Layer 1: double-click a paragraph of the PDF to edit the original text directly; leaving or Esc applies.",
  ] },
  { id: "select", icon: MousePointer2, title: "Selection, handles, mini bar, right-click", lines: [
    "Click or drag a frame to select; Shift adds (layer 1: Shift+drag draws the frame over text too; several paragraphs/images move together). Handles resize, the round handle rotates.",
    [Copy, "The mini bar appears above the selection (copy, cut, delete, style …)."],
    "Right-click, the menu key or Shift+F10 opens the context menu (paste, text box here, image here, forward/backward).",
    "Arrow keys move the selection by 1 pt, with Shift by 10 pt.",
  ] },
  { id: "space", icon: BetweenHorizontalStart, title: "Insert space", lines: [
    [BetweenHorizontalStart, "Insert space: drag a line – everything below moves down (or right). Only your own objects (layer 2/3) move, the PDF content stays."],
  ] },
  { id: "images", icon: ImagePlus, title: "Images", lines: [
    [ImagePlus, "Insert image (key I), paste from the clipboard (Ctrl+V) or drop it from Explorer at the drop point."],
    [Crop, "Crop: double-click the image, drag the edges; ✓ or Enter applies, Esc cancels. Cropping is permanent."],
    [RotateCw, "Rotate with the round handle (Shift = 15° steps); the rotation is saved."],
  ] },
  { id: "axes", icon: Grid3x3, title: "Coordinate systems", lines: [
    "Coordinate system tool (X): drag a rectangle → axes. In the style menu: xy or xyz (oblique), square grid.",
  ] },
  { id: "marker", icon: Palette, title: "Pens, highlighter, colour, width", lines: [
    "A highlighter stroke that starts on PDF text snaps to the text lines.",
    [Palette, "Bar: pens and highlighters. Right-click → colour, width, remove; “+” → new pen; drag to reorder. Q W E = first three pens, Shift+Q W E = first three highlighters."],
  ] },
  { id: "tabs", icon: Columns2, title: "Tabs and Split View", lines: [
    "Drag tabs to reorder; Ctrl+Tab switches.",
    [Columns2, "Split View: two PDFs side by side. Drag a tab onto a half; with Ctrl the same PDF in both halves. Move the divider."],
  ] },
  { id: "pages", icon: Files, title: "Pages", lines: [
    [Files, "Sidebar: drag thumbnails to reorder, click (Ctrl/Shift for several), right-click: delete, cut, copy, paste (also into other tabs), duplicate, rotate; Del deletes."],
    [FilePlus, "Insert page: blank, lined, squared, dots, Markdown page, append PDF, image as page."],
    [Bookmark, "Bookmarks: set on the current page, indent/outdent, rename."],
  ] },
  { id: "notebook", icon: NotebookPen, title: "Notebook, templates, Markdown", lines: [
    [NotebookPen, "Create a new note PDF and add pages with a template (lined, squared, dots)."],
    [FileCode, "Markdown page: write Markdown, it is typeset as a page – **bold**, *italic*, `code`, [link](https://…), lists, tables, formulas $…$ and $$…$$ (offline, as vectors). A faulty formula stays as code."],
    [FilePenLine, "Edit: double-click with the lasso, thumbnail context menu or the „Edit Markdown“ button. Source left, preview right; Esc/Done applies (one undo step), Cancel discards. Strokes and objects stay; a hint appears if they lie below the new page end."],
  ] },
  { id: "search", icon: Search, title: "Search and anchor links", lines: [
    "Ctrl+F searches the PDF text; Enter = next, Shift+Enter = previous hit.",
    "Anchor link (G): drag the source area, then click the target (any page); Esc cancels.",
  ] },
  { id: "ocr", icon: ScanText, title: "Text recognition (OCR)", lines: [
    [ScanText, "Recognise text: makes scanned pages searchable and selectable; runs locally with Windows text recognition."],
  ] },
  { id: "forms", icon: ClipboardPen, title: "Forms", lines: [
    "Fill in existing form fields directly; Ctrl+S also saves from inside a field.",
    [ClipboardPen, "Form tool (O): drag a rectangle → new field (text, check box, drop-down list)."],
  ] },
  { id: "save", icon: FileOutput, title: "Save and Save as", lines: [
    [Save, "Save (Ctrl+S) writes into the same PDF; encrypted PDFs stay encrypted."],
    [FileOutput, "Save as (Ctrl+Shift+S): new target, optionally"],
    [Flame, "Flatten: objects burned into the page, layers dropped."],
    [Lock, "Encrypt with password (AES-256); unchecked gives an unencrypted copy."],
  ] },
  { id: "undo", icon: Undo2, title: "Undo", lines: [
    [Undo2, "Undo (Ctrl+Z) and"],
    [Redo2, "Redo (Ctrl+Y) – per document, also across saving."],
  ] },
  { id: "session", icon: History, title: "Restore on start", lines: [
    "On start everything is as you closed it: window, view, sidebar, Split View, tabs, and per document page, zoom, layer and tool.",
    "This stays on this device only, never in the PDF. A missing file drops its tab (hint icon at the top); encrypted PDFs ask for the password.",
  ] },
  { id: "pen", icon: Hand, title: "Pen buttons and palm rejection", lines: [
    "Pen buttons: upper = select, lower/eraser end = eraser; re-learn them in the settings.",
    "Palm: a finger is ignored while the pen is down and 0.5 s after, or if the touch is wider than 40 px.",
    [Wrench, "Settings: view light/dark/system, pen buttons, pressure on/off, pressure maximum, smoothing (off = exactly as drawn) – applies to all pens."],
  ] },
];

const KEYS_ID = "keys";
/** Zeilen der Werkzeug-Tabelle (aus derselben Liste wie die Werkzeugleiste) */
const toolRows = (): [LucideIcon, string, string][] => [
  ...TOOL_LABELS.map(([, icon, name, key]): [LucideIcon, string, string] => [icon, name, keyText(key)]),
  [BetweenHorizontalStart, T.space, ""], [ImagePlus, T.image, keyText(KEYS.image)],
];
/** Kürzel-Tabelle: jeder Eintrag aus `KEYS` */
const keyRows = (): [string, string][] => Object.entries(KEYS).map(([k, v]) => [T[k as keyof typeof KEYS], keyText(v)]);

const text = (c: Chapter) =>
  [c.title, ...c.lines.map((l) => (typeof l === "string" ? l : l[1])), ...(c.id === "tools" ? toolRows().flat() : [])].join(" ").toLowerCase();

function Row({ line }: { line: Line }) {
  if (typeof line === "string") return <p>{line}</p>;
  const [I, t] = line;
  return <p className="flex gap-2"><I size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-2" />{t}</p>;
}

/** Hilfe-Seite (F1): Kapitel links, Suche, Werkzeug- und Kürzel-Tabelle aus `KEYS`/`TOOL_LABELS`; offline, folgt Sprache und Ansicht. */
export function Help({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector("input")?.focus(), []);
  const all = T === STRINGS.de ? DE : EN;
  const keysTitle = T.keysTitle;
  const needle = q.trim().toLowerCase();
  const shown = [...all, { id: KEYS_ID, icon: Keyboard, title: keysTitle, lines: [] }].filter(
    (c) => !needle || (c.id === KEYS_ID ? [keysTitle, ...keyRows().flat()].join(" ").toLowerCase() : text(c)).includes(needle));
  const go = (id: string) => ref.current?.querySelector(`#help-${id}`)?.scrollIntoView({ block: "start" });

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={T.help}
      className="fixed inset-0 z-40 flex bg-black/30 p-6 outline-none"
      onKeyDown={(e) => {
        // Tasten erreichen die Fenster- und Dokument-Kürzel nicht
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "F1") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-5xl overflow-hidden rounded-sm border border-line bg-surface text-sm text-ink shadow-raised">
        <nav className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-sunken p-2">
          <input type="search" aria-label={T.helpSearch} placeholder={T.helpSearch} className={FIELD} value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.map((c) => (
            <button key={c.id} type="button" className={BTN + " w-full justify-start px-2 text-left"} onClick={() => go(c.id)}>
              <c.icon size={16} aria-hidden className="shrink-0" />
              {c.title}
            </button>
          ))}
          {!shown.length && <p className="p-2 text-ink-3">{T.noHits}</p>}
          <div className="mt-auto pt-2">
            <IconBtn icon={CircleHelp} label={T.tourStart} text className={BTN + on(true) + " w-full px-2"} onClick={onTour} />
          </div>
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <IconBtn icon={X} label={T.close} keys={KEYS.escape} className={BTN + " absolute top-2 right-2"} onClick={onClose} />
          {shown.map((c) => (
            <section key={c.id} id={`help-${c.id}`} className="mb-6 flex max-w-2xl flex-col gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold"><c.icon size={18} aria-hidden />{c.title}</h2>
              {c.id === "tools" && (
                <table className="w-full">
                  <tbody>
                    {toolRows().map(([I, name, key]) => (
                      <tr key={name} className="border-b border-line">
                        <td className="w-8 py-1"><I size={16} aria-hidden /></td>
                        <td>{name}</td>
                        <td className="font-mono text-xs text-ink-2">{key}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.lines.map((l, i) => <Row key={i} line={l} />)}
              {c.id === KEYS_ID && (
                <table className="w-full" data-keys>
                  <thead>
                    <tr className="text-left text-ink-2"><th className="py-1 font-normal">{T.action}</th><th className="font-normal">{T.key}</th></tr>
                  </thead>
                  <tbody>
                    {keyRows().map(([name, key]) => (
                      <tr key={name} className="border-b border-line"><td className="py-1">{name}</td><td className="font-mono text-xs text-ink-2">{key}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
