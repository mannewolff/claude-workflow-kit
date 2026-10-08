# Windows über WSL2

Unter Windows läuft das Kit in WSL2, dem Linux, das Windows selbst mitbringt. Dort arbeitet es genauso wie unter macOS und Linux, ohne Sonderwege. Diese Anleitung führt dich vom frischen Windows-Rechner bis zum ersten Session-Start mit `/kontext` und zum ersten grünen `/local-check`.

Natives Windows und Git Bash werden ab 4.0.0 nicht mehr unterstützt.

## Voraussetzungen

- **Windows 11, Home oder Pro.** Windows 10 kann funktionieren, ist aber nicht der Ausgangspunkt dieser Anleitung.
- **Eingeschaltete Virtualisierung.** Nachsehen kannst du das im Task-Manager: Leistung → CPU → „Virtualisierung: Aktiviert“. Steht dort „Deaktiviert“, muss sie im BIOS bzw. UEFI des Rechners eingeschaltet werden.
- **Administratorrechte** für die Einrichtung von WSL2. Danach arbeitest du als normaler Benutzer.

## Schritte

1. **WSL2 einschalten.** Öffne PowerShell als Administrator (Rechtsklick auf Start → „Terminal (Administrator)“) und gib ein:

   ```powershell
   wsl --install
   ```

   Das Kommando schaltet WSL2 ein und lädt Ubuntu herunter. Starte den Rechner danach neu, wenn Windows dazu auffordert.

   Gelungen, wenn `wsl --status` in PowerShell als Standardversion `2` meldet.

2. **Ubuntu einrichten.** Nach dem Neustart öffnet sich Ubuntu von selbst, sonst startest du es aus dem Startmenü. Beim ersten Start legst du einen Linux-Benutzernamen und ein Passwort an; beide sind unabhängig von deinem Windows-Konto. Bring das System dann auf den aktuellen Stand:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Gelungen, wenn `wsl -l -v` in PowerShell die Zeile `Ubuntu` mit `VERSION` `2` zeigt und das Ubuntu-Terminal eine Eingabezeile wie `<name>@<rechner>:~$` anbietet.

3. **Werkzeuge installieren.** Alle folgenden Kommandos laufen im Ubuntu-Terminal, nicht in PowerShell.

   - git: `sudo apt install -y git`
   - Node.js ab Version 18: zum Beispiel über [nvm](https://github.com/nvm-sh/nvm) mit `nvm install --lts`. Das `nodejs`-Paket aus `apt` ist je nach Ubuntu-Version älter als 18.
   - Claude Code: nach der [Installationsanleitung von Claude Code](https://claude.ai/code) für Linux, im Ubuntu-Terminal.
   - Je nach Issue-Tracker: `gh` (GitHub CLI) oder `glab` (GitLab CLI), danach `gh auth login` bzw. `glab auth login`. Im lokalen Modus brauchst du keins von beiden.

   Gelungen, wenn `git --version`, `node --version` (mindestens `v18`) und `claude --version` im Ubuntu-Terminal je eine Version ausgeben, und bei GitHub `gh auth status` bzw. bei GitLab `glab auth status` die Anmeldung bestätigt.

4. **Projekt im Linux-Dateisystem anlegen oder klonen.** Das Projekt liegt unter deinem Linux-Heimatverzeichnis `~/`, nicht unter `/mnt/c` (warum, steht unter [Wo das Projekt liegt](#wo-das-projekt-liegt)):

   ```bash
   cd ~
   git clone <adresse-deines-repos> mein-projekt
   cd mein-projekt
   ```

   Für ein neues Projekt stattdessen `mkdir ~/mein-projekt && cd ~/mein-projekt && git init`.

   Gelungen, wenn `pwd` einen Pfad unter `/home/<name>/` ausgibt und `git status` ohne Fehler antwortet.

5. **Kit installieren.** Im Projektordner, im Ubuntu-Terminal:

   ```bash
   curl -O https://docs.mwolff.org/install.mjs
   node install.mjs
   ```

   Die Fragen des Installers erklärt der [5-Minuten-Guide](/quickstart#installieren).

   Gelungen, wenn danach `.claude/workflow.config.json` und `.claude/kit/board.mjs` im Projekt liegen (`ls .claude/kit` zeigt `board.mjs`).

6. **Claude Code starten.** Es gibt zwei Wege, beide arbeiten mit dem Projekt in WSL2.

   - **Weg A: Terminal unter WSL2.** Im Ubuntu-Terminal im Projektordner `claude` aufrufen.
   - **Weg B: Claude-Desktop-App unter Windows.** Die App läuft unter Windows, die Sitzung arbeitet mit dem Projekt in WSL2: Wähle als Arbeitsumgebung WSL bzw. Ubuntu und als Ordner das Projekt unter `/home/<name>/`.

   In der Sitzung dann:

   ```
   /kontext
   /local-check
   ```

   Gelungen, wenn `/kontext` den Projektstand ausgibt und `/local-check` mit einer grünen Checkliste endet. Bei Weg B prüfst du zusätzlich, dass die Sitzung wirklich in WSL2 arbeitet: Bitte Claude, `uname -s` auszuführen — die Antwort muss `Linux` lauten.

## Wo das Projekt liegt

Das Projekt liegt im Linux-Dateisystem unter `~/`, also unter `/home/<name>/`, **nicht** auf dem Windows-Laufwerk unter `/mnt/c`. Drei Gründe:

- **Geschwindigkeit.** Zugriffe auf `/mnt/c` gehen über eine Brücke zwischen Linux und Windows und sind deutlich langsamer. Prüfläufe, git und Tests, die viele Dateien lesen, dauern dort ein Vielfaches.
- **Dateirechte und Zeilenenden.** Unter `/mnt/c` folgen Dateirechte und Zeilenenden den Regeln von Windows, nicht denen von Linux. Ausführbare Skripte verlieren ihr Recht, und Zeilenenden wechseln unbemerkt.
- **Die Prüfläufe des Kits setzen POSIX-Dateirechte voraus.** Auf dem Windows-Laufwerk sind sie nicht verlässlich, und Prüfungen schlagen aus dem falschen Grund fehl.

## Mit Windows-Werkzeugen arbeiten

Das Projekt bleibt im Linux-Dateisystem, und trotzdem kommst du mit Windows-Programmen daran:

- **Dateiexplorer.** Im Explorer erreichst du dein Linux-Heimatverzeichnis unter `\\wsl$\Ubuntu\home\<name>`. Schneller geht es aus dem Ubuntu-Terminal: `explorer.exe .` öffnet den aktuellen Ordner im Explorer.
- **Editor.** VS Code mit der Erweiterung „WSL“ öffnet das Projekt direkt in WSL2: im Projektordner im Ubuntu-Terminal `code .` aufrufen. Der Editor läuft unter Windows, Dateien, Terminal und Erweiterungen arbeiten in WSL2.

Beide Wege lassen die Dateien, wo sie sind. Kopiere das Projekt nicht auf das Windows-Laufwerk, um es dort zu bearbeiten.

## Umzug von nativem Windows

Wer das Kit bisher unter nativem Windows oder in der Git Bash benutzt hat, zieht so um:

1. Richte WSL2 nach den [Schritten](#schritte) 1 bis 3 ein.
2. Klone das Projekt aus seinem Repository neu nach `~/` (Schritt 4), statt den Ordner vom Windows-Laufwerk zu kopieren oder unter `/mnt/c` weiterzuarbeiten. Noch nicht gepushte Commits pushst du vorher unter Windows.
3. Installiere das Kit in WSL2 neu (Schritt 5).
4. Verwende die alte `.claude/`-Kopie unter Windows nicht weiter. Sie gehört zur Windows-Installation; die neue Installation in WSL2 legt ihre eigene an.

Danach startest du Claude Code wie in Schritt 6.
