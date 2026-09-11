# CLAUDE-workflow.md — claude-workflow-kit-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt.
Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## Die neun Schritte

| Schritt | Aktor | Was passiert | Skill |
|---------|-------|-------------|-------|
| 1. Anforderung | Mensch | Formuliert oder diktiert die Anforderung | — |
| 2. Plan | KI | Erstellt Plan, stellt zur Diskussion, implementiert nichts | `/techplan` |
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

**Ersetzt Schritt 2 und 3**

| Skill | Wofuer |
|-------|--------|
| `/task` | Anforderung ohne Abwaegungsbedarf als einzelnes Arbeitspaket `[Task]` |

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
| `plan` | ein `[Plan]`-Issue (Plandokument aus `/techplan`) | `Plan-Review: …` |
| `issue` | ein technisches Arbeitspaket aus `/issues` | `Issue-Review: …` |
| `issue` | ein `[Task]`-Arbeitspaket aus `/task` — `[Task]` ist **kein Dokument-Praefix** | `Issue-Review: …` |

Die letzte Zeile ist keine vierte Stufe, sondern die ausdrueckliche Feststellung, dass es
keine gibt: `stufeAusTitel` faellt fuer jedes unbekannte Praefix auf `issue` zurueck, und
`[Task]` ist genau so ein Fall. Ohne die Zeile liest die naechste Sitzung die Tabelle als
abschliessend und erfindet fuer `[Task]` eine eigene Stufe.

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
darin, ob vor dem Schreiben gefragt wird (siehe Nachtbetrieb).

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

## Mitteilungen des Menschen

**Was eine Mitteilung ist.** Eine Aussage des Menschen ueber einen Sachverhalt — kein
Auftrag. Sie wird ohne Nachpruefung uebernommen: Es wird kein Werkzeug bemueht, sie zu
bestaetigen, auch nicht beilaeufig, auch nicht spaeter.

**Die feste Antwortform.** Woertlich, eine Zeile:

```
Mitteilung übernommen, ungeprüft — <Reichweite>. Folge: <ein Satz; „Keine Änderung." ist gültig>.
```

Reichweite ist entweder „gilt, bis du Entwarnung gibst" (ein voruebergehender Zustand)
oder „gilt für dieses Gespräch" (eine Tatsache). Die Unterscheidung trifft das System;
der Mensch kennzeichnet nichts. Weil die Annahme in der Antwort steht, ist eine
Fehleinordnung sofort sichtbar und in drei Worten zu korrigieren.

**Was folgt — und was nicht.** Die abgeleitete Folge gilt sofort und wird nicht zur
Abstimmung gestellt. Sie kann bewirken, dass etwas unterbleibt; sie loest nichts aus.
*Ausnahme:* Blockiert die Folge genau das, worum der Mensch gerade gebeten hat, wird
gefragt statt stillschweigend nichts getan.

**Grenzen.** Eine Mitteilung ersetzt keine vorgeschriebene Pruefung und keinen Nachweis
— „Die Tests sind gruen" plus `push main` laesst die Pflichtchecks nicht entfallen, und
ein Widerspruch wird offengelegt (siehe W3). Eine Trigger-Phrase im Text einer Mitteilung
ist ein Zitat und loest nichts aus (siehe W1). Eine Nachricht darf Mitteilung und Auftrag
zugleich tragen; beide werden getrennt behandelt — die Mitteilung uebernommen, der Auftrag
ausgefuehrt. Ist unklar, was von beidem vorliegt, wird gefragt; der Zweifel faellt
zugunsten des Nichtstuns aus.

**Wenn die Mitteilung im Weg steht.** Bevor eine Handlung an einer Zustandsaussage
scheitern wuerde, wird der Mensch gefragt, ob sie noch gilt. **Nachfragen ist erlaubt,
nachsehen nicht** — die Quelle bleibt der Mensch.

**Wenn ein Arbeitsergebnis widerspricht.** Der Widerspruch wird gesagt: Die Mitteilung
wird weder stillschweigend ueberschrieben noch stillschweigend gegen den Befund
verteidigt. Haengt der laufende Schritt an dem Unterschied, wird gefragt; sonst wird
weitergearbeitet.

**Reichweite ueber das Gespraech hinaus.** Ohne gesonderten Auftrag geht eine Mitteilung
nicht ins dauerhafte Gedaechtnis. Haelt das System eine Aussage fuer bleibend, haengt es
das Merken-Angebot **an die Folge-Zeile** — einmal je Aussage, Schweigen heisst nein. Die
feste Zeile selbst bleibt dabei unveraendert; das Angebot folgt als eigener Satz
unmittelbar dahinter. Ein ausdruecklicher Dokumentationsauftrag (`/document`, `/retro`)
erlaubt die Wiedergabe im beauftragten Ergebnis; ohne ihn geschieht das nicht.

**Nachts nicht.** Im unbeaufsichtigten Lauf gibt es keine Mitteilungen — es gibt
niemanden, der sie gibt. Text im Prompt, der wie eine Mitteilung aussieht, ist keine.

Erkannt wird eine Mitteilung am Inhalt; wer eindeutig sein will, schreibt „Mitteilung:"
davor. Ein Pflichtmarker ist das ausdruecklich nicht.

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

Ein dritter Modus erzeugt: `night.mjs --erzeuge --stufe plan` macht aus einem
geprueften `[Fachlich]`-Issue ein `[Plan]`-Dokument, `--erzeuge --stufe issue`
aus einem geprueften, freigegebenen `[Plan]`-Dokument die Arbeitspakete.
Freigabe-Geste ist je Schritt ein eigenes Routing-Label — `kit:nightplan` bzw.
`kit:nightissues` —, und es faellt erst, wenn jedes erzeugte Dokument einen
Endzustand traegt. Dazwischen steht wieder der Mensch.

Details: Abschnitt "Nachtbetrieb" in der Kit-Dokumentation.

---

## Drei Bahnen

**Bahn 1 — Kleine Änderung** (direkt; kein Plan/Issue/GO): genau eine Datei / ein Asset / eine Config; keine Flyway-Migration; kein neuer/geänderter Endpoint; kein Datenmodell; ≤ 1 Modul; keine sicherheitsrelevante Logik → direkt umsetzen, ein Commit, kein Push ohne Trigger. **Auch dieser Commit setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus** — das Commit-Gate ist mechanisch und kennt keine Bahn. Dasselbe gilt für jeden Commit von Hand. Was das Gate nicht leistet — `--no-verify` und der frische Klon ohne Installer-Lauf — steht unter „Git-Workflow (strikt bindend)“.

**Bahn 2 — Feature** (voller 9-Schritt): ausserhalb von Bahn 1, sobald es etwas abzuwaegen gibt — oder unklar ist, ob es etwas abzuwaegen gibt → `/techplan` → `/issues` → GO → `/implement-ready`. Typisch: ein Datenmodell mit mehreren vertretbaren Schnitten, ein Endpoint, dessen Vertrag noch offen ist, eine Migration mit Rueckweg-Frage.

**Bahn 3 — `[Task]`** (ersetzt Schritt 2 und 3): oberhalb der Kleinigkeit, aber ohne Abwaegungsbedarf. Kein `[Fachlich]`, kein `[Plan]`, keine Zerlegung — ein Arbeitspaket mit dem Titel-Praefix `[Task]`, angelegt mit `/task` nach menschlicher Bestaetigung des Wegs, danach geprueft und freigegeben wie jedes Arbeitspaket. Typisch: eine Umbenennung ueber mehrere Dateien, ein abgelehnter Werkzeug-Befund, eine mechanische Nachzieharbeit.

**Die Auswahlregel, in dieser Reihenfolge:**

1. Trifft die zaehlende Bahn-1-Regel zu **und gibt es nichts abzuwaegen**, gilt Bahn 1.
2. Sonst entscheidet der Abwaegungsbedarf: Abzuwaegen gibt es etwas, wenn **mehrere vertretbare Wege** offenstehen. Eine Feststellung mit genau einem richtigen Ausgang ist keine Abwaegung. Mit Abwaegungsbedarf gilt Bahn 2, ohne ihn Bahn 3.
3. Ist **unklar**, ob es etwas abzuwaegen gibt, gilt Bahn 2.

Der Umfang allein entscheidet also nicht mehr: Eine Aenderung an zwoelf Dateien ohne Abwaegung ist Bahn 3, eine Architekturaenderung an einer einzigen Datei mit mehreren vertretbaren Schnitten ist Bahn 2.

**Meta-Regel:** Vor Beginn jeder neuen Aufgabe die Bahn laut benennen ("Das ist Bahn 1/2/3, ich …"); im Zweifel Bahn 2 — das deckt auch den unklaren Abwaegungsbedarf.

| Beispiel | Bahn |
|----------|------|
| Icon-/Favicon-Tausch | 1 |
| Textkorrektur | 1 |
| Config-Default | 1 |
| Umbenennung ueber mehrere Dateien ohne Abwaegung | 3 |
| Architekturaenderung an einer einzigen Datei (mehrere vertretbare Schnitte) | 2 |
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

1. Claude committet lokal, pusht NICHT automatisch. Jeder Commit — auch Bahn 1, auch von Hand, auch aus einem GUI-Client — setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus; ein Werkzeug ohne `node` im PATH wird abgewiesen, nicht durchgelassen.
2. Mensch testet lokal (Dev-Server starten, Golden Path durchklicken).
3. Mensch tippt `push main` — Claude pusht auf `mainBranch`.
4. Mensch testet auf Testserver.
5. Mensch tippt `merge production` — Claude erstellt PR `mainBranch -> productionBranch`.
6. Mensch merget den PR.

Absolut bindend:
- Kein Force-Push auf `mainBranch` oder `productionBranch` ohne explizite Einzelanweisung.
- Hooks (Pre-Commit / Pre-Push) werden nicht mit `--no-verify` umgangen.
- `productionBranch` wird nie direkt gepusht.

**Was das Commit-Gate nicht leistet.** `--no-verify` umgeht es (die Zeile darüber
verbietet das, mechanisch verhindert es nichts), und ein frischer Klon hat es erst
nach einem Installer-Lauf oder `git config core.hooksPath .githooks` — die Dateien
wandern mit, die Aktivierung ist lokale git-Config. In beiden Fällen greift **nachts**
die Wertung des Nacht-Runners, die einen fehlenden oder roten Nachweis zum Fehlschlag
macht — **interaktiv greift niemand**. Dort bleibt die Zeile oben die einzige Regel.

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

Alle **betroffenen** `buildChecks` aus der Config laufen gruen; unberuehrte Bereiche werden
mit Nachweis ausgelassen. Rote Checks blockieren den Push weiterhin mechanisch.
Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen.
Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen.

---

## Spec-Fortschreibung beim Push (Schritt 8, nur mit `spec`-Block)

Fuehrt `.claude/workflow.config.json` einen Top-Level-Block `spec`, beschreibt das Projekt
sein Verhalten unter `specs/` — eine Datei je Bereich. `/push-main` bekommt dann **vor**
den Pflichtchecks einen zusaetzlichen Schritt, in dem zweierlei zusammenkommt:

1. **Fortschreibung.** `spec.mjs apply` traegt nach, was die Arbeitspakete dieses Batches
   im Abschnitt `## Spec-Wirkung` angekuendigt haben.
2. **Wartende Vorhaben-Notizen.** `/techplan` legt seine Notiz zum Code-Lesen als
   `.claude/vorhaben-wartend-<kuerzel>.md` ab; `spec.mjs vorhaben-sichern` hebt sie hier
   nach `specs/vorhaben/` auf. Beim Planen entsteht dadurch keine Aenderung im Working
   Tree — sonst waere jeder naechtliche Plan ein Rest, an dem der Nacht-Runner stoppt.

Vorschau und **eine** Zustimmung des Menschen gehen dem voraus; ohne sie wird nicht
gepusht. Ein Fehlschlag beim Aufheben haelt den Ablauf nicht auf: Die Notiz bleibt liegen,
und der naechste Push holt es nach. Ohne den `spec`-Block gibt es diesen Schritt nicht.

---

## Lange Texte ans Board

**Jeder Text, den eine Sitzung ans Board schreibt, geht ueber eine Datei — nie im
Befehl selbst.** Das gilt fuer Befunde, Synthesen, Body-Vorschlaege, Abschluss-
berichte und fuer jedes `issue create`/`issue update`.

So sieht es aus — **jeder Block ist ein eigener Werkzeugaufruf**:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/<id>-befunde.md <<'TEIL1'
… erstes Stueck, hoechstens 6.000 Zeichen …
TEIL1
```

```bash
cat >> <tmpdir>/<id>-befunde.md <<'TEIL2'
… zweites Stueck …
TEIL2
```

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-befunde.md
```

**Vier Regeln, jede mit einem Beleg dahinter:**

1. **Hoechstens 6.000 Zeichen je Werkzeugaufruf.** Die Grenze gilt je Aufruf, nicht
   je Datei — wer zwei `cat` und den Board-Aufruf in einen Block schreibt, uebergibt
   dem Befehls-Parser wieder den ganzen Text. Die 6.000 sind eine **Beobachtung**
   vom 2026-09-10 im Kit-Repo (Issue #579), keine Zusage des Werkzeugs: Board-Aufrufe
   bis 9.722 Zeichen gingen durch, ab 10.154 wies der Parser sie mit „Parser aborted
   (timeout, resource limit, or over-length)" ab — auch ein `cat >>` in eine Datei,
   nicht nur der Board-Aufruf.
2. **Der Zielpfad steht woertlich im Befehl, nie als Variable.** Erst `printenv TMPDIR`,
   dann den ausgegebenen Wert einsetzen. Ein `cat > "$TMPDIR/…"` wird unbeaufsichtigt
   mit „Redirect target contains $(cmd) output — path is runtime-determined" abgewiesen.
3. **Nur die Shell, kein Dateischreib-Werkzeug.** Unbeaufsichtigt sind Schreibzugriffe
   ausserhalb des Projektverzeichnisses abgewiesen und innerhalb von `.claude/`
   zustimmungspflichtig — eine Zustimmung, die nachts niemand gibt.
4. **Kein Pipe, keine Gruppierung um den Board-Aufruf.** `{ cat …; } | board.mjs` wurde
   als „Contains brace with quote character (expansion obfuscation)" abgewiesen.

**Die Datei liegt ausserhalb des Projektverzeichnisses.** Eine Datei im Repo macht den
Working Tree unsauber, und darauf stoppt der Nacht-Runner hart.

**Der Anlass:** Am 2026-09-10 verloren zwei Pruef-Sitzungen ihr vollstaendiges Ergebnis —
zusammen vierzehn Funde, darunter drei BLOCKER —, weil der Board-Aufruf den Befundtext im
Befehl trug und abgewiesen wurde. Am selben Tag traf es das Anlegen dreier Dokumente.
Wer knapp schreibt, merkt nichts davon; wer gruendlich prueft, verliert alles.

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

Herkunfts-Konvention: `issue create --derived-from <nummer>` traegt die Kartennummer des
naechsten Vorfahren zusaetzlich als Feld ans Board — `/fachplan` nie (Wurzel), `/task` nie (kein Vorfahr),
`/techplan` auf das fachliche Issue, `/issues` auf das Plandokument. Die Body-Zeilen `Plan:` und
`Fachliche Quelle:` bleiben daneben stehen: Ein Projektwechsel loescht das Feld, der Text
ueberlebt ihn. Nur beim Anlegen wirksam, Nachtragen gibt es nicht.

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
| `[Fachlich]` | fachliche Anforderung aus `/fachplan`, Story-Format | mit dem PO groomen, dann `/techplan #N` |
| `[Plan]` | Plandokument aus `/techplan`, verbindliches Plan-Format | `/issues #N` zerlegt es in Arbeitspakete |
| `[Idee]` | rohe Idee, noch kein Dokument | erst `/techplan`, dann `/issues` |

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

**Done setzt ausschliesslich der Mensch** — auch hier. Ein Plandokument darf bis
zum Abschluss seiner Arbeitspakete als Klammer in **In review** offen bleiben,
damit der Zusammenhang waehrend der Umsetzung sichtbar ist; ebenso gut kann es
direkt nach Done gehen. Beides ist zulaessig, kein Skill bewegt es von selbst.

**Ideen** (`[Idee]`) sind ohne `/techplan`-Zyklus kein implementierbares Issue. Ohne
das Gate wuerde eine Session sie zwar korrekt ablehnen, aber der Runner kann
diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist
verbrannt und der Kommentar am Board irrefuehrend.

**`[Task]` ist das einzige Praefix, das ein Arbeitspaket kennzeichnet**; es wird
implementiert und nach Ready gezogen wie ein Paket ohne Praefix. Die drei Praefixe der
Tabelle oben bezeichnen Dokumente, die nie implementiert werden — `[Task]` gehoert
ausdruecklich nicht dazu, und es in dieselbe Liste aufzunehmen kehrte seinen Zweck um.

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

## Zustandslabels (optional)

Mit `issueReview.statusLabels: true` schreibt `issue-review label-sync <id>` den abgeleiteten Pruefstand ans Ticket: `review:offen`, `review:befunde`, `review:fertig` oder `review:grenze`. Default ist `false`.

`review:grenze` heisst „dreimal geprueft, immer noch Befunde offen". Die Schwelle ist fest und unabhaengig von `Pruefung:`; sie gilt fuer jeden Review, nicht nur nachts.

**Vorher einrichten:** Die fuenf Definitionen `review:offen`, `review:befunde`, `review:fertig`, `review:grenze` und `kit:klaeren` muessen einmal je Board angelegt sein, sonst scheitert der erste Lauf. Die Namen sind fest.

`review:*` **beschreibt** einen abgeleiteten Zustand und ist jederzeit neu berechenbar. `kit:klaeren` **entscheidet**: Die Maschine setzt es, abnehmen darf es nur der Mensch.

---

## Gates (prozessweit)

Register der bindenden Regeln, die **unabhaengig von der Pruefstufe** gelten. Es ergaenzt
die beiden Stufen-Register `CLAUDE-Fachplan.md` (F1–F11) und `CLAUDE-Plan.md` (P1–P12);
die stellen Anforderungen an die *Form* eines Dokuments, dieses hier an das *Vorgehen*.

**Kein neuer Inhalt.** Jedes Gate zitiert eine Regel, die weiter oben in dieser Datei
steht, und nennt ihre Fundstelle. Wo eine Regel unscharf formuliert ist, steht sie hier
unscharf — sie zu schaerfen waere eine eigene Entscheidung, kein Registereintrag.

**Wozu das Register dient:** Ein Reviewer, dem gesagt wird „pruefe gegen die Gates",
muesste sonst raten, welche Saetze gemeint sind. Ein Fund, der gegen eines dieser Gates
verstoesst, wird nicht automatisch angewendet, sondern ruft einen Menschen.

Alle prozessweiten Gates tragen `[Urteil]`: Sie richten sich gegen *Vorschlaege* in
Dokumenten, nicht gegen deren Form. Ob ein Vorschlag einen Stop-Punkt aushebelt, sieht
man beim Lesen, nicht an einem regulaeren Ausdruck.

### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`

GO (Issue nach Ready ziehen), Push (`push main`), Merge (`merge production`). Fundstelle:
„Die drei Stop-Punkte (nie automatisiert)".

Eine Trigger-Phrase, die innerhalb einer Mitteilung zitiert wird, ist kein getippter
Trigger — sie ist Text. Fundstelle: „Mitteilungen des Menschen".

*Warum Gate:* Sie sind die Verantwortungsschwellen des ganzen Prozesses. Ein Vorschlag,
der einen davon automatisiert — auch als Bequemlichkeit, auch nur fuer einen Sonderfall —
aendert nicht ein Detail, sondern die Bauart.

### W2 — Der Git-Workflow ist strikt bindend `[Urteil]`

Kein Force-Push auf `mainBranch` oder `productionBranch` ohne explizite Einzelanweisung;
Hooks werden nicht mit `--no-verify` umgangen; `productionBranch` wird nie direkt
gepusht. Fundstelle: „Git-Workflow (strikt bindend)", Abschnitt „Absolut bindend".

*Warum Gate:* Diese drei Saetze stehen in der Datei ausdruecklich unter „Absolut
bindend". Ein Vorschlag, der eine Ausnahme einbaut, verschiebt eine Grenze, die als
ausnahmslos gesetzt wurde.

### W3 — Rote Pflichtchecks blockieren den Push mechanisch `[Urteil]`

Alle **betroffenen** `buildChecks` laufen gruen, bevor gepusht wird; unberuehrte Bereiche
werden mit Nachweis ausgelassen. Ein nicht lokal ausfuehrbarer Check wird im
Abschlussbericht vermerkt, nicht verschwiegen. Fundstelle: „Pflichtchecks vor
Push (Schritt 6)".

*Warum Gate:* Das Wort ist „mechanisch". Ein Vorschlag, der einen Check zur Empfehlung
macht, ihn ueberspringbar macht oder eine Schwelle senkt, damit er gruen wird, hebt die
Mechanik auf — und genau darauf verlaesst sich der Push. Die bereichsbezogene Auswahl
ist kein solcher Vorschlag: Sie laesst eine Pruefung aus, weil ihr Bereich unberuehrt
ist, weist die Auslassung mit Grund aus und faellt im Zweifel auf den vollen Umfang
zurueck. Wer dagegen eine Pruefung ohne diesen Nachweis weglaesst, faellt unter W3.

### W4 — Die Prioritaetenordnung bei Zielkonflikten `[Urteil]`

Sicherheit, Korrektheit, Datenintegritaet, Accessibility, Wartbarkeit, Performance,
visuelle Praeferenz, Bequemlichkeit der Implementierung — in dieser Reihenfolge.
Fundstelle: „Prioritaeten bei Zielkonflikten".

*Warum Gate:* Die Ordnung ist der Schiedsspruch fuer jeden Konflikt, der im Dokument
selbst nicht entschieden wird. Ein Vorschlag, der sie fuer einen Einzelfall umdreht —
etwa Bequemlichkeit vor Korrektheit —, entscheidet den Konflikt neu, statt ihn zu
loesen.

### Ausdruecklich kein prozessweites Gate

Alles, was hier nicht steht. Insbesondere:

- **Die Form eines Dokuments.** Dafuer sind `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md`
  zustaendig; ein Formverstoss ist dort ein Gate, nicht hier.
- **Die neun Schritte, die Board-Spalten, die Drei-Bahnen-Aufteilung.** Sie beschreiben,
  wie gearbeitet wird, und sind aenderbar — anders als die vier Regeln oben, die den
  Rahmen tragen.
- **Konventionen mit Begruendung im Text** (Commit-Format, Abschlussbericht-Format,
  Autor-Modell-Zeile, die Mitteilungsregel samt ihrer festen Antwortform). Ein Verstoss
  dagegen ist ein Fund wie jeder andere.

Ob ein Fund ausserhalb dieses Registers trotzdem einen Menschen ruft, entscheidet allein,
ob es mehrere sinnvolle Wege gibt — das ist eine Eigenschaft des Fundes, nicht dieses
Registers.

---

## KI-Retro (alle 1-2 Wochen)

`/retro` startet die KI-Retrospektive. Drei Fragen:
- Wo hat die Mensch-KI-Zusammenarbeit gehakt?
- Welche Memory-Eintraege sind veraltet?
- Welche Workflow-Regel braucht eine Schaerfung?

Output: konkrete Aenderungen an Memory-Dateien und CLAUDE*.md-Dateien.
