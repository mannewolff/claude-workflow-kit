## Issue-Review, Runde 1

Reviewer: fable (pruefbarkeit) — Stufe `issue`, Sollbesetzung 1, vollzaehlig gelaufen, kein Ausfall. Reviewer-Quelle: `pairs`, Autor `claude-opus-5` aufgeloest. Rundenzahl 1 (Quelle: `config`). Interaktiver Lauf.
fable — Bestand: gelesen

### fable — Vollstaendigkeit und Pruefbarkeit

## Befunde zu Issue #585

**1. BLOCKER · Klasse: `korrektur` — `review:ausgefallen` gibt es nicht**

Wo: Aufgabe 3 („… mit anschliessendem `label-sync` auf `review:ausgefallen`") und Akzeptanzkriterium („im zweiten Fall `review:ausgefallen`").

Bestand: `.claude/kit/board.mjs` kennt genau vier Zustandslabels (`ZUSTANDS_LABELS`, Zeile 3504: `review:offen|befunde|fertig|grenze`); der Zustand `ausgefallen` bildet in `ZUSTAND_ZU_LABEL` (Zeile 3508–3514) auf `review:offen` ab — mit Begründung „Ein ausgefallener Reviewer ist kein Pruefergebnis". Das Register (`templates/CLAUDE-workflow.md`, „Zustandslabels") nennt dieselben vier Namen als fest. Das Kriterium ist so nicht erfüllbar; eine Session würde entweder scheitern oder das Label anlegen und damit ein Verhalten ändern, das dieses Paket ausdrücklich nicht ändern will.

Vorschlag: „… und im zweiten Fall die Ausfall-Form (Anker `## Issue-Review, Runde n` in Zeile 1, `Ausfall: …` in Zeile 2) mit anschliessendem `issue-review label-sync <id>`. Nachweis: `issue get` zeigt am Testdokument `review:offen` und nicht `review:befunde` — `ausgefallen` bildet auf `review:offen` ab (board.mjs, `ZUSTAND_ZU_LABEL`)."

**2. BLOCKER · Klasse: `alternativen` — eine Session hat genau eine Betriebsart**

Wo: Aufgabe 2 („Der Nachweis laeuft **einmal interaktiv und einmal unter `night.mjs` mit `acceptEdits`**") und Akzeptanzkriterium („Der Durchgang unter `night.mjs` ist im Ergebnisstand des Laufs nachweisbar").

Die umsetzende Session läuft entweder interaktiv oder unter `night.mjs`; den jeweils anderen Durchgang kann sie nicht aus eigener Kraft liefern. Selbst `night.mjs` als Unterprozess zu starten scheitert an drei Stellen im Bestand: (a) `night.mjs:2603` stoppt hart bei unsauberem Working Tree — die Session hat ihre eigene Testdatei uncommittet; (b) der Runner wählt nach Spalte und Label (`selectReviewCandidates`, `sammleKandidaten`), nicht nach einem gewünschten Testdokument — er würde echte Backlog-/Ready-Karten anfassen; (c) er startet `claude -p` (Zeile 1610) aus einer laufenden Claude-Session heraus. Zwei gangbare Wege:

- Weg A (empfohlen): Der Nachweis läuft in der Betriebsart der umsetzenden Session; die Session benennt sie im Kommentar (nachts ist `KIT_AGENT_MODEL` gesetzt, `night.mjs:1620`; interaktiv bewusst nicht). Der Durchgang in der anderen Betriebsart wandert in „Manuelle Pruefung".
- Weg B: Das Paket wird zweimal umgesetzt (einmal per `/implement-ready` interaktiv, einmal per Nachtlauf); dann muss das Issue sagen, welcher Durchgang welchen Kommentar schreibt und wer den zweiten auslöst.

Vorschlag für Weg A, Aufgabe 2: „Der Nachweis laeuft in der Betriebsart, in der diese Session laeuft, und benennt sie im Kommentar (`printenv KIT_AGENT_MODEL`: gesetzt = unbeaufsichtigt unter `night.mjs` mit `acceptEdits`, leer = interaktiv). Beide Betriebsarten muessen einmal belegt sein; der fehlende Durchgang steht unter Manuelle Pruefung." Und unter „Manuelle Pruefung": „Der Durchgang in der jeweils anderen Betriebsart wird vom Menschen ausgeloest (interaktiv: `/implement-next #585`-Nachlauf oder Handdurchgang nach dem Muster; nachts: Ready + `kit:nightrun`)."

**3. WICHTIG · Klasse: `korrektur` — der Ergebnisstand belegt den Durchgang nicht, und die Session kann ihn nicht zitieren**

Wo: Akzeptanzkriterium („Der Durchgang unter `night.mjs` ist im Ergebnisstand des Laufs nachweisbar; die Fundstelle wird im Abschlussbericht genannt").

Bestand: Der Ergebnisstand `.claude/night-run-<Datum>-<Uhrzeit>.json` wird vom Runner geschrieben (`ergebnisstandAnlegen`, `night.mjs:792ff.`); eine Einheit trägt `id`, `titel`, `ausgang`, `grund` (plus Kennzahlen bei `--verbose`) — nichts über Kommentargrößen oder Byte-Gleichheit. Der Abschluss der Einheit zu #585 entsteht erst, nachdem die Session beendet ist; sie kann ihn im Abschlussbericht nicht nennen, allenfalls den Dateinamen raten (`ls -t .claude/night-run-*.json | head -1`).

Vorschlag: Kriterium streichen und durch zwei ersetzen — oben: „Der Kommentar an #585 nennt die Betriebsart und den Wert von `KIT_AGENT_MODEL`." Unter Manuelle Pruefung: „Morgens: Die Einheit zu #585 im Ergebnisstand des Laufs (`.claude/night-run-*.json`) zeigt das Issue als in In review angekommen; der Kommentar mit dem Vergleichsergebnis trägt dasselbe Modell wie `modell` im Ergebnisstand."

**4. WICHTIG · Klasse: `alternativen` — wie die zwei Fehlerpfade herbeigeführt werden, ist offen, und ein Weg macht das Kriterium unerfüllbar**

Wo: Aufgabe 3 („Ein fehlgeschlagener Dateischritt und ein fehlgeschlagener Board-Aufruf werden gezielt herbeigefuehrt").

Der naheliegende Weg für den Board-Fehler — eine nicht existierende Issue-Nummer — macht die geforderte Ausfall-Form und `label-sync` an derselben Karte unmöglich. Gangbar sind: (a) `TBX_TOKEN=ungueltig` nur für den einen Aufruf (Umgebungsvariable hat Vorrang, `board.mjs:1317`), danach laufen Ausfall-Form und `label-sync` mit gültigem Token; (b) `--text-file` auf einen nicht vorhandenen Pfad — das scheitert aber schon in `leseTextQuelle` vor jedem Netzaufruf und ist damit ein Dateischritt-Fehler, kein Board-Fehler. Für den Dateischritt: `cat >> <Pfad in nicht existierendem Verzeichnis>` oder ein Stück, das absichtlich fehlt.

Außerdem: „kein neuer Marker" und die Ausfall-Form sind Verhalten des Skills `/issue-review` (Schritt 6 bzw. Ausfall-Regel), nicht des Transportmusters. Führt die Session das Muster von Hand aus, beweist sie nur die Ableitung in `board.mjs`, nicht, dass eine Skill-Session sich nachts so verhält. Das sollte das Issue benennen, sonst behauptet der Abschlussbericht mehr, als geprüft wurde.

Vorschlag: „**3. Nachweis der Fehlerpfade am Muster, nicht am Skill.** Dateischritt: Ein Stück wird in einen nicht vorhandenen Ordner geschrieben; die Datei bleibt unvollständig und wird nicht übertragen. Board-Aufruf: `TBX_TOKEN=ungueltig node .claude/kit/board.mjs issue comment <test-id> --text-file <pfad>` für genau diesen Aufruf; danach mit gültigem Token die Ausfall-Form und `label-sync`. Geprüft wird über `issue get`: Die Zahl der `comments` ist nach dem Dateischritt-Fall unverändert und nach dem Board-Fall um genau eins (die Ausfall-Form) gewachsen; kein Kommentar enthält einen Teil des 19.000-Zeichen-Textes; der Body trägt keine Zeile `Issue-Review:`; die Labels enthalten `review:offen`. Ob eine `/issue-review`-Session nachts so handelt, belegt dieser Nachweis nicht — das zeigt erst ein echter Nachtreview."

**5. WICHTIG · Klasse: `korrektur` — Byte-Gleichheit des Bodys scheitert am Adapter, nicht am Transport, wenn das Testdokument nicht vorbereitet ist**

Wo: Aufgabe 2 („ein Body derselben Groessenordnung … byteweise gegen die Quelldatei zurueckgelesen") und Akzeptanzkriterium („je Byte-Gleichheit").

Bestand: `issue create` fügt eine fehlende Zeile `Autor-Modell:` ein (`autorModellSicherstellen`, `board.mjs:2101ff.`) und weist einen Body ohne `## Spec-Wirkung` ab (`specWirkungSicherstellen`; die Config hat einen `spec`-Block); `issue update` läuft zusätzlich durch `pruefvorgabeDurchsetzen`. Ein beliebiger 19.000-Zeichen-Text kommt also entweder gar nicht an oder verändert zurück — und das ist kein Transportbefund. Ungeklärt ist auch, was aus dem Testdokument wird: Es entsteht auf dem echten Board (`kanban.mwolff.org`) mit zwei 19.000-Zeichen-Kommentaren.

Vorschlag: „Das Testdokument wird mit `issue create --title "[Test] Transportnachweis #585"` angelegt; sein Body trägt von Anfang an `Autor-Modell:` und `## Spec-Wirkung` mit `KEINE — …`, damit der Adapter nichts einfügt und nichts abweist. Der 19.000-Zeichen-Body geht über `issue update <test-id> --body-file <pfad>`; der Vergleich: `node -e` liest `issue get` als JSON und vergleicht `body` bzw. `comments[n].body` per `Buffer.compare` mit der Quelldatei. Weicht nur das abschliessende Zeilenende ab, wird das als Adapterbefund protokolliert und zählt nicht als Transportfehler. Nach dem Nachweis wird das Testdokument mit `issue move <test-id> done` abgeräumt; es trägt kein Routing-Label."

**6. WICHTIG · Klasse: `korrektur` — „Ohne Zeitdruck einer Pruef-Session" ist nicht prüfbar und trifft den Bestand nicht**

Wo: Aufgabe 2, letzter Satz.

Bestand: Review-Sessions haben ein festes Limit von 15 Minuten (`REVIEW_TIMEOUT_MS`, `night.mjs:311`), Implementierungs-Sessions `--timeout-min` (Default 60). Läuft der Nachweis in der Implementierungs-Session zu #585, gilt das 60-Minuten-Limit ohnehin; der Satz sagt nicht, was zu tun ist, wenn die Zeit doch knapp wird.

Vorschlag: Satz streichen oder ersetzen durch: „Der Nachweis läuft in der Implementierungs-Session (Zeitlimit `--timeout-min`, Default 60 min), nicht in einer Review-Session (fest 15 min). Reicht die Zeit nicht für beide Richtungen (Kommentar und Body), wird der erreichte Stand kommentiert und das Issue bleibt in In progress."

**7. HINWEIS · Klasse: `korrektur` — `grep -c "SKILL.md" ≥ 8` belegt nicht „zwölf Stellen einzeln benannt"**

Wo: Akzeptanzkriterium, erste Zeile.

Acht Dateinennungen sind mit vier Stellen erreichbar; die Einzelbenennung ist der Kern von Aufgabe 1 und bleibt unbelegt.

Vorschlag: „`test/skills-transport.test.mjs` führt eine Tabelle mit genau zwölf Einträgen (Datei + Befehl), und je Eintrag entsteht ein eigener `test(`-Fall mit Datei und Befehl im Namen; `node --test test/skills-transport.test.mjs 2>&1 | grep -E '^# pass 12$'` trifft, `# fail 0`. Die acht Dateien sind `skills/{issue-review,issues,fachplan,techplan,implement-ready,implement-next,implement-done,review}/SKILL.md`."

**8. HINWEIS · Klasse: `korrektur` — RAUS: der `grep -rc … <<'`-Satz doppelt #584 und ist blind für die mehrzeilige Form**

Wo: Akzeptanzkriterium, zweite Zeile.

Das Kriterium steht wortgleich in #584. Zusätzlich fängt es `skills/techplan/SKILL.md:204–208` nicht (Aufruf mit Backslash-Fortsetzung, `--body -` auf eigener Zeile) — dort ergibt es heute schon `0`. Die Prüfung aus Aufgabe 1 ist die eigentliche; das Kriterium trägt nichts.

Vorschlag: Zeile streichen.

**9. HINWEIS · Klasse: `korrektur` — Aufgabe 4 (Gegenprobe) hat keinen Ablageort**

Wo: Aufgabe 4 („das Ergebnis wird protokolliert").

Vorschlag: „… wird als eine Zeile im Vergleichskommentar an #585 protokolliert: `Gegenprobe inline: <angenommen|abgewiesen>, <Zeichen>, <Betriebsart>, <Grundtext des Werkzeugs, falls abgewiesen>`." Wird das nicht gewollt, Aufgabe 4 ganz streichen — ohne Ablageort ist sie folgenlos.

**10. HINWEIS · Klasse: `korrektur` — Manuelle Prüfung: Zahl streichen, Verursacher nennen; Aufgabe 5 ist leer**

Wo: „Manuelle Pruefung" („… liegt heute schon 77 Zeilen hinter der Vorlage") und Aufgabe 5.

Der Abstand ist heute 79 Zeilen und wächst mit #583; die Zahl veraltet im Issue. Der Schritt entsteht durch #583 (ändert `templates/CLAUDE-workflow.md`), nicht durch #585 — er gehört zumindest mit Verweis dorthin. Aufgabe 5 („falls dieses Paket Skill- oder Kit-Dateien beruehrt") greift nie: Das Paket ändert nur `test/`; das Kriterium `sync-blobs --check` deckt den Fall ohnehin ab.

Vorschlag: Manuelle Prüfung: „Nach dem Merge von #583–#585 wird `.claude/CLAUDE-workflow.md` per `cp templates/CLAUDE-workflow.md .claude/CLAUDE-workflow.md` ersetzt (per `.gitignore` `.claude/*` ausgeschlossen, von `sync-blobs` nicht geführt). Das ist eine Änderung ausserhalb des versionierten Stands und wird als solche angesagt." Aufgabe 5 streichen.

Bestand: gelesen
