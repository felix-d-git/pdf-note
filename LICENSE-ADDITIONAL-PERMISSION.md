# Zusätzliche Erlaubnis nach AGPL-3.0 §7

PDF Note steht unter der GNU Affero General Public License v3.0 (`LICENSE`). Für den eigenen Code gilt zusätzlich die folgende Erlaubnis. Maßgeblich ist der englische Text.

```
Additional permission under GNU AGPL version 3 section 7

If you modify this Program, or any covered work, by linking or combining
it with the Microsoft WebView2 Loader (WebView2LoaderStatic.lib or
WebView2Loader.dll from the Microsoft WebView2 SDK, or a modified version
of that library), containing parts covered by the terms of the Microsoft
WebView2 SDK license, the licensors of this Program grant you additional
permission to convey the resulting work. The Corresponding Source for a
non-source form of such a combination need not include the source code
of the Microsoft WebView2 Loader.
```

**Reichweite:** Die Erlaubnis betrifft nur den Code, an dem felix-d-git die Rechte hält. Die Lizenzen von Drittkomponenten, vor allem MuPDF (AGPL-3.0, Artifex), ändert sie nicht. Wie der Loader dort eingeordnet wird, steht in `docs/LIZENZ-AUDIT.md`, Abschnitt „Entscheidung R3“. Wer das Programm weitergibt, darf diese Erlaubnis nach §7 Abs. 2 entfernen.

Hintergrund: Tauri bzw. wry linkt unter Windows/MSVC über `webview2-com-sys` Microsofts `WebView2LoaderStatic.lib`. Der Loader steht unter einer BSD-artigen Microsoft-Lizenz (`THIRD-PARTY-LICENSES/Microsoft-WebView2-SDK.txt`), ist aber nur als Binärdatei erhältlich.
