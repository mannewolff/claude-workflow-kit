---
name: issues
description: Schritt 3 des 9-Schritt-Prozesses — überführt einen freigegebenen Plan in kleinteilige GitHub-Issues im Vier-Abschnitt-Format. Nutze diesen Skill wenn der Nutzer /issues aufruft, Issues aus einem Plan erstellen will oder Schritt 3 des Prozesses startet.
user-invocable: true
---

# Issues

Schritt 3 des 9-Schritt-Prozesses: Der freigegebene Plan wird in ein oder mehrere Issues überführt. Das Issue ist ab jetzt die Quelle der Wahrheit, nicht der Chat.

## Ablauf

### 1. Plan prüfen

Prüfe, ob ein in **dieser Session** freigegebener Plan existiert. Wenn nein: **STOPP — keine Issues anlegen.** Verweise darauf, dass erst `/plan` laufen und freigegeben werden muss. Eine Ideen-/Use-Case-Liste im Chat ist **kein** freigegebener Plan.

### 2. Issues schneiden

Ein Issue = ein logischer Schritt, der eigenständig getestet werden kann. Kriterien:
- Ein Issue löst genau eine Sache
- Es kann isoliert committed und reviewed werden
- Es hat messbare Akzeptanzkriterien
- Abhängigkeiten zu anderen Issues sind explizit

Wenn ein Schritt sich nicht in einem überschaubaren Aufwand erledigen lässt, in Sub-Issues schneiden.

Portabilitaets-Konvention: Wenn eine Datei oder ein Artefakt als eigenstaendig portabel gedacht ist (Installer, Single-File-Tool, kopierbares Script), muss das Akzeptanzkriterium explizit enthalten: "lauffaehig ohne weiteren Repo-Kontext". Ohne diesen Prueffall bleibt die Portabilitaet ungetestet.

Autor-Modell-Konvention: Jedes Issue traegt im Kontext-Abschnitt die Zeile `Autor-Modell: <wert>`. Der Wert entsteht in dieser Reihenfolge:

1. `KIT_AGENT_MODEL`, wenn gesetzt — der Nacht-Runner fuellt sie aus `--model` (Issue #193).
2. sonst die **Selbstauskunft der Session**: das Modell, unter dem sie laeuft.
3. nur wenn beides nicht zu ermitteln ist: woertlich `unbekannt`.

`unbekannt` ist der Ausnahmefall, nicht der Normalfall. Die fruehere Fassung schrieb ihn fuer jede interaktive Session vor — und erzeugte damit genau den Zustand, den `/issue-review` hinterher per Rueckfrage reparieren muss (Issue #226).

**Die Zeile wird nie weggelassen** — eine fehlende Zeile und ein unbekannter Autor sind zwei verschiedene Zustaende, und `/issue-review` muss sie unterscheiden koennen. Der Wert ist eine Selbstauskunft, kein Nachweis; das reicht fuer seinen Zweck: Der Autor soll nicht sein eigener Reviewer werden.

**Seit Issue #266 ist das keine Bitte mehr, sondern eine Leitplanke.** `board.mjs issue create` legt kein Issue an, wenn die Zeile fehlt, und meldet stattdessen einen Fehler. Zwei Wege, sie zu liefern: im `--body` mitschreiben (der Normalfall dieses Skills) oder `--author-model <modell>` uebergeben — dann setzt der Adapter sie selbst in den Kontext-Abschnitt. Ist `KIT_AGENT_MODEL` gesetzt und weder Zeile noch Flag vorhanden, springt der Wert daraus ein; nachts kann eine Session also nicht an der eigenen Leitplanke scheitern.

Plan-Modell-Konvention: Nennt der zugrunde liegende Plan eine Zeile `Plan-Modell: <wert>` (siehe `/plan`), traegt jedes technische Issue sie **zusaetzlich** im Kontext-Abschnitt:

```
Autor-Modell: claude-opus-5
Plan-Modell: claude-sonnet-5
```

Stimmen beide ueberein, genuegt die `Autor-Modell`-Zeile. **Weichen sie ab, stehen beide da** — das ist kein Fehlerfall, sondern der interessante: Ein Plan von einem Modell und Issues von einem anderen sind zwei Autorschaften, und wer spaeter einen Mangel sucht, muss wissen, welche der beiden gemeint ist.

Kopien-Konvention: Aendert ein Issue eine Datei, von der das Repo eine Dogfooding-Kopie fuehrt (Skills, Kit-Tools), verlangt die Aufgabe **`node tools/sync-blobs.mjs`** — nicht "die Kopie mitziehen". Das Tool gleicht `.claude/kit/` und `.claude/skills/` selbst ab und macht `--check` rot, wenn etwas driftet (Issue #213). Eine Bitte im Issue-Text ist genau die Leitplanke, die unter Druck uebersprungen wird: Am 2026-08-06 sind daran zwei Skill-Issues in einem Nachtlauf gescheitert, und zwei weitere Kopien waren davor schon still veraltet.

Kriterien-Konvention: Der Abschnitt `## Akzeptanzkriterium` enthaelt **ausschliesslich Kriterien, die eine Session selbst pruefen kann** — ausfuehrbare Kommandos, Dateizustaende, Testergebnisse. Was ein menschliches Urteil oder eine menschliche Handlung braucht (Klick durch eine UI, Blick auf ein gerendertes Dokument, Urteil ueber Textqualitaet, Livetest gegen eine fremde Instanz), kommt in einen eigenen Block mit **woertlich dieser Ueberschrift**:

```markdown
## Akzeptanzkriterium

- <maschinell pruefbar>

### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)

- <was ein Mensch prueft, bevor das Issue auf Done geht>
```

Die Ueberschrift ist der Anker, an dem `implement-*` und der Nacht-Runner den Block erkennen — sinngemaess umformuliert wirkt sie nicht.

Der Grund: Ein Nacht-Runner kann ein Kriterium mit dem Wort *manuell* prinzipiell nie erfuellen. Die Session steht dann vor einer Wahl, die sie nicht gewinnen kann — abbrechen (Issue bleibt liegen, Session verbrannt) oder trotzdem abschliessen und das offene Kriterium in den Bericht schreiben. Am 2026-08-06 ist beides an einem Abend passiert: Ein Issue hielt an, ein zweites committete mit Vermerk und galt seitdem faelschlich als fertig. Dieselbe Fehlerklasse wie beim `[Idee]`-Gate (Issue #192): Eine Session, die **korrekt** anhaelt, ist vom Runner nicht von einem Fehlschlag zu unterscheiden.

Was die Konvention **nicht** erlaubt: ein Kriterium als manuell zu deklarieren, nur weil es muehsam automatisch zu pruefen waere. Die Frage lautet nicht "ist es unbequem", sondern "braucht es ein menschliches Urteil oder eine menschliche Handlung". Ein Wegwerf-Verzeichnis anzulegen und ein Kommando darin laufen zu lassen ist automatisierbar und gehoert nach oben; zu beurteilen, ob eine Doku verstaendlich ist, gehoert nach unten. Ohne diese Grenze wandert mit der Zeit alles Unbequeme in den unteren Block.

### 3. Issues im Vier-Abschnitt-Format anlegen

Jedes Issue bekommt vier Abschnitte:

```
## Kontext
Warum wird diese Aufgabe gemacht? Was fehlt vorher, welche Vorgeschichte gehört dazu?
Autor-Modell: <Wert von KIT_AGENT_MODEL, sonst 'unbekannt'>

## Aufgabe
Was konkret ist zu tun? Betroffene Dateien, zu schreibende Tests (bei TDD zuerst), konkrete Änderungen.

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist? Konkret, messbar oder ausführbar.

## Spec-Wirkung
Was ändert das Paket an der Beschreibung unter specs/? Nur bei gesetztem spec-Block —
siehe die Spec-Wirkung-Konvention am Ende dieses Schritts.

## Abhängigkeiten
Welche anderen Issues müssen zuerst fertig sein? Oder: "Keine."
```

**Abhängigkeits-Konvention (maschinenlesbar):** Der Abschnitt enthält entweder exakt `Keine.` oder explizite Referenzen der Form `Issue #N` (mehrere möglich, je eine pro Zeile). Erläuternder Freitext ist zusätzlich erlaubt — aber wenn ein anderes Issue gemeint ist, muss die `#N`-Referenz dabeistehen. Grund: Der Nacht-Runner (`kit/night.mjs`) wertet ausschließlich `#N`-Referenzen aus und stellt Issues mit unerfüllten Abhängigkeiten automatisch zurück; eine nur in Prosa beschriebene Abhängigkeit ist für ihn unsichtbar. Abhängigkeiten auf fremde Repos als `owner/repo#N` schreiben (mit Repo-Präfix) — sie werden bewusst nicht als lokale Issues gewertet.

**Rückverweise auf Plan und fachliche Quelle:** Die Kette soll an jedem Punkt lesbar sein — vom Arbeitspaket zum Plan, vom Plan zur fachlichen Anforderung. Beide Verweise stehen **im Kontext-Abschnitt**, unmittelbar untereinander und in dieser Reihenfolge:

```
Plan: Issue #M
Fachliche Quelle: Issue #N
```

- `Plan: Issue #M` — entstehen die Arbeitspakete aus einem `[Plan]`-Issue `#M` (angelegt von `/plan`, siehe Issue #275), trägt jedes von ihnen diese Zeile.
- `Fachliche Quelle: Issue #N` — entstehen sie aus einem fachlichen Issue (`[Fachlich]`-Titel, via `/plan #N`), kommt dieser Verweis dazu.

**Niemals in den Abhängigkeiten-Abschnitt — beide nicht.** Der Nacht-Runner wertet dort jede `Issue #N`-Referenz als Abhängigkeit. Weder das Plandokument noch das fachliche Issue wird Done, solange seine Arbeitspakete laufen: Das fachliche Issue wird erst Done, wenn seine technischen Kinder fertig sind, das Plandokument ohnehin nie durch Umsetzung. Stünde der Verweis unten, blieben alle Kinder nachts dauerhaft zurückgestellt (Henne-Ei).

Der Satz bleibt trotz des Feldes `--derived-from` (siehe unten) korrekt: `derivedFrom` ist keine Body-Zeile und kann in gar keinem Abschnitt stehen; „beide" meint weiterhin die zwei Zeilen. Der Grund ist schärfer, als der Wortlaut vermuten lässt — `parseDeps` in `kit/night.mjs` wertet über `LOKALE_REFERENZ` **jedes** `#N` im Abhängigkeiten-Abschnitt als Abhängigkeit, auch ohne das Wort `Issue` davor.

**Dasselbe zusätzlich als Feld ans Board: `--derived-from`.** Neben den Body-Zeilen bekommt `issue create` die Kartennummer des **nächsten Vorfahren** mit (Issue #356) — das `[Plan]`-Issue `#M`, sonst das fachliche Issue `#N`, sonst gar nichts:

```bash
node .claude/kit/board.mjs issue create --title "Titel" --derived-from <M> --body - <<'BODY'
```

- Liegt ein `[Plan]`-Issue vor: `--derived-from <M>`.
- Fehlt es (Plan nur in der Session freigegeben, oder Bahn 1 ohne Plandokument): Rückfall auf `--derived-from <N>`, das fachliche Issue.
- Fehlt beides: Die Option entfällt ersatzlos — kein Platzhalter, keine Null.
- **Sonderfall Pool-Idee:** Lieferte `issue create` für das Plandokument `{ideaId, pending: true}`, existiert keine Nummer `#M`. Dann greift **derselbe Rückfall** auf das fachliche Issue — kein eigener Zweig, nur derselbe.

**Feld und Zeile sagen dasselbe, sind aber verschieden haltbar — und keines ersetzt das andere.** Das Feld ist die **abfragbare** Form: Das Board kann danach gruppieren, ohne Bodies zu zerlegen. Die Zeile ist die **dauerhafte**: Ein **Projektwechsel löscht die Herkunft** am Board — die der verschobenen Karte und die aller Karten, die auf sie zeigen —, die Body-Zeilen überleben ihn. Dazu kennen `github`, `gitlab` und `local` gar kein solches Feld. Wer die Zeilen später als Dopplung zum Feld streicht, verliert die Herkunft beim ersten Umzug.

**Abgrenzung zur Plan-Modell-Konvention (Issue #266):** `Plan-Modell:` sagt, **welches Modell** den Plan geschrieben hat — den Urheber. `Plan: Issue #M` sagt, **wo er steht** — den Fundort. Beide Zeilen sind unabhängig voneinander: `Plan-Modell:` darf bei identischem Plan- und Issue-Autor entfallen, die `Plan:`-Zeile wird davon nicht berührt und steht auch dann.

**Zwei Randfälle:**

- **Plan ohne `[Plan]`-Issue:** `/issues` nimmt auch einen Plan an, der lediglich in derselben Session freigegeben wurde. Dann entsteht **keine `Plan:`-Zeile** und auch kein Platzhalter — die Zeile hängt allein daran, ob ein `[Plan]`-Issue als Quelle vorliegt.
- **Plan ohne fachliche Quelle:** Steht hinter dem Plandokument keine fachliche Anforderung, steht nur `Plan: Issue #M`.

Issue anlegen ueber den Board-Adapter:

```bash
node .claude/kit/board.mjs issue create --title "Titel" --body - <<'BODY'
## Kontext
...
BODY
```

**Der Body geht ueber stdin, nicht als Argument** (Issue #271). Ein Vier-Abschnitt-Body
mit Codebloecken, Backticks und Tabellen ist der Normalfall, und genau daran scheitert
das Quoting einer Kommandozeile. Wer stattdessen ein Hilfsskript baut, verliert den Weg
im Nachtbetrieb: Ein selbstgebautes Script steht in keiner Allowlist. Alternativ
`--body-file <pfad>` — dann gehoert die Datei **ausserhalb des Projektverzeichnisses**,
sonst ist der Working Tree unsauber und der Nacht-Runner stoppt hart.

Der Adapter legt das Issue an, haengt es ans Board und setzt den Status auf Backlog — provider-unabhaengig.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer Nummer eine `ideaId` mit `pending: true`, ist das Issue als board-lose Idee im Projekt-Ideen-Pool gelandet — die Board-Nummer entsteht erst, wenn der Mensch die Idee einplant. Konsequenzen für diesen Skill:
- Der Abschluss listet solche Issues mit **Titeln** (plus `ideaId`), nicht mit Nummern, und weist darauf hin, dass die Nummern beim Einplanen entstehen.
- Abhängigkeiten zwischen frisch angelegten Issues können noch keine `Issue #N`-Referenz tragen. Sie werden als erläuternder Freitext mit dem **Titel** des anderen Issues notiert; die `Issue #N`-Referenz trägt der Mensch beim Einplanen nach. Für den Nacht-Runner gilt Freitext ohne `#N` als keine prüfbare Abhängigkeit — bewusst akzeptiert, die Ready-Reihenfolge legt ohnehin der Mensch fest.

**Nach dem Anlegen `label-sync`:**

```bash
node .claude/kit/board.mjs issue-review label-sync <neue-id>
```

Ein frisches Dokument ist ungeprüft; das Kommando setzt `review:offen`. Ohne den Aufruf trägt es gar kein Zustandslabel und fällt in der Board-Ansicht aus der Reihe. Bei einer Pool-Idee ohne Nummer entfällt er ersatzlos.

Status bleibt **Backlog**. Die Bewegung nach Ready ist das menschliche GO (Schritt 4) — Claude zieht Issues nie eigenmaechtig nach Ready. (Beim Ideen-Pool-Flow entsprechend: Einplanen und Ready-Ziehen sind menschlich.)

#### Spec-Wirkung: der fuenfte Abschnitt (nur mit `spec`-Block)

Traegt `.claude/workflow.config.json` einen `spec`-Block, bekommt jedes Arbeitspaket einen fuenften Body-Abschnitt `## Spec-Wirkung`. Er sagt, was das Paket an der Beschreibung unter `specs/` aendert. **Ohne `spec`-Block gilt das Vier-Abschnitt-Format unveraendert.** Der Schalter ist das Vorhandensein des Blocks, kein Feld darin.

Das ist keine Bitte im Text: `board.mjs issue create` legt bei gesetztem Block **kein Issue ohne diesen Abschnitt** an (Issue #443), und `node .claude/kit/spec.mjs check --paket <datei>` prueft die Form der Zeilen darin (Issue #442).

**Der Ort:** zwischen `## Akzeptanzkriterium` und `## Abhängigkeiten` — so, wie der Format-Codeblock oben ihn zeigt. `## Abhängigkeiten` bleibt der **letzte** Abschnitt, weil `parseDeps` in `kit/night.mjs` das voraussetzt.

**Die Grammatik** — je Zeile eine Wirkung; vor dem Freitext steht der Gedankenstrich `—` (U+2014), ein Bindestrich ist ein Fehler:

```
NEU       <BEREICH> <ID> — <Aussage>
GEAENDERT <ID> — <neuer Aussage-Text>
ENTFAELLT <ID> — <Grund>
KEINE     — <Begruendung>
```

**Die ID-Form** ist `<bereich>-<N>`. In der `NEU`-Zeile steht der Bereich zusaetzlich davor, und er muss zum Praefix der ID passen:

```
NEU board board-7 — issue create lehnt ein Paket ohne Spec-Wirkung ab.
```

**Die ID-Vergabe:** Die naechste Nummer eines Bereichs ist die **hoechste je vergebene plus eins — einschliesslich der Nummern unter `## Entfallen`**. IDs werden nie wiederverwendet. Wer nur die gueltigen Aussagen zaehlt, vergibt die Nummer einer gestrichenen Aussage neu; `spec.mjs check --paket` weist das Paket dann zurueck.

Gelesen wird `specs/<bereich>.md`, und zwar **beide** Abschnitte: die gueltigen Aussagen oben und die gestrichenen unter `## Entfallen`. Eine einzelne ID schlaegt `node .claude/kit/spec.mjs show <id>` nach. Die Zahlen in `specs/INDEX.md` sind Anzahlen, nicht die hoechste Nummer — sie taugen fuer diese Rechnung nicht.

Drei Faelle:

1. **Bereich ohne eine einzige Aussage** (auch keine entfallene): Die erste Nummer ist `1`.
2. **Mehrere `NEU`-Zeilen in einem `/issues`-Lauf:** `specs/` kennt sie noch nicht — „hoechste plus eins" ergaebe fuer alle dieselbe Nummer. Die Session zaehlt deshalb **fortlaufend** weiter und rechnet die im Lauf bereits vergebenen Nummern mit.
3. **Offene Pakete frueherer Laeufe** sind in `specs/` unsichtbar: Ihre Nummern stehen dort erst, wenn die Pakete umgesetzt sind. Die Session kann sie nicht kennen, und das ist hinzunehmen — die Kollision erkennt `spec.mjs check`. Es gibt keinen Weg, sie vorher zu sehen; wer einen sucht, sucht vergeblich.

**Pakete ohne Wirkung schreiben `KEINE — <Begruendung>`.** Die Begruendung ist **Pflicht**: „keine Wirkung" ist eine Aussage, kein Weglassen. Neben `KEINE` steht keine weitere Wirkungszeile.

### 4. Abschluss

Liste alle angelegten Issues mit Nummern und Titeln.

Ergänze eine Tabelle mit einer Modell-Empfehlung pro Issue. Sie hilft dem Menschen, vor dem GO zu entscheiden, mit welchem Modell jedes Issue umgesetzt wird — ohne den Plan-Kontext noch einmal zu lesen.

| Issue | Empfehlung | Begründung |
|-------|------------|------------|
| #N | <Modell> | <ein Satz> |

Heuristik für die Empfehlung:
- **Schnelleres Standard-Modell** für mechanische, klar spezifizierte Aufgaben: ein Enum erweitern, Typen nachziehen, Restyling nach Vorlage, eine Änderung nach bestehendem Muster.
- **Stärkstes verfügbares Modell** für Aufgaben mit Architektur-, Sicherheits- oder komplexer Interaktionslogik: OAuth-Flows, neue Komponenten mit viel Zustand, Nebenläufigkeit, Datenmigrationen.

Halte die Modellnamen generisch ("Standard-Modell" / "stärkstes verfügbares Modell") und nenne das aktuell passende Modell nur als Beispiel, damit der Skill bei jedem Modell-Release aktuell bleibt. Die Begründung bleibt bei einem Satz pro Issue.

Schreibe darunter:
> "Alle Issues liegen in Backlog. Zieh die Issues die du umsetzen willst nach Ready — das ist dein GO."

Weise zusaetzlich auf **`/issue-review`** hin: Es laesst die frisch angelegten Issues von zwei Modellen pruefen, die sie nicht geschrieben haben. Das GO ist die Bewegung nach Ready — dorthin sollte kein ungepruefte Issue.

## Stop-Punkt

Dieser Skill endet nach dem Anlegen der Issues. Kein Code, kein Commit. Das GO (Ready-Bewegung) macht der Mensch.
