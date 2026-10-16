# Prüfbereiche: Teile, abhängige Bereiche und Ablauf-Prüfungen

Ein Arbeitspaket prüft, was es berührt, nicht die ganze Suite. Diese Seite zeigt, wie ein Projekt seine Prüfungen dafür zuordnet; die Grundlagen stehen in der [Dokumentation](/dokumentation).

## Bereiche einrichten und pflegen

1. **Vorschlag holen:** `node .claude/kit/checks.mjs areas suggest` misst, welche Dateien jeder Test lädt oder nennt, in JavaScript, TypeScript und Java. Er nennt je Bereich die Muster samt den Tests und Dateien dahinter und je Prüfkommando die Bereiche, die es auslösen soll. Ohne Config bilden die Ordner der Testdateien die Gruppen.
2. **Lesen:** Jeden Bereich an den genannten Tests nachvollziehen. Zusammenlegen und Teilen begründet der Vorschlag ebenso; ein Kommando, dessen Tests getrennte Bereiche laden, nennt er mit den Testdateien je Teil, ohne Kommandozeile.
3. **Übernehmen:** Der Vorschlag ändert die Config nie. Was passt, trägt der Mensch in `checkAreas` und in die `areas` der `buildChecks` ein, ganz, teilweise oder gar nicht.
4. **Gerüst-Pfade:** Erwähnen viele Tests einen Pfad nur, ohne ihn zu laden, nennt der Vorschlag ihn als Kandidaten für `nurGeruest`. Ein Eintrag trägt Muster und Grund; die Messung zählt den Pfad dann nicht als geladen.
5. **Abgleichen:** `node .claude/kit/checks.mjs areas compare` vergleicht die Config mit der Messung. Lädt ein Test eine Datei, deren Bereich sein Kommando nicht auslöst, ist das eine Lücke und ein Risiko; ein Bereich, den keiner der Tests lädt, ist nur ein Hinweis. Derselbe Abgleich läuft als `hinweis:` im Prüflauf jedes Pakets, das eine Testdatei anlegt oder ändert, und im Runner sammelt ihn der Laufbericht. Er hält nie an und ändert nichts.
6. **Nicht beurteilbar:** Lässt sich nicht ermitteln, welche Tests ein Kommando fährt, etwa bei einer anderen Sprache, behält es seine Bereiche und steht mit Grund als „nicht beurteilbar“ da. Linter und Kommandos mit `always` gelten als „nicht aus der Auswertung abgeleitet“. Eine fehlende Messung ist nie eine Entwarnung.

## Teile und Bereiche

Ein **Bereich** ist ein Name in `checkAreas` mit einer Liste von Dateimustern. Ein Prüfkommando in `buildChecks` nennt in `areas` seine Bereiche, und `checks.mjs run` startet nur die Kommandos, deren Bereiche eine Änderung berührt.

Ein **Teil** ist eine Quelldatei oder kleine Gruppe mit eigenem Bereich und eigenen Tests. Eine Änderung löst seine Tests aus und die der Teile, die von ihm abhängen.

## Abhängige Bereiche aus dem Importgraphen

Welche Teile mitbetroffen sind, leitet `checks.mjs` aus dem Importgraphen ab:

- Von jeder geänderten Datei läuft die Kette transitiv zu allen Dateien, die sie importieren; jede erreichte berührt ihre Bereiche.
- Der Bericht nennt den Weg, etwa `Bereich board-einstieg beruehrt ueber Import von kit/board/grundlagen.mjs`.
- Lassen sich die Importe nicht erheben, gilt der volle Umfang.

Die Ableitung irrt nur in eine Richtung: Im Zweifel prüft sie mehr, nie weniger.

### Gemeinsame Grundlagen

Was fast jeder Teil braucht, steht in einem eigenen Teil; eine Änderung daran löst über den Graphen die abhängigen Teile aus. Testhilfen stehen in den Mustern aller Bereiche, die sie nutzen. Eine Datei ohne Muster löst den vollen Umfang aus.

### Grenze: nur JavaScript-Quellen

Der Graph entsteht aus Dateien mit der Endung `.mjs`, `.cjs` oder `.js`, die einander importieren. Projekte in anderen Sprachen ordnen allein über die Muster in `checkAreas` zu. Die Messung für `areas suggest` und `areas compare` läuft für TypeScript und Java dagegen von Quelle zu Quelle weiter.

### Nicht literale Importe sind unsichtbar

Erhoben werden statische und dynamische Importe mit literalem Pfad (`import "./x.mjs"`, `await import("./x.mjs")`). Ein Pfad, der erst zur Laufzeit entsteht, etwa über `pathToFileURL(join(dir, name))`, bleibt unsichtbar. Solche Kopplungen gehören von Hand in die `areas` des Prüfkommandos, dessen Teil den Nachbarn lädt.

## Ablauf-Prüfungen

Die meisten Tests rufen einen Teil im selben Prozess auf. Was sich nur als ganzer Ablauf belegen lässt, etwa ein Programm, das ein anderes als Kindprozess startet, prüfen **Ablauf-Prüfungen**.

- **Kennzeichnung:** Eine Testdatei, die selbst oder über einen Helfer ein Programm des Projekts als Kindprozess startet, trägt im Kopf die Zeile

  ```js
  // Ablauf-Pruefung: <Grund, warum ein leichter Beleg nicht reicht>
  ```

- **Gruppe:** Ablauf-Prüfungen laufen in eigenen Prüfkommandos, getrennt von den leichten Tests. Deren `areas` nennen die Bereiche aller Programme, die der Ablauf startet.

### Die Regeln des Wächters

Im Kit prüft ein Wächtertest jede Testdatei bei jeder Änderung unter `test/`:

1. **Kennzeichnen:** Wer einen Kindprozess startet, auch über Helfer, trägt die Zeile `// Ablauf-Pruefung:` mit Grund.
2. **Keine Pausen:** keine feste Wartezeit; begrenztes Warten auf eine Bedingung nur in einer Ablauf-Prüfung.
3. **Gekennzeichnete Hänger:** `sleep <n>` in einer Attrappe nur mit `# haengt` in derselben Zeile.
4. **Import aus dem Teil:** Ein leichter Test importiert aus dem Teil, nicht aus dem Einstieg.

Ein Projekt kann das Muster übernehmen.

## Zuordnungshilfe: breit zugeordnete Kommandos

Nennen die `areas` eines Kommandos alle Bereiche oder alle bis auf einen, bei mindestens drei bereichsgebundenen Kommandos, melden `plan` und `run`:

```
hinweis: <cmd> ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs areas)
```

`node .claude/kit/checks.mjs areas` zeigt die Auswertung je Bereich.

### `coupledAreas`

Ist die Breite gewollt, trägt die Config den Bereich mit Grund ein:

```json
"coupledAreas": [
  { "area": "grundlagen", "reason": "jede Testgruppe laedt die gemeinsame Fixture" }
]
```

Der Eintrag unterdrückt nur die Hinweiszeile; ohne Grund kein Eintrag. Er gilt teamweit.

