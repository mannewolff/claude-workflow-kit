# Prüfbereiche: Teile, abhängige Bereiche und Ablauf-Prüfungen

Diese Seite ist für Projekte, die das Kit nutzen und ihre Prüfungen gezielt zuordnen wollen. Ziel: Ein Arbeitspaket prüft, was es berührt, und nicht bei jeder Änderung die ganze Suite. Die Grundlagen zu `buildChecks`, `checkAreas` und den Prüfstufen stehen in der [Dokumentation](/dokumentation); hier geht es um das Zusammenspiel.

## Teile und Bereiche

Ein **Bereich** ist ein Name in `checkAreas` mit einer Liste von Dateimustern. Ein Prüfkommando in `buildChecks` nennt in `areas`, zu welchen Bereichen es gehört. `checks.mjs run` startet nur die Kommandos, deren Bereiche eine Änderung berührt.

Ein **Teil** ist eine Quelldatei (oder eine kleine Gruppe), die einen eigenen Bereich bildet. Im Kit selbst sind Nacht-Runner und Board-Werkzeug so zerlegt: `kit/night.mjs` und `kit/board.mjs` sind nur noch Einstiege, die Logik liegt in Teilen unter `kit/night/` und `kit/board/`. Jeder Teil hat seine Tests, und eine Änderung an einem Teil löst nur diese Tests aus — plus die der abhängigen Teile.

## Abhängige Bereiche aus dem Importgraphen

Welche Teile von einer Änderung mitbetroffen sind, leitet `checks.mjs` aus dem **Importgraphen** ab, nicht aus einer Handliste:

- Ausgangspunkt ist jede geänderte Datei. Von ihr läuft die Kette zu allen Dateien, die sie importieren, von dort weiter zu deren Importeuren — transitiv, durch Dateien mit und ohne Muster.
- Jeder erreichte Importeur berührt seine Bereiche. Ändert ein Paket eine Datei in Bereich A und importiert eine Datei aus Bereich B diese Datei, gilt B als berührt.
- Der Bericht nennt den Weg, etwa `Bereich board-einstieg beruehrt ueber Import von kit/board/grundlagen.mjs`. So ist nachvollziehbar, warum eine Prüfung lief.
- Lassen sich die Importe nicht erheben, gilt der volle Umfang: `voller Umfang: die Importe liessen sich nicht erheben`.

Intern heißt diese Ableitung `abhaengigeBereiche`. Sie irrt nur in eine Richtung: Sie prüft im Zweifel mehr, nie weniger. Eine Handliste dagegen veraltet still und lässt dann Prüfungen aus.

### Gemeinsame Grundlagen

Was fast jeder Teil braucht — Shell-Aufrufe, Fehler, Config-Zugriff, Logging —, steht in einem eigenen Teil, im Kit `kit/board/grundlagen.mjs` und `kit/night/grundlagen.mjs`. Eine Sonderliste „gemeinsam“ gibt es nicht: Weil fast jeder Teil die Grundlagen importiert, löst eine Änderung daran über den Graphen von selbst die abhängigen Teile aus, und der Bericht nennt den Importweg.

Testhilfen bleiben in den Mustern aller Bereiche, die sie nutzen. Eine Datei ohne Muster löst wie bisher den vollen Umfang aus.

### Grenze: nur JavaScript-Quellen

Die Ableitung wirkt nur in Projekten mit JavaScript-Quellen — Dateien mit der Endung `.mjs`, `.cjs` oder `.js` —, sobald diese einander importieren. Projekte in anderen Sprachen (Java, Python, TypeScript-Builds ohne diese Endungen …) bekommen keine abhängigen Bereiche aus dem Graphen. Sie ordnen ausschließlich über die Muster in `checkAreas` zu; die Zuordnungshilfe unten zeigt ihnen, wo ein Zuschnitt fehlt.

### Nicht literale Importe sind unsichtbar

Die Erhebung sieht statische und dynamische Importe mit **literalem** Pfad (`import "./x.mjs"`, `await import("./x.mjs")`). Einen Import, dessen Pfad erst zur Laufzeit entsteht — etwa über `pathToFileURL(join(dir, name))` —, sieht sie nicht. Im Kit betrifft das die Nachbar-Importe des Nacht-Runners auf `board.mjs`, `checks.mjs`, `aufwand.mjs`, `wirksamkeit.mjs` und `befunde.mjs` sowie den Windows-Import des Board-Teils in `checks.mjs`.

Solche Kopplungen gehören **von Hand** in die `areas` des Prüfkommandos, dessen Teil den Nachbarn lädt. Das Kit hält das mit einem Kopplungs-Gate fest (`test/config-teile.test.mjs` über `tools/verflechtung.mjs`), das die Nennung von Quellpfaden als Zeichenkette misst.

## Ablauf-Prüfungen

Die meisten Tests prüfen im selben Prozess: Sie importieren den Teil und rufen seine Funktionen auf. Manches Verhalten lässt sich aber nur als ganzer Ablauf belegen — etwa dass der Nacht-Runner die Board-CLI als Kindprozess startet. Solche Tests heißen **Ablauf-Prüfungen**.

- **Kennzeichnung:** Eine Testdatei, die selbst oder über einen Helfer unter `test/helpers/` ein Programm aus `kit/` oder `tools/` als Kindprozess startet, trägt im Kopf die Zeile

  ```js
  // Ablauf-Pruefung: <Grund, warum ein leichter Beleg nicht reicht>
  ```

- **Gruppe:** Im Kit liegen Ablauf-Prüfungen in Dateien `test/ablauf-*.test.mjs` und laufen in eigenen Prüfkommandos, getrennt von den leichten Tests. Deren `areas` nennen die Bereiche aller Programme, die der Ablauf startet — so ist die Prozess-Kopplung ohne eigenen Config-Schlüssel erfasst, und das Kopplungs-Gate prüft sie.

### Die Regeln des Wächters

Der Wächtertest `test/checks-leichtigkeit.test.mjs` prüft jede Testdatei, ohne Ausnahmeliste. Er läuft als eigene Prüfung mit dem Bereich `testdateien` und damit bei jeder neuen oder geänderten Datei unter `test/` mit, nicht erst im vollen Umfang (Issue #1374):

1. **Ablauf-Prüfung kennzeichnen:** Wer einen Kindprozess aus `kit/` oder `tools/` startet — direkt oder über eine Importkette durch `test/helpers/` —, trägt die Zeile `// Ablauf-Pruefung:` mit Grund.
2. **Keine Pausen:** keine feste Wartezeit (`await setTimeout(…)`, `pause(ms)` ohne Bedingung). Ein begrenztes Warten auf eine Bedingung (`warteAuf(pruefung, ms)`) ist nur in einer gekennzeichneten Ablauf-Prüfung erlaubt und scheitert bei Fristablauf mit Befund.
3. **Gekennzeichnete Hänger:** `sleep <n>` in einer Attrappe nur, wenn dieselbe Zeile `# haengt` trägt — als Prozess, den der Test abbricht und auf den er nicht wartet.
4. **Import aus dem Teil:** Ein Test, der keine Ablauf-Prüfung ist, importiert aus dem Teil (`../kit/night/kette.mjs`), nicht aus dem Einstieg. Ein Import über den Einstieg koppelte ihn an alle Teile.

Die Regeln gelten für das Kit selbst. Ein Projekt entscheidet selbst, wie leicht seine Prüfungen werden; das Muster lässt sich übernehmen.

## Zuordnungshilfe: breit zugeordnete Kommandos

Eine schwere Suite fällt oft daran auf, dass ein Prüfkommando jedem Bereich zugeordnet ist und darum bei jeder Änderung läuft. Das Kit meldet das:

- Ein bereichsgebundenes Kommando der Paketstufe gilt als **breit**, wenn seine `areas` alle oder alle bis auf einen der Bereiche nennen und es mindestens drei bereichsgebundene Kommandos gibt.
- `checks.mjs plan` und `checks.mjs run` schreiben dann in den Block `Fuer den Abschlussbericht:` die Zeile

  ```
  hinweis: <cmd> ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs bereiche)
  ```

- Der Hinweis hält nichts an. Er ist eine Einladung, das Kommando aufzuteilen oder seine `areas` zu verengen. `node .claude/kit/checks.mjs bereiche` zeigt dafür die Auswertung je Bereich und je Kommando.

### `gekoppelteBereiche`

Manchmal ist die Breite gewollt — etwa weil eine Datei, die fast jede Testgruppe lädt, die Kopplung erzwingt. Dann trägt die Config den Bereich mit Grund ein:

```json
"gekoppelteBereiche": [
  { "bereich": "grundlagen", "grund": "jede Testgruppe laedt die gemeinsame Fixture" }
]
```

Ein Eintrag ändert am Urteil nichts; er unterdrückt nur die Hinweiszeile für Kommandos, die den Bereich nennen, und `checks.mjs bereiche` vermerkt „durch Kopplung erzwungen: …“. Ohne Grund kein Eintrag. Der Schlüssel gilt teamweit; ein Wert in `workflow.config.local.json` wird ignoriert.

## Kurz: So ordnet ein Projekt seine Suite zu

1. Bereiche in `checkAreas` anlegen, je Teil des Codes einer.
2. Die Suite in Prüfkommandos aufteilen und jedem in `areas` nur seine Bereiche geben.
3. In JavaScript-Projekten: Abhängigkeiten nicht von Hand pflegen — der Importgraph liefert sie. Nur nicht literale Importe von Hand in die `areas`.
4. In anderen Projekten: über die Muster in `checkAreas` zuordnen.
5. Den Bericht lesen: Jede `hinweis:`-Zeile zu einem breiten Kommando ist ein Kandidat zum Zuschneiden — oder ein Eintrag in `gekoppelteBereiche` mit Grund.
