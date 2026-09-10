## Fachplan-Review, Runde 1

Reviewer: fable (form-beobachtbarkeit), gpt-astra (abgrenzung) — Stufe `fachlich`, Runde 1 von 1, Besetzung vollstaendig (2 von 2), Paarung aus `pairs`, Autor `claude-opus-5` aufgeloest.
fable — Bestand: gelesen
gpt-astra — Bestand: gelesen

### fable — Form und Beobachtbarkeit

## Fachplan-Review — Befundliste

Geprüft gegen `CLAUDE-workflow.md` (W1–W4) und `CLAUDE-Fachplan.md` (F1–F11).

**Form (F1, F2, F6, F7, F9, F11):** Alle vier Abschnitte vorhanden und in der richtigen Reihenfolge, jeder inhaltlich gefüllt; `Autor-Modell:` steht im Ziel; unter „Offene Fragen an den PO" stehen zwei konkrete Fragen mit der vorläufigen Lesart des Autors; keine `Issue-Review:`-Zeile; keine der beiden F9-Herkunftsmuster (`Fachliche Quelle:`/`Plan:`). Kein Formfund.

---

### 1. BLOCKER · `gate` (F10) — Das Ziel verspricht, was ein Nicht-Ziel ausschließt

**Fundstelle:** Ziel: „Am 2026-09-10 kam der zweite Fall dazu: Ein Pruefer behauptete einen Zustand, den es nicht gibt; der Autor uebernahm ihn ungeprueft in die Synthese und in zwei Arbeitspakete" — und „Der Mensch erfaehrt am Morgen, welche Synthese nicht traegt".
Nicht-Ziele: „Kein Urteil darueber, ob ein Fund inhaltlich richtig war. Geprueft wird der Umgang mit dem Fund, nicht der Fund selbst."

**Befund:** Der zweite der beiden Belegfälle wird von keinem Kriterium erfasst. Kriterium 1 prüft, ob eine *behauptete* Schärfung im Text *fehlt* — am 2026-09-10 stand sie im Text, sie war nur falsch. Kriterium 8 prüft nur die Begründung *verworfener* Funde — dieser Fund wurde *übernommen*. Und Nicht-Ziel 2 schließt genau die Prüfung aus, die den Fall gefangen hätte: ob die übernommene Behauptung des Prüfers trägt. Das Ziel wirbt also mit einem Schaden, den die Anforderung nicht abstellt. Der Plan würde diesen Widerspruch auflösen müssen — und darf das nicht (F10, *Warum Gate*).

**Vorschlag (zwei Wege, PO entscheidet):**
- (a) Scope erweitern: Kriterium 8 um die Übernahme ergänzen — „Traegt die Begruendung, mit der ein Fund uebernommen oder verworfen wurde? Behauptet ein uebernommener Fund einen Zustand des Dokuments, wird geprueft, ob der vorgelegte Text ihn hergibt." — und Nicht-Ziel 2 entsprechend eingrenzen: „Kein eigenes Urteil ueber die Sache selbst; wohl aber darueber, ob die Synthese eine Behauptung des Pruefers uebernommen hat, die im vorgelegten Text keinen Halt findet."
- (b) Scope halten: Den Fall vom 2026-09-10 aus Ziel und Kriterium 6 streichen und als eigenes Nicht-Ziel ausweisen: „Nicht der Fall, dass ein uebernommener Fund inhaltlich falsch war (2026-09-10) — das ist eine eigene Anforderung."

---

### 2. WICHTIG · `alternativen` — Schritt 2 steht als Lieferumfang, obwohl offen ist, ob er kommt

**Fundstelle:** Fachliche Akzeptanzkriterien: „Die Anforderung wird in **zwei Schritten** geliefert. … Schritt 2 wird erst gebaut, wenn Schritt 1 im Betrieb ist." Offene Frage 2: „Wird Schritt 2 in jedem Fall gebaut? … Die Frage stellt sich erst, wenn Schritt 1 laeuft."

**Befund:** Aus diesem Dokument entsteht ein Plan. Der muss entscheiden, ob er die Kriterien 7–10 mitplant und in Arbeitspakete schneidet — für etwas, das nach Frage 2 vielleicht nie gebaut wird. Beides ist gangbar:
- (a) Schritt 2 als eigenes `[Fachlich]`-Issue abtrennen, das erst nach der PO-Entscheidung aus Frage 2 in den Plan geht; hier bleiben Kriterien 1–6.
- (b) Schritt 2 hier lassen, aber als bedingt kennzeichnen: „Schritt 2 wird geplant, seine Arbeitspakete werden erst nach der Entscheidung zu Frage 2 angelegt."

**Vorschlag:** (a). Ein Dokument, das „steht fuer sich" sagt, sollte auch für sich geprüft und geplant werden.

---

### 3. WICHTIG · `alternativen` — Im Tagbetrieb ist nicht gesagt, was der Mensch anders erlebt

**Fundstelle:** Kriterium 3: „Es gilt **im Tag- wie im Nachtbetrieb**." Kriterium 4: „wartet auf die Entscheidung des Menschen." Kriterium 5: „Am Dokument selbst ist erkennbar, **dass** es wartet".

**Befund (Bestand gelesen):** Interaktiv wird heute nichts ohne Zustimmung geschrieben — der Mensch sieht den Vorschlag und wird gefragt. „Wartet auf die Entscheidung des Menschen" ist dort der Normalfall, nicht die Wirkung dieser Anforderung. Was interaktiv *neu* ist, steht nicht da: Sieht der Mensch den Befund vor der Frage „Übernehmen?", als Teil des Vorschlags, oder erst hinterher am Dokument (Kriterium 5)? Und gilt Kriterium 4 („nicht nach Ready") interaktiv überhaupt, wenn der Mensch den Vorschlag sehenden Auges übernimmt?

**Vorschlag:** Kriterium 3 ergänzen: „Interaktiv sieht der Mensch den Befund, **bevor** er gefragt wird, ob er den Vorschlag uebernimmt — nicht erst nachdem der Text geschrieben ist. Uebernimmt er trotz Befund, ist das seine Entscheidung; Kriterium 4 gilt dann nicht."

---

### 4. WICHTIG · `alternativen` — „Es geht nicht nach Ready" beschreibt nichts, was das System tut

**Fundstelle:** Kriterium 4: „Es geht nicht nach Ready und nicht in die naechste Stufe, sondern wartet auf die Entscheidung des Menschen."

**Befund (Bestand gelesen):** Nach Ready zieht ausschließlich der Mensch (W1); `[Fachlich]`- und `[Plan]`-Dokumente gehen nie nach Ready. Für zwei der drei Stufen ist der Satz also leer, für die dritte beschreibt er eine Handlung des Menschen. Offen bleibt, was gemeint ist:
- (a) *informierend* — das Dokument gilt sichtbar als nicht geprüft; der Mensch entscheidet (passt zu Nicht-Ziel 3 „verschiebt keine Karte").
- (b) *mechanisch* — zieht der Mensch es trotzdem nach Ready, stellt der Nacht-Runner es zurück, wie heute bei ungeprüften Ready-Issues.

**Vorschlag (a):** „Das Dokument gilt als nicht geprueft. Der Mensch sieht das am Dokument (Kriterium 5) und in der Zusammenfassung des Laufs; ob er es trotzdem weiterzieht, bleibt seine Entscheidung."

---

### 5. WICHTIG · `alternativen` — „der geschaerfte Text" ist zweideutig

**Fundstelle:** Kriterium 1: „steht die entsprechende Aenderung im geschaerften Text nicht"; Kriterium 7: „den geschaerften Text".

**Befund (Bestand gelesen):** Nachts gibt es zwei Texte: den vollständigen *Vorschlag* (Kommentar) und den tatsächlich geschriebenen *Body*, in den nur wörtlich vorgeschlagene `korrektur`-Funde eingehen. Die Synthese spricht laut Bestand über den Vorschlag. Beide Texte können auseinanderliegen — und genau dann entscheidet der Bezug, ob ein Befund entsteht.

**Vorschlag:** Kriterium 1 ergänzen: „Massstab ist der Text, den die Synthese meint — der vorgeschlagene neue Body. Steht die Aenderung dort, aber nicht im geschriebenen Body, ist das kein Befund dieser Anforderung." (Oder umgekehrt — aber es muss dastehen.)

---

### 6. HINWEIS · `korrektur` — Der erste Zielsatz ist die Lösung von Schritt 2, nicht die Wirkung

**Fundstelle:** „**Ziel:** Die Synthese bekommt dasselbe fremde Auge wie das Dokument. Der Mensch erfaehrt am Morgen, welche Synthese nicht traegt".

**Befund:** „Fremdes Auge" ist das *Wie* von Schritt 2 (ein weiteres Modell liest); für Schritt 1 gilt es nicht einmal. Die Nutzerwirkung steht im zweiten Satz. Dazu passt der Satz „Interaktiv faengt der Mensch das ab" nicht zu Kriterium 3, das die interaktive Synthese ausdrücklich als ungeprüft bezeichnet.

**Vorschlag:** „**Ziel:** Der Mensch erfaehrt am Morgen — und interaktiv vor seiner Zustimmung —, welche Synthese nicht traegt, statt es zwei Stufen spaeter zu entdecken. Niemand muss dafuer zwei Textstaende von Hand vergleichen." Und im Absatz davor: „Interaktiv kann der Mensch es abfangen — wenn er beide Textstaende vergleicht. Nachts steht dort niemand."

---

### 7. HINWEIS · `korrektur` — Was raus kann: Begründungen in den Kriterien

**Fundstellen:**
- Kriterium 2: „Der belegte Schaden vom 2026-08-12 betraf genau diesen Abgleich, und er haengt nicht daran, wie viele Pruefer gelesen haben."
- Kriterium 3: „Eine Pruefung, die nur nachts greift, liesse …; eine, die nur tagsueber greift, liesse …"
- Nicht-Ziel 1: „Eine volle Runde kostet so viel wie die ersten beiden zusammen und findet erfahrungsgemaess vor allem Geschmacksfragen."

**Befund:** Das sind Begründungen, keine Kriterien; sie tragen zur Abnahme nichts bei. Der Kostensatz ist zudem in sich schief (eine Runde kostet so viel wie zwei?).

**Vorschlag:** Kriterium 2 und 3 auf den ersten Satz kürzen; Begründungen, wenn sie bleiben sollen, ins Ziel. Nicht-Ziel 1 auf: „**Keine dritte volle Pruefrunde ueber das Dokument.** Gelesen werden Befunde, Synthese und der geschaerfte Text."

---

### 8. HINWEIS · `korrektur` — Kriterium 6 ist eine Abnahmeregel, kein Nutzerkriterium

**Fundstelle:** Kriterium 6: „Der Nachweis wird an einem Fall gefuehrt, den es **tatsaechlich gegeben hat** (einer der neun vom 2026-08-12 oder der Fall vom 2026-09-10)".

**Befund (Bestand gelesen):** Kein Nutzer merkt im Betrieb, an welchem Fall der Nachweis geführt wurde (F5) — es ist eine Vorgabe an die Verifizierung des Plans. Sie ist berechtigt, gehört aber gekennzeichnet, damit der Plan sie in `## Verifizierung` übernimmt statt sie als Kriterium zu behandeln. Zwei Präzisierungen dazu: Der Fall vom 2026-09-10 ist kein Fall von Kriterium 1 (siehe Fund 1) und taugt hier nicht als Nachweis. Die neun Fälle vom 2026-08-12 sind der Grenzfall „Vorschlagstext fehlt ganz" — den meldet `night.mjs --review` heute bereits als „Schärfung fehlt". Der Nachweis an diesen Fällen zeigt also nur, dass Kriterium 1 den Grenzfall mit abdeckt, nicht den eigentlichen Zweck (einzelne behauptete Änderung fehlt).

**Vorschlag:** „**Abnahme:** Der Nachweis wird an einem der neun Faelle vom 2026-08-12 gefuehrt, nicht an einem erfundenen Beispiel. Er zeigt zusaetzlich an einem konstruierten Teilfall, dass auch eine einzelne fehlende Aenderung erkannt wird, wenn der uebrige Text geschaerft ist." — und den PO fragen, ob das genügt.

---

### 9. HINWEIS · `korrektur` — `## Herkunft` mit „Idee: Issue #582."

**Fundstelle:** „## Herkunft — Idee: Issue #582."

**Befund (Bestand gelesen):** Kein F9-Verstoß — der Herkunfts-Leser wertet nur `Fachliche Quelle:` und `Plan:`. Der Abschnitt ist als zusätzliche `##`-Überschrift erlaubt (F1). Er ist in keinem Skill als Konvention angelegt; er schadet nicht, trägt aber auch nichts, sobald das Dokument gegroomt ist.

**Vorschlag:** Bleiben lassen oder ins Ziel als Halbsatz ziehen („Anlass war Issue #582"). Keine Änderung nötig.

---

**Zusammenfassung:** 1 BLOCKER (Fund 1, gate F10), 4 WICHTIG (Funde 2–5, alle `alternativen`), 4 HINWEIS (`korrektur`). Fund 1 muss vom PO entschieden werden, bevor ein Plan entsteht — er betrifft den Umfang der Anforderung, nicht ihre Form.

Bestand: gelesen

---

### gpt-astra — Abgrenzung und Widerspruch

Geprüfte Stufe: **fachlich**. Maßgeblich sind [CLAUDE-workflow.md](/Users/manfredwolff/ki-projects/claude-workflow-kit/templates/CLAUDE-workflow.md) und [CLAUDE-Fachplan.md](/Users/manfredwolff/ki-projects/claude-workflow-kit/templates/CLAUDE-Fachplan.md). Einen eindeutigen Gate-Verstoß sehe ich nicht. Ich finde sechs Punkte zur Abgrenzung:

1. **WICHTIG · `korrektur` — Der zweite Schadensfall liegt nicht erkennbar im Prüfbereich.**

   **Fundstelle:** „der Autor uebernahm ihn ungeprueft in die Synthese und in zwei Arbeitspakete“; Kriterium 6 erlaubt „den Fall vom 2026-09-10“.

   Schritt 1 erkennt fehlende Änderungen. Im beschriebenen Septemberfall wurde eine falsche Aussage jedoch übernommen. Schritt 2 prüft Widersprüche zwischen Befundlisten und Verwerfungsbegründungen. Auch das muss eine übernommene Falschaussage nicht erfassen. Der Body belegt damit nicht, dass dieser Fall als Nachweis für Schritt 1 geeignet ist.

   **Vorschlag:** „Der Nachweis für Schritt 1 erfolgt an einem dokumentierten historischen Fall, in dem eine als übernommen bezeichnete Schärfung im Ergebnistext fehlt. Der Fall vom 10.09. ist nur geeignet, wenn er zusätzlich diesen Fehler enthält. Die inhaltliche Richtigkeit übernommener Aussagen wird durch diese Anforderung nicht abgesichert.“

2. **WICHTIG · `korrektur` — Die Grenze der Prüfung von Verwerfungsbegründungen fehlt.**

   **Fundstelle:** Kriterium 8: „traegt die Begruendung, mit der ein Fund verworfen wurde?“; Nicht-Ziel: „Kein Urteil darueber, ob ein Fund inhaltlich richtig war.“

   Das ist kein zwingender Widerspruch: Eine Begründung lässt sich auf Nachvollziehbarkeit prüfen, ohne den Fund abschließend zu bewerten. „Trägt“ könnte aber auch eine eigenständige Prüfung ihrer tatsächlichen Voraussetzungen verlangen. Diese Grenze sollte der Planer nicht selbst ziehen.

   **Vorschlag:** „Die Prüfung stellt fest, ob die Verwerfungsbegründung den konkreten Fund adressiert, nachvollziehbar argumentiert und den vorliegenden Unterlagen nicht widerspricht. Sie verifiziert keine Tatsachen außerhalb dieser Unterlagen und entscheidet nicht über die inhaltliche Richtigkeit des Fundes.“

3. **WICHTIG · `korrektur` — Offene Frage 1 ist bereits entschieden.**

   **Fundstelle:** „Ruft jeder Befund den Menschen, auch ein geringfuegiger?“ Dem stehen Kriterium 4 und insbesondere Kriterium 10 gegenüber: „Befund heisst, das Dokument wartet auf den Menschen“.

   Die Kriterien enthalten keine Schweregrad-Ausnahme. Die Frage erneut offenzuhalten macht eine bereits formulierte Regel unsicher. Das ist eine Festlegung im Body, keine nachgewiesene PO-Antwort.

   **Vorschlag:** Frage 1 ersetzen durch: „Festlegung dieser Anforderung: Jeder Befund aus Schritt 1 oder 2 führt unabhängig vom Schweregrad zur menschlichen Entscheidung. Eine spätere Abstufung gehört nicht zum aktuellen Umfang.“

4. **WICHTIG · `alternativen` — Verbindlichkeit von Schritt 2 ist uneindeutig.**

   **Fundstelle:** „Die Anforderung wird in zwei Schritten geliefert“ gegenüber „Wird Schritt 2 in jedem Fall gebaut?“

   Zwei Wege sind möglich: Schritt 2 ist verbindlich und wird lediglich später umgesetzt; oder zunächst wird ausschließlich Schritt 1 beauftragt und Schritt 2 bleibt optional. Die Reihenfolge ist entschieden, die Lieferverpflichtung nicht eindeutig. Für einen Gesamtplan muss das geklärt werden; einen eigenständigen Plan für Schritt 1 muss es nicht aufhalten.

   **Formulierungsvorschläge:**

   - Verbindlich: „Beide Schritte gehören zum Lieferumfang. Schritt 2 beginnt nach der Inbetriebnahme von Schritt 1.“ Frage 2 entfällt.
   - Optional: „Verbindlicher Lieferumfang ist Schritt 1. Über die Beauftragung von Schritt 2 entscheidet der PO nach dessen Betrieb.“ Schritt 2 als Ausblick aus den verbindlichen Akzeptanzkriterien herausnehmen.

5. **WICHTIG · `alternativen` — Eine nicht abgeschlossene Prüfung hat kein definiertes Ergebnis.**

   **Fundstelle:** Kriterium 4 regelt ausschließlich „Ein solcher Befund“; Kriterium 7 verlangt ein bisher unbeteiligtes Modell.

   Unbestimmt bleibt, was bei nicht verfügbarer unabhängiger Prüfung oder unbrauchbarem Prüfergebnis geschieht. „Kein Befund“ darf dabei nicht versehentlich als erfolgreiche Prüfung gelten. Gangbare Wege sind sofortiges Warten auf den Menschen oder zunächst begrenzte automatische Wiederholungen.

   **Vorschlag zur Entscheidung:** „Kann die Prüfung nicht abgeschlossen werden, erfolgen [keine / begrenzte] automatische Wiederholungen. Bleibt sie unvollständig, wartet das Dokument mit diesem sichtbaren Grund auf den Menschen; der Durchgang fährt mit dem nächsten Dokument fort.“

6. **HINWEIS · `korrektur` — Das Schreibverbot sollte sich ausdrücklich auf Korrekturen beziehen.**

   **Fundstelle:** „Der Pruefer benennt; er schreibt keinen Text“ gegenüber Kriterium 5: „Am Dokument selbst ist erkennbar […] woran es liegt“.

   Gemeint ist offenbar ein Verbot eigenständiger Korrekturen. Wörtlich könnte das Schreibverbot aber auch die verlangte Dokumentation des Befunds ausschließen. Daraus folgt noch kein sicherer F10-Verstoß, weil unterschiedliche Zuständigkeiten möglich sind.

   **Vorschlag:** „Der Prüfer korrigiert weder den Dokumentinhalt noch die Synthese. Wartegrund und Prüfstatus werden am Dokument festgehalten; daraus entsteht keine automatische Freigabe.“

Bestand: gelesen
