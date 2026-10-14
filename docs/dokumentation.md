# Dokumentation: claude-workflow-kit

Das Kit macht aus Claude Code eine Werkstatt mit festem Ablauf: Eine Anforderung geht in neun Schritten bis in die Produktion. Die KI plant, schneidet Arbeitspakete, setzt um, prüft und lässt prüfen. Drei Entscheidungen bleiben bei dir. Diese Seite gibt den Überblick und zeigt, wo die Einzelheiten stehen.

## Konzept

Das Kit besteht aus drei Teilen: achtzehn Skills, einer Config im Projekt und einem Installer. Es ist weder Plattform noch Agent.

Die Skills kennen kein bestimmtes Projekt. Build-Kommandos, Branch-Namen, Prüfungen und Review-Modell stehen in `.claude/workflow.config.json`. Verbessert sich ein Skill, gilt das nach dem nächsten Installer-Lauf in jedem Projekt, das das Kit nutzt.

Alle Zugriffe auf Issues und Board laufen über den Board-Adapter `.claude/kit/board.mjs`. Er spricht mit GitHub, GitLab oder einem lokalen Ordner `issues/`, und die Skills merken davon nichts.

Wo was steht:

- [Einrichtung](/einrichtung): Installation, Config, Issue-Tracker, Aktualisieren.
- [Der Prozess](/prozess): die neun Schritte, jeder Skill mit Zweck und Folgeschritt, ein ganzer Durchlauf.
- [Nachtbetrieb](/nachtbetrieb): Arbeitspakete ohne Aufsicht umsetzen lassen.
- [Einstellungen](/einstellungen): jede Einstellung mit Wirkung und Vorgabe.

## Voraussetzungen

- **Betriebssystem:** macOS, Linux oder Windows über WSL2. Unter Windows arbeitet das Kit vollständig in WSL2; die Einrichtung beschreibt die Anleitung [Windows über WSL2](/wsl2).
- **Node.js 18 oder neuer** für Installer und Kommandos.
- **git**: Jeder Skill arbeitet in einem git-Repository.
- **Claude Code** in einer aktuellen Version mit Skills.
- **Die CLI deines Trackers:** `gh` für GitHub, `glab` für GitLab, jeweils einmal angemeldet. Mit dem lokalen Tracker brauchst du keine.
- **Ein Board** mit den Spalten Backlog, Ready, In progress, In review und Done, wenn du GitHub oder GitLab nutzt. GitLab bildet die Spalten über Labels ab.

Optional ist ein Vault für Notizen über Sitzungen hinweg; `/session-start` und `/document` laufen auch ohne ihn. Die Datei dazu beschreibt [kontext.config.json](/einstellungen#kontext-config-json).

## Die neun Schritte

| Schritt | Was | Wer | Skill |
|---------|-----|-----|-------|
| 1 | Anforderung formulieren | Mensch | – |
| 2 | Planen | KI | [/techplan](/prozess#techplan) |
| 3 | Arbeitspakete anlegen | KI | [/issues](/prozess#issues) |
| 4 | GO: Pakete nach Ready ziehen | Mensch | – |
| 5 | Umsetzen | KI | [/implement-ready](/prozess#implement-ready) |
| 6 | Lokal prüfen | KI | [/local-check](/prozess#pruflauf-von-hand) |
| 7 | Review durch ein zweites Modell | KI | [/kit-review](/prozess#kit-review) |
| 8 | Push auf main | Mensch | [/push-main](/prozess#push-main) |
| 9 | Merge nach production | Mensch | [/merge-production](/prozess#merge-production) |

Zwischen Schritt 8 und 9 prüfst du den Test-Server. Neben den neun Schritten stehen Skills, die den Ablauf vorbereiten oder feiner gliedern: `/triage` bringt eine Idee auf ihre Bahn, `/requirement`, `/issue-review` und `/groom` klären eine fachliche Anforderung, bevor geplant wird, und `/implement-next`, `/implement-test` und `/implement-done` setzen ein einzelnes Paket um. Alle stehen unter [Die Skills](/prozess#die-skills).

## Drei Bahnen

Nicht jede Aufgabe braucht alle neun Schritte. Das Kit kennt drei Bahnen.

**Bahn 1 — Kleine Änderung.** Eine Datei, ein Asset oder ein Config-Wert, ohne Migration, Endpoint, Datenmodell oder sicherheitsrelevante Logik und höchstens ein Modul. Die KI setzt direkt um und committet; Plan, Arbeitspaket und GO entfallen. Auch hier verlangt das Commit-Gate einen grünen `node .claude/kit/checks.mjs run`.

**Bahn 2 — Feature.** Der volle Ablauf: `/techplan`, `/issues`, GO, `/implement-ready`. Typisch sind ein Datenmodell mit mehreren vertretbaren Schnitten oder ein Endpoint, dessen Vertrag offen ist.

**Bahn 3 — `[Task]`.** Mehr als eine Kleinigkeit, aber nichts abzuwägen. [/task](/prozess#task) legt nach deiner Bestätigung genau ein Arbeitspaket mit dem Präfix `[Task]` an, ohne Fachplan, Plan und Zerlegung. Typisch sind eine Umbenennung über viele Dateien oder eine mechanische Nacharbeit.

Die Auswahl folgt drei Regeln, in dieser Reihenfolge:

1. Passt die Aufgabe zu Bahn 1 und gibt es nichts abzuwägen, gilt Bahn 1.
2. Sonst entscheidet, ob mehrere vertretbare Wege offenstehen: Dann gilt Bahn 2, sonst Bahn 3.
3. Ist das unklar, gilt Bahn 2.

Die Zahl der Dateien entscheidet also nicht: Zwölf Dateien ohne Abwägung sind Bahn 3, eine einzige Datei mit zwei vertretbaren Schnitten ist Bahn 2. Vor jeder Aufgabe nennt die KI ihre Bahn.

## Die drei menschlichen Stop-Punkte

**Das GO (Schritt 4).** Du ziehst die Arbeitspakete nach Ready und legst damit fest, was als Nächstes gebaut wird, in welcher Reihenfolge und wie viel auf einmal. Für den Nachtbetrieb kannst du das GO vorab geben: Kennzeichnest du eine fachliche Anforderung oder einen Plan mit dem Label aus `night.chain.variantBLabel`, zieht die [Nacht-Kette](/nachtbetrieb#die-nacht-kette) die daraus geschnittenen Pakete selbst nach Ready und setzt sie um.

**Der Push (Schritt 8).** Erst `push main` bringt die Commits auf den Test-Server. Jeder Push braucht deine eigene Freigabe; davor kannst du den Umfang noch ändern oder verwerfen, auch die Entscheidungen, die eine Nacht getroffen hat.

**Der Merge (Schritt 9).** Nach deiner Prüfung auf dem Test-Server bringt `merge production` den Stand in die Produktion.

Diese drei Schritte automatisiert das Kit absichtlich nicht. Die KI erledigt die Arbeit, entscheiden tust du.

## Leitplanken statt Prompts

Ein Modell schreibt, was in seinen Trainingsdaten am häufigsten vorkommt, also oft eine abgekündigte API oder ein veraltetes Idiom. Eine Bitte im Prompt hilft dagegen wenig. Das Kit setzt auf Prüfungen, die im Pflicht-Gate scheitern: eine Lint- oder Compiler-Regel in den `buildChecks`, die aus vorhandenen Annotationen ableitet, etwa `@typescript-eslint/no-deprecated` oder Java mit `-Xlint:deprecation` und `-Werror`. Welche Regeln gelten, legt jedes Projekt in seiner Config fest.

Dasselbe Prinzip gilt für die Anweisungen des Kits, mit dem Maßstab „Regel im Text oder Regel im Werkzeug“: Was sich an Ausgabe oder Ergebnis prüfen lässt, prüft ein Kommando; im Text bleibt nur, was ein Urteil im Einzelfall verlangt. Wo sich nichts messen lässt, verlangt das Kit eine feste Antwortform, die einen Verstoß sichtbar macht, siehe [Mitteilungen: glauben statt nachsehen](/prozess#mitteilungen-glauben-statt-nachsehen).

## Was bewusst nicht im Kit ist

**Security-Gates.** Secrets, SQL-Konkatenation und fehlende Eingabeprüfung finden Werkzeuge wie gitleaks, Semgrep oder SpotBugs im CI zuverlässiger als ein Modell. Das Review des Kits ergänzt sie.

**Andere KI-Werkzeuge.** Die Skills sind für Claude Code geschrieben. Codex liest `AGENTS.md`, Cursor `.cursor/rules`; wer mehrere Werkzeuge einsetzt, pflegt die Anweisungen in deren Formaten selbst.

## Namen für Umsteiger von Version 4

Version 5 benennt Skills, Kommandos, Optionen, Werte, Präfixe und Labels englisch.

### Skills

Ein alter Name wird abgewiesen, und die Meldung nennt den neuen.

| Alt | Neu |
|-----|-----|
| `/kontext`, `/context` | `/session-start` |
| `/fachplan` | `/requirement` |
| `/review` | `/kit-review` |
| `/plan` (Wegweiser) | entfällt, der Planungsschritt ist `/techplan` |

### Kommando-Dateien

| Alt | Neu |
|-----|-----|
| `kit/befunde.mjs` | `kit/findings.mjs` |
| `kit/aufwand.mjs` | `kit/effort.mjs` |
| `kit/wirksamkeit.mjs` | `kit/effectiveness.mjs` |
| `einstellungen.mjs` | `settings.mjs` |

### Befehle

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

### Optionen

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

### Auswahlwerte

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

### Titel-Präfixe

Neue Karten tragen die englischen, die deutschen erkennt das Kit an offenen Karten weiter.

| Alt | Neu |
|-----|-----|
| `[Fachlich]` | `[Requirement]` |
| `[Idee]` | `[Idea]` |
| `[Mensch]` | `[Human]` |

### Labels

Das Kit setzt die englischen, erkennt die deutschen an offenen Karten und räumt sie ab, wo es das englische abräumen würde.

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

`kit:on-hold` ist neu und hat keinen deutschen Altnamen. Es zeigt am Board, dass eine fachliche Anforderung auf ein äußeres Ereignis wartet; maßgeblich ist die Zeile `Wartet auf Ereignis: <Grund>` im Abschnitt `## Ziel`. Beides setzt `node .claude/kit/board.mjs issue hold <N> --reason "<Grund>"`, beides hebt `issue hold <N> --lift` auf, siehe [Warten auf ein Ereignis](/nachtbetrieb#warten-auf-ein-ereignis).

## Lizenz

MIT: Du darfst das Kit frei nutzen, ändern und weitergeben.
