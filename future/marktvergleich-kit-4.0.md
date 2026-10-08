# Marktvergleich: claude-workflow-kit 4.0.0 und KI-Leitstand

Stand: 08.10.2026, Tag des Release 4.0.0.
Grundlage: Repository `claude-workflow-kit` (Commit `39425b1 chore: v4.0.0`), docs.mwolff.org, kanban.mwolff.org/docs (Doku-Stand 2.4.0), öffentliche Quellen zum Markt (Liste am Ende).

Dieses Dokument ist eine Arbeitsgrundlage für ein Review mit Claude Code. Es ist keine Entscheidung. Jeder Befund und jede Maßnahme trägt eine Kennung, damit sich ein Review, ein `/fachplan` oder ein `/task` direkt darauf beziehen kann:

| Präfix | Bedeutung |
|---|---|
| `S-n` | Stärke gegenüber dem Markt |
| `U-n` | Unterschied zum Markt (weder gut noch schlecht, eine Richtungsentscheidung) |
| `L-n` | Lücke oder Schwäche |
| `H-n` | Maßnahme Hygiene (klein, sofort, kein Abwägungsbedarf, Kandidat für `/task`) |
| `P-n` | Maßnahme Performance (Durchsatz, Laufzeit, Kosten, Kontext) |
| `F-n` | Maßnahme Funktionalität |
| `R-n` | Strategisches Risiko |
| `Q-n` | Offene Frage an Manne |

Hinweise zur Belastbarkeit stehen bei den jeweiligen Aussagen. Marktaussagen stammen aus Herstellerdokumentation, Repositories und Fachartikeln. Wo nur Drittquellen vorlagen, steht „(Drittquelle)“. Wo etwas nicht verifiziert werden konnte, steht „(nicht verifiziert)“. Aussagen über das Kit sind am Code oder an der Doku belegt, mit Dateipfad.

---

## Inhalt

1. Zusammenfassung
2. Untersuchungsgegenstand
3. Bezugsrahmen: Harness Engineering
4. Marktlandschaft im Detail
5. Vergleichsmatrix
6. Stärken
7. Unterschiede
8. Lücken
9. Maßnahmen
10. Vorschlag für die Reihenfolge
11. Strategische Risiken
12. Offene Fragen
13. Quellen
14. Anhang: Begriffe des Kits und Begriffe des Markts

---

## 1. Zusammenfassung

Das claude-workflow-kit zusammen mit dem KI-Leitstand (kanban-kit) ist im Markt keine weitere Spec-Driven-Development-Lösung. Es gehört in die Kategorie, die Birgitta Böckeler im Februar 2026 auf martinfowler.com als „Harness Engineering“ beschrieben hat: Das Modell ist nur ein Teil des Agenten, der Rest ist das Geschirr aus vorwärtsgerichteten Vorgaben (Regeln, Skills, Pläne) und rückmeldenden Sensoren (Tests, Linter, Gates). Kief Morris nennt die passende Rolle des Menschen „on the loop“: Er pflegt das Geschirr, statt jedes Artefakt einzeln abzunicken.

Der Markt baut fast ausschließlich die vordere Hälfte. Spec Kit, OpenSpec, Kiro, BMAD, Agent OS und Superpowers liefern Spezifikationen, Regeln, Rollen und Slash-Commands. Harte Sensoren liefern kaum welche, und die KI-Reviews der großen Anbieter (Claude Code Review, Cursor Bugbot) sind standardmäßig nicht blockierend. Echte Blockaden entstehen im Markt fast nur durch SonarQube-Quality-Gates und Branch Protection.

Das Kit ist an genau dieser hinteren Hälfte stark: Commit-Gate, bereichsbezogene Prüfungen aus dem Importgraphen, fester Kit-Stand je unbeaufsichtigtem Lauf, die Stopp-Klasse, Labels als einmalige Vollmacht, und als Alleinstellung die Messung, ob die Leitplanken überhaupt wirken (Wirksamkeit je Prüfung, Rückläuferquote, Befunde mit Gegenprobe und Mangel-Art).

Die größten Lücken liegen bei Isolation (Sandbox, harte Werkzeuggrenzen für Reviewer), Parallelität der Umsetzung, dem Gewicht des Regeltexts, der Zugänglichkeit für Dritte (Sprache, Release-Takt, Upgrade) und bei Kosten je Karte im Leitstand.

Die Performance-Hebel mit der besten Aussicht sind: zuerst messen, wohin die Zeit eines Pakets geht (Werkzeug oder Modell), dann parallele Umsetzung unabhängiger Pakete mit einer gemeinsamen Prüfwarteschlange, und eine Kontextdiät für den Regeltext.

---

## 2. Untersuchungsgegenstand

### 2.1 claude-workflow-kit 4.0.0

**Prozess.** Der 9-Schritt-Prozess aus dem Whitepaper (`templates/CLAUDE-workflow.md`):

| Schritt | Aktor | Skill |
|---|---|---|
| 1. Anforderung | Mensch | |
| 2. Plan | KI | `/techplan` |
| 3. Plan zu Issues | KI | `/issues` |
| 4. GO | Mensch | |
| 5. Implementierung | KI | `/implement-ready` (feiner: `/implement-next`, `/implement-test`, `/implement-done`) |
| 6. Lokale Prüfung | KI und Mensch | `/local-check` |
| 7. Code-Review | KI (fremdes Modell) | `/review` |
| 8. Push | Mensch (`push main`) | `/push-main` |
| 9. Merge | Mensch (`merge production`) | `/merge-production` |

Daneben: `/kontext`, `/fachplan`, `/issue-review`, `/task`, `/retro`, `/document`, sowie der Wegweiser `/plan` (verweist auf `/techplan`).

**Bausteine im Repository (Quelle, nicht die installierte Kopie):**

| Baustein | Pfad | Umfang |
|---|---|---|
| Board-Adapter | `kit/board.mjs` plus `kit/board/*.mjs` (10 Teile) | GitHub, GitLab, lokal (Markdown), kanban-kit |
| Nacht-Runner | `kit/night.mjs` plus `kit/night/*.mjs` (10 Teile) | Umsetzungsnacht, Nacht-Kette, Prüflauf |
| Prüfwerkzeug | `kit/checks.mjs` (3.245 Zeilen) | buildChecks, checkAreas, Stufen, Teillauf, Ergebnisübernahme |
| Einstellungen | `kit/einstellungen.mjs` (4.706 Zeilen) | Oberfläche für `workflow.config.json` |
| Board-Oberfläche | `kit/board-ui.mjs` | lokale Sicht |
| Aufwand | `kit/aufwand.mjs` | Nachdenken, Werkzeugarbeit, Zielmarke |
| Wirksamkeit | `kit/wirksamkeit.mjs` | Prüfungen, Beanstandungen, Rückläufer |
| Befunde | `kit/befunde.mjs` | Fundarten, Gegenprobe |
| Preise | `kit/preise.mjs` | Preistabelle der Modelle |
| Worktrees | `kit/worktree.mjs` | Arbeitskopien der Läufe |
| Commit-Gate | `.githooks/pre-commit`, `.githooks/gate.mjs` | grüner Lauf vor jedem Commit |
| Installer | `install.mjs` (rund 2,6 MB, Blobs eingebettet) | neun Fragen |
| Regeltexte | `templates/CLAUDE-workflow.md` (59.657 Bytes), `CLAUDE-Fachplan.md`, `CLAUDE-Plan.md` | |
| Config-Schema | `templates/workflow.config.schema.json` (1.217 Zeilen) | |

**Zahlen (gemessen am 08.10.2026):**

- rund 37.300 Zeilen JavaScript unter `kit/`
- 482 Testdateien unter `test/`, CI mit `node --test`, Blob-Abgleich und SonarQube Cloud (`.github/workflows/`)
- 17 Skill-Verzeichnisse (16 Skills plus Wegweiser `/plan`)
- Regeltexte und Skills zusammen rund 344 KB, der größte Skill ist `push-main` mit 31.535 Bytes
- keine Laufzeit-Abhängigkeiten in den ausgelieferten Werkzeugen (nur `devDependencies`)
- Release-Takt: 2.0.0 am 18.09., 3.0.0 am 22.09., 4.0.0 am 08.10.2026, Issue-Nummern um 1.290

**Leitplanken im Regeltext (Auszug):**

- Drei Stopp-Punkte: GO, `push main`, `merge production`. Einzige Ausnahme: Umsetzungsstufe der Nacht-Kette unter Variante B, wo das GO an der gekennzeichneten Karte gegeben wurde.
- „Entscheiden statt fragen“ mit Entscheidungsformat `E1: … Gewählt / Verworfen / Grund / Rückbau`.
- Die Stopp-Klasse: Datenverlust, Sicherheit, Verträge nach außen, Widerspruch im Fachplan, Änderung an Gates oder Prozess, Abweichung vom fachlichen Anlass.
- Geschützte Dateien als eigene Halteform (`kit:geschuetzt`).
- „Regel im Text oder Regel im Werkzeug“: Bedienvorgabe gegen Urteilsregel, gemischte Regeln werden zerlegt.
- „Mitteilungen des Menschen“ mit fester Antwortform.
- „Reviews sind Zuarbeit“: Ob eine Stufe fertig ist, sagt ein Kommando oder ein Mensch, nie ein Modell-Marker.

**Unbeaufsichtigter Betrieb:**

- Umsetzungsnacht: Ready-Spalte von oben nach unten, eine frische Headless-Session (`claude -p`) je Paket mit `/implement-next #N`, Commit ohne Push.
- Nacht-Kette: Fachplan oder Plan wird über die Stufen `plan`, `review`, `pakete`, `abdeckung`, `umsetzung`, `vorbereitung` geführt. Ziel-Labels (`ziel:plan`, `ziel:pakete`, `ziel:umsetzung`, `ziel:push-vorbereitet`) und `planreview:1|2` steuern die Reichweite, Projektgrenzen in `night.kette.uebergaenge`.
- Prüflauf: fachliche Anforderungen tagsüber unbeaufsichtigt prüfen lassen (`kit:pruefen`).
- Fester Kit-Stand je Lauf (gebunden an `origin/<mainBranch>`).
- Laufstand am Board (`lauf:laeuft`, `lauf:abgebrochen`, `lauf:wartet`, ein ersetzter Kommentar `## Laufstand`), Lauf-ID `<host>/<pid>/<stempel>`, Übernahme verwaister Wurzeln.
- Berechtigungen der Nacht-Session: `--permission-mode auto --permission-prompts none`, wahlweise `--yolo` (`kit/night/session.mjs`, `permissionArgs`).
- Modellwahl je Session: Modellname der Karte, dann Aufgabenstufe (`night.stufen.schwer|mittel|leicht` mit `modell` und `effort` oder fremdem `kommando`), dann Modell des Laufs.

**Modell-Prüfungen:**

- `/issue-review` mit Reviewern `kind: claude` (Subagent mit Modell) oder `kind: command` (fremdes CLI, etwa Codex oder qwen), Paarung über `issueReview.pairs`, Rollen über `reviewStufen` (fachlich: form-beobachtbarkeit, abgrenzung; plan: architektur-bestand, schnitt-abhaengigkeiten; issue: pruefbarkeit).
- Jeder Fund trägt Gegenprobe, Stand der Gegenprobe und Mangel-Art (`node .claude/kit/befunde.mjs arten`).
- `/review` für den Code mit `reviewModel` oder `reviewCommand`.

### 2.2 KI-Leitstand (kanban-kit, Doku 2.4.0)

**Board:** Projekte, mehrere Boards, fünf Standardspalten, Karten mit Markdown, Labels, Fälligkeit, Zuständigen, Abhängigkeiten, Anhängen, Kommentaren und Aktivität. Dazu Mehrfachauswahl, Papierkorb mit Frist, Listenansicht mit Filtern, Spezifikations-Import (Markdown nach Überschriften, höchstens 200 Karten), Vorhaben mit Vererbung über den Abkömmlingsbaum.

**Leitstand je Board:** Laufband des letzten Laufs, Kacheln für Durchsatz je Woche, Durchlaufzeit, Umsetzungszeit und Lauf, Verbrauch an Token und Kosten (Schicht, Woche, Monat), Abbruchgründe, offene Vorhaben.

**Läufe:** Laufarten Kette, Umsetzung, Prüfung, Sitzung, Nachtplan. Vier Zustände je Arbeitspaket (Erfolg; Erfolg, Prüfung rot; gescheitert; nicht bearbeitet). Fehlerhäufigkeit je Fehlerklasse, kopierbarer Übergabetext, Stufenleiste an `[Fachlich]`- und `[Plan]`-Karten, die `kit:night` setzt. Aufbewahrung 190 Läufe je Projekt.

**Plattform-Leitstand:** aktive Läufe mit Live-Anzeige, beendete Läufe (aktuelle und vorige Schicht), Störungen mit Quittierung, Ausgänge gelungen, nicht gelungen, mit Vorbehalt, nicht angelaufen. Stillefrist 90 Minuten ohne Herzschlag. Teilnahme je Projekt freiwillig.

**Token und Kosten:** Läufe und Sitzungen getrennt, Eingabe (gecacht und frisch), Ausgabe, Kosten; Verbrauch „ohne Karte“ wird nicht verteilt; Lücken werden als „nicht erfasst“, „teilweise erfasst“, „nicht gemessen“ ausgewiesen, nie als 0.

**Technik und Betrieb:** OpenAPI 3 unter `/administration/api`, Bestätigung für schreibende Aufrufe, Rate Limiting mit HTTP 429 und Backoff im Adapter, Idempotenzschlüssel (24 Stunden), Projekt-Token, Header `X-Night-Run`. Rollen USER und ADMIN plattformweit, OWNER, ADMIN, MEMBER, VIEWER je Projekt. Betrieb per Docker, Backup mit privatem Schlüssel, Produktion hinter Traefik.

**Dokumentierte Grenzen:** keine Kosten je Karte, Nachtpläne nicht persistent, Labelfilter nur in der Listenansicht, Stillefrist ohne Oberfläche, Vorhabenfilter nur direkt, Veröffentlichen bewusst manuell, interaktive Sitzungen in frischen Worktrees werden nicht erfasst (Befund #1008).

---

## 3. Bezugsrahmen: Harness Engineering

Drei Quellen ordnen den Markt im Jahr 2026 und passen auffällig genau auf das Kit.

**Böckeler, „Harness Engineering“ (Februar 2026).**
- Agent = Modell + Geschirr (Harness).
- Guides wirken vorwärts (AGENTS.md, Skills, Specs), Sensors melden zurück (Linter, Tests).
- Kontrollen sind entweder berechnend und deterministisch (Tests, Typprüfung, Linter) oder schlussfolgernd (LLM-Review, LLM als Richter).
- Empfehlung: Qualität nach links ziehen, und der Mensch verbessert das Geschirr, wenn ein Problem wiederkehrt.
- Schwächste Stelle der heutigen Praxis: die Prüfung des Verhaltens, weil sie sich zu sehr auf KI-geschriebene Tests stützt.

**Morris, „Humans and Agents in Software Engineering Loops“ (März 2026).**
- „On the loop“: Der Mensch pflegt Specs, Qualitätsprüfungen und Workflow-Vorgaben, statt jedes Artefakt zu prüfen.
- „Agentic flywheel“: Agenten schlagen Verbesserungen am Geschirr vor.

**Thoughtworks Technology Radar Vol. 34 (April 2026).** Thema „Coding Agents an die Leine nehmen“. Relevante Einträge:

| Eintrag | Ring |
|---|---|
| AGENTS.md / CLAUDE.md als gepflegte Team-Anweisungen | Adopt |
| Feedback sensors for coding agents | Trial |
| Agent Skills | Trial |
| Sandboxed execution for agents | Trial |
| Team of coding agents | Assess |
| Ralph loop | Assess |
| Feedback flywheel | Assess |
| Measuring collaboration quality (Erstabnahme, Nacharbeit) | Assess |
| GitHub Spec Kit | Assess |
| OpenSpec | Assess |
| Agent instruction bloat | Caution |
| Coding agent swarms | Caution |

Das Radar hält fest, dass „Spec-Driven Development“ und „Harness Engineering“ sich überlappen und uneinheitlich gebraucht werden. Der eigenständige SDD-Eintrag vom November 2025 steht nicht mehr in der aktuellen Ausgabe.

**Abgleich mit dem Kit.** Die Unterscheidung „Bedienvorgabe gegen Urteilsregel“ im Abschnitt „Regel im Text oder Regel im Werkzeug“ ist inhaltlich dieselbe wie Böckelers „computational gegen inferential“. Die Wirksamkeitsmessung ist eine konkrete Umsetzung von „Measuring collaboration quality“. Die Retro mit Schärfung der Regeln ist der Flywheel in menschlicher Hand. Beim Gewicht des Regeltexts trifft die Warnung „Agent instruction bloat“ das Kit selbst (siehe `L-5`).

---

## 4. Marktlandschaft im Detail

Für jede Lösung: Was sie ist, Stand, wie der Mensch Leitplanken setzt, welche harten Prüfungen außerhalb des Modells es gibt, unbeaufsichtigter Betrieb, Board und Sicht, Messung, Preis, Kritik und der Abgleich mit dem Kit.

### 4.1 Spec-Driven Development

#### GitHub Spec Kit

- **Was:** CLI `specify` (Python, uv), das Slash-Commands und Vorlagen für über dreißig Agenten anlegt. Ablauf Constitution, Specify, Plan, Tasks, Implement, inzwischen mit einem Schritt `converge`. Mitgelieferte Erweiterungen für Fehlerbehebung (bewerten, beheben, testen) und Ideenbewertung (bis go oder kill). Katalog mit rund hundert Community-Erweiterungen (Stand Mai 2026).
- **Stand:** 1.0.3 vom 01.09. (Jahr nicht angezeigt, aus den Versionsnummern auf 2026 geschlossen). Rund 139.000 Sterne (Webseite, nicht über die API geprüft).
- **Leitplanken durch den Menschen:** Constitution mit Projektprinzipien, Review der Spec, Klärungs- und Checklistenschritte, Konsistenzanalyse.
- **Harte Prüfungen:** schwach. Im Kern Prompts und Vorlagen. Die Fehlerbehebung endet mit einem Urteil verified, partial oder failed.
- **Unbeaufsichtigt, Board, Messung:** nichts eingebaut. Kostenverfolgung nur als Erweiterung im Katalog. Ein Branch je Spec, kein Board.
- **Kritik:** Böckeler: viele Dateien schon für mittlere Features, „lieber reviewe ich Code als all diese Markdown-Dateien“, der Agent ignorierte Recherchenotizen und erzeugte Duplikate. Spec-first, nicht spec-anchored. Der Maintainer selbst nennt Agenten „einen sehr fähigen Praktikanten“, die Zuverlässigkeit sinkt nach der Verdichtung des Kontexts.
- **Abgleich:** Spec Kit ist breit und portabel, das Kit ist tief und erzwingt. Spec Kit hat nichts, was dem Commit-Gate, dem festen Kit-Stand, der Stopp-Klasse oder dem Nachtbetrieb entspricht. Was Spec Kit hat und das Kit nicht: Agent-Neutralität, einen Upgrade-Befehl (`specify self upgrade`, laut Memory bereits Vorbild für ein geplantes Kit-Upgrade) und einen Erweiterungskatalog.

#### OpenSpec (Fission AI)

- **Was:** schlanke SDD-Lösung für bestehenden Code. Jede Änderung bekommt einen Ordner mit Vorschlag, Delta-Specs (ADDED, MODIFIED, REMOVED), Design und Tasks. Beim Archivieren wandern die Deltas in die lebenden Specs. Befehle `/opsx:explore`, `propose`, `apply`, `archive`, `verify`.
- **Stand:** 1.13.2 laut CHANGELOG, rund 67.000 Sterne, MIT.
- **Harte Prüfungen:** Validierung der Delta-Specs im CLI, Archiv verweigert doppelte Anforderungen. Prüft die Specs, nicht den Code.
- **Unbeaufsichtigt, Board, Messung:** nein.
- **Abgleich:** OpenSpec löst ein Problem, das das Kit seit Plan #825 bewusst nicht mehr löst: eine fortgeschriebene Beschreibung des Systemverhaltens im Repository (siehe `U-2` und `F-8`).

#### AWS Kiro

- **Was:** Spec-getriebene IDE, dazu CLI (headless, CI), Web und Mobile (Preview) mit gemeinsamer Konfiguration unter `.kiro/`. Requirements als User Stories mit GIVEN/WHEN/THEN, dann Design, dann Tasks. Eigene Bugfix-Specs.
- **Leitplanken:** Steering-Dateien für Projektstandards. Agent-Hooks mit Auslösern PostFileSave, PreToolUse, PostToolUse, Stop; Aktionen sind Shell-Kommandos oder Agent-Prompts. PreToolUse kann gefährliche Aktionen sperren.
- **Unbeaufsichtigt:** autonomer Agent seit Dezember 2025 in Preview. Bis zu zehn Aufgaben parallel in isolierten Sandboxes, ausgelöst über das Label `kiro` oder einen Kommentar `/kiro` am GitHub-Issue. Öffnet PRs, lernt aus PR-Feedback, hat einen Verifikations-Subagenten, fragt bei Unklarheit nach. Netz, MCP und Secrets je Aufgabe steuerbar. Endet im PR, kein automatischer Merge.
- **Integration:** Jira, GitHub, GitLab, Slack, Confluence.
- **Preis:** Free 50 Credits, Pro 20 USD für 1.000, Pro+ 40 USD, Pro Max 100 USD, Power 200 USD, Enterprise individuell, Zusatz-Credits 0,04 USD.
- **Kritik:** schwer für kleine Aufgaben (Böckeler: aus einem Bugfix wurden vier User Stories), Kosten durch das Credit-Modell schwer vorherzusagen.
- **Abgleich:** Kiro ist der stärkste kommerzielle Gegenentwurf. Label am Issue als Auslöser entspricht der Geste `kit:night`. Kiro hat Sandbox und Parallelität (`L-1`, `L-4`), das Kit hat Stopp-Klasse, festen Kit-Stand, Messung der Prüfungen und behält das GO beim Menschen. Kiros „fragt bei Unklarheit nach“ ist weniger scharf als die Stopp-Klasse, die festlegt, welche Fragen überhaupt anhalten dürfen.

#### Tessl

- **Was:** gestartet als „Spec as Source“ mit Regeneration aus der Spec, seit Januar 2026 neu positioniert als Registry für Skills und Plugins mit Evals und Policy-Gates.
- **Stand:** Framework im Sommer 2026 weiter in geschlossener Beta (Drittquelle). Preis: Free 1.000 Credits, Team 100 USD im Monat, Enterprise mit SSO, Audit, eigenen Modellen.
- **Kritik:** Regeneration aus derselben Spec ergab unterschiedlichen Code (auch bei Böckeler beobachtet), Wasserfall-Risiko.
- **Abgleich:** Für das Kit vor allem als Hinweis relevant: Governance über Skills (welche Skill-Version läuft wo) wird zum bezahlten Markt. Das Kit löst den Teil „welche Regeln galten in diesem Lauf“ bereits mit dem festen Kit-Stand.

### 4.2 Methodenkits und Community-Werkzeuge

| Werkzeug | Stand | Konzept | Harte Prüfungen | Abgleich |
|---|---|---|---|---|
| BMAD-METHOD | 6.12.0, rund 54.000 Sterne, MIT | Agile Rollen als Skills (Produkt, Architektur, UX, Entwicklung, Test). Modul „BMad Loop“ baut, verifiziert und retrospektiert ein ganzes Epic unbeaufsichtigt. Ab 6.11 adaptive Prozesstiefe, Review-Triage mit Urteil und Beleg je Fund, AGENTS.md-Erzeugung. | im Kern Prompts, Test-Architect-Modul, keine harten Git- oder Hook-Gates gefunden | ähnliche Idee bei der Befund-Triage. Häufige Breaking Changes, Kern-Skills von 14 auf 8 gekürzt. Das ist dasselbe Muster wie beim Kit (`L-6`). |
| Superpowers (obra) | v5 März 2026, MIT, portiert auf Codex, Gemini CLI, Cursor, OpenCode, Factory, Copilot CLI | Brainstorm, Spec, Plan, subagentengetriebene Entwicklung, TDD, Review | Durchsetzung über Skill-Text, keine Hooks | Kritik: aufgebläht, tokenhungrig, teils von nativer Plan-Funktion überholt |
| Agent OS (Builder Methods) | v3 Januar 2026 | auf Standards und Specs eingedampft, Orchestrierung und Subagenten entfernt | keine | Der Autor sagt selbst, dass der native Plan-Modus seine Orchestrierung ersetzt hat. Warnsignal für `R-1`. |
| Taskmaster AI | rund 28.000 Sterne, MIT mit Commons Clause | PRD zu Aufgabenliste über MCP, mehrere Anbieter | keine | nur Zerlegung, kein Gate, kein Board |
| SuperClaude | 4.3.0 | 30 Kommandos, 20 Personas, 7 Modi | keine | Prompt-Paket |
| claude-flow / Ruflo | Alpha-Releases im Tagestakt (Drittquelle) | Schwärme, Konsens, Vektorspeicher, über 300 MCP-Tools | keine belegt | Thoughtworks: Coding agent swarms auf „Caution“ |
| CCPM | rund 8.400 Sterne (Drittquelle), letzter Commit etwa ein halbes Jahr alt | PRD, Epic, Tasks als GitHub-Issues, Worktrees für parallele Agenten | keine | Issue als Quelle der Wahrheit wie im Kit (C3), wirkt eingeschlafen |

### 4.3 Board als Steuerzentrale und Cloud-Agenten

#### GitHub Copilot Coding Agent, Agent HQ, Mission Control

- **Agent HQ** (Universe, 28.10.2025): Mission Control zum Zuweisen, Steuern und Verfolgen von Agenten aus GitHub, VS Code, Mobile und CLI. Branch-Kontrollen für CI auf Agenten-Code. Integrationen Slack, Linear, Jira, Teams, Azure Boards. Control Plane mit Sicherheitsrichtlinien, Audit-Log, Zugriffssteuerung für Agenten und Modelle. Copilot-Metriken und GitHub Code Quality in Preview.
- **Claude und Codex als wählbare Agenten** (26.02.2026, Public Preview): ein Issue kann mehreren Agenten zugewiesen werden, um Ansätze zu vergleichen. Steuerung über `@claude`, `@codex`, `@copilot` in Kommentaren. Agent Control Plane GA.
- **Cloud-Agent:** flüchtige Umgebung, eine Aufgabe ergibt einen PR auf einem Branch, maximal 59 Minuten je Sitzung. Custom Agents, Skills, MCP, Hooks. Rulesets können ihn blockieren.
- **GitHub Agentic Workflows** (Technical Preview, 13.02.2026, MIT): Automationen in Markdown, kompiliert zu Actions. Standardmäßig nur lesend, Agenten in Sandbox ohne Netz, Schreiben nur über vorab freigegebene „safe outputs“.
- **Preis:** laut Drittquelle seit 01.06.2026 tokenbasierte „AI Credits“ (nicht verifiziert).
- **Abgleich:** der nächste Großanbieter-Verwandte zu Board plus Leitstand. Stark bei Governance, Audit und Mehrfach-Zuweisung. Specs und Fachplan-Stufen kennt Agent HQ nicht. Die „safe outputs“ der Agentic Workflows sind ein Muster, das zum Kit passt (`F-2`).

#### OpenAI Codex und Symphony

- **Codex:** CLI, IDE, Cloud, SDK, GitHub Action, nicht-interaktiver Modus, geplante Aufgaben. Cloud-Aufgaben laufen in eigener Umgebung weiter, wenn der eigene Rechner schläft. Hooks in `.codex/hooks.json` (PreToolUse, PermissionRequest, PostToolUse, UserPromptSubmit, Stop). Die Doku sagt selbst: Hooks sind eine nützliche Leitplanke, keine vollständige Durchsetzungsgrenze.
- **Symphony** (27.04.2026): Open-Source-Orchestrator, bei dem ein Linear-Board die Steuerzentrale ist. Jede offene Karte bekommt einen eigenen Agenten-Arbeitsbereich, Ticketstatus wirken als Zustandsmaschine, hängengebliebene Agenten werden neu gestartet. Agenten planen, zerlegen in Abhängigkeitsbäume, legen Folgekarten an und bewegen die Arbeit bis Review und Merge, gesteuert über `WORKFLOW.md`. Behauptet „500 Prozent mehr gelandete PRs“ ohne Methodik. OpenAI pflegt es ausdrücklich nicht als Produkt und merkt an, dass die Zuweisung auf Ticket-Ebene das Nachsteuern mitten in der Aufgabe wegnimmt.
- **`openai/codex-plugin-cc`** (31.03.2026, Drittquelle): `/codex:review` und `/codex:adversarial-review` in Claude Code, optional ein Review-Gate, das Claude erst nach Codex-Review abschließen lässt.
- **Abgleich:** Symphony ist konzeptionell der engste Verwandte der Nacht-Kette. Unterschiede: Symphony lässt Agenten bis zum Merge laufen, das Kit hält drei Stopp-Punkte. Symphony hat keine Stopp-Klasse, keinen festen Regelstand, keine Messung. Das Codex-Plugin zeigt, dass Modell-Review über Anbietergrenzen inzwischen auch von Herstellern geliefert wird. Das Kit hat diese Fähigkeit über `kind: command` schon länger.

#### Google Jules

- Asynchroner Agent, ausgelöst über das Label `jules` am Issue, zeigt einen Plan zur Freigabe, liest CI-Fehler seiner eigenen PRs und behebt sie. Free 15 Aufgaben am Tag (3 parallel), AI Pro 100, AI Ultra 300 (Drittquelle, Mai 2026).
- **Abgleich:** Die Plan-Freigabe ist ein Stopp-Punkt, aber pro Aufgabe und nicht als Klasse definiert. Bekannte Schwäche: besteht vorhandene Tests und bricht ungetestetes Verhalten (dasselbe Thema wie `L-3`).

#### Cursor

- Cursor 3 (April 2026) mit Agents Window über lokale, Cloud- und Cloud-Subagenten-Sitzungen, ein Worktree und Branch je Cloud-Agent, `/babysit` als PR-Vorbereitungsschleife (Drittquelle).
- Hooks mit Exit-Code 2 als Sperre, standardmäßig „fail open“, nur mit `failClosed: true` geschlossen. Team- und Enterprise-Hooks zentral verteilbar.
- Bugbot mit `blockMergeOnSeverity`, standardmäßig aus. Cursor hat Graphite im Dezember 2025 übernommen.
- Preis: Individual ab 20 USD, Teams 40 USD je Nutzer, Enterprise individuell.
- **Abgleich:** Cursor zeigt, wohin sich Hooks bewegen: zentral verteilte, geschlossen versagende Hooks. Das Kit hat mit dem Commit-Gate einen geschlossenen Mechanismus, aber lokal und umgehbar (`L-2`).

#### Devin (Cognition) und Factory Droids

- **Devin:** autonomer Cloud-Entwickler (VM mit Shell, IDE, Browser), nimmt Linear- und Jira-Tickets, Slack und Teams, API, viele Aufgaben parallel. Preis laut devin.ai: Free, Pro 20 USD, Max 200 USD, Teams 80 USD Basis plus 40 USD je Platz. Erfahrungsberichte: gut bei gut geschnittener, wiederkehrender Arbeit (Upgrades, Lint, Testnachrüstung), schwach bei unklarer Feature-Arbeit.
- **Factory:** modellunabhängige Enterprise-Plattform (CLI, IDE, Slack, Linear, Web), Integrationen GitHub, GitLab, Jira, Sentry, PagerDuty, verwaltete Cloud-Maschinen, „Agent Readiness“-Bewertung, Self-Improvement „Signals“. Finanzierung zuletzt laut Drittquelle 200 Mio. USD bei 5 Mrd. USD Bewertung (September 2026).
- **Abgleich:** Beide beweisen den Bedarf an „gut geschnittener Arbeit“. Das ist im Kit die Stufe `pakete` mit Abdeckung gegen den Fachplan. Factorys „Agent Readiness“ ist ein Gedanke, den das Kit mit der Wirksamkeitsmessung bereits auf Prüfungsebene hat.

### 4.4 Claude Code nativ

Claude Code liefert inzwischen viele Bausteine, die das Kit selbst gebaut hat. Für die Bewertung wichtig:

| Baustein | Stand | Bedeutung für das Kit |
|---|---|---|
| Hooks | rund 30 Ereignisse (u. a. PreToolUse, PostToolUse, Stop, SubagentStop, WorktreeCreate, TaskCompleted), Handler command, http, mcp_tool, prompt, agent | Exit 2 sperrt. Ein Timeout oder ein anderer Fehlercode sperrt nicht. Für ein deterministisches Gate heißt das: Hooks versagen offen. |
| Routines (Research Preview) | Cloud-Prompts mit Zeitplan (mindestens stündlich), API- und GitHub-Auslösern, pushen auf `claude/`-Branches | widerspricht dem Grundsatz „nachts nie pushen“. Der Status in der Laufliste heißt nur, dass die Session ohne Infrastrukturfehler endete, nicht dass die Aufgabe gelang. Das Kit misst Erfolg am Board, das ist strenger. |
| Agent View, Hintergrund-Sessions (Research Preview) | `claude agents`, `claude --bg`, ein Worktree je Session, lokal | Baustein für parallele Umsetzung (`P-2`) |
| Dynamic Workflows (Juni 2026) | Claude schreibt sich ein aufgabenspezifisches Geschirr mit Subagenten und adversarialen Prüfern | schlussfolgernde Kontrolle, also das Gegenteil der Kit-Philosophie, aber als Konkurrenz zur Kette relevant |
| GitHub Actions (`claude-code-action@v1`) | `@claude`, Zeitpläne, Skills, Plugins | Option für serverseitige Prüfungen |
| Code Review (Research Preview) | Multi-Agent-Review mit Verifikation und Schweregraden, `REVIEW.md`, laut Doku im Schnitt 15 bis 25 USD je Review | Check-Run endet immer „neutral“, blockiert also nie |
| Telemetrie | OpenTelemetry mit `cost.usage`, `token.usage`, `commit.count`, `pull_request.count`, `tool_decision` (auch `source=hook`) | Ersatz oder Ergänzung zur eigenen Transkript-Auswertung (`F-6`) |
| Abrechnung programmatischer Nutzung | laut The Register und The New Stack seit 15.06.2026 eigenes Guthaben für Agent SDK, `claude -p` und GitHub Actions, Überlauf zu API-Preisen | betrifft jeden Nachtlauf direkt (`R-2`). Bitte gegen den eigenen Plan prüfen. |

### 4.5 Externe Prüfwerkzeuge

- **SonarQube Server 2026.4:** eingebautes Gate „Sonar way for agentic AI“ auf neuem Code. Bedingungen: Zuverlässigkeit ab Low, Sicherheit ab Low, Wartbarkeit ab Medium, Abhängigkeitsrisiken ab Low, Coverage mindestens 80 Prozent, Duplikation höchstens 3 Prozent. Dazu Lieferkettenprüfungen (vertippte, erfundene oder verwundbare Pakete). Plugins für Claude Code, Cursor, Codex, Copilot CLI und ein MCP-Server. Das ist das härteste blockierende Gate am Markt.
- **CodeRabbit:** Essentials 24 USD, Team 48 USD, Advanced 72 USD je Entwickler und Monat, eigene Pre-Merge-Checks (10 bzw. 20), Jira und Linear, CLI- und IDE-Reviews.
- **Qodo:** Regeln, Multi-Agent-Review, CLI-Qualitätsschicht für Codex, Claude und Kiro, Credit-Modell, Enterprise mit eigenem LLM und On-Prem.
- **Muster:** Review-Werkzeuge beraten. Blockieren tun Quality Gates und Branch Protection. Das Kit liegt hier mit „Reviews sind Zuarbeit“ auf derselben Linie wie die ehrlicheren Anbieter und weiter als die Werbung der meisten.

### 4.6 Agenten-Boards und Orchestrierungsoberflächen

| Werkzeug | Stand | Konzept |
|---|---|---|
| Vibe Kanban (Bloop) | Einstellung am 10.04.2026 angekündigt, Code Apache 2.0, Cloud abgeschaltet | Kanban, das Agenten in Worktrees startet |
| Conductor (Melty Labs) | kostenlose macOS-App | parallele Agenten in Worktrees mit Diff-Panel |
| Crystal | im Februar 2026 eingestellt, Nachfolger Nimbalyst (Closed Source) | Worktree-Oberfläche |
| Sculptor (Imbue) | kostenlose Beta, MIT | ein Docker-Container je Agent |
| Terragon | nicht mehr aktiv | Cloud-Agenten |
| Claude Squad | kostenlos | TUI auf tmux und Worktrees |

Die Kategorie „Board für Agenten“ hat kein tragfähiges Geschäftsmodell gefunden. Was überlebt, steckt in den Plattformen (Agent HQ, Agent View) oder hat Tiefe jenseits der Oberfläche. Der KI-Leitstand hat diese Tiefe (Laufzustände, Störungen, Kosten, Lücken), lebt aber vom Kit (`R-4`).

### 4.7 Belege zur Wirksamkeit

- **METR:** Die Untersuchung von 2025 fand erfahrene Entwicklerinnen und Entwickler mit KI 19 Prozent langsamer. Das Update vom Februar 2026 fand etwa 18 Prozent schneller, nennt die Daten aber selbst ein „unzuverlässiges Signal“, weil viele Teilnehmende ohne KI gar nicht mehr arbeiten wollten.
- **DORA 2025** (rund 5.000 Befragte): KI verstärkt Stärken und Schwächen. Mehr Durchsatz, aber auch mehr Instabilität in der Auslieferung.
- **CodeRabbit** (470 Open-Source-PRs, Herstellerstudie): KI-PRs mit rund 1,7-mal mehr Befunden, Logikfehler 1,75-mal.
- **Faros AI Q2 2026** (rund 22.000 Entwickler, Herstellertelemetrie): Aufgabendurchsatz plus 34 Prozent, Vorfälle je PR etwa dreimal so hoch, mittlere Reviewzeit etwa fünfmal so lang, Auslieferungen je Woche minus 11,7 Prozent.
- **Asana** (drei Monate SDD intern): 524 PRs, plus 38 Prozent PRs je Woche, aber das Review der Specs wurde zum Engpass, und eine detaillierte Spec verfestigte einen falschen Migrationsansatz.
- **StrongDM „Software Factory“:** Menschen schreiben und reviewen keinen Code mehr, rund 1.000 USD Token je Ingenieur und Tag, Szenariotests liegen als Holdout außerhalb der Codebasis. Simon Willison zweifelt an Kosten und Nachweisbarkeit.

**Folgerung für das Kit:** Der Markt hat kaum belastbare Zahlen zur Qualität. Das Kit misst genau die Größen, die fehlen (Rückläufer, Wirksamkeit je Prüfung, Befunde je Art, Kosten je Lauf). Veröffentlicht ist davon nichts (`L-10`, `F-12`).

---

## 5. Vergleichsmatrix

Legende: ● vorhanden und belastbar, ◐ teilweise oder in Preview, ○ nicht vorhanden oder nicht gefunden.

| Fähigkeit | Kit + Leitstand | Spec Kit | OpenSpec | Kiro | BMAD | Copilot Agent HQ | Symphony | Devin/Factory | Claude Code nativ |
|---|---|---|---|---|---|---|---|---|---|
| Fachliche Anforderung als eigene Stufe | ● Fachplan, PO-Schleife | ● Spec | ● Proposal | ● Requirements | ● PRD | ○ | ○ | ◐ Ticket | ○ |
| Plan als eigene geprüfte Stufe | ● | ● | ● Design | ● | ● | ○ | ◐ | ◐ | ◐ Plan-Modus |
| Prüfung der Dokumente durch fremde Modelle | ● Rollen, Paarung, Gegenprobe | ○ | ○ | ○ | ◐ adversarial Personas | ◐ Mehrfachzuweisung | ○ | ○ | ○ |
| Definierte Stopp-Klasse | ● | ○ | ○ | ◐ fragt nach | ○ | ○ | ○ | ○ | ○ |
| Feste menschliche Stopp-Punkte | ● GO, Push, Merge | ◐ | ◐ | ● PR | ◐ | ● PR | ○ bis Merge | ● PR | ◐ |
| Commit-Gate mit Nachweis | ● lokal | ○ | ○ | ◐ Hooks | ○ | ● Branch Protection | ○ | ◐ CI | ◐ Hooks, versagen offen |
| Fester Regelstand je Lauf | ● Kit-Stand | ○ | ○ | ○ | ○ | ◐ Control Plane | ○ | ○ | ○ |
| Bereichsbezogene Prüfung aus Importgraph | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Unbeaufsichtigter Betrieb | ● Nacht, Kette, Prüflauf | ○ | ○ | ◐ Preview | ● Loop | ● | ● | ● | ◐ Routines |
| Parallele Umsetzung | ○ | ○ | ○ | ● 10 | ○ | ● | ● | ● | ◐ |
| Sandbox / Isolation | ○ | ○ | ○ | ● | ○ | ● | ◐ | ● | ◐ |
| Board als Steuerung | ● Labels als Vollmacht | ○ | ○ | ◐ | ○ | ● | ● | ● | ○ |
| Leitstand mit Läufen und Störungen | ● | ○ | ○ | ◐ | ○ | ● | ○ | ● | ◐ Agent View |
| Kosten je Lauf | ● | ○ | ○ | ◐ | ○ | ◐ | ○ | ◐ | ● OTel |
| Kosten je Karte / Vorhaben | ◐ je Vorhaben, nicht je Karte | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Wirksamkeit der Prüfungen | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Qualitätskennzahlen (Rückläufer, Befund-Arten) | ● im Kit, ◐ im Leitstand | ○ | ○ | ○ | ◐ Triage | ◐ Preview | ○ | ○ | ○ |
| Mehrere Anbieter | ◐ Reviewer, Aufgabenstufen | ● | ● | ◐ | ● | ● | ○ Codex | ● | ○ |
| Agent-neutral | ○ an Claude Code gebunden | ● 30+ | ● 30+ | ○ | ● | ◐ | ○ | ◐ | ○ |
| Selbst hostbar, ohne Anbieter-Cloud | ● | ● | ● | ○ | ● | ○ | ● | ◐ Enterprise | ◐ |
| Sprache der Doku | Deutsch | Englisch | Englisch | Englisch | Englisch | Englisch | Englisch | Englisch | Englisch |

---

## 6. Stärken

### S-1 Die Stopp-Klasse und „Entscheiden statt fragen“

**Befund.** `templates/CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen“. Nur sechs Fragearten halten eine Session an, jeder Halt trägt genau eine Frage, alles andere wird entschieden und im Format `E1 … Gewählt / Verworfen / Grund / Rückbau` protokolliert. Schiedsrichter ist die Ordnung „Prioritäten bei Zielkonflikten“, im Zweifel gewinnt der kleinste rückbaubare Eingriff.

**Markt.** Kiro und Jules fragen nach, wenn sie unsicher sind. Welche Fragen anhalten dürfen, legt dort niemand fest. Asana hat in drei Monaten SDD beschrieben, wie das Review der Specs zum Engpass wurde.

**Bedeutung.** Die Stopp-Klasse ist die Antwort auf C7 („Der Takt wird vom langsamsten menschlichen Schritt bestimmt“). Sie macht unbeaufsichtigte Läufe planbar und hält trotzdem die Verantwortung beim Menschen. Das Feld „Rückbau“ ist eine Kleinigkeit mit großer Wirkung: Es zwingt jede Entscheidung, ihren Preis zu nennen.

### S-2 „Regel im Text oder Regel im Werkzeug“

**Befund.** Abschnitt gleichen Namens im Regeltext. Bedienvorgaben gehören ins Werkzeug, Urteilsregeln in den Text, gemischte Regeln werden zerlegt. Die Lint-Konfiguration begründet sich selbst.

**Markt.** Böckeler unterscheidet berechnende und schlussfolgernde Kontrollen. Das Kit wendet dieselbe Unterscheidung als Pflegeregel auf die eigenen Anweisungen an. Diese Form habe ich im Markt nicht gefunden.

**Bedeutung.** Das ist der Mechanismus, mit dem Regeltext schrumpfen kann, ohne Regeln zu verlieren. Er ist zugleich das Werkzeug gegen `L-5`.

### S-3 Fester Kit-Stand je unbeaufsichtigtem Lauf

**Befund.** Jeder Lauf bindet sich beim Start an den Commit von `origin/<mainBranch>` (ohne `git fetch`). Werkzeuge, Prüfung vor jedem Commit, Skills und Regeltexte sind damit für die ganze Nacht fest. Was ein Paket daran ändert, wirkt erst nach `push main`. Der Stand steht als `Kit-Stand:` im Laufbericht, im Nachtbericht und an jedem Kommentar. Pakete, die ein geändertes Werkzeug eines anderen Pakets brauchen, tragen `Issue #N (wartet auf Push)`.

**Markt.** Nicht gefunden. Copilots Control Plane regelt, welche Agenten und Modelle laufen dürfen, nicht, dass ein Agent seine eigenen Prüfungen nicht mitten im Lauf ändern kann.

**Bedeutung.** Das ist ein Schutz gegen eine Fehlerklasse, die bei steigender Autonomie wichtiger wird: ein Agent, der den roten Test „repariert“, indem er die Prüfung lockert. Das Kit verhindert das strukturell, nicht per Prompt (B3).

### S-4 Prüfmechanik mit Messung statt Bauchgefühl

**Befund.** `kit/checks.mjs` und Kapitel ab „Bereichsbezogene Prüfungen“ in `docs/dokumentation.md`:
- `checkAreas` und `areas` je Prüfung, abhängige Bereiche aus dem Importgraphen (#1208), Zweifelsregel „im Zweifel läuft alles“.
- Gestaffelte Prüfungen (`stufe`), Auslassungen beim Abschluss (`nichtBeimAbschluss`), Mutation erst vor dem Merge.
- Teillauf: nach einer Korrektur zuerst die zuletzt roten Prüfungen, danach genau einmal der volle Lauf als Nachweis.
- Unveränderter Stand: Ergebnis wird übernommen.
- Gleichzeitigkeit gemessen: zwei gleichzeitige Prüfungen 684 s, eine 929 s, vier 737 bis 751 s und zweimal rot.
- Lastbeleg für parallele Prüfläufe (`tools/lastbeleg.mjs`).
- Commit-Gate prüft Datei für Datei gegen den Index.

**Markt.** Keine der SDD- oder Methodenlösungen hat etwas Vergleichbares. Plattformen verlassen sich auf die CI des Projekts.

### S-5 Wirksamkeit, Aufwand, Befunde

**Befund.** `kit/wirksamkeit.mjs`, `kit/aufwand.mjs`, `kit/befunde.mjs`, Abschnitte „Aufwand des Prozesses“, „Wirksamkeit der Prüfungen“, „Befunde der Modell-Prüfungen“ im Regeltext:
- Je Prüfung: Ausführungen, Beanstandungen, Zeit. Unterschied zwischen „nie beanstandet“ und „nicht gelaufen“.
- Rückläuferquote aus „In review“.
- Mittlere Prüfzeit je Karte mit Vergleichswert ohne Auslassungen.
- Nachdenken, Werkzeugarbeit und unzugeordnete Zeit getrennt, Zielmarke der Umsetzung.
- Fund mit Gegenprobe, Stand und Art. Nur bestätigte, übernommene Funde zählen als Vorkommen.
- Kein Befund ist ein Gate.

**Markt.** Thoughtworks führt „Measuring collaboration quality“ erst auf „Assess“. Dashboards im Markt zeigen Aktivität (PRs, Token), selten Ergebnisqualität. Eine Messung, ob eine Prüfung jemals etwas findet, habe ich nirgends gefunden.

**Bedeutung.** Das ist die Grundlage für den Flywheel in menschlicher Hand: Prüfungen, die nie anschlagen, kosten nur Zeit. Prüfungen, die oft anschlagen, zeigen, wo Leitplanken fehlen.

### S-6 Modell-Prüfungen vor dem Code, mit Rollen und Gegenprobe

**Befund.** `/issue-review` mit Paarung (`issueReview.pairs`, Implementierer nie in der eigenen Reviewer-Liste), Rollen je Stufe, `kind: command` für fremde CLIs (Codex, qwen). Funde mit Gegenprobe.

**Markt.** Multi-Modell-Review gibt es inzwischen als Codex-Plugin für Claude Code und als Mehrfachzuweisung in Copilot. Eine rollenbasierte Prüfung von Fachplan und Plan durch fremde Modelle, bevor Code entsteht, habe ich als Produkt nicht gefunden.

**Bedeutung.** Setzt C6 und B7 um: Die Denkarbeit wandert nach vorn, und ein Modell ist gegenüber der eigenen Lösung unkritisch.

### S-7 Labels als einmalige Vollmacht

**Befund.** `kit:night`, `kit:pruefen`, Ziel-Labels und `planreview:*` werden beim Start verbraucht, jedes Setzen autorisiert genau einen Lauf. Unpassende Kombinationen lehnt die Auswahl mit `## Kette nicht gestartet: unpassende Einstellung` ab. Wiederholung mit derselben Geste setzt bei der ersten Stufe ohne Ergebnis fort.

**Markt.** Kiro und Jules starten über Labels, Symphony über Ticketstatus. Dass ein Label verbraucht wird und dadurch eine einmalige Freigabe ist, habe ich nirgends gefunden.

**Bedeutung.** C8 („Je autonomer die KI, desto strenger die menschlichen Kontrollpunkte“) als Mechanik: Autonomie ist eine Vollmacht je Karte und je Lauf, kein Betriebsmodus.

### S-8 Laufstand am Board, robuste Übergabe

**Befund.** Laufstand-Labels und ein ersetzter Kommentar, Lauf-ID über Rechnergrenzen, Übernahme verwaister Wurzeln nach Budget-Obergrenze, genau ein automatischer zweiter Versuch nur bei Umgebungsfehlern, gekennzeichnete Zeitabbrüche ohne behauptete Ursache, wartende Sitzungen als eigene Größe, Vermerke `## Nachtlauf: Zeitgrenze erreicht`.

**Markt.** Symphony startet hängengebliebene Agenten neu. Wer den Zustand eines Laufs ohne Deutung ablesen will, findet bei den Plattformen Logs und Statusanzeigen, aber selten eine so klare Trennung von Abbruch, Halt und Warten.

### S-9 KI-Leitstand

**Befund.** Siehe Abschnitt 2.2.

**Markt.** Mission Control und Agent View zeigen aktive Sitzungen. Selbst gehostet, mit Kosten je Vorhaben, Lücken als Lücken, Fehlerklassen, Übergabetext und Plattformsicht über Projekte hinweg habe ich nichts gefunden. Die Agenten-Boards (Vibe Kanban und Co.) waren reine Startflächen.

**Bedeutung.** Der Leitstand ist ein Board für Maschinen mit menschlicher Sicht. Das passt zu C3 („Das Issue ist die Quelle der Wahrheit“).

### S-10 Anbieterunabhängigkeit und Ingenieursqualität

**Befund.** GitHub, GitLab, lokal, kanban-kit. Keine Laufzeit-Abhängigkeiten. 482 Testdateien, CI, SonarQube Cloud, generierter Changelog, Blob-Abgleich als Pflicht-Check, Doku-Tests (`test/docs-*.test.mjs`).

---

## 7. Unterschiede

### U-1 Richtung: Stopp-Punkte statt mehr Autonomie

Der Markt verkauft Autonomie (Symphony, Devin, StrongDM, BMad Loop). Das Kit verkauft die Stellen, an denen nichts automatisch passiert. Formuliert ist das in `docs/werkzeug-das-es-nicht-gibt.md`. Das ist eine Positionierung, die sich im Markt nur schwer verkauft, aber sie ist durch DORA (Instabilität), Faros (mehr Vorfälle je PR) und Böckeler (Verhaltensprüfung als schwächste Stelle) gut gedeckt.

### U-2 Kein Spec-Driven Development im Repository

Seit Plan #825 entfallen (`README.md`, Abschnitt „Spec-Driven Development“). Fachplan, Plan und Arbeitspakete leben als Karten am Board. Vorteil: weniger Dateien zum Reviewen, das Board ist die eine Quelle. Nachteil: Es gibt keine fortgeschriebene Beschreibung des Systemverhaltens, wie OpenSpec sie beim Archivieren aus den Deltas erzeugt. Laut Memory stand ursprünglich die Absicht im Raum, Specs versioniert im Repo zu führen. Das ist eine bewusste Richtungsentscheidung, die zu `Q-3` führt.

### U-3 Morgen-Batch statt PR je Aufgabe

Die Plattformen erzeugen einen PR je Aufgabe. Das Kit committet nachts lokal auf einen Stand und lässt morgens den Stapel pushen. Vorteil: weniger PR-Lärm, ein Prüflauf für den Stapel, ein bewusster Akt. Nachteil: keine Isolation zwischen den Paketen einer Nacht, ein fehlerhaftes Paket blockiert den Stapel bis zur Klärung.

### U-4 Lokal statt Cloud

Die Nacht läuft auf dem eigenen Rechner. Vorteil: Daten verlassen den Rechner nur über das Modell (D6), lokale Modelle sind über Labels und Aufgabenstufen einbindbar (D7). Nachteil: keine Sandbox, Rechner muss laufen, Parallelität ist durch die Hardware begrenzt.

### U-5 Tiefe statt Breite

Der Markt ist agent-neutral (Spec Kit und OpenSpec bedienen über dreißig Assistenten). Das Kit ist an Claude Code gebunden, nur Reviewer und Aufgabenstufen können fremde CLIs sein.

### U-6 Deutsch

Die gesamte Doku, die Regeltexte und die Kommandos sind deutsch. Im Markt einzigartig, für Zielgruppen in Deutschland ein Vorteil, für Reichweite und Beiträge von außen ein Hindernis.

---

## 8. Lücken

Schwere: hoch (gefährdet Grundversprechen oder Betrieb), mittel (bremst Nutzen oder Verbreitung), niedrig (Kosmetik).

### L-1 Keine harten Werkzeuggrenzen und keine Isolation (hoch)

**Befund.**
- Nacht-Sessions laufen mit `--permission-mode auto --permission-prompts none` (`kit/night/session.mjs`, `permissionArgs`). Im Auto-Modus entscheidet ein Klassifikator, die Allowlist aus `.claude/settings.json` wirkt. Das ist besser als `acceptEdits`, aber keine Isolation. `--yolo` schaltet alle Prüfungen ab.
- Claude-Reviewer laufen als Subagent und erben die Werkzeuge der aufrufenden Session. „Reviewer ändert nichts“ ist eine Bitte im Prompt. Das Konzept `konzept-rollen-als-agenten.md` (Stand 16.09.2026) beschreibt die Lösung, ein Verzeichnis `.claude/agents/` gibt es noch nicht.
- Keine Sandbox, keine Netz-Allowlist, keine Trennung der Secrets.

**Markt.** Kiro, Codex Cloud, Copilot, Devin, Sculptor isolieren je Aufgabe. GitHub Agentic Workflows schreiben nur über „safe outputs“. Thoughtworks: „Sandboxed execution“ auf Trial.

**Risiko.** Ein Fehlgriff einer Nacht-Session trifft den eigenen Rechner. Das Konzept B3 („Leitplanken müssen scheitern können“) gilt für Reviewer heute nicht.

### L-2 Das Commit-Gate ist lokal und umgehbar (hoch)

**Befund.**
- `README.md`, Abschnitt „Commit-Gate“: `--no-verify` umgeht das Gate, ein frischer Klon hat es erst nach einem Installer-Lauf.
- `pushPruefung` mit `ort: buildDienst` gibt es (`docs/dokumentation.md`, Abschnitt `pushPruefung`): `/push-main` pusht auf einen Prüfzweig, wartet auf die CI und pusht `mainBranch` nur bei Grün. Das ist aber Opt-in, die Vorgabe ist `lokal`.
- Der Installer richtet keine Branch Protection mit Pflicht-Check ein.

**Markt.** Copilot und Agent HQ setzen auf Branch Protection und Rulesets. Sonar bietet ein Gate eigens für Agenten-Code.

**Risiko.** Ein Commit ohne Nachweis kann auf `main` landen, wenn jemand (Mensch oder Session im Yolo-Modus) das Gate umgeht.

### L-3 Verhaltensprüfung hängt am Implementierer (hoch)

**Befund.** Tests und Code eines Pakets entstehen im selben Modell und in derselben Session. `/implement-test` und `/implement-done` trennen die Schritte, nicht den Autor. Mutationstests (B6) prüfen die Tests gegen den Code, nicht gegen die fachliche Anforderung. Die Abdeckung in der Kette prüft Pakete gegen den Fachplan, nicht Verhalten gegen Akzeptanzkriterien.

**Markt.** Böckeler nennt genau das die schwächste Stelle. StrongDM legt Szenariotests als Holdout außerhalb der Codebasis. Jules besteht vorhandene Tests und bricht ungetestetes Verhalten.

**Risiko.** B7 gilt auch für Tests: Ein Modell ist gegenüber der eigenen Lösung unkritisch, also auch gegenüber den Tests, die zu dieser Lösung passen.

### L-4 Keine parallele Umsetzung (mittel, für Durchsatz hoch)

**Befund.**
- Die Umsetzungsnacht arbeitet Ready von oben nach unten ab (`docs/dokumentation.md`, „Abend-Ritual“).
- `.claude/night-umsetzung.lock` (`kit/night/grundlagen.mjs`, `UMSETZUNG_LOCK`) erlaubt eine Umsetzung zur Zeit, auch über Ketten hinweg.
- Abhängigkeiten sind maschinenlesbar (`## Abhaengigkeiten`, `kit/night/abhaengigkeiten.mjs` mit Kreissuche). Die Voraussetzung für Parallelität liegt also vor.
- Laut Memory dauert ein Paket heute teils rund 20 Minuten statt der gewünschten 10, Nächte enden häufig an der Zeitgrenze.

**Markt.** Kiro bis 10 parallel, Copilot, Devin, Cursor, Codex mit einem Worktree je Agent.

### L-5 Gewicht des Regeltexts (mittel)

**Befund.**
- `templates/CLAUDE-workflow.md` hat 59.657 Bytes, also grob 15.000 Token.
- Skills: `push-main` 31.535 Bytes, `implement-next` 29.755, `issues` 27.090, `implement-ready` 26.991, `issue-review` 19.146, `merge-production` 18.315.
- Zusammen rund 344 KB Anweisungen.
- `docs/werkzeug-das-es-nicht-gibt.md` beschreibt das Werkzeug als „dünn“ mit acht Skills. Heute sind es 16 Skills und rund 37.300 Zeilen Kit-Code.
- `prozess-pruefstand.md` (10.09.2026) stellt selbst fest: Der Prüfapparat ist für den Nachtbetrieb gebaut, wird aber in jeder Session mitgetragen.
- Laut Memory wurde das Kit im September schon einmal neu gebaut, weil der Prüfapparat die Automatisierung erstickt hatte.

**Markt.** Thoughtworks: „Agent instruction bloat“ auf Caution. BMAD hat seine Kern-Skills von 14 auf 8 gekürzt, Agent OS hat die Orchestrierung entfernt.

**Risiko.** Mehr Kontext heißt mehr Kosten je Session, mehr Zeit bis zum ersten Token und mehr Gelegenheiten, dass eine Regel im Rauschen untergeht. Für die Nacht-Sessions schlägt das direkt auf Dauer und Zeitabbrüche durch.

### L-6 Release-Takt und Upgrade (mittel)

**Befund.** Drei Major-Versionen in drei Wochen, über 50 Versionen seit August. Kein Upgrade-Befehl (laut Memory geplant, Vorbild `specify self upgrade`). Die Kopien in den Projekten altern, `sync-blobs --check` und die Versionsauskunft helfen nur im Kit-Repo selbst.

**Risiko.** Für Fremdnutzer ist schwer erkennbar, wann ein Update Pflicht ist und was es bricht.

### L-7 Inkonsistenzen in der Doku (niedrig, aber sichtbar)

**Befund (konkret):**
1. `docs-site/.vitepress/config.ts`, Zeile 6: `description` sagt „Zwölf Skills …“ und enthält einen Gedankenstrich.
2. `docs-site/.vitepress/config.ts`, Zeile 47: Sidebar-Eintrag „Die zwölf Skills“ mit Anker `#die-zwolf-skills-und-der-9-schritt-kernprozess`. Die Überschrift in `docs/dokumentation.md` (Zeile 771) heißt „Die sechzehn Skills und der 9-Schritt-Kernprozess“. Der Anker ist tot.
3. Live-Startseite docs.mwolff.org zeigt noch „Mac, Windows und Linux“. Im Repo ist `docs/index.md` korrigiert. Ursache: Das Deploy läuft nur bei Push auf `production` (`.github/workflows/deploy-docs.yml`).
4. `templates/workflow.config.json`: `"reviewModel": "claude-opus-4-8"`, sonst überall `claude-opus-5`.
5. `docs/werkzeug-das-es-nicht-gibt.md` spricht von acht Skills und einem Installer für Windows. Als historischer Text in Ordnung, sollte dann aber als solcher markiert sein.
6. `konzept-rollen-als-agenten.md` beschreibt die Nacht-Session mit `acceptEdits`. Aktuell ist es der Auto-Modus.
7. Lose Arbeitsdokumente im Wurzelverzeichnis (`konzept-rollen-als-agenten.md`, `prozess-pruefstand.md`, `prozess-pruefstand-nachtlauf.md`) neben `docs/entwuerfe/`.

### L-8 Kosten je Karte und Erfassung interaktiver Sitzungen (mittel)

**Befund.** Der Leitstand weist Kosten je Vorhaben und „ohne Karte“ aus, nicht je Karte. Interaktive Sitzungen in frischen Worktrees werden nicht erfasst, weil dort Kit, Skills und Einstellungen fehlen (Befund #1008, offene Frage `.worktreeinclude`). `SessionEnd` ist als passender Hook identifiziert, aber nicht beobachtet.

**Markt.** Claude Code liefert OpenTelemetry mit `cost.usage` und `token.usage`. Kosten je Aufgabe sind im Markt allgemein dünn.

### L-9 Keine Standards für Portabilität (niedrig bis mittel)

**Befund.** Keine AGENTS.md-Ausgabe, Skills nicht als Paket im offenen Agent-Skills-Format verteilt, keine OTel-Anbindung.

**Markt.** AGENTS.md liegt bei der Agentic AI Foundation der Linux Foundation und steht im Radar auf Adopt. Agent Skills auf Trial.

### L-10 Keine öffentlichen Belege (mittel, strategisch)

**Befund.** Das Kit misst Rückläufer, Wirksamkeit, Kosten und Zielmarke, im Leitstand liegen Durchsatz, Durchlaufzeit und Kosten. Öffentlich ist davon nichts außer den kanban-kit-Codezahlen.

**Markt.** Die belastbaren Zahlen fehlen überall. Wer sie hat, hat ein Argument.

### L-11 Kleinere Lücken im Leitstand (niedrig)

Aus der Leitstand-Doku: Nachtpläne nicht persistent, Labelfilter nur in der Listenansicht, Vorhabenfilter nur direkte Zuordnung, Stillefrist ohne Oberfläche, beim Verschieben auf ein anderes Board gehen Vorhaben und Abhängigkeiten verloren. Benachrichtigungen bei einem Halt (`kit:klaeren`, `lauf:wartet`) oder einer Störung habe ich in der Doku nicht gefunden.

---

## 9. Maßnahmen

Jede Maßnahme hat Ziel, Begründung, Vorgehen, betroffene Stellen, Akzeptanzkriterien, Messung, Aufwand (S bis zwei Tage, M bis eine Woche, L mehr), Abhängigkeiten und Risiken. Die Akzeptanzkriterien sind so formuliert, dass sie in ein Arbeitspaket im Vier-Abschnitt-Format übernommen werden können.

### 9.1 Hygiene (Kandidaten für `/task`)

#### H-1 Sidebar und Beschreibung der Doku-Seite korrigieren

- **Ziel:** keine toten Anker, keine falsche Skillzahl, kein Gedankenstrich in der Beschreibung.
- **Stellen:** `docs-site/.vitepress/config.ts` Zeilen 5 bis 6 und 47.
- **Akzeptanz:** Sidebar-Text „Die sechzehn Skills“, Anker `#die-sechzehn-skills-und-der-9-schritt-kernprozess` existiert im Build. `description` nennt sechzehn Skills.
- **Aufwand:** S.

#### H-2 Doku-Tests auf die Doku-Seite ausdehnen

- **Ziel:** Die Fehlerklasse aus H-1 kann nicht wiederkommen.
- **Vorgehen:** `test/docs-skillzahl.test.mjs` (oder ein neuer Test) liest auch `docs-site/.vitepress/config.ts` und `docs/index.md`, prüft die Skillzahl gegen `skills/` und jeden Sidebar-Anker gegen die Überschriften in `docs/`.
- **Akzeptanz:** Test rot bei falscher Zahl oder totem Anker, grün nach H-1.
- **Aufwand:** S. **Abhängig von:** H-1.

#### H-3 Doku-Stand live bringen

- **Ziel:** docs.mwolff.org zeigt den Stand von 4.0.0 (WSL2 statt Windows).
- **Vorgehen:** `merge production` nach dem Release, oder `workflow_dispatch` des Deploy-Workflows. Optional: Deploy auch bei Tags.
- **Akzeptanz:** Die Startseite zeigt „macOS, Linux und Windows über WSL2“.
- **Aufwand:** S (Menschenschritt).

#### H-4 Modellnamen in der Vorlage vereinheitlichen

- **Stellen:** `templates/workflow.config.json` (`reviewModel`).
- **Vorgehen:** auf das aktuelle Modell setzen. Zusätzlich ein Test, der jede Modell-ID der Vorlage gegen `kit/preise.mjs` prüft.
- **Akzeptanz:** keine Modell-ID in der Vorlage ohne Preiseintrag.
- **Aufwand:** S.

#### H-5 Arbeitsdokumente einsortieren und markieren

- **Vorgehen:** `konzept-rollen-als-agenten.md`, `prozess-pruefstand.md`, `prozess-pruefstand-nachtlauf.md` nach `docs/entwuerfe/` verschieben (oder ein Ordner `konzepte/`). `docs/werkzeug-das-es-nicht-gibt.md` mit einer Kopfzeile „Text vom <Datum>, Stand Kit <Version>“ versehen. Im Konzept den Berechtigungsmodus auf den Auto-Modus aktualisieren.
- **Akzeptanz:** keine losen Konzeptdokumente im Wurzelverzeichnis.
- **Aufwand:** S.

### 9.2 Performance

#### P-1 Zuerst messen: Wohin geht die Zeit eines Pakets?

- **Ziel:** belastbare Antwort, ob die 20 Minuten je Paket im Modell oder in den Werkzeugen stecken, bevor optimiert wird.
- **Begründung:** `kit/aufwand.mjs` trennt bereits Nachdenken, Werkzeugarbeit und unzugeordnete Zeit und weist die Zielmarke aus. Es fehlt eine Auswertung über viele Nächte und eine Darstellung je Stufe.
- **Vorgehen:**
  1. Kommando `node .claude/kit/aufwand.mjs bericht --laeufe 20` (Name zur Diskussion), das über die letzten N Läufe je Stufe (`plan`, `review`, `pakete`, `abdeckung`, `umsetzung`) und je Aufgabenstufe (schwer, mittel, leicht) Median und 90. Perzentil für Nachdenken, Werkzeugarbeit, Unzugeordnet, Anzahl der Prüfläufe je Paket und Anteil Zeitabbrüche ausgibt.
  2. Dieselben Zahlen an den Leitstand melden (siehe F-5).
- **Akzeptanz:** Bericht vorhanden. Für jede Stufe ist die dominierende Zeitart benannt. „Nicht gemessen“ statt 0, wo Daten fehlen.
- **Messung:** ist selbst die Messung.
- **Aufwand:** S bis M.
- **Entscheidungsregel danach:** Dominiert Werkzeugarbeit, zuerst P-3. Dominiert Nachdenken, zuerst P-4 und P-6. Sind die Prüfläufe je Paket hoch (etwa über drei), zuerst P-7.

#### P-2 Parallele Umsetzung unabhängiger Pakete

- **Ziel:** Durchsatz der Nacht erhöhen, ohne die Prüfmaschine zu überlasten.
- **Begründung:** `L-4`. Die Abhängigkeiten sind maschinenlesbar, Worktrees sind vorhanden, der Lastbeleg zeigt, dass die Prüfungen die Engstelle der Maschine sind (zwei gleichzeitig optimal).
- **Vorgehen (Vorschlag zur Diskussion):**
  1. `UMSETZUNG_LOCK` wird zu einer Semaphore mit `night.umsetzung.parallel` Plätzen (Vorgabe 1, also heutiges Verhalten).
  2. Auswahl: Aus Ready werden nur Pakete parallel gezogen, die keine gegenseitige Abhängigkeit haben und deren vorhergesagte Bereiche (`checkAreas` aus den im Paket genannten Dateien) sich nicht überschneiden.
  3. Jedes Paket arbeitet in einem eigenen Worktree auf einem eigenen Nachtzweig.
  4. Prüfungen laufen über eine gemeinsame Prüfwarteschlange mit der gemessenen Breite 2. Das Nachdenken der Sessions läuft parallel, die Werkzeugarbeit nicht unkontrolliert.
  5. Integration am Ende: Die Nachtzweige werden in Board-Reihenfolge auf den Nachtstand gerebased. Konflikt oder Rot nach dem Rebase stellt das Paket mit Vermerk zurück. Danach ein voller Prüflauf auf dem Gesamtstand.
- **Stellen:** `kit/night/grundlagen.mjs`, `kit/night/tag.mjs`, `kit/night/kette.mjs`, `kit/worktree.mjs`, `kit/checks.mjs` (Warteschlange), Schema, Einstellungen, Doku, Tests.
- **Akzeptanz:**
  - Mit `parallel: 1` ist das Verhalten unverändert (bestehende Tests grün).
  - Mit `parallel: 2` laufen zwei unabhängige Pakete gleichzeitig, abhängige nie.
  - Gleichzeitig laufen nie mehr Prüfungen als die Warteschlange erlaubt.
  - Ein Integrationskonflikt erzeugt einen Vermerk am Paket und keinen roten Gesamtstand.
  - Der Nachtbericht weist je Paket Wartezeit in der Prüfwarteschlange aus.
- **Messung:** Pakete je Nacht, Wartezeit in der Warteschlange, Anteil Integrationskonflikte, Zeitabbrüche.
- **Aufwand:** L. **Abhängig von:** P-1 (um den Gewinn zu belegen).
- **Risiko:** Stopp-Klasse 5 (Änderung am Prozess). Braucht also einen Fachplan und eine menschliche Entscheidung. Bei der Option, Claude Codes Hintergrund-Sessions (`--bg`, Agent View) zu verwenden, beachten: Research Preview.

#### P-3 Prüfzeit in den Zielprojekten senken

- **Ziel:** Werkzeugarbeit je Paket halbieren, wo sie dominiert.
- **Vorgehen:**
  1. Prüfprofile im Installer je Projekttyp (Maven, Gradle, npm, pnpm) mit erprobten Vorgaben: Build-Cache, inkrementelle Kompilierung, Testcontainers-Wiederverwendung, `nichtBeimAbschluss` für schwere Integrationstests, Mutation nur in der Stufe vor dem Merge.
  2. „Die langsamsten Testdateien finden“ (gibt es bereits) automatisch in den Nachtbericht, wenn die Zielmarke überschritten wurde.
  3. Teillauf und Ergebnisübernahme auch für die Abschlussläufe der Nacht prüfen.
- **Akzeptanz:** In einem Referenzprojekt (etwa kanban-kit) sinkt die mittlere Prüfzeit je Karte um einen vorher festgelegten Wert. Die Kennzahl „mittlere Prüfzeit je Karte“ existiert bereits.
- **Aufwand:** M.

#### P-4 Kontextdiät für den Regeltext

- **Ziel:** Weniger Token je Session, ohne eine Regel zu verlieren.
- **Begründung:** `L-5`. Werkzeug dafür ist `S-2`.
- **Vorgehen:**
  1. Bestandsaufnahme: Jede Regel bekommt eine Kennung (W1 bis W4 gibt es schon für Prozessregeln) und eine Einordnung Bedienvorgabe oder Urteilsregel.
  2. Bedienvorgaben, die ein Werkzeug schon erzwingt, verlassen den Text und bleiben als Einzeiler mit Verweis auf das Kommando.
  3. `CLAUDE-workflow.md` wird in einen Kern (Stopp-Punkte, Stopp-Klasse, Entscheidungsformat, Mitteilungen) und Kapitel je Bahn geteilt (Nachtbetrieb, Prüflauf, Aufwand, Wirksamkeit, Befunde). Skills lesen das Kapitel, das sie brauchen.
  4. Große Skills (`push-main`, `implement-next`, `issues`) werden auf dieselbe Weise geprüft: Was davon ist Bedienvorgabe, die in `board.mjs` oder `checks.mjs` wandern kann?
  5. Ein Test sichert, dass jede Regelkennung genau an einer Stelle definiert ist.
- **Akzeptanz:** Der Kern ist kleiner als ein vorher festgelegter Wert (Vorschlag: 12 KB). Keine Regelkennung geht verloren. Doku-Tests grün.
- **Messung:** Eingabe-Token (frisch und gecacht) je Session vor und nach, aus `aufwand`. Zeit bis zum ersten Werkzeugaufruf.
- **Aufwand:** M bis L.
- **Risiko:** Stopp-Klasse 5. Eine Regel, die nur noch im Kapitel steht, wird in einer Session übersehen, die das Kapitel nicht liest. Deshalb Kern bewusst nicht zu klein schneiden.

#### P-5 Reviewer-Rollen als Agentendateien

- **Ziel:** weniger Kontext in der aufrufenden Session und echte Lesegrenze für Reviewer.
- **Begründung:** `konzept-rollen-als-agenten.md`. Rund hundert Zeilen Rollentext wandern heute bei jedem Review durch den Kontext. `schnitt-abhaengigkeiten` setzt das Modell beim Lesen selbst zusammen.
- **Vorgehen:** wie im Konzept: eine Datei je Rolle unter `.claude/agents/`, `tools: Read, Grep, Glob`, Modell bleibt in der Config, `kind: command` bekommt denselben Rumpf über stdin. Installer verteilt die Dateien.
- **Akzeptanz:** Ein Claude-Reviewer kann keine Datei schreiben (Test mit einer Rolle, die es versucht). `schnitt-abhaengigkeiten` ist eine eigene Datei. Rollentexte stehen nur noch an einer Stelle.
- **Aufwand:** M. Gehört zugleich zu `F-1`.

#### P-6 Prompt-Cache gezielt ausnutzen

- **Ziel:** Mehr gecachte Eingabe je Session.
- **Vorgehen:** Reihenfolge der Kontextbausteine in den Nacht-Prompts stabil halten (erst Kern, dann Skill, dann Karte). Cache-Quote je Stufe aus `aufwand` ausweisen (`test/aufwand-cache-preise.test.mjs` deutet an, dass die Daten da sind). Sessions derselben Nacht, die denselben Skill fahren, zeitlich bündeln, damit der Cache warm bleibt.
- **Akzeptanz:** Cache-Quote je Stufe im Bericht. Ziel nach P-4 festlegen.
- **Aufwand:** S bis M. **Abhängig von:** P-1.

#### P-7 Wiederholungsbremse in der Umsetzung

- **Ziel:** Pakete, die im Kreis laufen, früh beenden statt an der Zeitgrenze.
- **Begründung:** Ein Zeitabbruch nach 60 Minuten kostet die ganze Zeit und behauptet keine Ursache. Die Fehlermerkmale der Prüfungen gibt es bereits.
- **Vorgehen:** Liefert `checks.mjs run` in einer Session dreimal hintereinander rot mit demselben Fehlermerkmal, beendet die Session das Paket mit einem Vermerk „wiederholt rot: <Merkmal>“ und stellt es zurück. Umsetzung als Bedienvorgabe im Werkzeug (Zähler in der Ergebnisdatei), nicht als Bitte im Skill.
- **Akzeptanz:** Test mit einer Attrappe, die dreimal dasselbe Merkmal liefert. Eigener Zustand im Ergebnisstand und im Leitstand.
- **Messung:** Anteil Zeitabbrüche vorher und nachher, gesparte Minuten.
- **Aufwand:** M.

#### P-8 Modell- und Effort-Routing datengestützt

- **Ziel:** Das richtige Modell je Aufgabenstufe, belegt statt vermutet.
- **Begründung:** `night.stufen` mit `modell`, `effort` und `kommando` existiert. Es fehlt die Auswertung, welche Kombination wie oft gelingt und was sie kostet.
- **Vorgehen:** Auswertung je Aufgabenstufe und Modell: Erfolgsquote, Rückläufer, Dauer, Kosten. Empfehlung im Bericht, keine automatische Umstellung.
- **Akzeptanz:** Tabelle im Bericht und im Leitstand.
- **Aufwand:** S bis M. **Abhängig von:** P-1.

### 9.3 Funktionalität

#### F-1 Harte Werkzeuggrenzen

- **Ziel:** B3 auch für Reviewer und Nacht-Sessions.
- **Vorgehen:**
  1. P-5 umsetzen (Reviewer nur lesend).
  2. Für Nacht-Sessions eine Positivliste der Werkzeuge je Stufe (`--allowedTools`), etwa: Stufe `review` nur lesend, Stufe `abdeckung` lesend plus `board.mjs`, Stufe `umsetzung` voll.
  3. Ein PreToolUse-Hook, der Schreibzugriffe auf Kit-Dateien und geschützte Dateien sperrt. Achtung: Hooks versagen bei Timeout offen, also kurz und ohne Netz halten.
- **Akzeptanz:** Tests je Stufe, die verbotene Werkzeuge versuchen. `--yolo` bleibt, wird aber im Nachtbericht prominent markiert.
- **Aufwand:** M.

#### F-2 Isolierte Nachtumgebung (optional)

- **Ziel:** Ein Fehlgriff der Nacht trifft einen Container, nicht den Rechner.
- **Vorgehen:** Ein mitgeliefertes Container-Profil (Devcontainer oder Docker) für Nachtläufe: Repository als Volume, Netz nur zu Modell-API, Board und Paketquellen, keine Secrets außer dem Projekt-Token. Prüfen, ob die native Sandbox von Claude Code genügt, bevor etwas Eigenes entsteht. Muster der GitHub Agentic Workflows übernehmen: schreibende Aktionen außerhalb des Repos (Board) nur über das Kit-Werkzeug.
- **Akzeptanz:** `night.mjs --container` startet die Nacht im Profil. Ein Test zeigt, dass ein Zugriff auf eine nicht freigegebene Adresse scheitert.
- **Aufwand:** L. **Risiko:** Prüfzeiten im Container können steigen (P-1 vorher und nachher).

#### F-3 Serverseitiges Gate als Standard

- **Ziel:** Kein Stand auf `main` ohne grünen Nachweis, auch nicht mit `--no-verify`.
- **Vorgehen:**
  1. Installer fragt nach dem Build-Dienst und schlägt `pushPruefung.ort: buildDienst` vor, wo eine CI existiert.
  2. Installer bietet an, Branch Protection für `mainBranch` mit Pflicht-Check einzurichten (`gh api` bzw. `glab`), als Menschenschritt mit Anleitung, wenn die Rechte fehlen.
  3. Nachweis je Commit: Das Commit-Gate schreibt einen Trailer (etwa `Checks: gruen <stand-hash>`). `/push-main` lehnt Commits ohne gültigen Trailer ab und nennt sie.
  4. Optionales Sonar-Gate „agentic AI“ als Pflicht-Check in der Vorlage.
- **Akzeptanz:** Ein Commit mit `--no-verify` wird von `/push-main` gemeldet und nicht gepusht. Auf einem geschützten `main` scheitert ein Push ohne grünen Check.
- **Aufwand:** M.
- **Risiko:** Stopp-Klasse 5 und 2 (Gates und Rechte). Menschliche Entscheidung nötig.

#### F-4 Abnahmetests aus dem Fachplan (Holdout)

- **Ziel:** Verhalten gegen die fachliche Anforderung prüfen, unabhängig vom Implementierer.
- **Begründung:** `L-3`.
- **Vorgehen:**
  1. Neue optionale Kettenstufe `abnahme` zwischen `review` und `pakete` (oder als eigenes Arbeitspaket `[Abnahme]` je Vorhaben).
  2. Ein Modell aus einer anderen Familie als der Implementierer schreibt aus den Akzeptanzkriterien des Fachplans ausführbare Abnahmetests, die zunächst rot sind.
  3. Die Testdateien gelten für die Umsetzungspakete als geschützt (Mechanismus `kit:geschuetzt`, plus eine Prüfung im Commit-Gate, dass geschützte Pfade unverändert sind).
  4. Ein Paket ist erst grün, wenn die ihm zugeordneten Abnahmetests grün sind. Die Abdeckung ordnet Akzeptanzkriterien den Paketen zu.
  5. Ändern darf die Abnahmetests nur ein Mensch oder eine neue `abnahme`-Stufe nach einer Änderung am Fachplan.
- **Akzeptanz:** Ein Umsetzungspaket, das einen Abnahmetest ändert, wird vom Gate abgewiesen. Der Nachtbericht nennt je Akzeptanzkriterium den Stand.
- **Messung:** Rückläufer aus „In review“ mit und ohne Abnahmestufe.
- **Aufwand:** L.
- **Risiko:** Abnahmetests auf UI-Ebene sind teuer (B10). Start mit API- oder Domänenebene.

#### F-5 Qualitätskennzahlen im Leitstand

- **Ziel:** Aus der Messung im Kit wird eine Sicht im Leitstand.
- **Vorgehen:** Der Runner meldet zusätzlich zum Laufergebnis die Daten aus `wirksamkeit.json`, die Befundzahlen je Art und die Aufwandsauswertung (P-1). Der Leitstand zeigt:
  - Erstabnahmequote: Anteil Pakete, die ohne Rückläufer nach Done gehen.
  - Rückläuferquote je Woche.
  - Wirksamkeit je Prüfung (Läufe, Beanstandungen, Zeit), mit Markierung „nie beanstandet seit N Läufen“.
  - Befunde je Mangel-Art und Stufe.
  - Zeitabbruchquote und Zielmarke.
- **Akzeptanz:** Kacheln und Panels mit Lücken als Lücken. API-Schema erweitert, OpenAPI aktualisiert.
- **Aufwand:** M (Kit) plus M (Leitstand).

#### F-6 Kosten je Karte

- **Ziel:** Kosten je Arbeitspaket und je Vorhaben ohne Rest „ohne Karte“ in Nachtläufen.
- **Vorgehen:**
  1. Nachtläufe: Jede Session gehört genau einer Karte. Der Runner meldet Kosten je Session mit Kartennummer (die Daten aus `stream-json` liegen vor).
  2. Interaktive Sitzungen: `SessionEnd`-Hook prüfen (Befund #1008, offene Frage 1). `.worktreeinclude` mit `.claude/` als Vorgabe im Installer (offene Frage 4).
  3. Alternative oder Ergänzung: Claude Codes OpenTelemetry-Export auf einen OTLP-Endpunkt im Leitstand, Zuordnung über Umgebungsattribute (Kartennummer, Lauf-ID).
- **Akzeptanz:** Für Nachtläufe ist „ohne Karte“ leer. Die Karte zeigt ihre Kosten.
- **Aufwand:** M.

#### F-7 Benachrichtigungen

- **Ziel:** Der Mensch erfährt von einem Halt, ohne nachzusehen.
- **Vorgehen:** Leitstand sendet bei `kit:klaeren`, `lauf:wartet`, `kit:geschuetzt` und bei Störungen eine Nachricht (Mail, Webhook, optional Push). Dazu eine Morgenübersicht je Projekt: Läufe, Ausgänge, wartende Menschenschritte, Kosten.
- **Akzeptanz:** Einstellbar je Projekt und Person. Ruhezeiten.
- **Aufwand:** M (Leitstand).

#### F-8 Fortgeschriebene Verhaltensbeschreibung (Richtungsfrage)

- **Ziel:** Nach einem abgeschlossenen Vorhaben gibt es eine aktuelle Beschreibung des Systemverhaltens im Repository.
- **Begründung:** `U-2`. OpenSpec zeigt, dass das schlank geht, wenn nur Deltas gepflegt werden.
- **Vorgehen (Skizze):** Wandert ein Vorhaben nach Done, erzeugt ein Kommando aus Fachplan und Abnahmetests (F-4) einen Abschnitt in `docs/verhalten/<bereich>.md` als Delta (neu, geändert, entfernt). Prüfung durch ein fremdes Modell, Freigabe durch den Menschen.
- **Akzeptanz:** offen, hängt an `Q-3`.
- **Aufwand:** M bis L.

#### F-9 Upgrade und Release-Linien

- **Ziel:** Projekte bleiben ohne Handarbeit aktuell, Fremdnutzer wissen, was ein Update bedeutet.
- **Vorgehen:**
  1. `npx github:mannewolff/claude-workflow-kit upgrade` (oder `node install.mjs --upgrade`): liest die installierte Version, zeigt die Changelog-Einträge dazwischen, nennt Migrationsschritte aus einem maschinenlesbaren Abschnitt, mergt die Config.
  2. Versionsregel schriftlich: Major nur bei inkompatibler Config oder entfallener Plattform.
  3. Optional eine Stabil-Linie, die nur Fehlerbehebungen bekommt.
- **Akzeptanz:** Upgrade von 3.x auf 4.0 in einem Testprojekt ohne Handarbeit, mit Hinweis auf WSL2.
- **Aufwand:** M.

#### F-10 Portabilität

- **Vorgehen:**
  1. Installer schreibt zusätzlich eine `AGENTS.md`, die auf den Kern des Regeltexts verweist.
  2. Skills im Format des offenen Agent-Skills-Standards prüfen und angleichen, wo es ohne Verlust geht.
  3. Codex als Implementierer über `night.stufen.<stufe>.kommando` dokumentieren und mit einem Ablauftest belegen (die Mechanik existiert laut Doku bereits).
- **Akzeptanz:** Eine Nacht mit Codex als Implementierer der Stufe leicht ist dokumentiert und getestet.
- **Aufwand:** M.

#### F-11 Zugang für Dritte

- **Vorgehen:** englische Kurzfassung (Quickstart, Konzept, Stopp-Punkte), ein öffentliches Beispielprojekt mit einer aufgezeichneten Nacht (Nachtbericht, Laufstand, Leitstand-Screenshots), ein kurzer Abschnitt „Für wen das Kit nicht passt“.
- **Akzeptanz:** offen, hängt an `Q-1`.
- **Aufwand:** M.

#### F-12 Wirksamkeit öffentlich belegen

- **Ziel:** Das, was der Markt nicht hat, zeigen: Zahlen.
- **Vorgehen:** Aus dem Dogfooding (kanban-kit und Kit selbst) eine anonymisierte Monatsauswertung: Pakete, Erstabnahmequote, Rückläufer, Zeitabbrüche, Kosten je Paket, Wirksamkeit der Prüfungen, Befunde je Art. Methodik offenlegen (was gezählt wird, was nicht, Messgrenzen aus dem Regeltext).
- **Akzeptanz:** eine Seite auf docs.mwolff.org oder im Blog, regelmäßig aktualisiert.
- **Aufwand:** S bis M, sobald F-5 steht.

#### F-13 Kleinere Lücken im Leitstand

- Nachtpläne persistieren.
- Labelfilter in der Boardansicht.
- Vorhabenfilter mit vererbten Zuordnungen.
- Stillefrist in der Oberfläche.
- Beim Verschieben auf ein anderes Board vor dem Verlust von Vorhaben und Abhängigkeiten warnen.
- **Aufwand:** je S.

#### F-14 Native Bausteine bewusst einordnen

- **Ziel:** Kein eigener Code für das, was Claude Code inzwischen selbst kann, und kein Wegfall dessen, was nur das Kit kann.
- **Vorgehen:** Je Baustein entscheiden und im Regeltext als Entscheidung festhalten:

| Baustein | Vorschlag |
|---|---|
| Worktrees je Session | nativ verwenden, wo stabil (P-2) |
| Hintergrund-Sessions, Agent View | beobachten, Research Preview |
| Routines | nicht verwenden: pushen auf `claude/`-Branches, Erfolg nur als „ohne Infrastrukturfehler“ |
| Code Review | als zusätzlicher Reviewer möglich, nie als Gate (blockiert ohnehin nicht) |
| OpenTelemetry | verwenden (F-6) |
| Hooks | für Sperren verwenden, aber nie als einziges Gate (versagen offen) |

- **Aufwand:** S (Entscheidung), Umsetzung in den jeweiligen Maßnahmen.

---

## 10. Vorschlag für die Reihenfolge

**Welle 1, sofort (Tage):**
- H-1 bis H-5
- P-1 (Messung)
- P-5 / F-1 Teil 1 (Reviewer nur lesend)

**Welle 2, die nächsten Wochen:**
- P-7 Wiederholungsbremse
- P-3 Prüfprofile, falls P-1 Werkzeugarbeit als Hauptposten zeigt
- P-4 Kontextdiät, falls P-1 Nachdenken als Hauptposten zeigt
- F-3 serverseitiges Gate
- F-5 und F-6 Kennzahlen und Kosten je Karte im Leitstand
- F-9 Upgrade

**Welle 3, danach:**
- P-2 parallele Umsetzung (Pilot mit 2)
- F-4 Abnahmetests
- F-7 Benachrichtigungen
- F-10 Portabilität
- F-12 öffentliche Zahlen
- F-2 Container-Profil
- F-8 nach Entscheidung zu Q-3

**Begründung der Reihenfolge:** Erst messen, dann die billigen Hebel (P-7, P-3), dann die teuren (P-2). Sicherheit vor Reichweite (F-1, F-3 vor F-10, F-11). Kennzahlen früh, weil sie jede spätere Maßnahme belegen oder widerlegen.

---

## 11. Strategische Risiken

### R-1 Die Plattform holt auf

Claude Code liefert Worktrees, Hintergrund-Sessions, Routines, Dynamic Workflows, Hooks und Telemetrie. Agent OS hat seine Orchestrierung deshalb aufgegeben. Teile des Kits (Session-Steuerung, Worktree-Verwaltung, Transkript-Auswertung) können in einem Jahr Ballast sein.

**Gegenmittel:** F-14. Eigener Aufwand gehört in Stopp-Klasse, festen Kit-Stand, Wirksamkeit, Abnahmetests und Leitstand.

### R-2 Kosten der unbeaufsichtigten Läufe

Laut Presseberichten fällt programmatische Nutzung seit 15.06.2026 unter ein eigenes Guthaben, Überlauf zu API-Preisen. Copilot und andere sind auf Credit-Modelle umgestiegen. Jede Nacht kostet sichtbar Geld.

**Gegenmittel:** Budgets gibt es (`kostenUsd`, `kostenUsdB`, `pruefLauf.kostenUsd`). Dazu P-4, P-6, P-8 und F-6. Lokale Modelle für leichte Stufen.

### R-3 Ein Maintainer

Das Kit hat einen Autor. Release-Takt und Tiefe sind für einen einzelnen Menschen hoch.

**Gegenmittel:** F-9 (Release-Linien), F-11 (Zugang), Konzentration auf die Kernfähigkeiten.

### R-4 Der Leitstand hängt am Kit

Agenten-Boards ohne eigenes Fundament sind 2026 reihenweise eingestellt worden. Der Leitstand hat Tiefe, aber seine Nutzer sind die Nutzer des Kits.

**Gegenmittel:** Leitstand-API auch für andere Läufer öffnen (OTel-Eingang, generisches Laufformat), dann kann er auch Codex- oder Copilot-Läufe zeigen.

### R-5 Regelgewicht kippt erneut

Das Kit wurde schon einmal neu gebaut, weil der Prüfapparat die Automatisierung erstickt hatte. Die aktuelle Größe des Regeltexts zeigt, dass der Druck wieder steigt.

**Gegenmittel:** P-4 mit hartem Größenziel für den Kern und einem Test.

---

## 12. Offene Fragen

- **Q-1** Für wen ist das Kit in den nächsten sechs Monaten gedacht: für die eigene Arbeit, für Beratungskunden, oder für eine offene Community? Davon hängen F-9, F-10 und F-11 ab.
- **Q-2** Soll der Leitstand eigenständig vermarktet werden (R-4), oder bleibt er Teil des Kits?
- **Q-3** Soll es wieder eine fortgeschriebene Verhaltensbeschreibung im Repo geben (F-8), oder bleibt das Board die einzige Quelle?
- **Q-4** Wie viel Parallelität verträgt der eigene Rechner (M5 Max, 36 GB) neben einem lokalen Modell, oder soll die Nacht auf einen zweiten Rechner oder eine Cloud-Maschine?
- **Q-5** Ist `pushPruefung: buildDienst` für die eigenen Projekte schon im Einsatz, und sind Branch Protection und Pflicht-Checks gesetzt?
- **Q-6** Welche Abrechnung gilt für die Nachtläufe (Abo-Guthaben oder API-Schlüssel), und reicht das Guthaben bei steigender Parallelität?
- **Q-7** Sind Abnahmetests (F-4) für die typischen Projekte (Spring Boot, React) auf Domänen- oder API-Ebene machbar, ohne die Prüfzeit zu sprengen?

---

## 13. Quellen

**Bezugsrahmen**
- Böckeler, Harness Engineering (Februar 2026): https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html
- Morris, Humans and Agents in Software Engineering Loops (März 2026): https://martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html
- Böckeler, SDD-Tools: https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Thoughtworks Technology Radar Vol. 34 (April 2026): https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/04/tr_technology_radar_vol_34_en.pdf
- Thoughtworks, Spec-Driven Development: https://www.thoughtworks.com/cn/radar/techniques/spec-driven-development

**Spec-Driven Development**
- GitHub Spec Kit: https://github.com/github/spec-kit und https://github.com/github/spec-kit/releases
- Visual Studio Magazine zu Spec Kit (Mai 2026): https://visualstudiomagazine.com/articles/2026/05/12/github-spec-kit-takes-off-as-antidote-to-piecemeal-vibe-coding.aspx
- OpenSpec: https://github.com/Fission-AI/OpenSpec
- Kiro Doku, Hooks, Pricing: https://kiro.dev/docs/ , https://kiro.dev/docs/hooks/ , https://kiro.dev/pricing/
- Kiro autonomer Agent: https://kiro.dev/blog/introducing-kiro-autonomous-agent/
- Tessl Pricing: https://tessl.io/pricing ; Review (Wettbewerber, befangen): https://codemyspec.com/blog/tessl-review

**Methodenkits**
- BMAD-METHOD: https://github.com/bmad-code-org/BMAD-METHOD
- Agent OS Diskussion: https://github.com/buildermethods/agent-os/discussions/310
- Taskmaster AI: https://github.com/eyaltoledano/claude-task-master
- SuperClaude: https://github.com/SuperClaude-Org/SuperClaude_Framework
- Superpowers (Drittquelle): https://mcp.directory/blog/superpowers-skill-worth-it-2026
- Ruflo (Drittquelle): https://www.augmentcode.com/learn/ruflo-claude-code-multi-agent-orchestration

**Plattformen und Agenten**
- GitHub Agent HQ: https://github.blog/news-insights/company-news/welcome-home-agents/
- Claude und Codex in Copilot: https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/
- Copilot Coding Agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- GitHub Agentic Workflows: https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/
- OpenAI Symphony: https://openai.com/index/open-source-codex-orchestration-symphony
- Codex Doku, Cloud, Hooks, Pricing: https://learn.chatgpt.com/docs , https://learn.chatgpt.com/docs/cloud , https://learn.chatgpt.com/docs/hooks , https://learn.chatgpt.com/docs/pricing
- Codex-Plugin für Claude Code (Drittquelle): https://codex.danielvaughan.com/2026/03/31/codex-plugin-cc-cross-model-bridge/
- Jules (Drittquelle): https://pasqualepillitteri.it/en/news/2163/google-jules-async-ai-coding-agent
- Cursor Hooks und Pricing: https://cursor.com/docs/hooks , https://cursor.com/pricing
- Cursor übernimmt Graphite: https://siliconangle.com/2025/12/19/cursor-acquires-ai-code-review-startup-graphite/
- Devin: https://docs.devin.ai/get-started/devin-intro , https://devin.ai/pricing
- Factory (Drittquellen): https://rywalker.com/research/factory-ai , https://enterprisedna.co/resources/news/factory-ai-droids-200m-5b-valuation-enterprise-coding-september-2026

**Claude Code**
- Übersicht: https://code.claude.com/docs/en/overview
- Hooks: https://code.claude.com/docs/en/hooks
- Routines: https://code.claude.com/docs/en/routines
- Agent View: https://code.claude.com/docs/en/agent-view
- GitHub Actions: https://code.claude.com/docs/en/github-actions
- Code Review: https://code.claude.com/docs/en/code-review
- Monitoring: https://code.claude.com/docs/en/monitoring-usage
- Abrechnung programmatischer Nutzung: https://www.theregister.com/ai-ml/2026/05/14/anthropic-tosses-agents-into-the-api-billing-pool/5240748 und https://thenewstack.io/anthropic-agent-sdk-credits/

**Prüfwerkzeuge**
- SonarQube Gate für agentische KI: https://docs.sonarsource.com/sonarqube-server/2026.4/quality-standards-administration/ai-code-assurance/quality-gate-for-agentic-ai
- SonarQube Server 2026.4: https://www.sonarsource.com/blog/introducing-sonarqube-server-2026-4/
- CodeRabbit Pricing: https://www.coderabbit.ai/pricing
- Qodo Pricing: https://www.qodo.ai/pricing/

**Agenten-Boards**
- Vibe Kanban Einstellung: https://vibekanban.com/blog/shutdown
- Nimbalyst zu Vibe Kanban (Wettbewerber): https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/

**Belege zur Wirksamkeit**
- METR Update 2026: https://metr.org/blog/2026-02-24-uplift-update/
- DORA 2025 (InfoQ): https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025
- CodeRabbit-Studie (The Register): https://www.theregister.com/2025/12/17/ai_code_bugs/
- Faros AI: https://faros.ai/research/ai-acceleration-whiplash
- Asana zu SDD: https://asana.com/inside-asana/spec-driven-development
- Simon Willison zu StrongDM: https://simonwillison.net/2026/Feb/7/software-factory
- AGENTS.md und Agentic AI Foundation: https://siliconangle.com/2025/12/09/linux-foundation-announces-agentic-ai-foundation-joined-anthropic-openai-block/

**Eigene Quellen**
- docs.mwolff.org, kanban.mwolff.org/docs (inkl. nutzung.html, befund-interaktive-sitzungen.html)
- Repository claude-workflow-kit, Commit 39425b1

**Nicht verifiziert:** genaue Jahresangaben der Releases von Spec Kit, BMAD und OpenSpec; Copilot AI Credits; Devin-Desktop-Umbenennung; Status des autonomen Kiro-Agenten jenseits Preview; Lizenzen von Ruflo, CCPM und Symphony; Zahlen zu Cursor Bugbot.

---

## 14. Anhang: Begriffe des Kits und Begriffe des Markts

| Kit | Markt | Anmerkung |
|---|---|---|
| Leitplanke, Pflicht-Check, Commit-Gate | Feedback sensor, computational control, quality gate | |
| Regeltext, Skill, Fachplan, Plan | Guide, feedforward control, steering, spec, constitution | |
| Modell-Prüfung, `/issue-review` | inferential control, LLM-as-judge, adversarial review | |
| Stopp-Punkt | human-in-the-loop checkpoint, approval gate | |
| Stopp-Klasse | (kein Gegenstück gefunden) | |
| Mensch pflegt Leitplanken | human on the loop | Morris |
| Retro schärft Regeln | feedback flywheel | Thoughtworks Assess |
| Wirksamkeit, Rückläuferquote | measuring collaboration quality, first-pass acceptance, rework | Thoughtworks Assess |
| Nacht-Kette | agent orchestration, background agents, software factory | |
| Board als Quelle der Wahrheit | board as control plane | Symphony, Agent HQ |
| Fester Kit-Stand | (kein Gegenstück gefunden) | |
| Arbeitspaket im Vier-Abschnitt-Format | task, ticket | |
| Fachplan | requirements, PRD, spec | |
| Variante B, `kit:durchziehen`, `ziel:*` | autonomy level | als Vollmacht je Karte ohne Gegenstück |
| Leitstand | mission control, agent view, dashboard | |

*© 2026 Manfred Wolff · mwolff.org*
