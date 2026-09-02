---
name: review
description: Startet einen Review durch einen Opus-Subagent in frischer Session ohne Implementierungs-Kontext. Nutze diesen Skill wenn der Nutzer /review aufruft oder Schritt 7 des Prozesses startet (Code-Review durch zweites Modell).
user-invocable: true
---

# Review

Startet Schritt 7 des 9-Schritt-Prozesses: Code-Review durch ein zweites Modell in frischer Session, ohne Kenntnis der Implementierungs-Session.

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

`reviewModel`, `reviewCommand` und `reviewScope` sind die klassischen persönlichen Felder: Wer lieber mit einem anderen Modell, mit einer fremden CLI oder immer über den vollen Quelltext reviewt, setzt das in `.claude/workflow.config.local.json` — ohne das Team zu beeinflussen.

Die relevanten Felder:

- `reviewScope`: `"diff"` (nur git diff seit letztem Push) oder `"full"` (gesamter Quelltext)
- `reviewModel`: Modell-ID für den Reviewer-Subagent (Default: `claude-opus-4-8`)
- `reviewCommand`: Kommandozeile einer fremden CLI (z. B. `codex exec --model gpt-5`), die den Review-Prompt über stdin bekommt
- `mainBranch`: Basis-Branch für den Diff (Default: `main`)

**`reviewModel` und `reviewCommand` sind ein Paar: genau eines von beiden ist gesetzt** (Issue #432). Sie beschreiben dieselbe Rolle auf zwei Wegen — ein Claude-Subagent oder ein fremdes Werkzeug —, und der Skill startet je nach gesetztem Feld den einen oder den anderen (Schritt 2).

Zwei Lagen entstehen zur Laufzeit trotzdem:

- **Fehlen beide Felder**, gilt der Default `reviewModel: "claude-opus-4-8"` — mit Hinweis. Configs aus der Zeit vor dem Paar kennen keines von beiden, und `/review` darf für sie nicht brechen.
- **Sind beide gesetzt**, bricht `/review` mit Verweis auf die Oder-Regel ab, statt still eines zu bevorzugen. Der Installer lässt diese Lage nicht zu (Issue #433), ein Handedit an der Config schon — und welches der beiden dann gemeint war, weiß nur der Mensch.

Fehlt `reviewScope`, nutze `"diff"` als Default und weise darauf hin.

## Ablauf

### 1. Review-Material zusammenstellen

**Bei `reviewScope: "diff"`:**
```bash
git diff origin/<mainBranch>...HEAD
```
`<mainBranch>` ist der Wert aus der Config (Default: `main`). Falls kein Remote-Commit existiert: `git diff HEAD~1 HEAD` (letzter Commit).

**Bei `reviewScope: "full"`:**
Alle relevanten Quelltext-Dateien lesen (keine Build-Artefakte, keine `node_modules`, keine `.git`-Inhalte).

### 2. Reviewer starten

Welcher der beiden Wege gilt, entscheidet das gesetzte Feld aus der Vorbedingung:

**Bei gesetztem `reviewModel` — Subagent über das Agent-Tool:**
- **Modell:** Wert aus `reviewModel` (Opus-Pin)
- **Isolation:** frische Session, kein Implementierungs-Kontext
- **Prompt:** der Text unten, befüllt mit dem Review-Material aus Schritt 1

**Bei gesetztem `reviewCommand` — das konfigurierte Kommando starten**, den Prompt **über stdin** übergeben, die Antwort von stdout lesen:

```bash
<reviewCommand> < prompt.txt
```

Nicht als Argument. Ein Diff mit Backticks, Anführungszeichen und Zeilenumbrüchen durch eine Kommandozeile zu quoten ist genau der Fehler, den Issue #196 aus `board.mjs` entfernt hat; dasselbe Muster trägt der Kommando-Reviewer in `/issue-review` (Issue #270). Die Kommandozeile ist frei konfiguriert und läuft deshalb über die Plattform-Shell — dieselbe Abgrenzung wie bei `buildChecks` in `night.mjs` (Issue #199). Das Agent-Tool kommt hier nicht zum Einsatz: Es kennt nur Claude-Modelle, und ein `reviewCommand` durch dieses Werkzeug zu reichen wäre ein stiller Ausfall.

**Ausfallpfad: Endet das Kommando mit Exit ungleich 0, bricht `/review` ab** — mit sichtbarer Fehlermeldung einschließlich eines stderr-Ausschnitts. Das Issue wechselt dabei **nicht** nach In review, und es entsteht **kein Board-Kommentar**. Ein Review, der nicht lief, darf keine Spur hinterlassen, die wie eine Prüfung aussieht: Ein Kommentar unter „Code-Review (Schritt 7)" ohne Befunde liest sich wie ein sauberer Durchlauf, und ein Issue in *In review* behauptet, die Prüfung sei erledigt. Beides wäre schlechter als der sichtbare Abbruch.

**Prompt für beide Wege** — der folgende Text, befüllt mit dem Review-Material aus Schritt 1:

```
Du bist Code-Reviewer. Du hast keinen Kontext über die Implementierungs-Session und das ist gewollt — du bringst einen frischen Blick.

Überprüfe das folgende Material und berichte über:
1. Korrektheit: Logikfehler, Edge Cases, falsche Annahmen
2. Sicherheit: Injections, fehlende Validierung, Secrets im Code, unsichere Patterns
3. Qualität: fehlende Tests, unklare Benennung, unnötige Komplexität
4. Architektur: Brüche gegen erkennbare Konventionen, unnötige Abhängigkeiten

Für jeden Fund:
- Datei und Zeile (wenn aus dem Material ableitbar)
- Schweregrad: KRITISCH / WICHTIG / HINWEIS
- Konkrete Beschreibung des Problems
- Vorschlag zur Behebung

Wenn du nichts findest: schreibe das explizit, nicht "alles gut".

--- REVIEW-MATERIAL ---
{{REVIEW_MATERIAL}}
```

Ersetze `{{REVIEW_MATERIAL}}` durch das tatsächliche Diff oder den Quelltext.

### 3. Ergebnis dokumentieren

Schreibe die Befunde als Kommentar ans aktuelle Issue:

```bash
node .claude/kit/board.mjs issue comment <ISSUE-NUMMER> --text - <<'REVIEW'
## Code-Review (Schritt 7)

<BEFUNDE>
REVIEW
```

Falls kein Issue ermittelbar: Gib die Befunde direkt aus.

## Stop-Punkt

Nach dem Review wartet der Prozess auf den Menschen. Claude setzt das Issue auf **In review** — der Commit-Push (Schritt 8) erfolgt nur auf explizite Trigger-Phrase `push main`.
