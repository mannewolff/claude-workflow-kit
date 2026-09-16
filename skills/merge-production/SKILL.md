---
name: merge-production
description: Schritt 9 des 9-Schritt-Prozesses — erstellt einen PR von main nach production. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "merge production" tippt.
user-invocable: true
disable-model-invocation: true
---

# Merge Production

Schritt 9 des 9-Schritt-Prozesses: Einen Pull Request von `mainBranch` nach `productionBranch` erstellen. Der Merge selbst ist Mannes Aufgabe.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `merge production` (oder die in `.claude/workflow.config.json` unter `triggers.merge` konfigurierte Phrase).

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin merge production getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gemerged. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

## Ablauf

**Fortschritt melden.** Jeder Schritt beginnt mit einer Zeile `Schritt k von n — <Name> (laeuft)`.
Das `n` ist die Zahl der Schritte, die dieser Lauf tatsächlich fährt — ohne `spec`-Block
oder ohne `RELEASING.md` sind es weniger, und dann zählt die Zeile auch weniger. Der Grund
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand dauert so lange wie der volle
`buildChecks`-Katalog, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Quell-Branch (Default: `main`)
- `productionBranch`: Ziel-Branch (Default: `production`)

### 2. Commits zusammenfassen

```bash
git log origin/<productionBranch>..origin/<mainBranch> --oneline
```

Diese Commits kommen in den PR-Body als Änderungsübersicht.

### 3. CI-Status prüfen (Gate — vor dem Release)

Die `buildChecks` sind ein gutes Gate, aber sie messen nur, was diese Maschine messen
kann. Die CI prüft **mehr**: Dieses Repo fährt seit Issue #196 einen zweiten Job auf
`windows-latest`. Am 2026-08-13 ging v1.38.0 nach production, während genau dieser Job
fehlschlug — die Information lag vor, sie wurde nur nie abgerufen (Issue #316).

Geprüft wird der Stand, der gleich hinausgeht:

```bash
git fetch origin <mainBranch>
git rev-parse origin/<mainBranch>
```

Der **vollständige** SHA aus `git rev-parse` geht an die Achse:

```bash
node .claude/kit/board.mjs code ci-status --commit <sha>
```

Weicht `git rev-parse HEAD` davon ab — uncommittete oder ungepushte Commits —, stoppt der
Skill ohne CI-Abfrage und ohne PR: Die CI kennt diesen Stand nicht, ihr Urteil gälte einem
anderen.

Das Ergebnis entscheidet:

- **`rot`: kein PR.** Der Skill nennt die roten Jobs mit Namen und endet. Dieselbe Härte wie beim buildChecks-Gate — ein Release ist der teuerste Zeitpunkt für eine Warnung, die man überliest. **Exit-Code 1 der Achse wird wie `rot` behandelt**, denn ein Adapterfehler darf kein Freifahrtschein sein.
- **`laeuft`:** Der Skill nennt die laufenden Jobs und fragt genau einmal: `CI läuft noch. PR trotzdem erstellen? (ja/nein)`. Nur die Antwort `ja` fährt fort; jede andere Antwort endet ohne PR. Nachts gibt es keinen `merge production`-Trigger, die Rückfrage ist hier also unproblematisch.
- **`keine`:** Der Lauf fährt unverändert weiter — ein Projekt ohne CI ist nicht releaseunfähig.

**Warum das Gate hier steht und nicht nach dem Release-Push:** Der Lauf zum eben
gepushten `chore: vX.Y.Z` ist Sekunden später nie fertig — das Gate lieferte dann im
Regelfall `laeuft` und fragte jedes Mal. Und ein Stopp bei `rot` ließe den Versionsbump
auf `origin/<mainBranch>` zurück, während das Bump-Kommando nicht idempotent ist und der
nächste Anlauf erneut bumpte. Der Stand von `push main` trägt zudem die eigentliche
Änderung; der Release-Commit nur Stempel und Changelog.

### 4. Release-Dateien erzeugen (falls `RELEASING.md` existiert)

> `Schritt 4 von 9 — Release-Dateien erzeugen (laeuft)`

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Merge-Trigger (`merge production`) beschriebenen
  Schritte aus — **bis zum ersten festschreibenden Schritt**, also typischerweise Bump,
  Stempel und Changelog. Nicht committen: Das kommt aus Schritt 6.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 5.

**Fremde `RELEASING.md`.** Die Grenze ist der erste Schritt, der festschreibt oder
veröffentlicht (`git commit`, `git push`, `git tag`, ein Release-Kommando). Alles davor
fährt der Skill; ab dort übernimmt er. Stehen **hinter** dem ersten festschreibenden
Schritt noch weitere Schritte, führt der Skill sie nach seinem Commit aus und sagt das im
Abschlussbericht.

Der Skill selbst kennt keine projektspezifische Versions- oder Changelog-Logik; diese
lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos. Ein Tag entsteht hier
**nicht** — siehe Schritt 7.

### 5. Der eine Prüflauf (Gate — vor Commit, Push und PR)

> `Schritt 5 von 9 — Prueflauf (laeuft)`

**Vor dem einen Commit dieses Wegs steht der eine Prüflauf.** Der Nachweis gehört zum
Commit: Bump, Stempel und Changelog erzeugen Dateien, die kein früherer Lauf gesehen haben
kann, und ohne Nachweis für genau diesen Stand weist das Commit-Gate sie ab. Bis v1.53
stand vor **jedem** Commit dieses Wegs ein eigener Lauf — es gab zwei. Jetzt gibt es einen
Commit und darum einen Lauf.

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

**Der Anker ist der Batch, nicht `HEAD`.** Ohne `--since` nimmt `planen` in
`kit/checks.mjs` `HEAD` als Basis; ist seit `HEAD` nichts geändert, meldet es
`leeresPaket` und lässt **jede** Prüfung mit Exit 0 aus — ein Release liefe dann durch
eine leere Prüfung.

Ein roter Lauf hält an: kein Commit, kein Push, kein PR. Der Bump aus Schritt 4 bleibt
stehen; er ist seit Issue #656 idempotent und steigt beim nächsten Anlauf nicht erneut.

### 6. Der eine Commit

> `Schritt 6 von 9 — Commit (laeuft)`

```bash
git add <die Dateien aus Schritt 4>
git commit -m "chore: vX.Y.Z"
```

Committet wird auf `mainBranch`, damit die Dateien im PR nach `production` enthalten sind,
und nur bei tatsächlichem staged Diff. Hat Schritt 4 nichts erzeugt, gibt es keinen
Release-Commit — das gehört in den Abschlussbericht und bedeutet, dass Schritt 7 nichts zu
taggen hat.

**Merke dir den Hash dieses Commits.** Schritt 7 braucht ihn, und er ist danach nicht mehr
sicher rekonstruierbar:

```bash
git rev-parse --short HEAD
```

**Die Nachweiszeile.** Nenne im Abschlussbericht zu diesem Commit den Hash, das Ergebnis
des deckenden Laufs aus Schritt 5 und dessen `zeitpunkt` aus der Prüf-Zusammenfassung
(`.claude/checks-summary.json`, Issue #655) — der Zeitpunkt sagt, ob der Nachweis zu
diesem Stand gehört oder von einem früheren Lauf stammt.

Danach pushen:

```bash
git push origin <mainBranch>
```

### 7. Tag-Kommando ausgeben — der Tag wird nicht gesetzt

> `Schritt 7 von 9 — Tag-Kommando (laeuft)`

**Der Skill setzt und pusht keinen Tag.** Ein Tag markiert ein Release, und
Releases setzt der Mensch — dieselbe Linie wie bei den drei Stop-Punkten.

Was der Skill liefert, ist die **fertige, kopierbare Kommandozeile**, in einem
eigenen Code-Block am Ende des Laufs:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

`<hash>` ist der `chore: vX.Y.Z`-Commit aus Schritt 6 — der Skill kennt ihn, weil
er ihn selbst erzeugt hat. **Nicht `HEAD` einsetzen und nicht raten:** Nach dem
Release-Commit können weitere Commits folgen, und der Tag zeigt dann auf den
falschen Stand.

Der Tag zeigt auf den Release-Commit auf `mainBranch` — nicht auf den
Merge-Commit in `productionBranch`.

Der Grund für die Kommandozeile statt einer Bitte: Wer nach jedem Release Hash
und Syntax selbst zusammensuchen muss, lässt es irgendwann bleiben. Genau das ist
sechsmal in Folge passiert (Issue #244).

Hat Schritt 6 keinen Release-Commit erzeugt — keine `RELEASING.md`, kein Bump —,
gibt es nichts zu taggen. Das gehört **in den Abschlussbericht**, nicht in ein
stilles Überspringen.

**Beim `push main`-Trigger entsteht kein Tag.** Dort entstehen interne
Patch-Stände, die niemand veröffentlicht; ein Tag je Patch wäre Lärm.

### 8. PR bzw. MR erstellen

> `Schritt 8 von 9 — PR erstellen (laeuft)`

```bash
node .claude/kit/board.mjs code pr \
  --from <mainBranch> \
  --to <productionBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATUM>)"
```

Der Adapter erstellt den PR/MR provider-unabhaengig. Bei `codeHost: local` gibt er einen gefuehrten Merge-Dialog aus.

### 9. GitHub-Release-Kommando ausgeben — erst nach dem Tag ausführbar

Am Ende dieses Laufs existiert der Tag **noch nicht**: Schritt 7 hat nur die
Kommandozeile ausgegeben, gesetzt hat ihn niemand. Ein Release kann in diesem
Lauf deshalb nicht entstehen — das ist keine Ausnahme, sondern der Normalfall.

Bei `codeHost: github` gibt der Skill das zweite Kommando gleich mit aus, im
selben Block wie das Tag-Kommando, damit beides in einem Rutsch ausführbar ist:

```
gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad-zum-changelog-abschnitt>
```

Der Notes-Body ist der neue Abschnitt aus `CHANGELOG.md` (falls die
`RELEASING.md`-Schritte einen erzeugt haben); ohne Changelog-Datei die
Commit-Liste aus Schritt 2 als Notes.

Bei `codeHost` ungleich `github` (z. B. `gitlab`, `local`) entfällt das
Release-Kommando. Das gehört **in den Abschlussbericht** — dass ein Schritt nicht
greift, muss man lesen können, sonst sieht ein Lauf ohne Release aus wie ein Lauf
mit Release.

### 10. PR/MR-URL und die beiden Kommandos zurückgeben

Gib die URL aus dem Adapter-Output aus, gefolgt von den Kommandos aus Schritt 7
und 9 in **einem** Code-Block. Der Merge ist Mannes Aufgabe — Claude merged nicht,
und den Tag setzt er ebenfalls selbst.

> "PR/MR erstellt: <URL>. Der Merge nach production liegt bei dir.
> Nach dem Merge der Tag:"
>
> ```
> git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
> gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad>
> ```

## Was dieser Skill nicht tut

- Kein direkter Push auf `production`
- Kein Merge des PR — das macht der Mensch
- Kein automatischer PR nach Push oder nach grünem Review
- Kein Force-Merge oder Bypass von Branch-Protection-Regeln
- **Kein PR bei roter CI** — und ein Exit-Code 1 der Achse `code ci-status` zählt
  wie `rot` (Schritt 3)
- **Kein Commit, kein Push und kein PR bei rotem Prüflauf** (Schritt 5)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- **Kein Setzen und kein Pushen von Tags** — der Skill gibt nur die Kommandozeile
  aus, den Tag setzt der Mensch (Schritt 7)
- Kein Force-Push von Tags, kein Überschreiben bestehender Tags
