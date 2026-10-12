---
name: groom
description: Führt das Grooming eines geprüften Fachplans mit dem PO — jede offene Frage einzeln mit Empfehlung und Begründung, die Einarbeitung zur Zustimmung, Schreiben sofort nach Zustimmung, zuletzt der Vermerk „Keine“. Nutze diesen Skill wenn der Nutzer /groom aufruft oder die offenen Fragen eines Fachplans entscheiden will.
user-invocable: true
---

# Groom

Ein Fachplan, den Modelle geprüft haben, trägt oft noch offene Fragen an den PO. Dieser Skill führt durch sie: Jede offene Frage unter `## Offene Fragen an den PO` kommt einzeln, mit Empfehlung und Begründung; der Mensch entscheidet genau diese eine Frage; die Session zeigt, wie sie die Antwort einarbeitet, und schreibt nach Zustimmung sofort in den Body. Sind alle Fragen entschieden, setzt sie den Vermerk „Keine“, und der Fachplan ist bereit für `/techplan`.

Das Mechanische trägt das Kommando `issue fragen`: welche Fragen offen sind, ob der Ablauf beginnen darf, welcher Kommentar die Stopp-Frage trägt, ob ein neuer Body Kennzeichnungszeilen und Antworten behält, wie der Vermerk lautet und was sich an Kriterien und Nicht-Zielen geändert hat. Es liest nur. Empfehlung, Einarbeitung und Folgefragen sind Urteil der Session und stehen hier.

## Ablauf

### 1. Einstieg

`/groom #N` nimmt genau einen Fachplan. Erster Schritt, vor allem anderen: **Unbeaufsichtigt** (gesetztes, nicht leeres `KIT_AGENT_MODEL`) beginnt der Skill nicht und meldet das — niemand kann antworten. Dieselbe Bedingung prüft das Kommando und weist mit dem Grund `unbeaufsichtigt` ab.

```bash
node .claude/kit/board.mjs issue questions <N>
```

Die Ausgabe trägt `einstieg` (`start`, `grund`, `meldung`), `fragen` (`vermerk`, `fragen`, `ungegliedert`, `offen`), `stoppKommentar` und `vermerkVorschlag`. Bei `start: false` meldet der Skill die `meldung` und endet ohne Änderung — eine andere Karte als ein `[Fachlich]` (`kein-fachplan`), unbeaufsichtigt (`unbeaufsichtigt`), ein Fachplan ohne `review:fertig` und ohne `kit:klaeren` (`ungeprueft`, der Weg ist zuerst `/issue-review #<N>`), ein Fachplan mit Vermerk „Keine“ und ohne `kit:klaeren` (`nichts-offen`). Nennt das Kommando dazu einen `hinweis` — etwa eine Frage ohne Antwortzeile unter einem gesetzten Vermerk —, steht er in der Meldung; der Skill entfernt den Vermerk nicht.

Meldet `fragen` Absätze unter `ungegliedert`, legt der Skill als erste Änderung ihre Gliederung in nummerierte Fragen zur Zustimmung vor (Schritt 5) — eine stille Umdeutung von Fließtext wäre eine Änderung ohne Zustimmung.

### 2. Start-Body ablegen

Den Body, wie er jetzt am Board steht, legt der Skill als `<tmpdir>/<N>-groom-start.md` ab — gegen ihn misst Schritt 7, was sich an Kriterien und Nicht-Zielen geändert hat. Die Datei entsteht nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“: erst `printenv TMPDIR` (bleibt die Ausgabe leer, gilt `/tmp`), dann stückweise `cat >` und `cat >>` mit je höchstens 6.000 Zeichen, jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Variable. Dasselbe gilt für jeden neuen Body in Schritt 5 und 6. Scheitert ein Dateischritt, gilt: Eine unvollständige Datei wird nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Änderung.

### 3. Stopp-Frage zuerst

Trägt der Fachplan `kit:klaeren` und liefert das Kommando einen `stoppKommentar` mit Kommentar, formuliert der Skill aus dessen Text die Stopp-Frage der angehaltenen Prüfung und legt sie **zuerst** vor. In den Body kommt sie als nächste freie Nummer ans Ende der Liste, mit dem Zusatz `(Stopp-Frage der Prüfung vom <Datum>)` (Datum des Kommentars) — die vorhandenen Fragen werden nicht umnummeriert, weil Antworten und Kommentare auf ihre Nummern verweisen. Frage und Antwort gehen zusammen in den Body, wie in Schritt 5.

Ist `kit:klaeren` gesetzt, aber `stoppKommentar` ohne Kommentar, sagt der Skill mit dem Grund aus der Ausgabe, dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht, und groomt die übrigen offenen Fragen.

### 4. Je offene Frage

Der Skill legt die offenen Fragen **einzeln** vor, in ihrer Reihenfolge: die Frage, seine Empfehlung und deren Begründung. Er nimmt je Frage **genau eine Antwort** an.

- **Sammelantwort:** Antwortet der Mensch auf mehrere Fragen zugleich, übernimmt der Skill nur den Teil zur aktuellen Frage. Die nächste Frage legt er trotzdem einzeln vor und nennt das schon Gesagte als Vorschlag; ein kurzes Ja genügt dann.
- **Zurückstellen:** „zurückstellen“ ist eine zulässige Antwort. Die Frage bleibt ohne Antwortzeile und damit offen, am Board wird nichts vermerkt; der Skill geht zur nächsten und nennt sie am Ende. Ein späterer Aufruf legt nur noch die offenen Fragen vor.

Eigene Prüffunde bringt der Skill nicht ein: Jede Änderung am Body stammt aus einer Antwort des Menschen.

### 5. Einarbeitung zeigen, nach Zustimmung schreiben

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

### 6. Vermerk „Keine“

Sind alle Fragen entschieden und keine zurückgestellt, liefert ein erneuter Aufruf `issue fragen <N>` den Vermerk unter `vermerkVorschlag` — mit der Zahl aller Fragen des Abschnitts, Folgefragen eingeschlossen, und dem heutigen Datum. Der Skill übernimmt ihn wörtlich als erste Zeile unter `## Offene Fragen an den PO`; Fragen und Antworten bleiben darunter stehen. Er zeigt die Änderung und schreibt nach Zustimmung wie in Schritt 5. Ist eine Frage zurückgestellt, entfällt der Vermerk.

### 7. Abschluss

Die Abschlussmeldung nennt:

- die zurückgestellten Fragen mit Nummer, oder dass keine zurückgestellt ist;
- bei `kit:klaeren` mit `stoppKommentar`: dass der Mensch `kit:klaeren` abnimmt und den Fachplan erneut prüfen lässt (`/issue-review #<N>`);
- bei `kit:klaeren` ohne `stoppKommentar`: dass der Halt keiner Prüfung des Fachplans entstammt und sein Weg im Halt-Kommentar steht;
- den Prüfvorschlag aus dem Vergleich mit dem Start-Body:

```bash
node .claude/kit/board.mjs issue questions <N> --compare <tmpdir>/<N>-groom-start.md
```

Ist unter `aenderungen` ein Kriterium oder Nicht-Ziel ergänzt, gestrichen oder umformuliert, schlägt der Skill eine erneute Prüfung vor (`/issue-review #<N>`) und nennt die geänderten Kriterien und Nicht-Ziele. Ist die Liste leer, schlägt er nichts vor. Steht der Vermerk, ist der Weg danach `/techplan #<N>`.

## Stop-Punkte

- Kein Label setzen oder abnehmen — `review:fertig` und `kit:klaeren` bleiben, wie sie sind; `kit:klaeren` nimmt allein der Mensch ab.
- Keine Prüfung starten — der Skill schlägt `/issue-review` nur vor.
- Keine eigenen Prüffunde einbringen — jede Änderung stammt aus einer Antwort.
- Kein `[Plan]` anlegen — das ist `/techplan`.
- Keine Bewegung der Karte auf dem Board.
- Nichts schreiben ohne Zustimmung, und nie einen Body, den `issue fragen --body-file` abgewiesen hat.
- Unbeaufsichtigt (`KIT_AGENT_MODEL` gesetzt): nicht beginnen.
