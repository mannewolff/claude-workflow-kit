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

Das Material geht in eine Datei außerhalb des Projektverzeichnisses:

```bash
printenv TMPDIR
```

Bleibt die Ausgabe von `printenv TMPDIR` leer (Linux und WSL2 ohne Sandbox), gilt `/tmp` als `<tmpdir>`. Der Pfad steht in jedem Aufruf wörtlich.

**Bei `reviewScope: "diff"`:**
```bash
git diff origin/<mainBranch>...HEAD > <tmpdir>/review-material.txt
```
`<mainBranch>` ist der Wert aus der Config (Default: `main`). Falls kein Remote-Commit existiert: `git diff HEAD~1 HEAD > <tmpdir>/review-material.txt` (letzter Commit).

**Bei `reviewScope: "full"`:**
Alle relevanten Quelltext-Dateien (keine Build-Artefakte, keine `node_modules`, keine `.git`-Inhalte) nacheinander in `<tmpdir>/review-material.txt`, jede mit einer Kopfzeile `=== <pfad> ===` davor.

### 2. Reviewer starten

Den Prüfauftrag montiert das Kit aus der Rolle `kit/rollen/code-review.md`, der Artenliste und dem Material aus Schritt 1; die Session schreibt keinen Prompt und füllt nichts selbst ein:

```bash
node .claude/kit/board.mjs issue-review pruefauftrag --rolle code-review --material-datei <tmpdir>/review-material.txt --datei <tmpdir>/review-auftrag.md
```

Welcher der beiden Wege gilt, entscheidet das gesetzte Feld aus der Vorbedingung:

**Bei gesetztem `reviewModel` — Subagent über das Agent-Tool** mit `subagent_type: kit-pruefer` und dem Modell aus `reviewModel` (Opus-Pin), in frischer Session ohne Implementierungs-Kontext. Der Auftrag lautet nur `Lies <tmpdir>/review-auftrag.md`, mit wörtlichem Pfad. Der Agent darf nur lesen, seine Abschlussnachricht ist der Befund.

**Bei gesetztem `reviewCommand` — das Kit startet das konfigurierte Kommando** an seiner Lesegrenze (`reviewLesegrenze`), den Auftrag über stdin, die Antwort von stdout in die Ausgabedatei:

```bash
node .claude/kit/board.mjs issue-review start --code-review --auftrag <tmpdir>/review-auftrag.md --ausgabe <tmpdir>/review-antwort.md
```

Das Agent-Tool kommt hier nicht zum Einsatz: Es kennt nur Claude-Modelle, und ein `reviewCommand` durch dieses Werkzeug zu reichen wäre ein stiller Ausfall.

**Ausfallpfad: Endet `pruefauftrag` oder `start` mit Exit ungleich 0, bricht `/review` ab** — mit sichtbarer Fehlermeldung einschließlich des Fehlers aus der Ausgabe, bei `start` samt stderr-Ausschnitt. Das Issue wechselt dabei **nicht** nach In review, und es entsteht **kein Board-Kommentar**. Ein Review, der nicht lief, darf keine Spur hinterlassen, die wie eine Prüfung aussieht: Ein Kommentar unter „Code-Review (Schritt 7)" ohne Befunde liest sich wie ein sauberer Durchlauf, und ein Issue in *In review* behauptet, die Prüfung sei erledigt. Beides wäre schlechter als der sichtbare Abbruch.

### 3. Ergebnis dokumentieren

Schreibe die Befunde als Kommentar ans aktuelle Issue:

```bash
cat  > <tmpdir>/id-review.md <<'TEIL1'
## Code-Review (Schritt 7)

<BEFUNDE>
TEIL1
```

```bash
cat >> <tmpdir>/id-review.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/befunde.mjs pruefen --datei <tmpdir>/id-review.md
```

Meldet das Kommando fehlende Angaben, fordert die Session sie beim Reviewer genau **einmal** nach und schreibt die Datei neu. Bleibt eine Angabe danach aus, trägt der betroffene Fundblock die Zeile `Angaben: unvollstaendig`. **Kein Gate:** Weder eine fehlende Angabe noch eine ausgebliebene Nachlieferung hält den Lauf auf; scheitert das Kommando selbst, steht das als eine Zeile im Kommentar. Der Kommentar geht in jedem dieser Fälle ans Board — der Ausfallpfad aus Schritt 2 bleibt davon unberührt, denn ein Review, der nicht lief, liefert nichts:

```bash
node .claude/kit/board.mjs issue comment <ISSUE-NUMMER> --text-file <tmpdir>/id-review.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board". **Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere Mutation.

Falls kein Issue ermittelbar: Gib die Befunde direkt aus.

## Stop-Punkt

Nach dem Review wartet der Prozess auf den Menschen. Claude setzt das Issue auf **In review** — der Commit-Push (Schritt 8) erfolgt nur auf explizite Trigger-Phrase `push main`.
