---
name: plan
description: Schritt 2 des 9-Schritt-Prozesses — erstellt einen Implementierungsplan, stellt ihn zur Diskussion und implementiert nichts. Nutze diesen Skill wenn der Nutzer /plan aufruft, einen Plan erstellen will oder Schritt 2 des Prozesses startet.
user-invocable: true
---

# Plan

Schritt 2 des 9-Schritt-Prozesses: Die KI erstellt einen Plan. Der Plan wird zur Diskussion gestellt, nicht zur Implementierung.

## Plan-Modell: wer den Plan geschrieben hat

Der Plan nennt in seinem Kopf die Zeile:

```
Plan-Modell: <Selbstauskunft der Session>
```

Der Wert entsteht wie beim `Autor-Modell` in `/issues`: `KIT_AGENT_MODEL`, wenn gesetzt — sonst die Selbstauskunft der laufenden Session.

**Läuft der Skill als `/plan #N` gegen ein fachliches Issue, geht die Angabe zusätzlich als Kommentar ans Issue:**

```bash
node .claude/kit/board.mjs issue comment <N> --text "Plan erstellt von <modell> am <JJJJ-MM-TT>"
```

Der Grund ist die Lückenlosigkeit der Kette. Ein fachliches Issue wird zur Quelle beliebig vieler technischer Issues, und die tragen alle „Fachliche Quelle: Issue #N" plus ihr eigenes `Autor-Modell`. Ohne diesen Kommentar bricht die Nachvollziehbarkeit genau zwischen beiden ab: Man sieht, welches Modell die Issues formuliert hat, aber nicht, welches den Plan entworfen hat, aus dem sie stammen. Der Tracker kann das nicht ergänzen — dort steht als Autor immer der Inhaber des Tokens (Issue #266).

## Eingang `/plan #N`: fachliches Issue als Quelle

Wird der Skill mit einer Issue-Nummer aufgerufen und trägt dieses Issue das Titel-Präfix `[Fachlich]` (PO-Schleife, siehe `/fachplan`), dann ist **das Issue die Anforderungsquelle, nicht der Chat**:

1. Das fachliche Issue vollständig lesen — **den kompletten Body**, denn dort steckt die Groom-Historie mit den PO-Entscheidungen. Die Verhandlung findet im Body statt, nicht in Kommentaren: Der Body ist der verhandelte Stand, Kommentare sind Verlauf. `board.mjs issue get` liefert zusätzlich ein `comments`-Array (Verlauf, Abschlussberichte, Review-Befunde) — das ergänzt den Body, ersetzt ihn aber nicht als Quelle der Anforderung.
2. Den technischen Plan aus Ziel, fachlichen Akzeptanzkriterien und Nicht-Zielen entwickeln; die Nicht-Ziele sind Scope-Grenzen, keine Anregungen.
3. Das fachliche Issue im Plan ausdrücklich referenzieren („Fachliche Quelle: Issue #N"), damit `/issues` den Rückverweis in die technischen Issues übernimmt.

Trägt #N kein `[Fachlich]`-Präfix, gilt der normale Ablauf unten — kein Sonderweg.

## Ablauf

### 0. Bahn bestimmen

Ist die Anforderung Bahn 1 (kleine Änderung nach der Definition in CLAUDE-workflow.md), sag das und biete an, sie **direkt** umzusetzen statt zu planen — kein Plan-Overhead. Nur bei Bahn 2 den vollen Plan erstellen.

### 1. Anforderung verstehen

Kläre zuerst:
- Was soll gebaut werden? (Was fehlt dir noch, um das sicher zu sagen?)
- Welche Bereiche des Codes sind betroffen?
- Gibt es Abhängigkeiten zu anderen Issues oder laufenden Arbeiten?

Frage nach, wenn etwas unklar ist. Raten ist kein Ersatz für eine kurze Rückfrage.

### 2. Relevante Dateien lesen

Lies die betroffenen Dateien und vorhandene Muster. Nutze einen Explore-Agenten, wenn der Scope unklar ist. Suche aktiv nach wiederverwendbaren Funktionen und Mustern — vermeide neuen Code, wenn eine passende Implementierung bereits existiert.

**Trägt `.claude/workflow.config.json` einen Top-Level-Block `spec`, gilt für das Bestandsverhalten eine Rangfolge.** Dann ist die Beschreibung unter `specs/` die **erste** Quelle: Lies vor dem Planen `specs/INDEX.md` und lade die Specs der betroffenen Bereiche. Produktionscode kommt als Quelle für Bestandsverhalten **erst, wenn** die geladenen Specs die Frage nicht beantworten — und jede solche Stelle wird im Unterabschnitt `### Beschreibungs-Luecken` unter `## Betroffene Bereiche` ausgewiesen (Schritt 3). Die Rangfolge betrifft die Frage, *wie sich der Bestand heute verhält*; wer eine Datei ändern will, sieht sie sich weiterhin an.

**Betroffene Bereiche** sind die Einträge aus `specs/INDEX.md`, deren Titel die Anforderung treffen. `checkAreas` aus derselben Config ist ein **anderer Namensraum** — es schneidet die Pflicht-Checks zu, nicht die Beschreibung, und wird hier nicht benutzt. Die beiden Namen sehen sich ähnlich genug, dass eine Verwechslung unbemerkt bliebe: Der Plan lüde dann die falschen Specs und meldete Lücken, die zu einem anderen Zuschnitt gehören.

**Degraded Mode: Block gesetzt, aber kein Index.** Fehlt `specs/INDEX.md` oder ist die Datei leer, meldet der Skill das **einmal** im Plan-Text — etwa als „`spec`-Block gesetzt, aber `specs/INDEX.md` fehlt oder ist leer: geplant wurde gegen den Code" — und läuft ansonsten wie ohne Block weiter. Kein Abbruch, und **keine leere Lückenliste**: Der Unterabschnitt entfällt dann ganz, statt mit einem Leerfall Vollständigkeit zu behaupten, die niemand geprüft hat.

**Ohne `spec`-Block sieht ein Projekt nichts davon.** Keine Rangfolge, keine Beschreibungs-Lücken, keine Vorhaben-Notiz — `/plan` läuft unverändert wie vor Issue #447. Der Schalter ist das Vorhandensein des Blocks, kein Feld darin.

### 3. Plan erstellen

Der Plan hat ein **verbindliches Format** — wie das Vier-Abschnitt-Format der Arbeitspakete in `/issues`, nicht als Anregung. Jeder Plan enthält die folgenden sechs `##`-Überschriften **genau einmal und in dieser Reihenfolge**. Dazwischen dürfen Unterüberschriften ab Ebene `###` stehen, aber keine weiteren Überschriften der Ebene `##`:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

Die Überschriften sind der Anker, an dem die Plan-Prüfung und `/issues` arbeiten — **sinngemäß umformuliert wirken sie nicht**. Sie werden wörtlich übernommen: nicht umbenannt, nicht zusammengefasst, nicht umsortiert.

**Die Reihenfolge ist begründet:** `## Offene Fragen` steht **vor** `## Verifizierung`. Offene Fragen sollen nicht am Ende vergraben werden — als letzter Abschnitt des Dokuments wären sie genau das.

Was in die Abschnitte gehört:

- `## Ziel` — was gebaut wird und welche Wirkung es für den Nutzer hat.
- `## Betroffene Bereiche` — Dateien, Module, Schichten.
- `## Architektonische Entscheidungen` — die getroffenen Entscheidungen, jede mit Begründung:

  > Jede architektonische Entscheidung muss eine Begründung tragen, damit ihre Annahmen und Abwägungen im Review geprüft und angegriffen werden können.

- `## Geplante Änderungen` — je Datei, was sich ändert.
- `## Offene Fragen` — **Stopp-Fragen**: Fragen, deren Antwort den Zuschnitt des Plans ändert. Nachträglich entscheidbare Fragen gehören nicht hierher, sie sind Details der Umsetzung. Betrifft eine Frage die Architektur, ist sie kein optionales Detail. **Fehlerpfad:** Enthält der Abschnitt mindestens eine offene Stopp-Frage, darf der Plan nicht in Arbeitspakete überführt werden. Erst nach Beantwortung und Einarbeitung wird er erneut zur Freigabe gestellt.
- `## Verifizierung` — **beschreibt die auszuführenden Prüfungen, nicht deren vorweggenommenes Ergebnis.**

**Leere Pflichtabschnitte gibt es nicht.** Alle sechs bleiben erhalten, auch wenn es für einen nichts zu sagen gibt; in `## Architektonische Entscheidungen` und `## Offene Fragen` steht dann `- Keine.`

**Die Metadaten zählen nicht mit.** Die Kopfzeilen `Plan-Modell: …` und, falls anwendbar, `Fachliche Quelle: Issue #N` stehen **vor** `## Ziel`. Sie sind keine Überschrift und damit kein siebter Abschnitt des Formats.

#### Beschreibungs-Luecken: ein Unterabschnitt von `## Betroffene Bereiche` (nur mit `spec`-Block)

Bei gesetztem `spec`-Block trägt `## Betroffene Bereiche` einen Unterabschnitt mit der wörtlichen Überschrift `### Beschreibungs-Luecken` — Ebene `###`, nicht `##`. Ein `##` wäre ein siebter Abschnitt und damit ein Formverstoß gegen die sechs Überschriften oben. Die Schreibweise ist transliteriert wie die Kommando- und Feldnamen des Kits (`luecken`, `--kuerzel`), nicht `Lücken`.

Gefüllt wird der Unterabschnitt aus **zwei** Quellen. Die erste ist das Kommando:

```bash
node .claude/kit/spec.mjs luecken --bereich <name> [<name> …]
```

Es meldet je Bereich die Dateien, die keine gültige Aussage berührt — als JSON auf stdout, immer, auch mit leerer Liste. Übergeben werden genau die Bereiche, die in Schritt 2 als betroffen bestimmt wurden.

Die zweite Quelle ist die Session selbst: **jede Stelle, an der Produktionscode als Quelle gedient hat.** Sie steht in dieser Form:

```
- <Bereich>: <Frage, die die Spec nicht beantwortet> — gelesen: <Datei>
```

Das ist **kein Verbot** — Code lesen bleibt erlaubt, es muss nur dastehen. Ein Plan, der schweigend aus dem Code abgeleitet ist, sieht aus wie einer, der gegen die Beschreibung geplant wurde; später ist nicht mehr zu unterscheiden, welcher von beiden er war.

**Die Leerfälle stehen wörtlich fest.** Wurden Bereiche geladen und keine Lücke gefunden:

```
- Keine Beschreibungs-Luecken in den geladenen Bereichen: <Liste der Bereiche>.
```

Ist gar kein Bereich betroffen:

```
- Kein Spec-Bereich betroffen.
```

Bewusst **nicht** `- Keine.` — diese Form ist in `CLAUDE-Plan.md` (P6) für die beiden Pflichtabschnitte `## Architektonische Entscheidungen` und `## Offene Fragen` reserviert. Hier verwendet, wären drei verschiedene Aussagen — „nichts zu entscheiden", „keine Lücke gefunden", „kein Bereich betroffen" — nicht mehr auseinanderzuhalten.

So sieht der Unterabschnitt gefüllt aus:

```
### Beschreibungs-Luecken

- board: kit/board.mjs wird von keiner gueltigen Aussage beruehrt.
- spec: Wie verhaelt sich `luecken` bei einem Bereich ohne Datei? — gelesen: kit/spec.mjs
```

### 4. Plan zur Diskussion stellen

Präsentiere den Plan und warte auf Feedback. Implementiere **nicht**, bevor der Plan freigegeben wurde. Plan-Akzeptanz ist kein GO — das GO kommt separat (Schritt 4).

Typischer Abschluss:
> "Soll ich so vorgehen? Dann lege ich auf GO die GitHub-Issues an (Schritt 3)."

### 5. Plan-Dokument anlegen (nur Bahn 2, nach der Freigabe)

Ist der Plan freigegeben, hält der Skill ihn als eigenes Issue fest — das **Plan-Dokument**. Ohne es ist der Plan das einzige Artefakt der Kette ohne Ort: Er entsteht im Gespräch, wird einmal überflogen und verschwindet. Die technischen Issues verweisen später auf die fachliche Quelle, aber was **dazwischen** entschieden wurde — Architektur, Schnitt, Abwägungen — wäre nach der Sitzung nicht mehr rekonstruierbar.

**Bei Bahn 1 entsteht kein Plan-Dokument.** Dort gibt es keinen Plan; ein leeres `[Plan]`-Ticket je Kleinigkeit wäre Lärm.

**Titel:** `[Plan] <Titel des Vorhabens>`. Das Präfix ist die verbindliche Konvention, an der die übrigen Skills und der Nacht-Runner Plan-Dokumente erkennen und von Arbeitspaketen unterscheiden — dieselbe Mechanik wie `[Fachlich]` und `[Idee]`. Bei `/plan #N` entsteht der Titel aus dem Titel des Quell-Issues **ohne dessen `[Fachlich]`-Präfix**; sonst aus einer knappen Bezeichnung des `## Ziel`-Abschnitts.

**Body:** der freigegebene Plan im verbindlichen Format aus Schritt 3 — alle sechs Abschnitte, unverändert übernommen. Darüber, vor `## Ziel`, die Kopfzeilen:

- `Plan-Modell: <wert>` — **immer**.
- `Fachliche Quelle: Issue #N` — **nur**, wenn der Plan aus `/plan #N` gegen ein `[Fachlich]`-Issue entstand. Bei einem Plan aus dem Chat fehlt diese Zeile; sie zu erfinden behauptete eine Quelle, die es nicht gibt.

**Angelegt über:**

```bash
node .claude/kit/board.mjs issue create \
  --title "[Plan] <Titel>" \
  --author-model "<Wert aus Plan-Modell>" \
  --derived-from <N> \
  --body -
```

Der Body geht über **stdin** (`--body -`, Issue #271) — ein Plan mit Codeblöcken und Tabellen läuft als Kommandozeilen-Argument in die Quoting-Grenze.

**`--derived-from <N>` genau dann, wenn der Plan aus `/plan #N` gegen ein `[Fachlich]`-Issue entstand** (Issue #356). Die Option trägt die Kartennummer des nächsten Vorfahren als Feld ans Board, damit es die Kette Fachplan → Plan → Arbeitspaket als Daten kennt und nicht nur als Zeichen im Beschreibungstext. Bei einem Plan aus dem Chat **entfällt sie** — genauso, wie dort die `Fachliche Quelle`-Zeile entfällt; eine Nummer zu erfinden behauptete eine Quelle, die es nicht gibt.

Die Option wirkt **nur beim Anlegen**. Nachtragen geht nicht: Eine board-lose Pool-Idee ist für den Adapter unerreichbar, und ein späterer Ingest verwirft den Wert. Trackern, die das Feld nicht kennen (`github`, `gitlab`, `local`), schadet die Option nicht — sie nehmen sie folgenlos an.

**`--author-model` ist Pflicht.** Der Adapter lehnt jeden Body ohne `Autor-Modell:`-Zeile ab, sofern weder das Flag noch `KIT_AGENT_MODEL` gesetzt ist (`kit/board.mjs`, Issue #266). Ein Plan-Body trägt aber `Plan-Modell:`, nicht `Autor-Modell:` — ohne das Flag scheitert das Anlegen bei jedem interaktiven Durchlauf zur Laufzeit, während jeder Texttest grün bleibt.

**Rückmeldung.** Der Skill meldet die Nummer des Plan-Dokuments und nennt sie als Bezug für den nächsten Schritt.

**Nach dem Anlegen `label-sync`:**

```bash
node .claude/kit/board.mjs issue-review label-sync <neue-id>
```

Ein frisches Dokument ist ungeprüft; das Kommando setzt `review:offen`. Ohne den Aufruf trägt es gar kein Zustandslabel und fällt in der Board-Ansicht aus der Reihe. Bei einer Pool-Idee ohne Nummer entfällt er ersatzlos.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer Nummer `{ ideaId, pending: true }`, liegt das Plan-Dokument als board-lose Idee im Projekt-Ideen-Pool. Der Skill meldet dann die `ideaId` und weist darauf hin, dass der Mensch es erst einplanen muss — vorher existiert keine Nummer, unter der es adressierbar wäre.

**Fehlerfall:** Schlägt das Anlegen fehl, meldet der Skill **weder eine Nummer noch einen erfolgreichen Abschluss**. Ein Plan, der nirgends steht, ist kein festgehaltener Plan.

#### Vorhaben-Notiz (nur mit `spec`-Block)

Trägt `.claude/workflow.config.json` einen Top-Level-Block `spec`, hält der Skill **unmittelbar nach dem Anlegen des Plan-Dokuments** fest, ob für dieses Vorhaben Produktionscode als Quelle gedient hat. Ohne den Block entfällt der Unterschritt ersatzlos.

**Erst das Kürzel** — es kommt aus dem Tracker:

```bash
node .claude/kit/board.mjs issue epics
```

- **Genau ein Vorhaben in der Liste:** dessen `shortcode` gilt.
- **Mehrere Vorhaben:** Der Skill **fragt den Menschen** und nennt die Kürzel zur Auswahl. Geraten wird nicht: Die Notiz landete unter einem fremden Vorhaben und wäre dort weder zu finden noch als falsch zu erkennen.
- **Leere Liste _oder_ Exitcode ungleich 0:** Rückfall auf `plan-<M>`. **Beides löst ihn aus** — bei `github` und `gitlab` kennt der Adapter keine Vorhaben und endet mit `fail(...)`, also einem Fehler und nicht mit einer leeren Liste. Wer nur die leere Liste abfängt, bekommt bei genau diesen beiden Trackern gar keine Notiz.
- **Leerer `shortcode`:** ebenfalls Rückfall auf `plan-<M>`.

`<M>` ist die Nummer des Plan-Dokuments. Lieferte `issue create` statt einer Nummer eine `ideaId` (Pool-Idee, siehe oben), ist `<M>` die `ideaId`. **Bei Bahn 1 entfällt der Aufruf ganz** — dort entsteht kein Plan-Dokument, und ohne Einheit gibt es nichts zu notieren.

**Dann die Notiz:**

```bash
node .claude/kit/spec.mjs vorhaben --kuerzel <k> --code-gelesen ja|nein [--grund <text>]
```

`--code-gelesen` beantwortet die Frage aus Schritt 2: Musste die Session Produktionscode als Quelle für Bestandsverhalten heranziehen? **`--grund` ist Pflicht bei `--code-gelesen ja`** und nennt die Bereiche und Fragen, für die die Spec schwieg — dieselben Stellen, die als `gelesen:`-Zeilen in `### Beschreibungs-Luecken` stehen. Bei `nein` entfällt der Schalter.

## Stop-Punkt

Dieser Skill endet mit einem Plan-Dokument zur menschlichen Freigabe. Kein Code, kein Commit, keine **technischen** Issues, keine Ready-Bewegung — erst nach explizitem GO. Das `[Plan]`-Dokument ist die einzige Ausnahme: Es entsteht bei Bahn 2 unmittelbar nach der Freigabe, weil es den freigegebenen Stand festhält und nicht dessen Umsetzung vorwegnimmt.
