# Windows über WSL2

Unter Windows läuft das Kit in WSL2, dem Linux, das Windows mitbringt. Diese Anleitung führt bis zum bereitstehenden WSL2 und dann zurück in [Die erste Stunde](/quickstart#_1-werkzeuge-prufen), wo es für alle weitergeht.

## Voraussetzungen

- **Windows 11, Home oder Pro.**
- **Administratorrechte** für die Einrichtung.
- **Zeit:** etwa 20 bis 40 Minuten samt Neustart.

## Schritte

1. **WSL2 einschalten.** In PowerShell als Administrator (Rechtsklick auf Start → „Terminal (Administrator)“):

   ```powershell
   wsl --install
   ```

   Das schaltet WSL2 ein und lädt Ubuntu. Starte neu, wenn Windows dazu auffordert.

   Gelungen, wenn `wsl --status` in PowerShell als Standardversion `2` meldet.

   Sonst: Meldet `wsl --install` einen Fehler zur Virtualisierung, ist sie abgeschaltet. Nachsehen: Im Task-Manager unter Leistung → CPU steht dann „Virtualisierung: Deaktiviert“. Freigeben lässt sie Administrator oder IT.

2. **Ubuntu einrichten.** Nach dem Neustart öffnet sich Ubuntu, sonst startest du es aus dem Startmenü. Du legst einen Linux-Benutzer mit Passwort an und bringst das System auf den aktuellen Stand:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Gelungen, wenn `wsl -l -v` in PowerShell `Ubuntu` mit `VERSION` `2` zeigt und das Ubuntu-Terminal eine Eingabezeile wie `<name>@<rechner>:~$` anbietet.

   Sonst: Fehlt Ubuntu in der Liste, rufe in PowerShell `wsl --install -d Ubuntu` auf.

Damit steht WSL2 bereit. Weiter geht es im Ubuntu-Terminal mit [Schritt 1 der ersten Stunde](/quickstart#_1-werkzeuge-prufen).

## Auf Firmenrechnern

- **Gesperrte Virtualisierung.** `wsl --install` scheitert wie in Schritt 1. Freigeben lässt sie Administrator oder IT.
- **Proxy.** Downloads in Ubuntu brechen ab. Die Adresse des Proxys nennt das Netzwerk-Team; trage sie als `export HTTPS_PROXY=http://<proxy>:<port>` in `~/.bashrc` ein.
- **Eigene Zertifikate des Firmennetzes.** `curl`, `npm` oder `claude` melden einen Zertifikatsfehler. Das Stammzertifikat gibt die IT-Sicherheit heraus; `export NODE_EXTRA_CA_CERTS=<pfad>` in `~/.bashrc` macht es Node.js und Claude Code bekannt.

## Der Runner unter Windows

Der Runner läuft im Ubuntu-Terminal. Drei Dinge unterbrechen ihn:

- **Geschlossenes Terminal.** Mit dem Fenster endet der Runner. Lass es offen.
- **Schlaf des Rechners.** Ein schlafender Rechner hält WSL2 an. Stelle in den Energieoptionen den Standbymodus im Netzbetrieb auf „Nie“.
- **Herunterfahren von WSL2.** Windows fährt WSL2 im Leerlauf herunter, sobald kein Terminal mehr offen ist; `wsl --shutdown` beendet es sofort. Rufe es nicht auf, solange der Runner läuft.

## Wo das Projekt liegt

Das Projekt liegt unter `/home/<name>/`, **nicht** auf dem Windows-Laufwerk unter `/mnt/c`:

- **Geschwindigkeit.** Zugriffe auf `/mnt/c` gehen über eine Brücke zu Windows; Prüfläufe, git und Tests dauern dort ein Vielfaches.
- **Dateirechte und Zeilenenden** folgen dort den Regeln von Windows. Skripte verlieren ihr Ausführungsrecht, Zeilenenden wechseln unbemerkt.
- **Die Prüfläufe des Kits setzen POSIX-Dateirechte voraus** und schlagen dort aus dem falschen Grund fehl.

## Mit Windows-Werkzeugen arbeiten

- **Dateiexplorer.** Das Linux-Heimatverzeichnis liegt unter `\\wsl$\Ubuntu\home\<name>`; `explorer.exe .` öffnet den aktuellen Ordner.
- **Editor.** VS Code mit der Erweiterung „WSL“ öffnet das Projekt mit `code .` direkt in WSL2.
- **Claude-Desktop-App.** Als Arbeitsumgebung WSL bzw. Ubuntu wählen, als Ordner das Projekt unter `/home/<name>/`. `uname -s` antwortet dort `Linux`.

Alle drei lassen die Dateien, wo sie sind. Kopiere das Projekt nicht auf das Windows-Laufwerk.

## Umzug von nativem Windows

Natives Windows und Git Bash werden ab 4.0.0 nicht mehr unterstützt. Wer das Kit bisher dort benutzt hat, zieht so um:

1. WSL2 nach den [Schritten](#schritte) 1 und 2 einrichten.
2. Die Werkzeuge installieren wie in [Werkzeuge prüfen](/quickstart#_1-werkzeuge-prufen).
3. Das Projekt neu aus seinem Repository nach `~/` klonen, siehe [Projekt anlegen](/quickstart#_4-projekt-anlegen), statt den Ordner zu kopieren. Ungepushte Commits vorher unter Windows pushen.
4. Das Kit neu installieren wie in [Kit installieren](/quickstart#_5-kit-installieren).
5. Die alte `.claude/`-Kopie unter Windows nicht weiter verwenden.

Gestartet wird Claude Code im Projektordner mit `claude`, wie in [Bei Claude anmelden](/quickstart#_2-bei-claude-anmelden).
