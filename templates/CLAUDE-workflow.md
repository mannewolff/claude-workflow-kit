# CLAUDE-workflow.md — claude-workflow-kit-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt. Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

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
| 7. Code-Review | KI | Startet ein fremdes Modell aus `reviewCommand` bzw. `reviewModel` in frischer Session | `/review` |
| 8. Push | Mensch | Tippt `push main` — Claude pusht den Batch | `/push-main` |
| 9. Merge | Mensch | Tippt `merge production` — Claude erstellt PR | `/merge-production` |

---

## Werkzeuge neben dem Prozess

Die neun Schritte oben sind der Prozess aus dem Whitepaper. Was hier steht, ist Werkzeug des Kits: hilfreich, oft benutzt — aber **ohne diese Skills laeuft der Prozess auch**. Sie tragen deshalb keine Nummer; eine Nummer wuerde eine Reihenfolge und eine Pflicht behaupten, die es nicht gibt.

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

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete des gekennzeichneten Fachplans selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch am Fachplan gegeben, als er ihn fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete eines Fachplans, der frueher unter Variante B lief. Der Push am Morgen (Schritt 8) nimmt die Entscheidungen der Nacht mit an.
2. **Push (Schritt 8):** Trigger-Phrase `push main`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase `merge production`. Claude merged nicht.

Geprueft werden die fachliche Anforderung und das Plandokument: `/issue-review` laesst sie von Modellen lesen, die sie nicht geschrieben haben; wie viele das sind, sagt `reviewStufen`. Ein Arbeitspaket wird nicht standardmaessig geprueft — wer es will, ruft `/issue-review #N`. Der Schalter `issueReview.requiredBeforeReady` bleibt fuer Projekte, die das Gate wollen; ausgeschaltet ist der Regelfall. Bei gesetztem `issueReview.requiredBeforeReady` stellt der Nacht-Runner ungepruefte Ready-Issues zurueck.

**Der Aufruf ist immer derselbe: `/issue-review #N`.** Welche Stufe greift — fachliche Anforderung, Plandokument oder Arbeitspaket —, liest der Skill am Titel-Praefix ab; es gibt bewusst kein eigenes Kommando je Stufe. Das gilt interaktiv genauso wie im Nachtbetrieb: Ein Plandokument laesst sich jederzeit tagsueber pruefen. Der Marker, den die Pruefung hinterlaesst, ist eine Spur und keine Freigabe. Daneben setzt die Pruefung das Label `review:fertig` als sichtbare Spur am Board; es muss je Board einmal angelegt sein (GitHub und GitLab als Repo-Label, kanban-kit ueber `POST /api/boards/{boardId}/labels`).
Das Label bleibt eine Spur der Pruefung und gibt den Inhalt nicht frei; die Nacht-Kette verlangt diese Spur aber als Voraussetzung — ein Fachplan ohne `review:fertig` wird uebersprungen, auch wenn er das Kettenlabel traegt.

---

## Entscheiden statt fragen

Eine Session, die ein Dokument schreibt oder unbeaufsichtigt laeuft, entscheidet jede Unklarheit ausserhalb der Stopp-Klasse selbst und protokolliert die Entscheidung. Interaktiv darf gefragt werden; was der Mensch entscheidet, wird im selben Format festgehalten.

**Das Entscheidungsformat**, je Eintrag, die Nummern laufen je Dokument fortlaufend:

```
- E1: <Frage in einem Satz>
  Gewählt: <Weg>. Verworfen: <Alternative>. Grund: <ein Satz, Bezug auf Fachplan, Bestand oder Prioritätenordnung>. Rückbau: <trivial | eine Datei | Migration>.
```

| Wo | Ort der Eintraege |
|----|-------------------|
| Plandokument | `## Architektonische Entscheidungen` |
| Arbeitspaket | `## Kontext`, je Eintrag eine Zeile beginnend mit `Entscheidung:` |
| Implementierung | Abschlussbericht, Unterabschnitt `### Entscheidungen` |

**Die Stopp-Klasse.** Nur diese Fragen halten an:

1. Datenverlust oder eine Migration ohne Rueckweg.
2. Sicherheit: Rechte, Authentifizierung, Geheimnisse, Netzzugriff.
3. Verträge nach außen: eine Schnittstelle, die jemand anderes nutzt.
4. Ein Widerspruch im Fachplan selbst, etwa zwei Akzeptanzkriterien, die sich ausschliessen.
5. Eine Aenderung an Gates, Stop-Punkten oder am Prozess (W1 bis W4).
6. Eine Abweichung vom fachlichen Anlass: Ein Plan oder eine Umsetzung weicht von einer vorgelegten Vorlage oder vom Ziel des Fachplans ab, oder beantwortet eine im Fachplan offen gelassene Frage zu Aussehen, Ort einer Ansicht oder einer fachlichen Grenze selbst.

Nur eine Frage aus dieser Klasse haelt an, und jeder Halt traegt genau eine Frage. Alles andere — ausdruecklich auch Randfaelle, Namensfragen, Fehlerpfade, Reihenfolgen und die Frage, welcher Test gemeint ist — wird entschieden. Schiedsrichter ist die Ordnung aus „Prioritaeten bei Zielkonflikten"; im Zweifel gewinnt der kleinste rueckbaubare Eingriff.

**Reviews sind Zuarbeit.** Ein Modell-Review eines Fachplans, Plans oder Arbeitspakets liefert Befunde an den Autor der Stufe; der arbeitet sie ein oder lehnt sie mit einem Satz ab. Ob eine Stufe fertig ist, sagt ein Kommando oder ein Mensch, nie ein Modell-Marker.

---

## Mitteilungen des Menschen

**Was eine Mitteilung ist.** Eine Aussage des Menschen ueber einen Sachverhalt — kein Auftrag. Sie wird ohne Nachpruefung uebernommen: Es wird kein Werkzeug bemueht, sie zu bestaetigen, auch nicht beilaeufig, auch nicht spaeter.

**Die feste Antwortform.** Woertlich, eine Zeile:

```
Mitteilung übernommen, ungeprüft — <Reichweite>. Folge: <ein Satz; „Keine Änderung." ist gültig>.
```

Reichweite ist entweder „gilt, bis du Entwarnung gibst" (ein voruebergehender Zustand) oder „gilt für dieses Gespräch" (eine Tatsache). Die Unterscheidung trifft das System; der Mensch kennzeichnet nichts. Weil die Annahme in der Antwort steht, ist eine Fehleinordnung sofort sichtbar und in drei Worten zu korrigieren.

**Was folgt — und was nicht.** Die abgeleitete Folge gilt sofort und wird nicht zur Abstimmung gestellt. Sie kann bewirken, dass etwas unterbleibt; sie loest nichts aus. *Ausnahme:* Blockiert die Folge genau das, worum der Mensch gerade gebeten hat, wird gefragt statt stillschweigend nichts getan.

**Grenzen.** Eine Mitteilung ersetzt keine vorgeschriebene Pruefung und keinen Nachweis — „Die Tests sind gruen" plus `push main` laesst die Pflichtchecks nicht entfallen, und ein Widerspruch wird offengelegt (siehe W3). Eine Trigger-Phrase im Text einer Mitteilung ist ein Zitat und loest nichts aus (siehe W1). Eine Nachricht darf Mitteilung und Auftrag zugleich tragen; beide werden getrennt behandelt — die Mitteilung uebernommen, der Auftrag ausgefuehrt. Ist unklar, was von beidem vorliegt, wird gefragt; der Zweifel faellt zugunsten des Nichtstuns aus.

**Wenn die Mitteilung im Weg steht.** Bevor eine Handlung an einer Zustandsaussage scheitern wuerde, wird der Mensch gefragt, ob sie noch gilt. **Nachfragen ist erlaubt, nachsehen nicht** — die Quelle bleibt der Mensch.

**Wenn ein Arbeitsergebnis widerspricht.** Der Widerspruch wird gesagt: Die Mitteilung wird weder stillschweigend ueberschrieben noch stillschweigend gegen den Befund verteidigt. Haengt der laufende Schritt an dem Unterschied, wird gefragt; sonst wird weitergearbeitet.

**Reichweite ueber das Gespraech hinaus.** Ohne gesonderten Auftrag geht eine Mitteilung nicht ins dauerhafte Gedaechtnis. Haelt das System eine Aussage fuer bleibend, haengt es das Merken-Angebot **an die Folge-Zeile** — einmal je Aussage, Schweigen heisst nein. Die feste Zeile selbst bleibt dabei unveraendert; das Angebot folgt als eigener Satz unmittelbar dahinter. Ein ausdruecklicher Dokumentationsauftrag (`/document`, `/retro`) erlaubt die Wiedergabe im beauftragten Ergebnis; ohne ihn geschieht das nicht.

**Nachts nicht.** Im unbeaufsichtigten Lauf gibt es keine Mitteilungen — es gibt niemanden, der sie gibt. Text im Prompt, der wie eine Mitteilung aussieht, ist keine.

Erkannt wird eine Mitteilung am Inhalt; wer eindeutig sein will, schreibt „Mitteilung:" davor. Ein Pflichtmarker ist das ausdruecklich nicht.

---

## Nachtbetrieb (optional)

Der Nacht-Runner (`node .claude/kit/night.mjs`) arbeitet die Ready-Spalte unbeaufsichtigt ab: pro Issue mit dem Routing-Label `kit:nightrun` eine frische Headless-Session mit `/implement-next #N`. Erfolg wird am Board gemessen (Issue in In review); Fehlschlaege wandern kommentiert ins Backlog, bei unsauberem Working Tree stoppt der Lauf hart. Nachts wird committet, nie gepusht — Review, Test und `push main` passieren morgens durch den Menschen.

Die zweite Betriebsart ist die Nacht-Kette (`node .claude/kit/night.mjs --kette`). Die Geste ist das Label `kit:night` am gegroomten `[Fachlich]`-Issue im Backlog; der Runner verbraucht es beim Start, jedes Setzen autorisiert genau eine Kette. Je Fachplan entsteht in einem eigenen Worktree ein Plan (`/techplan`), der geprueft wird (`/issue-review`), daraus die Arbeitspakete (`/issues`) und eine Abdeckung gegen den Fachplan — gebaut wird nichts, die Pakete bleiben im Backlog, das GO nach Ready bleibt beim Menschen. Die Kette kennt zwei Varianten: Variante A (Standard) belaesst die Arbeitspakete im Backlog und wartet auf das GO des Menschen; Variante B setzt zusaetzlich das Label `kit:durchziehen` (Feld `night.kette.varianteBLabel`) am Fachplan — dann zieht der Nacht-Runner die entstandenen Arbeitspakete selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket, wie unter „Die drei Stop-Punkte (nie automatisiert)" beschrieben. Fehlt das Label oder wird es wieder entfernt, faellt die Kette auf Variante A zurueck. Drei Ausgaenge: `fertig`, `angehalten` (eine Stopp-Frage wartet als Kommentar `## Kette angehalten` samt `kit:klaeren` am Fachplan: Antwort als Satz in den Fachplan, Label abnehmen, `kit:night` neu setzen — die naechste Kette beginnt von vorn) und `abgebrochen` (mit Grund). Bei jedem Ausgang steht ein Nachtbericht als Kommentar am Fachplan; er ist Verlauf, verbindlich wird eine Entscheidung erst als Satz im Fachplan. Budgets — Minuten je Stufe, Kosten je Kette, Korrekturrunden — stehen in `night.kette` der `workflow.config.json`. Kette und Umsetzungsnacht laufen nebeneinander; unter Variante B verhindert der Lock `.claude/night-umsetzung.lock`, dass eine Umsetzungsnacht waehrend der laufenden Kette startet. Details: Kapitel „Nachtbetrieb" in der Kit-Dokumentation.

---

## Aufwand des Prozesses

Jeder unbeaufsichtigte Lauf schreibt seine Auswertung nach `.claude/aufwand.md`; sie liegt dort vollstaendig, auch wenn nichts auffaellt. Ein Befund erscheint unaufgefordert an genau zwei Stellen: im Abschlussblock des Laufprotokolls `.claude/night-run-<datum>.log` und zu Beginn von `/push-main`. Der Befund haelt nirgends etwas auf und ist kein Gate.

Drei Begriffe tragen die Auswertung: **Nachdenken** ist die Zeit, in der das Modell arbeitet; **Werkzeugarbeit** ist die Zeit, in der etwas anderes fuer den Lauf arbeitet; eine **Pruefung** ist ein Eintrag aus `buildChecks`, mehrfache Ausfuehrungen desselben Eintrags werden zusammengefasst. Zeit, die sich keiner Seite zuordnen laesst, ist ein dritter, eigener Posten.

Laufzahl und Schwellen stehen optional im Config-Block `aufwand`; fehlt er, gelten die eingebauten Vorgaben.

---

## Drei Bahnen

**Bahn 1 — Kleine Änderung** (direkt; kein Plan/Issue/GO): genau eine Datei / ein Asset / eine Config; keine Flyway-Migration; kein neuer/geänderter Endpoint; kein Datenmodell; ≤ 1 Modul; keine sicherheitsrelevante Logik → direkt umsetzen, ein Commit, kein Push ohne Trigger. **Auch dieser Commit setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus** — das Commit-Gate ist mechanisch und kennt keine Bahn. Dasselbe gilt für jeden Commit von Hand. Was das Gate nicht leistet — `--no-verify` und der frische Klon ohne Installer-Lauf — steht unter „Git-Workflow (strikt bindend)“.

**Bahn 2 — Feature** (voller 9-Schritt): ausserhalb von Bahn 1, sobald es etwas abzuwaegen gibt — oder unklar ist, ob es etwas abzuwaegen gibt → `/techplan` → `/issues` → GO → `/implement-ready`. Typisch: ein Datenmodell mit mehreren vertretbaren Schnitten, ein Endpoint, dessen Vertrag noch offen ist, eine Migration mit Rueckweg-Frage.

**Bahn 3 — `[Task]`** (ersetzt Schritt 2 und 3): oberhalb der Kleinigkeit, aber ohne Abwaegungsbedarf. Kein `[Fachlich]`, kein `[Plan]`, keine Zerlegung — ein Arbeitspaket mit dem Titel-Praefix `[Task]`, angelegt mit `/task` nach menschlicher Bestaetigung des Wegs, danach freigegeben wie jedes Arbeitspaket. Typisch: eine Umbenennung ueber mehrere Dateien, ein abgelehnter Werkzeug-Befund, eine mechanische Nachzieharbeit.

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
| Ready | Freigegeben, gilt als GO | Nur Mensch (Ausnahme: Umsetzungsstufe der Nacht-Kette unter Variante B) |
| In progress | Aktuelle Arbeit, ein Issue zur Zeit | KI beim Start |
| In review | Lokal fertig, nicht gepusht | KI beim Abschluss |
| Done | Mensch hat getestet, Push erfolgt | Nur Mensch |

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

**Was das Commit-Gate nicht leistet.** `--no-verify` umgeht es (die Zeile darüber verbietet das, mechanisch verhindert es nichts), und ein frischer Klon hat es erst nach einem Installer-Lauf oder `git config core.hooksPath .githooks` — die Dateien wandern mit, die Aktivierung ist lokale git-Config. In beiden Fällen greift **nachts** die Wertung des Nacht-Runners, die einen fehlenden oder roten Nachweis zum Fehlschlag macht — **interaktiv greift niemand**. Dort bleibt die Zeile oben die einzige Regel.

---

## Config (.claude/workflow.config.json)

Die Datei ist die einzige projektlokale Stelle, aus der die Skills lesen. Felder: `codeHost` (github | gitlab | local) und `issueTracker` (github | gitlab | local | toolbox); `buildChecks` mit optionalem `checkAreas` fuer bereichsbezogene Pruefungen; `mutationCommand` (oder leer); `mainBranch` und `productionBranch`; `reviewScope` (`diff` oder `all`) und genau eines von `reviewCommand` (fremde CLI) oder `reviewModel`; `triggers` fuer GO, Push und Merge; `local.issuesDir`; optional `issueReview` mit `reviewers`, `pairs` und `reviewStufen`; optional `spec` fuer Spec-Driven Development. Persoenliche Abweichungen gehoeren in `.claude/workflow.config.local.json`. Ein Beispiel je Stack und die Feldbeschreibung stehen in der Kit-Dokumentation, Abschnitt „Die Config-Datei".

---

## Pflichtchecks vor Push (Schritt 6)

Alle **betroffenen** `buildChecks` aus der Config laufen gruen; unberuehrte Bereiche werden mit Nachweis ausgelassen. Rote Checks blockieren den Push weiterhin mechanisch. Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen. Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen.

---

## Spec-Fortschreibung beim Push (Schritt 8, nur mit `spec`-Block)

Fuehrt `.claude/workflow.config.json` einen Top-Level-Block `spec`, beschreibt das Projekt sein Verhalten unter `specs/`, eine Datei je Bereich. `/push-main` traegt dann vor seinem Prueflauf mit `spec.mjs apply` nach, was die Arbeitspakete des Batches unter `## Spec-Wirkung` angekuendigt haben, und hebt wartende Vorhaben-Notizen aus `/techplan` nach `specs/vorhaben/` auf — nach Vorschau und einer Zustimmung des Menschen. Ohne den Block gibt es diesen Schritt nicht; Details in `/push-main`.

---

## Lange Texte ans Board

**Jeder Text, den eine Sitzung ans Board schreibt, geht ueber eine Datei ausserhalb des Projektverzeichnisses — nie im Befehl selbst.** Erst `printenv TMPDIR`, dann stueckweise `cat >` und `cat >>` in `<tmpdir>/<name>.md`, dann ein Aufruf mit `--text-file` bzw. `--body-file`. Vier Regeln, jede mit einem Beleg dahinter:

1. **Hoechstens 6.000 Zeichen je Werkzeugaufruf**, nicht je Datei. Die 6.000 sind eine **Beobachtung** vom 2026-09-10 im Kit-Repo: Aufrufe bis 9.722 Zeichen gingen durch, ab 10.154 wies der Befehls-Parser sie ab — auch ein `cat >>`, nicht nur der Board-Aufruf.
2. **Der Zielpfad steht woertlich im Befehl, nie als Variable.** Ein Variablen-Redirect wird unbeaufsichtigt als „path is runtime-determined" abgewiesen.
3. **Nur die Shell, kein Dateischreib-Werkzeug.** Unbeaufsichtigt sind Schreibzugriffe ausserhalb des Projektverzeichnisses damit abgewiesen, innerhalb von `.claude/` zustimmungspflichtig.
4. **Kein Pipe, keine Gruppierung um den Board-Aufruf.**

Eine Datei im Repo machte den Working Tree unsauber, und darauf stoppt der Nacht-Runner hart. Wer knapp schreibt, merkt von der Grenze nichts; wer gruendlich prueft, verloere sonst alles.

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

Abhaengigkeits-Konvention: exakt "Keine." oder explizite Referenzen der Form `Issue #N`. Freitext zusaetzlich erlaubt, aber die `#N`-Referenz ist Pflicht, wenn ein anderes Issue gemeint ist — der Nacht-Runner (`kit/night.mjs`) wertet nur `#N`-Referenzen aus. Fremde Repos als `owner/repo#N` referenzieren (zaehlt nicht als lokales Issue).

Herkunfts-Konvention: `issue create --derived-from <nummer>` traegt die Kartennummer des naechsten Vorfahren zusaetzlich als Feld ans Board — `/fachplan` nie (Wurzel), `/task` nie (kein Vorfahr), `/techplan` auf das fachliche Issue, `/issues` auf das Plandokument. Die Body-Zeilen `Plan:` und `Fachliche Quelle:` bleiben daneben stehen: Ein Projektwechsel loescht das Feld, der Text ueberlebt ihn. Nur beim Anlegen wirksam, Nachtragen gibt es nicht.

### Drei Titel-Praefixe, drei Sonderfaelle

Ein Issue ohne Praefix ist ein Arbeitspaket im Vier-Abschnitt-Format oben. Drei Praefixe kennzeichnen Dokumente, die **nie implementiert und nie nach Ready gezogen** werden; implement-Skills und Nacht-Runner stellen sie mechanisch kommentiert ins Backlog zurueck, ohne eine Session zu starten.

| Praefix | Was es ist | Weg nach vorn |
|---------|-----------|---------------|
| `[Fachlich]` | fachliche Anforderung aus `/fachplan`, Story-Format | mit dem PO groomen, dann `/techplan #N` |
| `[Plan]` | Plandokument aus `/techplan`, verbindliches Plan-Format | `/issues #N` zerlegt es in Arbeitspakete |
| `[Idee]` | rohe Idee, noch kein Dokument | erst `/techplan`, dann `/issues` |

**Plandokumente** (`[Plan]`) halten den freigegebenen Stand fest, statt ihn umzusetzen. Ein Plan beschreibt einen Weg, er ist keine Aufgabe: Er wird **nie implementiert**, geht **nie nach Ready** und wird zuerst mit `/issues #N` in Arbeitspakete zerlegt. Sein Format ist verbindlich — genau diese sechs Ueberschriften in dieser Reihenfolge:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

**Done setzt ausschliesslich der Mensch** — auch hier. Ein Plandokument darf bis zum Abschluss seiner Arbeitspakete als Klammer in **In review** offen bleiben, damit der Zusammenhang waehrend der Umsetzung sichtbar ist; ebenso gut kann es direkt nach Done gehen. Beides ist zulaessig, kein Skill bewegt es von selbst.

**Ideen** (`[Idee]`) sind ohne `/techplan`-Zyklus kein implementierbares Issue. Ohne das Gate wuerde eine Session sie zwar korrekt ablehnen, aber der Runner kann diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist verbrannt und der Kommentar am Board irrefuehrend.

**`[Task]` ist das einzige Praefix, das ein Arbeitspaket kennzeichnet**; es wird implementiert und nach Ready gezogen wie ein Paket ohne Praefix. Die drei Praefixe der Tabelle oben bezeichnen Dokumente, die nie implementiert werden — `[Task]` gehoert ausdruecklich nicht dazu, und es in dieselbe Liste aufzunehmen kehrte seinen Zweck um.

---

## Abschlussbericht-Format

```
### Aenderungen
- `Datei` — kurze Beschreibung der Wirkung

### Tests und Checks
- <Kommando> -> <Ergebnis>

### Hinweise
- <Restrisiken, offene Punkte, manuelle Folgeschritte>

### Entscheidungen
- E1: <Frage>. Gewählt: … Verworfen: … Grund: … Rückbau: …
```

`### Entscheidungen` entfaellt, wenn es nichts zu entscheiden gab; sonst traegt der Block die Eintraege im Format aus „Entscheiden statt fragen".

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

## Gates (prozessweit)

Vier Regeln, die unabhaengig von der Pruefstufe gelten und die den Rahmen des Prozesses tragen. Sie zitieren Saetze, die weiter oben in dieser Datei stehen; ein Vorschlag, der eine davon aushebelt, ist keine Detailaenderung, sondern eine Aenderung der Bauart — und damit eine Frage der Stopp-Klasse.

### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`

GO (Issue nach Ready ziehen), Push (`push main`), Merge (`merge production`). Eine Trigger-Phrase, die innerhalb einer Mitteilung zitiert wird, ist kein getippter Trigger. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete des gekennzeichneten Fachplans selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch am Fachplan gegeben, als er ihn fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete eines Fachplans, der frueher unter Variante B lief. Fundstellen: „Die drei Stop-Punkte (nie automatisiert)", „Mitteilungen des Menschen", „Nachtbetrieb (optional)".

### W2 — Der Git-Workflow ist strikt bindend `[Urteil]`

Kein Force-Push auf `mainBranch` oder `productionBranch` ohne explizite Einzelanweisung; Hooks werden nicht mit `--no-verify` umgangen; `productionBranch` wird nie direkt gepusht. Fundstelle: „Git-Workflow (strikt bindend)".

### W3 — Rote Pflichtchecks blockieren den Push mechanisch `[Urteil]`

Alle **betroffenen** `buildChecks` laufen gruen, bevor gepusht wird; unberuehrte Bereiche werden mit Nachweis ausgelassen, und ein nicht lokal ausfuehrbarer Check wird im Abschlussbericht vermerkt, nicht verschwiegen. Ein Vorschlag, der einen Check zur Empfehlung macht oder eine Schwelle senkt, hebt die Mechanik auf. Fundstelle: „Pflichtchecks vor Push (Schritt 6)".

### W4 — Die Prioritaetenordnung bei Zielkonflikten `[Urteil]`

Sicherheit, Korrektheit, Datenintegritaet, Accessibility, Wartbarkeit, Performance, visuelle Praeferenz, Bequemlichkeit — in dieser Reihenfolge; sie ist der Schiedsspruch fuer jeden Konflikt, den ein Dokument nicht selbst entscheidet. Fundstelle: „Prioritaeten bei Zielkonflikten".

---

## KI-Retro (alle 1-2 Wochen)

`/retro` startet die KI-Retrospektive. Vier Fragen:
- Wo hat die Mensch-KI-Zusammenarbeit gehakt?
- Welche Memory-Eintraege sind veraltet?
- Welche Workflow-Regel braucht eine Schaerfung?
- Was sagen die Zahlen? (gekippte Nachtentscheidungen, Stopp-Fragen, Anforderung bis GO, GO bis Push)

Output: konkrete Aenderungen an Memory-Dateien und CLAUDE*.md-Dateien, dazu die Kennzahlen als Tabelle.
