---
name: groom
description: Grooms a reviewed requirement with the PO: each open question one at a time with a recommendation and its reason, the incorporation for approval, writing right after approval, finally the note "None". Use this skill when the user invokes /groom or wants to decide the open questions of a requirement.
user-invocable: true
---

# Groom

Ein Fachplan, den Modelle geprüft haben, trägt oft noch offene Fragen an den PO. Dieser Skill führt durch sie: Jede offene Frage unter `## Offene Fragen an den PO` kommt einzeln, mit Empfehlung und Begründung; der Mensch entscheidet genau diese eine Frage; die Session zeigt, wie sie die Antwort einarbeitet, und schreibt nach Zustimmung sofort in den Body. Sind alle Fragen entschieden, setzt sie den Vermerk „Keine“, und der Fachplan ist bereit für `/techplan`.

Das Mechanische trägt das Kommando `issue questions`: welche Fragen offen sind, ob der Ablauf beginnen darf, welcher Kommentar die Stopp-Frage trägt, ob ein neuer Body Kennzeichnungszeilen und Antworten behält, wie der Vermerk lautet, ob die Karte Szenarien braucht und was sich an Kriterien, Szenarien und Nicht-Zielen geändert hat. Es liest nur. Empfehlung, Einarbeitung und Folgefragen sind Urteil der Session und stehen hier.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Ablauf

### 1. Einstieg

`/groom #N` nimmt genau einen Fachplan. Erster Schritt, vor allem anderen: **Unbeaufsichtigt** (gesetztes, nicht leeres `KIT_AGENT_MODEL`) beginnt der Skill nicht und meldet das — niemand kann antworten. Dieselbe Bedingung prüft das Kommando und weist mit dem Grund `unbeaufsichtigt` ab.

```bash
node .claude/kit/board.mjs issue questions <N>
```

Die Ausgabe trägt `einstieg` (`start`, `grund`, `meldung`), `fragen` (`vermerk`, `fragen`, `ungegliedert`, `offen`), `stoppKommentar`, `vermerkVorschlag` und `szenarien` (`pflicht`, `vorhanden`, `vollstaendig`, ohne Stichtag dazu `hinweis`). Bei `start: false` meldet der Skill die `meldung` und endet ohne Änderung — eine andere Karte als ein `[Requirement]` (`kein-fachplan`), unbeaufsichtigt (`unbeaufsichtigt`), ein Fachplan ohne `review:done` und ohne `kit:clarify` (`ungeprueft`, der Weg ist zuerst `/issue-review #<N>`), ein Fachplan mit Vermerk „Keine“ und ohne `kit:clarify` (`nichts-offen`). Nennt das Kommando dazu einen `hinweis` — etwa eine Frage ohne Antwortzeile unter einem gesetzten Vermerk —, steht er in der Meldung; der Skill entfernt den Vermerk nicht. Bei `start: true` mit dem Grund `szenarien-fehlen` steht der Vermerk schon, aber der Karte fehlen die Szenarien: Der Skill meldet die `meldung` und beginnt mit Schritt 3. Nennt `szenarien` einen `hinweis` — der Stichtag fehlt —, gibt der Skill ihn wörtlich weiter.

Meldet `fragen` Absätze unter `ungegliedert`, legt der Skill als erste Änderung ihre Gliederung in nummerierte Fragen zur Zustimmung vor (Schritt 6) — eine stille Umdeutung von Fließtext wäre eine Änderung ohne Zustimmung.

### 2. Start-Body ablegen

Den Body, wie er jetzt am Board steht, legt der Skill als `<tmpdir>/<N>-groom-start.md` ab — gegen ihn misst Schritt 8, was sich an Kriterien, Szenarien und Nicht-Zielen geändert hat. Die Datei entsteht nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“: erst `printenv TMPDIR` (bleibt die Ausgabe leer, gilt `/tmp`), dann stückweise `cat >` und `cat >>` mit je höchstens 6.000 Zeichen, jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Variable. Dasselbe gilt für jeden neuen Body in Schritt 3, 6 und 7. Scheitert ein Dateischritt, gilt: Eine unvollständige Datei wird nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Änderung.

### 3. Szenarien ergänzen

Meldet `szenarien` die Karte als pflichtig (`pflicht: true`) und `vollstaendig: false` — der Abschnitt `## Szenarien` fehlt oder trägt kein vollständiges Szenario —, kommt das vor allen Fragen. Der Skill schlägt Szenarien aus den fachlichen Akzeptanzkriterien vor: je Szenario `### Szenario: <Titel>` mit Listenzeilen `Angenommen`, `Wenn`, `Dann` und bei Bedarf `Und`, technikfrei wie der übrige Fachplan, mit den Schlüsselwörtern der Projektsprache — im englischen Projekt `## Scenarios`, `### Scenario: <title>`, `Given`, `When`, `Then`, `And`. Der Abschnitt steht zwischen `## Fachliche Akzeptanzkriterien` und `## Nicht-Ziele`. Nicht jedes Kriterium braucht ein Szenario, eines genügt.

Der Skill zeigt den Abschnitt und schreibt ihn **erst nach Zustimmung**, wie in Schritt 6: Datei nach der Transportregel, Prüfung mit `--body-file`, dann `issue update`. Ändert der Mensch den Vorschlag, gilt seine Fassung. Fehlt der Vermerk noch, entsteht der Vermerk „Keine“ erst danach (Schritt 7); steht er schon (`szenarien-fehlen`), bleibt er unverändert. Bei `pflicht: false` oder `"ohne-stichtag"` entfällt der Schritt.

### 4. Stopp-Frage zuerst

Trägt der Fachplan `kit:clarify` und liefert das Kommando einen `stoppKommentar` mit Kommentar, formuliert der Skill aus dessen Text die Stopp-Frage der angehaltenen Prüfung und legt sie **zuerst** vor. In den Body kommt sie als nächste freie Nummer ans Ende der Liste, mit dem Zusatz `(Stopp-Frage der Prüfung vom <Datum>)` (Datum des Kommentars) — die vorhandenen Fragen werden nicht umnummeriert, weil Antworten und Kommentare auf ihre Nummern verweisen. Frage und Antwort gehen zusammen in den Body, wie in Schritt 6.

Ist `kit:clarify` gesetzt, aber `stoppKommentar` ohne Kommentar, sagt der Skill mit dem Grund aus der Ausgabe, dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht, und groomt die übrigen offenen Fragen.

### 5. Je offene Frage

Der Skill legt die offenen Fragen **einzeln** vor, in ihrer Reihenfolge: die Frage, seine Empfehlung und deren Begründung. Er nimmt je Frage **genau eine Antwort** an.

- **Sammelantwort:** Antwortet der Mensch auf mehrere Fragen zugleich, übernimmt der Skill nur den Teil zur aktuellen Frage. Die nächste Frage legt er trotzdem einzeln vor und nennt das schon Gesagte als Vorschlag; ein kurzes Ja genügt dann.
- **Zurückstellen:** „zurückstellen“ ist eine zulässige Antwort. Die Frage bleibt ohne Antwortzeile und damit offen, am Board wird nichts vermerkt; der Skill geht zur nächsten und nennt sie am Ende. Ein späterer Aufruf legt nur noch die offenen Fragen vor.

Eigene Prüffunde bringt der Skill nicht ein: Jede Änderung am Body stammt aus einer Antwort des Menschen oder, bei den Szenarien aus Schritt 3, aus seiner Zustimmung.

### 6. Einarbeitung zeigen, nach Zustimmung schreiben

Nach jeder Antwort zeigt der Skill, wie er sie einarbeitet:

- die Antwortzeile unter der Frage, eingerückt, in der Form `**Antwort (<Urheber>, <JJJJ-MM-TT>):**` gefolgt vom Inhalt — Urheber und Datum sind Pflicht, sonst gilt die Frage weiter als offen;
- die Änderung an Ziel, fachlichen Akzeptanzkriterien oder Nicht-Zielen, die aus der Antwort folgt;
- erzwingt die Antwort eine Folgefrage, steht sie mit Begründung, warum sie nötig ist, in derselben Änderung — als neue Frage am Ende der Liste. Sie bleibt offen, bis sie beantwortet ist, und der Skill legt sie im selben Durchgang vor, mit Empfehlung. Steht der Vermerk „Keine“ schon im Abschnitt, nimmt dieselbe Änderung ihn heraus.

Geschrieben wird **erst nach Zustimmung** des Menschen, dann **sofort** — nicht gesammelt am Ende. Bricht die Sitzung ab, bleiben alle bis dahin bestätigten Antworten erhalten. Der neue, vollständige Body entsteht als `<tmpdir>/<N>-groom-body.md` nach der Transportregel; die Kennzeichnungszeilen (`Autor-Modell:`, `Fachplan-Review:`, `Vorlage:`) bleiben unverändert. Vor dem Schreiben prüft das Kommando ihn gegen den Body am Board:

```bash
node .claude/kit/board.mjs issue questions <N> --body-file <tmpdir>/<N>-groom-body.md
```

Bei `pruefung.ok` (Exit 0) geht er sofort ans Board:

```bash
node .claude/kit/board.mjs issue update <N> --body-file <tmpdir>/<N>-groom-body.md
```

Meldet die Prüfung Verstöße (Exit 1), schreibt der Skill nicht. Er korrigiert die Datei, zeigt die Änderung erneut und prüft noch einmal.

### 7. Vermerk „Keine“

Sind alle Fragen entschieden und keine zurückgestellt, liefert ein erneuter Aufruf `issue questions <N>` den Vermerk unter `vermerkVorschlag` — mit der Zahl aller Fragen des Abschnitts, Folgefragen eingeschlossen, und dem heutigen Datum. Der Skill übernimmt ihn wörtlich als erste Zeile unter `## Offene Fragen an den PO`; Fragen und Antworten bleiben darunter stehen. Er zeigt die Änderung und schreibt nach Zustimmung wie in Schritt 6. Ist eine Frage zurückgestellt, entfällt der Vermerk.

Nach dem Schreiben des Vermerks setzt der Skill `node .claude/kit/board.mjs issue label add <N> kit:clarified`: Das Label zeigt am Board, dass keine Frage an den PO offen ist — eine Hilfe für den Menschen, kein Kriterium; die Kette prüft weiter den Vermerk. Ist es am Board nicht definiert, nennt der Skill die Fehlermeldung des Adapters und läuft weiter. Entfällt der Vermerk, entfällt auch das Label.

### 8. Abschluss

Die Abschlussmeldung nennt:

- ob `kit:clarified` gesetzt ist, oder die Fehlermeldung des Adapters, wenn das Label am Board fehlt;
- die zurückgestellten Fragen mit Nummer, oder dass keine zurückgestellt ist;
- bei `kit:clarify` mit `stoppKommentar`: dass der Mensch `kit:clarify` abnimmt und den Fachplan erneut prüfen lässt (`/issue-review #<N>`);
- bei `kit:clarify` ohne `stoppKommentar`: dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht;
- den Prüfvorschlag aus dem Vergleich mit dem Start-Body:

```bash
node .claude/kit/board.mjs issue questions <N> --compare <tmpdir>/<N>-groom-start.md
```

Ist unter `aenderungen` ein Kriterium, ein Nicht-Ziel oder ein Szenario ergänzt, gestrichen oder umformuliert, trägt `vorschlag` die erneute Prüfung (`/issue-review #<N>`): Der Skill schlägt sie vor und nennt die geänderten Kriterien, Nicht-Ziele und Szenarien (diese mit Titel). Ist `vorschlag` null, schlägt er nichts vor — auch ein in Schritt 3 ergänzter Abschnitt führt so zur erneuten Prüfung. Steht der Vermerk, ist der Weg danach `/techplan #<N>`.

## Stop-Punkte

- Kein Label setzen oder abnehmen — `review:done` und `kit:clarify` bleiben, wie sie sind; `kit:clarify` nimmt allein der Mensch ab. Einzige Ausnahme: `kit:clarified` nach dem Vermerk „Keine“ (Schritt 7); abgenommen wird auch dieses nie.
- Keine Prüfung starten — der Skill schlägt `/issue-review` nur vor.
- Keine eigenen Prüffunde einbringen — jede Änderung stammt aus einer Antwort.
- Kein `[Plan]` anlegen — das ist `/techplan`.
- Keine Bewegung der Karte auf dem Board.
- Nichts schreiben ohne Zustimmung, und nie einen Body, den `issue questions --body-file` abgewiesen hat.
- Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt): nicht beginnen.
