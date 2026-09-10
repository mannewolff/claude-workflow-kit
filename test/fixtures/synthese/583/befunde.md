## Issue-Review, Runde 1

Reviewer: fable (pruefbarkeit) — Stufe `issue`, Sollbesetzung 1, vollzaehlig gelaufen, kein Ausfall. Reviewer-Quelle: `pairs`, Autor `claude-opus-5` aufgeloest. Rundenzahl 1 (Quelle: `config`). Interaktiver Lauf.
fable — Bestand: gelesen

### fable — Vollstaendigkeit und Pruefbarkeit

## Issue-Review #583 — Befunde (Stufe `issue`, Rolle pruefbarkeit)

### 1. WICHTIG — Klasse: `korrektur` — Akzeptanzkriterium 1 trifft die Body-Schreibung nicht

**Wo:** Akzeptanzkriterium, „`grep -c "issue \(comment\|update\) <id> --text - <<'" skills/issue-review/SKILL.md` ergibt `0`."

Die vierte Stelle (Body-Schreibung, Zeile 666 im Bestand) lautet `issue update <id> --body - <<'BODY'`, nicht `--text -`. Das Muster liefert heute `3`, obwohl vier Heredoc-Stellen existieren; eine belassene `--body - <<'BODY'`-Stelle liesse das Kriterium nach der Aenderung trotzdem auf `0` stehen.

**Vorschlag:** `grep -c "issue \(comment\|update\) <id> --\(text\|body\) - <<'" skills/issue-review/SKILL.md` ergibt `0` (heute: `4`).

### 2. WICHTIG — Klasse: `korrektur` — Kriterium „Issue #270" ist heute schon erfuellt und prueft die Fortschreibung nicht

**Wo:** Akzeptanzkriterium, „`grep -c "Issue #270" skills/issue-review/SKILL.md` ergibt mindestens `1` — die Begruendung ist fortgeschrieben, nicht geloescht."

`grep -c "Issue #270"` liefert im Bestand bereits `1` (Zeile 479). Das Kriterium unterscheidet nicht zwischen unveraendertem und fortgeschriebenem Absatz. Aufgabe 3 verlangt: Quoting-Argument bleibt, „also Heredoc" wird durch „also stueckweise in eine Datei" ersetzt, mit Datum.

**Vorschlag:** Drei Kriterien statt einem:
- `grep -c "Issue #270" skills/issue-review/SKILL.md` ergibt mindestens `1`.
- `grep -c "stueckweise in eine Datei\|stückweise in eine Datei" skills/issue-review/SKILL.md` ergibt mindestens `1`.
- `grep -c "ber stdin, nicht als Argument" skills/issue-review/SKILL.md` ergibt `0` (heute: `1`).

### 3. WICHTIG — Klasse: `korrektur` — Das `$TMPDIR`-Kriterium ist heute schon erfuellt und poroes

**Wo:** Akzeptanzkriterium, „`grep -c 'cat >* "\$TMPDIR' skills/issue-review/SKILL.md` ergibt `0` — kein Variablenpfad im Muster."

Liefert im Bestand bereits `0` (es gibt dort noch keinen Dateiweg). Das Muster faengt zudem nur `cat > "$TMPDIR` und `cat >> "$TMPDIR` mit Leerzeichen vor dem Anfuehrungszeichen; `cat >"$TMPDIR`, `cat > $TMPDIR/…` (unquotiert), `cat > "${TMPDIR}`, `tee "$TMPDIR/…"` und `printf … > "$TMPDIR` gehen durch. Das Log zeigt genau die Form `cat > "$TMPDIR/paket-c.md"` als abgewiesen — die Regel soll jede Form treffen.

**Vorschlag:** `grep -c '\$TMPDIR\|\${TMPDIR}' skills/issue-review/SKILL.md` ergibt `0` — die Variable kommt im Skill gar nicht vor; die Beschreibung des abgewiesenen `$TMPDIR`-Redirects steht nur im Register-Abschnitt. (Ergaenzend Aufgabe 6: der Test prueft je Codeblock, dass kein `$` im Redirect-Ziel steht.)

### 4. WICHTIG — Klasse: `korrektur` — Der Register-Abschnitt verweist auf eine Datei, die es in installierten Projekten nicht gibt, und nennt eine Zahl, die das Log nicht zeigt

**Wo:** Aufgabe 1, „Dazu der Satz, dass diese Zahl eine Beobachtung vom 2026-09-10 ist (`.claude/night-run-2026-09-10.log`: Grauzone bei rund zehntausend Zeichen, groesster unauffaelliger Aufruf 7.028)".

`templates/CLAUDE-workflow.md` wird ueber `tools/sync-blobs.mjs` als Blob in `install.mjs` gebacken und in jedes Projekt installiert. `.claude/night-run-2026-09-10.log` ist per `.gitignore` (Zeile 57, `.claude/*`) ausgeschlossen und existiert nur auf einer Maschine — ein Verweis darauf ist in jedem anderen Projekt tot. Ausserdem stimmt die Zahl nicht mit dem Log ueberein: Ausgewertet ueber alle `board.mjs issue`-Aufrufe mit Heredoc oder Datei ist der groesste erfolgreiche Aufruf 9.722 Zeichen (`issue comment 574 --text - <<'BEFUNDE'`), der kleinste abgewiesene 10.154 Zeichen; die Abweisung lautet woertlich „Parser aborted (timeout, resource limit, or over-length)". Ein Heredoc **in eine Datei** (`cat > /tmp/claude-501/body-new.md <<'BODY'`, 18.921 Zeichen) wurde ebenso abgewiesen — der Beleg dafuer, dass die Grenze je Aufruf gilt, nicht je Board-Aufruf.

**Vorschlag:** „Die 6.000 sind eine Beobachtung vom 2026-09-10 im Kit-Repo (Issue #579), keine Zusage des Werkzeugs: Aufrufe bis 9.722 Zeichen gingen durch, ab 10.154 wies der Befehls-Parser sie mit „Parser aborted (timeout, resource limit, or over-length)" ab — auch ein `cat >>` in eine Datei, nicht nur der Board-Aufruf." Kein Dateipfad im Register; die Zahl 7.028 entfaellt oder wird belegt.

### 5. WICHTIG — Klasse: `korrektur` — Die Ausfall-Form nach einem gelungenen Befunde-Kommentar loescht die Befunde aus dem Pruefzustand

**Wo:** Aufgabe 4, „Scheitert die Ablage oder der Board-Aufruf, folgt genau **ein** Versuch, die vorhandene Ausfall-Form zu schreiben — Anker in Zeile 1, in Zeile 2 „Ausfall: Ergebnis nicht ans Board gebracht (Groesse), von Hand nachsehen"."

Die Regel gilt laut Text fuer alle vier Stellen. `reviewZustand` (`kit/board.mjs`, Regel 3) liefert `ausgefallen`, sobald der **juengste** Kommentar mit Anker `## Issue-Review, Runde n` in Zeile 2 `ausfall` traegt — und „Ein Ausfall ist keine Pruefung" ist dort ausdruecklich Absicht. Scheitert erst die Synthese, der Body-Vorschlag oder die Body-Schreibung, steht der Befunde-Kommentar bereits am Board; die Ausfall-Form dahinter meldet dann „Ergebnis nicht ans Board gebracht", obwohl es dort steht, und stellt das Dokument auf `ausgefallen` zurueck, sodass die naechste Nacht von vorn prueft. Fuer diese Lage gibt es bereits eine Spur: `night.mjs --review` meldet „Befunde vorhanden, aber kein Body-Vorschlag — Schaerfung fehlt" (`kit/night.mjs`, Zeile 2364).

Zweiter Punkt derselben Stelle: Der Klammertext „(Groesse)" wird unabhaengig von der Ursache geschrieben. Der Board-Aufruf mit `--text-file` scheitert nicht mehr an der Groesse, sondern an Netz, Auth oder Drosselung — dann ist „(Groesse)" eine falsche Diagnose fuer den, der morgens nachsieht.

**Vorschlag:** „Die Ausfall-Form gilt nur, wenn der **Befunde-Kommentar** selbst nicht ans Board kommt — also noch kein Kommentar mit dem Runden-Anker existiert. Scheitert ein spaeterer Schritt (Synthese, Body-Vorschlag, Body-Schreibung), bleibt es beim bestehenden Mutationsstopp: Skill endet mit Fehler, keine weitere Mutation, der Befunde-Kommentar ist die Board-Spur, und `night.mjs` meldet „Schaerfung fehlt". Zeile 2 der Ausfall-Form lautet „Ausfall: Ergebnis nicht ans Board gebracht (<erste Zeile der Fehlermeldung>), von Hand nachsehen"." Dazu ein Kriterium: `grep -c "Ausfall: Ergebnis nicht ans Board gebracht" skills/issue-review/SKILL.md` ergibt mindestens `1`, und derselbe Absatz enthaelt `Befunde-Kommentar`.

### 6. WICHTIG — Klasse: `korrektur` — Nach der Ausfall-Form ist offen, ob `label-sync` folgt; der Plan geht von einem Label aus, das es nicht gibt

**Wo:** Aufgabe 4, „Das ist ausdruecklich die **einzige Ausnahme** vom bestehenden Mutationsstopp"; dazu Plan #580, A9: „`label-sync` zeigt ihn als `review:ausgefallen` am Label der Karte" und Verifizierung 4.

`kit/board.mjs` kennt vier Zustandslabels (`review:offen`, `review:befunde`, `review:fertig`, `review:grenze`); `ausgefallen` bildet auf `review:offen` ab (Zeile 3512). Ein `review:ausgefallen` gibt es nicht. Das Issue nennt `label-sync` nach der Ausfall-Form nicht — konsistent mit „einzige Ausnahme", aber der Implementierer liest den Plan mit und findet dort eine Verifizierung, die nie gruen werden kann. Ist die Ausfall-Form auf den Befunde-Kommentar beschraenkt (Fund 5), traegt die Karte zu dem Zeitpunkt noch `review:offen`, und `label-sync` ist ueberfluessig.

**Vorschlag:** Satz in Aufgabe 4: „Nach der Ausfall-Form folgt **kein** `label-sync`: Vor dem Befunde-Kommentar traegt die Karte `review:offen`, und `ausgefallen` bildet ohnehin auf `review:offen` ab (`kit/board.mjs`, `ZUSTAND_ZU_LABEL`). Ein `review:ausgefallen` existiert nicht; Plan #580, A9 und Verifizierung 4 sind an dieser Stelle ueberholt."

### 7. HINWEIS — Klasse: `alternativen` — Wie der woertliche Pfad im Skill-Text dargestellt wird, ist nicht festgelegt

**Wo:** Aufgabe 2 („Pfad steht woertlich") und Aufgabe 6 („ein woertlicher Pfad ohne `$`").

Der Skill ist eine Vorlage — er kann keinen echten Pfad enthalten, weil `TMPDIR` je Session anders lautet. Der Implementierer muss eine Notation waehlen, und Paket C dehnt den Test genau auf diese Notation aus: (a) Platzhalter in spitzen Klammern wie `<tmpdir>/<id>-befunde.md`, konsistent mit `<id>`; (b) ein Beispielpfad wie `/tmp/claude-501/<id>-befunde.md`, der in anderen Umgebungen falsch waere und dann doch abgetippt wird. Im Log haben die Sessions Variante (b) genutzt.

**Vorschlag:** Festlegen: „Im Skill steht der Platzhalter `<tmpdir>` (Ausgabe von `printenv TMPDIR`) plus fester Dateiname je Stelle: `<tmpdir>/<id>-befunde.md`, `<tmpdir>/<id>-synthese.md`, `<tmpdir>/<id>-vorschlag.md`, `<tmpdir>/<id>-body.md`. `test/skills-transport.test.mjs` prueft je Stelle auf `<tmpdir>/` und auf das Fehlen von `$` im Redirect-Ziel."

### 8. HINWEIS — Klasse: `korrektur` — Der Test muss Heredoc-in-Datei von Heredoc-am-Board-Aufruf trennen

**Wo:** Aufgabe 6, „kein `<<'`-Heredoc am Board-Aufruf".

Das stueckweise Schreiben geschieht selbst per Heredoc (`cat >> <tmpdir>/… <<'TEIL1'`). Ein Test, der pauschal `<<'` im Codeblock verbietet, wuerde die neue Form abweisen; einer, der nur die `board.mjs`-Zeile prueft, uebersieht `{ cat …; } | board.mjs` — im Log als „Contains brace with quote character (expansion obfuscation)" abgewiesen.

**Vorschlag:** „Der Test prueft je Stelle: In der Zeile mit `board.mjs issue comment|update` steht weder `<<` noch `|` noch `-` als Wert von `--text`/`--body`; die Datei-Zeilen davor duerfen Heredocs tragen." Dazu im Register ein Satz: „Kein Pipe, keine Gruppierung `{ … }` um den Board-Aufruf."

### 9. HINWEIS — Klasse: `korrektur` — Die Ausfall-Form geht als Argument, nicht ueber Datei; das muss dastehen

**Wo:** Aufgabe 4 zusammen mit Aufgabe 3 („der Text geht nie als Argument").

Die Ausfall-Form ist zwei Zeilen lang und soll gerade dann geschrieben werden, wenn der Dateiweg scheitert. Sie muss also per `--text "…"` gehen — das widerspricht dem fortgeschriebenen #270-Absatz, wenn der es nicht ausnimmt.

**Vorschlag:** In Aufgabe 4 ergaenzen: „Die Ausfall-Form geht als `--text "…"`-Argument — zwei Zeilen, kein Dateiweg; der #270-Absatz nennt sie als die eine kurze Ausnahme."

### 10. HINWEIS — Klasse: `korrektur` — „Die vorhandene Ausfall-Form" existiert im Bestand in zwei widerspruechlichen Fassungen

**Wo:** Aufgabe 4, „die vorhandene Ausfall-Form zu schreiben — Anker in Zeile 1, in Zeile 2 …".

`skills/issue-review/SKILL.md` Zeile 212 sagt Zeile 2, Zeile 692 sagt „Die **erste Zeile** des Board-Kommentars nennt den Ausfall mit Grund". `reviewZustand` liest Zeile 2. Wer Zeile 692 als Vorlage nimmt, erzeugt einen Kommentar, den der Zustand nicht erkennt.

**Vorschlag:** „…die vorhandene Ausfall-Form aus dem Unterabschnitt zur Stufe `issue` (Zeile 2 traegt den Ausfall; `reviewZustand` liest Zeile 2). Zeile 692 im Nacht-Abschnitt wird im selben Zug auf „zweite Zeile" korrigiert."

### 11. HINWEIS — Klasse: `korrektur` — `checks.mjs run` ohne `--since` misst nur den uncommitteten Stand

**Wo:** Akzeptanzkriterium, „`node .claude/kit/checks.mjs run` endet mit Exitcode 0."

Bei sauberem Working Tree laesst das Kommando alles aus und meldet Exit 0 — nach dem Commit ist das Kriterium trivial erfuellt.

**Vorschlag:** „`node .claude/kit/checks.mjs run` endet **vor dem Commit** mit Exitcode 0."

### Was RAUS kann

- Aufgabe 4, „Ein bestimmter Endzustand wird **nicht zugesichert**." — traegt ohne Bezug nichts; der Plan fuehrt es aus (vorhandener Marker bleibt `fertig`, vorhandene Runden koennen `grenze` ergeben). Entweder diesen Halbsatz uebernehmen oder den Satz streichen.
- Aufgabe 5, der Klammertext „(heute verlangt der Test dort `--text -` und die Wendung „ueber stdin, nicht als Argument")" — Bestandsbeschreibung, kein Auftrag; der Implementierer liest den Test ohnehin. Dafuer fehlt der Hinweis, dass der dritte Test derselben Datei („im Heredoc-Beispiel stehen keine Backslash-Escapes mehr") nach der Umstellung ins Leere schneidet (`indexOf("SYNTHESE")` findet den Marker nicht mehr) — der gehoert mit umgestellt oder gestrichen.

Bestand: gelesen
