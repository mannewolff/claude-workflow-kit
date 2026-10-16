# Runner

Der Runner läuft eigenständig und kennt zwei Betriebsarten: den **Lauf**, der die Ready-Spalte abarbeitet, und die **Kette**, die aus einer fachlichen Anforderung oder einem fertigen Plan den geprüften Plan und die Arbeitspakete macht. Den [Prüflauf](/prozess#der-pruflauf) beschreibt die Prozessseite. Der Runner pusht nie.

## Der Lauf

Der Runner `.claude/kit/night.mjs` startet je Ready-Karte eine frische Headless-Session mit `/implement-next #N`. Erfolg heißt: Karte in In review.

```bash
node .claude/kit/night.mjs --dry-run   # zeigt, was laufen würde, startet nichts
node .claude/kit/night.mjs             # echter Lauf
```

Flags: `--max <N>` (Sessions je Lauf, Vorgabe 10), `--model <id>`, `--timeout-min <N>` (Zeitgrenze je Runde, Vorgabe 60), `--label <name>`, `--verbose no` (ohne Live-Verlaufsprotokoll), `--no-checks-ok`, `--yolo` (alle Permission-Checks aus) und `--help`.

**Das Sortieren ist das GO.** Der Runner arbeitet Ready von oben nach unten ab, aber nur Karten mit dem Routing-Label `kit:nightrun`; `--label none` schaltet den Filter ab. Trägt keine Karte das Label, nennt die Warnung das gelesene Board: `Board von: <repo> (<host>)`. Karten mit den Titel-Präfixen `[Requirement]`, `[Idea]`, `[Plan]` und `[Human]` gehen ohne Session kommentiert zurück ins Backlog.

**Abhängigkeiten.** Eine Karte mit offener Abhängigkeit stellt der Runner zurück, darunter der Block `Abhaengigkeiten, wie der Nachtlauf sie liest:` mit einer Zeile je Abhängigkeit und gefundenen Kreisen. Der Probelauf zeigt dieselben Zeilen eingerückt unter der Zeile jedes Pakets. Die Konvention steht unter [/issues](/prozess#issues).

**Fester Kit-Stand.** Jeder unbeaufsichtigte Lauf bindet Werkzeuge, Skills und Regeltexte beim Start an den Commit von `origin/<mainBranch>`; was ein Paket daran ändert, wirkt erst nach `push main`.

**Das Modell einer Session.** Zuerst gilt `Empfohlenes Modell:` der Karte, wenn `night.models` den Namen führt, dann die `Aufgabenstufe:` nach `night.tiers`, sonst `--model` oder `night.model`; die Felder stehen unter [Einstellungen](/einstellungen#feinabstimmung). Jede Session bekommt `KIT_AGENT_MODEL` mit ihrem Modell.

**Permissions, Sandbox, Umgebung.** Die Sessions laufen mit `--permission-mode auto --permission-prompts none`: Was die Allowlist in `.claude/settings.json` nicht erlaubt, wird abgelehnt. Kommandos, die einen Socket oder das Board brauchen, gehören nach `sandbox.excludedCommands`, Variablen in den `env`-Block:

```json
{
  "permissions": { "allow": ["Bash(node .claude/kit/board.mjs:*)", "Bash(git commit:*)", "Bash(mvn:*)"] },
  "sandbox": { "enabled": true, "excludedCommands": ["node .claude/kit/board.mjs*", "node .claude/kit/night.mjs*", "mvn *"] },
  "env": { "DOCKER_HOST": "unix:///<pfad-zum>/docker.sock" }
}
```

Der Hook `bash-check` weist Zeilen ab, in denen eine Pipe oder Umleitung die Ausnahme aufhebt, und unbeaufsichtigt jeden Bash-Aufruf im Hintergrund: Eine Headless-Session hat keinen Folgezug.

### Was danach am Board steht

Jede Karte hat einen Ausgang:

| Ausgang | Was passiert ist | Wer kommentiert und bewegt | Folge für den Lauf |
|---|---|---|---|
| `erfolg` | Karte in In review, Commit liegt lokal | die Session | weiter |
| `zurueckgestellt` | die Session hat die Aufgabe nicht fertigbekommen | der Runner, nach Backlog | weiter |
| `angehalten` | eine Frage der Stopp-Klasse wartet, Label `kit:clarify` | die Session selbst | weiter |
| `harterStopp` | Umgebung oder Arbeitsbaum kaputt | keiner, die Karte bleibt | der Lauf endet |

Nach einem Halt geht es mit `/requirement #N` weiter; `kit:clarify` nimmt nur der Mensch ab.

**Was geprüft wurde und was nicht.** Die Auslassungen stehen an zwei Stellen: im Abschlussbericht am Arbeitspaket, wo die Session gelaufene und ausgelassene Prüfungen mit Grund aufführt, und im Lauf-Bericht des Durchgangs mit je Session eine Zeile und einer Summenzeile über den Lauf. Der Runner liest das aus `.claude/checks-summary.json` und prüft selbst nach, wenn der Nachweis nicht zum Commit passt (`nachgeprueft` oder rot).

**Der Ergebnisstand.** Neben dem Tagesprotokoll `.claude/night-run-<datum>.log` legt jeder Lauf `.claude/night-run-<datum>-<uhrzeit>.json` ab: je Paket Ausgang, Dauer, Commit, Modell, Kosten und Prüfläufe. Der Block `Prueflaeufe und Zielmarke:` im Bericht nennt, wie viele Pakete unter `night.goalImplementationMin` blieben. Tagesprotokolle und Laufordner unter `.claude/protokolle/` löscht der Runner nach der Frist `night.logRetentionDays`; JSON- und `.tsv`-Dateien bleiben.

**Ein Lauf ohne Arbeit nennt seinen Grund.** Endet ein Lauf ohne Paket, trägt der Lauf-Kopf `noWorkReason` mit dem Satz aus dem Protokoll. Ohne `--chain`: `Ready ist leer — nichts zu tun.`, `Keine der <N> Karten in Ready traegt das Label '<name>' — nichts zu tun.`, `Alle <N> Karten in Ready wurden am Gate zurueckgestellt — …` oder `Die Umsetzung ist belegt: <grund> — der Lauf endet ohne Paket.` Bei `--chain`: `Keine Kette zu fahren: keine Karte traegt das Label '<name>'.` oder `Keine Kette zu fahren: alle <N> gekennzeichneten Karten mit dem Label '<name>' wurden uebersprungen, …`. Jeder Satz führt Label und Zahl mit. Der Rückstellungs-Satz hat Vorrang vor `Ready ist leer`. Trifft kein Fall zu, steht dort `Kein Grund ermittelbar — … bitte melden.` Ein belegter Lock ist ein ruhiger Lauf mit Grund; ein nicht schreibbarer Lock ist ein harter Stopp der Fehlerklasse `umgebung` mit `fehlerText`, ohne `noWorkReason`. Ein Lauf mit Arbeit trägt es nicht.

**Einlieferung ans Board.** Mit `issueTracker: toolbox` liefert der Runner den Ergebnisstand fortschreibend an kanban-kit, ein harter Stopp mit `abortReason`. Scheitert die Einlieferung, bleibt die Datei.

**Danach:** Protokoll lesen, Backlog sichten, `/kit-review`, eigener Test, `push main`.

### Wenn etwas schiefgeht

Endet die Session mit einem Fehler der CLI, stoppt der Runner hart, und die Karte bleibt in Ready. Endet sie ohne In review, geht die Karte kommentiert ins Backlog; Reste im Arbeitsbaum versucht der Runner zuerst zu retten.

**Salvage.** Bevor der Runner die Reste aufgibt, fährt er `node .claude/kit/checks.mjs run --finish <id> --fresh`. Der Weg über `checks.mjs run` ist Absicht: Er hinterlässt `.claude/checks-summary.json`, den Nachweis, den das Commit-Gate liest. Es gilt die bereichsbezogene Auswahl der Paketstufe; Prüfungen der Stufen `push` und `merge` bleiben außen vor; `formatFixCommand` greift wie unter [Einstellungen](/einstellungen#lohnt-sich). Sind sie grün, bekommt eine Salvage-Session zehn Minuten, um zu committen und die Karte zu ziehen. Sonst sichert der Runner die Reste im Stash `nachtrest #<id> <lauf>`, die Karte geht ins Backlog, und der Lauf geht weiter. Hart gestoppt wird nur, wo ein Commit unvollständig sein kann.

**Die wartende Sitzung.** Keine Session endet mit laufender eigener Arbeit. Sagt der Schlusstext, dass sie noch auf eigene Arbeit wartet, hängt der Runner den Vermerk `## Nachtlauf: wartende Sitzung` mit dem letzten Stand an die Karte; die nächste Session nennt ihn. Warten auf einen Menschen zählt nicht.

Protokoll, Kommentar und Ergebnisstand tragen dieselbe Zeile `Grund: …`, etwa `Grund: Session am Zeitlimit beendet`.

### Der Halt an einer geschützten Datei

Nennt ein Paket eine Datei, die nur ein Mensch schreiben darf, und ist nicht freigegeben, stellt der Runner es zurück: Backlog, Label `kit:protected`, Kommentar `## Geschuetzte Datei`. Der Weg zurück: die Änderung selbst vornehmen, `kit:protected` abnehmen, nach Ready ziehen.

## Der Zeitabbruch

Endet eine Session an der Zeitgrenze, hängt der Runner den Vermerk `## Nachtlauf: Zeitgrenze erreicht` an die Karte. Er nennt die Grenze der Runde, den Stand nach eigener Auskunft der Sitzung, also ihre Zeilen `FORTSCHRITT: AK<n> — …`, eine Empfehlung, das Paket zu teilen, die ausdrücklich keine Vorgabe ist, und die Reste im Arbeitsverzeichnis.

Aus dem Abbruch folgt keine Aussage über seine Ursache: Die Einheit im Ergebnisstand trägt `zeitlimitBeendet: true`, der Lauf-Kopf `zielUmsetzungMin`, die Marke, mit der dieser Lauf rechnete.

Vorher sichtbar: `/issues` schreibt `Sitzungsumfang: passt | reisst` ins Paket, und der Laufbericht der Kette schließt mit `- Voraussichtlich über der Sitzungszeitgrenze: #N, #M`.

Maßstab ist die Zeitgrenze einer Sitzung, `--timeout-min`, Vorgabe 60 Minuten. Gemeint sind nicht `night.chain.implementationMin`, das Budget der Umsetzungsstufe, und die Zielmarke `night.goalImplementationMin`.

## Das festgefahrene Paket

Scheitert dieselbe Prüfung immer wieder auf dieselbe Weise, endet die Sitzung vor ihrer Zeitgrenze. `checks.mjs run` merkt sich je rotem Kommando einen Fehlerabdruck: die Namen der gescheiterten Tests, sonst die erste Fehlermeldung. Erreicht die Folge gleicher Fehlschläge `night.stuckAfter`, fährt der nächste Aufruf unbeaufsichtigt nichts mehr: Er meldet `Pruefung festgefahren: <Kommando> — <Fehler>` und endet mit Exitcode 3. Interaktiv erscheint nur ein Hinweis.

Der Runner beendet die Sitzung, sichert Reste im Stash, setzt `run:aborted` mit `Grund: Session an einer Pruefung festgefahren` und zieht das Paket ins Backlog. Der Vermerk `## Nachtlauf: an einer Pruefung festgefahren` nennt Prüfung, Fehler, Versuche und Laufzeit. Weiter: Fehler lesen, Reste zurückholen, nachbessern, wieder nach Ready.

## Die Kette

Eine fachliche Anforderung geht hinein, am Ende liegen geprüfter Plan, Arbeitspakete und Bericht an ihr. Unter **Variante A** bleiben die Pakete im Backlog. Unter **Variante B** zieht die Kette sie selbst nach Ready und setzt sie um; dein GO liegt dann in der Kennzeichnung der Karte.

**Die Geste** ist das Label `kit:night` an einer gegroomten Karte im Backlog. Der Runner verbraucht das Label beim Start: Jedes Setzen erlaubt genau eine Kette, ein Abbruch braucht eine neue Geste.

**Die Pruefung als Voraussetzung.** Die gekennzeichnete Karte muss beim Start auch `review:done` tragen, die fachliche Anforderung ebenso wie das Plandokument eines Plan-Auftrags. Fehlt es, bleibt das Kettenlabel, und die Karte bekommt einmal den Kommentar `## Kette nicht gestartet: Pruefung fehlt` mit dem Weg über `/issue-review`.

**Die Variante** setzt das Label `kit:carry-through` an derselben Karte; es wird nicht verbraucht.

```bash
node .claude/kit/night.mjs --chain --dry-run   # Kandidaten, Reviewer-Stand, Budgets
node .claude/kit/night.mjs --chain             # echter Lauf
```

`--max` zählt hier Ketten (Vorgabe 3).

**Bedingungen.** Ein Kandidat hat den Titel `[Requirement]` oder `[Plan]`, steht im Backlog, trägt kein `kit:clarify` und wartet auf kein Ereignis. Vor der ersten Kette steht jeder Kandidat auf `run:running` mit „Lauf angenommen um …, Vorabprüfung läuft“; dann prüft eine Vorflug-Session Reviewer und Tracker. Scheitert sie, steht `run:aborted` mit `Kette nicht gestartet um <Zeit>: <Grund>` im Laufstand, und die Labels bleiben. Die Kette arbeitet in einem eigenen Worktree.

| Stufe | Session | wann die Kette hier endet |
|---|---|---|
| plan | `/techplan #F` schreibt den Plan | kein Plan: `abgebrochen` |
| Formprüfung | `issue check-form`, bei Rot eine Korrektursession | nach `correctionRounds` weiter rot: `abgebrochen` |
| review | `/issue-review #M`, der Prüfer der Stufe `plan` | offene Frage im geprüften Plan: `angehalten` |
| pakete | `/issues #M` | kein Paket: `abgebrochen` oder `angehalten` |
| abdeckung | eine lesende Session hält die Pakete gegen die Anforderung | nie, sie ist eine Auskunft |
| umsetzung (Variante B) | `/implement-next #P` je Paket | Lock belegt oder Hauptkopie unsauber: `unvollstaendig` |

**Vier Ausgänge**, je Kette einer: `fertig`, `unvollstaendig` (die bestellte Umsetzung blieb aus, die Pakete liegen im Backlog), `angehalten` (eine Frage wartet auf dich) und `abgebrochen` (technisch oder am Budget gescheitert, mit Grund). Ein Abbruch beendet nur diese Kette.

**Budgets** stehen in `night.chain`, alle optional, mit diesen Vorgaben:

```json
{
  "night": {
    "chain": {
      "label": "kit:night",
      "variantBLabel": "kit:carry-through",
      "planMin": 20,
      "reviewMin": 15,
      "packagesMin": 15,
      "coverageMin": 10,
      "implementationMin": 120,
      "preparationMin": 120,
      "costUsd": 50,
      "costUsdB": 150,
      "correctionRounds": 2
    }
  }
}
```

Was jedes Feld begrenzt, steht unter [Einstellungen](/einstellungen#feinabstimmung).

**Der Bericht.** Bei jedem Ausgang hängt die Kette einen Kommentar `## Nachtbericht, Kette <stempel>` an die gekennzeichnete Karte: Ausgang, Stufen, Pakete, Entscheidungen, Abdeckung, Kennzahlen. Er endet mit `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` Nimmt der Tracker ihn nicht an, liegt er als `.claude/night-bericht-<F>-<stempel>.md` bereit und wird nachgetragen.

**Der Rückweg nach `angehalten`.** Eine offene Frage im Plan hält die Kette erst nach der Prüfung, vor dem Schnitt in Pakete. Die Kette schreibt die Frage als `## Kette angehalten` an die gekennzeichnete Karte und setzt `kit:clarify`. Der Weg führt über den Plan: die Antwort als Eintrag unter `## Architektonische Entscheidungen`, `## Offene Fragen` wieder auf `- Keine.`, `kit:clarify` abnehmen, zuletzt `kit:night` an den Plan. Die nächste Kette nimmt ihn als Plan-Auftrag und beginnt bei `pakete`. Hast du mit der Antwort mehr am Plan geändert als den Eintrag selbst, prüft ihn die Kette vorher selbst erneut. Entsteht stattdessen ein neuer Plan, bekommen ältere den Kommentar `Ueberholt durch Plan #M2`.

**Kette und Umsetzung nebeneinander.** Kette und Lauf dürfen gleichzeitig fahren: die Kette im Worktree, der Lauf in der Hauptkopie. Unter Variante B baut auch die Kette in der Hauptkopie; beide nehmen dafür den Lock `.claude/night-umsetzung.lock`, auf den die Kette höchstens `night.chain.implementationMin` wartet. Eine fachliche Wurzel bearbeitet immer nur ein Runner.

### Wie weit eine Kette läuft: das Ziel

Ein Ziel-Label an derselben Karte wie `kit:night` legt fest, wo die Kette diesmal endet. Die Stufen bleiben in ihrer Reihenfolge.

| Ziel | letzte Stufe | was danach dir gehört |
|---|---|---|
| `goal:plan` | `review` | Plan lesen, dann `kit:night` an den Plan. |
| `goal:packages` | `abdeckung` | Pakete nach Ready ziehen. |
| `goal:implementation` | `umsetzung` | Pakete in In review testen, dann `push main`. |
| `goal:push-prepared` | `vorbereitung` | Meldung der Vorbereitung lesen, dann `push main`. |

Ein Ziel ab `umsetzung` ist zugleich das GO für die Pakete, wie `kit:carry-through`. `planreview:1` oder `planreview:2` an der Anforderung legt fest, ob ein oder zwei Modelle den Plan prüfen. Beim Start verbraucht der Runner `kit:night`, das Ziel und `planreview:*` zusammen. Alle sechs Labels werden je Board einmal angelegt.

Abgelehnt mit dem Kommentar `## Kette nicht gestartet: unpassende Einstellung` wird eine Karte mit mehr als ein `goal:*` oder beiden `planreview:*`, mit `goal:plan` an einem Plandokument, mit `planreview:*` an einem Plandokument und mit `planreview:*`, wenn ihr Plan schon `Plan-Review:` trägt.

Das Projekt bleibt Obergrenze: Sperrt `night.chain.transitions` einen Übergang, endet die Kette dort an der Projektgrenze. Die Stufe `vorbereitung` fährt `/push-main prepare`, ohne zu pushen ([/push-main](/prozess#push-main)).

### Ein fertiger Plan als Auftrag

`kit:night` an einem `[Plan]`-Issue im Backlog startet einen Plan-Auftrag. Der Plan trägt `review:done`, kein `kit:clarify`, unter `## Offene Fragen` steht `- Keine.`, seine Herkunft ist gültig, und sein Fachplan wartet auf kein Ereignis. Ohne Zeile `Fachliche Quelle:` läuft er als eigene Wurzel; trifft `Fachliche Quelle: Issue #N` eine Karte, hält die Abdeckung die Pakete gegen sie; zeigt die Zeile ins Leere, bleibt er liegen.

Die Stufe `plan` entfällt, der Lauf beginnt bei `pakete`. `review` läuft davor nur, wenn sich der Plan seit seiner Prüfung über die eingetragene Antwort hinaus geändert hat. `kit:carry-through` gilt nur am Plan selbst; dann läuft Variante B.

Die fachliche Anforderung weicht dem Plan: Tragen beide das Kettenlabel, läuft der Plan.

Von zwei gekennzeichneten Plänen derselben Wurzel läuft der jüngere.

### Warten auf ein Ereignis

Wartet ein fertiger Fachplan auf etwas außerhalb des Projekts, etwa einen wählbaren Tarif, kennzeichnest du das mit

```bash
node .claude/kit/board.mjs issue hold <N> --reason "wartet, bis Tarif X wählbar ist"
```

Das Kommando schreibt die Zeile `Wartet auf Ereignis: <Grund>` in den Abschnitt `## Ziel` und setzt das Label `kit:on-hold`. Maßgeblich ist die Zeile; das Label macht das Warten am Board sichtbar.

Solange die Zeile steht, startet für den Fachplan keine Kette, und aus einem Plan zu ihm entstehen keine Pakete. Bericht und `--dry-run` nennen ihn mit dem Wartegrund unter den Übersprüngen. `kit:night` bleibt an der Karte. Das Warten ist keine offene Frage und von `kit:clarify` getrennt. Ist das Ereignis eingetreten, hebst du das Warten auf:

```bash
node .claude/kit/board.mjs issue hold <N> --lift
```

Das nimmt Zeile und Label ab. Die nächste Kette nimmt den Fachplan wieder auf, ohne neue Prüfung und ohne neues `kit:night`. Aufheben tut nur der Mensch.

### Allowlist für fremde Reviewer

Der Vorflug des Runners startet ein fremdes Werkzeug direkt; ohne Eintrag wie `Bash(codex:*)` hängt die Session bis zur Zeitgrenze.

## Der Laufstand

Der Stand eines Laufs steht am Board, nicht im Prozess. An der Karte hängt höchstens eines der Labels `run:running`, `run:aborted` und `run:waiting`, dazu genau ein Kommentar `## Laufstand`, der bei jedem Wechsel ersetzt wird. Der Kommentar ist Tafel, nicht Verlauf; der Laufbericht bleibt Verlauf. Die Zeile `Protokoll:` nennt die Datei `.claude/protokolle/<lauf>/<karte>-<stufe>.log` des Schritts.

`run:aborted` heißt technisch abgebrochen. `run:waiting` nennt, worauf die Karte wartet:

- `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night`
- `wartet: Karte ohne Freigabe zur Umsetzung`
- „Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`“

Trug die Karte ein Ziel, stehen `Ziel: <plan|pakete|umsetzung|push-vorbereitet>`, `Prüfer: <1|2>` und bei gesperrtem Übergang `Grenze: <letzte erreichbare Stufe>` im Laufstand. Am Ziel lautet der Kopf `fertig bis <Ziel>`, darunter `Als Nächstes:`.

**Wiederholen.** `kit:night` startet die Kette bei der ersten Stufe ohne Ergebnis; was vorliegt, entsteht nicht doppelt. Ein frischer Plan entsteht erst, wenn der alte in Done steht.

**Übergänge.** `night.chain.transitions` gibt die Übergänge einzeln frei. `coverageImplementation` wirkt nur zusammen mit `kit:carry-through` an der Karte.

**Ein Versuch.** Einen automatischen Versuch gibt es nur bei Umgebungsfehlern, solange der Lauf lebt; der Laufstand vermerkt „2. Versuch“. Ein gestorbener Lauf wird nicht wiederholt.

### Der Wächter

Ein abgekoppelter Wächter sieht jede Minute nach. Verstummt ist ein Lauf erst, wenn sein Puls älter als `night.status.deadlineMin` ist und sein Prozess nicht mehr existiert; ein Lauf, der lebt, gilt nie als verstummt. Dann setzt der Wächter jede laufende Karte auf `run:aborted` mit `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min`.

### Das Journal

Jeder Stand geht zuerst als Zeile nach `.claude/lauf/<lauf>.jsonl`. Nimmt das Board ihn nicht an, wird er nachgetragen, sobald es wieder antwortet.

Stirbt die Stufe `pakete` mitten im Schnitt, zeigt der nächste Lauf „Teilschnitt vorhanden (#a, #b) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night“.

Reste eines gescheiterten Pakets holst du mit `git stash apply stash@{<n>}` zurück.

### Die Belegfälle

| Fall | Kartenstand danach | Weg nach vorn |
|---|---|---|
| Spurlos: der Lauf stirbt in der Vorabprüfung | nach der Frist `run:aborted` mit `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` | Ursache beheben, dann `kit:night` |
| Abgebrochen, obwohl fertig: Zeitbudget gerissen, Ergebnis liegt vor | `run:aborted` mit Grund | `kit:night`: die Stufe gilt als vorgefunden |
| Ausgang unbekannt: Board kurz nicht erreichbar | „2. Versuch“; scheitert er, die übrigen Karten `run:waiting` mit `nicht begonnen: …` | erneut starten bzw. `kit:night` |
| Ein Paket hält den Lauf an | nur dieses Paket `run:aborted`, abhängige mit „hängt an #N“, Reste im Stash `nachtrest #<id> <lauf>` | nachbessern, wieder nach Ready |
| Ein Paket fährt sich fest | `run:aborted` mit `Grund: Session an einer Pruefung festgefahren` | Vermerk lesen, nachbessern |
| Verschränkte Protokolle: Kette und Prüflauf gleichzeitig | die Zeile `Protokoll:` nennt `.claude/protokolle/<lauf>/<karte>-<stufe>.log` | die genannte Datei öffnen |

## Mit einem lokalen Modell fahren

> **Ungetestet.** Der Weg folgt aus der Architektur des Runners, ist aber nicht praktisch erprobt.

Eine Stufe in `night.tiers` kann mit `command` ein eigenes Programm starten, oder Claude Code spricht über einen Proxy wie [LiteLLM](https://docs.litellm.ai/) mit einem lokalen Modell:

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1
```

Ein eigenes Routing-Label trennt die einfachen Karten ab.

## Aufwand des Prozesses

`node .claude/kit/effort.mjs evaluate` liest die jüngsten Ergebnisstände und schreibt `.claude/aufwand.md` und `.claude/aufwand.json`. Der Befund steht am Ende des Laufprotokolls und in `/push-main` und ist kein Gate.

**Die Zielmarke der Umsetzung** zeigt, wie viele Umsetzungen die Marke reißen, um wie viel im Mittel und im Maximum. Gemittelt wird über die Überschreitungen. Die Marke kommt aus dem Lauf-Kopf des Standes. Derselbe Block steht als `zielmarke` in `.claude/aufwand.json`.

**Zeitabbrüche stehen getrennt.** Ihre Fertigstellungsdauer ist unbekannt, deshalb gehen sie in keinen Mittelwert ein.

**Jeder Rechner steht für sich.** Ohne Option wertet der Bericht die Läufe des Rechners aus, auf dem `effort.mjs` läuft; `--machine <name>` wählt einen anderen. Die Läufe anderer Rechner und ältere ohne Rechnerangabe gehen in keine Kennzahl ein.

**Median je Prüfkommando.** Die Tabelle der Prüfungen nennt je Kommando neben der Summe den Median einer vollständigen Ausführung; gewackelte, wiederholte und übernommene zählen nicht. Ohne vollständige Ausführung steht „nicht gemessen“, nie null.

**Werkzeugbasis je Stufe.** Die Tabelle nach Aufgabenstufe nennt je Stufe die Werkzeugzeit je Paket und ihren Anteil an der Paketzeit.

Laufzahl und Schwellen: Block `workload` unter [Einstellungen](/einstellungen#feinabstimmung).

## Verbrauch interaktiver Sitzungen

`board.mjs session report` summiert die Token einer interaktiven Sitzung und liefert sie an kanban-kit; die Hooks dafür trägt der Installer ein ([Was der Installer schreibt](/einrichtung#was-der-installer-schreibt)). Über die Wegmarken aus `issue move` in `.claude/wegmarken.tsv` teilt der Melder die Summe auf die Karten auf. Fehlt ein Modell in `kit/preise.mjs`, meldet er keinen Betrag, nie eine 0.
