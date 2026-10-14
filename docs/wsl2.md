# Windows über WSL2

Unter Windows läuft das Kit in WSL2, dem Linux, das Windows mitbringt, und arbeitet dort wie unter macOS und Linux. Diese Anleitung führt vom frischen Windows-Rechner bis zum ersten `/session-start` und zum ersten grünen `/local-check`.

## Voraussetzungen

- **Windows 11, Home oder Pro.** Windows 10 kann funktionieren, ist aber nicht der Ausgangspunkt.
- **Eingeschaltete Virtualisierung.** Im Task-Manager unter Leistung → CPU steht „Virtualisierung: Aktiviert“. Sonst wird sie im BIOS bzw. UEFI eingeschaltet.
- **Administratorrechte** für die Einrichtung. Danach arbeitest du als normaler Benutzer.

## Schritte

1. **WSL2 einschalten.** In PowerShell als Administrator (Rechtsklick auf Start → „Terminal (Administrator)“):

   ```powershell
   wsl --install
   ```

   Das schaltet WSL2 ein und lädt Ubuntu. Starte neu, wenn Windows dazu auffordert.

   Gelungen, wenn `wsl --status` in PowerShell als Standardversion `2` meldet.

2. **Ubuntu einrichten.** Nach dem Neustart öffnet sich Ubuntu, sonst startest du es aus dem Startmenü. Du legst einen Linux-Benutzer mit Passwort an, unabhängig vom Windows-Konto, und bringst das System auf den aktuellen Stand:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Gelungen, wenn `wsl -l -v` in PowerShell `Ubuntu` mit `VERSION` `2` zeigt und das Ubuntu-Terminal eine Eingabezeile wie `<name>@<rechner>:~$` anbietet.

3. **Werkzeuge installieren**, alle im Ubuntu-Terminal:

   - git: `sudo apt install -y git`
   - Node.js ab Version 18, etwa über [nvm](https://github.com/nvm-sh/nvm) mit `nvm install --lts`; das `nodejs`-Paket aus `apt` ist je nach Ubuntu-Version älter.
   - Claude Code nach der [Installationsanleitung](https://claude.ai/code) für Linux.
   - Je nach Issue-Tracker `gh` oder `glab`, dann `gh auth login` bzw. `glab auth login`. Im lokalen Modus keins von beiden.

   Gelungen, wenn `git --version`, `node --version` (mindestens `v18`) und `claude --version` je eine Version ausgeben und `gh auth status` bzw. `glab auth status` die Anmeldung bestätigt.

4. **Projekt im Linux-Dateisystem anlegen oder klonen**, unter `~/`, nicht unter `/mnt/c` (siehe [Wo das Projekt liegt](#wo-das-projekt-liegt)):

   ```bash
   cd ~
   git clone <adresse-deines-repos> mein-projekt
   cd mein-projekt
   ```

   Ein neues Projekt: `mkdir ~/mein-projekt && cd ~/mein-projekt && git init`.

   Gelungen, wenn `pwd` einen Pfad unter `/home/<name>/` ausgibt und `git status` ohne Fehler antwortet.

5. **Kit installieren**, im Projektordner:

   ```bash
   curl -O https://docs.mwolff.org/install.mjs
   node install.mjs
   ```

   Die Fragen des Installers erklärt der [5-Minuten-Guide](/quickstart#installieren).

   Gelungen, wenn `ls .claude/kit` `board.mjs` zeigt und `.claude/workflow.config.json` existiert.

6. **Claude Code starten**, auf einem von zwei Wegen:

   - **Terminal:** im Ubuntu-Terminal im Projektordner `claude` aufrufen.
   - **Claude-Desktop-App unter Windows:** als Arbeitsumgebung WSL bzw. Ubuntu wählen, als Ordner das Projekt unter `/home/<name>/`.

   In der Sitzung dann:

   ```
   /session-start
   /local-check
   ```

   Gelungen, wenn `/session-start` den Projektstand ausgibt und `/local-check` mit einer grünen Checkliste endet. In der Desktop-App lässt du zusätzlich `uname -s` ausführen; die Antwort lautet `Linux`.

## Wo das Projekt liegt

Das Projekt liegt unter `/home/<name>/`, **nicht** auf dem Windows-Laufwerk unter `/mnt/c`:

- **Geschwindigkeit.** Zugriffe auf `/mnt/c` gehen über eine Brücke zu Windows; Prüfläufe, git und Tests dauern dort ein Vielfaches.
- **Dateirechte und Zeilenenden** folgen dort den Regeln von Windows. Skripte verlieren ihr Ausführungsrecht, Zeilenenden wechseln unbemerkt.
- **Die Prüfläufe des Kits setzen POSIX-Dateirechte voraus** und schlagen dort aus dem falschen Grund fehl.

## Mit Windows-Werkzeugen arbeiten

- **Dateiexplorer.** Das Linux-Heimatverzeichnis liegt unter `\\wsl$\Ubuntu\home\<name>`; `explorer.exe .` öffnet den aktuellen Ordner.
- **Editor.** VS Code mit der Erweiterung „WSL“ öffnet das Projekt mit `code .` direkt in WSL2.

Beide Wege lassen die Dateien, wo sie sind. Kopiere das Projekt nicht auf das Windows-Laufwerk.

## Umzug von nativem Windows

Natives Windows und Git Bash werden ab 4.0.0 nicht mehr unterstützt. Wer das Kit bisher dort benutzt hat, zieht so um:

1. WSL2 nach den [Schritten](#schritte) 1 bis 3 einrichten.
2. Das Projekt aus seinem Repository neu nach `~/` klonen (Schritt 4), statt den Ordner zu kopieren. Noch nicht gepushte Commits vorher unter Windows pushen.
3. Das Kit in WSL2 neu installieren (Schritt 5).
4. Die alte `.claude/`-Kopie unter Windows nicht weiter verwenden; die Installation in WSL2 legt ihre eigene an.

Danach startest du Claude Code wie in Schritt 6.
