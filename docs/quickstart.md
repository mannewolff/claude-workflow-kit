# 5-Minuten-Guide

Du hast einen Prozess für die KI-gestützte Entwicklung, und du willst ihn in Claude Code ausführbar machen, ohne deine Stop-Punkte aufzugeben. Das Kit gibt dir sechzehn Skills, eine Config und einen Installer. In fünf Minuten läuft es.

## Voraussetzungen

- Node.js ab Version 18
- git
- Claude Code installiert
- Je nach Issue-Tracker: `gh` (GitHub CLI) oder `glab` (GitLab CLI), authentifiziert — oder gar nichts, wenn du den lokalen Modus wählst

## Installieren

Lade den Installer herunter und starte ihn im Projektordner:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Oder in einem Schritt:

```bash
node <(curl -s https://docs.mwolff.org/install.mjs)
```

Der Installer fragt sieben Dinge:

1. Global oder nur für dieses Projekt
2. Code-Host: `github`, `gitlab` oder `local`
3. Issue-Tracker: `github`, `gitlab` oder `local` (Standard = Code-Host)
4. Name des main-Branch
5. Name des production-Branch
6. Review-Umfang: `diff` oder `full`
7. Review-Modell

Bei globaler Installation folgt eine achte Frage nach dem Vault-Pfad für `/kontext` und `/document` (leer lassen überspringt sie).

Danach liegen die sechzehn Skills in `.claude/skills/` (oder global in `~/.claude/skills/`), eine `.claude/workflow.config.json` mit deinen Antworten sowie der Board-Adapter (`.claude/kit/board.mjs`) stehen im Repo. Starte Claude Code neu, dann tauchen die Skills in `/help` auf.

## Die sechzehn Skills

| Befehl | Wofür |
|--------|-------|
| `/kontext` | Kontext laden, Lageüberblick zu Session-Start |
| `/fachplan` | Optional: Anforderung als fachliches Issue für die PO-Schleife (siehe [Dokumentation](./dokumentation.md#po-schleife-fachliche-und-technische-issues)) |
| `/techplan` | Plan aus der Anforderung, implementiert nichts |
| `/issues` | Plan in kleinteilige Issues (GitHub, GitLab oder lokal) |
| `/task` | Anforderung ohne Abwägungsbedarf als einzelnes Arbeitspaket `[Task]`, erst nach deiner Bestätigung |
| `/issue-review` | Dokument vor dem GO von fremden Modellen prüfen lassen |
| `/implement-ready` | Ready-Issues abarbeiten, lokal committen |
| `/implement-test` | Granularer Einstieg: nur die Tests zu einem Ready-Issue (rot) |
| `/implement-done` | Granularer Einstieg: gegen die roten Tests implementieren (grün) |
| `/implement-next` | Genau ein Ready-Issue (`#N` verbindlich, sonst das oberste), dann Ende — Baustein des Nachtbetriebs |
| `/local-check` | Pflicht-Checks plus UI-Verifikation |
| `/review` | Review durch Opus in frischer Session |
| `/retro` | KI-Retrospektive, Memory konsolidieren |
| `/push-main` | Push auf main, nur du |
| `/merge-production` | PR nach production, nur du |
| `/document` | Session dokumentieren, Projektnotiz aktualisieren |

## Ein erster Durchlauf

```
/techplan baue ein Login-Formular mit E-Mail und Passwort
```

Du liest den Plan. Passt er, gibst du frei:

```
/issues
```

Du ziehst die Issues am Board nach Ready. Das ist dein GO. Dann:

```
/implement-ready
/local-check
/review
```

Du prüfst das Review. Erst dann:

```
/push-main
```

Auf dem Test-Server kontrollierst du das Ergebnis. Stimmt es:

```
/merge-production
```

## Der kleinere Weg

Nicht jede Anforderung braucht einen Plan. Ist sie mehr als eine Kleinigkeit, gibt es aber nichts abzuwägen, entsteht daraus ein einzelnes Arbeitspaket statt Fachkonzept, Plan und Zerlegung:

```
/task benenne die Konfigurationsschlüssel in allen Skill-Dateien einheitlich um
```

Der Skill benennt die Bahn in einem Satz und wartet auf dein Wort. Ohne deine Antwort legt er nichts an. Danach läuft der gewohnte Weg weiter: Du kannst das `[Task]` wie jedes andere Arbeitspaket mit `/issue-review` prüfen lassen, und nach Ready ziehst du es selbst.

Wann welcher Weg gilt, steht in der [Auswahlregel der drei Bahnen](./dokumentation.md#drei-bahnen).

## Die drei Stellen, die du selbst machst

Das Ziehen nach Ready, der Push, der Merge. Diese drei automatisiert das Kit bewusst nicht. Sie sind der Punkt, an dem du die Verantwortung trägst. Alles andere nimmt dir die KI ab.

## Nachts arbeiten lassen

Abends Issues nach Ready ziehen und sortieren, dann `node .claude/kit/night.mjs` — der Nacht-Runner arbeitet die Spalte mit einer frischen Session pro Issue ab, committet nur lokal und pusht nie. Details im Abschnitt „Nachtbetrieb" der [Dokumentation](./dokumentation.md#nachtbetrieb).

Mehr Details in der ausführlichen Dokumentation.
