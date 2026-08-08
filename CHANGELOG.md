# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Automatisch aus der Git-Historie generiert (`tools/changelog.mjs`) — nicht von Hand pflegen. Die Einträge sind die Commit-Betreffzeilen. Folgen mehrere Versions-Bumps unmittelbar aufeinander, stehen die Änderungen unter der höchsten davon — der Version, mit der sie veröffentlicht wurden; die internen Zwischenstände dazwischen erscheinen nicht.

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
