## Issue-Review, Runde 1

Reviewer: fable (pruefbarkeit) — Stufe `issue`, Sollbesetzung 1, vollzaehlig gelaufen, kein Ausfall. Reviewer-Quelle: `pairs`, Autor `claude-opus-5` aufgeloest. Rundenzahl 1 (Quelle: `config`). Interaktiver Lauf.
fable — Bestand: gelesen

### fable — Vollstaendigkeit und Pruefbarkeit

**Befund zu Issue #584**

---

**1. BLOCKER — korrektur — Akzeptanzkriterium 4 ist heute schon erfüllt, weil das Suchmuster am Umlaut vorbeigeht**

Abschnitt „Akzeptanzkriterium", Zeile `grep -c "kein Zwischenschritt ueber eine Wrapper- oder Temp-Datei" skills/implement-next/SKILL.md ergibt 0`.

Im Bestand steht (Zeile 154): „kein Zwischenschritt **über** eine Wrapper- oder Temp-Datei" — mit ü, nicht ue. Das Kriterium liefert im unveränderten Repo bereits `0`; es prüft nichts. Dasselbe Zitat steht in Aufgabe 2 („woertlich"), auch dort mit `ueber` — wer die Stelle per Suche nach dem Zitat sucht, findet sie nicht.

Vorschlag: `grep -c "Zwischenschritt .*ber eine Wrapper- oder Temp-Datei" skills/implement-next/SKILL.md` ergibt `0` — und in Aufgabe 2 das Zitat auf den Bestand korrigieren („kein Zwischenschritt über eine Wrapper- oder Temp-Datei").

---

**2. BLOCKER — korrektur — Zwei weitere Tests verlangen den alten Weg und sind nicht Teil der Aufgabe; Kriterium „node --test ohne fehlgeschlagene Tests" ist mit Aufgabe 5 nicht erreichbar**

Abschnitt „Aufgabe", Punkt 5: „**Beide** auf das neue Muster umstellen." — genannt sind nur `skills-fachplan-autor` und `skills-techplan-ticket`.

Im Bestand brechen nach der Umstellung außerdem:
- `test/board-text-quelle.test.mjs:136` — „die Skills zeigen den stdin-Weg": `assert.match(text, /--text -/)` für `review`, `implement-ready`, `implement-next`. Paket #583 stellt diese Datei laut eigener Aufgabe 5 nur um, „soweit es `skills/issue-review/SKILL.md` betrifft"; die Schleife über die drei anderen Skills bleibt.
- `test/board-create-bodyfile.test.mjs:109` — „der /issues-Skill zeigt den stdin-Weg beim Anlegen": `assert.match(skill, /--body -/)`.

Plan #580 nennt `board-text-quelle` ausdrücklich als dritte umzustellende Testdatei; im Issue fehlt sie. Eine Session, die „Beide" wörtlich nimmt, steht vor der Wahl, `--text -` irgendwo im Skill stehen zu lassen, damit der Test grün bleibt.

Vorschlag für Aufgabe 5: „`test/skills-fachplan-autor.test.mjs` (…), `test/skills-techplan-ticket.test.mjs` (…), **`test/board-text-quelle.test.mjs`** (Test „die Skills zeigen den stdin-Weg": verlangt `--text -` in `review`, `implement-ready`, `implement-next`) und **`test/board-create-bodyfile.test.mjs`** (Test „der /issues-Skill zeigt den stdin-Weg beim Anlegen": verlangt `--body -`) auf das neue Muster umstellen — die beiden letzten prüfen künftig `--text-file` bzw. `--body-file` und weiterhin, dass kein `--text "`/`--body "` als Argument gezeigt wird." Im Akzeptanzkriterium: „einschliesslich der **vier** umgestellten Testdateien".

---

**3. WICHTIG — korrektur — In `implement-next` steht ein zweiter Satz, der dem neuen Weg widerspricht; Aufgabe 2 nennt nur den ersten**

Abschnitt „Aufgabe", Punkt 2 ersetzt allein Zeile 154. Neun Zeilen weiter (Zeile 163, Absatz „Working Tree sauber hinterlassen") steht: „Lege für den Abschlussbericht keine Hilfsdateien an (kein `.tmp-report.md`, kein Node-Wrapper zum Posten) — der `issue comment --text -`-Aufruf oben genügt, auch für lange Berichte (Issue #270)." Nach der Umstellung gibt es den `--text -`-Aufruf „oben" nicht mehr, und „keine Hilfsdateien" verbietet genau die Datei, die die Transportregel vorschreibt. Kein Akzeptanzkriterium fängt das.

Vorschlag: Aufgabe 2 um einen zweiten Satz ergänzen: „Im Absatz ‚Working Tree sauber hinterlassen' (Zeile 163) wird ‚Lege … keine Hilfsdateien an … auch für lange Berichte (Issue #270)' fortgeschrieben, nicht gelöscht: keine Hilfsdateien **im Projektverzeichnis** (kein Node-Wrapper zum Posten); die Berichtsdatei liegt nach der Transportregel außerhalb und macht den Working Tree nicht unsauber." Akzeptanzkriterium dazu: `grep -c "Aufruf oben genügt" skills/implement-next/SKILL.md` ergibt `0`.

---

**4. WICHTIG — korrektur — Die Begründungsabsätze „Der Body geht über stdin" in `fachplan`, `techplan` und `issues` bleiben stehen**

Abschnitt „Aufgabe", Punkt 3 behandelt nur die „vorhandenen Datei-Absaetze". Direkt unter den umzustellenden Befehlen steht aber je ein Absatz, der den alten Weg begründet:
- `skills/fachplan/SKILL.md:65` — „Der Body geht über **stdin** (Issue #271). … Der Heredoc-Marker ist **quotiert** (`<<'BODY'`) …"
- `skills/techplan/SKILL.md:211` — „Der Body geht über **stdin** (`--body -`, Issue #271) …"
- `skills/issues/SKILL.md:163` — „**Der Body geht ueber stdin, nicht als Argument** (Issue #271). … Alternativ `--body-file <pfad>` …"

Paket #583 hat für den Absatz zu #270 in `/issue-review` ausdrücklich „fortschreiben, nicht loeschen" vorgeschrieben; hier fehlt das Gegenstück, und das Quoting-Argument (der Text geht nie als Argument) gilt für `--body-file` unverändert weiter.

Vorschlag als Aufgabe 3 (erweitert): „Die drei Absätze ‚Der Body geht über stdin' (`fachplan` 65, `techplan` 211, `issues` 163) fortschreiben wie in #583 Punkt 3: Das Argument gegen den Kommandozeilen-Weg bleibt (Issue #271), die Schlussfolgerung wird ‚also stückweise in eine Datei, dann `--body-file`' mit dem Datum 2026-09-10; der Heredoc-Hinweis entfällt." Akzeptanzkriterium: `grep -c "geht über \*\*stdin\*\*\|geht ueber stdin" <datei>` ergibt für die drei Dateien `0`.

---

**5. WICHTIG — korrektur — Akzeptanzkriterium 1 ist für `techplan` heute schon erfüllt; die Umstellung dort wird von keinem Kriterium erfasst**

Abschnitt „Akzeptanzkriterium", erste Zeile: `grep -c "board.mjs issue \(create\|update\|comment\).*<<'" <datei>` ergibt `0`.

Der Bestand in `skills/techplan/SKILL.md:204-208` ist mehrzeilig mit Backslash und endet auf `--body -` ohne Heredoc — das Muster trifft im unveränderten Repo nicht (heute: `0`). Die Aufgabe nennt den Fall selbst („mehrzeilig mit Backslash"), das Kriterium ignoriert ihn.

Vorschlag: zusätzliche Zeile „`grep -cE -- '--body -(\s|$)' skills/techplan/SKILL.md` ergibt `0`, und der Anlege-Block enthält `--body-file`." Dasselbe Muster deckt nebenbei ab, dass niemand einen Skill auf `--body -` ohne Heredoc „umstellt".

---

**6. WICHTIG — korrektur — Die Spec-Aussage behauptet für sieben Skills eine Ausfall-Form, die es dort nicht gibt; ein Fehlerpfad ist nicht definiert**

Abschnitt „Spec-Wirkung": „… und beim Scheitern bleibt die Ausfall-Form die einzige Mutation."

Die Ausfall-Form (Anker in Zeile 1, „Ausfall: …" in Zeile 2 → `review:ausgefallen`) ist der Mechanismus von `reviewZustand` und gilt nur für Prüfkommentare an Dokumenten. Für einen Abschlussbericht (`implement-*`), ein Review-Ergebnis (`review`) oder ein `issue create` (`fachplan`, `techplan`, `issues`) existiert kein Anker; der Bestand kennt dort eigene Fehlerpfade (`techplan` 231: „meldet weder eine Nummer noch einen erfolgreichen Abschluss"; `review` 63: „kein Board-Kommentar"). Die Aufgabe sagt zum Scheitern eines Dateischritts oder des Board-Aufrufs in diesen sieben Skills nichts — die Spec-Zeile würde beim Push eine Aussage festschreiben, die kein Skill-Text deckt.

Vorschlag: Neue Aufgabe 7: „Fehlerpfad je Befehlsstelle, ein Satz: Scheitert ein Dateischritt, wird die unvollständige Datei nicht übertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem wörtlichen Pfad der Datei und endet ohne weitere Mutation — die bestehenden Fehlerfälle (`techplan` ‚weder Nummer noch Erfolg', `review` ‚kein Board-Kommentar') bleiben." Spec-Wirkung entsprechend: „… überträgt sie mit `--text-file` bzw. `--body-file` in einem Aufruf; jedes Stück ist ein eigener Werkzeugaufruf mit wörtlichem Pfad, und eine unvollständige Datei wird nie übertragen."

---

**7. HINWEIS — korrektur — Das Zitat in Aufgabe 3 stammt aus `/issue-review`, nicht aus `fachplan`/`issues`**

Abschnitt „Aufgabe", Punkt 3: „Beide behandeln die Datei heute als Ausnahme („Braucht ein Werkzeug doch eine Datei")." Diese Wendung steht nur in `skills/issue-review/SKILL.md:486`. In `fachplan` (103-106) ist `--body-file` beim Grooming bereits der einzige gezeigte Weg (keine Ausnahme); in `issues` (168-169) heißt es „Alternativ `--body-file <pfad>`".

Vorschlag: „`skills/issues/SKILL.md:168` führt `--body-file` als ‚Alternativ' — daraus wird der Regelfall. `skills/fachplan/SKILL.md:103-106` zeigt beim Grooming bereits `--body-file`; dort kommt nur der Verweis auf den Register-Abschnitt dazu."

---

**8. HINWEIS — korrektur — Akzeptanzkriterium 2 ist für zwei der sieben Dateien heute schon erfüllt und prüft nicht die umgestellten Stellen**

„Dieselben sieben Dateien enthalten je mindestens einmal `--text-file` oder `--body-file`." `fachplan` (Zeile 103) und `issues` (Zeile 169) enthalten `--body-file` bereits. Das Kriterium wäre für diese beiden auch ohne Änderung grün. Paket C weitet den Test je Stelle aus; bis dahin fehlt hier die Bindung an die Befehlsstelle.

Vorschlag: „Für jede der acht Befehlsstellen aus der Tabelle steht `--text-file` bzw. `--body-file` **im selben bash-Block** wie `issue create`/`issue comment`; `grep -c "eigener Werkzeugaufruf" <datei>` ergibt für `issues` mindestens `2`, für die übrigen sechs mindestens `1`." Damit wird auch der in Aufgabe 1 geforderte Satz („je mit dem Satz zum eigenen Werkzeugaufruf") prüfbar — heute prüft ihn kein Kriterium, anders als in #583.

---

**9. HINWEIS — korrektur — `board.mjs` Zeile 27/28: der zu ersetzende Satz geht über zwei Zeilen**

Abschnitt „Aufgabe", Punkt 4 zitiert „fuer lange Texte der bevorzugte Weg: stdin". Im Bestand lautet Zeile 27-28: „'-' liest von stdin. Fuer lange Texte (Review-Befunde) der bevorzugte Weg: / keine Datei, die jemand aufraeumen muss (Issue #270)." Zeile 2839 begründet ebenso mit „Es entsteht keine Datei, die jemand aufraeumen muss." Wer nur „bevorzugte Weg" ersetzt, lässt die Begründung stehen, die dem neuen Weg widerspricht.

Vorschlag: „Die Begründung ‚keine Datei, die jemand aufraeumen muss' (Zeilen 28 und 2839) entfällt mit; an ihre Stelle tritt der Hinweis, dass die Datei außerhalb des Projektverzeichnisses liegt." Kriterium: `grep -c "aufraeumen muss" kit/board.mjs` ergibt `0`.

---

**Was raus kann**

- Akzeptanzkriterium 2 in seiner heutigen Form (siehe 8) — ersetzt durch die stellenbezogene Fassung.
- Im Kontext der Satz „die Karten existieren nur, weil die Sitzungen auf Umwegen nachgelegt haben" trägt für die Umsetzung nichts; die Zeichenzahlen davor genügen als Beleg.

Bestand: gelesen
