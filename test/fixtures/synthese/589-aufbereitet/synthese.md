## Synthese, Runde 1

Stufe `plan`, zwei Prüfer, 18 Funde (3 BLOCKER, 9 WICHTIG, 6 HINWEIS). Die vier
`alternativen`-Entscheidungen lagen dem Menschen zur Wahl vor; er hat überall den
Weg (a) gewählt.

### Entscheidungen

- fable, "Vorlage liegt nicht unter templates/.claude/skills/" (BLOCKER, `gate`
  P10) — übernommen → Betroffene Bereiche: "`skills/issue-review/SKILL.md` | Quelle: Beleg-Form, Abgleich-Aufruf, Abgleich-Kommentar". Nachgesehen: `ls templates` kennt kein `.claude/`; Quelle ist
  `skills/issue-review/SKILL.md`. Der Plan hatte sich selbst widersprochen, weil
  die Luecken-Zeile den richtigen Pfad nannte.
- gpt-astra, "Falscher Quellpfad und unvollständiger Synchronisationsweg"
  (WICHTIG, `gate`) — **zur Hälfte übernommen → Betroffene Bereiche: "`.claude/skills/issue-review/SKILL.md` | Dogfooding-Kopie über `tools/sync-blobs.mjs`", zur Hälfte verworfen.** Der Pfad
  ist falsch (siehe oben). Die Schlussfolgerung, `tools/sync-blobs.mjs` decke die
  Skill-Kopie nicht ab, trägt nicht: Die Datei führt ab Zeile 158 einen eigenen
  Abschnitt „Dogfooding-Kopien unter .claude/skills/" (Issue #213), kopiert
  `skills/<name>/SKILL.md` nach `.claude/skills/<name>/SKILL.md` und wertet eine
  fehlende Kopie als Drift. fable bestätigt unabhängig, dass Vorlage und Kopie
  heute bytegleich sind.
- fable, "Interaktiv kann das Kommando am Board nichts finden" (BLOCKER,
  `alternativen`) — übernommen → Architektonische Entscheidungen: "**A6 — Zwei Eingabewege, ein Prüfkern.**", Weg (a): Datei-Eingaben. Neue Entscheidung A6.
- gpt-astra, "Vor der interaktiven Zustimmung fehlen dem Kommando seine Eingaben"
  (BLOCKER, `alternativen`) — übernommen → Architektonische Entscheidungen: "Interaktiv liegt die Zustimmung **vor** dem ersten", deckungsgleich.
- fable, "Verifizierung verlangt zwei Ergebnisse, die sich ausschließen"
  (BLOCKER, `korrektur`) — übernommen → Verifizierung: "**Beleg-fehlt-Pfad:** Die **unveränderten** Bestandssynthesen tragen die". Der Negativnachweis hätte nie grün werden
  können: Die Bestandssynthesen tragen die Beleg-Syntax nicht, weil sie erst mit
  diesem Plan entsteht. Jetzt getrennt in Beleg-fehlt-Pfad (unverändert) und
  Negativnachweis (Belege aus dem echten Vorschlagstext ergänzt).
- gpt-astra, "Lieferung 2 hat noch keinen ausführbaren Zuschnitt" (BLOCKER,
  `alternativen`) — übernommen → Ziel: "**Dieser Plan umfasst Schritt 1 aus Issue #587 — den mechanischen", Weg (a).
- fable, "Schritt 2 steht als Entscheidung, aber nirgends als Änderung" (WICHTIG,
  `alternativen`) — übernommen → Ziel: "`pickReviewers` schließt nur den Autor aus,", Weg (a). Der tragende Beleg kam von fable:
  `pickReviewers` schließt mit `r.name !== schluessel` nur den Autor aus;
  Kriterium 7 verlangt drei Ausschlüsse. A6 und A7 alt entfallen, das Ziel nennt
  die Abgrenzung.
- fable, "kit:klaeren ist heute ein Endzustand" (WICHTIG, `alternativen`) —
  übernommen → Architektonische Entscheidungen: "**A10 — `kit:klaeren` nutzt den bestehenden Endzustand-Pfad.**", Weg (a). Neue Entscheidung A10; der falsche Satz ist raus.
- gpt-astra, "Der neue Ausgang braucht Vorrang vor bestehenden Erfolgszweigen"
  (WICHTIG, `korrektur`) — übernommen → Architektonische Entscheidungen: "**A8 — Der Runner ruft den Abgleich selbst auf, vor der Marker-Prüfung.**", in A8 zusammengeführt.
- fable, "Der fünfte Ausgang hat keinen Platz in werteReviewSession" (WICHTIG,
  `korrektur`) — übernommen → Geplante Änderungen: "`werteReviewSession` ruft `synthese-check <id>` **vor** der Marker-Prüfung;" als A8: Der Runner ruft selbst auf, vor der
  Marker-Prüfung.
- fable, "Welcher Body-Vorschlag zu welcher Synthese gehört, ist nicht
  festgelegt" (WICHTIG, `korrektur`) — übernommen → Architektonische Entscheidungen: "**A7 — Die Paarung ist festgelegt, nicht geraten.**" als A7, samt drittem Grund
  `vorschlag-fehlt` und dem Export von `VORSCHLAG_KOPF` nach `board.mjs`.
- gpt-astra, "Die Auswahl des zu prüfenden Paares ist ungeklärt" (BLOCKER,
  `alternativen`) — übernommen → Architektonische Entscheidungen: "`## Body-Vorschlag, Runde n` mit gleichem `n`. Rundennummern allein", deckungsgleich mit fable.
- fable, "Wer schreibt den Befund ans Dokument" (WICHTIG, `korrektur`) —
  übernommen → Geplante Änderungen: "Der Skill schreibt in **beiden** Betriebsarten einen eigenen Kommentar": eigener Kommentar `## Synthese-Abgleich, Runde n` in beiden
  Betriebsarten, der Runner schreibt keinen zweiten.
- fable, "test/night-review.test.mjs gibt es nicht" (WICHTIG, `gate` P10) —
  übernommen → Betroffene Bereiche: "`test/night-review-loop.test.mjs`, `test/night-body-vorschlag.test.mjs`", die real vorhandenen Testdateien stehen jetzt in der Tabelle.
- gpt-astra, "Verifizierung braucht reproduzierbare Eingaben und getrennte
  Ablaufnachweise" (WICHTIG, `korrektur`) — übernommen → Verifizierung: "**Fixtures aus echten Daten:** Die Paare aus #579, #580, #583–#585 und #587": lokale Fixtures statt
  veränderlicher Board-Karten, drei getrennte Ablaufnachweise.
- fable, "Leerfälle des Kommandos sind nicht definiert" (HINWEIS) — übernommen → Geplante Änderungen: "**Leerfälle:** Ohne Synthese-Kommentar oder ohne `übernommen`-Zeile".
- fable, "'Wörtlich' ist bei Markdown zweideutig" (HINWEIS, `alternativen`) —
  übernommen → Architektonische Entscheidungen: "**A9 — Die Normalisierung entfernt Markdown-Auszeichnung.**", Weg (a): Auszeichnung wird wegnormalisiert. Neue Entscheidung A9.
- fable, "Specs werden nicht direkt geschrieben; Docs-Stand veraltet" (HINWEIS) —
  übernommen → Geplante Änderungen: "der Arbeitspakete, nicht durch direktes Schreiben in `specs/`.".
- fable, "A7 alt trägt nichts" (RAUS) — übernommen → Architektonische Entscheidungen: gestrichen "`issue-review roles` kennt Rollen je Stufe, und `pairs` schließt den Autor bereits aus", mit A6 alt zusammen entfallen.
- fable, Weg (b) bei `pruefEnde` — **verworfen**: Er baut neue Mechanik
  (`ENDZUSTAENDE`, eigener Grund) für ein Verhalten, das der bestehende Pfad schon
  liefert. fable nennt es selbst „ein Aufschub, kein Verhalten".

### Dissens

- **Kein inhaltlicher Widerspruch zwischen den Prüfern.** Sie fanden dieselben
  drei schwersten Punkte unabhängig voneinander, mit unterschiedlichem
  Schweregrad: gpt-astra stufte den Zuschnitt von Lieferung 2 als BLOCKER ein,
  fable denselben Sachverhalt als WICHTIG; umgekehrt war der Selbstwiderspruch in
  der Verifizierung für fable ein BLOCKER und für gpt-astra ein WICHTIG. Beide
  Male wurde der höhere Grad genommen.
- **Ein Fund war zur Hälfte falsch** (gpt-astra zu `sync-blobs`, siehe oben). Das
  ist der einzige Fall, in dem ein Prüfer aus einer richtigen Beobachtung eine
  Schlussfolgerung zog, die der Bestand nicht hergibt — nachgesehen wurde in
  `tools/sync-blobs.mjs`, Zeile 158 ff.

Übernommen: 17 · Verworfen: 2 (ein halber Fund, ein Teilvorschlag)
