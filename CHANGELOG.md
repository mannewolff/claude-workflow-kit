# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Automatisch aus der Git-Historie generiert (`tools/changelog.mjs`) — nicht von Hand pflegen. Die Einträge sind die Commit-Betreffzeilen. Folgen mehrere Versions-Bumps unmittelbar aufeinander, stehen die Änderungen unter der höchsten davon — der Version, mit der sie veröffentlicht wurden; die internen Zwischenstände dazwischen erscheinen nicht. Was seit dem letzten Versions-Commit dazugekommen ist, steht unter `[Unreleased]`.

## [1.43.2] - 2026-08-31
- FENCE_ZEILE: negativer Lookahead macht die Fence-Laenge eindeutig (#403)

## [1.43.1] - 2026-08-31
- refactor: die neun super-linearen Regexe entschaerfen (#403)
- test: die Bedeutung der neun Regexe festhalten (#403)
- String.raw an vier Stellen, void-Operator raus (#402)
- test: die printf-Zeile des Vorflug-Prompts woertlich festhalten (#402)

## [1.43.0] - 2026-08-31
- package.json ohne version-Feld — die Kit-Version lebt in install.mjs
- ESLint-Leitplanke gegen die Stilfunde, 36 Fundstellen abgeraeumt (#399)
- Komplexitaet: drei Funktionen zerteilt, sechs begruendet stehen gelassen (#397)
- Regex-Laufzeit gemessen: der Aufrufvertrag schuetzt, nicht die Form (#396)
- Sonar-Workflow: bei rotem Quality Gate fehlschlagen (#395)
- night.mjs: der Fallback fuer parsePruefvorgabe traegt die echte Signatur (#394)

## [1.42.1] - 2026-08-30
- probelauf: der Exit-Status schlaegt den EPIPE-Fehler (#393)

## [1.42.0] - 2026-08-30
- issue-review: ein Fund ohne Klassenangabe gilt wie gate (#392)

## [1.41.0] - 2026-08-30
- Doku: Zustandstabelle, Klassifikation, Einrichtung, Opt-in (#388)
- Automatisches Anwenden der korrektur-Funde (#387)
- Klassifikation der Funde: gate, alternativen, korrektur (#386)
- Uebergaenge: label-sync an den Stellen der Skills aufrufen (#385)
- issue-review label-sync: Pruefzustand als Label ans Board (#384)
- kit:klaeren im Nacht-Runner nachbauen (#382)
- reviewZustand: Pruefzustand aus Body und Kommentaren ableiten (#381)
- Prozessweites Gate-Register in CLAUDE-workflow.md (#380)

## [1.40.2] - 2026-08-29
- Doku: Arbeitspakete und Vorhaben im Adapter-Abschnitt trennen (#379)
- kontext-Skill: Vorhaben laden und getrennt ausgeben (#378)
- board.mjs: Vorhaben sind keine Arbeitspakete mehr (#377)

## [1.40.1] - 2026-08-29
- toolbox-Adapter: labelIssue entsperren (#375)
- Windows-CI: den local-Ausgabetest ueber die geparste Ausgabe vergleichen (#374)

## [1.40.0] - 2026-08-28
- Doku: der Installer ist nach dem Klonen ein Pflichtschritt
- Was install.mjs schreibt, gehoert nicht ins Repo
- Die CLAUDE*.md-Dateien sind Installer-Ausgabe, nicht Repo-Inhalt
- Gate-Register: zwei Dateien, ausgeliefert wie CLAUDE-workflow.md

## [1.39.0] - 2026-08-27
- Doku: den Herkunfts-Trockenlauf beschreiben (#366)
- Herkunfts-Bericht: Bestandspruefung und CLI ueber stdin (#365)
- Herkunfts-Leser: naechster Vorfahr aus einem Karten-Body (#364)
- Doku: --derived-from beschreiben und die stille Luecke benennen (#358)
- Skills setzen --derived-from nach ihrer Stellung in der Kette (#357)
- board.mjs: --derived-from sendet die Herkunft beim Anlegen (#356)
- config: codex aus den Reviewer-Paaren genommen

## [1.38.1] - 2026-08-14
- Windows-CI: migrate-issues-Tests nehmen das Fake-gh, nicht das echte (#315)
- board.mjs: toolbox.ideaStored gilt ohne Angabe als false (#313)
- board.mjs: issue get liefert labels in allen vier Adaptern (#312)
- night.mjs: Review ohne Body-Vorschlag ist kein Erfolg (#310)
- night.mjs: parseDeps erkennt die Abhaengigkeits-Ueberschrift zuverlaessig (#308)
- Dokumentation: Lebenszyklus auch fuer Plandokumente (#299)
- kontext paths findet die Projektnotiz, statt sie zu konstruieren (#286)
- board.mjs: Labels setzen und entfernen (#249)
- Neue Spezifiskation zum spec driven development
- docs: Beispiel fuer ein Arbeitspaket mit Pruefung: Verzicht

## [1.38.0] - 2026-08-13
- Dokumentation: Pruefvorgabe, Verzicht und Verfall (#307)
- implement-Skills: Verzicht als dritter Zustand (#306)
- issue-review: Pruefvorgabe in Auswahl, Rundenzahl und Schritt 6 (#305)
- night.mjs: Verzicht als zweiter Freigabegrund, auch im Dry-Run (#304)
- issue update pflegt den Bezugsstand und sperrt maschinelle Verringerung (#303)
- roles liefert die effektive Pruefvorgabe (#302)

## [1.37.2] - 2026-08-12
- Pruefvorgabe parsen und Bezugsstand berechnen (#301)
- Marker-Beispiele, Nacht-Ausnahme und Ablageort stufengerecht (#314)

## [1.37.1] - 2026-08-12
- docs: welche Dokumente ein issue-review erfasst
- docs: einzelnes GitHub-Issue nachtraeglich nach kanban-kit ueberfuehren

## [1.37.0] - 2026-08-11
- issue-review: ein Kommando fuer drei Stufen sichtbar machen
- CLAUDE-workflow.md: Vorlage und Kopie wieder deckungsgleich
- issues: Rueckverweis auf das Plandokument (#277)
- Dokumentation: drei Pruefstufen und das Plandokument (#284)
- issue-review: Arbeitspaket auf eine Rolle (#282)

## [1.36.6] - 2026-08-11
- night.mjs: eine Pruefstufe pro Lauf ueber --stufe (#283)
- issue-review: die beiden Rollen der Plan-Stufe (#281)
- issue-review: die beiden Rollen der fachlichen Stufe (#280)
- issue-review: Stufe am Titel erkennen, drei getrennte Marker (#279)
- fachplan: Autor-Modell gehoert ins Story-Format (#273)

## [1.36.5] - 2026-08-11
- Tracker-Wechsel dokumentiert, GitHub als Archiv (#294)
- Tracker auf kanban-kit umgestellt (#293)
- Implementierungsplan für codex hinzugefügt
- migrate-issues.mjs: direct beim Import, Spalten-Abbildung im Gate (#291)

## [1.36.4] - 2026-08-11
- board.mjs: kanban-kit erwartet direct statt ideaStored (#295)
- migrate-issues.mjs: Export-Query und sechste Board-Spalte (#291)
- migrate-issues.mjs: verify-Lauf als Gate (#290)
- migrate-issues.mjs: import-Lauf mit Trockenlauf und Idempotenz (#289)
- migrate-issues.mjs: Geruest und export-Lauf (#288)
- plan: Plandokument als [Plan]-Issue anlegen (#275)
- .agents und .codex ins .gitignore übernommen wie auch .claude

## [1.36.3] - 2026-08-10
- reviewStufen-Config und issue-review roles --stufe (#278)
- Gate fuer Plandokumente: [Plan]-Titel werden nie implementiert (#276)
- Reviewer-Vorflug in einer Session statt im Runner (#269)
- config: codex-Reviewer mit festem Modell und hohem Reasoning-Aufwand
- plan: verbindliches Format fuer das Plandokument (#274)
- issue create: Body aus Datei oder stdin (#271)
- issue-review: der Reviewer darf den Bestand lesen (#268)
- Changelog: Ablauf umdrehen, unveroeffentlichte Commits als [Unreleased] (#265)

## [1.36.2] - 2026-08-08
- board.mjs: Text aus Datei oder stdin statt nur als Argument (#270)

## [1.36.1] - 2026-08-08
- issue-review: nachts nie fragen, auch bei Ausfall beim Start (#267)
- Autor-Modell erzwingen statt erbitten (#266)

## [1.36.0] - 2026-08-08
- reviewer für die review session hinzugefügt
- issue-review check: Probelauf statt reiner PATH-Suche (#262)
- Changelog: aufeinanderfolgende Bump-Marken zusammenfassen (#245)
- merge-production gibt das Tag-Kommando aus (#244)

## [1.35.0] - 2026-08-07
- issue-review: Synthese protokollieren (#242)
- Autor-Modell auf Reviewer-Kurznamen aufloesen (#241)

## [1.34.0] - 2026-08-07
- Doku: logPath gilt fuer jeden geteilten Vault, nicht nur fuer Microservices

## [1.33.0] - 2026-08-07
- Installer legt jeden Skill an, nicht nur die aus einer Liste
- Installer liefert eine Beispiel-Config aus, Vorflug gatet leere Reviewer

## [1.32.0] - 2026-08-07
- findeImPath: Pfad-Trenner folgt der Plattform, nicht dem Host (#231)

## [1.31.1] - 2026-08-07
- Doku: Nacht-Review, Backlog statt Ready, Allowlist (#236)
- night.mjs: Review-Schleife mit dreistufigem Erfolg (#235)
- night.mjs: --review-Modus mit Vorflug und Dry-Run (#233)
- issue-review: Nachtbetrieb-Zweig — Marker ja, Body nein (#234)
- night.mjs: main()-Umbau und selectReviewCandidates (#232)
- board.mjs: Kommando 'issue update' (#237)
- kommandoVerfuegbar: Dateisystem statt Prozessstart (#231)
- Windows-CI: Fake-Binary-Test ueberspringen (#230)

## [1.31.0] - 2026-08-06
- Doku: neun Schritte und Werkzeuge getrennt darstellen (#228)
- Prozesstabelle auf 1-9, acht Skills als Werkzeuge neben dem Prozess (#227)
- issue-review: Rueckfrage bei unbekanntem Autor, Konvention praezisiert (#226)
- issue-review: explizite pairs-Matrix und matrix-Kommando (#225)
- Doku: Issue-Review ueber mehrere Modelle — Referenz und Buchtext (#224)
- Nacht-Runner: ungepruefte Ready-Issues zurueckstellen (#223)
- Autor-Modell im Issue, Schema und Prozess-Doku fuer Schritt 3.5 (#222)
- Skill /issue-review: Schritt 3.5 zwischen /issues und dem GO (#221)
- board.mjs: Achse 'issue-review' fuer Reviewer-Auswahl und Vorflug (#220)

## [1.30.0] - 2026-08-06
- CLI-Grammatik gegen die echten gh/glab-Hilfetexte abgleichen (#218)
- Fake-CLIs gegen eine Kommando-Grammatik validieren (#217)
- issues-Skill: manuelle Akzeptanzkriterien vom Session-Abschluss trennen (#215)
- board.mjs: getRepoName liefert einheitlich owner/repo (#214)
- sync-blobs: Dogfooding-Kopien unter .claude/skills/ abgleichen und pruefen (#213)
- /local-check: formatFixCommand bei roten Checks einmal fahren (#212)
- Schema, Template und Doku: Zwei-Datei-Config beschreiben (#211)
- Skills: geteilte und lokale Config beschreiben, formatFixCommand nachtragen (#210)
- Kit-Repo: .gitignore auf den Block umstellen, 'git add -f'-Kruecke entfernen (#209)
- install.mjs: .gitignore-Block statt '.claude/', mit Migration (#208)
- Zwei-Datei-Config: geteilte Team-Werte, lokale Overrides mit Allowlist (#207)
- Doku: Multi-Repo-Setup und das Prinzip 'Eine Datei, ein Schreiber' (#206)
- /document: juengsten Log-Eintrag desselben Projekts als Anknuepfung (#205)
- board.mjs: 'glab issue note' statt 'issue note create' (#216)
- /kontext: Dach- und Service-Notiz laden statt nur einer Projektnotiz (#204)
- /document: Pfade aus 'kontext paths', Dach-Notiz nur mit Rueckfrage (#203)
- board.mjs: Kommando 'kontext paths' fuer die Vault-Pfad-Aufloesung (#202)

## [1.29.0] - 2026-08-05
- Installer-Tests: HOME und USERPROFILE umlenken (#187)

## [1.28.3] - 2026-08-05
- install.mjs: Frage-Antwort-Weg und Re-Install testen (#187)

## [1.28.2] - 2026-08-05
- .gitattributes: LF im Working Tree erzwingen (#197)

## [1.28.1] - 2026-08-05
- changelog.mjs: Import-Guard funktioniert unter Windows (#197)

## [1.28.0] - 2026-08-05
- night.mjs faehrt buildChecks in der Shell der Plattform (#199)
- install.mjs legt GitLab-Labels ohne Shell an (#198)
- CI: Windows in die Test-Matrix aufnehmen (#197)
- board.mjs setzt Kommandos ohne Shell ab (#196)

## [1.27.0] - 2026-07-31
- kit/night.mjs und tools/ auf 100 % Zeilenabdeckung (#189)
- kit/board.mjs auf 100 % Zeilenabdeckung (#188)

## [1.26.0] - 2026-07-30
- Modell-Selbstauskunft als X-Agent-Model-Header (#193)
- Hartes [Idee]-Gate im Nacht-Runner analog zu [Fachlich] (#192)
- Nacht-Runner uebergibt das Issue verbindlich an die Session (#191)
- KIT_ROOT-Test-Hook macht Subprozess-Coverage messbar (#186)
- PATH-Aufloesung bei git/sh begruenden statt verbiegen (#183)

## [1.25.0] - 2026-07-29
- Coverage-Report an SonarCloud anbinden (#185)
- Verbleibende acht Code Smells beseitigen (#184)
- Timeout killt die Prozessgruppe statt nur des Kindprozesses (#182)
- board-ui.mjs aus der SonarCloud-Analyse ausschliessen (#181)
- GitHub-Tracker liefert Labels (#180)
- Nacht-Runner warnt bei nirgends vorkommendem Routing-Label (#179)

## [1.24.0] - 2026-07-29
- Hauptnav der Doku-Site bekommt "Board-UI herunterladen" (#178)
- Kommentar in blob-sync-check.yml auf den tatsächlichen Stand bringen (#177)
- board-ui.mjs über docs.mwolff.org als Download ausliefern (#176)

## [1.23.0] - 2026-07-28
- Doku: Nachtbetrieb mit einem lokalen Modell (Ollama) neben Anthropic (#174)
- issue get liefert Kommentare (GitHub, GitLab, kanbancompat)
- sync-blobs.mjs frischt die .claude/kit-Kopie mit auf (#173)
- Nacht-Runner warnt bei abweichendem Versionsstempel von board.mjs (#172)
- sync-blobs.mjs stempelt die Kit-Version in board.mjs und night.mjs (#171)
- board.mjs und night.mjs tragen die Kit-Version (#170)
- Salvage: mechanisch behebbare Formatverstoesse kippen keinen Nachtlauf mehr (#169)
- Salvage-Vorpruefung liest auch .claude/settings.local.json (#168)
- Salvage-Vorpruefung mergt .claude/settings.json-env-Block
- Night-Runner-Salvage: Fehlschlag durch verifizierten Zwischenstand abfangen (#167)
- Leitplanke: im Hintergrund gestartete Pflichtchecks vor Abschluss abholen

## [1.22.0] - 2026-07-27
- Leitplanke: lang laufende Build-Checks mit explizitem Timeout (#165)

## [1.21.0] - 2026-07-27
- Changelog automatisch bei Release generieren (RELEASING.md einhaken + Doku) (#162)
- Changelog-Generator: tools/changelog.mjs + initiales CHANGELOG.md (ab v1.16) (#161)

## [1.20.0] - 2026-07-27
- night.mjs: Routing-Label statt separatem Nachtlauf-Board (--label, Default kit:nightrun) (#159)
- board.mjs: listIssues liefert labels (GitLab + Toolbox, GitHub-Platzhalter) (#158)
- Nacht-Runner: Default-Modell auf claude-opus-5 (#157)

## [1.19.0] - 2026-07-27
- fachplan-Sync: Grooming im Body statt in Kommentaren, plan/Doku-Konsistenz (#155)

## [1.18.1] - 2026-07-24
- Nacht-Runner: --verbose-Flag mit Live-Verlaufsprotokoll via stream-json (#154)
- Nachtbetrieb-Doku: Setup-Rezept in drei Schichten (Allowlist tool-weit, Sandbox, env) (#153)
- Nacht-Runner: harter Stopp bei unkommittetem Rest nach Erfolgsrunde (#152)

## [1.18.0] - 2026-07-23
- Nacht-Runner: --help-Flag fuer night.mjs (#151)
- Nachtbetrieb-Doku: Allowlist woertlich, read-only-Git, Ablehnungs-Verhalten korrigiert (#150)
- Nacht-Runner: Infrastruktur-Guard — harter Stopp bei Session-Exit ungleich 0 (#149)

## [1.17.0] - 2026-07-23
- Doku: PO-Schleife mit fachlichen Issues (#147)
- Leitplanke: fachliche Issues werden mechanisch uebersprungen (#146)
- plan- und issues-Skill: fachliches Issue als Quelle in der PO-Schleife (#145)
- fachplan-Skill: fachliche Issues im Story-Format (Schritt 1.5) (#144)
