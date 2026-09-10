## Body-Vorschlag, Runde 1

Autor-Modell: claude-opus-5

Plan-Modell: claude-opus-5
Fachliche Quelle: Issue #587

## Ziel

Die Synthese behauptet heute unwidersprochen, welche Funde eingeflossen sind.
Dieser Plan macht die Behauptung überprüfbar: Jede als übernommen bezeichnete
Schärfung muss im vorgeschlagenen Text belegbar sein, und ein Kommando prüft das
in beiden Betriebsarten. Wo der Beleg fehlt, gilt das Dokument als nicht geprüft
und wartet sichtbar auf den Menschen.

**Dieser Plan umfasst Schritt 1 aus Issue #587 — den mechanischen
Beleg-Abgleich.** Schritt 2 (das fremde Auge auf die Synthese) bleibt
verbindlicher Lieferumfang, bekommt aber einen eigenen `/techplan` gegen #587: Er
baut auf dem hier festgelegten Eingabe- und Ergebnisformat auf, und die vorhandene
Reviewer-Auswahl trägt ihn nicht — `pickReviewers` schließt nur den Autor aus,
Kriterium 7 verlangt drei Ausschlüsse.

## Betroffene Bereiche

| Datei | Was |
|---|---|
| `kit/board.mjs` | Kommando `issue-review synthese-check`, Parser, Beleg-Abgleich, Export `VORSCHLAG_KOPF` |
| `.claude/kit/board.mjs` | Dogfooding-Kopie über `tools/sync-blobs.mjs` |
| `kit/night.mjs` | fünfter Ausgang `syntheseOhneBeleg`, Import von `VORSCHLAG_KOPF` statt eigener Regex |
| `.claude/kit/night.mjs` | Dogfooding-Kopie |
| `skills/issue-review/SKILL.md` | Quelle: Beleg-Form, Abgleich-Aufruf, Abgleich-Kommentar |
| `.claude/skills/issue-review/SKILL.md` | Dogfooding-Kopie über `tools/sync-blobs.mjs` |
| `install.mjs` | generiert — die Skill-Blobs werden neu gebacken |
| `test/board-synthese-check.test.mjs` | neu |
| `test/night-review-loop.test.mjs`, `test/night-body-vorschlag.test.mjs`, `test/night-ergebnisstand-review.test.mjs` | erweitert |
| `test/skills-issue-review-reihenfolge.test.mjs` | angepasst |
| `docs/dokumentation.md` | Ausgänge-Tabelle auf fünf Zeilen |

### Beschreibungs-Luecken

- board: Wie leitet `reviewZustand` den Prüfzustand aus Body und Kommentaren ab? — gelesen: kit/board.mjs
- night: Woran erkennt der Runner heute einen übernehmbaren Body-Vorschlag? — gelesen: kit/night.mjs
- skills: Welche Form hat eine Synthese-Zeile? — gelesen: .claude/skills/issue-review/SKILL.md
- board: kit/board.mjs wird von keiner gueltigen Aussage beruehrt.
- night: kit/night.mjs wird von keiner gueltigen Aussage beruehrt.
- skills: skills/issue-review/SKILL.md wird von keiner gueltigen Aussage beruehrt.

## Architektonische Entscheidungen

- **A1 — Der Abgleich wird ein Kommando in `board.mjs`, kein Satz im Skill-Text.**
  Kriterium 3 verlangt Tag- **und** Nachtbetrieb. Ein Skill-Satz greift in keinem
  von beiden verlässlich: Die Warnung gegen genau diesen Fehler stand am
  2026-08-12 bereits im Skill und wurde neunmal in einem Lauf übergangen.
  `board.mjs` statt einer neuen Datei, weil `reviewZustand` und `GRENZE_RUNDEN`
  dort wohnen und `night.mjs` sie schon als Nachbardatei auflöst.
- **A2 — Jede `übernommen`-Zeile trägt einen wörtlichen Beleg aus dem
  Body-Vorschlag.** Form: `— übernommen → <Abschnitt>: "<Zitat>"`. Ohne Beleg ist
  der Abgleich nicht mechanisch möglich: Die Zeile nennt den *Fund*, nicht die
  *Textänderung*. Die Alternative (nur prüfen, ob der Vorschlag vom alten Body
  abweicht) fängt den Totalausfall, aber nicht „3 von 5 übernommen, 2
  eingearbeitet" — und das ist der Regelfall.
- **A3 — Ein fehlender Beleg ist selbst ein Befund.** Dieselbe Richtung wie beim
  klassenlosen Fund: Im Zweifel ruft es den Menschen. Die Gegenrichtung machte das
  Weglassen zur billigsten Variante.
- **A4 — Der Abgleich läuft vor dem Marker.** Kriterium 4 verlangt, dass ein
  Dokument mit Befund nicht als geprüft gekennzeichnet wird.
- **A5 — Geprüft wird gegen den Body-Vorschlag, nicht gegen den geschriebenen
  Body.** So steht es in Kriterium 1. Nachts gehen nur wörtlich vorgeschlagene
  `korrektur`-Funde in den Body; ein Abgleich gegen ihn meldete jeden `gate`-Fund
  als fehlende Schärfung.
- **A6 — Zwei Eingabewege, ein Prüfkern.** `--synthese-file` und
  `--vorschlag-file` prüfen lokale Entwürfe; `<id>` liest vom Board. Der Grund ist
  die Reihenfolge: Interaktiv liegt die Zustimmung **vor** dem ersten
  Schreibbefehl — am Board steht dann noch nichts, was zu prüfen wäre. Die
  Board-Variante bleibt für den Runner als unabhängige Nachprüfung. Die
  Alternative, die Schreibreihenfolge zu ändern, kollidiert mit „nichts ohne
  Zustimmung geschrieben" und mit `test/skills-issue-review-reihenfolge.test.mjs`.
- **A7 — Die Paarung ist festgelegt, nicht geraten.** Geprüft wird der jüngste
  `## Synthese, Runde n`-Kommentar gegen den jüngsten **davor** liegenden
  `## Body-Vorschlag, Runde n` mit gleichem `n`. Rundennummern allein
  identifizieren keine Session — `/issue-review` nummeriert je Session ab 1, drei
  Nächte hinterlassen dreimal „Runde 1". Fehlt der Vorschlag, ist das der dritte
  Grund `vorschlag-fehlt` mit `ok: false`. `VORSCHLAG_KOPF` wandert als Export
  nach `board.mjs`; `night.mjs` importiert ihn wie `GRENZE_RUNDEN`, statt ihn
  zweimal zu führen — die Abhängigkeitsrichtung ist night → board.
- **A8 — Der Runner ruft den Abgleich selbst auf, vor der Marker-Prüfung.**
  `werteReviewSession` entscheidet heute zuerst am Marker auf `ohneBefund`. Setzte
  eine Session den Marker entgegen der Regel trotz `ok: false`, bliebe der Befund
  unsichtbar. Nach A1 darf sich der Runner ohnehin nicht auf die Disziplin der
  Session verlassen.
- **A9 — Die Normalisierung entfernt Markdown-Auszeichnung.** Bestandssynthesen
  nutzen `**fett**`, Backticks und typografische Anführungszeichen. Ein Fehlalarm
  ruft den Menschen und entwertet damit genau das Verfahren, das Vertrauen
  aufbauen soll — er ist teurer als ein zu weicher Vergleich.
- **A10 — `kit:klaeren` nutzt den bestehenden Endzustand-Pfad.** `pruefEnde`
  wertet das Label schon heute als Endzustand und lässt das Routing-Label fallen;
  der Mensch entscheidet dann. Kriterium 6 („nicht automatisch wiederholt") ist
  damit erfüllt. Das Label liegen zu lassen wäre ein Aufschub, kein Verhalten: Die
  nächste Nacht liefe ohne Session sofort in denselben Endzustand.

## Geplante Änderungen

**`kit/board.mjs`**

- `export const VORSCHLAG_KOPF` — der Regex zieht aus `night.mjs` hierher um.
- `parseSyntheseZeilen(text)` — liest Reviewer, Kurzbezeichnung, Ausgang und bei
  `übernommen` Abschnitt und Zitat. Trägt die **gewachsene Form**:
  `**übernommen**` in Fettschrift, Klasse in der Klammer, über mehrere Zeilen
  umgebrochene Listenpunkte, Prosa nach dem Ausgang. Die Kurzbezeichnung steht
  selbst in Anführungszeichen — maßgeblich ist das Zitat **nach** dem `→`.
- `syntheseBelegt(synthese, vorschlag)` — Normalisierung über Leerraum,
  Markdown-Auszeichnung (`*`, `_`, Backticks) und Anführungszeichen-Varianten.
- Kommando `issue-review synthese-check <id> | --synthese-file <p> --vorschlag-file <p>`
  → `{ ok, gepruefte, ohneBeleg: [{ reviewer, fund, grund }] }`, Gründe
  `beleg-fehlt`, `zitat-nicht-gefunden`, `vorschlag-fehlt`.
- **Leerfälle:** Ohne Synthese-Kommentar oder ohne `übernommen`-Zeile
  → `{ ok: true, gepruefte: 0, ohneBeleg: [] }`. Nichts behauptet, nichts zu
  belegen.

**`kit/night.mjs`**

- `VORSCHLAG_KOPF` wird importiert statt lokal geführt.
- `werteReviewSession` ruft `synthese-check <id>` **vor** der Marker-Prüfung;
  `ok: false` ergibt `syntheseOhneBeleg` unabhängig vom Marker. `gepruefte: 0` ist
  kein Ausgang.
- Zähler, Abschlusszeile `Nacht-Review beendet …` und Ergebnisstand tragen den
  fünften Wert (Spec `night-5`).
- Im Erzeugungsmodus bleibt `pruefEnde` unverändert: `kit:klaeren` ist Endzustand,
  das Routing-Label fällt (A10).

**`skills/issue-review/SKILL.md`** (Quelle; Kopie über `sync-blobs`)

- Schritt 5b: Beleg-Form in Vorlage und Regel-Liste.
- Schritt 6: Der Abgleich läuft **auf den Entwürfen, vor der Zustimmung**
  (interaktiv) bzw. vor Schreibbefehl 1 (nachts). Bei `ok: false` bleibt der
  Marker aus und `kit:klaeren` wird gesetzt.
- Der Skill schreibt in **beiden** Betriebsarten einen eigenen Kommentar
  `## Synthese-Abgleich, Runde n` — je Zeile Reviewer, Fund, Grund. Der Runner
  schreibt keinen zweiten, sondern nennt den Ausgang nur in Ergebnisstand und
  Protokoll. Ein Chat-Hinweis ist kein „am Dokument" (Kriterium 5).

**Specs und Docs**

- Je eine neue Aussage für `board`, `night`, `skills` — über den Abschnitt
  `## Spec-Wirkung` der Arbeitspakete, nicht durch direktes Schreiben in `specs/`.
- `docs/dokumentation.md`: Die Tabelle nennt heute „Drei Ausgänge pro Issue" —
  schon der vierte fehlt. Sie geht auf fünf Zeilen.

## Offene Fragen

- Keine.

## Verifizierung

- `node .claude/kit/checks.mjs run` grün auf dem zu committenden Stand.
- **Fixtures aus echten Daten:** Die Paare aus #579, #580, #583–#585 und #587
  werden mit Herkunft und Abrufstand als lokale Fixtures gesichert. Board-Karten
  sind veränderlich und taugen nicht als Testeingabe.
- **Beleg-fehlt-Pfad:** Die **unveränderten** Bestandssynthesen tragen die
  Beleg-Syntax nicht — sie ergeben `beleg-fehlt` je `übernommen`-Zeile, nicht
  `ok: true`.
- **Negativnachweis:** Aus denselben echten Paaren werden die `übernommen`-Zeilen
  um Belege **aus dem tatsächlichen Vorschlagstext** ergänzt — Zitate kopiert,
  nichts erfunden, die Aufbereitung kenntlich gemacht. Darauf meldet das Kommando
  `ok: true`. Keine Fehlalarme auf gewachsenem Markdown.
- **Positivnachweis:** Aus einem so aufbereiteten Paar wird **eine** nur dort
  vorkommende Belegstelle aus dem Vorschlagstext entfernt. Erwartet wird genau ein
  `zitat-nicht-gefunden` und kein weiterer Befund.
- **`vorschlag-fehlt`:** Eine Synthese ohne zugehörigen Body-Vorschlag ergibt
  `ok: false` mit diesem Grund — der Fall der neun vom 2026-08-12.
- **Drei Ablaufnachweise getrennt:** interaktive Prüfung vor der Zustimmung;
  Review-Modus mit dem fünften Ausgang im Ergebnisstand; Erzeugungsmodus mit
  `kit:klaeren`, fallendem Routing-Label und erneutem Runner-Aufruf.
- Dogfooding-Kopien byte-identisch (`tools/sync-blobs.mjs --check`), `install.mjs`
  neu gebacken.
