---
name: push-main
description: Schritt 8 des 9-Schritt-Prozesses — pusht den aktuellen Commit-Batch auf main. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "push main" tippt.
user-invocable: true
disable-model-invocation: true
---

# Push Main

Schritt 8 des 9-Schritt-Prozesses: Den aktuellen Commit-Batch auf `origin/main` pushen.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `push main` (oder die in `.claude/workflow.config.json` unter `triggers.push` konfigurierte Phrase).

Eine frühere Push-Freigabe in derselben Session gilt **nicht** für neue Commits. Jeder Push braucht eine neue explizite Freigabe.

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin push main getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gepusht. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

## Ablauf

**Fortschritt melden.** Jeder Schritt beginnt mit einer Zeile `Schritt k von n — <Name> (laeuft)`.
Das `n` ist die Zahl der Schritte, die dieser Lauf tatsächlich fährt — ohne `spec`-Block
oder ohne `RELEASING.md` sind es weniger, und dann zählt die Zeile auch weniger. Der Grund
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand dauert so lange wie der volle
`buildChecks`-Katalog, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

**Aufwand melden.** Noch vor dem ersten Schritt:

```bash
node .claude/kit/aufwand.mjs befund
```

Zeige die Ausgabe **unverändert**. Sie ist bereits die Form, in der der Aufwands-Befund an
beiden Ausgabestellen erscheint — hier und als Abschlussblock im Laufprotokoll eines
unbeaufsichtigten Laufs. Hier steht sie, weil das Veröffentlichen der eine Schritt bleibt,
den ein Mensch auslöst: Läuft nachts niemand mit, liest sonst womöglich niemand mehr, was
der Prozess gekostet hat.

Eine **leere Ausgabe** heißt: kein Befund. Sie wird nicht kommentiert — kein „alles
unauffällig", keine leere Überschrift. Ein **Fehlschlag** des Kommandos wird in **einer
Zeile** vermerkt, und er hält nichts auf. Der Befund braucht die Config nicht; er
liest allein `.claude/aufwand.json`, die der letzte unbeaufsichtigte Lauf hinterlassen hat.
Fehlt sie, ist die Ausgabe leer und der Exit-Code 0.

Dieser Block trägt bewusst **keine Nummer** und zählt in keiner Fortschrittszeile mit: Eine
Nummer verschöbe jede folgende Schrittzahl um eins und machte sämtliche Querverweise auf
„Schritt 3" und „Schritt 5" falsch. Die Fortschrittszeilen der neun — ohne `spec`-Block
sieben — Schritte bleiben davon unberührt.

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Ziel-Branch (Default: `main`)
- `buildChecks`: Liste der Pflicht-Checks (dieselben, die `/local-check` ausführt)
- `spec`: optionaler Block für Spec-Driven Development mit der Spezifikation unter `specs/`. Allein sein
  **Vorhandensein** schaltet Schritt 3 (Spec-Fortschreibung) und das Spec-Gate in
  Schritt 7 frei. Fehlt er, gibt es beides nicht.

### 2. Stand prüfen

```bash
git status
git log origin/main..HEAD --oneline
```

Zeige welche Commits gepusht werden. Der Mensch soll wissen, was fährt.

### 3. Spec-Fortschreibung und wartende Vorhaben-Notizen vorbereiten (nur bei gesetztem `spec`-Block)

> `Schritt 3 von 9 — Spec-Fortschreibung und wartende Notizen vorbereiten (laeuft)`

Nur wenn `.claude/workflow.config.json` einen `spec`-Block führt. Der Schritt **erzeugt
und staged nur** — geprüft wird in Schritt 5, festgeschrieben in Schritt 6. `apply`
schreibt Dateien, die in denselben Push gehen; sie müssen vom Lauf und vom Gate
mitgemessen werden.

Zwei Dinge kommen hier zusammen. Die Fortschreibung der Beschreibung ist das eine; das
andere sind die **wartenden Vorhaben-Notizen**, die `/techplan` als
`.claude/vorhaben-wartend-<k>.md` ablegt. Sie warten dort, bis dieser Schritt sie nach
`specs/vorhaben/` aufhebt — das ist der einzige Ort, an dem sie ins Repository kommen.

**1. Vorschau zeigen — vier Teile.**

```bash
node .claude/kit/spec.mjs apply --anker "$(git merge-base HEAD origin/<mainBranch>)" --dry-run
node .claude/kit/spec.mjs vorhaben-sichern --dry-run
git status --porcelain -- specs/vorhaben/
git diff --cached --name-only -- specs/
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`). Der Anker ist derselbe wie
in `/local-check` (Issue #427): der letzte gepushte Stand, also genau der Batch, der
gleich hinausgeht — nicht der Working-Tree-Diff. Zeige den Diff ungekürzt und nenne die
Notizen, die aufgehoben würden.

**Teil 3 ist nötig**, weil `apply --dry-run` gegen den Stand auf der Platte rechnet: Hat
ein früherer Lauf den Spec-Stand schon geschrieben und ist danach etwas dazwischen
gekommen, meldet die Vorschau „keine Änderung", obwohl unter `specs/vorhaben/` etwas
liegt, das noch nirgends committet ist. **Teil 4 ist nötig**, weil `git add` unten **vor**
dem Prüflauf aus Schritt 5 läuft: Blieb ein früherer Durchgang dort rot stehen, sind die
`apply`-Dateien noch gestaged, und ein Commit „nur bei tatsächlichem staged Diff" nähme
sie beim nächsten `push main` mit, ohne dass ein Vorschau-Teil sie gezeigt hätte.

**2. Zustimmung einholen.** Frage den Menschen **einmal**, ob das Gezeigte so geschrieben
und committet werden soll. Die Zustimmung deckt **alles Gezeigte** ab — Fortschreibung,
wartende Notizen und was unter `specs/` schon gestaged war; eine zweite Rückfrage gibt es
nicht. **Ohne Zustimmung wird nicht gepusht** — der Ablauf hält an: kein `apply`, kein
Aufheben, kein Prüflauf, kein Push. Erst wenn der Mensch erneut `push main`
tippt, startet er von vorn. Das ist keine Formalie: `apply` ändert Dateien, die das
Projekt dauerhaft führt, und dies ist der einzige Punkt, an dem ein Mensch die
Fortschreibung seiner Beschreibung sieht, bevor sie geschrieben wird.

**3. Schreiben und stagen.**

```bash
node .claude/kit/spec.mjs apply --anker "$(git merge-base HEAD origin/<mainBranch>)"
node .claude/kit/spec.mjs vorhaben-sichern
git add specs/vorhaben/ <jede Datei, die `apply` in diesem Lauf als `geschrieben` gemeldet hat>
```

**Hier wird nicht committet.** Was hier entsteht, geht zusammen mit den Release-Dateien
aus Schritt 4 in den einen Commit aus Schritt 6 — gedeckt von dem einen Lauf aus
Schritt 5. Die Betreff-Regel unten gilt für diesen Commit, wenn Schritt 4 nichts erzeugt
hat.

**Nur diese Mengen bilden den Commit:** `specs/vorhaben/`, die Dateien aus dem
`apply`-Lauf **dieses** Durchgangs, und was unter `specs/` schon gestaged war — das
bleibt gestaged und geht mit, es stand in Vorschau-Teil 4. Alles andere unter `specs/`
wird benannt und **bleibt liegen**. Gestaged ist nur, was der Prozess selbst oder ein
Mensch bewusst gestaged hat; eine handgeführte Änderung an einer Bereichsdatei darf
keinen Commit auslösen, den niemand angefordert hat. Committet wird nur bei
tatsächlichem staged Diff — sonst gibt es nichts festzuschreiben.

**Commit-Betreff.** Wurde die Beschreibung fortgeschrieben:
`chore: Spec fortgeschrieben (<Paketnummern>)`. Wandern nur Notizen:
`chore: Vorhaben-Notizen gesichert`. Geht es allein um einen Rest aus einem roten Lauf:
`chore: Spec-Rest aus rotem Lauf committet`. Bei mehreren Anlässen werden die Betreffe in
dieser Reihenfolge mit `; ` verkettet, die Paketnummern stehen einmal am Ende — etwa
`chore: Spec fortgeschrieben; Vorhaben-Notizen gesichert (<Paketnummern>)` oder
`chore: Vorhaben-Notizen gesichert; Spec-Rest aus rotem Lauf committet`.

**Nie ein Suffix `(Issue #N)` am Betreffende.** Daran und nur daran lesen `spec.mjs` und
`tools/changelog.mjs` die Paketnummer, und dieser Commit ist kein Arbeitspaket. Er
erscheint weiterhin im Changelog, dann ohne Paketreferenz; das ist gewollt. Aus demselben
Grund stehen in der Botschaft **keine** `#N`-Referenzen auf Nicht-Pakete.

**Warum hier kein eigener Lauf mehr steht:** Bis v1.53 prüfte dieser Schritt selbst, weil
er selbst committete — und das Commit-Gate verlangt für jeden Commit einen Nachweis auf
genau diesem Stand. Mit dem einen Commit fällt der Grund weg: Der Lauf aus Schritt 5 sieht
die `apply`-Dateien und die Release-Dateien gemeinsam und deckt beide.

**Leere Vorschau.** Schritt 3 entfällt nur, wenn **alle drei** zutreffen: die
`apply`-Vorschau ist leer (alle Wirkungen `KEINE` oder nur Pakete vor `seit`),
es **wartet keine Notiz** — `vorhaben-sichern --dry-run` meldet eine leere Liste —,
und `git status --porcelain -- specs/vorhaben/` ist leer. Dann entfallen Zustimmung und
`apply`. Melde „Keine Spec-Fortschreibung in diesem Batch" und gehe direkt zu Schritt 4.
Der eine Lauf und das Spec-Gate laufen trotzdem — sie prüfen den Batch, nicht die
Fortschreibung. Das ist der Regelfall.

**Fehlerpfade.** Endet `apply` (auch mit `--dry-run`) mit einem Exitcode ungleich 0 oder
liefert die `merge-base`-Substitution einen **leeren** Anker, hält der Ablauf an: kein
Lauf, kein Commit, kein Push. Meldung mit dem Grund. Ein roter
`apply`-Lauf ist kein Randfall, den man übergeht — er heißt, dass Paket und Beschreibung
nicht zusammenpassen.

**Exitcode 1 oder 2 aus `vorhaben-sichern` hält den Ablauf dagegen nicht an.** Was liegen
blieb, wird benannt; die Notiz bleibt an ihrem wartenden Ort, und der nächste `push main`
holt das Aufheben nach. Eine Notiz ist ein Nachweis über einen Plan, kein Teil des Codes,
der hinausgeht — den ganzen Push daran scheitern zu lassen hieße, eine Nebensache über
den Batch zu stellen. Ein roter Lauf in Schritt 5 hält weiterhin alles an, Commit wie
Push.

### 4. Release-Dateien erzeugen (falls `RELEASING.md` existiert)

> `Schritt 4 von 9 — Release-Dateien erzeugen (laeuft)`

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Push-Trigger (`push main`) beschriebenen Schritte aus —
  **bis zum ersten festschreibenden Schritt**, also typischerweise Bump, Stempel und
  Changelog. Nicht committen, nicht pushen: Das kommt aus Schritt 5 und 6.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 5.

**Fremde `RELEASING.md`.** Die Grenze ist der erste Schritt, der festschreibt oder
veröffentlicht (`git commit`, `git push`, `git tag`, ein Release-Kommando). Alles davor
fährt der Skill; ab dort übernimmt er mit Lauf, Commit und Push. Stehen **hinter** dem
ersten festschreibenden Schritt noch weitere Schritte, führt der Skill sie nach seinem
Commit aus und sagt das im Abschlussbericht.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik; diese lebt
ausschließlich in der `RELEASING.md` des jeweiligen Repos.

### 5. Der eine Prüflauf (Gate — vor Commit und Push)

> `Schritt 5 von 9 — Prueflauf (laeuft)`

Jetzt liegen alle Dateien des Wegs auf der Platte: der Spec-Ertrag aus Schritt 3 und die
Release-Dateien aus Schritt 4. Genau diesen Stand misst **ein** Lauf:

```bash
node .claude/kit/checks.mjs run --stufe push --since "$(git merge-base HEAD origin/<mainBranch>)"
```

**Dieser Skill fährt die Push-Stufe.** Damit laufen zusätzlich zu den Prüfungen der
Paketstufe alle, die ihr Projekt für den Zeitpunkt des Veröffentlichens vorgesehen hat.
Der Lauf nennt die **zusätzlichen Prüfungen vorab** in einer eigenen Zeile (`Stufe push:
zusaetzlich zur Paketstufe laeuft …`) — er kann darum spürbar **länger dauern** als der
Lauf je Arbeitspaket in `/implement-next`. Das ist der vorgesehene Zeitpunkt und kein
Grund, ihn abzukürzen.

**Der Anker ist der Batch, nicht `HEAD`.** Ohne `--since` nimmt `planen` in
`kit/checks.mjs` `HEAD` als Basis; ist seit `HEAD` nichts geändert, meldet es
`leeresPaket` und lässt **jede** Prüfung mit Exit 0 aus. Ein Projekt ohne `RELEASING.md`
und ohne Spec-Ertrag liefe damit vor dem Push durch eine leere Prüfung.

- **Im Vordergrund ausführen** und die Exit-Codes ehrlich auswerten — niemals den
  Exit-Code durch ein nachgestelltes `echo` oder eine Umleitung maskieren (siehe die
  Exit-Code-Guidance im `local-check`-Skill). Zusätzlich generisch auf `[ERROR]` bzw.
  `BUILD FAILURE` im Output prüfen.
- **Ein roter Lauf hält alles an:** kein Commit, kein Push. Klare Meldung, **welcher**
  Check mit welchem Fehler fehlschlug. Der Bump aus Schritt 4 bleibt dabei stehen; er ist
  seit Issue #656 idempotent und steigt beim nächsten Anlauf nicht erneut.
- Ist `buildChecks` leer: Hinweis „Keine buildChecks konfiguriert." und weiter zu
  Schritt 6 (kein Abbruch).

Warum überhaupt noch ein Lauf, wenn `/implement-ready` und `/local-check` je Issue schon
prüften: Der Nachweis gehört zum **Commit**, und die Dateien aus Schritt 3 und 4 hat kein
früherer Lauf gesehen. Ohne Nachweis für genau diesen Stand weist das Commit-Gate den
Commit ab.

### 6. Der eine Commit

> `Schritt 6 von 9 — Commit (laeuft)`

```bash
git add <die Dateien aus Schritt 4>
git commit -m "<Betreff nach der Regel unten>"
```

**Betreff.** Hat Schritt 4 Release-Dateien erzeugt: `chore: vX.Y.Z` mit der Kennung aus
dem Bump. Sonst gilt die Betreff-Regel aus Schritt 3 (`chore: Spec fortgeschrieben (…)`,
`chore: Vorhaben-Notizen gesichert`, `chore: Spec-Rest aus rotem Lauf committet`, bei
mehreren Anlässen mit `; ` verkettet). **Nie ein Suffix `(Issue #N)`** — die Begründung
steht in Schritt 3.

Committet wird nur bei tatsächlichem staged Diff. Ist weder aus Schritt 3 noch aus
Schritt 4 etwas entstanden, gibt es nichts festzuschreiben; der Ablauf geht ohne Commit
weiter zu Schritt 7, und der Push fährt allein die Commits aus Schritt 2.

### 7. Spec-Gate (nur bei gesetztem `spec`-Block)

> `Schritt 7 von 9 — Spec-Gate (laeuft)`

Auf dem Batch, wie er gepusht wird — also einschließlich des Commits aus Schritt 6:

```bash
node .claude/kit/spec.mjs check --anker "$(git merge-base HEAD origin/<mainBranch>)"
```

Exitcode 1 hält den Push auf. **Der Commit aus Schritt 6 bleibt dann lokal stehen** — das
gehört ausdrücklich in die Meldung, sonst sucht man ihn beim nächsten Anlauf.

Das Gate ist ein **eigener Aufruf und kein `buildChecks`-Eintrag**: `buildChecks` ist
teamweit konfiguriert, und ein Projekt ohne `spec`-Block dürfte den Eintrag nicht haben —
das wäre eine zweite Stelle, an der dieselbe Entscheidung steht.

### 8. Pushen

> `Schritt 8 von 9 — Push (laeuft)`

```bash
git push origin <mainBranch>
```

### 9. Bestätigung

Melde den neuen Stand auf `origin/<mainBranch>` mit dem letzten Commit-Hash.

**Die Nachweiszeile, je erzeugtem Commit.** Nenne den Hash, das Ergebnis des deckenden
Laufs und dessen `zeitpunkt` aus der Prüf-Zusammenfassung (`.claude/checks-summary.json`,
Issue #655):

```
<hash> — gedeckt von: node --test, node tools/sync-blobs.mjs --check (gruen, 2026-09-16 08:14)
```

Der Zeitpunkt ist der Punkt: Er sagt, ob der Nachweis zu diesem Stand gehört oder von
einem früheren Lauf stammt. Hat Schritt 6 keinen Commit erzeugt, gehört auch **das** in
den Bericht — ein Lauf ohne Commit sieht sonst aus wie ein Lauf mit Commit.

**CI-Hinweis, abhängig vom `codeHost`.** Bei `github` und `gitlab` gehört in den Abschlussbericht: „Falls der Push einen CI-Lauf auslöst, wird er hier nicht gegatet; `merge production` prüft den Commit." Bei `local` entfällt der Hinweis ersatzlos. Der Zustand der CI wird hier **nicht abgefragt** — der Lauf zum eben gepushten Commit ist Sekunden später nie fertig, ein Gate müsste warten, und `push main` ist der häufige Trigger. Geprüft wird die CI am Release, in `/merge-production` (Issue #316).

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Ohne `spec`-Block

Projekte **ohne** `spec`-Block in `.claude/workflow.config.json` sehen Schritt 3 und das
Spec-Gate nicht: Es gibt keine Vorschau, keine Zustimmung, keinen `apply`-Commit und
keinen `check`-Aufruf. **Auch keine wartende Vorhaben-Notiz wird dort gelesen oder
aufgehoben.** Eine kann trotzdem liegen — etwa weil der Block nachträglich entfernt
wurde; sie wird nur nicht abgeholt. `/push-main` läuft dort verkürzt: Stand prüfen,
Release-Dateien erzeugen, der eine Prüflauf, der eine Commit, Push, Bestätigung. Die
Fortschrittszeile zählt dann entsprechend weniger Schritte — `Schritt k von 7`.

## Was dieser Skill nicht tut

- Kein Commit und kein Push bei einem roten Prüflauf (Schritt 5)
- Kein Push bei rotem Spec-Gate (Schritt 7) — der Commit bleibt dann lokal stehen
- Kein Push ohne Zustimmung zur Spec-Fortschreibung (bei gesetztem `spec`-Block)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
- Kein Halt wegen des Aufwands-Befunds: Er ist **kein Gate**, weder sein Inhalt noch sein
  Fehlschlag hält das Veröffentlichen auf. Er sagt, was auffällt — was daraus folgt,
  entscheidet der Mensch.
