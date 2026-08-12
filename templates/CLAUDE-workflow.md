# CLAUDE-workflow.md — claude-workflow-kit-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt.
Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## Die neun Schritte

| Schritt | Aktor | Was passiert | Skill |
|---------|-------|-------------|-------|
| 1. Anforderung | Mensch | Formuliert oder diktiert die Anforderung | — |
| 2. Plan | KI | Erstellt Plan, stellt zur Diskussion, implementiert nichts | `/plan` |
| 3. Plan zu Issues | KI | Uebertraegt Plan in Issues (Vier-Abschnitt-Format) | `/issues` |
| 4. GO | Mensch | Zieht Issues nach Ready — das ist das GO | — |
| 5. Implementierung | KI | Arbeitet Ready-Issues sequenziell ab, committet lokal | `/implement-ready` |
| 6. Lokale Pruefung | KI + Mensch | Pflicht-Checks + manuelle UI-Verifikation | `/local-check` |
| 7. Code-Review | KI | Startet Opus-Reviewer in frischer Session | `/review` |
| 8. Push | Mensch | Tippt `push main` — Claude pusht den Batch | `/push-main` |
| 9. Merge | Mensch | Tippt `merge production` — Claude erstellt PR | `/merge-production` |

---

## Werkzeuge neben dem Prozess

Die neun Schritte oben sind der Prozess aus dem Whitepaper. Was hier steht, ist Werkzeug des Kits: hilfreich, oft benutzt — aber **ohne diese Skills laeuft der Prozess auch**. Sie tragen deshalb keine Nummer; eine Nummer wuerde eine Reihenfolge und eine Pflicht behaupten, die es nicht gibt.

Diese Grenze ist der Grund, warum die Tabelle oben neun Zeilen hat und nicht zwoelf. Wer den naechsten nuetzlichen Skill baut, traegt ihn hier ein — nicht als Zwischennummer.

**Ergaenzen den Prozess**

| Skill | Wofuer |
|-------|--------|
| `/kontext` | Session-Start: Memory-Vault laden, Projektstand holen |
| `/fachplan` | Anforderung als fachliches Issue zum Groomen mit dem PO |
| `/issue-review` | fachliche Anforderung, Plandokument **oder** Arbeitspaket pruefen lassen — ein Kommando, drei Stufen |
| `/retro` | KI-Retrospektive, Memory konsolidieren |
| `/document` | Session-Ende: Tageslog und Projektnotiz schreiben |

**Ersetzen Schritt 5 durch eine feinere Gangart**

| Skill | Wofuer |
|-------|--------|
| `/implement-next` | genau ein Ready-Issue statt der ganzen Spalte |
| `/implement-test` | nur die roten Tests, Stopp vor der Implementierung |
| `/implement-done` | Implementierung gegen die vorbereiteten roten Tests |

---

## Die drei Stop-Punkte (nie automatisiert)

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet.
2. **Push (Schritt 8):** Trigger-Phrase `push main`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase `merge production`. Claude merged nicht.

Diese drei Schritte sind die Verantwortungsschwellen. Sie bleiben menschlich und tippbar.

Vor dem GO gehoert ein Dokument geprueft: `/issue-review` laesst es von Modellen
lesen, die es nicht geschrieben haben. Wie viele das sind, entscheidet die
Pruefstufe (siehe unten): fachliche Anforderung und Plandokument je zwei, das
Arbeitspaket eines. Bei gesetztem `issueReview.requiredBeforeReady` stellt der
Nacht-Runner ungepruefte Ready-Issues zurueck.

### Die drei Pruefstufen

Der Skill prueft drei verschiedene Dokumente. Welche Stufe greift, entscheidet
das Titel-Praefix; jede Stufe hinterlaesst ihren eigenen Nachweis:

| Stufe | Prueft | Nachweis |
|-------|--------|----------|
| `fachlich` | ein `[Fachlich]`-Issue (fachliche Anforderung aus `/fachplan`) | `Fachplan-Review: …` |
| `plan` | ein `[Plan]`-Issue (Plandokument aus `/plan`) | `Plan-Review: …` |
| `issue` | ein technisches Arbeitspaket aus `/issues` | `Issue-Review: …` |

**Wo der Nachweis steht**, richtet sich nach dem Format des Dokuments. Nur das
Arbeitspaket hat einen `## Kontext`; Story- und Plan-Format fuehren ihre
Kennzeichnungszeilen anderswo, und der Marker stellt sich dazu:

| Dokument | Ort des Markers |
|----------|-----------------|
| Arbeitspaket | im Abschnitt `## Kontext` |
| fachliche Anforderung | im Abschnitt `## Ziel`, unmittelbar bei `Autor-Modell:` |
| Plandokument | vor `## Ziel`, unmittelbar bei `Plan-Modell:` und ggf. `Fachliche Quelle:` |

Die Reihenfolge der vorhandenen Kennzeichnungszeilen bleibt dabei unveraendert.

**Der Aufruf ist immer derselbe: `/issue-review #N`.** Es gibt kein eigenes
Kommando je Stufe — welche greift, liest der Skill am Titel-Praefix ab. Das gilt
**interaktiv genauso wie im Nachtbetrieb**: Ein `[Plan]`-Issue laesst sich
jederzeit tagsueber pruefen, es muss nicht auf einen Nachtlauf warten. Der
Unterschied zwischen beiden Betriebsarten liegt nicht in der Stufenwahl, sondern
darin, ob der Body geschrieben werden darf (siehe Nachtbetrieb).

**Nur eine nicht leere Zeile `Issue-Review:` gibt die Umsetzung frei.**
`Fachplan-Review:` und `Plan-Review:` ersetzen sie nie — sie belegen die Pruefung
einer frueheren Stufe, nicht die des Arbeitspakets. Wer sie verwechselt, zieht ein
ungepruefte Arbeitspaket nach Ready.

Die Pruefung frueh anzusetzen ist billiger: Ein Fehler in der fachlichen
Anforderung pflanzt sich in den Plan, in jedes Arbeitspaket und in allen Code
fort. Deshalb tragen die oberen Stufen je zwei Pruefer, das einzelne
Arbeitspaket nur noch einen — Zuschnitt und Abhaengigkeiten entscheiden sich im
Plan und werden dort geprueft.

---

## Nachtbetrieb (optional)

Der Nacht-Runner (`node .claude/kit/night.mjs`) arbeitet die Ready-Spalte unbeaufsichtigt ab:
pro Issue eine frische Headless-Session mit `/implement-next #N` (das Issue wird verbindlich
uebergeben, genau eins, dann Ende).
Erfolg wird am Board gemessen (Issue in In review); Fehlschlaege wandern kommentiert ins
Backlog, bei unsauberem Working Tree stoppt der Lauf hart. Die Stop-Punkte gelten
unveraendert: nachts wird committet, nie gepusht — Review, Test und `push main` passieren
morgens durch den Menschen.

Ein zweiter Modus implementiert nicht, sondern laesst pruefen: `night.mjs --review`
schickt **Backlog**-Dokumente durch `/issue-review`. Zwischen beiden Naechten steht das
menschliche GO — deshalb sind es zwei Laeufe an zwei Abenden und nicht zwei Phasen in
einer Nacht.

**Ein Aufruf, eine Stufe.** `--stufe <fachlich|plan|issue>` waehlt, welche
Pruefstufe der Lauf faehrt; andere Werte weist der Runner ab. Ohne Angabe gilt
`issue`. Mehrere Stufen in einem Lauf gaebe es nicht, weil zwischen ihnen die
menschliche Freigabe steht: Wer den Plan noch nicht abgenommen hat, will die
Arbeitspakete daraus nicht schon geprueft haben.

Details: Abschnitt "Nachtbetrieb" in der Kit-Dokumentation.

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
`issueTracker` steuert Issues und Board (github | gitlab | local | toolbox).
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

### Wie viel geprueft wird: zwei Zeilen im Kontext

Der Kontext-Abschnitt kann festlegen, wie umfangreich das Issue vor dem GO
geprueft wird. Zwei Zeilen gehoeren dazu — und nur eine davon schreibt der Mensch
selbst:

- `Pruefung: <1|2|3|Verzicht>` — **setzt der Mensch**, im Kontext-Abschnitt.
  Die Zahl ist die Zahl der Review-Runden, `Verzicht` heisst: bewusst ohne
  Pruefung freigegeben. Ohne die Zeile gilt der Regelfall aus
  `issueReview.rounds`.
- `Pruefung-Stand: <hex>` — **maschinell gepflegt**, von `issue update` unter die
  Vorgabezeile geschrieben. Nie von Hand anfassen: Wer sie aendert, laesst die
  eigene Vorgabe verfallen.

Eine **Verringerung** — `Verzicht` oder ein Wert unterhalb des Regelfalls — setzt
nur der Mensch. Ein unbeaufsichtigter Lauf (gesetztes `KIT_AGENT_MODEL`, also der
Nacht-Runner) wird dabei abgewiesen; er vergibt sich die Pruefung nie selbst.
Erhoehungen sind immer erlaubt.

Eine **inhaltliche Aenderung** — an Aufgabe, Akzeptanzkriterium oder
Abhaengigkeiten — laesst die Vorgabe verfallen; danach gilt wieder der Regelfall,
bis der Mensch neu entscheidet. Der Kontext-Abschnitt zaehlt dabei bewusst nicht
mit, denn dort stehen die Kennzeichnungszeilen selbst.

### Drei Titel-Praefixe, drei Sonderfaelle

Ein Issue ohne Praefix ist ein Arbeitspaket im Vier-Abschnitt-Format oben. Drei
Praefixe kennzeichnen Dokumente, die **nie implementiert und nie nach Ready
gezogen** werden; implement-Skills und Nacht-Runner stellen sie mechanisch
kommentiert ins Backlog zurueck, ohne eine Session zu starten.

| Praefix | Was es ist | Weg nach vorn |
|---------|-----------|---------------|
| `[Fachlich]` | fachliche Anforderung aus `/fachplan`, Story-Format | mit dem PO groomen, dann `/plan #N` |
| `[Plan]` | Plandokument aus `/plan`, verbindliches Plan-Format | `/issues #N` zerlegt es in Arbeitspakete |
| `[Idee]` | rohe Idee, noch kein Dokument | erst `/plan`, dann `/issues` |

**Fachliche Issues** (`[Fachlich]`) tragen Story-Format statt Vier-Abschnitt: Ziel,
Fachliche Akzeptanzkriterien, Nicht-Ziele, Offene Fragen an den PO. Sie werden im
Body gegroomt. Technische Issues daraus tragen den Rueckverweis
"Fachliche Quelle: Issue #N" im Kontext-Abschnitt — NIE im
Abhaengigkeiten-Abschnitt (der Nacht-Runner wuerde die Referenz sonst als
dauerhaft unerfuellte Abhaengigkeit werten).

**Plandokumente** (`[Plan]`) halten den freigegebenen Stand fest, statt ihn
umzusetzen. Ein Plan beschreibt einen Weg, er ist keine Aufgabe: Er wird
**nie implementiert**, geht **nie nach Ready** und wird zuerst mit `/issues #N`
in Arbeitspakete zerlegt. Sein Format ist verbindlich — genau diese sechs
Ueberschriften in dieser Reihenfolge:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

Leere Pflichtabschnitte werden ausdruecklich mit `- Keine.` ausgewiesen. Das
Format ist zugleich der Maszstab der Pruefstufe `plan`: Ohne festgelegte Form
kann ein Pruefer nur Geschmack aeussern.

**Ideen** (`[Idee]`) sind ohne `/plan`-Zyklus kein implementierbares Issue. Ohne
das Gate wuerde eine Session sie zwar korrekt ablehnen, aber der Runner kann
diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist
verbrannt und der Kommentar am Board irrefuehrend.

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
