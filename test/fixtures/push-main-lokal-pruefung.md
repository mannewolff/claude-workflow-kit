### 5. Der eine Prüflauf (Gate — vor Commit und Push)

> `Schritt 5 von 9 — Prueflauf (laeuft)`

Jetzt liegen alle Dateien des Wegs auf der Platte: die Release-Dateien aus Schritt 4 — **im
Worktree**, und dort misst der Lauf sie. Genau diesen Stand misst **ein** Lauf:

Der Lauf misst mit `--in` im Worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <pfad> --stufe push --since "$(git -C <pfad> merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`).

**Dieser Skill fährt die Push-Stufe, und die fährt den vollen Umfang.** Es laufen
zusätzlich zu den Prüfungen der Paketstufe alle, die ihr Projekt für den Zeitpunkt des
Veröffentlichens vorgesehen hat — und zwar **jede von ihnen**, auch bei unberührten
Bereichen und auch dann, wenn seit dem Anker nichts geändert wurde. Vor dem Push wird der
Stand gemessen, der hinausgeht, und der besteht aus mehr als dem letzten Arbeitspaket. Der
Lauf nennt die **zusätzlichen Prüfungen vorab** in einer eigenen Zeile (`Stufe push:
zusaetzlich zur Paketstufe laeuft …`) — er wird darum spürbar **länger dauern** als der
Lauf je Arbeitspaket in `/implement-next`. Das ist der vorgesehene Zeitpunkt und kein
Grund, ihn abzukürzen.

**Der Anker ist der Batch, nicht `HEAD`.** Er entscheidet nicht mehr, **was** läuft — an
dieser Stufe läuft ohnehin alles —, sondern welchen Stand die Zusammenfassung **bezeugt**:
`basis`, `geaendert` und die Blob-Hashes, gegen die das Commit-Gate den Index prüft. Ohne
`--since` nimmt `planen` in `kit/checks.mjs` `HEAD` als Basis, und der Nachweis spräche
dann über das letzte Stück statt über den Batch, der gleich hinausgeht.

- **Im Vordergrund ausführen** und die Exit-Codes ehrlich auswerten — niemals den
  Exit-Code durch ein nachgestelltes `echo` oder eine Umleitung maskieren. Den
  Rückgabewert jedes Prüfkommandos und die allgemeinen Fehlermerkmale in seiner
  Ausgabe liest `checks.mjs run` selbst; ein Treffer färbt die Prüfung rot.
- **Ein roter Lauf hält alles an:** kein Commit, kein Push. Klare Meldung, **welcher**
  Check mit welchem Fehler fehlschlug. Der Lauf nennt dazu je roter Prüfung die
  **Verursacher-Karten** in einer eigenen Zeile (`Verursacher (<cmd>): …`) — die Karten,
  deren Commits seit dem Anker die Dateien dieser Prüfung berührt haben. Übernimm die
  Zeilen unverändert in den Bericht. Die Reparatur ist eine **neue Karte**: Die
  verursachende Karte wandert **nicht aus „In review" zurück** — sie ist abgeschlossen
  und wartet auf den Test des Menschen, und ein Rückzug verlöre genau diesen Stand.
  Genannt wird sie, damit die neue Karte weiß, wo sie ansetzt. Der Worktree wird trotzdem **abgebaut** (Schritt 8),
  und der Bericht sagt das: Der Bump ist seit Issue #656 idempotent, ein neuer Anlauf
  erzeugt ihn wieder — ein stehengebliebener Worktree wäre genau der Rest, den dieser Weg
  beseitigt.
- **Hinweise werden gezeigt, nicht gewertet.** Eine Hinweis-Prüfung endet grün und
  schreibt ihre Funde als `hinweis: <Datei und Grund>` in den Block `Fuer den
  Abschlussbericht:`. Die `hinweis:`-Zeilen gehen unverändert in den Bericht an den
  Menschen und halten weder Commit noch Push an — sie verlangen keine Freigabe
  (Issue #1156).
- Ist `buildChecks` leer: Hinweis „Keine buildChecks konfiguriert." und weiter zu
  Schritt 6 (kein Abbruch).

Warum überhaupt noch ein Lauf, wenn `/implement-ready` und `/local-check` je Issue schon
prüften: Der Nachweis gehört zum **Commit**, und die Dateien aus Schritt 4 hat kein
früherer Lauf gesehen. Ohne Nachweis für genau diesen Stand weist das Commit-Gate den
Commit ab.

**Befunde buchen, wenn Code-Review-Befunde eingearbeitet wurden.** Sind vor diesem Push
Funde aus einem `/review` eingearbeitet worden, hält die Session das in einem
Einarbeitungs-Kommentar am Issue fest — übernommen / abgelehnt mit Grund je Fund, im Muster
von `/issue-review` —, ergänzt den Befunde-Text je Fundblock um die Zeile
`Uebernahme: uebernommen` beziehungsweise `Uebernahme: abgelehnt` und schreibt ihn nach der
Transportregel als eigene Datei außerhalb des Projektverzeichnisses:

```bash
node .claude/kit/worktree.mjs im <pfad> -- node .claude/kit/befunde.mjs buchen --datei <tmpdir>/<id>-buchung.md --stufe code --karte <id>
```

**Gebucht wird im Worktree**, weil der Vergleichsstand die Zusammenfassung des Prüflaufs
liest — und die liegt dort. Die Buchung kommt in Schritt 8 in die Hauptkopie zurück, und
**erst dort** entsteht je Art ein Vorschlag: Die Schwelle zählt den Gesamtstand des
Projekts, und der steht in der Hauptkopie.

**Hier und nicht früher.** Der Vergleichsstand der Code-Stufe fragt, ob jede heute geänderte
Datei von `.claude/checks-summary.json` gedeckt ist. Vor Schritt 5 trüge die Zusammenfassung
den Stand **vor** der Einarbeitung, und jede dabei geänderte Datei machte den Stand
`nicht-vergleichbar`, obwohl die Pflichtprüfungen gleich darauf grün laufen. Nach dem
Prüflauf liegt eine Zusammenfassung über genau den Stand vor, auf dem gebucht wird.

Liegen keine Code-Review-Befunde vor, entfällt dieser Block **ohne Vermerk**. **Kein Gate:**
Ein Fehlschlag von `buchen` oder `vorschlag` wird in **einer Zeile** vermerkt und hält
Commit und Push nicht auf. Wie der Befund-Block vor Schritt 1 trägt dieser Block **keine
Nummer** und zählt in keiner Fortschrittszeile mit.

