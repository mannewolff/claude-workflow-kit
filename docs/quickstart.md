# 5-Minuten-Guide

Das Kit macht einen Prozess für KI-gestützte Entwicklung in Claude Code ausführbar, ohne dass du deine Stop-Punkte aufgibst: siebzehn Skills, eine Config und ein Installer.

## Voraussetzungen

- macOS, Linux oder Windows über WSL2, eingerichtet nach [Windows über WSL2](/wsl2)
- Node.js ab Version 18 und git
- Claude Code
- Je nach Issue-Tracker `gh` oder `glab`, angemeldet; im lokalen Modus keins von beiden

## Installieren

Im Projektordner:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Der Installer fragt in einem neuen Projekt zuerst nach der Sprache (`de` oder `en`), dann, ob er global oder nur für dieses Projekt installiert, nach Code-Host und Issue-Tracker (`github`, `gitlab` oder `local`), nach Haupt- und Production-Branch, Review-Umfang und Reviewer. Projektlokal folgen das Commit-Gate und die Prüfbereiche, global der Vault-Pfad für `/session-start` und `/document`.

Danach liegen Skills, Config und Werkzeuge unter `.claude/`. Starte Claude Code neu; die Skills erscheinen in `/help`.

## Die siebzehn Skills

| Befehl | Wofür |
|--------|-------|
| `/session-start` | Lageüberblick zu Beginn einer Sitzung |
| `/triage` | Eine Idee durchsprechen und auf ihre Bahn bringen |
| `/requirement` | Fachplan ohne Technik für die PO-Schleife |
| `/groom` | Offene Fragen eines geprüften Fachplans einzeln entscheiden |
| `/techplan` | Plan aus der Anforderung, ohne Umsetzung |
| `/issues` | Plan in kleine Arbeitspakete zerlegen |
| `/task` | Anforderung ohne Abwägung als ein Arbeitspaket `[Task]` |
| `/issue-review` | Dokument von fremden Modellen prüfen lassen |
| `/implement-ready` | Alle Ready-Karten umsetzen, lokal committen |
| `/implement-next` | Genau eine Ready-Karte umsetzen |
| `/implement-test` | Nur die roten Tests zur nächsten Ready-Karte |
| `/implement-done` | Gegen die roten Tests umsetzen |
| `/kit-review` | Review durch ein zweites Modell in frischer Sitzung |
| `/push-main` | Push auf den Hauptzweig, nur auf dein Wort |
| `/merge-production` | Veröffentlichen nach production, nur auf dein Wort |
| `/retro` | KI-Retrospektive mit Kennzahlen |
| `/document` | Sitzung im Vault dokumentieren |

## Ein erster Durchlauf

```
/techplan baue ein Login-Formular mit E-Mail und Passwort
```

Passt der Plan, zerlegt `/issues` ihn in Arbeitspakete. Du ziehst sie am Board nach Ready; das ist dein GO. Dann:

```
/implement-ready
/kit-review
```

Nach deiner Durchsicht pushst du mit `push main`, nach deinem Test auf dem Test-Server veröffentlichst du mit `merge production`. Danach ziehst du die Karten nach Done.

## Der kleinere Weg

Ist eine Anforderung mehr als eine Kleinigkeit, gibt es aber nichts abzuwägen, entsteht mit `/task` ein einzelnes Arbeitspaket statt Fachplan, Plan und Zerlegung. Der Skill nennt die Bahn und legt erst nach deiner Bestätigung an. Wann welcher Weg gilt, steht unter [Drei Bahnen](./dokumentation.md#drei-bahnen).

## Die drei Stellen, die du selbst machst

Das Ziehen nach Ready, der Push, der Merge. Diese drei automatisiert das Kit nicht.

## Nachts arbeiten lassen

Abends sortierst du Karten in Ready und startest `node .claude/kit/night.mjs`. Der Nacht-Runner setzt jede Karte in einer frischen Sitzung um, committet lokal und pusht nie. Mehr unter [Nachtbetrieb](./nachtbetrieb.md).
