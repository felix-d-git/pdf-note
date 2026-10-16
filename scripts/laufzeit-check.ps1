# Laufzeit-Check gegen die echte exe (GRUNDSAETZE 1):
#  - Netz: kein Prozess des App-Baums (pdf-note + WebView2-Kinder) hat eine TCP-Verbindung nach außen
#  - Datei: nach Öffnen + Schließen liegt neben der PDF nur die PDF, unverändert
#  - eine Instanz: zweiter Start mit PDF (Pfad mit Leerzeichen/Umlaut) beendet sich, die laufende App öffnet sie (Fenstertitel)
# Bearbeiten/Speichern deckt npm run test:data ab (gleiche Rust-Pfade, ohne GUI).
# DNS läuft über den Windows-DNS-Dienst und ist hier unsichtbar; eine echte Verbindung wäre es nicht.
param(
    [string]$Exe = "$env:LOCALAPPDATA\Temp\pdf-note-target\release\pdf-note.exe",
    [string]$Pdf = (Get-ChildItem "$PSScriptRoot\..\testdata\pdfs\*.pdf" | Select-Object -First 1).FullName,
    [int]$Sekunden = 60  # WebView2-Hintergrunddienste melden sich erst nach ~20 s
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "exe fehlt: $Exe (npm run tauri build)" }
if (-not $Pdf) { throw 'keine Test-PDF (testdata/pdfs/ oder -Pdf)' }

$dir = Join-Path $env:TEMP ("pdf-note-check-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $dir | Out-Null
$kopie = Join-Path $dir (Split-Path $Pdf -Leaf)
Copy-Item $Pdf $kopie
$hash = (Get-FileHash $kopie).Hash
$dir2 = "$dir zweite Ä"
New-Item -ItemType Directory $dir2 | Out-Null
$kopie2 = Join-Path $dir2 'zweite Datei ü.pdf'
Copy-Item $Pdf $kopie2

function Baum([int]$wurzel) {
    $alle = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
    $ids = @($wurzel); $neu = @($wurzel)
    while ($neu) {
        $neu = @($alle | Where-Object { $neu -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object ProcessId)
        $ids += $neu
    }
    $ids
}
$lokal = '^(127\.|::1$|0\.0\.0\.0$|::$)'

# installierte App teilt die Instanz-Sperre (gleiche identifier) → erster Start würde sich sonst sofort beenden
if (Get-Process pdf-note -ErrorAction SilentlyContinue) { throw 'PDF Note läuft schon (eine Instanz) – erst beenden' }
$p = Start-Process $Exe -ArgumentList "`"$kopie`"" -PassThru
$zweit = $null
$start = Get-Date
$fehler = @()
$maxProz = 0
$ende = (Get-Date).AddSeconds($Sekunden)
while ((Get-Date) -lt $ende -and -not $p.HasExited) {
    $ids = Baum $p.Id
    $maxProz = [Math]::Max($maxProz, $ids.Count)
    Get-NetTCPConnection -ErrorAction SilentlyContinue |
        Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notmatch $lokal } |
        ForEach-Object { $fehler += "Verbindung: PID $($_.OwningProcess) -> $($_.RemoteAddress):$($_.RemotePort) ($($_.State))" }
    # nach dem Laden: zweiter Start, muss sich beenden und den Pfad weiterreichen
    if (-not $zweit -and ((Get-Date) - $start).TotalSeconds -gt 10) { $zweit = Start-Process $Exe -ArgumentList "`"$kopie2`"" -PassThru }
    Start-Sleep -Milliseconds 300
}
if (-not $zweit) { $fehler += 'zweiter Start nicht ausgeführt (Laufzeit zu kurz)' }
elseif (-not $zweit.WaitForExit(1000)) { Stop-Process -Id $zweit.Id -Force; $fehler += 'zweite Instanz läuft weiter' }
elseif (-not $p.HasExited) {
    $p.Refresh()
    if ($p.MainWindowTitle -notlike '*zweite Datei ü.pdf*') { $fehler += "zweite PDF nicht in der laufenden App geöffnet (Titel: $($p.MainWindowTitle))" }
}
if ($p.HasExited) { $fehler += "exe vorzeitig beendet (Code $($p.ExitCode))" }
else {
    [void]$p.CloseMainWindow()
    if (-not $p.WaitForExit(10000)) { Stop-Process -Id $p.Id -Force; $fehler += 'Fenster schließt nicht' }
}
Start-Sleep -Seconds 2  # WebView2-Kinder beenden sich verzögert

$dateien = @(Get-ChildItem -Force $dir | ForEach-Object Name)
if ($dateien.Count -ne 1) { $fehler += "Zusatzdatei neben der PDF: $($dateien -join ', ')" }
if ((Get-FileHash $kopie).Hash -ne $hash) { $fehler += 'PDF ohne Speichern verändert' }

Write-Host "Prozesse im Baum (max): $maxProz, Laufzeit: $Sekunden s, PDF: $(Split-Path $Pdf -Leaf)"
$fehler = $fehler | Select-Object -Unique
if ($fehler) { $fehler | ForEach-Object { Write-Host "FEHLER $_" }; exit 1 }
Remove-Item -Recurse -Force $dir, $dir2
Write-Host 'OK: keine Verbindung nach außen, keine Zusatzdatei, eine Instanz'
