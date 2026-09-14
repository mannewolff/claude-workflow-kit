# Prozess auf dem Prüfstand — Vorschläge

Stand: 2026-09-10. Grundlage: docs.mwolff.org, `CLAUDE-workflow.md`, `CLAUDE-java.md`,
`CLAUDE-react.md`, `CLAUDE-security.md`, `workflow.config.json`, Skill `implement-ready`.

Dieses Dokument ist eine Arbeitsliste, keine Entscheidung. Jeder Punkt trägt eine
Priorität (P1 = zuerst), den Befund, die vorgeschlagene Änderung und die betroffenen
Dateien. Was nicht angefasst werden soll, steht am Ende.

---

## Diagnose in drei Sätzen

1. Die Qualität der Implementierung kommt aus den Build-Gates (JaCoCo 100, PIT 100,
   ArchUnit, `-Werror`, NullAway, ESLint `no-deprecated`), nicht aus der Aussagekraft
   der CLAUDE-Dateien. Die Dateien beschreiben die Gates, sie erzwingen sie nicht (B3).
2. Die Zeit geht in den Vorlauf: Fachplan → Review → Techplan → Review → Issues → Review →
   Sichten → GO. Bei 13 Paketen 17 Prüfläufe, und der Takt ist das Lesen der Kommentare (C7).
3. Der Prüf-Apparat (Stufen, Rollen, Pairs, fünf Labels, Hash-Verfall, drei Nachtmodi,
   Gate-Register) ist für den Nachtbetrieb gebaut, wird aber in jeder Session mitgetragen.

Der Chef hat halb recht: Sein Modus (CLAUDE.md + Checks vor Release) funktioniert für
einen Senior mit eigenem Repo. Er skaliert nicht auf unbeaufsichtigt, auf mehrere Personen
und auf Reviewer ohne Entstehungskontext. Dafür ist das Kit da. Der Fehler wäre, das volle
Gewicht als Default für jede Aufgabe zu tragen.

---

## P1 — `checkAreas` einführen

**Befund.** `workflow.config.json` hat keinen `checkAreas`-Block. Jeder Commit läuft
`mvn verify` (mit Testcontainers-ITs) und alle drei Frontend-Checks, unabhängig davon,
was das Paket berührt hat. Eine README-Änderung löst den vollen Lauf aus.

**Änderung.** `.claude/workflow.config.json`:

```json
"buildChecks": [
  { "cmd": "mvn verify", "areas": ["backend"] },
  { "cmd": "npm --prefix frontend run build", "areas": ["frontend"] },
  { "cmd": "npm --prefix frontend run lint", "areas": ["frontend"] },
  { "cmd": "npm --prefix frontend run test:coverage", "areas": ["frontend"] },
  { "cmd": "npx markdownlint-cli2 '**/*.md'", "areas": ["docs"] }
],
"checkAreas": {
  "backend":  ["src/**", "pom.xml", "config/**"],
  "frontend": ["frontend/**"],
  "docs":     ["*.md", "docs/**", "issues/**"]
}
```

**Hinweise.**
- Der `docs`-Bereich ist Pflicht, sonst zählt eine Markdown-Änderung als "keinem
  Bereich zuordenbar" und löst den vollen Lauf aus. Der Markdown-Check ist der billige
  Platzhalter, damit der Bereich existiert; ob er inhaltlich etwas bringt, ist zweitrangig.
- Vorher `node .claude/kit/checks.mjs plan` gegen drei bis fünf alte Commits laufen lassen
  und prüfen, ob die Auswahl stimmt. Landet oft alles im Zweifelsfall, fehlt ein Muster.
- `mutationCommand` bleibt außerhalb der Auswahl (läuft nur in `/local-check`) — richtig so.

**Dateien:** `.claude/workflow.config.json`

---

## P1 — Dritte Bahn: Task

**Befund.** Bahn 1 ("genau eine Datei") ist so eng, dass fast alles Bahn 2 wird und den
vollen Vorlauf bekommt. Bahn 1 breiter zu machen hinterlässt aber keine Spur außer dem
Commit — C3 (Issue als Quelle der Wahrheit) gilt dann nicht mehr für kleine Dinge.

**Änderung.** Drei Bahnen statt zwei:

| Bahn | Issue | Plan | Beispiel |
|------|-------|------|----------|
| 1 Direkt | nein | nein | Tippfehler, Favicon, Config-Default |
| Task | ja (Vier-Abschnitt) | nein | Refactoring in einem Bounded Context, neue Komponente ohne neuen Endpoint, Lint-Regel einführen |
| 2 Feature | ja, aus Plan | ja | neue Tabelle, neuer Endpoint, neues UI-Feature |

**Regeln für den Task — bitte alle sechs, sonst wachsen sie als Sonderfälle nach:**

1. **Ausschlüsse wie Bahn 1, keine Größenbeschränkung.** Kein Datenmodell, keine
   Migration, kein neuer oder geänderter Endpoint, keine sicherheitsrelevante Logik.
   Dateizahl und Modulzahl sind kein Kriterium. Trennlinie zu Bahn 2 ist Reichweite,
   nicht Aufwand: Was mehrere Wege offen lässt, braucht einen Plan.
2. **Kein Titel-Präfix.** `[Fachlich]`, `[Plan]`, `[Idee]` bedeuten "wird nie
   implementiert". Ein Task ist ein normales Arbeitspaket; er erkennt sich am Fehlen von
   `Plan:` und `Fachliche Quelle:` im Kontext. Optional eine Zeile `Bahn: Task` im Kontext.
3. **Das GO bleibt.** `/task` legt im Backlog an, der Mensch zieht nach Ready. Kein Skill
   schreibt Ready — auch nicht auf menschlichen Auslöser hin (W1, Präzedenzfall für die Nacht).
4. **Eskalation zur Laufzeit.** Stellt die Implementierungs-Session fest, dass die Aufgabe
   einen Ausschluss berührt, stoppt sie, committet nichts und stellt das Issue kommentiert
   ins Backlog: "Berührt Endpoint/Migration/Sicherheit — braucht `/techplan`." Das ersetzt
   die Stelle im Plan, an der man so etwas sonst merkt. Ohne diese Regel ist der Task ein
   Weg an der Planung vorbei ins Datenmodell.
5. **Keine Prüfung per Default.** Kein `Pruefung:`-Eintrag → Fall 3 (Hinweis, kein Stopp).
   Wer ihn nachts will, setzt `Pruefung: Verzicht` selbst.
6. **Schritt 6 und 7 gelten unverändert.** Der Task umgeht Planung und Issue-Review, nicht
   Checks und Code-Review.

**Namensfrage (Geschmack, aber entscheiden):** "Task", "Issue", "Arbeitspaket" sind drei
Wörter für Dinge, die am Board gleich aussehen. Alternative: Skill `/issue` ("Issue direkt
anlegen"), Bahn heißt "Direkt-Issue".

**Dateien:** neuer Skill `task` (oder `issue`), `CLAUDE-workflow.md` Abschnitt "Zwei
Bahnen" → "Drei Bahnen", Leitplanke in `implement-ready`/`implement-next`/`night.mjs`
(Eskalation, Punkt 4), Doku-Site.

---

## P2 — Issue-Review auf Anforderung

**Befund.** `requiredBeforeReady: false` blockiert nichts, aber es fehlt eine Regel, wann
`/issue-review` auf Stufe `issue` überhaupt gerufen wird. Eigener Befund vom 08.08.:
drei von vier Scope-Befunden auf Issue-Ebene waren Fehlalarme. Interaktiv läuft der
Issue-Review wegen `Autor-Modell: unbekannt` immer mit dem vordersten Reviewer (Opus);
die fünf Reviewer und `pairs` wirken nur nachts.

**Änderung.**
- Der Plan-Review bleibt (C5). Der Issue-Review wird Opt-in.
- `/issues` markiert beim Anlegen nur die Pakete mit `kit:nightreview`, die der Plan-Review
  als riskant benannt hat (Sicherheit, Migration, mehr als zwei Abhängigkeiten, offene
  Alternativen). Alle anderen bleiben ungeprüft = Fall 3.
- Tasks bekommen nie `kit:nightreview` automatisch.

**Dateien:** Skill `issues` (Markierungsregel), `CLAUDE-workflow.md` (Absatz "Vor dem GO
gehört ein Dokument geprüft" abschwächen: Plan ja, Arbeitspaket nach Bedarf).

---

## P2 — `CLAUDE-workflow.md` auf den Kern kürzen

**Befund.** Die Datei liegt im Kontext jeder Session, auch der Implementierungs-Sessions.
Etwa die Hälfte betrifft Review-Mechanik und Nachtbetrieb, die dort nicht gebraucht wird.
Die Prüfstufen stehen dreimal (Doku-Site, Workflow-Datei, Skill) und driften bereits:

| Stelle | Sagt | Stimmt nicht mit |
|--------|------|------------------|
| Zustandslabels | drei `review:*`-Labels, "vier Definitionen" | Doku-Site: fünf (`review:grenze` fehlt) |
| Schritt 7 | "Startet Opus-Reviewer" | Config: `reviewCommand` = Codex |
| Config-Beispiel | `reviewModel` | Config: `reviewCommand` |
| Doku-Site `/implement-ready` | "sortiert nach Issue-Nummer" | Skill: Board-Reihenfolge |

**Änderung.** Regel: Jede Regel steht an genau einer Stelle; der Skill, der sie braucht,
lädt sie.

| Bleibt in `CLAUDE-workflow.md` | Wandert aus |
|-------------------------------|-------------|
| Neun Schritte | Prüfstufen + Marker-Orte → Skill `issue-review` |
| Drei Stop-Punkte | Zustandslabels → Skill `issue-review` |
| Drei Bahnen | Gates W1–W4 → `CLAUDE-Gates.md`, geladen nur von `issue-review` |
| Board (5 Spalten) | Nachtbetrieb → Doku-Site |
| Git-Workflow | Config-Beispiel + Stack-Tabelle → Doku-Site |
| Issue-Format (ohne `Pruefung:`-Absatz) | `Pruefung:`/`Pruefung-Stand:` → Skill `issue-review` |
| Abschlussbericht-Format | |
| Prioritäten bei Zielkonflikten | |
| Retro (drei Zeilen) | |

Erwartung: etwa halbe Länge. Beim Kürzen die vier Drift-Stellen oben beheben.

**Dateien:** `CLAUDE-workflow.md`, neu `CLAUDE-Gates.md`, Skills `issue-review`, Installer
(schreibt die Datei als Generat neu — Änderung gehört ins Kit, nicht ins Projekt).

---

## P2 — `CLAUDE-java.md` und `CLAUDE-security.md` entlasten

**Befund.** Was der Build erzwingt, wird in der CLAUDE-Datei noch einmal beschrieben.
Was die Datei darüber hinaus fordert, kann nicht scheitern — "Roter Test zuerst" und die
"Beweispflicht" prüft kein Gate, nachts erst recht nicht. Die Dateien driften:

- `CLAUDE-security.md`: oben Argon2id (`AuthConfig`), unten "Passwort-Hashing über
  `BCryptPasswordEncoder`" (Abschnitt "Authentifizierung & Tokens (falls eingeführt)").
- `CLAUDE-security.md`: `GlobalExceptionHandler` unter `org/mwolff/api/common/`;
  `CLAUDE-java.md`: unter `org/mwolff/manban/common/web/`.
- `CLAUDE-java.md` §8 wiederholt den 9-Schritte-Workflow mit eigener Nummerierung.

**Änderung.** Regel: Was ein Gate prüft, wird nur referenziert ("erzwungen durch
`pom.xml`, JaCoCo `check`"), nicht wiederholt. Was bleibt, ist Absicht, die kein Gate
prüfen kann.

Raus aus `CLAUDE-java.md`: §2.3 Beweispflicht, §8 (Workflow-Doppelung), §8.1
(Sätze an die Disziplin), Schwellwert-Tabelle §5.1 (steht in der `pom.xml`).
Bleibt: §3 Testpyramide mit den gelernten Fallen (ArchUnit-Engine, Testcontainers-Singleton),
§4 Mocking-Disziplin, §5.2 Ausschlussregeln, §5.4 Umgang mit nicht erreichbarer Coverage,
§6 Designregeln, Versionsstrategie.

In `CLAUDE-security.md`: Abschnitt "Authentifizierung & Tokens (falls eingeführt)"
streichen oder auf den Ist-Stand (Argon2id, `SecureTokens`) bringen; Handler-Pfad
vereinheitlichen.

**Dateien:** `CLAUDE-java.md`, `CLAUDE-security.md`, `CLAUDE-react.md` (Prüfung nach
derselben Regel, dort weniger Doppelung).

---

## P3 — Die Zahl

**Befund.** Der Nachtlauf misst sich selbst (Ergebnisstand-JSON, Dauer je Paket). Der
Vorlauf misst nichts. Die Diskussion mit dem Chef läuft deshalb über Gefühle.

**Änderung.** `/retro` bekommt eine vierte Frage: Beim letzten Feature — wie viele
Kalendertage von Anforderung bis GO, wie viele von GO bis Push? Alternativ hält `/document`
je Feature zwei Datumsstempel im Tageslog fest.

**Dateien:** Skill `retro`, ggf. `document`.

---

## P3 — Zustandslabels nur nachts

**Befund.** `statusLabels: true` schreibt bei jedem `label-sync` fünf mögliche Labels ans
Ticket. Interaktiv sieht man den Kommentar selbst; die Labels sind dort Buchhaltung.

**Änderung.** Wenn `night.mjs --review` regelmäßig läuft: lassen. Wenn nicht:
`statusLabels: false`. Kein Eingriff ins Kit nötig.

**Dateien:** `.claude/workflow.config.json`

---

## Nicht anfassen

- Die drei Stop-Punkte (W1).
- Das Commit-Gate (`.githooks/`).
- `/review` in Schritt 7 mit fremdem Kontext (Codex, `reviewScope: diff`).
- Die Auslagerung von PIT in `mutationCommand` (läuft nur in `/local-check`).
- Der Plan-Review mit zwei Rollen — der Plan ist der Schritt, an dem Fehler am billigsten sind.
- Das Vier-Abschnitt-Issue.

---

## Reihenfolge für Claude Code

1. `checkAreas` (Config, 10 Minuten, sofort messbar).
2. Task-Bahn: Skill + Eskalations-Leitplanke + Abschnitt in `CLAUDE-workflow.md`.
3. `/issues`: Markierungsregel für `kit:nightreview`.
4. `CLAUDE-workflow.md` kürzen, `CLAUDE-Gates.md` anlegen, Drift beheben — im Kit, nicht im Projekt.
5. `CLAUDE-java.md` / `CLAUDE-security.md` entlasten.
6. Retro-Frage.
