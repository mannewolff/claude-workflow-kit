# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus achtzehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Schritt 1 ist deine Anforderung; die KI übernimmt die Schritte 2, 3, 5, 6 und 7. Die drei menschlichen Stop-Punkte sind Schritt 4 (GO), Schritt 8 (Push) und Schritt 9 (Merge); zwischen Push und Merge prüfst du den Test-Server. Elf weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /session-start, /triage, /requirement, /groom, /issue-review, /task, /implement-test und /implement-done, /implement-next, /retro und /document.

## Voraussetzungen

**Node.js 18 oder neuer.** Der Installer ist in Node geschrieben und läuft damit auf macOS, Linux und Windows über WSL2 ohne Abhängigkeit zu einem bestimmten Shell-Ökosystem.

**Windows: WSL2.** Das Kit läuft auf macOS, Linux und Windows über WSL2 im selben Umfang. Unter Windows arbeitet es in WSL2; wie du es einrichtest, steht in der Anleitung [Windows über WSL2](/wsl2).

**git.** Claude Code und der gesamte Prozess setzen git voraus. Ohne git-Repository funktioniert kein Skill.

**Claude Code in einer aktuellen Version.** Die Skills nutzen das Skills-System von Claude Code. Ältere Versionen kennen dieses System möglicherweise nicht.

**Ein Board-Adapter — und die passende CLI dazu.** Alle Issue- und Board-Operationen laufen über `.claude/kit/board.mjs`, den Board-Adapter. Der Adapter schirmt die Skills von der konkreten Plattform ab. Was du brauchst, hängt vom gewählten Issue-Tracker ab:

| Issue-Tracker | Voraussetzung |
|---------------|---------------|
| `github` | `gh` (GitHub CLI), einmalig `gh auth login` |
| `gitlab` | `glab` (GitLab CLI), einmalig `glab auth login` |
| `local` | Nichts — Issues liegen als Dateien in `issues/` |

**Ein Projekt-Board, falls du GitHub oder GitLab als Issue-Tracker nutzt.** Das Board braucht diese fünf Spalten: Backlog, Ready, In progress, In review, Done. Bei GitHub sind das Projekt-Board-Spalten (GitHub Projects), bei GitLab werden sie durch Labels abgebildet. Im lokalen Modus gibt es kein Board — der Adapter schreibt und liest YAML-Frontmatter-Dateien direkt.

**`kontext.config.json` für /session-start und /document (optional).** Beide Skills laufen auch ohne diese Datei im Degraded Mode. Wenn du persistentes projektübergreifendes Memory willst: Bei globaler Installation fragt der Installer nach dem Vault-Pfad und legt die Datei automatisch an, bei projektlokaler Installation legst du sie manuell an. Details im Abschnitt [kontext.config.json](/einstellungen#kontext-config-json).

## Die drei menschlichen Stop-Punkte

**Schritt 4: das GO.** Du entscheidest, welche Issues in diesen Batch kommen. Darin liegt die Planung: wie viel Arbeit auf einmal, welche Priorität, welche Abhängigkeiten. Das GO hat zwei Körnungen: Unter **Variante A** ziehst du jedes Arbeitspaket einzeln nach Ready. Unter **Variante B** kennzeichnest du stattdessen vorab die Karte, die die Kette startet — die fachliche Anforderung oder das Plandokument —, mit dem Label aus `night.kette.varianteBLabel` (siehe [Zweiter Modus](/nachtbetrieb#die-nacht-kette)) — das GO gilt dann im Voraus für alle Arbeitspakete, die die Nacht-Kette daraus schneidet; die Kette zieht sie selbst nach Ready und setzt sie in derselben Nacht um.

**Schritt 8: der Push.** Du veränderst den Test-Server. Jeder Batch braucht eine eigene Freigabe, weil zwischen Commit und Push die letzte Chance liegt, den Scope zu überdenken. Unter Variante B ist der Push zugleich der Moment, in dem du die Arbeit der Nacht samt ihrer Entscheidungen annimmst oder verwirfst: Der Nachtbericht am Fachplan listet, was die Kette entschieden hat, und bis zum Push ist keine dieser Entscheidungen verbindlich.

**Schritt 9: der Merge.** Du bringst Code nach production. Du hast auf dem Test-Server geprüft, du trägst die Verantwortung, du mergst.

Das Kit automatisiert diese drei nicht. Das ist kein fehlendes Feature. Es ist der Sinn des Kits: KI macht die Arbeit, Menschen treffen die Entscheidungen.

## Drei Bahnen

Nicht jede Aufgabe braucht den vollen 9-Schritt-Prozess. Das Kit unterscheidet drei Bahnen:

**Bahn 1 — Kleine Änderung.** Genau eine Datei, ein Asset oder ein Config-Wert; keine Datenbank-Migration; kein neuer oder geänderter Endpoint; kein Datenmodell; höchstens ein Modul betroffen; keine sicherheitsrelevante Logik. Direkt umsetzen, ein Commit, kein Push ohne Trigger-Phrase — kein Plan, kein Issue, kein GO. Auch dieser Commit setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus: Das Commit-Gate ist mechanisch und kennt keine Bahn.

**Bahn 2 — Feature.** Außerhalb von Bahn 1, sobald es etwas abzuwägen gibt — oder unklar ist, ob es etwas abzuwägen gibt. Voller Prozess: `/techplan` → `/issues` → GO → `/implement-ready`. Typisch: ein Datenmodell mit mehreren vertretbaren Schnitten, ein Endpoint, dessen Vertrag noch offen ist, eine Migration mit Rückweg-Frage.

**Bahn 3 — `[Task]`.** Oberhalb der Kleinigkeit, aber ohne Abwägungsbedarf. Kein Fachkonzept, kein Plan, keine Zerlegung: ein einzelnes Arbeitspaket mit dem Titel-Präfix `[Task]`, angelegt mit [/task](/prozess#task) nach deiner Bestätigung des Wegs — danach geprüft und freigegeben wie jedes andere Paket. Typisch: eine Umbenennung über mehrere Dateien, ein abgelehnter Werkzeug-Befund, eine mechanische Nachzieharbeit.

**Die Auswahlregel, in dieser Reihenfolge:**

1. Trifft die zählende Bahn-1-Regel zu **und gibt es nichts abzuwägen**, gilt Bahn 1.
2. Sonst entscheidet der Abwägungsbedarf: Abzuwägen gibt es etwas, wenn **mehrere vertretbare Wege** offenstehen. Eine Feststellung mit genau einem richtigen Ausgang ist keine Abwägung. Mit Abwägungsbedarf gilt Bahn 2, ohne ihn Bahn 3.
3. Ist **unklar**, ob es etwas abzuwägen gibt, gilt Bahn 2.

Der Umfang allein entscheidet damit nicht mehr, und das ist die eigentliche Änderung gegenüber früher: Eine Änderung an zwölf Dateien ohne Abwägung ist Bahn 3; eine Architekturänderung an einer einzigen Datei, bei der mehrere Schnitte vertretbar sind, ist Bahn 2. Die alte Fassung von Bahn 2 zählte dagegen Merkmale — Datenmodell, Endpoint, Migration, Sicherheit, mehr als ein Modul — und schickte damit auch das Eindeutige durch den vollen Prozess.

Im Zweifel gilt Bahn 2; das deckt auch den unklaren Abwägungsbedarf. Vor jeder neuen Aufgabe benennt die KI die Bahn laut ("Das ist Bahn 1/2/3, ich …") — Beispiele: ein Icon- oder Favicon-Tausch, eine Textkorrektur oder ein Config-Default sind Bahn 1; eine Umbenennung über mehrere Dateien ohne Abwägung ist Bahn 3; eine neue Tabelle, ein neuer Endpoint oder ein neues UI-Feature sind Bahn 2.

**Ein Sonderfall, der es wert ist, genannt zu werden: die Ablehnung als gültiges Ergebnis.** Ein Werkzeug meldet einen Befund, der Befund ist vertretbar abgelehnt — auch das ist Arbeit, und es ist typische Bahn-3-Arbeit. Damit die Ablehnung hält, ist das Akzeptanzkriterium eines solchen `[Task]` die **versionierte Unterdrückungsregel**, die das Werkzeug selbst auswertet, mit der Begründung unmittelbar daneben: Das Werkzeug liest die Regel, die Begründung richtet sich an Menschen und spätere Sitzungen. Im Kit steht das Muster in `sonar-project.properties` — der Ausschluss der Regel `javascript:S4036` als versionierte Zeile, darüber ausgeschrieben, warum er vertretbar ist. Eine im Web-UI von Hand als „accepted" markierte Ablehnung hält dagegen nicht: Der nächste gleichartige Fund entsteht außerhalb. Verifiziert wird ein solcher Task durch einen erneuten Lauf desselben Werkzeugs — der abgelehnte Befund bleibt aus, **und ein unabhängiger Kontrollbefund wird weiterhin gemeldet**; ohne ihn ist ein stummes Werkzeug von einem wirksamen Ausschluss nicht zu unterscheiden. Fehlt einem Werkzeug ein versionierbarer Weg, gehört dessen Entwicklung in ein eigenes Vorhaben, und ein werkzeugübergreifendes Register entsteht nicht — es wäre eine zweite Liste neben den Regeldateien, die keines der Werkzeuge liest.

## Leitplanken statt Prompts

Ein Sprachmodell reproduziert das häufigste Muster seines Trainingskorpus, nicht das aktuellste. Eine vor Monaten abgekündigte API steht in Millionen Zeilen Altcode noch als der normale Weg; der Abkündigungshinweis ist ein Randfall gegen diese Masse. Das Ergebnis ist ein Denkfehler, vielfach materialisiert: dasselbe veraltete oder abgekündigte Idiom, über alle Aufrufstellen ausgerollt — und oft erst spät in einer externen Analyse sichtbar.

Für solche wiederkehrenden, klassenweiten Fehler gilt dasselbe Prinzip wie beim Coverage-Gate: eine **harte Leitplanke, die im Pflicht-Gate scheitert**, statt ein Prompt oder eine Doku, die bittet. Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen; eine Lint- oder Compiler-Regel in den `buildChecks`, die Agent und CI ohnehin durchlaufen, kann gar nicht erst grün committen. Konkret:

- **Die Leitplanke leitet aus vorhandenen Annotationen ab**, statt eine handgepflegte Verbotsliste zu führen, die selbst veraltet: `@typescript-eslint/no-deprecated` liest JSDoc-`@deprecated`, Java meldet mit `-Xlint:deprecation` und `-Werror` jede abgekündigte API als Build-Fehler. Der Analyzer skaliert mit dem Ökosystem, die Liste nur mit der Pflegedisziplin.
- **Das Gate ist der Hauptfang, SonarQube o. Ä. das Sicherheitsnetz.** Der Round-Trip über main fängt sicher, aber spät — der Fehler ist dann schon auf main. Der Check gehört nach vorn, in `/local-check` und `/implement-ready`, wo der Agent ihn vor Abschluss läuft.
- **Der konkrete Regel-Katalog lebt im jeweiligen Projekt** (`buildChecks` in der Config, Lint-Setup im Repo), nicht im Kit. Das Kit verankert nur das übertragbare Prinzip.

**Der Maßstab dahinter: „Regel im Text oder Regel im Werkzeug".** Er steht in `CLAUDE-workflow.md` und gilt für jede mitgelieferte Anweisung: Eine **Bedienvorgabe** — ihre Befolgung ist an Ausgabe oder Ergebnis ablesbar, ein Werkzeug könnte sie an der Stelle des Lesers ausführen — gehört ins Werkzeug; eine **Urteilsregel**, die eine Entscheidung im Einzelfall verlangt, bleibt im Text. Gemischte Regeln werden zerlegt, nicht gerundet. Welche Regel von `/local-check` nach diesem Maßstab wohin gewandert ist, führt die Aufstellung [Regeln im Werkzeug](regeln-im-werkzeug.md) — Zeile für Zeile, mit Art, Überführungsgrad und neuem Ort.

**Der Grenzfall: wenn keine Leitplanke zu haben ist.** Manches lässt sich nicht messen — ob ein Modell eine Aussage geglaubt hat, statt sie nachzuschlagen, etwa. Dort tritt die ausgewiesene Selbstauskunft an die Stelle des Gates: Die feste Antwortform „Mitteilung übernommen, ungeprüft — …" aus [Mitteilungen: glauben statt nachsehen](/prozess#mitteilungen-glauben-statt-nachsehen) zwingt nichts, macht aber jeden Verstoß zum sichtbaren Widerspruch. Sichtbarer Widerspruch statt Gate — dasselbe Prinzip, nur mit dem schwächeren Mittel, weil das stärkere hier nicht existiert.

## Was bewusst nicht im Kit ist

**Security-Gates gehören ins CI, nicht in einen Skill.** gitleaks findet Secrets, Semgrep oder SpotBugs finden SQL-Konkatenation und fehlende Input-Validation. Ein deterministisches Tool teilt mit keinem Sprachmodell einen blinden Fleck. Ein roter Build blockiert den Push mechanisch, verlässlicher als jedes Modell. Der Review-Skill ergänzt diese Tools, ersetzt sie nicht.

**Kein Multi-Tool-Adapter.** Das Konzept ist übertragbar, das Format nicht. Codex liest `AGENTS.md`, Cursor `.cursor/rules`. Wenn du mehrere Engines einsetzen willst, brauchst du die Skill-Bibliothek in mehreren Formaten parallel im Repo. Das ist machbar, aber nicht Bestandteil dieses Kits.

## Namen für Umsteiger von Version 4

**Skills.** Ein alter Name wird abgewiesen, und die Meldung nennt den neuen.

| Alt | Neu |
|-----|-----|
| `/kontext`, `/context` | `/session-start` |
| `/fachplan` | `/requirement` |
| `/review` | `/kit-review` |
| `/plan` (Wegweiser) | entfällt, der Planungsschritt ist `/techplan` |

**Kommando-Dateien.**

| Alt | Neu |
|-----|-----|
| `kit/befunde.mjs` | `kit/findings.mjs` |
| `kit/aufwand.mjs` | `kit/effort.mjs` |
| `kit/wirksamkeit.mjs` | `kit/effectiveness.mjs` |
| `einstellungen.mjs` | `settings.mjs` |

**Befehle.**

| Kommando | Alt | Neu |
|----------|-----|-----|
| `kit/board.mjs` | `kontext`, `sitzung` | `context`, `session` |
| `kit/board.mjs` | `issue melden`, `nightrun melden`, `sitzung melden` | `issue report`, `nightrun report`, `session report` |
| `kit/board.mjs` | `issue stand`, `issue auftrag`, `issue ursprung` | `issue run-state`, `issue brief`, `issue origin` |
| `kit/board.mjs` | `issue check-geschuetzt`, `issue vorgeschichte`, `issue fragen` | `issue check-protected`, `issue history`, `issue questions` |
| `kit/board.mjs` | `issue-review pruefauftrag` | `issue-review review-brief` |
| `kit/board.mjs` | `hook bash-pruefen` | `hook bash-check` |
| `kit/board.mjs` | `code schutz` mit `einrichten`, `aussetzen`, `wiederherstellen`, `nachpruefen` | `code protection` mit `setup`, `suspend`, `restore`, `verify` |
| `kit/checks.mjs` | `bereiche` | `areas` |
| `kit/findings.mjs` | `arten`, `pruefen`, `buchen`, `vorschlag`, `auswerten`, `befund` | `kinds`, `check`, `record`, `suggest`, `evaluate`, `finding` |
| `kit/effort.mjs` | `auswerten`, `befund`, `auskunft` | `evaluate`, `finding`, `info` |
| `kit/effectiveness.mjs` | `auswerten`, `befund`, `kandidaten` | `evaluate`, `finding`, `candidates` |
| `kit/worktree.mjs` | `anlegen`, `entfernen`, `im`, `nachziehen-pruefen`, `rueckweg` | `create`, `remove`, `in`, `catch-up-check`, `return` |
| `kit/worktree.mjs` | `vorbereitung-festhalten`, `vorbereitung-pruefen` | `record-preparation`, `check-preparation` |

**Optionen.**

| Kommando | Alt | Neu |
|----------|-----|-----|
| `kit/board.mjs` | `--teil`, `--zustand`, `--spalte`, `--pfad`, `--zweig`, `--nur-pfad` | `--part`, `--state`, `--column`, `--path`, `--branch`, `--path-only` |
| `kit/board.mjs` | `--stufe`, `--rolle`, `--datei`, `--material-datei`, `--auftrag`, `--ausgabe`, `--protokoll` | `--stage`, `--role`, `--file`, `--material-file`, `--brief`, `--output`, `--transcript` |
| `kit/board.mjs` | `--begriffe`, `--dateien`, `--ohne`, `--vergleich` | `--terms`, `--files`, `--without`, `--compare` |
| `kit/checks.mjs` | `--stufe`, `--bereich`, `--abschluss`, `--frisch`, `--wiederholen` | `--stage`, `--area`, `--finish`, `--fresh`, `--retry` |
| `kit/night.mjs` | `--kette`, `--pruefen`, `--waechter` | `--chain`, `--check`, `--watcher` |
| `kit/findings.mjs` | `--datei`, `--stufe`, `--karte`, `--art`, `--abgelehnt` | `--file`, `--stage`, `--card`, `--kind`, `--rejected` |
| `kit/effort.mjs` | `--laeufe` | `--runs` |
| `kit/effectiveness.mjs` | `--fenster` | `--window` |
| `kit/worktree.mjs` | `--praefix`, `--ergebnis`, `--offen`, `--verwerfen` | `--prefix`, `--result`, `--open`, `--discard` |
| `install.mjs` | `--sprache`, `--schutz` | `--language`, `--protection` |

**Auswahlwerte.**

| Stelle | Alt | Neu |
|--------|-----|-----|
| `kit/board.mjs --art` | `fachlich`, `idee`, `mensch` | `requirement`, `idea`, `human` |
| `kit/board.mjs --state` | `laeuft`, `abgebrochen`, `wartet`, `fertig` | `running`, `aborted`, `waiting`, `done` |
| `kit/board.mjs --stage` | `fachlich` | `requirement` |
| `kit/checks.mjs --stage` | `paket` | `package` |
| `kit/findings.mjs --stage` | `fachlich` | `requirement` |
| `kit/worktree.mjs --result` | `gruen`, `gruen-offen`, `rot` | `green`, `green-open`, `red` |
| `kit/worktree.mjs --fetch` | `fehlgeschlagen` | `failed` |
| `/push-main` | `vorbereiten`, `notfall` | `prepare`, `emergency` |

**Titel-Präfixe.** Neue Karten tragen nur die englischen; die deutschen erkennt das Kit an offenen Karten weiter.

| Alt | Neu |
|-----|-----|
| `[Fachlich]` | `[Requirement]` |
| `[Idee]` | `[Idea]` |
| `[Mensch]` | `[Human]` |

**Labels.** Das Kit setzt nur die englischen; die deutschen erkennt es an offenen Karten weiter und räumt sie ab, wo es das englische abräumen würde.

| Alt | Neu |
|-----|-----|
| `kit:klaeren` | `kit:clarify` |
| `kit:geschuetzt` | `kit:protected` |
| `kit:durchziehen` | `kit:carry-through` |
| `kit:pruefen` | `kit:check` |
| `lauf:laeuft` | `run:running` |
| `lauf:abgebrochen` | `run:aborted` |
| `lauf:wartet` | `run:waiting` |
| `review:fertig` | `review:done` |
| `ziel:plan` | `goal:plan` |
| `ziel:pakete` | `goal:packages` |
| `ziel:umsetzung` | `goal:implementation` |
| `ziel:push-vorbereitet` | `goal:push-prepared` |

## Lizenz

MIT. Das Kit ist frei verwendbar, veränderbar und weitergabe-fähig.
