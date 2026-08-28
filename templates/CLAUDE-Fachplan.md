# CLAUDE-Fachplan.md — Gates fuer die fachliche Anforderung

**Stand 2026-08-28.** Review durch fable eingearbeitet, offene Entscheidungen getroffen.

Diese Datei ist ein **Gate-Register**, kein Ratgeber. Jede Zeile hier ist eine Regel, gegen
die ein Dokument verstossen *kann* — pruefbar und benennbar. Wer beim Review sagt "F5
verletzt", zeigt auf eine Stelle, nicht auf einen Geschmack.

**Wozu:** `/issue-review` klassifiziert einen Fund als `gate` (ab Etappe 5 aus Plan #368 —
heute klassifiziert der Skill noch nicht). Dann wird nicht automatisch angewendet, sondern
`kit:klaeren` gesetzt und ein Mensch gerufen (Plan #368, A9).

**Ein Fund ist `gate`, wenn eines von beiden zutrifft:**

1. Er zeigt, dass das **Dokument** gegen eine dieser Regeln verstoesst — dann nennt er
   die Nummer („F5 verletzt").
2. Das, was er **vorschlaegt**, wuerde bei Uebernahme gegen eine dieser Regeln
   verstossen. Das ist die Richtung aus Plan #368, A9.

Beide Richtungen zaehlen (Entscheidung vom 2026-08-28). Der Grund fuer beide: In dem
einen Fall ist die Regel schon verletzt, in dem anderen wuerde das automatische Anwenden
sie verletzen — der Schaden ist derselbe, also ist die Behandlung dieselbe.

Alles, was hier **nicht** steht, ist kein *Gate*. Ob ein solcher Fund trotzdem einen
Menschen ruft, entscheidet allein Ausloeser 2 aus A9 (mehrere sinnvolle Alternativen) —
das ist eine Eigenschaft des Fundes, nicht dieses Registers.

**Was hier nicht steht:** die prozessweiten Gates (drei Stop-Punkte, Git-Workflow,
Pflichtchecks, Prioritaeten bei Zielkonflikten). Die stehen in `CLAUDE-workflow.md` und
gelten daneben.

`[maschinell]` heisst: ohne menschliches Urteil pruefbar. `[Urteil]` heisst: ein Mensch
oder ein Modell muss lesen und abwaegen — auch das ist ein Gate, aber es taugt nicht als
Testfall.

`[maschinell + Urteil]` heisst: Die beiden Richtungen des Gates liegen verschieden —
eine ist testbar, die andere nicht. Welche welche ist, steht beim Gate.

## Wie die maschinellen Gates gelesen werden

Gilt fuer jedes `[maschinell]`-Gate und damit fuer jeden Test, der spaeter daraus wird:

- **Fence-Regel (Issue #308).** Der Body wird ohne Codebloecke gelesen. Eine Zeile
  innerhalb eines Fence existiert fuer die Pruefung nicht — auch nicht als Verstoss.
  Ohne diese Regel zaehlt jedes Dokument, das das Issue-Format an einem Beispiel zeigt,
  seine Ueberschriften doppelt.
- **Umlaute zaehlen in beiden Schreibweisen.** `Änderungen` und `Aenderungen`,
  `Fachliche Akzeptanzkriterien` mit und ohne transliterierte Umlaute sind jeweils
  dieselbe Ueberschrift. Das Repo schreibt ueberwiegend transliteriert; ein Test auf nur
  eine Form waere am eigenen Bestand rot.

---

## F1 — Die vier Abschnitte, genau einmal und in dieser Reihenfolge `[maschinell]`

`## Ziel`, `## Fachliche Akzeptanzkriterien`, `## Nicht-Ziele`, `## Offene Fragen an den PO`.

Weitere `##`-Ueberschriften sind erlaubt; die vier muessen vorhanden sein und
untereinander in dieser Reihenfolge stehen. (Anders als im Plan-Register, wo P2
zusaetzliche `##`-Ebenen verbietet — der `/fachplan`-Skill kennt kein solches Verbot.)

*Warum Gate:* An diesen Ueberschriften haengen `/plan` und `/issue-review`. Sinngemaess
umformuliert wirken sie nicht.

## F2 — `Autor-Modell:` steht im Abschnitt `## Ziel` und ist nie leer `[maschinell]`

*Warum Gate:* Ohne sie ist nicht bestimmbar, welches Modell pruefen darf, ohne sein
eigenes Dokument zu lesen. Ein Pruefer, der seinen eigenen Text liest, ist keiner.

## F3 — Keine Loesung vorschreiben `[Urteil]`

Die Anforderung sagt, **was gelten soll**, nicht **wie es gebaut wird**. Verboten sind
Vorgaben zur Umsetzung: welche Datei geaendert, welche Funktion eingefuehrt, welche
Struktur gewaehlt wird.

**Erlaubt ist, das Werkzeug beim Namen zu nennen, um das es geht.** In einem Repo, dessen
Fachlichkeit selbst Technik ist, waere alles andere Theater: „`board.mjs` soll die
Herkunft mitschicken koennen" ist eine legitime Anforderung. „In `board.mjs` eine
Funktion `sendeHerkunft()` einfuehren" ist keine.

**Das gilt auch fuers Ziel:** „Der Nutzer sieht X" statt „wir bauen Y". Ein als Loesung
formuliertes Ziel schliesst Alternativen aus, bevor jemand sie erwogen hat.

**Massstab:** Bleibt nach dem Lesen noch mehr als ein Weg offen, wie man es baut? Dann
ist es eine Anforderung. Steht der Weg schon fest, ist es ein Plan im falschen Dokument.

*Warum Gate:* Steht die Loesung schon in der Anforderung, prueft der Plan sie nicht mehr —
er schreibt sie ab. Die fachliche Stufe existiert genau dafuer, das zu trennen.

## F4 — gestrichen am 2026-08-28

War „Das Ziel beschreibt eine Nutzerwirkung, keine Loesung" — der auf einen Abschnitt
angewandte Spezialfall von F3, entschieden vom selben Massstab. Der Satz steht jetzt in
F3. **Die Nummer bleibt frei**, damit aeltere Befunde („F4 verletzt") eindeutig bleiben.

## F5 — Jedes fachliche Akzeptanzkriterium ist aus Nutzersicht beobachtbar `[Urteil]`

Nicht technisch pruefbar — das ist eine spaetere Stufe. Die Frage lautet: **Woran wuerde
ein Mensch, der die Software benutzt, merken, dass es erfuellt ist?**

*Warum Gate:* Ein Kriterium, das man nicht beobachten kann, kann man auch nicht abnehmen.

## F6 — `## Ziel`, `## Fachliche Akzeptanzkriterien` und `## Nicht-Ziele` sind nicht leer `[maschinell]`

Geprueft wird die Leere, nicht die Qualitaet. Ob ein vorhandener Eintrag nur ein
Platzhalter ist (`- TBD`, `- siehe oben`), prueft die Rolle `form-beobachtbarkeit` — das
ist Urteil und kein Testfall.

*Warum Gate:* Die drei Abschnitte tragen den Inhalt der Anforderung. Ein leerer
`## Nicht-Ziele` heisst nicht „alles erlaubt", sondern „niemand hat darueber nachgedacht";
ein leeres `## Ziel` laesst den Plan raten.

## F7 — Der Abschnitt `## Offene Fragen an den PO` ist vorhanden `[maschinell]`

Was darin steht, ist frei: konkrete Fragen, dokumentierte Antworten des PO, ein Vermerk,
dass keine offen sind — oder nichts.

*Warum Gate:* Der Abschnitt ist der Ort, an dem die PO-Schleife stattfindet. Fehlt er
ganz, gibt es ihn nicht.

*Warum nur so weit:* Ein leerer Abschnitt ist unschoen und von „noch nicht gegroomt"
nicht zu unterscheiden — aber das ist ein Hinweis wert, keine Blockade. Wer daraus ein
Gate macht, haelt Anforderungen an einer Formulierung auf.

## F8 — Was gilt, steht im Body; Kommentare sind Verlauf `[Urteil]`

Antworten des PO gehoeren hinter die jeweilige Frage **in den Body**, nicht in einen
Kommentar.

**Nur mit den Kommentaren pruefbar.** `board.mjs issue get` liefert sie mit; wer sie nicht
gelesen hat, kann F8 nicht bewerten. Die Rollen-Prompts, die nur den Body uebergeben,
koennen dieses Gate nicht pruefen.

*Warum Gate:* Wer eine Entscheidung nur kommentiert, zwingt jede spaetere Session, sie aus
einer Diskussion zu rekonstruieren — und die Anforderung hat dann keinen eindeutigen Stand.

## F9 — Die Wurzel traegt keine Herkunftszeile `[maschinell]`

Weder `Fachliche Quelle: Issue #N` noch `Plan: Issue #M`.

Das Verbot, beim Anlegen `--derived-from` zu setzen, steht im `/fachplan`-Skill und ist
hier **kein** Testgegenstand: `board.mjs issue get` liefert das Feld `derivedFrom` nicht
zurueck, am fertigen Dokument ist es also nicht ablesbar.

*Warum Gate:* Das fachliche Issue **ist** die Wurzel der Kette. Ein Verweis von hier zeigt
ins Leere oder auf eine fremde Karte. Der Herkunfts-Leser wertet beide Zeilenmuster, also
verbietet das Gate auch beide.

## F10 — Ziel, Kriterien und Nicht-Ziele widersprechen sich nicht `[Urteil]`

Kein Akzeptanzkriterium verlangt etwas, das ein Nicht-Ziel ausschliesst.

*Warum Gate:* Der Widerspruch wird sonst im Plan aufgeloest — also von jemandem, der
nicht entscheiden darf, was das Produkt tun soll.

## F11 — Das Dokument traegt keine `Issue-Review:`-Zeile `[maschinell]`

Der Marker dieser Stufe heisst `Fachplan-Review:`.

*Warum Gate:* An `Issue-Review:` haengt in `kit/night.mjs` das Gate `requiredBeforeReady`
(Zeile 394, `/^\s*Issue-Review:\s*\S/im`). Traegt eine fachliche Anforderung diesen
Marker, haelt der Nacht-Runner sie fuer ein freigabereifes Arbeitspaket und zieht sie in
die Implementierung.

---

## Ausdruecklich kein Gate

Damit der Reviewer nicht alles zum Gate erklaert:

- **Laenge, Ton, Gliederungstiefe.** Ein knapper Text ist nicht schlechter.
- **Anzahl der Akzeptanzkriterien.** Drei koennen genug sein, zwoelf koennen noetig sein.
- **Ob ein fachliches Akzeptanzkriterium technisch oder maschinell pruefbar ist.** Das ist
  die Frage der spaeteren Stufe, nicht dieser. F5 fragt nach Beobachtbarkeit aus
  Nutzersicht — mehr nicht.
- **Ob eine offene Frage "wichtig genug" ist.** Wer sie stellt, entscheidet das.
- **Ein leerer Abschnitt `## Offene Fragen an den PO`** (siehe F7).
- **Technische Begriffe an sich.** Erst eine vorgeschriebene Loesung verletzt F3.
- **Schreibweise und Terminologie**, solange F3 gewahrt bleibt.

Ein Fund zu diesen Punkten ist trotzdem ein Fund — er wird angewendet oder verworfen. Ob
er einen Menschen ruft, entscheidet Ausloeser 2 aus A9, nicht dieses Register.

---

## Verbrannte Nummern

Nummern werden nie neu vergeben, damit ein aelterer Befund eindeutig bleibt.

- **F4** — gestrichen am 2026-08-28, aufgegangen in F3.
