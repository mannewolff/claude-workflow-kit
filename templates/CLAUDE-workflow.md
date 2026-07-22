# CLAUDE-workflow.md — claude-workflow-kit-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt.
Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## Die neun Schritte

| Schritt | Aktor | Was passiert | Skill |
|---------|-------|-------------|-------|
| 1. Anforderung | Mensch | Formuliert oder diktiert die Anforderung | — |
| 2. Plan | KI | Erstellt Plan, stellt zur Diskussion, implementiert nichts | `/plan` |
| 3. Plan zu Issues | KI | Uebertraegt Plan in GitHub-Issues (Vier-Abschnitt-Format) | `/issues` |
| 4. GO | Mensch | Zieht Issues nach Ready — das ist das GO | — |
| 5. Implementierung | KI | Arbeitet Ready-Issues sequenziell ab, committet lokal | `/implement-ready` |
| 6. Lokale Pruefung | KI + Mensch | Pflicht-Checks + manuelle UI-Verifikation | `/local-check` |
| 7. Code-Review | KI | Startet Opus-Reviewer in frischer Session | `/review` |
| 7.5. Retro | KI | KI-Retrospektive, Memory konsolidieren | `/retro` |
| 8. Push | Mensch | Tippt `push main` — Claude pusht den Batch | `/push-main` |
| 9. Merge | Mensch | Tippt `merge production` — Claude erstellt PR | `/merge-production` |

---

## Die drei Stop-Punkte (nie automatisiert)

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet.
2. **Push (Schritt 8):** Trigger-Phrase `push main`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase `merge production`. Claude merged nicht.

Diese drei Schritte sind die Verantwortungsschwellen. Sie bleiben menschlich und tippbar.

---

## Nachtbetrieb (optional)

Der Nacht-Runner (`node .claude/kit/night.mjs`) arbeitet die Ready-Spalte unbeaufsichtigt ab:
pro Issue eine frische Headless-Session mit `/implement-next` (genau ein Issue, dann Ende).
Erfolg wird am Board gemessen (Issue in In review); Fehlschlaege wandern kommentiert ins
Backlog, bei unsauberem Working Tree stoppt der Lauf hart. Die Stop-Punkte gelten
unveraendert: nachts wird committet, nie gepusht — Review, Test und `push main` passieren
morgens durch den Menschen. Details: Abschnitt "Nachtbetrieb" in der Kit-Dokumentation.

---

## Zwei Bahnen

**Bahn 1 — Kleine Änderung** (direkt; kein Plan/Issue/GO): genau eine Datei / ein Asset / eine Config; keine Flyway-Migration; kein neuer/geänderter Endpoint; kein Datenmodell; ≤ 1 Modul; keine sicherheitsrelevante Logik → direkt umsetzen, ein Commit, kein Push ohne Trigger.

**Bahn 2 — Feature** (voller 9-Schritt): berührt Datenmodell, API/Endpoint, Migration, Sicherheit oder > 1 Modul; oder Aufwand > ~1 Commit → `/plan` → `/issues` → GO → `/implement-ready`.

**Meta-Regel:** Vor Beginn jeder neuen Aufgabe die Bahn laut benennen ("Das ist Bahn 1/2, ich …"); im Zweifel Bahn 2.

| Beispiel | Bahn |
|----------|------|
| Icon-/Favicon-Tausch | 1 |
| Textkorrektur | 1 |
| Config-Default | 1 |
| Neue Tabelle | 2 |
| Neuer Endpoint | 2 |
| Neues UI-Feature | 2 |

---

## Kanban-Board (5 Spalten)

| Spalte | Bedeutung | Wer bewegt |
|--------|-----------|-----------|
| Backlog | Idee oder Issue mit offenen Fragen | Beide |
| Ready | Freigegeben, gilt als GO | Nur Mensch |
| In progress | Aktuelle Arbeit, ein Issue zur Zeit | KI beim Start |
| In review | Lokal fertig, nicht gepusht | KI beim Abschluss |
| Done | Mensch hat getestet, Push erfolgt | Nur Mensch |

Claude geht nur bis **In review**. Done setzt der Mensch nach seinem Test.

---

## Git-Workflow (strikt bindend)

1. Claude committet lokal, pusht NICHT automatisch.
2. Mensch testet lokal (Dev-Server starten, Golden Path durchklicken).
3. Mensch tippt `push main` — Claude pusht auf `mainBranch`.
4. Mensch testet auf Testserver.
5. Mensch tippt `merge production` — Claude erstellt PR `mainBranch -> productionBranch`.
6. Mensch merget den PR.

Absolut bindend:
- Kein Force-Push auf `mainBranch` oder `productionBranch` ohne explizite Einzelanweisung.
- Hooks (Pre-Commit / Pre-Push) werden nicht mit `--no-verify` umgangen.
- `productionBranch` wird nie direkt gepusht.

---

## Config (.claude/workflow.config.json)

```json
{
  "codeHost": "github",
  "issueTracker": "github",
  "buildChecks": ["<build-kommando>", "<test-kommando>"],
  "mutationCommand": "<mutations-test-kommando oder leer>",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" },
  "local": { "issuesDir": "issues" }
}
```

`codeHost` steuert den Code-Host (github | gitlab | local).
`issueTracker` steuert Issues und Board (github | gitlab | local).
Bei GitHub und GitLab zeigen beide auf denselben Wert.
Bestehende Configs mit `provider` werden automatisch migriert.

`buildChecks` und `mutationCommand` anpassen. Alle anderen Felder haben sinnvolle Defaults.

Beispiele fuer verschiedene Stacks:

| Stack | buildChecks | mutationCommand |
|-------|------------|-----------------|
| Java/Maven | `["mvn verify"]` | `"mvn org.pitest:pitest-maven:mutationCoverage"` |
| Node/npm | `["npm test", "npm run build"]` | `""` |
| Python | `["pytest", "python -m build"]` | `""` |
| Go | `["go test ./...", "go build ./..."]` | `""` |

---

## Pflichtchecks vor Push (Schritt 6)

Alle `buildChecks` aus der Config laufen gruen. Rote Checks blockieren den Push mechanisch.
Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen.
Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen.

---

## Issue-Format (Vier Abschnitte)

```markdown
## Kontext
Warum wird diese Aufgabe gemacht?

## Aufgabe
Was konkret ist zu tun?

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist?
Portabilitaets-Konvention: Wenn eine Datei als eigenstaendig portabel gedacht ist (Installer, kopierbares Script), muss hier stehen: "lauffaehig ohne weiteren Repo-Kontext".

## Abhaengigkeiten
Keine. (oder: Issue #N muss vorher fertig sein)
```

Abhaengigkeits-Konvention: exakt "Keine." oder explizite Referenzen der Form `Issue #N`.
Freitext zusaetzlich erlaubt, aber die `#N`-Referenz ist Pflicht, wenn ein anderes Issue
gemeint ist — der Nacht-Runner (`kit/night.mjs`) wertet nur `#N`-Referenzen aus.
Fremde Repos als `owner/repo#N` referenzieren (zaehlt nicht als lokales Issue).

---

## Abschlussbericht-Format

```
### Aenderungen
- `Datei` — kurze Beschreibung der Wirkung

### Tests und Checks
- <Kommando> -> <Ergebnis>

### Hinweise
- <Restrisiken, offene Punkte, manuelle Folgeschritte>
```

---

## Prioritaeten bei Zielkonflikten

1. Sicherheit
2. Korrektheit
3. Datenintegritaet
4. Accessibility
5. Wartbarkeit
6. Performance
7. Visuelle Praeferenz
8. Bequemlichkeit der Implementierung

---

## KI-Retro (alle 1-2 Wochen)

`/retro` startet die KI-Retrospektive. Drei Fragen:
- Wo hat die Mensch-KI-Zusammenarbeit gehakt?
- Welche Memory-Eintraege sind veraltet?
- Welche Workflow-Regel braucht eine Schaerfung?

Output: konkrete Aenderungen an Memory-Dateien und CLAUDE*.md-Dateien.
