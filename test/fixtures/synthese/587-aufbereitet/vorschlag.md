## Body-Vorschlag, Runde 1

## Ziel

Wer eine Prüfung laufen lässt, bekommt am Ende einen geschärften Text und eine
Synthese, die sagt, welcher Fund eingeflossen ist. Ob das stimmt, sieht niemand
nach: Über die Befunde urteilt **der Autor des Textes selbst**, und er schreibt
anschließend den neuen Text. Das ist die Rolle, die eine Prüfung vermeiden soll —
der Geprüfte entscheidet über die Kritik an sich.

Interaktiv kann der Mensch es abfangen — wenn er beide Textstände vergleicht.
Nachts vergleicht niemand.

Der Schaden ist belegt: Am 2026-08-12 behaupteten **neun** Synthesen in einem
einzigen Lauf Schärfungen, die in keinem Text standen.

**Ziel:** Der Mensch erfährt am Morgen — und interaktiv vor seiner Zustimmung —,
welche Synthese nicht trägt, statt es zwei Stufen später zu entdecken. Niemand
muss dafür zwei Textstände von Hand vergleichen.

Anlass war Issue #582.

Autor-Modell: claude-opus-5

## Fachliche Akzeptanzkriterien

Die Anforderung wird in **zwei Schritten** geliefert; **beide gehören zum
Lieferumfang**. Schritt 2 beginnt nach der Inbetriebnahme von Schritt 1.

### Schritt 1 — die behauptete Schärfung wird gegen den Text gehalten

1. Behauptet eine Synthese, sie habe einen Fund übernommen, und steht die
   entsprechende Änderung im vorgeschlagenen neuen Text nicht, wird das erkannt
   und benannt. **Maßstab ist der Text, den die Synthese meint** — der
   vorgeschlagene neue Body. Steht die Änderung dort, aber nicht im später
   geschriebenen Body, ist das kein Befund dieser Anforderung.
2. Das gilt auf **allen drei Prüfstufen** — fachliche Anforderung, Plandokument
   und Arbeitspaket.
3. Es gilt **im Tag- wie im Nachtbetrieb**. Interaktiv sieht der Mensch den
   Befund, **bevor** er gefragt wird, ob er den Vorschlag übernimmt — nicht erst,
   nachdem der Text geschrieben ist. Übernimmt er trotz Befund, ist das seine
   Entscheidung.
4. Nach einem Befund **gilt das Dokument als nicht geprüft**. Es wird nicht bewegt
   und nicht als geprüft gekennzeichnet; der laufende Durchgang geht mit dem
   nächsten Dokument weiter. Ob der Mensch es trotzdem weiterzieht, bleibt seine
   Entscheidung.
5. Am Dokument selbst ist erkennbar, **dass** ein Befund vorliegt und **woran** es
   liegt — welche behauptete Schärfung im Text fehlt. Ohne Rückgriff auf ein
   Protokoll, ohne Rekonstruktion aus einem Verlauf.
6. Kann die Prüfung nicht abgeschlossen werden, wird sie **nicht automatisch
   wiederholt**. Das Dokument gilt dann als nicht geprüft, mit diesem Grund am
   Dokument; ein ausgefallener Durchgang zählt nie als befundfrei.

### Schritt 2 — ein fremdes Auge auf die Synthese

7. Die Synthese wird von einem Modell gelesen, das **weder das Dokument
   geschrieben noch eine der Befundlisten erstellt** hat. Es bekommt die
   Befundlisten, die Synthese und den vorgeschlagenen neuen Text — nicht den
   Auftrag, das Dokument erneut zu prüfen.
8. Es beantwortet zwei Fragen: Bleibt ein Widerspruch zwischen den Befundlisten
   unbenannt, obwohl die Synthese ihn hätte benennen müssen? Und trägt die
   Begründung, mit der ein Fund verworfen wurde? **Geprüft wird dabei, ob die
   Begründung den Fund adressiert, nachvollziehbar argumentiert und den
   vorliegenden Unterlagen nicht widerspricht** — nicht, ob sie sachlich zutrifft.
9. Auf der Stufe `issue` gibt es nur eine Befundliste. Dort entfällt die Frage
   nach dem Widerspruch; die Frage nach der Verwerfungsbegründung bleibt.
10. Für Befunde aus Schritt 2 gelten die Kriterien 4, 5 und 6 unverändert.

### Abnahme (gehört in die Verifizierung des Plans, nicht in den Betrieb)

11. Der Nachweis für Schritt 1 wird an einem Fall geführt, den es **tatsächlich
    gegeben hat** — einem der neun vom 2026-08-12 —, nicht an einem erfundenen
    Beispiel. Diese neun sind allerdings der Grenzfall „der Vorschlagstext fehlt
    ganz". Dass auch **eine einzelne** fehlende Änderung bei sonst geschärftem
    Text erkannt wird, wird an einem **weiteren echten Fall aus dem
    Board-Bestand** gezeigt.

## Nicht-Ziele

- **Keine dritte volle Prüfrunde über das Dokument.** Gelesen werden Befunde,
  Synthese und der vorgeschlagene neue Text.
- **Kein Urteil darüber, ob ein Fund inhaltlich richtig war.** Geprüft wird der
  Umgang mit dem Fund, nicht der Fund selbst.
- **Nicht der Fall, dass ein übernommener Fund inhaltlich falsch war.** Am
  2026-09-10 behauptete ein Prüfer einen Zustand, den es im Bestand nicht gibt;
  der Autor übernahm ihn. Kein Vergleich von Synthese und Text hätte das gezeigt —
  nur ein Blick in den Bestand. Das ist eine eigene Anforderung.
- **Keine Korrektur.** Der Prüfer korrigiert weder den Dokumentinhalt noch die
  Synthese. Dass ein Befund vorliegt und welcher, wird am Dokument festgehalten;
  daraus entsteht keine Freigabe und keine Bewegung der Karte.
- **Kein Ersatz für den Menschen an den drei Stop-Punkten.**
- **Nicht die Frage, wie viele Prüfrunden ein Dokument bekommt.**

## Offene Fragen an den PO

Keine offenen Fragen. Zwei Punkte wurden im Review entschieden und stehen als
Festlegung im Text:

- **Jeder Befund führt zur menschlichen Entscheidung**, unabhängig vom
  Schweregrad (Kriterium 4). Eine spätere Abstufung gehört nicht zum Umfang.
- **Beide Schritte gehören zum Lieferumfang** (Einleitung der Kriterien).
  Schritt 2 wird nicht neu zur Entscheidung gestellt.
