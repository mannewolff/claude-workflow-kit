## Synthese, Runde 1

Stufe `fachlich`, zwei Prüfer, 15 Funde (1 BLOCKER, 9 WICHTIG, 5 HINWEIS).
Entschieden im Gespräch mit dem Menschen, nicht von der Maschine — beide `gate`-
und `alternativen`-Punkte lagen ihm zur Wahl vor.

### Entscheidungen

- fable, "Ziel verspricht, was ein Nicht-Ziel ausschließt" (BLOCKER, `gate` F10) —
  **übernommen** → Nicht-Ziele: "**Nicht der Fall, dass ein übernommener Fund inhaltlich falsch war.**", aber auf einem dritten Weg. Der Mensch entschied „Scope halten":
  Der Fall vom 2026-09-10 ist aus Ziel und Abnahme entfernt und steht nun als
  eigenes Nicht-Ziel.
- fable, "Weg (a): Kriterium 8 um übernommene Funde erweitern" — **verworfen**:
  Der Vorschlag prüft Behauptungen über den *Dokumentzustand*. Am 2026-09-10 war
  es eine Behauptung über den *Bestand* (`review:ausgefallen` existiert in
  `board.mjs` nicht). Weg (a) hätte den Fall ebenso wenig gefangen und den
  Widerspruch nur verdeckt.
- gpt-astra, "Der zweite Schadensfall liegt nicht erkennbar im Prüfbereich"
  (WICHTIG, `korrektur`) — **übernommen** → Nicht-Ziele: "behauptete ein Prüfer einen Zustand, den es im Bestand nicht gibt;", deckungsgleich mit fable Fund 1.
- fable, "Schritt 2 steht als Lieferumfang, obwohl offen ist, ob er kommt"
  (WICHTIG, `alternativen`) — **übernommen** → Fachliche Akzeptanzkriterien: "Die Anforderung wird in **zwei Schritten** geliefert;" in der Variante „verbindlich", vom
  Menschen entschieden. Nicht abgetrennt (fables Empfehlung), sondern beide
  Schritte im Lieferumfang; offene Frage 2 entfällt.
- gpt-astra, "Verbindlichkeit von Schritt 2 ist uneindeutig" (WICHTIG,
  `alternativen`) — **übernommen** → Fachliche Akzeptanzkriterien: "Schritt 2 beginnt nach der Inbetriebnahme von Schritt 1.", dieselbe Entscheidung.
- fable, "Im Tagbetrieb ist nicht gesagt, was der Mensch anders erlebt" (WICHTIG,
  `alternativen`) — **übernommen** → Fachliche Akzeptanzkriterien: "Befund, **bevor** er gefragt wird, ob er den Vorschlag übernimmt", Kriterium 3 nennt jetzt den Zeitpunkt: Der
  Befund steht vor der Frage nach der Zustimmung.
- fable, "'Es geht nicht nach Ready' beschreibt nichts, was das System tut"
  (WICHTIG, `alternativen`) — **übernommen** → Fachliche Akzeptanzkriterien: "Nach einem Befund **gilt das Dokument als nicht geprüft**." in Variante (a), informierend.
  Kriterium 4 sagt jetzt „gilt als nicht geprüft" statt „geht nicht nach Ready".
- fable, "'der geschärfte Text' ist zweideutig" (WICHTIG, `alternativen`) —
  **übernommen** → Fachliche Akzeptanzkriterien: "**Maßstab ist der Text, den die Synthese meint**": Maßstab ist der vorgeschlagene neue Body, nicht der geschriebene.
- gpt-astra, "Grenze der Prüfung von Verwerfungsbegründungen fehlt" (WICHTIG,
  `korrektur`) — **übernommen** → Fachliche Akzeptanzkriterien: "vorliegenden Unterlagen nicht widerspricht** — nicht, ob sie sachlich zutrifft.", Kriterium 8 zieht die Grenze wörtlich.
- gpt-astra, "Offene Frage 1 ist bereits entschieden" (WICHTIG, `korrektur`) —
  **übernommen** → Offene Fragen an den PO: "Keine offenen Fragen. Zwei Punkte wurden im Review entschieden und stehen als": Die Frage ist zur Festlegung geworden.
- gpt-astra, "Eine nicht abgeschlossene Prüfung hat kein definiertes Ergebnis"
  (WICHTIG, `alternativen`) — **übernommen** → Fachliche Akzeptanzkriterien: "Kann die Prüfung nicht abgeschlossen werden, wird sie **nicht automatisch" in der Variante „keine
  Wiederholung", als neues Kriterium 6.
- fable, "Erster Zielsatz ist die Lösung von Schritt 2" (HINWEIS) — **übernommen** → Ziel: gestrichen "Die Synthese bekommt dasselbe fremde Auge wie das Dokument.".
- fable, "Begründungen in den Kriterien" (HINWEIS) — **übernommen** → Ziel: "Das ist die Rolle, die eine Prüfung vermeiden soll", die
  Begründungssätze stehen jetzt im Ziel.
- fable, "Kriterium 6 ist eine Abnahmeregel" (HINWEIS) — **übernommen** → Fachliche Akzeptanzkriterien: "### Abnahme (gehört in die Verifizierung des Plans, nicht in den Betrieb)" als
  eigener Abschnitt „Abnahme"; der konstruierte Teilfall aus dem Vorschlag jedoch
  **verworfen**: Selbstgebaute Testdaten prüfen die eigene Annahme. Stattdessen
  ein zweiter echter Fall aus dem Board-Bestand.
- fable, "`## Herkunft`" (HINWEIS) — **übernommen** → Ziel: gestrichen "## Herkunft — Idee: Issue #582." in der zweiten Variante: als
  Halbsatz ins Ziel gezogen, der Abschnitt entfällt.
- gpt-astra, "Schreibverbot sollte sich auf Korrekturen beziehen" (HINWEIS,
  `korrektur`) — **übernommen** → Nicht-Ziele: "**Keine Korrektur.** Der Prüfer korrigiert weder den Dokumentinhalt noch die", Nicht-Ziel 4 unterscheidet jetzt zwischen
  Korrigieren und Festhalten.

### Dissens

- **Der einzige echte Widerspruch lag beim Schweregrad des gemeinsamen Fundes:**
  fable stufte ihn als BLOCKER mit `gate` (F10), gpt-astra als WICHTIG mit
  `korrektur`. Entschieden für fable — ein Ziel, das mit einem nicht abgestellten
  Schaden wirbt, ist ein Widerspruch zwischen Ziel und Nicht-Zielen und damit F10.
- **Kein Dissens, aber getrennte Empfehlungen bei Schritt 2:** fable riet zum
  Abtrennen in ein eigenes `[Fachlich]`, gpt-astra legte beide Wege ohne
  Empfehlung vor. Der Mensch entschied gegen beide Empfehlungen für
  „verbindlich im selben Dokument".

Übernommen: 14 · Verworfen: 2 (beide Teilvorschläge, nicht die Funde selbst)
