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

### 3. Spec-Fortschreibung (nur bei gesetztem `spec`-Block)

Nur wenn `.claude/workflow.config.json` einen `spec`-Block führt. Der Schritt läuft
**vor** den Pflicht-Checks: `apply` schreibt Dateien, die in denselben Push gehen — sie
müssen von den Checks und vom Gate mitgemessen werden.

**1. Vorschau zeigen.**

```bash
node .claude/kit/spec.mjs apply --anker "$(git merge-base HEAD origin/<mainBranch>)" --dry-run
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`). Der Anker ist derselbe wie
in `/local-check` (Issue #427): der letzte gepushte Stand, also genau der Batch, der
gleich hinausgeht — nicht der Working-Tree-Diff. Zeige den Diff ungekürzt.

**2. Zustimmung einholen.** Frage den Menschen, ob die gezeigte Fortschreibung so
geschrieben werden soll. **Ohne Zustimmung wird nicht gepusht** — der Ablauf hält an:
kein `apply`, keine Pflicht-Checks, kein Push. Erst wenn der Mensch erneut `push main`
tippt, startet er von vorn. Das ist keine Formalie: `apply` ändert Dateien, die das
Projekt dauerhaft führt, und dies ist der einzige Punkt, an dem ein Mensch die
Fortschreibung seiner Beschreibung sieht, bevor sie geschrieben wird.

**3. Schreiben und committen.**

```bash
node .claude/kit/spec.mjs apply --anker "$(git merge-base HEAD origin/<mainBranch>)"
git add specs/
git commit -m "chore: Spec fortgeschrieben (<Paketnummern>)"
```

In den Commit gehören **nur** die Dateien unter `specs/` (inklusive `specs/INDEX.md`).
In der Botschaft stehen **keine** `#N`-Referenzen auf Nicht-Pakete: `apply` und `check`
lesen die Paketnummern aus den Commit-Betreffs, und eine erfundene Nummer im Betreff
dieses Commits würde dort als Arbeitspaket gewertet.

**Leere Vorschau.** Ist keine Änderung an `specs/` zu erwarten — alle Wirkungen `KEINE`,
oder nur Pakete vor `seit` —, entfallen Zustimmung und Commit. Melde
„Keine Spec-Fortschreibung in diesem Batch" und gehe direkt zu Schritt 4. Das Spec-Gate
läuft dort trotzdem — es prüft den Batch, nicht die Fortschreibung. Das ist der
Regelfall.

**Fehlerpfade.** Endet `apply` (auch mit `--dry-run`) mit einem Exitcode ungleich 0,
oder liefert die `merge-base`-Substitution einen **leeren** Anker, hält der Ablauf an:
kein Commit, keine Pflicht-Checks, kein Push. Meldung mit dem Grund. Ein roter
`apply`-Lauf ist kein Randfall, den man übergeht — er heißt, dass Paket und Beschreibung
nicht zusammenpassen.

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
keinen `check`-Aufruf. `/push-main` läuft dort unverändert wie bisher — Stand prüfen,
Pflicht-Checks, Release-Schritte, Push.

## Was dieser Skill nicht tut

- Kein Push und kein Version-Bump bei einem roten Pflicht-Check (Schritt 4)
- Kein Push ohne Zustimmung zur Spec-Fortschreibung (bei gesetztem `spec`-Block)
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
