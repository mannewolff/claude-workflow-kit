# Der Prozess

Das Kit führt eine Anforderung in neun Schritten bis in die Produktion. Drei gehören dem Menschen: das GO, der Push und der Merge. Daneben gibt es Werkzeuge, die den Prozess ergänzen oder einen Schritt feiner gliedern.

## Die neun Schritte

| Schritt | Was | Wer | Skill |
|---------|-----|-----|-------|
| **1** | **Anforderung formulieren** | **Mensch** | (kein Skill) |
| 2 | Anforderung planen | KI | /techplan |
| 3 | Issues anlegen | KI | /issues |
| **4** | **GO: Issues nach Ready ziehen** | **Mensch** | (kein Skill) |
| 5 | Ready-Issues implementieren | KI | /implement-ready |
| 6 | Lokale Checks ausführen | KI | /local-check |
| 7 | Review durchführen | KI | /kit-review |
| **8** | **Push auf main** | **Mensch** | /push-main |
| **9** | **Merge nach production** | **Mensch** | /merge-production |

Zwischen Schritt 8 und 9 prüfst du den Test-Server im Browser; dafür gibt es keinen Skill.

## Werkzeuge neben dem Prozess

Die Werkzeuge tragen keine Nummer, weil eine Nummer eine Reihenfolge und eine Pflicht behaupten würde.

**Ergänzen den Prozess**

| Skill | Wofür |
|-------|-------|
| `/session-start` | Session-Start: Vault laden, Projektstand |
| `/triage` | eine Idee mit dem Menschen durchsprechen und auf ihre Bahn bringen |
| `/requirement` | Anforderung als fachliches Issue zum Groomen mit dem PO |
| `/issue-review` | fachliche Anforderung, Plandokument **oder** Arbeitspaket prüfen lassen, ein Kommando für drei Stufen |
| `/groom` | offene Fragen eines geprüften Fachplans einzeln mit dem PO entscheiden |
| `/retro` | KI-Retrospektive, Memory konsolidieren |
| `/document` | Session-Ende: Tageslog und Projektnotiz |

**Ersetzt Schritt 2 und 3**

| Skill | Wofür |
|-------|-------|
| `/task` | Anforderung ohne Abwägungsbedarf als einzelnes Arbeitspaket `[Task]` |

**Ersetzen Schritt 5 durch eine feinere Gangart**

| Skill | Wofür |
|-------|-------|
| `/implement-next` | genau ein Ready-Issue statt der ganzen Spalte |
| `/implement-test` | nur die roten Tests, Stopp vor der Implementierung |
| `/implement-done` | Implementierung gegen die vorbereiteten roten Tests |

## Die Skills

Die achtzehn Skills in der Reihenfolge des Ablaufs, je mit Zweck, Aufrufzeitpunkt und nächstem Schritt.

### /session-start

**Wofür:** Der Skill lädt den Kontext, den du zum Arbeiten brauchst. Mit Vault liest er Profil, Arbeitsregeln und Projektnotiz, sonst das Board. Er meldet laufende Vorhaben, letzte Entscheidungen und was ansteht.

**Wann:** am Anfang jeder Session.

**Danach:** der Schritt, den der Lageüberblick nennt.

### /triage

**Wofür:** Eine `[Idea]` ist eine rohe Idee, noch keine Anforderung. `/triage #N` liest sie samt Anhängen, legt jeden unklaren Punkt einzeln mit Empfehlung vor und schreibt den geklärten Stand nach jeder Bestätigung sofort in die Idee. Zum Schluss schlägt der Skill eine Bahn mit Begründung vor; du wählst einen von vier Ausgängen.

**Wann:** sobald eine Idee am Board liegt und du sie angehen willst. Der Skill läuft nur interaktiv.

**Danach:** der gewählte Ausgang. `1` setzt eine Kleinigkeit sofort um und schließt die Idee mit Verweis auf den Commit. `2, fachlich` führt per `/requirement #N` in eine fachliche Anforderung, `2, technisch` per `/techplan #N` direkt in einen technischen Plan, `3` per `/task #N` in genau ein Arbeitspaket.

Weißt du schon, was die Idee will, rufst du zwei dieser Wege direkt auf: Verlangt sie eine Abwägung, führt `/requirement #N` sie in eine fachliche Anforderung; ist nichts abzuwägen, wird sie per `/task #N` genau ein Arbeitspaket. Ob etwas abzuwägen ist, entscheidet der Mensch. Direkt zum technischen Plan geht eine Idee nur über `/triage` mit der Bahn `2, technisch`.

### /requirement

**Wofür:** Der Skill macht aus einer rohen Anforderung genau ein fachliches Issue: Titel mit dem Präfix `[Requirement]`, Body im Story-Format mit Ziel, fachlichen Akzeptanzkriterien, Szenarien, Nicht-Zielen und offenen Fragen an den PO. Der Text ist technikfrei und in der Sprache des PO geschrieben. Vor dem Anlegen prüft `issue check-form` die Form.

**Wann:** in Projekten mit Product Owner, vor dem Plan. Eingang ist eine Anforderung aus dem Chat, eine `[Idea]` mit Abwägungsbedarf oder ein angehaltener Task.

**Danach:** `/issue-review #N` am Fachplan, dann `/groom #N`. Ohne PO beginnst du direkt mit `/techplan`. Wie ein Fachplan aussieht, steht unter [PO-Schleife](#po-schleife-fachliche-und-technische-issues).

### /issue-review

**Wofür:** Modelle, die das Dokument nicht geschrieben haben, lesen einen Fachplan, ein Plandokument oder auf Wunsch ein Arbeitspaket und liefern Befunde als Kommentar. Die aufrufende Session arbeitet jeden Befund ein oder lehnt ihn mit einem Satz ab. Am Ende setzt sie das Label `review:done` als Spur am Board; ein Befund der Stopp-Klasse setzt stattdessen `kit:clarify`. Die Stufe liest der Skill am Titel-Präfix ab, welche Rollen prüfen, sagt `reviewStufen`. Einzelheiten stehen unter [Issue-Review über mehrere Modelle](/dokumentation#issue-review-uber-mehrere-modelle).

**Wann:** nach `/requirement` am Fachplan und nach `/techplan` am Plandokument. Arbeitspakete prüft der Skill nur auf ausdrücklichen Aufruf.

**Danach:** am Fachplan `/groom #N`, am Plandokument `/issues #N`. `review:done` ist zugleich Voraussetzung der Nacht-Kette. Das Label gibt den Inhalt nicht frei: Ändert sich ein Dokument danach wesentlich, lässt du es erneut prüfen.

### /groom

**Wofür:** Der Skill entscheidet mit dem PO die offenen Fragen eines geprüften Fachplans. Jede Frage unter `## Offene Fragen an den PO` kommt einzeln, mit Empfehlung und Begründung, und du entscheidest genau diese eine. Nach deiner Zustimmung schreibt die Session die Antwort sofort in den Body. Eine Frage lässt sich zurückstellen. Sind alle Fragen entschieden, setzt der Skill den Vermerk „Keine“; ihn liest die Nacht-Kette. Einen Fachplan ohne Szenarien ergänzt `/groom` ebenfalls.

**Wann:** nach `/issue-review` am Fachplan und vor `/techplan`. Eingang ist ein `[Requirement]` mit `review:done` oder `kit:clarify`; bei `kit:clarify` kommt die Stopp-Frage zuerst. Der Skill läuft nur interaktiv, schreibt nichts ohne Zustimmung und entfernt kein Label.

**Danach:** `/techplan #N`. Hat eine Antwort Kriterien oder Nicht-Ziele geändert, schlägt der Skill vorher eine erneute Prüfung vor.

### /techplan

**Wofür:** Schritt 2. Aus der Anforderung entsteht ein Plan mit Ziel, betroffenen Bereichen, architektonischen Entscheidungen, geplanten Änderungen, offenen Fragen und Verifizierung. Unter „Offene Fragen“ stehen nur Fragen der Stopp-Klasse; alles andere entscheidet der Skill und hält es als Entscheidung fest. Der Skill implementiert nichts; technische Issues entstehen erst in `/issues`. Gibst du den Plan frei, legt er ihn bei Bahn 2 als Plandokument mit dem Titel-Präfix `[Plan]` an, mit `Plan-Modell:` im Kopf und, wenn der Plan aus einem Fachplan entstand, `Fachliche Quelle: Issue #N`.

**Wann:** nach `/groom` oder, ohne PO, direkt nach der Anforderung. `/techplan #N` liest einen Fachplan oder eine Idee nach `/triage` als Quelle.

**Danach:** `/issue-review #N` am Plandokument, dann `/issues #N`.

### /task

**Wofür:** Der Skill ersetzt die Schritte 2 und 3 für eine Aufgabe ohne Abwägungsbedarf, etwa eine Umbenennung über mehrere Dateien. Er legt genau ein Arbeitspaket mit dem Titel-Präfix `[Task]` im Vier-Abschnitt-Format an, ohne Fachplan, Plan und Herkunftszeilen. Vorher benennt er die Bahn und wartet auf dein Wort; unbeaufsichtigt legt er nichts an. Unklarheiten außerhalb der Stopp-Klasse entscheidet er selbst und hält sie als `Entscheidung:`-Zeile fest. Ein `[Task]` ist ein Arbeitspaket und wird implementiert wie jedes andere.

**Wann:** wenn [Bahn 3](/dokumentation#drei-bahnen) gilt. Quelle ist der Chat oder eine `[Idea]` (`/task #N`); ein Fachplan oder Plandokument lehnt der Skill ab.

**Danach:** das GO, also das Paket nach Ready ziehen.

### /issues

**Wofür:** Schritt 3. Aus dem freigegebenen Plan entstehen Arbeitspakete im Vier-Abschnitt-Format: Kontext, Aufgabe, Akzeptanzkriterium, Abhängigkeiten. Jedes Paket ist eigenständig testbar und trägt im Kontext Rückverweise auf Plan und Fachplan sowie `Empfohlenes Modell:` oder, bei aktivem `night.stufen`, `Aufgabenstufe:` und `Stufengrund:`. Ab hier ist das Issue die Quelle der Wahrheit. Unklarheiten entscheidet der Skill als `Entscheidung:`-Zeile, `issue check-form` prüft jedes Paket vor dem Anlegen.

**Wann:** nach Freigabe und Prüfung des Plans, mit `/issues #N` und der Nummer des Plandokuments.

**Danach:** das GO.

Der Abschnitt `## Abhängigkeiten` enthält `Keine.` oder Verweise `Issue #N`. Jede lokale `#N` im Abschnitt zählt als Abhängigkeit, auch in Erläuterungen; nur Verweise `owner/repo#N` zählen nicht. Eine Verweiszeile beginnt mit `Issue #N` und trägt keine weitere Nummer. Beim Schreiben melden `issue check-form`, `issue create` und `issue update` jede Nummer aus Text und jeden Verweis auf ein Dokument unter `hinweise`; ein Dokument ist kein Arbeitspaket. Probelauf und Rückstell-Kommentar nennen je Abhängigkeit ihre Herkunft. Halten sich Pakete gegenseitig fest, steht dort `Kreis: #A -> #B -> #A`, und ein Paket dahinter wartet auf einen Kreis.

**GO (Schritt 4, Mensch):** Du ziehst die Pakete, die in diesen Durchlauf kommen, am Board nach Ready. Die KI zieht nie selbst nach Ready, außer in der Nacht-Kette unter Variante B, für die du das GO vorab an der Karte gegeben hast.

### /implement-ready

**Wofür:** Schritt 5. Der Skill arbeitet die Ready-Spalte von oben nach unten ab. Je Issue: nach In progress ziehen, vollständig lesen, testgetrieben umsetzen, die betroffenen Prüfungen vor dem Commit mit `node .claude/kit/checks.mjs run` laufen lassen, lokal committen, mit Abschlussbericht nach In review ziehen. Er pusht nie und zieht nichts aus dem Backlog. Nach dem letzten Paket eines Plans beginnt die Schlussmeldung mit `## Stand des Vorhabens`: was ein Nutzer jetzt sieht und was fehlt.

**Wann:** nach dem GO.

**Danach:** `/local-check`.

### /implement-next

**Wofür:** genau ein Ready-Issue umsetzen, die betroffenen Prüfungen vor dem Commit laufen lassen, lokal committen, nach In review ziehen und enden. Ohne Argument nimmt der Skill das oberste Ready-Issue. `/implement-next #N` ist ein verbindlicher Auftrag: Liegt `#N` nicht in Ready, endet der Lauf ohne Ersatz.

**Wann:** wenn du genau ein Paket umsetzen willst. Im Nachtbetrieb startet der Runner je Paket eine frische Session mit diesem Skill.

**Danach:** das nächste Paket oder `/local-check`.

### /implement-test

**Wofür:** der erste Teil von Schritt 5 in zwei Hälften. Der Skill nimmt das nächste Ready-Issue, zieht es nach In progress und schreibt nur die Tests, die rot laufen. Kein Produktionscode, kein Commit. Liegt schon ein Issue in In progress, verweist er auf `/implement-done`.

**Wann:** wenn du den Übergang von Rot nach Grün selbst sehen willst.

**Danach:** `/implement-done`.

### /implement-done

**Wofür:** der zweite Teil. Der Skill findet das Issue in In progress, implementiert gegen die roten Tests, bis sie grün sind, lässt die betroffenen Prüfungen vor dem Commit laufen und committet Tests und Code gemeinsam. Format und Grenzen sind die von `/implement-ready`.

**Wann:** nach `/implement-test`.

**Danach:** `/local-check`.

### /local-check

**Wofür:** Schritt 6. Der Skill ruft `node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"` auf. Das Kommando wählt die betroffenen `buildChecks` aus und misst alles seit dem letzten Push. Danach läuft `mutationCommand`, sofern gesetzt. Gefahren wird die Paketstufe; Prüfungen der Stufe `push` oder `merge` stehen als Auslassung mit Grund in der Checkliste. Bei Frontend-Änderungen erinnert der Skill an die Prüfung im Browser. Ein roter Check hält den Prozess an.

**Wann:** nach der Umsetzung, vor dem Review.

**Danach:** `/kit-review`.

### /kit-review

**Wofür:** Schritt 7. Ein Reviewer ohne den Kontext der Umsetzung liest den Code als Fremder. Je nach `reviewScope` liest er den Diff oder das ganze Repo, als Agent `kit-pruefer` im Modell aus `reviewModel` oder als CLI aus `reviewCommand`. Die Befunde landen als Kommentar am Issue. Scheitert der Aufruf, bricht der Skill sichtbar ab.

**Wann:** nach `/local-check`.

**Danach:** Befunde einarbeiten (zurück zu Schritt 5) oder `push main`.

### /push-main

**Wofür:** Schritt 8. Der Skill pusht den Commit-Batch auf main. Er reagiert nur auf die getippte Trigger-Phrase `push main`, und jeder Batch braucht eine eigene Freigabe. Er fährt `checks.mjs run --stage push` mit `--retry`, also jede Prüfung bis zur Stufe `push` ohne Auswahl nach Bereichen; wackelt eine, fragt er vor dem Commit nach. Erzeugungsschritte aus der `RELEASING.md` des Projekts, etwa Versionsbump und Changelog, fährt er vor dem Prüflauf; Vor- und Nach-Push-Schritte daraus um den Push herum.

**Vorbereitet in der Nacht.** Eine Nacht-Kette mit dem Ziel `goal:push-prepared` startet `/push-main prepare`. Diese Session pusht nicht: Sie fährt in einem eigenen Worktree die Erzeugungsschritte, den vollen Prüflauf der Stufe `push` und den Commit. Das Ergebnis `gruen`, `gruen-offen` oder `rot` liegt in `.claude/push-vorbereitung.json`. Tippst du morgens `push main` und hat sich seither nichts geändert, übernimmt der Skill den Stand mit der Zeile `Übernimmt den Stand der Nacht vom <zeitpunkt> (<commit>)` und prüft nicht erneut. Fährt das Projekt den vollen Lauf im Build-Dienst, bleibt in der Nacht der offene Punkt `voller Lauf im Build-Dienst (Prüfzweig <zweig>)`; morgens pusht der Skill den Commit auf den Prüfzweig, wartet auf den Build-Dienst und pusht main nur bei Grün.

**Notfallweg.** Fällt der Build-Dienst aus, pusht `/push-main emergency` nach einem vollen grünen Lauf auf dem eigenen Rechner trotz geschütztem main, nur interaktiv.

**Wann:** nach dem Review, auf dein Kommando.

**Danach:** den Test-Server im Browser prüfen.

### /merge-production

**Wofür:** Schritt 9. Der Skill erstellt einen Pull Request (GitHub) oder Merge Request (GitLab) von main nach production; mergen tust du selbst. Er reagiert nur auf die Trigger-Phrase `merge production` und hält an, wenn dein lokales main Commits trägt, die noch nicht gepusht sind.

Vor dem PR steht ein CI-Gate: `node .claude/kit/board.mjs code ci-status --commit <sha>` fragt den Zustand der CI für den Stand auf `origin/main` ab, vor Versionsbump und Release-Commit. Ist sie rot, entsteht kein PR, und der Skill nennt die roten Jobs. Läuft sie noch, fragt er einmal nach. Der Grund: Die lokalen `buildChecks` messen nicht, was die CI misst, etwa eine andere Laufzeitumgebung oder einen frischen Checkout. Danach fährt der Skill mit `checks.mjs run --stage merge` die Freigabestufe, also nur, was beim Push noch nicht geprüft wurde.

Einen Git-Tag setzt der Skill nicht. Er gibt am Ende die fertige Kommandozeile mit dem Hash des Versions-Commits aus:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

**Wann:** nachdem du den Test-Server geprüft hast, auf dein Kommando.

**Danach:** PR mergen, Tag setzen, die Karten nach Done ziehen.

### /retro

**Wofür:** eine KI-Retrospektive über die Zusammenarbeit. Der Skill fragt, wo es gehakt hat, was im Memory veraltet ist und welche Regel geschärft werden muss, und nennt die Kennzahlen des Prozesses. Das Ergebnis sind Änderungen an Konventionsdateien und Memory.

**Wann:** alle ein bis zwei Wochen.

**Danach:** weiter im normalen Ablauf.

### /document

**Wofür:** Der Skill schreibt einen Tageslog mit dem, was entschieden und umgesetzt wurde, und aktualisiert die Projektnotiz. Mit Vault landet der Eintrag in `{vault}/Log/YYYY-MM-DD.md`, ohne Vault in `docs/session-log/`.

**Wann:** am Ende jeder Session.

**Danach:** die nächste Session beginnt mit `/session-start`.

## Ein vollständiger Durchlauf

| Schritt | Was du tust | Was du danach siehst |
|---------|-------------|----------------------|
| Fachplan | `/requirement` mit der Anforderung | ein `[Requirement]` im Backlog |
| Review | `/issue-review #N` | Befunde als Kommentar, eingearbeitet; Label `review:done` |
| Groom | `/groom #N`, Frage für Frage | Antworten im Body, unter den offenen Fragen „Keine“ |
| Plan | `/techplan #N`, lesen, freigeben | ein `[Plan]` im Backlog |
| Pakete | `/issue-review #N` am Plan, dann `/issues #N` | Arbeitspakete im Backlog, je mit Rückverweisen |
| GO | Pakete am Board nach Ready ziehen | die Pakete in Ready, in deiner Reihenfolge |
| Umsetzung | `/implement-ready` | lokale Commits, Pakete in In review, je ein Abschlussbericht |
| Lokale Prüfung | `/local-check` | eine Checkliste, alles grün |
| Code-Review | `/kit-review` | Befunde des Reviewers als Kommentar |
| `push main` | die Trigger-Phrase tippen | main auf dem Remote aktuell, Test-Server zieht nach |
| Test-Server | Golden Path und Randfälle im Browser | das Ergebnis läuft, oder du gehst zurück zu Schritt 5 |
| `merge production` | die Trigger-Phrase tippen | ein PR nach production und die Zeile für den Tag |
| Done | PR mergen, Karten nach Done ziehen | Fachplan, Plan und Pakete in Done |

Ohne PO beginnt der Durchlauf bei `/techplan`. Plan und Fachplan zieht das Kit nach In review, sobald alle Pakete dort sind; nach Done ziehst du sie.

## PO-Schleife: fachliche und technische Issues

Ein Product Owner will die Anforderung fachlich abnehmen, bevor Technik entsteht. Dafür trennt das Kit zwei Sorten Issue:

- **Fachliche Issues** (`[Requirement]`, angelegt mit [/requirement](#requirement)) beschreiben das Was und Warum. Sie werden am Board gegroomt, die Antworten stehen im Body, nicht in Kommentaren. Implementiert werden sie nie.
- **Technische Issues** entstehen erst nach der fachlichen Freigabe: `/techplan #N` liest das fachliche Issue mit seinem vollständigen Body, `/issues` schneidet daraus die Pakete.

Der Ablauf: `/requirement`, `/issue-review #N`, `/groom #N`, `/techplan #N`, `/issues #N`, danach GO und Umsetzung. Ohne PO beginnst du bei `/techplan`.

**Die Regeln dahinter:**

- **Zwei Rückverweise im Kontext-Abschnitt.** Jedes Arbeitspaket trägt untereinander:

  ```
  Plan: Issue #M
  Fachliche Quelle: Issue #N
  ```

  Die `Plan:`-Zeile nennt den Fundort des Plans, `Plan-Modell:` im Plan seinen Urheber. Beide Zeilen stehen nie in den Abhängigkeiten: Der Nacht-Runner läse sie als unerfüllte Abhängigkeit, und weil Plan und Fachplan erst nach ihren Paketen fertig sind, blieben die Pakete dauerhaft zurückgestellt.
- **Vier Sorten Karte gehen nie in die Umsetzung.** Fachliche Issues (`[Requirement]`), Ideen (`[Idea]`), Plandokumente (`[Plan]`) und Menschenschritte (`[Human]`) stellen `/implement-ready`, `/implement-next` und der Nacht-Runner kommentiert ins Backlog zurück, ohne eine Session zu starten. Ein Menschenschritt ist ein Arbeitspaket, dessen Aufgabe außerhalb des Repositories liegt, etwa eine Einstellung, ein Konto, ein Zugang oder eine Freigabe; sein Kommentar sagt, dass die Karte wartet und nicht gescheitert ist.
- **Lebenszyklus:** Fachliche Issues und Plandokumente zieht der Mensch aus dem Backlog nur nach Done oder gar nicht. In review heißt für sie „alles gebaut, Review dran“, und diese Spalte setzt das Kit: Sobald alle Pakete eines Plans in In review oder Done liegen, zieht es Plandokument und fachliche Anforderung dorthin. Die Nacht-Kette (`night.mjs --chain`) liest nur die Backlog-Spalte und legt Plan und Pakete dort ab. Wer ein fachliches Issue vor seiner Kette aus dem Backlog zieht, nimmt es dem Nachtlauf weg: Es ist dann kein Kandidat mehr, ohne dass etwas fehlschlägt. Der Ausweg ist der interaktive Weg mit Nummer, `/techplan #N`, `/issue-review #N`, `/issues #M`; er arbeitet unabhängig von Spalte und Marker.

### Szenarien im Fachplan

Jeder Fachplan trägt zwischen `## Fachliche Akzeptanzkriterien` und `## Nicht-Ziele` einen Abschnitt `## Szenarien` mit mindestens einem Szenario. Ein Szenario hat eine Überschrift `### Szenario: <Titel>` und darunter Listenzeilen:

- `Angenommen` beschreibt die Ausgangslage,
- `Wenn` die Handlung,
- `Dann` das beobachtbare Ergebnis,
- `Und` setzt die Zeile davor fort.

Vollständig ist ein Szenario mit Titel und je mindestens einer Zeile `Angenommen`, `Wenn` und `Dann` in dieser Reihenfolge. In englischen Projekten heißen die Schlüsselwörter `Given`, `When`, `Then`, `And`. Nicht jedes Kriterium braucht ein Szenario. Ein Beispiel:

```markdown
## Szenarien

### Szenario: Fachplan ohne Szenarien wird abgewiesen
- Angenommen ein Projekt hat den Stichtag szenarienAb gesetzt
- Und ein Fachplan hat fachliche Akzeptanzkriterien, aber keinen Abschnitt Szenarien
- Wenn er über das Kit angelegt wird
- Dann wird er nicht angelegt
- Und die Meldung sagt in einem Satz, was fehlt, und zeigt die Form eines Szenarios
```

`issue check-form` und `issue create` weisen einen Fachplan ab, dem der Abschnitt fehlt, dessen Abschnitt leer ist oder kein vollständiges Szenario trägt; die Meldung zeigt die Form eines Szenarios. Für Karten am Board gilt die Pflicht ab dem Stichtag [`szenarienAb`](/einstellungen); `node .claude/kit/board.mjs scenarios baseline` nennt den passenden Wert. Ohne Szenarien entsteht kein technischer Plan; `/groom` ergänzt sie.

## Mitteilungen: glauben statt nachsehen

Sagst du der Session etwas über einen Sachverhalt, etwa was gerade läuft, ist das eine Mitteilung und kein Auftrag. Die Session übernimmt sie ungeprüft und prüft sie mit keinem Werkzeug nach. Sie antwortet in einer festen Form, die Reichweite und Folge nennt:

```
Mitteilung übernommen, ungeprüft — gilt, bis du Entwarnung gibst. Folge: Ich starte keinen zweiten Nachtlauf.
```

So ist eine falsche Einordnung sofort sichtbar. Eine Mitteilung ersetzt keinen Pflichtcheck, und eine zitierte Trigger-Phrase löst keinen Push aus. Nachts gibt es keine Mitteilungen. Der verbindliche Wortlaut steht in `CLAUDE-workflow.md`, Abschnitt „Mitteilungen des Menschen“.
