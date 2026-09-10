## Plan-Review, Runde 1

Reviewer: fable (architektur-bestand), gpt-astra (schnitt-abhaengigkeiten) — Stufe `plan`, Sollbesetzung 2, vollzaehlig gelaufen, kein Ausfall. Reviewer-Quelle: `pairs`, Autor `claude-opus-5` aufgeloest. Rundenzahl 1 (Quelle: `config`). Interaktiver Lauf.
fable — Bestand: gelesen
gpt-astra — Bestand: gelesen

### fable — Architektur und Bestand

## Befund zu #580 — Stufe `plan`

**Form (P1, P2, P3, P4, P6): kein Fund.** Die sechs Abschnitte stehen genau einmal und in der richtigen Reihenfolge; `### Beschreibungs-Luecken` ist eine erlaubte `###`-Ebene (P2, und so von `/techplan` Schritt 3 vorgeschrieben); `Plan-Modell:` und `Fachliche Quelle: Issue #579` stehen im Kopf, #579 existiert und traegt `[Fachlich]`; `## Offene Fragen` traegt `- Keine.`; keine `Issue-Review:`-Zeile.

**Bestand, der stimmt (P10):** `kit/board.mjs` kann `--body-file`, `--body -`, `--text-file`, `--text -` und liest `-` von stdin (HELP Zeilen 86–97, `leseTextQuelle` Zeilen 2841–2874). `reviewZustand` (Zeile 2560) filtert Kommentare auf Zeile 1 mit `^\s*##\s*<Marker>,\s*Runde\b`, `GRENZE_RUNDEN = 3` (Zeile 2515), Vergleich `>=` (Zeile 2587); eine Zeile `## Fortsetzung 2 von 3` faellt nicht darunter — A8 ist mechanisch richtig. `kit/night.mjs` schreibt den Ergebnisstand (`ergebnisstandAnlegen`/`schreibeErgebnisstand`, Zeilen 792–837, Issue #486). `issue-review label-sync` existiert (Zeile 3592). Das Zitat „zwei Kopien liefen auseinander" steht im Body von #520. `test/skills-releaseweg.test.mjs` existiert als Muster. Issue #417 ist im Skill belegt (`skills/issue-review/SKILL.md` Zeile 700).

---

### 1. BLOCKER — Der vorgeschriebene Pfad `"$TMPDIR/…"` wird nachts abgewiesen; der Beleg lief mit einem woertlichen Pfad

**Klasse:** `korrektur`

**Fundstelle:** A5: „Die Shell darf in beiden Betriebsarten nach `$TMPDIR` schreiben." Geplante Aenderung 3: `cat  > "$TMPDIR/befunde-<id>.md" <<'TEIL1'`.

Nachgesehen in `.claude/night-run-2026-09-10.log`. Session #562 rief um 09:24:24 genau dieses Muster auf (`cat > "$TMPDIR/paket-c.md" <<'BODY'`, Log-Zeile 540) und bekam in Zeile 541 `permission_denied` mit dem Grund **„Redirect target contains $(cmd) output — path is runtime-determined"**. Erst der Aufruf mit dem woertlichen Pfad `cat > /tmp/claude-501/paket-c.md` (09:24:58) kam durch; davor hatte die Session `printenv TMPDIR` gefahren (Zeile 318). A3 nennt genau diesen Lauf als Beleg — der Beleg traegt aber den woertlichen Pfad, nicht die Variable. Der Plan schreibt damit an zwoelf Stellen ein Muster vor, das im Nachtbetrieb (`--permission-mode acceptEdits`, `kit/night.mjs` Zeile 1608) zuverlaessig scheitert: dieselbe Lage „tagsueber traegt, nachts nicht", die A5 selbst als Fehler benennt. Nebenbefund: A3 sagt „viermal `cat >> …`" — im Log ist es einmal `>` und dreimal `>>`, und der `$TMPDIR`-Versuch scheiterte nicht an der Groesse, sondern am Redirect-Ziel.

**Vorschlag:** In A5 und im Muster: „Der Redirect darf keine Variable im Ziel tragen — der Nachtbetrieb weist das ab (Log 2026-09-10, ‚path is runtime-determined'). Deshalb zuerst `printenv TMPDIR`, dann den ausgegebenen Pfad **woertlich** in jeden `cat`-Aufruf und in `--text-file` uebernehmen." Verifizierung 3 um den Satz ergaenzen: „Der Nachweis laeuft einmal unter `night.mjs` mit `acceptEdits`, nicht nur interaktiv." Ob eine Form ohne Redirect (`… | tee -a "$TMPDIR/x"`) den Pruefer passiert, ist unbelegt und gehoert nicht in die Vorschrift, solange es niemand nachts gesehen hat.

### 2. BLOCKER — „Stueck" meint in A3/Schritt 3 ein Dateistueck, in A8/Schritt 6/Verifizierung 4 einen eigenen Kommentar; der Plan entscheidet nicht, ob Kommentare ueberhaupt geteilt werden

**Klasse:** `alternativen`

**Fundstelle:** A3: „stueckweise per Shell in eine Datei …, dann **ein** kurzer Board-Aufruf". Schritt 3 zeigt genau das: zwei `cat`, ein `issue comment --text-file`. A8 dagegen: „Nur das erste Stueck traegt den Anker, die Folgestuecke … beginnen mit `## Fortsetzung <n> von <m>` und werden von `reviewZustand` nicht als Runde gezaehlt" — das sind mehrere Kommentare. Verifizierung 4: „Eine dreigeteilte Runde wird an ein Testdokument geschrieben". Schritt 7 kennt aber keine Rueckfallstufe „mehrere Kommentare": Scheitert die Datei-Ablage, folgt sofort der Zweizeiler.

Wenn die Grenze der Befehls-Parser ist (A4) und der Text ueber eine Datei geht, entsteht **ein** Kommentar; dann trifft A8 einen Fall, den der Plan selbst ausschliesst, und mit ihm fallen Schritt 6, die zweite Aussage in Schritt 8 und Verifizierung 4. Sollen Kommentare doch geteilt werden (weil der Tracker eine eigene Groessengrenze haben koennte — der Plan belegt keine), dann fehlt die Stufe in Schritt 7, und A7s Satz „Kriterium 7 … fuer Kommentare durch A8" stimmt nicht: Ein in drei Kommentare geteilter `## Body-Vorschlag` muss von Hand zusammengefuegt werden, bevor ihn jemand in `issue update` uebernimmt (`skills/issue-review/SKILL.md` Zeile 717: „kopiert ihn unveraendert"), und `bodyVorschlagVorhanden` in `kit/night.mjs` (Zeile 2270ff) sieht nur das erste Stueck.

**Gangbare Wege:** (a) Kommentare werden nie geteilt — die Datei ist das Stueckwerk, der Board-Aufruf ist einer; A8, Schritt 6, Verifizierung 4 und die Anker-Aussage in Schritt 8 entfallen, Kriterium 5 („mehrere Eintraege") ist wie in A7 fuer Bodys durch „stueckweise erzeugt, in einem Zug uebertragen" erfuellt. (b) Teilen ist die zweite Rueckfallstufe, wenn der eine `--text-file`-Aufruf scheitert — dann gehoert sie in Schritt 7 vor den Zweizeiler, und der Plan muss sagen, wie die Leseseite (Synthese liest Befunde; Mensch oder `/issues` liest den Body-Vorschlag) die Stuecke ohne Handarbeit zusammenbekommt.

**Formulierungsvorschlag fuer (a):** A8 streichen; in A7: „Weder Body noch Kommentar werden am Board geteilt: Die Datei entsteht stueckweise, uebertragen wird sie in einem Zug. Die ‚mehreren Eintraege' aus Kriterium 5 sind die Stuecke der Datei, nicht mehrere Karten-Eintraege."

### 3. WICHTIG — Drei bestehende Tests verlangen den Heredoc bzw. `--body -`/`--text -` und gehen mit Schritt 3 und 5 rot; der Plan nennt sie nicht

**Klasse:** `korrektur`

**Fundstelle:** Schritt 3 („Jede zeigt kuenftig dieses Muster statt des Inline-Heredocs"), Schritt 5, Schritt 9 („In keinem `SKILL.md` steht ein … `<<'`-Heredoc").

Nachgesehen: `test/skills-fachplan-autor.test.mjs` Zeilen 65–80 verlangt fuer jeden `issue create`-Block in `skills/fachplan/SKILL.md` **sowohl** `--body\s+-` **als auch** `<<'[A-Z]+'`. `test/skills-techplan-ticket.test.mjs` Zeile 66–69 verlangt `--body -` im Anlege-Kommando. `test/board-text-quelle.test.mjs` Zeilen 136–148 verlangt `--text -` in `issue-review`, `review`, `implement-ready`, `implement-next` und in `issue-review` die Wendung „ueber stdin, nicht als Argument". Alle drei stehen dem neuen Muster entgegen und muessen in denselben Paketen umgeschrieben werden, sonst ist Verifizierung 1 nie gruen.

**Vorschlag:** In „Betroffene Bereiche" drei Zeilen ergaenzen: „`test/skills-fachplan-autor.test.mjs`, `test/skills-techplan-ticket.test.mjs`, `test/board-text-quelle.test.mjs` — pruefen heute den Heredoc-/stdin-Weg und werden auf `--body-file`/`--text-file` und die neue Begruendung umgestellt."

### 4. WICHTIG — Es sind zwoelf Stellen in acht Dateien, nicht elf in sieben

**Klasse:** `korrektur`

**Fundstelle:** A1: „Es sind elf Stellen in sieben Dateien." Schritt 3: „Die elf Befehlsstellen"; Schritt 9: „jede der elf Stellen".

Nachgezaehlt in `skills/*/SKILL.md`: `issue-review` 466, 513, 666, 709 (4); `issues` 139, 159 (2); `fachplan` 54 (1); `techplan` 204 (1); `implement-ready` 147, `implement-next` 157, `implement-done` 96 (3); `review` 95 (1) — zwoelf Stellen in acht Dateien. Die Tabelle und die Aufzaehlung in Schritt 3 nennen selbst acht Skills. Die Zahl wandert in den Test aus Schritt 9.

**Vorschlag:** „zwoelf Stellen in acht Dateien"; in Schritt 9 die Stellen nicht zaehlen, sondern aufzaehlen (Datei und Befehl), damit der Test bei einer weiteren Stelle rot wird statt eine Zahl zu treffen.

### 5. WICHTIG — `.claude/CLAUDE-workflow.md` ist nicht versioniert, wird von `sync-blobs` nicht gefuehrt und ist heute schon nicht identisch mit der Vorlage

**Klasse:** `korrektur`

**Fundstelle:** Betroffene Bereiche: „`.claude/CLAUDE-workflow.md` — Dogfooding-Kopie, identisch mitziehen"; Schritt 2.

Nachgesehen: `.gitignore` schliesst `.claude/*` aus; `tools/sync-blobs.mjs` (BLOBS Zeile 50ff, Kopien Zeilen 134–190) zieht `kit/` und `skills/` nach, **nicht** die Vorlagen. `diff templates/CLAUDE-workflow.md .claude/CLAUDE-workflow.md` zeigt, dass der Kopie bereits die Abschnitte „Mitteilungen des Menschen" (Zeilen 107–160) und „Spec-Fortschreibung beim Push" (293–311) fehlen. „Identisch mitziehen" eines einzelnen Abschnitts ergibt also keine identische Kopie, und laut A5 werden Schreibzugriffe unter `.claude/` nachts als „sensitive file" abgewiesen — ein Arbeitspaket, das diese Datei aendern soll, kann nachts nicht enden. Die Datei ist Laufzeitzustand, den der Installer ablegt (`install.mjs` Zeile 838/896).

**Vorschlag:** Schritt 2 aus den Geplanten Aenderungen streichen; stattdessen unter Verifizierung: „Nach dem Merge wird `.claude/CLAUDE-workflow.md` vollstaendig aus `templates/` ersetzt (`cp`), nicht abschnittsweise — sie liegt heute schon hinter der Vorlage. Das ist eine Aenderung ausserhalb des Repos und wird als solche angesagt."

### 6. WICHTIG — `kit/board.mjs` sagt an drei Stellen, stdin sei der bevorzugte Weg; der Plan erklaert die Datei fuer nicht betroffen

**Klasse:** `korrektur`

**Fundstelle:** „Nicht betroffen: **`kit/board.mjs`** … die Faehigkeit fehlt nicht, sie wird nur nicht vorgeschrieben."

Nachgesehen: Kopfkommentar Zeile 27 („Fuer lange Texte … der bevorzugte Weg: stdin"), HELP Zeile 97 („fuer lange Texte der bevorzugte Weg (Issue #270)"), `leseTextQuelle` Zeile 2839 („stdin ist der bevorzugte Weg: Es entsteht keine Datei"). Genau diese `--help` liest eine Session, wenn der Skill-Befehl scheitert (Log 2026-09-10, Zeile 317: `issue create --help`). Nach dem Plan sagt das Register „Datei", der Adapter „stdin" — zwei Wahrheiten, die A1 gerade vermeiden will. Blob-Folge: `board.mjs` haengt in `install.mjs` und `.claude/kit/`, also `sync-blobs` ohne `--check`.

**Vorschlag:** `kit/board.mjs` in die Tabelle: „drei Kommentar-/HELP-Stellen (Zeilen 27, 97, 2839): ‚bevorzugter Weg' wird zu ‚`--text-file`/`--body-file` mit stueckweise geschriebener Datei; stdin bleibt fuer kurze Texte'. Kein Verhaltensaenderung."

### 7. WICHTIG — Schritt 7 erfindet einen neuen Fehler-Kommentar, obwohl der Bestand fuer „kein Ergebnis" den Ausfall-Vermerk kennt

**Klasse:** `alternativen`

**Fundstelle:** Schritt 7: „schreibt die Sitzung einen kurzen Kommentar ans Dokument (‚Ergebnis nicht angekommen, von Hand nachsehen') und endet ohne Marker. … Der Zustand bleibt `review:offen` oder `review:befunde`."

Nachgesehen: `skills/issue-review/SKILL.md` Zeile 212 und `reviewZustand` Regel 3 (Zeile 2584–2586): Anker in Zeile 1, Ausfall samt Grund in Zeile 2 ergibt `ausgefallen`, und `label-sync` zeigt `review:ausgefallen` **am Label der Karte** — das ist die Spur aus Kriterium 5 ohne Kommentar-Lektuere. Ein ankerloser Kommentar laesst das Dokument auf `review:offen`; der naechste `--review`-Lauf prueft es dann erneut von vorn, obwohl die Sitzung gelaufen ist. Dazu schreibt `kit/night.mjs` Zeile 2350–2351 heute schon „Nachtlauf: Die Review-Session endete ohne Ergebnis …" ans Dokument, wenn nichts ankam — nachts entstuenden zwei Texte fuer eine Lage.

**Gangbare Wege:** (a) Ausfall-Form wiederverwenden: Zeile 1 Anker, Zeile 2 „Ausfall: Ergebnis nicht ans Board gebracht (Groesse), von Hand nachsehen" → Zustand `ausgefallen`, Label sichtbar, keine Wiederholung ohne Menschen. (b) Ankerloser Zweizeiler wie geplant → Zustand `offen`, naechste Nacht prueft erneut; dann muss der Plan das als gewollt benennen und das Verhaeltnis zum Runner-Kommentar aus Zeile 2351 klaeren.

### 8. WICHTIG — Schritt 8 aendert `specs/skills.md` direkt; die Konvention traegt Aussagen ueber `## Spec-Wirkung` der Pakete nach

**Klasse:** `korrektur`

**Fundstelle:** Schritt 8: „`specs/skills.md` — zwei neue Aussagen."

Nachgesehen: `templates/CLAUDE-workflow.md` „Spec-Fortschreibung beim Push" (Zeile 293ff): `spec.mjs apply` schreibt nach, was die Pakete in `## Spec-Wirkung` ankuendigen; `skills/issues/SKILL.md` Zeilen 188–215 (Grammatik `NEU skills skills-N — …`, ID = hoechste je vergebene plus eins). Ein Paket, das die Datei selbst aendert **und** `NEU` deklariert, traegt die Aussage doppelt; eines, das nur die Datei aendert, laesst das Gate aus Issue #451 ins Leere laufen. Beachte: Die noch offenen Pakete #572–#574 belegen bereits `skills-5` bis `skills-7` (Log 2026-09-10, Zeile 368).

**Vorschlag:** „Schritt 8. Spec-Wirkung der Pakete: `NEU skills skills-<N> — Jeder Skill-Befehl, der einen Body oder Kommentar ans Board schreibt, geht ueber `--body-file`/`--text-file` aus einer stueckweise geschriebenen Datei …` (und, falls Fund 2 Weg (b) waehlt, eine zweite zur Ankerregel). Die Datei `specs/skills.md` aendert kein Paket; `apply` beim Push."

### 9. HINWEIS — Verifizierung 1 nimmt das Ergebnis vorweg

**Klasse:** `gate` — Regel P9 (`CLAUDE-Plan.md`)

**Fundstelle:** Verifizierung 1: „`node --test` — die neue Testdatei und die bestehende Suite laufen gruen." Verifizierung 5: „… wird abgewiesen — damit ist belegt …"

P9 nennt woertlich „laufen gruen" als vorweggenommenes Ergebnis.

**Vorschlag:** „1. `node --test` ueber die gesamte Suite, einschliesslich `test/skills-transport.test.mjs`." — „5. Gegenprobe: derselbe 19.000-Zeichen-Text wird einmal nach altem Muster inline abgesetzt; das Ergebnis wird protokolliert."

### 10. HINWEIS — Das Muster in Schritt 3 sagt nicht, dass jedes Stueck ein eigener Werkzeugaufruf ist

**Klasse:** `korrektur`

**Fundstelle:** Schritt 3, Codeblock mit `TEIL1`, `TEIL2` und dem Board-Aufruf in **einem** Block.

Die Grenze aus A4 gilt je Bash-Aufruf. Eine Session, die den Block so abschreibt, wie er dasteht, setzt drei Befehle in einem Aufruf ab und ueberschreitet die Grenze wieder.

**Vorschlag:** Ueber den Block: „Jedes `cat` ist ein **eigener** Aufruf — die Grenze aus A4 gilt je Aufruf, nicht je Datei." Und im Test aus Schritt 9 nicht nur `--text-file` pruefen, sondern dass dieser Satz an jeder Stelle steht.

### 11. HINWEIS — Verifizierung 5 misst den Befehls-Parser der Sitzung, nicht das Kit

**Klasse:** `korrektur`

**Fundstelle:** Verifizierung 5: „damit ist belegt, dass der Test die reale Grenze trifft und nicht eine ausgedachte."

Der Test aus Schritt 9 prueft Skill-Text; die Grenze sitzt im Werkzeug, das die Sitzung faehrt (Log 2026-09-10, Zeilen 528–529: `permission_denied`, „Parser aborted"). Die Gegenprobe belegt die Zahl 6.000 nicht — sie belegt nur, dass 19.000 scheitert — und laesst sich nicht wiederholen, wenn sich das Werkzeug aendert.

**Vorschlag:** Den Satz „damit ist belegt …" streichen; stattdessen: „Die Zahl 6.000 ist eine Beobachtung vom 2026-09-10 (`.claude/night-run-2026-09-10.log`), keine Zusage des Werkzeugs; sie steht deshalb nur im Register, nicht im Adapter."

---

**Was kann raus:** Schritt 2 (Fund 5) als Paket-Inhalt. A8, Schritt 6, Verifizierung 4 und die zweite Aussage aus Schritt 8, falls Fund 2 Weg (a) waehlt. A6 traegt nur, wenn Fund 7 entschieden ist — in Form (a) wird der Zweizeiler zur Ausfall-Zeile und A6 zu einem Halbsatz dort. Die drei Vorfallzahlen in A4 (10.318 / 10.154 / 7.028) koennen auf „Grauzone ab rund 10.000, groesster unauffaelliger 7.028" schrumpfen; die Begruendung bleibt.

Bestand: gelesen

### gpt-astra — Schnitt und Abhaengigkeiten

Der Plan ist grundsätzlich zerlegbar, aber noch nicht sauber geschnitten. Die Umstellung des Transportwegs ist überschaubar. Das zusätzliche Aufteilen von Board-Kommentaren führt dagegen ein Protokoll ein, dessen Verarbeitung und Fehlerfälle noch nicht geklärt sind.

1. **BLOCKER · Klasse: `alternativen` — Dateistücke und Kommentarstücke sind vermischt.**

   **Fundstelle:** A7: „Geteilt werden nur Kommentare“; A8: „Nur das erste Stueck traegt den Anker“; Änderung 3 erzeugt dagegen **eine Datei und einen Kommentar**.

   Es fehlt die Entscheidung, wann mehrere Board-Kommentare entstehen sollen. Das verändert den Zuschnitt: [bodyVorschlagVorhanden in night.mjs](/Users/manfredwolff/ki-projects/claude-workflow-kit/kit/night.mjs:2295) akzeptiert bereits den ersten Kommentar mit passender Kopfzeile und etwas Text als Body-Vorschlag. Fehlende Fortsetzungen erkennt die Funktion nicht. A8 schützt die Rundenzählung, gewährleistet aber keine vollständige Weiterverarbeitung.

   **Gangbare Wege:** Eine vollständige Datei je Board-Kommentar; oder mehrere Kommentare mit definiertem Zusammenhang, Vollständigkeitsprüfung und Behandlung abgebrochener Übertragungen.

   **Formulierungsvorschlag:** „Die Shell schreibt jeden Text stückweise in eine Datei. Diese wird als ein vollständiger Body beziehungsweise ein vollständiger Kommentar übertragen. Eine Aufteilung auf mehrere Board-Kommentare gehört nicht zu diesem Plan; A8, Änderung 6 und Verifizierung 4 entfallen.“

   Falls #579 mehrere Kommentare zwingend verlangt, braucht dieser Teil vor `/issues` einen eigenen Protokollentwurf. Das ist die fehlende Stopp-Frage; **kein P7-Verstoß**, denn P7 erfasst nur zu Unrecht enthaltene Fragen.

2. **BLOCKER · Klasse: `korrektur` — Die begrenzte Einheit ist nicht vorgeschrieben.**

   **Fundstelle:** A4: „Die Stuecke sind hoechstens 6.000 Zeichen gross“; Änderung 3 zeigt mehrere `cat`-Befehle in einem Bash-Block.

   Eine Sitzung kann den gesamten Block als einen Shell-Werkzeugaufruf senden. Dann bekommt der vorgeschaltete Parser weiterhin den vollständigen langen Text. Das Muster allein beseitigt die beschriebene Fehlerursache nicht.

   **Formulierungsvorschlag:** „Jedes Textstück wird in einem eigenen Shell-Werkzeugaufruf geschrieben. Mehrere Stücke dürfen nicht in einem Werkzeugaufruf gebündelt werden. Jeder vollständige Aufruf einschließlich Heredoc und Shell-Syntax bleibt unter 6.000 Zeichen. Der Board-Aufruf erfolgt separat nach erfolgreichem Abschluss aller Schreibaufrufe.“

3. **WICHTIG · Klasse: `korrektur` — Der neue Fehlerpfad ist nicht mit dem bestehenden Ablauf verbunden.**

   **Fundstelle:** Änderung 7: „schreibt die Sitzung einen kurzen Kommentar […] und endet ohne Marker“; „Zustand […] bleibt dabei `review:offen` oder `review:befunde`“.

   Der [bestehende Fehlerpfad](/Users/manfredwolff/ki-projects/claude-workflow-kit/skills/issue-review/SKILL.md:623) verbietet nach einem fehlgeschlagenen Schreibbefehl jede weitere Mutation. Der Plan muss die Diagnose als ausdrückliche Ausnahme einordnen. Außerdem fehlen Fehler beim eigentlichen Board-Aufruf und bei einer nur teilweise geschriebenen Datei. Die Zustandsannahme gilt nicht allgemein: Ein vorhandener Marker ergibt weiterhin `fertig`, vorhandene Runden können `grenze` ergeben.

   **Formulierungsvorschlag:** „Scheitert ein Dateischritt, wird die unvollständige Datei nicht übertragen. Scheitert die Ablage oder der Board-Schreibaufruf, erfolgt genau ein Versuch, einen kurzen Diagnosekommentar zu schreiben; dies ist die einzige Ausnahme vom bisherigen Mutationsstopp. Anschließend endet der Skill mit Fehler und setzt keinen neuen Marker. Ein bestimmter resultierender Review-Zustand wird nicht zugesichert.“

4. **WICHTIG · Klasse: `alternativen` — Die Dateiliste versteckt die Paketabhängigkeiten.**

   **Fundstelle:** Geplante Änderungen 1–9; Verifizierung 2: „die Skill-Aenderungen sind in den Blobs nachgezogen“.

   Die globale Textprüfung aus Änderung 9 kann erst bestehen, wenn sämtliche Beispiele migriert sind. Außerdem erzeugt [sync-blobs.mjs](/Users/manfredwolff/ki-projects/claude-workflow-kit/tools/sync-blobs.mjs:3) Änderungen an `install.mjs` und vorhandenen Dogfooding-Kopien. Der Plan nennt nur den anschließenden Check. Ein separates abschließendes Synchronisationspaket ließe vorherige Pakete mit Drift zurück.

   **Gangbare Wege:** Ein gemeinsames Umsetzungspaket; oder Migration in abgeschlossenen Teilpaketen mit jeweils eigener Synchronisierung und passenden Prüfungen.

   **Formulierungsvorschlag:** „Reihenfolge: (A) Transportregel und `/issue-review` einschließlich Fehlerpfad und zugehöriger Tests; (B) übrige Skills einschließlich Begleittexten, setzt A voraus; (C) globale Prüfung aller Skill-Texte und Gesamtnachweis, setzt A und B voraus. Jedes Paket mit Template- oder Skill-Änderungen führt `node tools/sync-blobs.mjs` aus und nimmt die erzeugten Änderungen auf.“

5. **WICHTIG · Klasse: `korrektur` — Der Austausch der Befehle lässt widersprechende Anweisungen stehen.**

   **Fundstelle:** Änderung 3: „Jede zeigt kuenftig dieses Muster statt des Inline-Heredocs“; Änderungen 4–5 behandeln Begleittexte nur ausgewählter Skills.

   In [implement-next](/Users/manfredwolff/ki-projects/claude-workflow-kit/skills/implement-next/SKILL.md:154) steht ausdrücklich „kein Zwischenschritt über eine Wrapper- oder Temp-Datei“. Wenige Zeilen später wird das Verbot für Abschlussberichte wiederholt. Die geplante Textprüfung würde trotz dieser widersprüchlichen Handlungsanweisungen bestehen.

   **Formulierungsvorschlag:** „Bei jeder migrierten Befehlsstelle werden auch die unmittelbar zugehörigen Transportanweisungen angepasst. In `implement-next` ersetzen wir das Temp-Datei-Verbot durch: ‚Den Abschlussbericht nach der Transportregel außerhalb des Projektverzeichnisses vorbereiten und als Issue-Kommentar übertragen.‘“

6. **HINWEIS · Klasse: `gate` — Die Bestandszählung stimmt nicht. Register: `CLAUDE-Plan.md`, P10.**

   **Fundstelle:** A1: „Es sind elf Stellen in sieben Dateien.“

   Die eigene Aufzählung und der Bestand ergeben **zwölf Befehlsstellen in acht Skill-Dateien**: vier in `issue-review`, zwei in `issues` und sechs weitere. Die falsche Zahl wird zudem zum Sollwert der geplanten Prüfung.

   **Formulierungsvorschlag:** „Betroffen sind zwölf Befehlsstellen in acht Skill-Dateien. Die Prüfung benennt jede Stelle über Skill und Abschnitt; eine bloße Gesamtzählung genügt nicht.“

7. **WICHTIG · Klasse: `korrektur` — Die Verifizierung trifft die Fehlerursache noch nicht zuverlässig.**

   **Fundstelle:** Verifizierung 3: „ohne Zeitdruck einer Pruef-Session“; Verifizierung 5: „Ein Aufruf nach altem Muster mit 19.000 Zeichen wird abgewiesen“.

   Der Rücklesevergleich beschreibt ein echtes **Wie**. Es fehlt jedoch die Ausführung durch denselben Shell-Werkzeugweg und dieselben Nachtberechtigungen. Ein gewöhnlicher Shell-Lauf prüft den vorgeschalteten Parser nicht. Zudem widerspricht die zwingend erwartete Ablehnung der ausdrücklich unscharfen Grenze aus A4. Bodies und die neuen Fehlerpfade bleiben ungeprüft.

   **Formulierungsvorschlag:** „Den langen Kommentar und einen langen Body über den tatsächlichen Shell-Werkzeugweg interaktiv sowie mit den Nachtberechtigungen übertragen und zurückgelesene Nutztexte byteweise vergleichen. Einen fehlgeschlagenen Dateischritt und einen fehlgeschlagenen Board-Schreibaufruf gezielt herbeiführen; prüfen, dass kein Teiltext übertragen und kein neuer Marker gesetzt wird. Den alten Aufruf nur diagnostisch ausführen; seine Ablehnung ist kein Abnahmekriterium.“

8. **HINWEIS · Klasse: `korrektur` — Wiederholte Vorfallgeschichte kann raus.**

   **Fundstelle:** Änderung 1 verlangt den Vorfall im Register; Änderung 5 verlangt das Datum erneut im Skill.

   Der Grund für die Regel gehört ins Register. Wiederholte Ereignisdetails helfen beim Paketschnitt nicht und widersprechen der beabsichtigten zentralen Begründung.

   **Formulierungsvorschlag:** „Das Register enthält die technische Begründung und einen Vorfallverweis. Die Skills enthalten das ausführbare Muster und den Registerverweis; zusätzliche Datums- und Vorfallswiederholungen entfallen.“

Die sechs Pflichtabschnitte sind vorhanden. Die Verifizierung enthält konkrete Prüfverfahren; ihre Lücken sind keine Verstöße gegen P9. Einen Verstoß gegen die prozessweiten Gates W1–W4 habe ich nicht gefunden. Es wurde nichts geschrieben oder geändert.

Bestand: gelesen
