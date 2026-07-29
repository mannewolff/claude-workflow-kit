# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Automatisch aus der Git-Historie generiert (`tools/changelog.mjs`) — nicht von Hand pflegen. Die Einträge sind die Commit-Betreffzeilen; Versionen ohne eigene Feature-Commits erscheinen nicht.

## [1.23.1] - 2026-07-29
- Hauptnav der Doku-Site bekommt "Board-UI herunterladen" (#178)
- Kommentar in blob-sync-check.yml auf den tatsächlichen Stand bringen (#177)
- board-ui.mjs über docs.mwolff.org als Download ausliefern (#176)

## [1.22.1] - 2026-07-28
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

## [1.21.1] - 2026-07-27
- Leitplanke: lang laufende Build-Checks mit explizitem Timeout (#165)

## [1.20.1] - 2026-07-27
- Changelog automatisch bei Release generieren (RELEASING.md einhaken + Doku) (#162)
- Changelog-Generator: tools/changelog.mjs + initiales CHANGELOG.md (ab v1.16) (#161)

## [1.19.1] - 2026-07-27
- night.mjs: Routing-Label statt separatem Nachtlauf-Board (--label, Default kit:nightrun) (#159)
- board.mjs: listIssues liefert labels (GitLab + Toolbox, GitHub-Platzhalter) (#158)
- Nacht-Runner: Default-Modell auf claude-opus-5 (#157)

## [1.18.2] - 2026-07-27
- fachplan-Sync: Grooming im Body statt in Kommentaren, plan/Doku-Konsistenz (#155)

## [1.18.1] - 2026-07-24
- Nacht-Runner: --verbose-Flag mit Live-Verlaufsprotokoll via stream-json (#154)
- Nachtbetrieb-Doku: Setup-Rezept in drei Schichten (Allowlist tool-weit, Sandbox, env) (#153)
- Nacht-Runner: harter Stopp bei unkommittetem Rest nach Erfolgsrunde (#152)

## [1.17.1] - 2026-07-23
- Nacht-Runner: --help-Flag fuer night.mjs (#151)
- Nachtbetrieb-Doku: Allowlist woertlich, read-only-Git, Ablehnungs-Verhalten korrigiert (#150)
- Nacht-Runner: Infrastruktur-Guard — harter Stopp bei Session-Exit ungleich 0 (#149)

## [1.16.1] - 2026-07-23
- Doku: PO-Schleife mit fachlichen Issues (#147)
- Leitplanke: fachliche Issues werden mechanisch uebersprungen (#146)
- plan- und issues-Skill: fachliches Issue als Quelle in der PO-Schleife (#145)
- fachplan-Skill: fachliche Issues im Story-Format (Schritt 1.5) (#144)
