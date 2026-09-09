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

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Ziel-Branch (Default: `main`)
- `buildChecks`: Liste der Pflicht-Checks (dieselben, die `/local-check` ausführt)
- `spec`: optionaler Block für das beschriebene Verhalten unter `specs/`. Allein sein
  **Vorhandensein** schaltet Schritt 3 (Spec-Fortschreibung) und das Gate in Schritt 4
  frei. Fehlt er, gibt es beides nicht.

### 2. Stand prüfen

```bash
git status
git log origin/main..HEAD --oneline
```

Zeige welche Commits gepusht werden. Der Mensch soll wissen, was fährt.

### 3. Spec-Fortschreibung und wartende Vorhaben-Notizen (nur bei gesetztem `spec`-Block)

Nur wenn `.claude/workflow.config.json` einen `spec`-Block führt. Der Schritt läuft
**vor** den Pflicht-Checks: `apply` schreibt Dateien, die in denselben Push gehen — sie
müssen von den Checks und vom Gate mitgemessen werden.

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
`checks.mjs run` läuft: Blieb ein Lauf davor rot stehen, sind die `apply`-Dateien noch
gestaged, und ein Commit „nur bei tatsächlichem staged Diff" nähme sie beim nächsten
`push main` mit, ohne dass ein Vorschau-Teil sie gezeigt hätte.

**2. Zustimmung einholen.** Frage den Menschen **einmal**, ob das Gezeigte so geschrieben
und committet werden soll. Die Zustimmung deckt **alles Gezeigte** ab — Fortschreibung,
wartende Notizen und was unter `specs/` schon gestaged war; eine zweite Rückfrage gibt es
nicht. **Ohne Zustimmung wird nicht gepusht** — der Ablauf hält an: kein `apply`, kein
Aufheben, keine Pflicht-Checks, kein Push. Erst wenn der Mensch erneut `push main`
tippt, startet er von vorn. Das ist keine Formalie: `apply` ändert Dateien, die das
Projekt dauerhaft führt, und dies ist der einzige Punkt, an dem ein Mensch die
Fortschreibung seiner Beschreibung sieht, bevor sie geschrieben wird.

**3. Schreiben und committen.**

```bash
node .claude/kit/spec.mjs apply --anker "$(git merge-base HEAD origin/<mainBranch>)"
node .claude/kit/spec.mjs vorhaben-sichern
git add specs/vorhaben/ <jede Datei, die `apply` in diesem Lauf als `geschrieben` gemeldet hat>
node .claude/kit/checks.mjs run
git commit -m "chore: Spec fortgeschrieben (<Paketnummern>)"
```

Der Betreff im Block ist der Regelfall; wandern nur Notizen oder ein Rest aus einem roten
Lauf, gilt die Betreff-Regel weiter unten.

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

**Warum hier geprüft wird, obwohl Schritt 4 gleich noch einmal prüft:** Der Nachweis
gehört zum **Commit**, Schritt 4 gehört zum **Push**. `apply` hat gerade Dateien unter
`specs/` geschrieben, die der Lauf aus `/local-check` nicht gesehen haben kann — und
ohne Nachweis für genau diesen Stand weist das Commit-Gate den Commit ab. Der Aufruf
läuft **ohne `--since`**: Gemessen wird der uncommittete Stand, der gleich in den
Commit geht, nicht der Batch seit `merge-base` wie zwei Zeilen darüber bei `apply`.
Schritt 4 bleibt daneben unverändert bestehen — er ist kein Duplikat, sondern das Gate
vor dem Push.

Ein **roter** Lauf hält hier an: kein Spec-Commit, kein Push.

**Leere Vorschau.** Schritt 3 entfällt nur, wenn **alle drei** zutreffen: die
`apply`-Vorschau ist leer (alle Wirkungen `KEINE` oder nur Pakete vor `seit`),
es **wartet keine Notiz** — `vorhaben-sichern --dry-run` meldet eine leere Liste —,
und `git status --porcelain -- specs/vorhaben/` ist leer. Dann entfallen
Zustimmung und Commit. Melde „Keine Spec-Fortschreibung in diesem Batch" und gehe direkt
zu Schritt 4. Mit dem Commit entfällt auch sein Prüflauf — es gibt nichts, wofür ein
Nachweis nötig wäre. Das Spec-Gate läuft dort trotzdem — es prüft den Batch, nicht die
Fortschreibung. Das ist der Regelfall.

**Fehlerpfade.** Endet `apply` (auch mit `--dry-run`) mit einem Exitcode ungleich 0,
liefert die `merge-base`-Substitution einen **leeren** Anker, oder endet der
`checks.mjs run` vor dem Commit **rot**, hält der Ablauf an: kein Commit, keine
Pflicht-Checks, kein Push. Meldung mit dem Grund. Ein roter
`apply`-Lauf ist kein Randfall, den man übergeht — er heißt, dass Paket und Beschreibung
nicht zusammenpassen.

**Exitcode 1 oder 2 aus `vorhaben-sichern` hält den Ablauf dagegen nicht an.** Was liegen
blieb, wird benannt; die Notiz bleibt an ihrem wartenden Ort, und der nächste `push main`
holt das Aufheben nach. Eine Notiz ist ein Nachweis über einen Plan, kein Teil des Codes,
der hinausgeht — den ganzen Push daran scheitern zu lassen hieße, eine Nebensache über
den Batch zu stellen. Ein roter `checks.mjs run` hält weiterhin alles an, Commit wie
Push.

### 4. Pflicht-Checks (Gate — vor Bump und Push)

Führe **alle** Kommandos aus `buildChecks` sequenziell aus, bevor irgendetwas
gebumpt oder gepusht wird. Das ist eine Leitplanke, die scheitert, kein Prompt,
der bittet: Auch wenn `/implement-ready` oder `/local-check` die Checks pro
Issue bereits liefen, sichert dieser Lauf gegen zwischenzeitliche Änderungen
und maskierte Exit-Codes ab. Der Trade-off (langsamerer Push durch erneute
Checks) ist bei einem seltenen main-Push akzeptabel und gewollt.

- **Im Vordergrund ausführen** und die Exit-Codes ehrlich auswerten — niemals
  den Exit-Code durch ein nachgestelltes `echo` oder eine Umleitung maskieren
  (siehe die Exit-Code-Guidance im `local-check`-Skill). Zusätzlich generisch
  auf `[ERROR]` bzw. `BUILD FAILURE` im Output prüfen, nicht nur auf enge
  tool-spezifische Stichworte.
- **Ein roter Check bricht ab:** nicht pushen, nicht bumpen, keine
  Release-Schritte. Klare Meldung, **welcher** Check mit welchem Fehler
  fehlschlug. Erst wenn der Fehler behoben ist und der Mensch erneut
  `push main` tippt, startet der Ablauf von vorn.
- Ist `buildChecks` leer: Hinweis ausgeben "Keine buildChecks konfiguriert."
  und weiter zum Spec-Gate (kein Abbruch).

**Spec-Gate (nur bei gesetztem `spec`-Block).** Nach den `buildChecks`, auf dem Batch,
wie er gepusht wird — also einschließlich des Commits aus Schritt 3:

```bash
node .claude/kit/spec.mjs check --anker "$(git merge-base HEAD origin/<mainBranch>)"
```

Exitcode 1 hält den Push auf, wie jeder rote Pflicht-Check. Das Gate ist ein **eigener
Aufruf und kein `buildChecks`-Eintrag**: `buildChecks` ist teamweit konfiguriert, und ein
Projekt ohne `spec`-Block dürfte den Eintrag nicht haben — das wäre eine zweite Stelle,
an der dieselbe Entscheidung steht.

### 5. Release-Schritte (falls `RELEASING.md` existiert)

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Push-Trigger (`push main`) beschriebenen
  Release-Schritte aus — typischerweise ein Version-Bump. Nimm alle dabei
  geänderten Dateien in **denselben** Push-Batch auf (mit committen), bevor du
  pushst.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 6.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik;
diese lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos. Die
Release-Schritte berühren `specs/` nicht — die Fortschreibung ist mit Schritt 3
abgeschlossen und vom Gate gemessen.

### 6. Pushen

```bash
git push origin <mainBranch>
```

### 7. Bestätigung

Melde den neuen Stand auf `origin/<mainBranch>` mit dem letzten Commit-Hash.

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Ohne `spec`-Block

Projekte **ohne** `spec`-Block in `.claude/workflow.config.json` sehen Schritt 3 und das
Spec-Gate nicht: Es gibt keine Vorschau, keine Zustimmung, keinen `apply`-Commit und
keinen `check`-Aufruf. **Auch keine wartende Vorhaben-Notiz wird dort gelesen oder
aufgehoben.** Eine kann trotzdem liegen — etwa weil der Block nachträglich entfernt
wurde; sie wird nur nicht abgeholt. `/push-main` läuft dort unverändert wie bisher —
Stand prüfen, Pflicht-Checks, Release-Schritte, Push.

## Was dieser Skill nicht tut

- Kein Push und kein Version-Bump bei einem roten Pflicht-Check (Schritt 4)
- Kein Push ohne Zustimmung zur Spec-Fortschreibung (bei gesetztem `spec`-Block)
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
