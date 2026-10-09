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

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete der gekennzeichneten Karte selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch an der gekennzeichneten Karte gegeben — an der fachlichen Anforderung oder am Plandokument —, als er sie fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete einer Karte, die frueher unter Variante B lief. Das GO an der gekennzeichneten Karte geben `kit:durchziehen` oder ein Ziel ab `umsetzung` (`ziel:umsetzung`, `ziel:push-vorbereitet`); beide wirken nur zusammen mit `kit:night`. Der Push am Morgen (Schritt 8) nimmt die Entscheidungen der Nacht mit an.
2. **Push (Schritt 8):** Trigger-Phrase `push main`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase `merge production`. Claude merged nicht.

Geprueft werden die fachliche Anforderung und das Plandokument: `/issue-review` laesst sie von Modellen lesen, die sie nicht geschrieben haben; wie viele das sind, sagt `reviewStufen`. Ein Arbeitspaket wird nicht standardmaessig geprueft — wer es will, ruft `/issue-review #N`. Der Schalter `issueReview.requiredBeforeReady` bleibt fuer Projekte, die das Gate wollen; ausgeschaltet ist der Regelfall. Bei gesetztem `issueReview.requiredBeforeReady` stellt der Nacht-Runner ungepruefte Ready-Issues zurueck.

**Der Aufruf ist immer derselbe: `/issue-review #N`.** Welche Stufe greift — fachliche Anforderung, Plandokument oder Arbeitspaket —, liest der Skill am Titel-Praefix ab; es gibt bewusst kein eigenes Kommando je Stufe. Das gilt interaktiv genauso wie im Nachtbetrieb: Ein Plandokument laesst sich jederzeit tagsueber pruefen. Der Marker, den die Pruefung hinterlaesst, ist eine Spur und keine Freigabe. Daneben setzt die Pruefung das Label `review:fertig` als sichtbare Spur am Board; es muss je Board einmal angelegt sein (GitHub und GitLab als Repo-Label, kanban-kit ueber `POST /api/boards/{boardId}/labels`).
Das Label bleibt eine Spur der Pruefung und gibt den Inhalt nicht frei; die Nacht-Kette verlangt diese Spur aber als Voraussetzung — eine gekennzeichnete Karte ohne `review:fertig` wird uebersprungen, auch wenn sie das Kettenlabel traegt; das gilt fuer die fachliche Anforderung wie fuer das Plandokument.

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

Nur eine Frage aus dieser Klasse haelt an, und jeder Halt traegt genau eine Frage. Alles andere — ausdruecklich auch Randfaelle, Namensfragen, Fehlerpfade, Reihenfolgen und die Frage, welcher Test gemeint ist — wird entschieden. Schiedsrichter ist die Ordnung aus „Prioritaeten bei Zielkonflikten"; im Zweifel gewinnt der kleinste rueckbaubare Eingriff. **Eine geschuetzte Datei ist keine Frage, sondern eine Handlung.** Muss ein Paket eine Datei aendern, die nur ein Mensch schreiben darf (die Einstellungen unter `.claude/`), haelt es mit dem Label `kit:geschuetzt` statt `kit:klaeren`: Bei `kit:klaeren` wartet eine Entscheidung, bei `kit:geschuetzt` eine Handlung. Das Label ist wie das Spur-Label der Pruefung je Board einmal anzulegen; abnehmen darf es nur der Mensch, nachdem er die Aenderung selbst vorgenommen hat. Der Halt-Kommentar beginnt mit `## Geschuetzte Datei`, nennt jede Datei mit der zitierten Zeile und vermerkt als letzte Zeile `Label kit:geschuetzt gesetzt` oder, wenn das Label am Board fehlt, `Label kit:geschuetzt nicht gesetzt` — frei wird die Karte erst nach einem Halt mit gesetztem Label, den der Mensch durch Abnehmen des Labels beantwortet. Erkannt wird der Fall vor dem Start (Gate im Runner, `issue auftrag`, `issue check-form` I8) und, wenn erst das Schreiben scheitert, im Rueckfall der Session oder im Auffang des Runners.

**Reviews sind Zuarbeit.** Ein Modell-Review eines Fachplans, Plans oder Arbeitspakets liefert Befunde an den Autor der Stufe; jeder Fund kommt dabei mit den drei zusaetzlichen Angaben aus „Befunde der Modell-Pruefungen" — Gegenprobe, ihr Stand und die Mangel-Art —, und der Autor liest sie mit, bevor er uebernimmt oder mit einem Satz ablehnt. Ob eine Stufe fertig ist, sagt ein Kommando oder ein Mensch, nie ein Modell-Marker.

---

## Regel im Text oder Regel im Werkzeug

Jede Regel einer mitgelieferten Anweisung ist von einer von zwei Arten. Die Art entscheidet, wo sie hingehoert.

**Bedienvorgabe.** Sie sagt, wie ein Werkzeug zu bedienen ist. Ihre Befolgung ist an Ausgabe oder Ergebnis ablesbar, und ein Werkzeug koennte sie an der Stelle des Lesers ausfuehren. Beispiel: den echten Rueckgabewert des Pruefkommandos lesen, nicht den einer Kette, die der Leser um den Aufruf baut. Eine Bedienvorgabe gehoert ins Werkzeug — im Text ist sie eine Bitte, die jede Session neu befolgen muss.

**Urteilsregel.** Sie verlangt eine Entscheidung oder Haltung im Einzelfall. Beispiel: liegt der Coverage-Report unter dem vereinbarten Ziel, das als Signal ausweisen statt es still durchzuwinken. Eine Urteilsregel bleibt im Text — ein Werkzeug koennte sie nur erraten.

**Gemischte Regeln werden zerlegt, nicht gerundet.** Die Zeitrahmen-Regel der lokalen Pruefung traegt beides: „ein Abbruch an der Uhr erscheint als Fehlschlag" ist eine Bedienvorgabe und erzwingbar — das Werkzeug hinterlaesst dann eine unabgeschlossene, ungruene Zusammenfassung. „Setze einen grosszuegigen Zeitrahmen" ist eine Urteilsregel und bleibt im Text, weil ein Werkzeug sich nicht mehr Zeit geben kann, als sein Aufrufer einraeumt.

**Die Art sagt nichts ueber die Ueberfuehrbarkeit.** Eine Bedienvorgabe wird nicht zur Urteilsregel, nur weil ein Werkzeug sie nur teilweise sicherstellen kann. Der ueberfuehrbare Teil wandert, der Rest bleibt benannt im Text — und bleibt eine Bedienvorgabe.

Der Massstab gilt fuer alle mitgelieferten Anweisungen, auch fuer die, die heute unveraendert bleiben: Er ist die Quelle, gegen die eine Anweisung gelesen wird, nicht nur eine Notiz zu der einen, die gerade umgestellt wird.

**Die Lint-Konfiguration begruendet sich selbst.** Wann eine wiederkehrende Fundklasse zur Leitplanke wird, wie ihre Aufnahme laeuft und wie ueber ganze `recommended`-Sets entschieden ist, gehoert in den Kopf der Lint-Konfiguration des Projekts, neben die Regeln selbst — nicht hierher.

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

## Der Prueflauf (optional)

Der Prueflauf (`node .claude/kit/night.mjs --pruefen`) laesst mehrere fachliche Anforderungen nacheinander pruefen, ohne dass jemand zusieht — am Tag, neben dem arbeitenden Menschen und neben einer Nacht-Kette. Die Geste ist das Label `kit:pruefen` (Feld `pruefLauf.label`) an der `[Fachlich]`-Karte; der Lauf verbraucht es unmittelbar vor ihrer Session, jedes Setzen autorisiert genau eine Pruefung. Je Karte laeuft eine Session `/issue-review #N`, alle in einem Worktree je Lauf. Drei Ausgaenge: `geprueft` (Fachplan-Review-Marker im Body und `review:fertig` an der Karte), wartende Entscheidung (`kit:klaeren` und die Frage als Kommentar; der Text der Anforderung bleibt unveraendert) und unvollstaendig (der Kommentar `## Pruefung unvollstaendig` mit Grund und erreichtem Schritt, weil die Pruefung bezahlt ist und ihr Ergebnis den Body nie erreicht hat). Eine gekennzeichnete Karte ohne `[Fachlich]`-Praefix und eine mit `kit:klaeren` wird mit Grund uebersprungen und behaelt ihr Kennzeichen; `kit:klaeren` nimmt der Lauf nie ab — das darf allein ein Mensch. Er bewegt keine Karte, aendert nichts an der Pruefung selbst, beantwortet keine Frage, die einem Menschen gehoert, und hinterlaesst im Projekt keine Aenderung. Budgets — Minuten je Pruefung, Kosten je Lauf — stehen im Wurzelblock `pruefLauf` der `workflow.config.json`, nicht unter `night`: Der Lauf gehoert dem Tag. Verhaeltnis zur Nacht-Kette: Er stellt deren Voraussetzung her, indem er die Karte geprueft zuruecklaesst; das Kettenlabel bleibt die Geste des Menschen. Details: Kapitel „Der Prueflauf" in der Kit-Dokumentation. **Der Lauf arbeitet mit einem festen Kit-Stand.** Jeder unbeaufsichtigte Lauf bindet sich wie die Nacht beim Start an den Commit, auf den `origin/<mainBranch>` zeigt — den letzten Push, gelesen ohne `git fetch`. Fest sind damit die Werkzeuge einschliesslich der Pruefung vor jedem Commit, die Skills und die Regeltexte; was ein Paket derselben Nacht daran aendert, wirkt erst nach `push main`. Pruefgegenstand bleiben die Konfiguration des Projekts und seine Tests, sie kommen aus dem Stand des jeweiligen Pakets. Der Stand steht als Zeile `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` im Laufbericht (`kitStand` in `.claude/night-run-*.json`), im Nachtbericht und an jedem Kommentar des Laufs. Nach einem Lauf in der Hauptkopie bleibt deren installierte Kopie auf dem Stand, bis `node tools/sync-blobs.mjs` sie auf die Arbeitskopie bringt; `sync-blobs --check` nennt sie bis dahin als veraltet.

---

## Nachtbetrieb (optional)

Der Nacht-Runner (`node .claude/kit/night.mjs`) arbeitet die Ready-Spalte unbeaufsichtigt ab: pro Issue mit dem Routing-Label `kit:nightrun` eine frische Headless-Session mit `/implement-next #N`. Erfolg wird am Board gemessen (Issue in In review); Fehlschlaege wandern kommentiert ins Backlog, bei unsauberem Working Tree stoppt der Lauf hart. Nachts wird committet, nie gepusht — Review, Test und `push main` passieren morgens durch den Menschen.

Die zweite Betriebsart ist die Nacht-Kette (`node .claude/kit/night.mjs --kette`). Die Geste ist das Label `kit:night` an der Karte, die den Auftrag traegt; der Runner verbraucht es beim Start, jedes Setzen autorisiert genau eine Kette. Die Kette kennt **zwei Auftragsarten**. Am gegroomten `[Fachlich]`-Issue im Backlog entsteht in einem eigenen Worktree ein Plan (`/techplan`), der geprueft wird (`/issue-review`), daraus die Arbeitspakete (`/issues`) und eine Abdeckung gegen die fachliche Anforderung. Am geprueften `[Plan]`-Dokument im Backlog laeuft derselbe Weg als **Plan-Auftrag** ohne die Stufen `plan` und `review`: Der Plan bleibt erhalten, seine Nummer wandert unveraendert in Pakete und Bericht, es entsteht kein zweites Plandokument, und kein aelteres wird als ueberholt vermerkt. Bedingung ist in beiden Faellen die Spalte Backlog, ein `review:fertig` und kein `kit:klaeren`; beim Plan zusaetzlich eine erkennbare Zeile `Fachliche Quelle: Issue #N`. Gebaut wird nichts, die Pakete bleiben im Backlog, das GO nach Ready bleibt beim Menschen. Die Kette kennt zwei Varianten: Variante A (Standard) belaesst die Arbeitspakete im Backlog und wartet auf das GO des Menschen; Variante B setzt zusaetzlich das Label `kit:durchziehen` (Feld `night.kette.varianteBLabel`) an der gekennzeichneten Karte. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete der gekennzeichneten Karte selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch an der gekennzeichneten Karte gegeben — an der fachlichen Anforderung oder am Plandokument —, als er sie fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete einer Karte, die frueher unter Variante B lief. Fehlt das Label oder wird es wieder entfernt, faellt die Kette auf Variante A zurueck. Drei Ausgaenge: `fertig`, `angehalten` (eine Stopp-Frage wartet als Kommentar `## Kette angehalten` samt `kit:klaeren` an der gekennzeichneten Karte; der Kommentar zaehlt den Weg nach vorn auf: Antwort als Eintrag unter `## Architektonische Entscheidungen` des Plans — nicht unter `## Offene Fragen`, dort gilt sie als weitere offene Frage —, `## Offene Fragen` wieder auf `- Keine.`, `/issue-review`, `kit:klaeren` abnehmen, `kit:night` an den Plan, den die naechste Kette dann als Plan-Auftrag von der Stufe `pakete` an weiterfaehrt) und `abgebrochen` (mit Grund). Bei jedem Ausgang steht ein Nachtbericht als Kommentar an der gekennzeichneten Karte; er ist Verlauf, verbindlich wird eine Entscheidung erst als Satz im Fachplan. Der Nachtbericht jeder Kette unter Variante B nennt den Stand der Ursprungsdokumente: welche nach In review gewandert sind oder, wenn der Plan nicht durch ist, warum nicht und welche Pakete fehlen. Budgets — Minuten je Stufe, Kosten je Kette, Korrekturrunden — stehen in `night.kette` der `workflow.config.json`. Kette, Umsetzungsnacht und Prueflauf laufen nebeneinander, auch mehrere Ketten und Prueflaeufe zugleich und auf zwei Rechnern am selben Board. Je fachlicher Wurzel bearbeitet genau ein Runner: Er beansprucht sie bei der Auswahl mit dem Laufstand `laeuft`, dessen Zeile `Lauf-ID: <host>/<pid>/<stempel>` ihn ausweist, und laesst eine Wurzel mit lebender Lauf-ID aus (Grund im Protokoll: bereits von einem laufenden Runner beansprucht). Geraeumt wird beim Start nur, was einem toten Prozess gehoert — Arbeitskopie und Kit-Stand eines lebenden Runners bleiben stehen. Ist der beanspruchende Runner abgestuerzt (gleicher Rechner: Prozess beendet; anderer Rechner: `Stand:` aelter als die Budget-Obergrenze bis zu seiner Position), uebernimmt ein spaeterer Start die Wurzel und nennt die Uebernahme im Protokoll; neu kennzeichnen muss niemand. Unter Variante B nehmen Kette und Umsetzungsnacht den Lock `.claude/night-umsetzung.lock`; ist er belegt, wartet die Kette im Rahmen ihres Umsetzungsbudgets (`night.kette.umsetzungMin`) auf die Umsetzung und endet sonst als unvollstaendig. Details: Kapitel „Nachtbetrieb" in der Kit-Dokumentation. **Der Lauf arbeitet mit einem festen Kit-Stand.** Jeder unbeaufsichtigte Lauf bindet sich beim Start an den Commit, auf den `origin/<mainBranch>` zeigt — den letzten Push, gelesen ohne `git fetch`. Fest sind damit die Werkzeuge einschliesslich der Pruefung vor jedem Commit, die Skills und die Regeltexte; was ein Paket derselben Nacht daran aendert, wirkt erst nach `push main`. Pruefgegenstand bleiben die Konfiguration des Projekts und seine Tests, sie kommen aus dem Stand des jeweiligen Pakets. Der Stand steht als Zeile `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` im Laufbericht (`kitStand` in `.claude/night-run-*.json`), im Nachtbericht und an jedem Kommentar des Laufs. Nach einem Lauf in der Hauptkopie bleibt deren installierte Kopie auf dem Stand, bis `node tools/sync-blobs.mjs` sie auf die Arbeitskopie bringt; `sync-blobs --check` nennt sie bis dahin als veraltet. Braucht ein Paket das geaenderte Werkzeug, den Skill oder den Regeltext eines anderen Pakets als Werkzeug, traegt seine Verweiszeile den Zusatz `Issue #N (wartet auf Push)`; die Kette zieht es auch unter Variante B nicht nach Ready, es bleibt wartend im Backlog und steht im Nachtbericht als nicht begonnen.

**Keine Session endet mit laufender eigener Arbeit.** Eine unbeaufsichtigte Sitzung beendet ihre Arbeit nicht, solange eine von ihr angestossene lange Arbeit laeuft — sie wartet auf das Ergebnis oder bricht die lange Arbeit ab und meldet den Abbruch als Fehlschlag. Hintergrundarbeit bleibt dabei ausdruecklich erlaubt; unzulaessig ist allein das Aufhoeren, waehrend sie noch laeuft. Tut eine Sitzung es doch, benennt der Runner den Fall mit eigenem Grund, zaehlt ihn als eigene Groesse und haengt einen Vermerk `## Nachtlauf: wartende Sitzung` an das Arbeitspaket; erledigt ist das Paket damit nicht.

**Ein Zeitabbruch ist gekennzeichnet und behauptet keine Ursache.** Endet eine Sitzung an der Sitzungszeitgrenze (`--timeout-min`, Vorgabe 60 Minuten — ausdruecklich nicht am Stufenbudget `night.kette.umsetzungMin`, das nur zwischen zwei Sessions greift), haengt der Runner einen Vermerk `## Nachtlauf: Zeitgrenze erreicht` an das Arbeitspaket und die Einheit im Ergebnisstand traegt `zeitlimitBeendet`. Der Vermerk nennt die Grenze, den zuletzt gemeldeten Stand und eine Empfehlung an den Menschen — keine Vorgabe. Das ist kein inhaltlicher Fehlschlag: Die Sitzung wurde an der Uhr abgebrochen, nicht an ihrer Arbeit, und woran die Zeit ausging, folgt aus dem Abbruch nicht. **Eine festgefahrene Pruefung bremst die Sitzung vor der Zeitgrenze.** `checks.mjs run` zaehlt je Pruefung, wie oft sie hintereinander auf dieselbe Weise gescheitert ist — dieselben gescheiterten Tests, sonst dieselbe erste Fehlermeldung; gezaehlt werden nur echte Laeufe, Teillaeufe eingeschlossen, keine uebernommenen Ergebnisse. Gruene Ergebnisse anderer Pruefungen unterbrechen die Folge nicht; sie endet erst, wenn genau diese Pruefung gruen wird oder anders scheitert. Erreicht die Folge die Grenze `night.festgefahrenNach` (Vorgabe 3), faehrt unbeaufsichtigt (gesetztes `KIT_AGENT_MODEL`) der naechste Aufruf nichts mehr, auch nicht mit `--frisch`: Er gibt `Pruefung festgefahren: <Kommando> — <Fehler>` aus und endet mit Exitcode 3. Die Sitzung endet dann ohne weitere Aenderung. Der Runner beendet die Runde, sichert die Reste ohne Rettungsversuch im Stash `nachtrest #<id> <lauf>` (misslingt das, harter Stopp), haengt den Vermerk `## Nachtlauf: an einer Pruefung festgefahren` mit Pruefung, Fehler, Versuchen, Laufzeit und Zeitgrenze an das Paket, setzt `lauf:abgebrochen` und zieht es nach Backlog; die uebrigen Pakete laufen weiter. Im Nachtbericht ist es ein eigener Ausgang `festgefahren`, getrennt von Zeitgrenze und wartender Sitzung. Interaktiv bricht nichts ab: Der Lauf gibt nur `Hinweis: festgefahren an <Kommando> — <n>-mal gleich gescheitert (<Fehler>)` aus, Ergebnis und Exitcode bleiben, der Mensch entscheidet.

**Der Stand eines Laufs steht am Board, nicht im Prozess.** Jede Karte einer Kette oder Umsetzungsnacht traegt hoechstens eines der drei Labels `lauf:laeuft`, `lauf:abgebrochen` und `lauf:wartet` und genau einen Kommentar `## Laufstand`, der bei jedem Wechsel ersetzt wird. Er ist Tafel, nicht Verlauf; der Nachtbericht bleibt Verlauf. Abbruch und Halt sind ohne Deutung zu unterscheiden: `lauf:abgebrochen` heisst, Wiederholen genuegt; `lauf:wartet` sagt im Laufstand woertlich, worauf es wartet — `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night`, `wartet: Karte ohne Freigabe zur Umsetzung` oder, bei einem inhaltlichen Halt, „Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`“. Der Weg fuer inhaltliche Halte ueber `kit:klaeren` bleibt, wie er ist. Wiederholt wird mit derselben Geste: `kit:night` an der Karte startet die Kette bei der ersten Stufe ohne Ergebnis, und was schon vorliegt, entsteht nicht doppelt. Ein vorhandener Plan zaehlt dabei als Ergebnis; ein frischer Plan entsteht erst, wenn der alte in Done steht. Welche Uebergaenge der Kette automatisch folgen, legt das Projekt in `night.kette.uebergaenge` fest (`planReview`, `reviewPakete`, `paketeAbdeckung`, `abdeckungUmsetzung`); `abdeckungUmsetzung` wirkt nur zusammen mit `kit:durchziehen` an der Karte, das GO bleibt an der einzelnen Karte; fehlt der Eintrag, setzt eine Kette mit `kit:durchziehen` nach der Abdeckung um wie vor der Einstellung, und erst ein gesetztes `false` haelt sie an. Einen automatischen Versuch gibt es nur bei Umgebungsfehlern, solange der Lauf lebt — Board nicht erreichbar, keine Sitzung zustande gekommen —, genau einen, nach einer Pause, mit dem Vermerk „2. Versuch“ im Laufstand. Eine Sitzung, die zustande kam und ohne Ergebnis endete, ist ein Paketfehler. Ein gestorbener Lauf wird nicht wiederholt: Seine Karten zeigen nach der Frist „nicht beendet“, und weiter geht es nur mit der Geste des Menschen. **Wie weit eine Kette laeuft, sagt das Ziel an der Karte.** Neben `kit:night` traegt die gekennzeichnete Karte hoechstens eines der vier Ziel-Labels `ziel:plan` (endet nach der Stufe `review`), `ziel:pakete` (nach `abdeckung`), `ziel:umsetzung` (nach `umsetzung`) oder `ziel:push-vorbereitet` (nach `vorbereitung`). Die Reihenfolge der Stufen ist fest, das Ziel bestimmt nur, wo die Kette endet. Ein Ziel ab `umsetzung` ist zugleich das GO fuer die Pakete dieser Karte; `kit:durchziehen` zaehlt als `umsetzung`, und tragen beide, gilt das weiter reichende. An der fachlichen Anforderung legt `planreview:1` oder `planreview:2` fest, wie viele Modelle den Plan pruefen; ohne Angabe gilt die Einstellung des Projekts. Ein Ziel ohne `kit:night` startet nichts. Beim Start verbraucht der Runner `kit:night`, das Ziel und `planreview:*` zusammen, jedes Setzen gilt fuer genau einen Lauf; ihr Wert steht danach im Laufstand. Eine neu gestartete Kette liest nur ein neu gesetztes Ziel, ohne Ziel verhaelt sie sich wie heute. Was an der Karte nicht passt — mehr als ein Ziel, beide `planreview:*`, `ziel:plan` oder `planreview:*` an einem Plandokument, `planreview:*` an einer Anforderung, deren Plan schon einen `Plan-Review:`-Marker traegt —, lehnt die Auswahl mit dem Kommentar `## Kette nicht gestartet: unpassende Einstellung` ab, und die Karte behaelt ihre Labels. **Ende am Ziel und Projektgrenze.** Endet eine Kette an ihrem Ziel, traegt der Laufstand den Kopf `fertig bis <Ziel>` und die Zeile `Als Nächstes:` mit dem Schritt, der jetzt dem Menschen gehoert. Das Projekt bleibt Obergrenze: Sperrt `night.kette.uebergaenge` einen Uebergang vor dem Ziel, endet die Kette dort mit der wartet-Form des gesperrten Uebergangs, der Laufstand nennt die letzte erreichbare Stufe in der Zeile `Grenze:`, und der Nachtbericht sagt unter `### Ausgang`, dass sie an der Projektgrenze stehen blieb und nicht am Ziel. Der Uebergang in die Vorbereitung heisst `umsetzungVorbereitung` und hat die Vorgabe `true`; nur ein ausdrueckliches `false` haelt die Kette davor an. **Die Stufe `vorbereitung` bereitet die Veroeffentlichung vor und pusht nicht.** Erreicht eine Kette das Ziel `push-vorbereitet`, folgt nach allen Ketten des Laufs einmal die Stufe `vorbereitung` fuer den ganzen Stand. Sie wartet, bis nichts mehr baut — die Umsetzungssperre ist frei und kein anderer Lauf dieses Projekts baut noch —, hoechstens `night.kette.vorbereitungMin` Minuten (Vorgabe 120); laeuft die Frist ab, heisst das Ergebnis `nicht-vorbereitet` mit Grund. Dann laeuft in der Stufe `vorbereitung` die Session `/push-main vorbereiten` in einem eigenen Worktree: Versionsvermerk, Aenderungsnotiz, der Prueflauf der Push-Stufe und ein lokaler Commit, ohne Push — weder auf `mainBranch` noch auf einen Pruefzweig oder Vorab-Zweig. Was einen Menschen oder einen Push braucht, wird nicht gestartet, sondern steht als offen in der Meldung; das Ergebnis heisst dann `gruen-offen` statt `gruen`. Faehrt das Projekt den vollen Lauf mit `pushPruefung` im Build-Dienst, faehrt die Vorbereitung statt seiner nur den Nachweislauf der Paketstufe ueber die Release-Dateien, und der erste offene Punkt lautet `voller Lauf im Build-Dienst (Prüfzweig <zweig>)`; morgens faehrt `push main` den Pruefzweig. Das Ergebnis (`gruen`, `gruen-offen`, `rot` oder `nicht-vorbereitet`) steht in einem eigenen Nachtbericht an jeder Karte, die die Vorbereitung ausgeloest hat, und an der festen Stelle `.claude/push-vorbereitung.json`. Hat sich der Stand bis zum `push main` nicht geaendert, uebernimmt er den vorbereiteten Commit ohne zweiten Prueflauf; sonst prueft er vollstaendig.

---

## Aufwand des Prozesses

Jeder unbeaufsichtigte Lauf schreibt seine Auswertung nach `.claude/aufwand.md`; sie liegt dort vollstaendig, auch wenn nichts auffaellt. Ein Befund erscheint unaufgefordert an genau zwei Stellen: im Abschlussblock des Laufprotokolls `.claude/night-run-<datum>.log` und zu Beginn von `/push-main`. Der Befund haelt nirgends etwas auf und ist kein Gate.

Drei Begriffe tragen die Auswertung: **Nachdenken** ist die Zeit, in der das Modell arbeitet; **Werkzeugarbeit** ist die Zeit, in der etwas anderes fuer den Lauf arbeitet; eine **Pruefung** ist ein Eintrag aus `buildChecks`, mehrfache Ausfuehrungen desselben Eintrags werden zusammengefasst. Zeit, die sich keiner Seite zuordnen laesst, ist ein dritter, eigener Posten.

Ein eigener Block weist die **Zielmarke der Umsetzung** aus: wie viele Umsetzungen ueber der Marke des jeweiligen Laufs liegen und um wie viel, gemittelt ueber die Ueberschreitungen. Zeitabbrueche stehen darin getrennt und gehen in kein Mittel ein — ihre Fertigstellungsdauer ist unbekannt.

Laufzahl und Schwellen stehen optional im Config-Block `aufwand`; fehlt er, gelten die eingebauten Vorgaben.

---

## Wirksamkeit der Pruefungen

Was die Pflichtpruefungen einbringen, steht in `.claude/wirksamkeit.md` fuer Menschen und in `.claude/wirksamkeit.json` fuer die Ausgabestellen; beide liegen dort vollstaendig, auch wenn nichts auffaellt. Je Pruefung steht dort, wie oft sie lief, wie oft sie beanstandete und wie viel Zeit sie kostete, dazu die Ruecklaeuferquote aus „In review". Ein Befund erscheint unaufgefordert an denselben zwei Stellen wie der Aufwands-Befund: im Abschlussblock des Laufprotokolls und zu Beginn von `/push-main`. Der Befund haelt nirgends etwas auf und ist kein Gate.

Vier Begriffe tragen die Auswertung: eine **Ausfuehrung** ist ein Lauf einer Pruefung fuer ein Arbeitspaket — eine Zeile im Ausfuehrungsprotokoll; ein **Lauf** ist ein unbeaufsichtigter Lauf; **beanstandet** heisst, dass eine Ausfuehrung nicht gruen endete — eine Pruefung, die gar nicht erst startete, ist keine Ausfuehrung; ein **Ruecklaeufer** ist jede Bewegung aus „In review" zurueck, gleich wer sie ausloest. Daraus folgt der Unterschied, auf den es ankommt: „nie beanstandet" ist ein Ergebnis vieler Ausfuehrungen, „nicht gelaufen" ist gar keines — nur das erste sagt etwas ueber die Pruefung.

Was die Verkleinerung des Abschlussumfangs einbringt, steht dort als eigener Kennzahlblock: die **mittlere Pruefzeit je Karte** — gerechnet ueber die **Abschlusslaeufe** dieser Karte —, daneben der Vergleichswert, den dieselben Laeufe ohne die Auslassungen des Abschlusses gekostet haetten, und je ausgelassener Pruefung, was sie beim Veroeffentlichen kostete. Bezugsgroesse ist die Karte, nicht der Lauf; ein Mittel je Lauf waere eine andere Zahl. Gezaehlt werden allein Abschlusslaeufe — Pruefzeiten waehrend der Arbeit und beim Veroeffentlichen bleiben draussen. Fehlt die Grundlage, steht dort „nicht gemessen" und keine 0. Wie der uebrige Bericht ist der Block eine Auskunft und kein Gate.

Fenster, Quote und Mindestmengen stehen optional im Config-Block `wirksamkeit`; fehlt er, gelten die eingebauten Vorgaben.

Zwei Messgrenzen gehoeren zum Bild: Die Salvage-Pruefungen des Nacht-Runners laufen an `checks.mjs` vorbei und zaehlen darum nicht mit. Und eine Karte, die das Kit nie bewegt hat, steht nicht im Nenner der Ruecklaeuferquote — was ohne den Prozess entstand, misst er auch nicht.

---

## Befunde der Modell-Pruefungen

**Aufbau eines Funds.** Jeder Fund einer vom Kit vorgesehenen Modell-Pruefung — fachliche Anforderung, Plan, Arbeitspaket, Code — traegt neben Schweregrad, Fundstelle und Vorschlag drei weitere Angaben: die Beobachtung, die ihn widerlegen wuerde; den Stand dieser Gegenprobe, `geprueft, bestaetigt` oder `nicht geprueft`; und seine Mangel-Art. Ein Fund, den die eigene Gegenprobe widerlegt hat, wird nicht gemeldet.

**Die Artenliste hat genau einen Wortlaut:** `node .claude/kit/befunde.mjs arten`. Dieser Abschnitt zaehlt die Arten nicht selbst auf, sondern verweist auf das Kommando — zwei Orte driften auseinander, sobald eine Art hinzukommt oder ihren Namen wechselt. Ein Projekt ergaenzt keine eigenen Arten.

**Aus dieser Form wird kein Gate.** Ein Fund ohne Gegenprobe oder mit fehlender Angabe haelt nichts auf. Fehlt eine Angabe, wird sie beim liefernden Reviewer genau einmal nachgefordert; bleibt sie aus, traegt der Fundblock `Angaben: unvollstaendig` und wird trotzdem eingearbeitet.

Vier Begriffe tragen die Auswertung: ein **Fund** ist eine gemeldete Beanstandung einer Modell-Pruefung; die **Gegenprobe** ist die Beobachtung, die den Fund widerlegen wuerde, samt ihrem Stand; die **Art** ist die Einordnung aus der festen Liste; ein **Vorkommen** ist ein uebernommener Fund mit bestaetigter Gegenprobe — nicht gepruefte, unvollstaendige und abgelehnte Funde sind keine Vorkommen.

Zwei Messgrenzen gehoeren auch hier zum Bild: Vor der Einfuehrung dieser Form geschriebene Funde zaehlen nicht und werden nicht nachtraeglich eingeordnet. Und Buchungen, die in einem abgestuerzten Nacht-Worktree entstanden sind, gehen verloren — `worktreesAufraeumen` in `kit/night.mjs` raeumt liegengebliebene Worktrees beim naechsten Start weg, samt allem, was darin noch ungesichert wartet.

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
| In review | Lokal fertig, nicht gepusht | KI beim Abschluss; Ursprungsdokumente: Kit, wenn der Plan durch ist |
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

**Schritt 8 und 9 laufen in einem eigenen Worktree.** `/push-main` und `/merge-production` erzeugen ihre Release-Dateien, fahren ihren Prueflauf und committen nicht im Haupt-Working-Tree, sondern in einem frischen Worktree ausserhalb des Repos (`node .claude/kit/worktree.mjs anlegen --praefix release`, derselbe Weg wie beim Worktree der Nacht-Kette); danach pushen sie von dort und bauen ihn wieder ab, auch nach einem roten Lauf. Der Grund ist die Gleichzeitigkeit: Im Haupt-Tree kann unter Variante B die Umsetzungsstufe des Nacht-Runners bauen, und zwei Laeufe in einem Baum vermischen ihre Dateien — der Release-Prueflauf saehe fremde, halbfertige Arbeit, und der Runner fand die Release-Dateien als unkommittierte Reste und stoppte hart. `/merge-production` setzt dabei auf `origin/<mainBranch>` auf, denn veroeffentlicht wird, was gepusht ist; `/push-main` auf dem lokalen `<mainBranch>`, im Worktree auf `origin/<mainBranch>` rebased. Das lokale `<mainBranch>` zieht der Skill danach nur nach, wenn keine Sperre des Runners liegt und der Haupt-Tree sauber ist — sonst gibt er das Kommando aus.

---

## Config (.claude/workflow.config.json)

Die Datei ist die einzige projektlokale Stelle, aus der die Skills lesen. Felder: `codeHost` (github | gitlab | local) und `issueTracker` (github | gitlab | local | toolbox); `buildChecks` mit optionalem `checkAreas` fuer bereichsbezogene Pruefungen, optionaler Stufenangabe `stufe`, optionaler Guetemessung `guete` und optionalem `nichtBeimAbschluss` fuer Pruefungen, die der Abschluss eines einzelnen Arbeitspakets nicht tragen muss; `mutationCommand` (oder leer); `mainBranch` und `productionBranch`; `reviewScope` (`diff` oder `all`) und genau eines von `reviewCommand` (fremde CLI) oder `reviewModel`; `triggers` fuer GO, Push und Merge; `local.issuesDir`; optional `issueReview` mit `reviewers`, `pairs` und `reviewStufen`. Persoenliche Abweichungen gehoeren in `.claude/workflow.config.local.json`. Ein Beispiel je Stack und die Feldbeschreibung stehen in der Kit-Dokumentation, Abschnitt „Die Config-Datei".

---

## Pflichtchecks vor Push (Schritt 6)

Alle **betroffenen** `buildChecks` aus der Config laufen gruen; unberuehrte Bereiche werden mit Nachweis ausgelassen. Rote Checks blockieren den Push weiterhin mechanisch. Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen. Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen. **Die Pruefungen laufen gestaffelt:** Jede traegt eine Stufe — `paket` beim Abschluss eines Arbeitspakets, `push` vor dem Veroeffentlichen, `merge` vor der Freigabe; ohne Angabe gilt `paket`. Eine spaetere Stufe laeuft an der frueheren **nicht mit** (eine Pruefung der Stufe `push` bleibt beim Abschluss eines Arbeitspakets aus), und `push` faehrt die **Vorgaengerstufe** mit (`push` fuehrt `paket` und `push` aus). `merge` prueft nur, was `push main` nicht geprueft hat, denn es gibt nie ein `merge production` ohne vorheriges `push main`: die Stufe `merge` immer, die Paketstufe nach Bereichen ueber die Release-Dateien, die Stufe `push` nicht. **Keine Pflichtpruefung entfaellt damit aus dem Gesamtprozess**; sie laeuft nur zu dem Zeitpunkt, an dem ihr Ergebnis zaehlt, und nicht zweimal fuer denselben Stand. Welche Pruefung in welche Stufe gehoert, entscheidet das Projekt. Die Stufe einer Pflichtpruefung (`stufe`) ist dabei etwas anderes als die Pruefstufen des Reviews (`reviewStufen`) und als die Stufen der Nacht-Kette: Sie sagt, *wann* geprueft wird, nicht wie gruendlich gelesen und nicht welcher Abschnitt eines unbeaufsichtigten Laufs dran ist. **Eine** seiner Pruefungen darf ein Projekt ausserdem als **Guetemessung** benennen (`guete` mit `muster` und `marke`): Sie misst, wie viele absichtlich eingebauten Fehler die Tests bemerken. Liegt der gemessene Anteil unter der Marke, ist das **derselbe Halt wie eine rote Pflichtpruefung** — kein neuer Stop-Punkt, keine Ausnahme, keine persoenliche Marke (die Marke gilt teamweit, eine Abweichung in `workflow.config.local.json` bleibt unwirksam). Der Halt kostet keine Arbeit: Er ist ein roter Lauf **vor Commit und Push**, die bereits fertigen Pakete bleiben lokal committet, und der Versionsbump von `/push-main` bleibt idempotent stehen — nach der Nachbesserung laeuft derselbe Batch weiter. **Ohne Benennung gibt es weder Messung noch Marke noch Halt.**

**Der Abschluss eines Arbeitspakets muss nicht jede Pruefung tragen.** Neben Zuordnung (`areas`/`always`), Zeitpunkt (`stufe`) und Guetemessung (`guete`) steht `nichtBeimAbschluss` als vierte Achse an einem Eintrag: Sie sagt, **warum** eine Pruefung den Abschluss einer einzelnen Karte nicht tragen muss — `zusammenspiel`, weil sie das Zusammenspiel mehrerer Teile prueft, oder `volleTestmenge`, weil sie ihren Befund nur aus der vollstaendigen Testmenge gewinnt. Sie wirkt **allein beim Lauf mit `--abschluss <kartennummer>`**, den die implement-Skills beim Abschluss genau einer Karte fahren, und nur an der Stufe `paket`. **Verschoben, nicht erlassen:** Jede so ausgelassene Pruefung laeuft **vor dem Veroeffentlichen** in `/push-main` — dort faehrt der Lauf unveraendert den vollen Umfang, und im Bericht des Abschlusslaufs steht sie als Auslassung mit ihrem Grund. **Ohne `--abschluss` faehrt jeder Lauf den heutigen Umfang** — `/local-check`, das Commit-Gate, die Nachpruefung des Nacht-Runners; wer die Achse nicht setzt, merkt von ihr ebenso nichts. Haelt der Lauf vor dem Veroeffentlichen an, nennt er von sich aus die Karten, deren Aenderung die rote Pruefung beruehrt; die Reparatur ist eine **neue Karte** — die genannte Karte wandert nicht aus „In review" zurueck.
**Der volle Lauf vor `push main` findet lokal statt, es sei denn, das Projekt verlegt ihn mit `pushPruefung` in seinen Build-Dienst** — dann pusht `/push-main` zuerst auf einen Pruefzweig und `mainBranch` erst, wenn der Build-Dienst gruen meldet; die Pflicht ist an beiden Orten dieselbe. **Die Push-Stufe laeuft beim `push main` oder in der Vorbereitung der Nacht für genau den Commit, den `push main` unverändert übernimmt; fährt das Projekt sie im Build-Dienst, läuft sie immer beim `push main` auf dem Prüfzweig.** Kein Commit ohne gruenen Nachweis, keine Uebernahme eines roten oder geaenderten Stands: `push main` uebernimmt eine Vorbereitung der Nacht (`.claude/push-vorbereitung.json`) nur mit dem Ergebnis gruen oder gruen mit offener Pruefung und nur, solange `mainBranch`, `origin/<mainBranch>` und der vorbereitete Commit unveraendert stehen; sonst prueft es vollstaendig wie ohne Vorbereitung. Was nachts offen blieb, holt `push main` nach.

---

## Lange Texte ans Board

**Jeder Text, den eine Sitzung ans Board schreibt, geht ueber eine Datei ausserhalb des Projektverzeichnisses — nie im Befehl selbst.** Erst `printenv TMPDIR` — bleibt die Ausgabe leer (Linux und WSL2 ohne Sandbox), gilt `/tmp` —, dann stueckweise `cat >` und `cat >>` in `<tmpdir>/<name>.md`, dann ein Aufruf mit `--text-file` bzw. `--body-file`. Vier Regeln, jede mit einem Beleg dahinter:

1. **Hoechstens 6.000 Zeichen je Werkzeugaufruf**, nicht je Datei. Die 6.000 sind eine **Beobachtung** vom 2026-09-10 im Kit-Repo: Aufrufe bis 9.722 Zeichen gingen durch, ab 10.154 wies der Befehls-Parser sie ab — auch ein `cat >>`, nicht nur der Board-Aufruf.
2. **Der Zielpfad steht woertlich im Befehl, nie als Variable.** Ein Variablen-Redirect wird unbeaufsichtigt als „path is runtime-determined" abgewiesen.
3. **Nur die Shell, kein Dateischreib-Werkzeug.** Unbeaufsichtigt sind Schreibzugriffe ausserhalb des Projektverzeichnisses damit abgewiesen, innerhalb von `.claude/` zustimmungspflichtig.
4. **Kein Pipe, keine Gruppierung um den Board-Aufruf.**

Eine Datei im Repo machte den Working Tree unsauber, und darauf stoppt der Nacht-Runner hart. Wer knapp schreibt, merkt von der Grenze nichts; wer gruendlich prueft, verloere sonst alles. **Benannte Ausnahme: `issue melden --text` und `--teil`.** Den Abschlussbericht einer Umsetzung traegt `issue melden <id> --text '<bericht>'` als Argument in einfachen Anfuehrungszeichen — ohne Zwischendatei, ohne Heredoc, ohne Pipe; ein `'` im Bericht wird als `'\''` geschrieben. Ueber 6.000 Zeichen geht er in nummerierten Stuecken (`issue melden <id> --teil <n> --text '…'`, jedes ein eigener Werkzeugaufruf), der abschliessende Aufruf `issue melden <id>` ohne `--text` setzt sie zusammen. Grund: Der Ablageort ausserhalb des Projektverzeichnisses war im gemessenen Lauf genau die Stelle, an der ein Bericht scheiterte und doppelt hinausging. Fuer `issue create`, `update` und `comment` gilt die Regel oben unveraendert.

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

Abhaengigkeits-Konvention: exakt "Keine." oder explizite Referenzen der Form `Issue #N`. Freitext zusaetzlich erlaubt, aber die `#N`-Referenz ist Pflicht, wenn ein anderes Issue gemeint ist — der Nacht-Runner (`kit/night.mjs`) wertet nur `#N`-Referenzen aus. Fremde Repos als `owner/repo#N` referenzieren (zaehlt nicht als lokales Issue). Jede lokale `#N` im Abschnitt zaehlt als Abhaengigkeit, auch in Erlaeuterungen: „Nicht #N: …" haelt das Paket genauso fest wie `Issue #N`. Nur Verweise der Form `owner/repo#N` zaehlen nicht. Eine Verweiszeile beginnt nach optionalem Leerraum und optionalem Listenzeichen (`-`, `*`, `+`, `1.`) mit `Issue #N` und traegt keine weitere lokale Nummer; der Zusatz `(wartet auf Push)` dahinter sagt, dass das Paket das geaenderte Werkzeug, den Skill oder den Regeltext des anderen Pakets als Werkzeug braucht und erst nach dessen Push laufen kann — baut es nur auf dessen Code auf, entfaellt der Zusatz; jede andere Nummer stammt aus erlaeuterndem Text, auch eine im Codeblock des Abschnitts. Beim Schreiben melden `issue check-form`, `issue create` und `issue update` unter `hinweise` je Nummer aus Text einen Eintrag `schreibweise` und je Verweis auf ein Dokument (`[Plan]`, `[Fachlich]`, `[Idee]`) einen Eintrag `dokument`, auch aus einer Verweiszeile, und je Nummer, die das Board nicht kennt, einen Eintrag `unbekannt` — ohne `ok` oder den Exit-Code zu beruehren. Unerfuellt ist eine Abhaengigkeit nur, solange ihre Karte in Backlog, Ready oder In progress liegt; jede andere Lage — In review, Done, archiviert, nicht auf dem Board — gilt als erfuellt, auch eine vertippte Nummer. Antwortet das Board nicht, bleibt das Paket liegen. Der Dokument-Hinweis sagt: Das Dokument ist kein Arbeitspaket und wird nicht durch Umsetzung erledigt, ein Plandokument nie, eine fachliche Anforderung oder Idee erst, wenn ihre Pakete fertig sind; der Nachtlauf wertet den Verweis trotzdem als Abhaengigkeit. Probelauf (`night.mjs --dry-run`) und Rueckstell-Kommentar nennen je Abhaengigkeit, erfuellt oder unerfuellt, ihre Herkunft (Verweiszeile oder erlaeuternder Text) mit der Textstelle. Halten sich Pakete gegenseitig fest, direkt oder ueber eine Kette, steht der Kreis-Befund als eigene Zeile `Kreis: #A -> #B -> #A`; ein Paket, das nicht selbst im Kreis steht, sondern ueber seine unerfuellten Abhaengigkeiten daran haengt, bekommt den Zusatz „dieses Paket wartet auf einen Kreis".

Herkunfts-Konvention: `issue create --derived-from <nummer>` traegt die Kartennummer des naechsten Vorfahren zusaetzlich als Feld ans Board — `/fachplan` nie (Wurzel), `/task` nie (kein Vorfahr), `/techplan` auf das fachliche Issue, `/issues` auf das Plandokument. Die Body-Zeilen `Plan:` und `Fachliche Quelle:` bleiben daneben stehen: Ein Projektwechsel loescht das Feld, der Text ueberlebt ihn. Nur beim Anlegen wirksam, Nachtragen gibt es nicht.

### Vier Titel-Praefixe, vier Sonderfaelle

Ein Issue ohne Praefix ist ein Arbeitspaket im Vier-Abschnitt-Format oben. Vier Praefixe kennzeichnen Karten, die **keine Session umsetzt**; implement-Skills und Nacht-Runner stellen sie mechanisch kommentiert ins Backlog zurueck, ohne eine Session zu starten. Die ersten drei sind Dokumente und gehen nie nach Ready; `[Mensch]` ist ein Arbeitspaket, das nur ein Mensch erledigen kann.

| Praefix | Was es ist | Weg nach vorn |
|---------|-----------|---------------|
| `[Fachlich]` | fachliche Anforderung aus `/fachplan`, Story-Format | mit dem PO groomen, dann `/techplan #N` |
| `[Plan]` | Plandokument aus `/techplan`, verbindliches Plan-Format | `/issues #N` zerlegt es in Arbeitspakete |
| `[Idee]` | rohe Idee, noch kein Dokument | Abwaegung noetig: `/fachplan #N` — sonst `/task #N` |
| `[Mensch]` | Arbeitspaket, dessen Aufgabe ausserhalb des Repositories liegt | der Mensch handelt und zieht die Karte selbst weiter |

**Plandokumente** (`[Plan]`) halten den freigegebenen Stand fest, statt ihn umzusetzen. Ein Plan beschreibt einen Weg, er ist keine Aufgabe: Er wird **nie implementiert**, geht **nie nach Ready** und wird zuerst mit `/issues #N` in Arbeitspakete zerlegt. Sein Format ist verbindlich — genau diese sechs Ueberschriften in dieser Reihenfolge:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

**Done setzt der Mensch** — auch hier. Nach **In review** zieht das Kit Plandokument und fachliche Anforderung, sobald der Plan durch ist: mindestens eines seiner Arbeitspakete liegt feststellbar in In review oder Done, keines in Backlog, Ready oder In progress. Die fachliche Anforderung zieht es erst, wenn jeder ihrer nicht als ueberholt vermerkten Plaene durch ist. Was schon in In review oder Done liegt, bleibt dort. Das gilt gleich, welcher Weg das letzte Paket gebaut hat — Nacht-Kette, Umsetzungsnacht oder Sitzung am Tag. In review heisst fuer Ursprungsdokumente ausschliesslich: alles gebaut, Review dran.

**Ideen** (`[Idee]`) sind eine rohe Anforderung, kein implementierbares Issue — sie haben genau zwei Wege nach vorn, und welcher gilt, haengt an einer Frage: Verlangt die Idee eine Abwaegung, ist `/fachplan #N` der Weg und macht aus ihr eine fachliche Anforderung; ist nichts abzuwaegen oder hat der Mensch bereits entschieden, wird sie per `/task #N` genau ein Arbeitspaket. Den Fall entscheidet der Mensch mit dem Aufruf — ein Skill, der ihn sich selbst beantwortet, traefe die Entscheidung, die er abgeben soll. Der Weg direkt in einen technischen Plan gilt nicht — er wuerde die Stelle ueberspringen, an der ueber das Ziel entschieden wird. Ohne das Gate wuerde eine Session eine Idee in Ready zwar korrekt ablehnen, aber der Runner kann diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist verbrannt und der Kommentar am Board irrefuehrend.

**Menschenschritte** (`[Mensch]`) sind Arbeitspakete im Vier-Abschnitt-Format, aber ihre Aufgabe liegt ausserhalb des Repositories: eine Einstellung in einer Weboberflaeche, ein Konto, ein Zugang, eine Freigabe. Kein Zug einer Sitzung erledigt sie, deshalb startet keine. Bei der Formpruefung fallen sie in die Stufe `issue` wie jedes andere Paket. Der Rueckgabe-Kommentar sagt ausdruecklich, dass die Karte **wartet** und nicht gescheitert ist — im Backlog sieht sie sonst aus wie ein gescheitertes Paket, und wer morgens die Spalten liest, findet sie nicht mehr da, wo er sie hingelegt hat. Ohne das Gate startete der Runner eine Session, die den Fall richtig erkennt und nichts tut; er kann diese richtige Untaetigkeit nicht von einem Fehlschlag unterscheiden.

**`[Task]` ist das einzige Praefix, das ein implementierbares Arbeitspaket kennzeichnet**; es wird implementiert und nach Ready gezogen wie ein Paket ohne Praefix. Die vier Praefixe der Tabelle oben bezeichnen Karten, die keine Session umsetzt — `[Task]` gehoert ausdruecklich nicht dazu, und es in dieselbe Liste aufzunehmen kehrte seinen Zweck um. Auch `[Mensch]` ist ein Arbeitspaket, aber eines, das seine Aufgabe nicht im Repository hat; `[Task]` bleibt das einzige Praefix, dessen Paket eine Sitzung baut.

---

## Abschlussbericht-Format

```
### Aenderungen
- `Datei` — kurze Beschreibung der Wirkung

### Tests und Checks
- <Zeilen aus dem Block `Fuer den Abschlussbericht:` von `checks.mjs run`, wortgetreu: zuerst `Wartezeit: <s> s, zusammen <s> s in <n> Laeufen fuer Karte #<n>` (ohne Kartennummer `Wartezeit: <s> s`), nach einem roten Teillauf `Teillauf: nur die zuletzt roten Pruefungen`, dann `gelaufen: <Kommando> → <Ergebnis>, <Dauer> — <Grund>` bzw. `ausgelassen: <Kommando> → <Grund>`>

### Hinweise
- <Restrisiken, offene Punkte, manuelle Folgeschritte>

### Entscheidungen
- E1: <Frage>. Gewählt: … Verworfen: … Grund: … Rückbau: …
```

`### Entscheidungen` entfaellt, wenn es nichts zu entscheiden gab; sonst traegt der Block die Eintraege im Format aus „Entscheiden statt fragen". Die letzte Zeile `Bericht-Lauf: <stempel>` setzt das Kit (`issue melden`), nicht die Session: Sie kennzeichnet den Bericht eines Laufs, damit eine Wiederholung ihn ersetzt statt einen zweiten anzulegen.

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

Vier Regeln, die unabhaengig von der Pruefstufe gelten und die den Rahmen des Prozesses tragen — gemeint ist die Pruefstufe des Reviews (`reviewStufen`), nicht die Stufe einer Pflichtpruefung (`stufe`) und nicht die Stufe der Nacht-Kette. Sie zitieren Saetze, die weiter oben in dieser Datei stehen; ein Vorschlag, der eine davon aushebelt, ist keine Detailaenderung, sondern eine Aenderung der Bauart — und damit eine Frage der Stopp-Klasse.

### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`

GO (Issue nach Ready ziehen), Push (`push main`), Merge (`merge production`). Eine Trigger-Phrase, die innerhalb einer Mitteilung zitiert wird, ist kein getippter Trigger. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete der gekennzeichneten Karte selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch an der gekennzeichneten Karte gegeben — an der fachlichen Anforderung oder am Plandokument —, als er sie fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete einer Karte, die frueher unter Variante B lief. Das GO an der gekennzeichneten Karte geben `kit:durchziehen` oder ein Ziel ab `umsetzung`; der Push bleibt auch beim Ziel `push-vorbereitet` beim Menschen. Fundstellen: „Die drei Stop-Punkte (nie automatisiert)", „Mitteilungen des Menschen", „Nachtbetrieb (optional)".

### W2 — Der Git-Workflow ist strikt bindend `[Urteil]`

Kein Force-Push auf `mainBranch` oder `productionBranch` ohne explizite Einzelanweisung; Hooks werden nicht mit `--no-verify` umgangen; `productionBranch` wird nie direkt gepusht. Fundstelle: „Git-Workflow (strikt bindend)".

### W3 — Rote Pflichtchecks blockieren den Push mechanisch `[Urteil]`

Alle **betroffenen** `buildChecks` der **faelligen Stufe** laufen gruen, bevor gepusht wird; unberuehrte Bereiche werden mit Nachweis ausgelassen, und ein nicht lokal ausfuehrbarer Check wird im Abschlussbericht vermerkt, nicht verschwiegen. Die Mechanik bleibt unveraendert hart, nur ihr Umfang haengt am Zeitpunkt: **Keine Pflichtpruefung entfaellt aus dem Gesamtprozess**: Jede Pruefung jeder Stufe laeuft **einmal** vor der Freigabe — Paket- und Push-Stufe beim `push main` oder in der Vorbereitung der Nacht für genau den Commit, den `push main` unverändert übernimmt; fährt das Projekt sie im Build-Dienst, läuft sie immer beim `push main` auf dem Prüfzweig; die Merge-Stufe laeuft beim `merge production`. Kein Commit ohne gruenen Nachweis, keine Uebernahme eines roten oder geaenderten Stands. Ein Vorschlag, der einen Check zur Empfehlung macht oder eine Schwelle senkt, hebt die Mechanik auf. **Eine Guetemessung unter ihrer Marke ist ein Fall genau dieser Mechanik**: ein roter Pflichtcheck, der wie jeder andere blockiert — **kein vierter Stop-Punkt**, keine eigene Entscheidungsstelle, und die Marke zu senken ist die Schwellensenkung aus dem Satz davor. Fundstelle: „Pflichtchecks vor Push (Schritt 6)".

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
