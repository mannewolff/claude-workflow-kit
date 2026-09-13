---
name: techplan
description: Schritt 2 des 9-Schritt-Prozesses — erstellt einen Implementierungsplan, stellt ihn zur Diskussion und implementiert nichts. Nutze diesen Skill wenn der Nutzer /techplan aufruft, einen Plan erstellen will oder Schritt 2 des Prozesses startet.
user-invocable: true
---

# Plan
Schritt 2 des 9-Schritt-Prozesses: Die KI erstellt einen Plan. Der Plan wird zur Diskussion gestellt, nicht zur Implementierung.

## Im Nachtbetrieb
Erkennungsmerkmal ist **gesetztes `KIT_AGENT_MODEL`** und ausdrücklich kein zweites Signal — dieselbe Bedingung wie im Abschnitt „Im Nachtbetrieb" von `/issue-review`. Der Nacht-Runner stellt dem Auftrag zwar einen Satz voran, der die Betriebsart benennt. **Maßgeblich bleibt allein `KIT_AGENT_MODEL`; der Hinweis im Prompt wiederholt es nur** — sein Fehlen ist keine Entwarnung.

Gestartet wird der Skill nachts vom Nacht-Runner mit `node .claude/kit/night.mjs --erzeuge --stufe plan`, je Dokument eine frische Session mit `/techplan #N` gegen ein geprüftes `[Fachlich]`-Issue.

**Nachts wird nicht gefragt — in keiner Lage.** Das gilt für die Bahn (Schritt 0), für jede Unklarheit in der Anforderung (Schritt 1), für die Diskussion des Plans (Schritt 4) und für das Vorhaben-Kürzel (Unterschritt der Vorhaben-Notiz in Schritt 5). Eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden. Diese Regel gilt für **jeden unbeaufsichtigten Lauf**, nicht nur für diesen Runner — auch dann, wenn ein anderer Runner den Skill startet.

Unverändert nachts: kein Code, kein Commit, keine technischen Issues, keine Ready-Bewegung — der Stop-Punkt am Ende gilt auch unbeaufsichtigt. Das Plan-Dokument aus Schritt 5 entsteht unbeaufsichtigt **unmittelbar nach Schritt 3**; die Freigabe erfolgt dann am Board.

## Plan-Modell: wer den Plan geschrieben hat
Der Plan nennt in seinem Kopf die Zeile:
```
Plan-Modell: <Selbstauskunft der Session>
```

Der Wert entsteht wie beim `Autor-Modell` in `/issues`: `KIT_AGENT_MODEL`, wenn gesetzt — sonst die Selbstauskunft der laufenden Session. **Läuft der Skill als `/techplan #N` gegen ein fachliches Issue, geht die Angabe zusätzlich als Kommentar ans Issue:**
```bash
node .claude/kit/board.mjs issue comment <N> --text "Plan erstellt von <modell> am <JJJJ-MM-TT>"
```

Der Grund ist die Lückenlosigkeit der Kette: Die technischen Issues tragen ihr eigenes `Autor-Modell`, und ohne diesen Kommentar wäre nicht mehr ablesbar, welches Modell den Plan entworfen hat; der Tracker nennt als Autor immer den Inhaber des Tokens.

## Eingang `/techplan #N`: fachliches Issue als Quelle
Wird der Skill mit einer Issue-Nummer aufgerufen und trägt dieses Issue das Titel-Präfix `[Fachlich]` (PO-Schleife, siehe `/fachplan`), dann ist **das Issue die Anforderungsquelle, nicht der Chat**:

1. Das fachliche Issue vollständig lesen — **den kompletten Body**, denn dort steckt die Groom-Historie mit den PO-Entscheidungen. Die Verhandlung findet im Body statt, nicht in Kommentaren: Der Body ist der verhandelte Stand, Kommentare sind Verlauf. `board.mjs issue get` liefert zusätzlich ein `comments`-Array (Verlauf, Abschlussberichte, Review-Befunde) — das ergänzt den Body, ersetzt ihn aber nicht als Quelle der Anforderung.
2. Den technischen Plan aus Ziel, fachlichen Akzeptanzkriterien und Nicht-Zielen entwickeln; die Nicht-Ziele sind Scope-Grenzen, keine Anregungen.
3. Das fachliche Issue im Plan ausdrücklich referenzieren („Fachliche Quelle: Issue #N"), damit `/issues` den Rückverweis in die technischen Issues übernimmt.

## Ablauf
### 0. Bahn bestimmen
**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Es gilt **immer Bahn 2**. Ein Plan-Dokument entsteht auch dann, wenn die Anforderung nach CLAUDE-workflow.md Bahn 1 oder Bahn 3 wäre. Das Urteil wird dabei **nicht verworfen**, sondern steht als erste Zeile in `## Architektonische Entscheidungen` — je nach Bahn eine der beiden Zeilen, wörtlich:
```
- Bahn 1 nach CLAUDE-workflow.md; nachts als Plan festgehalten, Entscheidung beim Menschen.
- Bahn 3 nach CLAUDE-workflow.md; nachts als Plan festgehalten, Entscheidung beim Menschen.
```

Für Bahn 3 kommt ein eigener Grund dazu: Ein `[Task]` entsteht nur nach ausdrücklicher menschlicher Bestätigung des Wegs (siehe `/task`). Nachts kann keine Bestätigung eingeholt werden, also **kann nachts kein `[Task]` entstehen** — der Plan ist dann die einzige Form, in der das Urteil den Morgen erreicht.

**Interaktiv:** Nicht jede Anforderung braucht einen Plan. Zwei Bahnen führen an ihm vorbei, und der Skill benennt sie, statt zu planen:

- **Bahn 1** (kleine Änderung nach der Definition in CLAUDE-workflow.md): sag das und biete an, sie **direkt** umzusetzen — kein Plan-Overhead.
- **Bahn 3**: Gibt es **nichts abzuwägen** — stehen also nicht mehrere vertretbare Wege offen —, sag das, biete `/task` an und **plane nicht**. Der Vorgang wird dann ein einzelnes Arbeitspaket mit dem Titel-Präfix `[Task]`, ohne Fachkonzept und ohne Plan.

**Das Bahn-3-Angebot gilt nur, solange kein `[Fachlich]`- und kein `[Plan]`-Dokument als Quelle vorliegt.** Bei `/techplan #N` gegen ein `[Fachlich]`-Issue bleibt der begonnene volle Weg erhalten: `/task` lehnt diese Quelle ausdrücklich ab, und auf einen Skill zu verweisen, der die Nummer zurückweist, wäre eine Sackgasse. Eine **`[Idee]`** als Quelle steht dem Angebot dagegen **nicht** entgegen — sie ist eine rohe Anforderung, kein begonnener Weg, und `/task #N` nimmt sie an.

### 1. Anforderung verstehen
Kläre zuerst: Was soll gebaut werden, welche Bereiche des Codes sind betroffen, gibt es Abhängigkeiten zu anderen Issues oder laufenden Arbeiten?

**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Es wird **nicht nachgefragt**. Jede offene Stelle wird nach `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen", entschieden und als E-Eintrag unter `## Architektonische Entscheidungen` festgehalten, im Format von dort. Nur eine Frage aus der Stopp-Klasse steht in `## Offene Fragen` — dort und nur dort liest der Runner sie —, genau eine je Halt; der Plan bleibt dann als Entwurf stehen und ist kein Eingang für `/issues`. Ein Protokoll außerhalb des Plan-Dokuments zählt nicht: Was nur im Session-Log oder in einem Board-Kommentar steht, sieht der nächste Schritt nicht.

**Interaktiv:** Frage nach, wenn etwas unklar ist. Was der Mensch entscheidet, steht im selben Format unter `## Architektonische Entscheidungen`.

### 2. Relevante Dateien lesen
Lies die betroffenen Dateien und vorhandene Muster. Nutze einen Explore-Agenten, wenn der Scope unklar ist. Suche aktiv nach wiederverwendbaren Funktionen und Mustern — vermeide neuen Code, wenn eine passende Implementierung bereits existiert.

**Trägt `.claude/workflow.config.json` einen Top-Level-Block `spec`, gilt für das Bestandsverhalten eine Rangfolge.** Dann ist die Beschreibung unter `specs/` die **erste** Quelle: Lies vor dem Planen `specs/INDEX.md` und lade die Specs der betroffenen Bereiche. Produktionscode kommt als Quelle für Bestandsverhalten **erst, wenn** die geladenen Specs die Frage nicht beantworten — und jede solche Stelle wird im Unterabschnitt `### Beschreibungs-Luecken` unter `## Betroffene Bereiche` ausgewiesen (Schritt 3). Die Rangfolge betrifft die Frage, *wie sich der Bestand heute verhält*; wer eine Datei ändern will, sieht sie sich weiterhin an.

**Betroffene Bereiche** sind die Einträge aus `specs/INDEX.md`, deren Titel die Anforderung treffen. `checkAreas` aus derselben Config ist ein **anderer Namensraum** — es schneidet die Pflicht-Checks zu, nicht die Beschreibung, und wird hier nicht benutzt. Die beiden Namen sehen sich ähnlich genug, dass eine Verwechslung unbemerkt bliebe: Der Plan lüde dann die falschen Specs und meldete Lücken, die zu einem anderen Zuschnitt gehören.

**Degraded Mode: Block gesetzt, aber kein Index.** Fehlt `specs/INDEX.md` oder ist die Datei leer, meldet der Skill das **einmal** im Plan-Text — etwa als „`spec`-Block gesetzt, aber `specs/INDEX.md` fehlt oder ist leer: geplant wurde gegen den Code" — und läuft ansonsten wie ohne Block weiter. Kein Abbruch, und **keine leere Lückenliste**: Der Unterabschnitt entfällt dann ganz, statt mit einem Leerfall Vollständigkeit zu behaupten, die niemand geprüft hat. **Ohne `spec`-Block sieht ein Projekt nichts davon.** Keine Rangfolge, keine Beschreibungs-Lücken, keine Vorhaben-Notiz — `/techplan` läuft unverändert wie vor dem `spec`-Block. Der Schalter ist das Vorhandensein des Blocks, kein Feld darin.

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

Die Überschriften sind der Anker, an dem die Plan-Prüfung und `/issues` arbeiten — **sinngemäß umformuliert wirken sie nicht**. Sie werden wörtlich übernommen: nicht umbenannt, nicht zusammengefasst, nicht umsortiert. **Die Reihenfolge ist begründet:** `## Offene Fragen` steht **vor** `## Verifizierung`. Offene Fragen sollen nicht am Ende vergraben werden — als letzter Abschnitt des Dokuments wären sie genau das. Was in die Abschnitte gehört:

- `## Ziel` — was gebaut wird und welche Wirkung es für den Nutzer hat.
- `## Betroffene Bereiche` — Dateien, Module, Schichten.
- `## Architektonische Entscheidungen` — die getroffenen Entscheidungen, jede mit Begründung:

  > Jede architektonische Entscheidung muss eine Begründung tragen, damit ihre Annahmen und Abwägungen im Review geprüft und angegriffen werden können.

  Dazu die E-Einträge aus „Entscheiden statt fragen": jede beim Planen entschiedene Frage, im Format aus `CLAUDE-workflow.md`, fortlaufend nummeriert.

- `## Geplante Änderungen` — je Datei, was sich ändert.
- `## Offene Fragen` — **Stopp-Fragen**: Fragen aus der Stopp-Klasse in `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen". Nachträglich entscheidbare Fragen gehören nicht hierher, sie werden entschieden und stehen als E-Eintrag unter `## Architektonische Entscheidungen`. **Fehlerpfad:** Enthält der Abschnitt mindestens eine offene Stopp-Frage, darf der Plan nicht in Arbeitspakete überführt werden. Erst nach Beantwortung und Einarbeitung wird er erneut zur Freigabe gestellt.
- `## Verifizierung` — **beschreibt die auszuführenden Prüfungen, nicht deren vorweggenommenes Ergebnis.**

**Leere Pflichtabschnitte gibt es nicht.** Alle sechs bleiben erhalten, auch wenn es für einen nichts zu sagen gibt; in `## Architektonische Entscheidungen` und `## Offene Fragen` steht dann `- Keine.` **Die Metadaten zählen nicht mit.** Die Kopfzeilen `Plan-Modell: …` und, falls anwendbar, `Fachliche Quelle: Issue #N` stehen **vor** `## Ziel`. Sie sind keine Überschrift und damit kein siebter Abschnitt des Formats.

#### Beschreibungs-Luecken: ein Unterabschnitt von `## Betroffene Bereiche` (nur mit `spec`-Block)
Bei gesetztem `spec`-Block trägt `## Betroffene Bereiche` einen Unterabschnitt mit der wörtlichen Überschrift `### Beschreibungs-Luecken` — Ebene `###`, nicht `##`. Ein `##` wäre ein siebter Abschnitt und damit ein Formverstoß gegen die sechs Überschriften oben. Die Schreibweise ist transliteriert wie die Kommando- und Feldnamen des Kits (`luecken`, `--kuerzel`), nicht `Lücken`.

Gefüllt wird der Unterabschnitt aus **zwei** Quellen. Die erste ist das Kommando `node .claude/kit/spec.mjs luecken --bereich <name> [<name> …]`. Es meldet je Bereich die Dateien, die keine gültige Aussage berührt — als JSON auf stdout, immer, auch mit leerer Liste. Übergeben werden genau die Bereiche, die in Schritt 2 als betroffen bestimmt wurden.

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

### 4. Plan zur Diskussion stellen
**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Die Diskussion **entfällt**, Schritt 5 folgt unmittelbar. Ohne diese Ausnahme entsteht nachts überhaupt kein Artefakt: Der Skill wartete auf ein Feedback, das niemand gibt, und der Runner sähe einen Fehlschlag. Die Freigabe ist damit nicht übergangen, sondern verschoben — sie erfolgt am Board.

**Interaktiv:** Präsentiere den Plan und warte auf Feedback. Implementiere **nicht**, bevor der Plan freigegeben wurde. Plan-Akzeptanz ist kein GO — das GO kommt separat (Schritt 4).

### 5. Plan-Dokument anlegen (nur Bahn 2 — interaktiv nach der Freigabe, unbeaufsichtigt unmittelbar nach Schritt 3)
Steht der Plan — interaktiv also nach der Freigabe, unbeaufsichtigt nach Schritt 3 —, hält der Skill ihn als eigenes Issue fest: das **Plan-Dokument**. Ohne es ist der Plan das einzige Artefakt der Kette ohne Ort: Er entsteht im Gespräch, wird einmal überflogen und verschwindet. Die technischen Issues verweisen später auf die fachliche Quelle, aber was **dazwischen** entschieden wurde — Architektur, Schnitt, Abwägungen — wäre nach der Sitzung nicht mehr rekonstruierbar.

**Bei Bahn 1 entsteht kein Plan-Dokument.** Dort gibt es keinen Plan; ein leeres `[Plan]`-Ticket je Kleinigkeit wäre Lärm.

**Titel:** `[Plan] <Titel des Vorhabens>`. Das Präfix ist die verbindliche Konvention, an der die übrigen Skills und der Nacht-Runner Plan-Dokumente erkennen und von Arbeitspaketen unterscheiden — dieselbe Mechanik wie `[Fachlich]` und `[Idee]`. Bei `/techplan #N` entsteht der Titel aus dem Titel des Quell-Issues **ohne dessen `[Fachlich]`-Präfix**; sonst aus einer knappen Bezeichnung des `## Ziel`-Abschnitts.

**Body:** der freigegebene Plan im verbindlichen Format aus Schritt 3 — alle sechs Abschnitte, unverändert übernommen. Darüber, vor `## Ziel`, die Kopfzeilen:

- `Plan-Modell: <wert>` — **immer**.
- `Fachliche Quelle: Issue #N` — **nur**, wenn der Plan aus `/techplan #N` gegen ein `[Fachlich]`-Issue entstand. Bei einem Plan aus dem Chat fehlt diese Zeile; sie zu erfinden behauptete eine Quelle, die es nicht gibt.

Vor dem Anlegen prüft ein Kommando die Form; erst bei `ok: true` folgt `issue create`, Verstöße werden in der Datei behoben und erneut geprüft:
```bash
node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/plandokument.md --title "[Plan] <Titel>"
```

**Angelegt über:**
```bash
node .claude/kit/board.mjs issue create \
  --title "[Plan] <Titel>" \
  --author-model "<Wert aus Plan-Modell>" \
  --derived-from <N> \
  --body-file <tmpdir>/plandokument.md
```

Der Plantext entsteht davor stueckweise, jedes Stueck in einem **eigenen** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board". **Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere Mutation — der bestehende Fehlerfall („weder eine Nummer noch einen erfolgreichen Abschluss“) bleibt unveraendert:
```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/plandokument.md <<'TEIL1'
Plan-Modell: <wert>
Fachliche Quelle: Issue #N

## Ziel
…
TEIL1
```

```bash
cat >> <tmpdir>/plandokument.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

**`--derived-from <N>` genau dann, wenn der Plan aus `/techplan #N` gegen ein `[Fachlich]`-Issue entstand**. Die Option trägt die Kartennummer des nächsten Vorfahren als Feld ans Board, damit es die Kette Fachplan → Plan → Arbeitspaket als Daten kennt und nicht nur als Zeichen im Beschreibungstext. Bei einem Plan aus dem Chat **entfällt sie** — genauso, wie dort die `Fachliche Quelle`-Zeile entfällt; eine Nummer zu erfinden behauptete eine Quelle, die es nicht gibt.

**`--author-model` ist Pflicht.** Der Adapter lehnt jeden Body ohne `Autor-Modell:`-Zeile ab, sofern weder das Flag noch `KIT_AGENT_MODEL` gesetzt ist (`kit/board.mjs`). Ein Plan-Body trägt aber `Plan-Modell:`, nicht `Autor-Modell:` — ohne das Flag scheitert das Anlegen bei jedem interaktiven Durchlauf zur Laufzeit, während jeder Texttest grün bleibt.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer Nummer `{ ideaId, pending: true }`, liegt das Plan-Dokument als board-lose Idee im Projekt-Ideen-Pool. Der Skill meldet dann die `ideaId` und weist darauf hin, dass der Mensch es erst einplanen muss — vorher existiert keine Nummer, unter der es adressierbar wäre.

**Fehlerfall:** Schlägt das Anlegen fehl, meldet der Skill **weder eine Nummer noch einen erfolgreichen Abschluss**. Ein Plan, der nirgends steht, ist kein festgehaltener Plan.

#### Vorhaben-Notiz (nur mit `spec`-Block)
Trägt `.claude/workflow.config.json` einen Top-Level-Block `spec`, hält der Skill **unmittelbar nach dem Anlegen des Plan-Dokuments** fest, ob für dieses Vorhaben Produktionscode als Quelle gedient hat. Ohne den Block entfällt der Unterschritt ersatzlos.

**Erst das Kürzel** — es kommt aus dem Tracker über `node .claude/kit/board.mjs issue epics`:

- **Genau ein Vorhaben in der Liste:** dessen `shortcode` gilt.
- **Mehrere Vorhaben:**
  - **Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Rückfall auf `plan-<M>` — derselbe Rückfall wie bei der leeren Liste unten. Geraten wird auch nachts nicht; die Notiz hängt dann am Plan-Dokument statt an einem fremden Vorhaben.
  - **Interaktiv:** Der Skill **fragt den Menschen** und nennt die Kürzel zur Auswahl. Geraten wird nicht: Die Notiz landete unter einem fremden Vorhaben und wäre dort weder zu finden noch als falsch zu erkennen.
- **Leere Liste _oder_ Exitcode ungleich 0:** Rückfall auf `plan-<M>`. **Beides löst ihn aus** — bei `github` und `gitlab` kennt der Adapter keine Vorhaben und endet mit `fail(...)`, also einem Fehler und nicht mit einer leeren Liste. Wer nur die leere Liste abfängt, bekommt bei genau diesen beiden Trackern gar keine Notiz.
- **Leerer `shortcode`:** ebenfalls Rückfall auf `plan-<M>`.

`<M>` ist die Nummer des Plan-Dokuments. Lieferte `issue create` statt einer Nummer eine `ideaId` (Pool-Idee, siehe oben), ist `<M>` die `ideaId`. **Bei Bahn 1 entfällt der Aufruf ganz** — dort entsteht kein Plan-Dokument, und ohne Einheit gibt es nichts zu notieren.

**Dann die Notiz:**
```bash
node .claude/kit/spec.mjs vorhaben --kuerzel <k> --code-gelesen ja|nein [--grund <text>]
```

`--code-gelesen` beantwortet die Frage aus Schritt 2: Musste die Session Produktionscode als Quelle für Bestandsverhalten heranziehen? **`--grund` ist Pflicht bei `--code-gelesen ja`** und nennt die Bereiche und Fragen, für die die Spec schwieg — dieselben Stellen, die als `gelesen:`-Zeilen in `### Beschreibungs-Luecken` stehen. Bei `nein` entfällt der Schalter. **Die Notiz entsteht zweistufig.** `vorhaben` legt sie hier als **wartende** Datei `.claude/vorhaben-wartend-<k>.md` ab; unter `specs/vorhaben/` kommt sie erst an, wenn der nächste `push main` sie aufhebt. Beim Planen entsteht dadurch weder ein Commit noch eine Änderung im Working Tree — und genau darum geht es: `/techplan` läuft mitten in einer Session, oft nachts, und eine ungefragte Änderung unter `specs/` wäre dort der unsaubere Working Tree, an dem der Nacht-Runner hart stoppt.

**Fehlerpfad: eine misslungene Ablage ist kein misslungenes Planen.** Endet `spec.mjs vorhaben` mit einem Exitcode ungleich 0, gilt das Planen **trotzdem als gelungen** — das Plandokument steht bereits, und es ist das Artefakt dieses Schritts. Es gibt **keine automatische Wiederherstellung**; nachgeholt wird von Hand mit dem vollständigen Kommando oben, in dem `<k>` und `--code-gelesen` die Werte dieses Laufs tragen. Die Meldung nennt dieses Kommando ausgeschrieben und sagt dazu, dass die Notiz erst beim nächsten `push main` unter `specs/vorhaben/` ankommt.
bash
node .claude/kit/spec.mjs vorhaben --kuerzel <k> --code-gelesen <ja|nein> [--grund <text>]
```

**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Grund und Nachhol-Kommando gehen als Kommentar an das Plandokument `<M>`:
```bash
node .claude/kit/board.mjs issue comment <M> --text "Vorhaben-Notiz nicht abgelegt: <Grund>. Nachholen: <Kommando>"
```

**Interaktiv:** Grund und Nachhol-Kommando stehen beide in der Rückmeldung an den Menschen.

## Stop-Punkt
Dieser Skill endet mit einem Plan-Dokument zur menschlichen Freigabe. Kein Code, kein Commit, keine **technischen** Issues, keine Ready-Bewegung — erst nach explizitem GO. Das `[Plan]`-Dokument ist die einzige Ausnahme: Es entsteht bei Bahn 2 interaktiv nach der Freigabe, unbeaufsichtigt unmittelbar nach Schritt 3 — die Freigabe erfolgt dann am Board —, weil es den erreichten Stand festhält und nicht dessen Umsetzung vorwegnimmt.
