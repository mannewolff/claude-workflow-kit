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

## Ablauf

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Quell-Branch (Default: `main`)
- `productionBranch`: Ziel-Branch (Default: `production`)

### 2. Commits zusammenfassen

```bash
git log origin/<productionBranch>..origin/<mainBranch> --oneline
```

Diese Commits kommen in den PR-Body als Änderungsübersicht.

### 3. Release-Schritte (falls `RELEASING.md` existiert)

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Merge-Trigger (`merge production`) beschriebenen
  Release-Schritte aus — typischerweise ein Version-Bump, optional ergänzt um eine
  Changelog-Generierung. Committe die geänderten Dateien auf `mainBranch`, damit
  sie im PR nach `production` enthalten sind.
- **Nein:** Nichts weiter tun.

**Merke dir den Hash dieses Release-Commits.** Schritt 4 braucht ihn, und er ist
danach nicht mehr sicher rekonstruierbar:

```bash
git rev-parse --short HEAD
```

Der Skill selbst kennt keine projektspezifische Versions- oder Changelog-Logik;
diese lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos. Ein Tag
entsteht hier **nicht** — siehe Schritt 4.

### 4. Tag-Kommando ausgeben — der Tag wird nicht gesetzt

**Der Skill setzt und pusht keinen Tag.** Ein Tag markiert ein Release, und
Releases setzt der Mensch — dieselbe Linie wie bei den drei Stop-Punkten.

Was der Skill liefert, ist die **fertige, kopierbare Kommandozeile**, in einem
eigenen Code-Block am Ende des Laufs:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

`<hash>` ist der `chore: vX.Y.Z`-Commit aus Schritt 3 — der Skill kennt ihn, weil
er ihn selbst erzeugt hat. **Nicht `HEAD` einsetzen und nicht raten:** Nach dem
Release-Commit können weitere Commits folgen, und der Tag zeigt dann auf den
falschen Stand.

Der Tag zeigt auf den Release-Commit auf `mainBranch` — nicht auf den
Merge-Commit in `productionBranch`.

Der Grund für die Kommandozeile statt einer Bitte: Wer nach jedem Release Hash
und Syntax selbst zusammensuchen muss, lässt es irgendwann bleiben. Genau das ist
sechsmal in Folge passiert (Issue #244).

Hat Schritt 3 keinen Release-Commit erzeugt — keine `RELEASING.md`, kein Bump —,
gibt es nichts zu taggen. Das gehört **in den Abschlussbericht**, nicht in ein
stilles Überspringen.

**Beim `push main`-Trigger entsteht kein Tag.** Dort entstehen interne
Patch-Stände, die niemand veröffentlicht; ein Tag je Patch wäre Lärm.

### 5. PR bzw. MR erstellen

```bash
node .claude/kit/board.mjs code pr \
  --from <mainBranch> \
  --to <productionBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATUM>)"
```

Der Adapter erstellt den PR/MR provider-unabhaengig. Bei `codeHost: local` gibt er einen gefuehrten Merge-Dialog aus.

### 6. GitHub-Release-Kommando ausgeben — erst nach dem Tag ausführbar

Am Ende dieses Laufs existiert der Tag **noch nicht**: Schritt 4 hat nur die
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

### 7. PR/MR-URL und die beiden Kommandos zurückgeben

Gib die URL aus dem Adapter-Output aus, gefolgt von den Kommandos aus Schritt 4
und 6 in **einem** Code-Block. Der Merge ist Mannes Aufgabe — Claude merged nicht,
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
- **Kein Setzen und kein Pushen von Tags** — der Skill gibt nur die Kommandozeile
  aus, den Tag setzt der Mensch (Schritt 4)
- Kein Force-Push von Tags, kein Überschreiben bestehender Tags
