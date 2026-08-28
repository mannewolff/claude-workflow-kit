# CLAUDE-Plan.md — Gates fuer das Plandokument

**Stand 2026-08-28.** Review durch fable eingearbeitet, offene Entscheidungen getroffen.

Gate-Register fuer die Stufe `plan`. Aufbau und Zweck wie in `CLAUDE-Fachplan.md`: Was
hier steht, ist eine Regel, gegen die ein Plan verstossen kann — und ein Verstoss setzt
`kit:klaeren`, statt automatisch angewendet zu werden (Plan #368, A9; klassifiziert wird
ab Etappe 5 aus #368, heute noch nicht).

**Wann ein Fund `gate` ist** — beide Richtungen, Dokument-Verstoss und Verstoss durch den
Vorschlag — steht in `CLAUDE-Fachplan.md` und gilt fuer dieses Register genauso.

Alles, was hier **nicht** steht, ist kein *Gate*. Ob ein solcher Fund trotzdem einen
Menschen ruft, entscheidet allein Ausloeser 2 aus A9 (mehrere sinnvolle Alternativen) —
das ist eine Eigenschaft des Fundes, nicht dieses Registers.

Die prozessweiten Gates stehen in `CLAUDE-workflow.md` und gelten daneben.

## Wie die maschinellen Gates gelesen werden

Gilt fuer jedes `[maschinell]`-Gate und damit fuer jeden Test, der spaeter daraus wird:

- **Fence-Regel (Issue #308).** Der Body wird ohne Codebloecke gelesen. Eine Zeile
  innerhalb eines Fence existiert fuer die Pruefung nicht — auch nicht als Verstoss.
  Plandokumente zitieren die Pflichtabschnitte regelmaessig als Beispiel; ohne diese
  Regel zaehlt der Test sie doppelt.
- **Umlaute zaehlen in beiden Schreibweisen.** `## Geplante Änderungen` und
  `## Geplante Aenderungen` sind dieselbe Ueberschrift. Das Repo schreibt ueberwiegend
  transliteriert — Plan #368 selbst schreibt `Aenderungen` —, ein Test auf nur eine Form
  waere am eigenen Bestand rot.

---

## P1 — Die sechs Abschnitte, genau einmal und in dieser Reihenfolge `[maschinell]`

`## Ziel`, `## Betroffene Bereiche`, `## Architektonische Entscheidungen`,
`## Geplante Änderungen`, `## Offene Fragen`, `## Verifizierung`.

*Warum Gate:* Sie sind der Anker, an dem die Plan-Pruefung und `/issues` arbeiten.
Umbenannt, zusammengefasst oder umsortiert wirken sie nicht.

## P2 — Dazwischen keine weiteren `##`-Ueberschriften `[maschinell]`

Unterueberschriften ab `###` sind erlaubt.

*Warum Gate:* Eine zusaetzliche `##`-Ebene zerschneidet die Abschnitte fuer jeden
Leser, der sie maschinell trennt.

## P3 — `Plan-Modell:` steht im Kopf, vor `## Ziel` `[maschinell]`

*Warum Gate:* Ohne die Zeile ist nicht bestimmbar, wer den Plan entworfen hat — und die
Issues daraus tragen ihr eigenes `Autor-Modell`. Ohne sie bricht die Kette genau
dazwischen ab.

## P4 — `Fachliche Quelle: Issue #N` steht genau dann, wenn der Plan daraus entstand `[maschinell + Urteil]`

Entstand der Plan aus `/plan #N` gegen ein `[Fachlich]`-Issue: Zeile steht. Sonst: Zeile
fehlt, auch kein Platzhalter.

**`[maschinell]` ist davon nur die vorhandene Zeile:** #N muss existieren oder
nachweislich existiert haben und `[Fachlich]` tragen. **Eine spaeter geloeschte Quelle
ist kein Verstoss** — die Body-Zeile ist gerade die ueberlebende Spur, wenn die Karte
weg ist (Idee #367; #300 verweist auf das geloeschte #285).

**Die Fehlen-Richtung ist `[Urteil]`:** Ob eine fehlende Zeile fehlen *darf*, haengt an
der Entstehung (`/plan #N` oder freies Gespraech) und steht in keinem abfragbaren Feld.

*Warum Gate:* Eine erfundene Quelle behauptet eine Verhandlung, die nie stattgefunden hat.

## P5 — Jede architektonische Entscheidung traegt eine Begruendung `[Urteil]`

Eine Entscheidung ohne Begruendung ist ein Fund, kein Stil-Hinweis.

*Warum Gate:* Ohne Begruendung ist die Entscheidung im Review nicht angreifbar — man kann
ihr nur glauben oder nicht. Genau dafuer gibt es die Stufe.

## P6 — Kein Pflichtabschnitt ist leer; `- Keine.` nur wo erlaubt `[maschinell]`

Keiner der sechs Abschnitte ist leer. In `## Architektonische Entscheidungen` und
`## Offene Fragen` — und nur dort — darf ersatzweise `- Keine.` stehen.

**`- Keine.` steht als erste Zeile.** Ein erlaeuternder Zusatz dahinter ist erlaubt (etwa
der Verweis, wo entschieden wurde: `- Keine. Die Richtungsentscheidung steht in A8.`),
weitere Eintraege sind es nicht. Ein reiner Gleichheits-Test waere am Bestand rot — #325,
#326 und #368 schreiben alle drei einen Zusatz.

*Warum Gate:* Ein leerer Abschnitt ist von einem vergessenen nicht zu unterscheiden.
`- Keine.` ist eine Aussage, Leere ist keine.

## P7 — Unter `## Offene Fragen` stehen nur Stopp-Fragen `[Urteil]`

Stopp-Frage heisst: **Die Antwort aendert den Zuschnitt des Plans.** Nachtraeglich
entscheidbare Fragen gehoeren nicht dorthin.

*Warum Gate:* Der Abschnitt sperrt den Weg nach `/issues`. Wer ihn mit Details fuellt,
blockiert den Plan an etwas, das keine Blockade ist.

*Warum das anders liegt als die gestrichene Zerlegbarkeit (P11):* An P7 haengt eine
**Blockadewirkung** — eine zu Unrecht dort stehende Frage sperrt den Plan. Die
Zerlegbarkeit hatte diese Wirkung nie; sie war eine Qualitaetsfrage, die sich fast
beliebig anwenden liess. Deshalb ist P7 ein Gate und P11 keins. (Die *fehlende*
Stopp-Frage erfasst P7 nicht — das ist Sache der Rolle `schnitt-abhaengigkeiten`.)

## P8 — gestrichen am 2026-08-28

War „Ein Plan mit mindestens einer offenen Stopp-Frage geht nicht in `/issues`". Das ist
eine **Prozessregel, kein Dokument-Gate**: Ein Dokument kann dagegen nicht verstossen,
nur ein Lauf — und zum Review-Zeitpunkt, vor `/issues`, ist ein Verstoss gar nicht
moeglich. Der Fehlerpfad steht im `/plan`-Skill; die pruefbare Form deckt P6 ab.
**Die Nummer bleibt frei**, damit aeltere Befunde eindeutig bleiben.

## P9 — `## Verifizierung` beschreibt Pruefungen, nicht ihr Ergebnis `[Urteil]`

"`node --test` laeuft" ist eine Pruefung. "Alle Tests sind gruen" ist ein vorweggenommenes
Ergebnis.

*Warum Gate:* Ein Plan, der das Ergebnis behauptet, kann nicht mehr scheitern — und ein
Nachweis, der nicht scheitern kann, ist keiner.

## P10 — Jede Behauptung ueber den Bestand stimmt `[Urteil]`

Genannte Dateien, Funktionen, Kommandos und Config-Felder existieren und heissen so.

*Warum Gate:* Ein falscher Bestandsverweis wandert unbemerkt in jedes Arbeitspaket. Am
2026-08-08 wies ein Reviewer nach, dass ein im Plan referenziertes Kommando im Adapter gar
nicht existierte — es waere in dreizehn Pakete gewandert.

## P12 — Das Dokument traegt keine `Issue-Review:`-Zeile `[maschinell]`

Der Marker dieser Stufe heisst `Plan-Review:`.

*Warum Gate:* An `Issue-Review:` haengt in `kit/night.mjs` das Gate `requiredBeforeReady`
(Zeile 394, `/^\s*Issue-Review:\s*\S/im`). Traegt ein Plandokument diesen Marker, haelt
der Nacht-Runner es fuer ein freigabereifes Arbeitspaket und zieht es in die
Implementierung.

---

## Ausdruecklich kein Gate

- **Wie viele Entscheidungen ein Plan hat.** Drei koennen reichen.
- **Wie fein `## Geplante Änderungen` gegliedert ist.**
- **Ob eine Entscheidung die *beste* ist** — nur, ob sie begruendet ist (P5). Eine
  begruendete Entscheidung, die ein Reviewer fuer falsch haelt, ist ein Fund mit
  Alternativen (A9, Ausloeser 2), kein Gate-Verstoss.
- **Ob die Verifizierung vollstaendig ist.** Gate ist nur ihre Form (P9). Ob sie genug
  prueft, ist Rollenurteil.
- **Ob eine Stopp-Frage fehlt.** P7 erfasst nur zu Unrecht enthaltene Fragen; die
  fehlende prueft die Rolle `schnitt-abhaengigkeiten` (Frage 5).
- **Laenge und Ton.**
- **Ob der Plan gut schneidbar ist.** Das prueft die Rolle `schnitt-abhaengigkeiten` im
  Plan-Review und gehoert dort hin: Ein schlecht schneidbarer Plan ist ein Fund mit
  Alternativen, kein Regelverstoss.

Ein Fund zu diesen Punkten ist trotzdem ein Fund — er wird angewendet oder verworfen. Ob
er einen Menschen ruft, entscheidet Ausloeser 2 aus A9, nicht dieses Register.

---

## Verbrannte Nummern

Nummern werden nie neu vergeben, damit ein aelterer Befund eindeutig bleibt.

- **P8** — gestrichen am 2026-08-28, Prozessregel statt Dokument-Gate.
- **P11** — „zerlegbar", auf Mannes Entscheidung vom 2026-08-27 nie in Kraft getreten,
  weil es sich fast beliebig anwenden liess. Zustaendig ist die Rolle
  `schnitt-abhaengigkeiten`.
