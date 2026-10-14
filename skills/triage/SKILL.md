---
name: triage
description: Talks an idea through with the human: reads the idea and its attachments, presents each unclear point on its own with a recommendation, writes the clarified state into the idea right after each confirmation, proposes a lane with its reason and, after the human's decision, starts the chosen path. Use this skill when the user invokes /triage or wants to talk an [Idea] through and bring it onto its lane.
user-invocable: true
---

# Triage

Eine `[Idea]` auf dem Board sagt oft noch nicht, was sie will. Dieser Skill spricht sie mit dem Menschen durch, bis es klar ist, und bringt sie dann ohne Umweg auf ihre Bahn: Er liest die Idee, ihre Kommentare und die Anhänge aus ihrer Ablage, legt jeden unklaren Punkt einzeln mit Empfehlung vor, schreibt den geklärten Stand nach jeder Bestätigung sofort in die Idee, fasst ihn zusammen, schlägt eine Bahn mit Begründung vor und geht nach der Entscheidung des Menschen den gewählten Weg.

Das Mechanische trägt das Kommando `issue triage`: ob der Ablauf beginnen darf, welche Anhänge die Ablage hat und welche davon die Session liest, welche Punkte schon entschieden sind, welche Bahn gewählt und welches Ergebnis schon angelegt ist, ob ein neuer Body etwas verliert, und der Abschluss der Ablage. Gesprächsführung, Empfehlung und Bahnvorschlag sind Urteil der Session und stehen hier.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Ablauf

### 0. Unbeaufsichtigt nicht beginnen

Erster Schritt, vor allem anderen: **Unbeaufsichtigt** (gesetztes, nicht leeres `KIT_AGENT_MODEL`) beginnt der Skill nicht und meldet das — niemand kann antworten, und die Bahn wählt allein der Mensch. An der Idee und ihrer Ablage ändert sich nichts. Dieselbe Bedingung prüft das Kommando und weist mit dem Grund `unbeaufsichtigt` ab.

### 1. Einstieg

`/triage #N` nimmt genau eine Idee.

```bash
node .claude/kit/board.mjs issue triage <N>
```

Die Ausgabe trägt `einstieg` (`start`, `grund`, `meldung`), `ablage` (`pfad`, `vorhanden`, `dateien` je `{ name, gelesen, vorlageZiel, herkunft }`, dazu `anhaenge`, wenn der Aufruf die Anhänge der Karte geladen hat) und `stand` (`punkte`, `offen`, `bahn`, `vorlage`, `ergebnis`). Bei `start: false` meldet der Skill die `meldung` und endet ohne Änderung — eine Karte ohne `[Idea]` (`keine-idee`) oder ein unbeaufsichtigter Lauf (`unbeaufsichtigt`).

Danach liest er die Idee mit ihren Kommentaren:

```bash
node .claude/kit/board.mjs issue get <N>
```

### 2. Anhänge lesen

Jede Idee hat ihre Ablage für Anhänge unter `.claude/ideas/<N>/`. An einer kanban-kit-Karte lädt `issue triage` die Anhänge der Karte selbst dorthin, bevor es die Ablage meldet; die Datei trägt dann `herkunft: "karte"`, eine vom Menschen abgelegte `herkunft: "ablage"`. Liegt schon eine Datei mit demselben Namen in der Ablage, bleibt sie unverändert, und der Anhang wird nicht geladen (`ablage.anhaenge.vorhanden`). Ein Anhang, der sich nicht laden ließ, steht unter `ablage.anhaenge.fehlgeschlagen` mit Namen, Grund und `meldung`; war schon die Liste der Anhänge nicht abrufbar, nennt `ablage.anhaenge.fehler` den Grund. Der Skill führt jeden nicht geladenen Anhang unter „nicht gelesen“ auf, mit seiner `meldung`, und fragt, ob es ohne ihn weitergeht.

Der Skill liest jede Datei mit `gelesen: true` — Bilder, PDFs und Markdown-Dateien — mit seinem Lese-Werkzeug. Eine Datei mit `gelesen: false` liest er nicht, ohne sie umzuwandeln. Zu Beginn nennt er, welche Anhänge er gelesen hat und welche nicht gelesen sind, jede mit Namen.

Fehlt die Ablage oder ist sie leer (`vorhanden: false` oder keine `dateien`), nennt der Skill den Ort `.claude/ideas/<N>/`, an dem Anhänge zu dieser Idee liegen müssen, und fragt, ob es ohne Anhänge weitergeht. An einem Tracker ohne Anhänge (GitHub, GitLab, lokal) gilt: Der Skill legt die Ablage nicht an; legt der Mensch Dateien hinein, beginnt der Skill mit Schritt 1 neu.

### 3. Vorhandener Stand

Trägt die Idee schon einen Abschnitt `## Geklärter Stand`, wurde sie schon einmal durchgesprochen. Der Skill legt den bisherigen Stand vor — die entschiedenen Punkte mit ihrer Antwort, eine gewählte Bahn, eine Vorlage — und setzt bei den offenen Punkten fort (`stand.offen`, die Punkte ohne Antwortzeile). Bestätigte Klärungen und Entscheidungen bleiben, wie sie sind; er fragt sie nicht noch einmal.

Meldet `stand.ergebnis` ein Ergebnis — aus der Ergebnis-Zeile oder aus einem Kommentar `Fortsetzung: …` an der Idee —, ist der gewählte Weg schon begonnen. Dann legt der Skill nichts neu an, sondern setzt bei den offenen Abschlussschritten fort (Schritt 9 bzw. 10): fehlt die Ergebnis-Zeile, schreibt er sie; steht die Ablage noch, ruft er `--finish`; liegt eine Vorlage uncommittet unter `design/ideas/<N>/`, committet er sie.

### 4. Punkte sammeln und einzeln vorlegen

Der Skill sammelt aus Idee, Kommentaren und Anhängen die Punkte, die unklar sind: was die Idee will, für wen, woran man erkennt, dass sie erfüllt ist, was sie ausdrücklich nicht will. Sobald er sie gesammelt hat, schreibt er die vollständige Punktliste ohne Antwortzeilen in die Idee, als nummerierte Liste unter `## Geklärter Stand` am Ende des Bodys. Ein Punkt ohne Antwortzeile ist offen. Der bisherige Text der Idee bleibt darüber unverändert.

Dann legt er jeden offenen Punkt einzeln, mit Empfehlung und Begründung vor, nach dem Muster von `/groom` (Schritte 4 bis 6 dort): genau ein Punkt je Vorlage, genau eine Antwort je Punkt, Sammelantworten und Zurückstellen wie dort. Erst wenn ein Punkt sich nicht einzeln fassen lässt, klärt er ihn im freien Gespräch und legt das Ergebnis danach als Antwort zu diesem Punkt zur Bestätigung vor. Ein im Gespräch neu entstehender Punkt wird an die Liste angehängt.

Jede Bestätigung ergänzt sofort die Antwortzeile ihres Punkts, eingerückt unter dem Punkt, in der Form `**Antwort (<Urheber>, <JJJJ-MM-TT>):**` gefolgt vom Inhalt — nicht gesammelt am Ende. Bricht die Sitzung ab, bleibt alles bis dahin Bestätigte in der Idee, und ein neuer Aufruf setzt bei den offenen Punkten fort.

Jeder neue Body entsteht als `<tmpdir>/<N>-triage-body.md` nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“: erst `printenv TMPDIR` (bleibt die Ausgabe leer, gilt `/tmp`), dann stückweise `cat >` und `cat >>` mit je höchstens 6.000 Zeichen, jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Variable. Eine unvollständige Datei wird nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Änderung. Vor dem Schreiben prüft das Kommando den neuen Body gegen den am Board:

```bash
node .claude/kit/board.mjs issue triage <N> --body-file <tmpdir>/<N>-triage-body.md
```

Bei `pruefung.ok` (Exit 0) geht er sofort ans Board:

```bash
node .claude/kit/board.mjs issue update <N> --body-file <tmpdir>/<N>-triage-body.md
```

Meldet die Prüfung Verstöße (Exit 1) — der Text der Idee hat sich geändert oder ein bestätigter Punkt hat seine Antwortzeile verloren —, schreibt der Skill nicht. Er korrigiert die Datei und prüft noch einmal. Derselbe Weg gilt für jede spätere Zeile im geklärten Stand: Bahn, Vorlage, Ergebnis.

### 5. Zusammenfassung

Sind alle Punkte entschieden, fasst der Skill den geklärten Stand in einer Liste zusammen, ein Eintrag je Punkt, und legt sie dem Menschen vor, bevor er eine Bahn vorschlägt. Ist ein Punkt zurückgestellt, nennt er ihn dort und fragt, ob der Mensch ihn jetzt entscheidet oder ohne ihn weitergeht.

### 6. Bahn vorschlagen

Der Skill schlägt genau eine Bahn vor und begründet sie aus dem geklärten Stand und den drei Bahnen in `CLAUDE-workflow.md`:

- `1` — eine Kleinigkeit nach der zählenden Bahn-1-Regel, ohne etwas abzuwägen. Aus einer Idee ein seltener Randfall.
- `2, fachlich` — es gibt etwas abzuwägen, und die Idee hat fachlichen Bezug.
- `2, technisch` — es gibt etwas abzuwägen, und die Idee ist rein technisch.
- `3` — oberhalb der Kleinigkeit, aber ohne Abwägungsbedarf.

Maßstab zwischen den beiden Formen von Bahn 2 ist der fachliche Bezug: Fachlichen Bezug hat eine Idee, wenn sie ändert, was ein Mensch im Umgang mit dem Werkzeug erlebt; ändert sie nur dessen Inneres, ist sie rein technisch. Im Zweifel schlägt der Skill `2, fachlich` vor.

Der Mensch entscheidet. Erst nach der Entscheidung schreibt der Skill die Bahn-Zeile in den geklärten Stand, unter die Punktliste:

```
Bahn: <1 | 2, fachlich | 2, technisch | 3> — vorgeschlagen: <Wert>; gewählt (<Urheber>, <JJJJ-MM-TT>)
```

Vorne steht die gewählte Bahn, dahinter der Vorschlag. Wählt der Mensch eine andere Bahn als vorgeschlagen, steht beides getrennt da, zum Beispiel `Bahn: 3 — vorgeschlagen: 2, fachlich; gewählt (Manfred, 2026-10-13)`.

### 7. Vorlage bestimmen

Liegt in der Ablage ein Anhang, der das Aussehen oder den Aufbau des Ergebnisses zeigt — ein Mockup, eine Skizze, ein Gestaltungsentwurf —, fragt der Skill bei Bahn 2 und 3, ob er zur Vorlage des entstehenden Dokuments wird. Bestimmt der Mensch ihn dazu, fragt der Skill zusätzlich `verbindlich` oder `Anregung` und schreibt die Zeile in den geklärten Stand:

```
Vorlage: <vorlageZiel> — verbindlich | Anregung
```

Der Pfad ist das Feld `vorlageZiel` der Datei aus `issue triage` — der dauerhafte Ort unter `design/ideas/<N>/`, an den `--finish` sie in Schritt 9 verschiebt. So nennt das Dokument schon beim Anlegen den Pfad, unter dem die Vorlage danach liegt. Die übrigen Anhänge gehen mit der Ablage.

### 8. Den gewählten Weg gehen

Der gewählte Weg beginnt, indem der Skill den bestehenden Skill mit der Nummer der Idee in derselben Sitzung aufruft:

- `2, fachlich` → `/requirement #N`
- `2, technisch` → `/techplan #N`
- `3` → `/task #N`
- `1` → Schritt 10

Es gilt die gewählte Bahn, nicht die vorgeschlagene. Der Zielskill nimmt den geklärten Stand als Eingang und die Bahn-Zeile als bereits getroffene Bahnentscheidung; alles andere — Form, Szenarien, Vorgeschichte, Formprüfung, Spur-Kommentar — bleibt sein Weg.

Die Ergebnis-Zeile schreibt der Skill unmittelbar, nachdem der Zielskill angelegt hat, in den geklärten Stand:

- `Ergebnis: Issue #M` — der Fachplan, der Plan oder das Paket ist am Board angelegt;
- `Ergebnis: Idee <ideaId>` — der Zielskill hat es in den Ideen-Pool gelegt, noch nicht eingeplant;
- `Ergebnis: Commit <sha>` — Bahn 1.

Legt der Zielskill nichts an — er weist ab oder der Mensch bricht ab —, entsteht keine Ergebnis-Zeile, und die Ablage bleibt.

### 9. Abschluss

Steht die Ergebnis-Zeile, hat der gewählte Weg begonnen, und der Skill schließt die Ablage ab. Mit einer Vorlage aus Schritt 7 (der Name der Datei in der Ablage):

```bash
node .claude/kit/board.mjs issue triage <N> --finish --template <datei>
```

Ohne Vorlage:

```bash
node .claude/kit/board.mjs issue triage <N> --finish
```

Danach ist die Ablage gelöscht; `abschluss` nennt, was geschah. Meldet es `ok: false`, bleibt alles stehen, und der Skill nennt die `meldung`.

Gab es eine Vorlage, committet der Skill sie danach allein, ein eigener Commit nur mit der Vorlage — ein liegengebliebener Pfad ließe den Working Tree unsauber und die Abnahme gegen die Vorlage ins Leere zeigen. Wie jeder Commit setzt er einen grünen `node .claude/kit/checks.mjs run` voraus:

```bash
git add design/ideas/<N>/<datei>
git commit -m "Vorlage zu Idee #N abgelegt (Issue #N)"
```

Die Reihenfolge ist fest: Dokument anlegen → Ergebnis-Zeile → `--finish` → Commit der Vorlage. Die Abschlussmeldung nennt das Ergebnis und den nächsten Schritt des Zielskills.

### 10. Bahn 1

Bahn 1 setzt der Skill selbst um, nach den Regeln von Bahn 1 in `CLAUDE-workflow.md`: die Änderung, ein grüner `node .claude/kit/checks.mjs run` auf dem zu committenden Stand, ein Commit, dessen Nachricht `Issue #N` der Idee nennt. Danach schreibt er `Ergebnis: Commit <sha>` in den geklärten Stand und ruft `--finish` wie in Schritt 9. In der Idee stehen damit der geklärte Stand, die Entscheidung des Menschen und der Verweis auf die Änderung.

Die Idee schließt der Mensch. Der Skill nennt dem Menschen den Zug `node .claude/kit/board.mjs issue move <N> done` und führt ihn nicht selbst aus — Done setzt nur der Mensch.

## Stop-Punkte

- Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt): nicht beginnen, nichts ändern.
- Keinen Weg gehen, den der Mensch nicht gewählt hat — vorschlagen ja, wählen nie.
- Nichts in die Idee schreiben ohne Zustimmung, und nie einen Body, den `issue triage --body-file` abgewiesen hat.
- Kein zweites Ergebnis anlegen, wenn `stand.ergebnis` eines meldet.
- Die Idee nie nach Done ziehen — den Zug nennt der Skill dem Menschen.
- Kein Label abnehmen.
- Pushen: nie ohne explizite Trigger-Phrase `push main`.
