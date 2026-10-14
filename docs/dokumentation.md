# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus achtzehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Schritt 1 ist deine Anforderung; die KI übernimmt die Schritte 2, 3, 5, 6 und 7. Die drei menschlichen Stop-Punkte sind Schritt 4 (GO), Schritt 8 (Push) und Schritt 9 (Merge); zwischen Push und Merge prüfst du den Test-Server. Elf weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /session-start, /triage, /requirement, /groom, /issue-review, /task, /implement-test und /implement-done, /implement-next, /retro und /document.

## Voraussetzungen

**Node.js 18 oder neuer.** Der Installer ist in Node geschrieben und läuft damit auf macOS, Linux und Windows über WSL2 ohne Abhängigkeit zu einem bestimmten Shell-Ökosystem.

**Windows: WSL2.** Das Kit läuft auf macOS, Linux und Windows über WSL2 im selben Umfang. Unter Windows arbeitet es in WSL2; wie du es einrichtest, steht in der Anleitung [Windows über WSL2](/wsl2).

**git.** Claude Code und der gesamte Prozess setzen git voraus. Ohne git-Repository funktioniert kein Skill.

**Claude Code in einer aktuellen Version.** Die Skills nutzen das Skills-System von Claude Code. Ältere Versionen kennen dieses System möglicherweise nicht.

**Ein Board-Adapter — und die passende CLI dazu.** Alle Issue- und Board-Operationen laufen über `.claude/kit/board.mjs`, den Board-Adapter. Der Adapter schirmt die Skills von der konkreten Plattform ab. Was du brauchst, hängt vom gewählten Issue-Tracker ab:

| Issue-Tracker | Voraussetzung |
|---------------|---------------|
| `github` | `gh` (GitHub CLI), einmalig `gh auth login` |
| `gitlab` | `glab` (GitLab CLI), einmalig `glab auth login` |
| `local` | Nichts — Issues liegen als Dateien in `issues/` |

**Ein Projekt-Board, falls du GitHub oder GitLab als Issue-Tracker nutzt.** Das Board braucht diese fünf Spalten: Backlog, Ready, In progress, In review, Done. Bei GitHub sind das Projekt-Board-Spalten (GitHub Projects), bei GitLab werden sie durch Labels abgebildet. Im lokalen Modus gibt es kein Board — der Adapter schreibt und liest YAML-Frontmatter-Dateien direkt.

**`kontext.config.json` für /session-start und /document (optional).** Beide Skills laufen auch ohne diese Datei im Degraded Mode. Wenn du persistentes projektübergreifendes Memory willst: Bei globaler Installation fragt der Installer nach dem Vault-Pfad und legt die Datei automatisch an, bei projektlokaler Installation legst du sie manuell an. Details im Abschnitt [kontext.config.json](/einstellungen#kontext-config-json).

## Die drei menschlichen Stop-Punkte

**Schritt 4: das GO.** Du entscheidest, welche Issues in diesen Batch kommen. Darin liegt die Planung: wie viel Arbeit auf einmal, welche Priorität, welche Abhängigkeiten. Das GO hat zwei Körnungen: Unter **Variante A** ziehst du jedes Arbeitspaket einzeln nach Ready. Unter **Variante B** kennzeichnest du stattdessen vorab die Karte, die die Kette startet — die fachliche Anforderung oder das Plandokument —, mit dem Label aus `night.kette.varianteBLabel` (siehe [Zweiter Modus](#zweiter-modus-die-nacht-kette)) — das GO gilt dann im Voraus für alle Arbeitspakete, die die Nacht-Kette daraus schneidet; die Kette zieht sie selbst nach Ready und setzt sie in derselben Nacht um.

**Schritt 8: der Push.** Du veränderst den Test-Server. Jeder Batch braucht eine eigene Freigabe, weil zwischen Commit und Push die letzte Chance liegt, den Scope zu überdenken. Unter Variante B ist der Push zugleich der Moment, in dem du die Arbeit der Nacht samt ihrer Entscheidungen annimmst oder verwirfst: Der Nachtbericht am Fachplan listet, was die Kette entschieden hat, und bis zum Push ist keine dieser Entscheidungen verbindlich.

**Schritt 9: der Merge.** Du bringst Code nach production. Du hast auf dem Test-Server geprüft, du trägst die Verantwortung, du mergst.

Das Kit automatisiert diese drei nicht. Das ist kein fehlendes Feature. Es ist der Sinn des Kits: KI macht die Arbeit, Menschen treffen die Entscheidungen.

## Drei Bahnen

Nicht jede Aufgabe braucht den vollen 9-Schritt-Prozess. Das Kit unterscheidet drei Bahnen:

**Bahn 1 — Kleine Änderung.** Genau eine Datei, ein Asset oder ein Config-Wert; keine Datenbank-Migration; kein neuer oder geänderter Endpoint; kein Datenmodell; höchstens ein Modul betroffen; keine sicherheitsrelevante Logik. Direkt umsetzen, ein Commit, kein Push ohne Trigger-Phrase — kein Plan, kein Issue, kein GO. Auch dieser Commit setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus: Das Commit-Gate ist mechanisch und kennt keine Bahn.

**Bahn 2 — Feature.** Außerhalb von Bahn 1, sobald es etwas abzuwägen gibt — oder unklar ist, ob es etwas abzuwägen gibt. Voller Prozess: `/techplan` → `/issues` → GO → `/implement-ready`. Typisch: ein Datenmodell mit mehreren vertretbaren Schnitten, ein Endpoint, dessen Vertrag noch offen ist, eine Migration mit Rückweg-Frage.

**Bahn 3 — `[Task]`.** Oberhalb der Kleinigkeit, aber ohne Abwägungsbedarf. Kein Fachkonzept, kein Plan, keine Zerlegung: ein einzelnes Arbeitspaket mit dem Titel-Präfix `[Task]`, angelegt mit [/task](/prozess#task) nach deiner Bestätigung des Wegs — danach geprüft und freigegeben wie jedes andere Paket. Typisch: eine Umbenennung über mehrere Dateien, ein abgelehnter Werkzeug-Befund, eine mechanische Nachzieharbeit.

**Die Auswahlregel, in dieser Reihenfolge:**

1. Trifft die zählende Bahn-1-Regel zu **und gibt es nichts abzuwägen**, gilt Bahn 1.
2. Sonst entscheidet der Abwägungsbedarf: Abzuwägen gibt es etwas, wenn **mehrere vertretbare Wege** offenstehen. Eine Feststellung mit genau einem richtigen Ausgang ist keine Abwägung. Mit Abwägungsbedarf gilt Bahn 2, ohne ihn Bahn 3.
3. Ist **unklar**, ob es etwas abzuwägen gibt, gilt Bahn 2.

Der Umfang allein entscheidet damit nicht mehr, und das ist die eigentliche Änderung gegenüber früher: Eine Änderung an zwölf Dateien ohne Abwägung ist Bahn 3; eine Architekturänderung an einer einzigen Datei, bei der mehrere Schnitte vertretbar sind, ist Bahn 2. Die alte Fassung von Bahn 2 zählte dagegen Merkmale — Datenmodell, Endpoint, Migration, Sicherheit, mehr als ein Modul — und schickte damit auch das Eindeutige durch den vollen Prozess.

Im Zweifel gilt Bahn 2; das deckt auch den unklaren Abwägungsbedarf. Vor jeder neuen Aufgabe benennt die KI die Bahn laut ("Das ist Bahn 1/2/3, ich …") — Beispiele: ein Icon- oder Favicon-Tausch, eine Textkorrektur oder ein Config-Default sind Bahn 1; eine Umbenennung über mehrere Dateien ohne Abwägung ist Bahn 3; eine neue Tabelle, ein neuer Endpoint oder ein neues UI-Feature sind Bahn 2.

**Ein Sonderfall, der es wert ist, genannt zu werden: die Ablehnung als gültiges Ergebnis.** Ein Werkzeug meldet einen Befund, der Befund ist vertretbar abgelehnt — auch das ist Arbeit, und es ist typische Bahn-3-Arbeit. Damit die Ablehnung hält, ist das Akzeptanzkriterium eines solchen `[Task]` die **versionierte Unterdrückungsregel**, die das Werkzeug selbst auswertet, mit der Begründung unmittelbar daneben: Das Werkzeug liest die Regel, die Begründung richtet sich an Menschen und spätere Sitzungen. Im Kit steht das Muster in `sonar-project.properties` — der Ausschluss der Regel `javascript:S4036` als versionierte Zeile, darüber ausgeschrieben, warum er vertretbar ist. Eine im Web-UI von Hand als „accepted" markierte Ablehnung hält dagegen nicht: Der nächste gleichartige Fund entsteht außerhalb. Verifiziert wird ein solcher Task durch einen erneuten Lauf desselben Werkzeugs — der abgelehnte Befund bleibt aus, **und ein unabhängiger Kontrollbefund wird weiterhin gemeldet**; ohne ihn ist ein stummes Werkzeug von einem wirksamen Ausschluss nicht zu unterscheiden. Fehlt einem Werkzeug ein versionierbarer Weg, gehört dessen Entwicklung in ein eigenes Vorhaben, und ein werkzeugübergreifendes Register entsteht nicht — es wäre eine zweite Liste neben den Regeldateien, die keines der Werkzeuge liest.

## Nachtbetrieb

Der Nachtbetrieb kennt **zwei Betriebsarten**: die **Umsetzungsnacht**, die dieser Abschnitt beschreibt, und die **Nacht-Kette** (siehe [Zweiter Modus](#zweiter-modus-die-nacht-kette)), die aus einem Fachplan den geprüften Plan und die Arbeitspakete macht, ohne zu bauen. Beides ist die Nacht; der [Prüflauf](/prozess#der-pruflauf), der fachliche Anforderungen prüfen lässt, gehört dem Tag und steht auf der Prozessseite. Die Umsetzungsnacht arbeitet die Ready-Spalte unbeaufsichtigt ab — mit einer **frischen Session pro Issue**, damit über viele Issues kein Kontext akkumuliert und die Qualität nicht schleichend sinkt. Der Nacht-Runner (`.claude/kit/night.mjs`, kommt mit dem Installer) startet pro Issue eine Headless-Session mit `/implement-next #N` — das Issue wird der Session **verbindlich übergeben**, sie wählt es nicht selbst — wartet auf ihr Ende und prüft den Erfolg ausschließlich am Board: Issue in In review = Erfolg. Gepusht wird nachts **nie** — die drei Stop-Punkte bleiben unverändert menschlich.

**Abend-Ritual (das GO):** Issues nach Ready ziehen und per Drag&Drop in die gewünschte Reihenfolge bringen — der Runner arbeitet die Spalte von oben nach unten ab. Abhängigkeiten müssen als `Issue #N` im Abhängigkeiten-Abschnitt stehen (siehe Issue-Format): Der Runner stellt Issues mit unerfüllten `#N`-Referenzen automatisch zurück. Vier Sorten Karte überspringt er mechanisch — kommentiert zurück ins Backlog, ohne eine Session zu starten: fachliche Issues (`[Requirement]`-Titel, [PO-Schleife](/prozess#po-schleife-fachliche-und-technische-issues)), **Ideen** (`[Idea]`-Titel), **Plandokumente** (`[Plan]`-Titel) und **Menschenschritte** (`[Human]`-Titel). Eine rohe Idee ist kein implementierbares Issue — sie geht mit Abwägung über `/requirement #N`, ohne Abwägung über `/task #N`; ein Plandokument beschreibt einen Weg und wird erst per `/issues` in Arbeitspakete zerlegt. Ohne das Gate würde eine Session sie zwar korrekt ablehnen, aber der Runner kann diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist verbrannt und der Kommentar am Board irreführend. Beim Plandokument wäre es schlimmer: Es trüge keinen Ablehnungsgrund in sich und würde umgesetzt, und das sähe am Board wie ein Erfolg aus. Ein **Menschenschritt** ist dagegen ein Arbeitspaket, aber seine Aufgabe liegt außerhalb des Repositories — eine Einstellung in einer Weboberfläche, ein Konto, ein Zugang, eine Freigabe —, und kein Zug einer Sitzung erledigt sie. Sein Kommentar sagt ausdrücklich, dass die Karte **wartet** und nicht gescheitert ist: Ohne das Gate wertete der Runner die richtige Untätigkeit der Session als Fehlschlag, und die Karte sähe im Backlog aus wie ein gescheitertes Paket (belegter Fall: kanban-kit #1256). Nach seiner Handlung zieht der Mensch sie selbst weiter. Zurückgestellt wird außerdem jede Karte, deren Aufgabe oder Akzeptanzkriterium eine **geschützte Datei** nennt und die der Mensch nicht freigegeben hat, ebenso eine Karte mit dem Label `kit:protected` — mehr dazu unter [Der Halt an einer geschützten Datei](#der-halt-an-einer-geschützten-datei).

**Warum eine Karte am Abhängigkeits-Gate wartet.** Der Rückstell-Kommentar bleibt der eine Satz `Nachtlauf: Abhaengigkeit #N nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.` Darunter steht, durch eine Leerzeile getrennt, der Block `Abhaengigkeiten, wie der Nachtlauf sie liest:` mit einer Zeile je Abhängigkeit: Nummer und Titel, erfüllt oder unerfüllt, die Herkunft (aus einer Verweiszeile oder aus erläuterndem Text) samt Textstelle und bei einem Dokument der Dokument-Hinweis. Danach folgen die Kreise als `Kreis: #A -> #B -> #A`, mit dem Zusatz „dieses Paket wartet auf einen Kreis“, wenn das Paket nur daran hängt. Das Protokoll nennt jeden Kreis in einer zweiten Logzeile; Logzeile, Ergebnisstand und Kettenbericht behalten sonst den einzeiligen Satz. Der Probelauf (`--dry-run`) zeigt dieselben Zeilen eingerückt unter der Zeile jedes Pakets mit mindestens einer Abhängigkeit, auch bei Paketen, die eine Session bekämen; die erste Zeile des Pakets bleibt unverändert. So erkennst du eine versehentliche Abhängigkeit, ohne das Paket zu öffnen. Die Konvention dazu steht unter [/issues](/prozess#issues).

**Fester Kit-Stand.** Jeder unbeaufsichtigte Lauf — Umsetzungsnacht, Kette, Prüflauf — bindet sich beim Start an den Commit, auf den `origin/<mainBranch>` zeigt — den letzten Push, gelesen ohne `git fetch`. Fest sind damit die Werkzeuge einschließlich der Prüfung vor jedem Commit, die Skills und die Regeltexte; was ein Paket derselben Nacht daran ändert, wirkt erst nach `push main`. Prüfgegenstand bleiben die Konfiguration des Projekts und seine Tests, sie kommen aus dem Stand des jeweiligen Pakets. Der Stand steht als Zeile `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` im Laufbericht (`kitStand` in `.claude/night-run-*.json`), im Nachtbericht und an jedem Kommentar des Laufs. Nach einem Lauf in der Hauptkopie bleibt deren installierte Kopie auf dem Stand, bis `node tools/sync-blobs.mjs` sie auf die Arbeitskopie bringt; `sync-blobs --check` nennt sie bis dahin als veraltet. Im Kit-Repo holt `push main` das selbst nach: Nach dem Nachziehen der Hauptkopie fährt es den Nach-Push-Schritt aus `RELEASING.md`, `node tools/sync-blobs.mjs`, und die installierte Kopie steht auf dem eben veröffentlichten Stand (Issue #1523). Ein Rechner, der den Stand nur per `git pull` holt, ruft `sync-blobs` weiter von Hand. Braucht ein Paket das geänderte Werkzeug, den Skill oder den Regeltext eines anderen Pakets als Werkzeug, trägt seine Verweiszeile den Zusatz `Issue #N (wartet auf Push)`. Die Kette zieht ein solches Paket auch unter Variante B nicht nach Ready: Es bleibt wartend im Backlog und steht im Nachtbericht als nicht begonnen mit dem Grund „wartet auf einen Push (Issue #N)“.

**Start:**

```bash
node .claude/kit/night.mjs --dry-run   # zeigt, was laufen würde — startet nichts
node .claude/kit/night.mjs             # echter Lauf
```

Flags: `--max <N>` (Session-Limit pro Nacht, Default 10), `--model <id>` (Modell des Laufs; ohne Flag gilt `night.modell` aus der Config, sonst `claude-opus-5` — siehe „Woher das Modell einer Session kommt"), `--timeout-min <N>` (Zeitlimit pro Runde, Default 60), `--dry-run`, `--no-checks-ok` (Start, ohne dass eine Prüfung die Paketstufe trägt — der Runner verweigert sonst, denn nachts ohne Gate zu implementieren ist riskant; eine Liste aus lauter `push`- und `merge`-Prüfungen ist für die Umsetzung dasselbe wie eine leere), `--yolo` (siehe Permissions), `--label <name>` (Routing-Label, Default `kit:nightrun`; `none` schaltet den Filter ab), `--verbose no` (schaltet das Live-Verlaufsprotokoll ab, das sonst an ist; `--verbose yes` schaltet es ausdrücklich an, `--verbose` ohne Wert ist der Vorgabewert und damit wirkungslos), `--help`. Dazu das Config-Feld `formatFixCommand` (siehe unten) — kein Flag, weil es projektspezifisch ist.

**Routing-Label — welche Ready-Issues der Nachtlauf bearbeitet.** Standardmäßig verarbeitet der Runner aus Ready nur Issues mit dem Label `kit:nightrun`; alle anderen bleiben unangetastet liegen (kein Verschieben, kein Kommentar). So markierst du auf **einem** Board gezielt die Teilmenge für den Nachtlauf und behältst den Rest für interaktive Arbeit — ohne ein zweites Board mit eigenem Token, das `Issue #N`-Abhängigkeiten zwischen den Boards unauflösbar machen würde. Das Label ist per `--label <name>` überschreibbar; `--label none` schaltet den Filter ganz ab (dann kommt wie früher strikt das oberste Ready-Issue dran). Ein `--dry-run` weist ungelabelte Issues sichtbar als „übersprungen" aus. Bei **GitLab** sind Labels bereits der Status-Mechanismus — wähle dort einen Routing-Label-Namen, der mit keinem Status-Label kollidiert (der Default `kit:nightrun` mit Namespace-Präfix tut das). **Tragweite:** Wer `night.mjs` bisher ohne Labels nutzte, muss seine Nacht-Issues jetzt mit `kit:nightrun` versehen oder `--label none` setzen — sonst findet der Lauf nichts.

**Das Live-Verlaufsprotokoll ist der Normalfall und braucht kein Flag.** Der Runner liest den `stream-json`-Output der Session live mit und schreibt kompakte Ereigniszeilen ins Nacht-Log und auf die Konsole — Tool-Aufrufe und Text-Snippets, jeweils mit der Issue-Nummer:

```
[18:24:10]   #401 > Bash: mvn -q verify
[18:25:02]   #401 > Edit: src/main/java/.../ProjectIdeaEventService.java
[18:26:11]   #401 > Claude: Tests grün, ich committe jetzt.
```

Die finale Abschlussnachricht landet wie gehabt zusätzlich im Log; das Streaming ergänzt sie, ersetzt sie nicht. Abgeschaltet wird es ausdrücklich mit `--verbose no` — dann protokolliert der Runner pro Runde nur Start und Ende, und bei einer langen Session sieht man nicht, woran sie gerade arbeitet (`claude -p` gibt erst am Schluss seine Abschlussnachricht aus). Das Flag zu vergessen kostete das Verlaufsprotokoll früher genau in der Nacht, in der man es braucht; deshalb ist die Vorbelegung seit Issue #867 umgedreht. Ein bloßes `--verbose` bleibt zulässig und wirkungslos, damit bestehende Aufrufe und Skripte unverändert weiterlaufen.

**Der Ergebnisstand — die Nacht als JSON.** Jeder Lauf legt neben dem Textprotokoll (`.claude/night-run-<datum>.log`) einen maschinenlesbaren Ergebnisstand unter `.claude/night-run-<datum>-<uhrzeit>.json` ab: je Arbeitspaket eine Einheit mit Ausgang, Dauer, Commit und den Kennzahlen der Session (Kosten, API-Dauer, Züge), dazu der Abschluss des ganzen Laufs (`regulaer` oder `harterStopp`, im Stoppfall mit Fehlerklasse und Grund). Als Ausgang einer Einheit kommen vor: `erfolg`, `zurueckgestellt`, `angehalten` (siehe unten), `uebersprungen`, `liegengeblieben`, `abgebrochen` (ein Paket ohne Ergebnis, dessen Reste im Stash liegen, siehe „Wenn etwas schiefgeht“) und `harterStopp`. Die Datei wird nach jeder Runde vollständig neu geschrieben, ein abgebrochener Lauf hinterlässt also den Stand bis zum Abbruch. **Verbrauch:** Die Kennzahlen jeder Session tragen neben Kosten, API-Dauer und Zügen die vier Token-Mengen aus der CLI — `eingabeTokens`, `ausgabeTokens`, `cacheErzeugtTokens`, `cacheGelesenTokens`. Jede Einheit summiert sie als `verbrauch` über alle ihre Sessions (auch Salvage und Ketten-Stufen) und nennt ihre Lauf-Art als `art`; der Lauf-Kopf führt `verbrauch` über alle Sessions des Laufs, einschließlich des Vorflugs, und `verbrauchOhneEinheit` als den Teil, der zu keiner Karte gehört. Ein Feld, zu dem nie eine Menge kam, bleibt `null` — eine 0 behauptete, es sei nichts verbraucht worden. **Prüfläufe:** Neben `zeiten` trägt jede Einheit `prueflaeufe` mit dem Block `arbeit` — was die Session während ihrer Arbeit an Prüfläufen gestartet hat: `anzahl` alle (ein Bash-Aufruf, dessen erstes Programm das einer konfigurierten Prüfgruppe ist), `volle` davon die, die wörtlich einem Prüfgruppen-Kommando entsprachen, `volleNoetig` die sanktionierten Gruppenläufe über `checks.mjs run --area <name>`, und `dauerMs` die Summe ihrer Spannen. Mehrere Sessions einer Karte addieren sich wie die Zeiten. Der Abschlussversuch — `checks.mjs run` ohne `--area` — steht bewusst **nicht** in `anzahl`, sonst zählte er doppelt: Er hat seinen eigenen Block `abschluss` neben `arbeit`, mit `anzahl` und `dauerMs`. Ein übernommener Lauf (`Ergebnis uebernommen`, weil der Stand unverändert ist) zählt dort als Versuch **ohne** Dauer — `checks.mjs` reicht die Werte des früheren Laufs weiter, eine Spanne dieses Aufrufs wäre geerbt und nicht gemessen. Eine Session ohne angeforderten Strom (Kommando-Stufe mit fremdem Programm) trägt nichts bei; hat keine Session der Karte gemessen, fehlt das Feld ganz — „nicht gemessen" ist etwas anderes als „keiner". Gespeichert wird allein die Messung: Was daraus folgt — Läufe je Abschluss, Anteil an der Laufzeit, Abstand zur Zielmarke `night.zielUmsetzungMin` — rechnet der Bericht. **Auskünfte:** Die beiden letzten Felder, mit denen eine Einheit angelegt wird, sind `umsetzung` und `auskunft`. `umsetzung` ist `true`, sobald eine Session der Einheit mit `/implement-next`, `/implement-ready`, `/implement-test` oder `/implement-done` startete; Ketten-Stufen, Kartenanlage und Prüfläufe bleiben `false`, entschieden am Start der Session und nicht an der Lauf-Art. `auskunft` ist `{ ms, aufrufe }`: die Zeit, die auf Rückfragen ans Board ging und darauf, ihre Antworten aufzubereiten. Gemessen wird die Spanne vom Werkzeugaufruf bis zu seinem Ergebnis. Nachdenkzeit zählt nicht. Als Rückfrage zählen `board.mjs issue get|list|epics|activity|auftrag`, `board.mjs context`, `gh`/`glab issue view|list` und `gh api …/issues…`. Als Aufbereitung zählt eine solche Rückfrage mit Pipe an `jq`, `node -e` oder `python`, außerdem jeder Aufruf, der einen von Claude Code ausgelagerten Ergebnispfad (`tool-results/`) nennt. Schreibende Aufrufe wie `issue move`, `issue comment` und `issue report` zählen nicht. Mehrere Sessions einer Karte addieren sich. `null` heißt „nicht gemessen“: keine Session, oder eine Kommando-Stufe ohne Strom. Eine beobachtete Session ohne Auskunft trägt dagegen `{ ms: 0, aufrufe: 0 }`. `complete` steht in der Datei auf `false`, solange der Lauf läuft, und wird nur am regulären Ende `true` — ein harter Stopp lässt es dort auf `false` stehen (die Meldung ans Board sagt darüber etwas anderes, siehe den Absatz „Einlieferung ans Board" weiter unten). Die Uhrzeit gehört in den Namen, weil das Textprotokoll eine Tagesdatei zum Anhängen ist, JSON aber nicht angehängt werden kann — der zweite Lauf eines Tages überschriebe sonst den ersten. **Der einzige Ausschluss ist `--dry-run`**: Ein Dry-Run arbeitet nichts ab und hat nichts zu berichten.

**Die Prüfläufe und die Zielmarke stehen in beiden Berichten.** Eine Messung nützt nur, wenn sie jemand liest, und die Nacht berichtet an zwei Orten: Die Umsetzungsnacht schreibt ihren Prüfbericht auf Konsole und ins Tagesprotokoll, die Kette hinterlässt ihren Nachtbericht als Kommentar an der gekennzeichneten Karte. Der Block `Prueflaeufe und Zielmarke:` steht an **beiden** Stellen — im Protokoll unter den Prüfungen der Sessions, im Nachtbericht unter `### Umsetzung` — und trägt je Paket eine Zeile mit der Rundendauer, der Zahl der Prüfläufe, davon `volle` und `Gruppenlaeufe`, und der Zahl der Abschlussversuche. Hat keine Session der Karte gemessen, sagt die Zeile `Prueflaeufe nicht gemessen` und nennt keine Null. Darunter die Summe: `- N von M Paketen unter <marke> Minuten.` — die Marke ist `night.zielUmsetzungMin`, ohne Feld gilt die Vorgabe 10. Gezählt werden nur die Einheiten, die eine Implementierungs-Runde durchlaufen haben; die Fachplan-Einheit der Kette und Pakete ohne Session bleiben draußen. Gerechnet wird mit der Rundendauer einschließlich aller Prüfungen und Korrekturen, und gerechnet wird im Bericht — eine zweite Ablage in der Datei wäre dieselbe Wahrheit an einem zweiten Ort. **Lücken in der Zuordnung** stehen daneben: Trug die Prüf-Zusammenfassung eines Pakets Dateien ohne Bereichsmuster (`ohneZuordnung`), nennt der Bericht **jede** davon mit Namen. Das färbt nichts rot — der Abschluss des Pakets bleibt unberührt, es ist ein Befund für den Morgen, dass ein Bereich ein Muster braucht.

**Weder die Datei noch die Kennzahlen hängen an einem Flag.** Der Runner fordert die ausführliche Session-Ausgabe (`stream-json`) in jedem unbeaufsichtigten Lauf an und kommt damit immer an Kosten, API-Dauer und Züge heran — auch bei `--verbose no`, das allein steuert, ob die Ereignisse zusätzlich auf Konsole und Tagesprotokoll erscheinen. Ein Feld `kennzahlenHinweis` gibt es deshalb seit Issue #668 nicht mehr. Früher hing die ganze Datei am Flag — das kostete die Auswertung in genau der Nacht, in der jemand es vergessen hatte, und das ist die Nacht, in der man sie braucht: **Der Grund eines Abbruchs wiegt mehr als die Kennzahlen eines glatten Laufs.** Zur Konsequenz gehört, dass auch ein Lauf, der schon am **Vorflug** scheitert — Crash-Rest in *In progress*, unsauberer Working Tree, leere `buildChecks`, Reviewer-Vorflug —, einen Ergebnisstand mit `abschluss: "harterStopp"` und Fehlerklasse hinterlässt, obwohl er kein einziges Paket abgearbeitet hat. Genau dort sucht man morgens den Grund.

**Der Grund eines harten Stopps steht als Text in der Datei.** Die Fehlerklasse sagt, *wo* es gerissen ist (`harterStopp`, `umgebung`, `tracker`, `zustand`) — der Grund sagt, *was* passiert ist, und zwar wörtlich mit dem Satz, der ohnehin ins Textprotokoll geht. Er steht an **genau einer Stelle**: am Feld `grund` der betroffenen Einheit, auf die der Lauf über `fehlerEinheit` verweist. Nur der Vorflug-Stopp kennt keine Karte — er läuft, bevor ein Kandidat gezogen ist —, und sein Grund steht deshalb am `fehlerText` des Laufs, `fehlerEinheit` bleibt dort leer. Bei einem unsauberen Arbeitsbaum nennt der Grund zusätzlich die liegengebliebenen Dateien; **ab dem elften Eintrag** wird auf die Anzahl und die ersten zehn gekürzt, in der Reihenfolge von `git status --porcelain`. Vorher musste man für genau diese Frage das Textprotokoll durchsuchen oder eine Sitzung dafür starten. Bleibt ein Grund wider Erwarten aus, trägt der Lauf den zuletzt gemerkten Stopptext samt einem Vermerk, dass die Übergabe gerissen ist, sonst einen Ersatztext mit der Bitte um Meldung — leer bleibt das Feld nie.

**Ein Lauf ohne Arbeit nennt seinen Grund.** Endet eine Nacht, ohne dass ein einziges Arbeitspaket an der Reihe war, trägt der Lauf-Kopf dafür das Feld `noWorkReason` — wörtlich mit dem Satz, der ohnehin ins Textprotokoll geht. Es gibt sechs benannte Fälle. In der **Umsetzungsnacht**: Ready ist leer (`Ready ist leer — nichts zu tun.`), keines der Ready-Issues trägt das Routing-Label (`Keine der <N> Karten in Ready traegt das Label '<name>' — nichts zu tun.`), alle Karten wurden am Gate zurückgestellt (`Alle <N> Karten in Ready wurden am Gate zurueckgestellt — …`) oder die Umsetzung ist durch einen anderen Lauf belegt (`Die Umsetzung ist belegt: <grund> — der Lauf endet ohne Paket.`). Bei `--chain`: keine Karte trägt das Kettenlabel (`Keine Kette zu fahren: keine Karte traegt das Label '<name>'.`) oder alle wurden übersprungen, weil eine Voraussetzung fehlt (`Keine Kette zu fahren: alle <N> gekennzeichneten Karten mit dem Label '<name>' wurden uebersprungen, …`). Jeder Satz führt Label und Zahl beziehungsweise den haltenden Prozess mit, damit der Morgen den Fall ohne Rückfrage erkennt und nicht erst das Textprotokoll daneben lesen muss.

**Der Rückstellungs-Satz hat Vorrang vor `Ready ist leer`.** Hat der Lauf Ready selbst geräumt, indem er jede Karte am Gate zurückgestellt hat, sagt er genau das — und behauptet nicht, Ready sei von vornherein leer gewesen. Und ein Lauf, der ohne Session endete, ohne dass einer der sechs Fälle zutraf, schweigt nicht, sondern trägt den Rückfall-Satz `Kein Grund ermittelbar — … bitte melden.`: Ein leeres Feld ließe offen, ob nichts zu sagen war oder eine Lage unbenannt blieb.

**Ein nicht schreibbarer Umsetzungs-Lock ist kein ruhiger Lauf.** Lässt sich die Lock-Datei nicht schreiben, ist das eine Störung der Umgebung: Der Lauf endet als harter Stopp der Fehlerklasse `umgebung`, der Grund steht am `fehlerText` des Laufs, und `noWorkReason` bleibt aus — ohne `noWorkReason` ist morgens auf einen Blick zu sehen, dass hier etwas gerissen ist. Ein bloß **belegter** Lock dagegen bleibt ein ruhiger Lauf mit Grund (`Die Umsetzung ist belegt: …`). Ohne das Feld sah eine leere Nacht in der Auswertung aus wie eine abgebrochene: keine Einheit, kein harter Stopp, kein Hinweis darauf, dass schlicht nichts zu tun war. Ein Lauf mit Arbeit trägt es nicht.

**Einlieferung ans Board.** Mit `issueTracker: toolbox` liefert der Runner den Ergebnisstand fortschreibend an kanban-kit ein — nach jeder Einheit und am Ende, über `board.mjs nightrun report` an `POST /api/kanban/night-runs`, mit dem projektgebundenen Token. **Die erste Meldung geht raus, bevor das erste Arbeitspaket dran ist:** unmittelbar nachdem der Ergebnisstand angelegt ist, mit leerer Paketliste und `complete: false`. Ein Lauf, der schon im Vorflug oder in der ersten Session stehenbleibt, ist damit am Board zu sehen — vorher war er von einer Nacht, die nie gestartet wurde, nicht zu unterscheiden. Die Startmeldung erzeugt keine Protokollzeile, und im Dry-Run entfällt sie wie jede andere Meldung. kanban-kit ersetzt denselben Lauf bei jeder Meldung. **Ein harter Stopp geht als abgeschlossener Lauf ein:** Die Meldung trägt `complete: true` samt `abortReason` — dem Grund des Stopps, gekürzt auf die 4.000 Zeichen des Vertrags —, und das Board wertet den Lauf damit als Störung und zeigt den Grund an. Die **Datei** behält davon unberührt `complete: false`, denn der Lauf kam nie durch. Vorher meldete den Stopp niemand: Die Nacht blieb am Board unabgeschlossen unter den aktiven Läufen stehen, obwohl sie lange tot war. Der Grund entsteht als Kaskade — `fehlerText` des Laufs, sonst der `grund` der über `fehlerEinheit` bezeichneten Einheit, sonst „Harter Stopp" mit der Fehlerklasse. Eine gerissene einzelne Kette ist **kein** Abbruch des Laufs: Sie endet regulär und meldet keinen `abortReason`, ihr Ausgang steht am roten Paket. Dafür muss das Board mindestens auf kanban-kit **v2.7.0** stehen — ein älteres verwirft das unbekannte Feld still und zeigte den Stopp als grün abgeschlossene Nacht. Scheitert die Einlieferung, endet der Lauf **nicht** als Fehlschlag: Das Protokoll nennt den Grund, und die Datei bleibt der Rückfall. Mit jedem anderen Tracker entfällt die Einlieferung mit einer Protokollzeile.

Das **Textprotokoll** — also die `.log`-Datei von oben — bleibt unverändert daneben liegen und ist weiterhin der Weg für den, der ins Detail will; der Ergebnisstand ersetzt es nicht, er ergänzt es um eine auswertbare Form. Zwei Versionsangaben stehen in der Datei: `schemaFassung` als erstes Feld nennt die Fassung des Formats — die braucht, wer die Datei auswertet — und `erzeugtVon` den Kit-Stand, der sie geschrieben hat, für den, der beim Nachsehen wissen will, welcher Runner am Werk war. Getrennt geführt, weil ein Kit-Release die `schemaFassung` nicht ändert und eine Formatänderung nicht auf ein Release wartet. Als unsauberen Working Tree wertet der Runner die Datei nicht — sie muss nicht committet werden; wessen `.gitignore` `.claude/*` nicht führt, sieht sie morgens trotzdem in `git status` stehen.

**Was geprüft wurde — und was nicht.** Die Sessions prüfen bereichsbezogen (siehe [Bereichsbezogene Prüfungen](/einrichtung#bereichsbezogene-prufungen-checkareas)), und die Auslassungen sind an **zwei** Stellen sichtbar: im **Abschlussbericht am Arbeitspaket**, wo die Session gelaufene und ausgelassene Prüfungen jeweils mit Grund aufführt, und im **Lauf-Bericht des Durchgangs** — dort je Session eine Zeile und darunter eine Summenzeile über den ganzen Lauf. Eine Session ohne Prüfung erscheint ausdrücklich als „ungeprüft", ein Paket ohne Änderungen als „leeres Paket"; nichts davon versteckt sich hinter einer leeren Liste. Eine Session, die **während** des Prüflaufs stirbt, erscheint als **rot** und nicht mehr als „ungeprüft": Seit die [Zusammenfassung den Lauf begleitet](/einrichtung#das-commit-gate), bleibt in diesem Fall eine unabgeschlossene Fassung mit `nicht gestartet` liegen. Die Verschiebung ist gewollt — ein gestorbener Prüfer ist eine Beanstandung, keine ausgefallene Messung. Der Runner liest das nicht aus dem Abschlussbericht, sondern aus der Zusammenfassung, die `checks.mjs` in `.claude/checks-summary.json` hinterlässt: Was die Maschine auswertet, geht hier nirgends durch von einem Modell formulierten Text.

**Der Nachweis gilt nur zum Commit des Pakets.** In der Zusammenfassung steht immer nur der **letzte** Prüflauf einer Session — wer nach dem Commit noch einmal `checks.mjs run` startet, etwa als Handprobe, und ihn abbricht, hinterlässt eine Fassung, die den abgelieferten Stand gar nicht gemessen hat. Der Runner hält die Datei deshalb gegen den Commit der Session: Jede Datei, die der Commit ändert, muss darin mit genau dem Blob geprüft sein, der im Commit gelandet ist — dieselbe Frage, die das [Commit-Gate](/einrichtung#das-commit-gate) vor dem Commit gegen den Index stellt. Ein abgebrochener Lauf (`abgeschlossen: false`) zählt nie als Nachweis. Passt es nicht, **prüft der Runner selbst nach**: Er fährt die Paketstufe der `buildChecks` und meldet die Session als **`nachgeprueft`** (grün) oder **rot**, in beiden Fällen mit dem Grund in der Zeile („Nachweis gehörte nicht zum Commit …"). `nachgeprueft` ist ein Erfolg wie `geprueft` und wird am Leitstand ebenso grün eingefärbt. Hat die Session keinen Commit hinterlassen, gibt es nichts zu vergleichen — dann bleibt alles, wie es die Zusammenfassung sagt.

**Nachtlauf gegen ein anderes Board (Toolbox/kanban-kit).** Läuft dein Projekt gegen einen kanban-kit-Tracker, kannst du den ganzen Nachtlauf auf ein eigenes Night-Board umschalten: Token in der Admin-UI erzeugen und an das Night-Board binden, als zweite gitignorete Datei neben dem normalen `tokenFile` ablegen (z. B. `.claude/tbx-night.token`) und den Runner mit `TBX_TOKEN` pro Aufruf starten:

```bash
TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs
```

Das funktioniert, weil `TBX_TOKEN` die höchste Stufe der [Token-Precedence](/einrichtung#toolbox) ist und die Umgebungsvariable über die ganze Prozesskette vererbt wird: vom Runner an seine eigenen `board.mjs`-Aufrufe **und** an jede Headless-Session, deren `board.mjs`-Aufrufe sie wiederum erben. Der gesamte Lauf wechselt damit das Board — Ready-Quelle und alle Rückmeldungen (move, comment). Ein Split („Issues von Board B ziehen, auf Board A melden") ist bewusst nicht möglich: Das Board ist das einzige Koordinationssignal des Runners. Wichtig: `TBX_TOKEN` nur so, pro Aufruf, setzen — nie dauerhaft exportieren (etwa in `.zshrc`), sonst gewinnt es in **jedem** Projekt gegen dessen `tokenFile`. Das alles gilt nur für den Toolbox-/kanban-kit-Tracker; bei GitHub und GitLab ist das Board pro Repo über die Config getrennt (`github.projectNumber` bzw. Status-Labels), ein Umschalten pro Aufruf gibt es dort nicht.

**Modell-Angabe im Aktivitätsverlauf (kanban-kit).** Der Runner setzt jeder Session `KIT_AGENT_MODEL` auf das Modell, mit dem sie tatsächlich startet — das ist seit v1.54 nicht mehr zwingend der Wert von `--model`, sondern das Modell der jeweiligen Karte (siehe unten). Die Variable wird über dieselbe Prozesskette vererbt wie `TBX_TOKEN` — bis in die `board.mjs`-Aufrufe der Session — und der Adapter hängt sie als Header `X-Agent-Model` an jeden Board-Request. Im Aktivitätsverlauf steht dann neben der Herkunft auch, mit welchem Modell nachts gearbeitet wurde. Das ist ausdrücklich eine **Selbstauskunft des Clients, kein Nachweis**: Session und Token verifiziert der Server, das Modell nicht — die Board-Seite kennzeichnet den Wert entsprechend („lt. Angabe"). Interaktive Sessions setzen die Variable nicht und machen dadurch keine Angabe; keine Angabe ist ehrlicher als eine geratene. Serverseitig ausgewertet wird der Header nur von kanban-kit; andere Tracker ignorieren ihn.

**Woher das Modell einer Session kommt.** Bis v1.53 lief jede Session einer Nacht mit demselben Modell: `--model`, einmal für den ganzen Lauf. Stand am Arbeitspaket eine Empfehlung, hatte sie keine Wirkung. Seit v1.54 gilt eine feste Reihenfolge — Modellname der Karte, dann Aufgabenstufe, dann Modell des Laufs:

1. Trägt der Body der Karte eine Zeile `Empfohlenes Modell: <name>` **und** steht `<name>` in `night.modelle`, startet die Session mit diesem Modell. Derselbe Wert geht in `--model` und in `KIT_AGENT_MODEL`. Der Modellname gewinnt gegen eine gleichzeitig gesetzte `Aufgabenstufe:`-Zeile; trägt eine Karte beides, bleibt die Stufe ohne Wirkung, und der Grund im Ergebnisstand vermerkt die doppelte Angabe.
2. Sonst, und nur wenn `night.stufen` aktiv ist (mindestens eine Stufe belegt) und die Karte eine `Aufgabenstufe:`-Zeile trägt, gilt die Stufe: Der Runner sucht ab dieser Stufe aufwärts — **leicht → mittel → schwer** — die erste belegte **und** startbare Stufe. Eine unbelegte oder nicht startbare Stufe wird übersprungen, nie unterschritten: Eine Aufgabe, für die die vorgesehene Stufe fehlt, läuft lieber mit einem stärkeren Modell als mit einem schwächeren.
3. Sonst gilt das Modell des Laufs. Es kommt aus `--model`, ohne Flag aus `night.modell` in der geteilten `.claude/workflow.config.json`, und erst ohne beides aus der Vorgabe des Runners (`claude-opus-5`). Die Startzeile nennt es samt Herkunft, etwa `Modell claude-opus-5-5 (night.modell)`. `night.modell` muss in `night.modelle` stehen; sonst endet der Runner vor dem Start mit einem Grund, statt still auf die Vorgabe zurückzufallen. Ein `night.modell` in der persönlichen Datei wird ignoriert und gemeldet. Das Modell des Laufs gilt auch für Fachplan, Plan, Review und Zerlegung der Kette (Issue #994).

**`night.modelle` ist die einzige Prüfung — und sie ist ein Sicherheitsgatter, kein Komfort.** Ohne sie wanderte ein Wert aus einem Issue-Body unbesehen in die Kommandozeile; ein Paket mit `Empfohlenes Modell: --dangerously-skip-permissions` wäre ein Angriff über eine Karte. Deshalb wird gegen eine **Liste** verglichen und nicht gegen ein Muster: Ein Muster lässt sich erweitern, eine Liste nicht. Ein Wert mit führendem Bindestrich oder mit Leerzeichen gilt gar nicht erst als Kandidat, und das Schema weist ihn schon bei der Config-Prüfung ab. Dieselbe Liste gilt für eine Stufe mit `modell`: Ein Stufen-Modellname muss ebenfalls in `night.modelle` stehen, sonst weist die Konfigurationsprüfung ihn ab — zwei getrennte Listen könnten sonst auseinanderlaufen. Eine Stufe mit `kommando` prüft stattdessen, ob das erste Wort der Kommandozeile über dieselbe Shell auffindbar ist, die später startet. Diese Shell ist `sh`. Der Auftrag geht wie überall als Argument an das Programm und nie in den Shell-String.

**Wie gründlich eine Stufe nachdenkt.** Neben `modell` trägt eine Stufe optional `effort` — die Gründlichkeit des Nachdenkens, die als `--effort` an die Claude-CLI der Session geht. Möglich sind `low`, `medium`, `high`, `xhigh` und `max`. Ohne das Feld gilt die Voreinstellung der CLI; eine Stufe ohne `effort` verhält sich also wie bisher. Das Feld gehört ausschließlich zu einer Stufe mit `modell`: Neben `kommando` startet ein fremdes Programm, dem das Kit keine Gründlichkeit setzen kann. Dort ist es ein Konfigurationsfehler und wird nicht stillschweigend ignoriert, sondern mit dem Pfad `night.stufen.<stufe>.effort` gemeldet — ebenso ein Wert außerhalb der fünf.

**Wo die Gründlichkeit wirkt — und wo nicht.** Modell und Gründlichkeit kommen immer als Paar aus **einem** Stufen-Eintrag: Weicht der Runner nach oben aus, gilt die Gründlichkeit der Stufe, die das Modell wirklich gestellt hat, nie die der unbelegten darunter. Ohne Wirkung bleibt sie überall dort, wo die Stufe das Modell nicht gestellt hat — beim `Empfohlenes Modell:` der Karte und beim Modell des Laufs — und im Kommando-Zweig, wo ein fremdes Programm startet, das `--effort` nicht kennt. Die Sessions der Nacht-Kette für Fachplan, Plan und Zerlegung bleiben ebenfalls unberührt; die Umsetzungsstufe fährt ihre Pakete durch dieselbe Runde wie die Umsetzungsnacht und bekommt die Gründlichkeit deshalb mit. Sichtbar ist sie an vier Stellen: in der Hinweiszeile einer Runde, in der Vorschau `--dry-run`, im **Ergebnisstand** als Feld `effort` der Einheit (hinter `stufeVerwendet`, `null` wenn keine gesetzt war) und im Bericht der Umsetzungsstufe als Klammerzusatz hinter dem Modell. Die Salvage-Session eines Pakets läuft mit demselben Bündel wie dessen reguläre Runde, also auch mit derselben Gründlichkeit.

Ein Kartenname **außerhalb** der Liste ist kein Fehlschlag: Die Session läuft mit dem Modell des Laufs, und die Einheit im Ergebnisstand trägt `modellHerkunft: "lauf"` samt `modellGrund` mit dem abgewiesenen Namen. Eine fehlende Zeile und eine leere Liste führen ebenfalls zum Lauf-Modell, dann ohne Grund — eine fehlende Empfehlung ist der Normalfall und kein Befund. Ein Modell, das trotz gültigen Namens nicht startet, bleibt dagegen ein Fehlschlag wie jeder andere.

**Startfehler auf der höchsten Stufe.** Die Startbarkeit einer Stufe prüft der Runner **vor** dem ersten Arbeitsschritt jedes Pakets neu. Scheitert die vorgesehene Stufe, weicht er nach oben aus wie oben beschrieben; scheitert das auch auf der höchsten Stufe (`schwer`), gibt es keine Ausweichmöglichkeit mehr. Dann startet **keine** Session — ein stiller Rückfall auf das Modell des Laufs wäre falsch, denn wer eine Stufe setzt, will das Paket auf dieser Ebene laufen lassen. Das Paket gilt als Fehlschlag, bekommt einen Kommentar mit dem Grund und wandert zurück ins Backlog.

**Der Vorflug.** Vor der ersten Runde einer Nacht prüft der Runner einmal ohne Netz, ob jede **belegte** Stufe startbar ist, und schreibt bei einer nicht startbaren Stufe eine Warnung ins Protokoll. Das hält die Nacht nicht auf — es ist ein früher Hinweis, dass einzelne Pakete später ausweichen oder scheitern werden, keine Startbedingung für den ganzen Lauf. Bei nicht aktiver Einstellung schreibt der Vorflug keine Zeile.

**Die Vorschau.** `night.mjs --dry-run` nennt zu jedem Ready-Issue, welches Modell tatsächlich starten würde und woher — `(Karte)`, `(Stufe <name>)` oder `(Lauf)` —, samt Ausweich-Hinweis, wenn die eigene Stufe der Karte unbelegt ist und eine startbare Stufe erst weiter oben gefunden wurde. Ein Paket ohne startbare Stufe erscheint darin ausdrücklich als „würde nicht starten", nie als laufende Session.

**Ein durchgerechnetes Beispiel mit einem lokalen Modell.** Ein Projekt betreibt für leichte Aufgaben ein eigenes, lokal gehostetes Modell über ein Kommandozeilen-Programm statt einer Claude-Modell-ID:

```json
{
  "night": {
    "modelle": ["claude-opus-5", "claude-sonnet-5"],
    "stufen": {
      "leicht": {
        "kommando": "mein-lokal-runner",
        "name": "lokal-llama"
      }
    }
  }
}
```

Trägt ein Ready-Issue `Aufgabenstufe: leicht`, startet der Runner statt der `claude`-CLI `mein-lokal-runner` und übergibt ihm den Auftrag (`/implement-next #N`) als Argument. `KIT_AGENT_MODEL` trägt dabei den Wert aus `name` (`lokal-llama`) — im Kommando-Zweig gibt es keinen Claude-Modellnamen, das Feld ist dort eine reine Selbstauskunft des Programms. Einrichtung und Betrieb dieses Programms sind Sache des Projekts, nicht des Kits; das Kit startet nur den Prozess. Damit die Karte danach wie jede andere behandelt wird, muss das Programm dasselbe liefern wie eine reguläre Session: einen lokalen Commit, das Issue in In review und einen Eintrag im Abschlussbericht (Kriterium 6) — der Runner wertet ausschließlich Board-Zustand und Working Tree aus, ihm ist gleich, welches Programm sie hergestellt hat.

Die **Salvage-Session** eines Pakets läuft mit demselben Modell wie dessen reguläre Runde: Sie prüft deren Zwischenstand, und die Empfehlung galt der Karte, nicht der Betriebsart. Die **Umsetzungsstufe der Nacht-Kette** zieht ihre Arbeitspakete durch dieselbe `laufeRunde` wie die Umsetzungsnacht — für sie gilt der Stufenweg deshalb ebenso. Für Fachplan, Plan und Zerlegung der Kette (`/techplan`, `/issue-review`, `/issues`) gilt dagegen weiterhin das Modell des Laufs: Sie hängen an keiner einzelnen Karte.

Ein Projekt **ohne `night.stufen`** merkt von alldem nichts: Planung, Pakete, Nachtlauf, Vorflug und Bericht verhalten sich wie zuvor — jede Karte trägt weiterhin nur `Empfohlenes Modell:`, und die Modellwahl bleibt bei den zwei Fällen Karte/Lauf.

Die Liste `night.modelle` ist **geordnet**, absteigend nach Stärke: erster Eintrag das stärkste, letzter das schnellste Modell. Daraus leitet `/issues` ab, was es einem Arbeitspaket empfiehlt.

**Permissions.** Unbeaufsichtigt heißt: niemand beantwortet Permission-Dialoge. Der Runner startet die Sessions deshalb mit `--permission-mode auto --permission-prompts none` (Issue #940); alles Weitere erlaubst du gezielt über eine Allowlist in `.claude/settings.json` des Projekts. Die beiden Flags gehören zusammen: Im auto mode entscheidet ein Klassifikator, und damit wirkt deine Allowlist auch nachts — anders als im früheren Modus, der Edits pauschal annahm und dabei eine eingebaute Sperre für sensible Dateien mitführte, die kein `allow`-Eintrag aufhob. Was der Klassifikator nicht entscheiden kann, würde zur Rückfrage; `none` lehnt sie automatisch ab, statt sie an einen SDK-Host zu schicken, den der Runner nicht hat. Ohne `none` hinge die Session bis zum Rundenzeitlimit. Vor der ersten Session prüft der Runner in jeder Betriebsart, ob `.claude/settings.json`, `.claude/settings.local.json` und `~/.claude/settings.json` — soweit vorhanden — gültiges JSON sind, und stoppt bei einem Fehler hart mit Pfad und Parser-Meldung (im Dry-Run nur berichtet): Eine ungültige Datei setzt alle ihre Einstellungen außer Kraft, und nachts sähe man davon nur eine Genehmigungsabfrage, die niemand beantwortet. Die Allowlist z. B.:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(mvn:*)",
      "Bash(npm --prefix frontend:*)"
    ]
  }
}
```

Für den unbeaufsichtigten Betrieb erlaubst du am besten das **Werkzeug**, nicht das einzelne Kommando: `Bash(mvn:*)` statt `Bash(mvn verify:*)`. Der Grund ist das Präfix-Matching der Allowlist — ein Muster greift nur, wenn der Kommando-Anfang exakt passt. `Bash(mvn verify:*)` deckt `mvn verify` ab, aber nicht `mvn -q verify`, `mvn clean verify` oder ein `mvn test` für einen Teillauf; Sessions formulieren solche Varianten aber legitim. Ein tool-weiter Eintrag fängt alle. Die vier read-only-Git-Kommandos gehören ebenfalls hinein, damit eine Session beim Commit-Vorbereiten nicht an einem harmlosen `git status` scheitert. **Trade-off:** Ein tool-weiter Eintrag gibt der Session mehr Spielraum (beliebige `mvn`-Goals, beliebige `npm`-Scripts). Für projekteigene Build-Werkzeuge ist das nachts der pragmatische Schnitt; wer enger bleiben will, trägt die buildChecks stattdessen wörtlich ein (inklusive aller Flags) und zahlt dafür mit Runden, die an einer nicht vorhergesehenen Kommando-Variante scheitern.

Ein Kommando außerhalb der Allowlist wird im Headless-Betrieb sofort abgelehnt; eine gut erzogene Session implementiert dann zwar weiter, kann aber ihre Checks nicht ausführen und committet deshalb nicht — die Runde endet zeitnah ohne In-review-Ergebnis (dirty Tree → harter Stopp, sauberer Tree → Backlog), nicht erst nach `--timeout-min`. Das ist gewollt: lieber eine verlorene Runde als eine unbeaufsichtigte Aktion. Wer stattdessen `--yolo` setzt, schaltet **alle** Permission-Checks der Nacht-Sessions ab (`--dangerously-skip-permissions`); die Stop-Punkte hängen dann allein am Skill-Prompt. Bewusste Einzelfall-Entscheidung, kein Default.

**Zwei weitere Schichten: Sandbox und Umgebung.** Die Allowlist entscheidet, ob ein Kommando *erlaubt* ist — nicht, in welcher Umgebung es läuft. Claude Code führt Bash-Kommandos zusätzlich in einer **Sandbox** aus, die unter anderem Unix-Sockets abschottet. Braucht ein Check einen Socket (typisch: Testcontainers-Integrationstests über `mvn verify`, die den Docker-/Colima-Socket ansprechen), scheitert er trotz passender Allow-Rule an der Sandbox, und der Ausweg („ohne Sandbox erneut ausführen") ist ein interaktiver Prompt — nachts unbeantwortbar. Nimm solche Kommandos über [`sandbox.excludedCommands`](https://code.claude.com/docs/en/sandboxing) aus der Sandbox heraus:

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": ["mvn *"]
  }
}
```

**Kit-Skripte mit Board-Zugriff.** Auch das Kit braucht Einträge in `sandbox.excludedCommands`, und zwar für jedes Skript, das das Board erreicht — direkt oder über einen Unterprozess. Ein Unterprozess erbt die Sandbox: `node .claude/kit/findings.mjs suggest` startet `board.mjs` per `spawnSync`, und dieses `board.mjs` hat kein Netz, solange `findings.mjs` selbst nicht in der Liste steht — der Eintrag für `board.mjs` allein genügt nicht. Dasselbe gilt für `effectiveness.mjs`. Dazu kommt der Reviewer-Befehl:

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": [
      "node .claude/kit/board.mjs*",
      "node .claude/kit/night.mjs*",
      "node .claude/kit/findings.mjs*",
      "node .claude/kit/effectiveness.mjs*",
      "codex *"
    ]
  }
}
```

Fehlt dem Check darüber hinaus eine **Umgebungsvariable** (z. B. `DOCKER_HOST`, damit Testcontainers den Socket findet), setz sie im `env`-Block der `settings.json` — **nicht** als Kommando-Präfix. Ein `env DOCKER_HOST=… mvn …` fällt nämlich aus beiden Mustern heraus: Das erste Token ist dann `env`, nicht `mvn`, also greifen weder die Allow-Rule `Bash(mvn:*)` noch `excludedCommands: ["mvn *"]`. Im `env`-Block gilt die Variable für jede Session, und `mvn` erbt sie ohne Präfix:

```json
{
  "env": {
    "DOCKER_HOST": "unix:///<pfad-zum>/docker.sock"
  }
}
```

Das Setup-Rezept für den Nachtbetrieb hat also drei Schichten, die alle passen müssen: die **Allowlist** erlaubt das Kommando, `sandbox.excludedCommands` befreit es von der Isolation, der `env`-Block versorgt es mit Variablen. (Für Testcontainers speziell tut es alternativ eine `~/.testcontainers.properties` mit `docker.host` — die liegt außerhalb des Projekts, ist dafür aber unabhängig von Claude Code.)

**Pipe und Umleitung heben die Ausnahme auf (ab Claude Code 2.1.277).** Eine zusammengesetzte Zeile nimmt Claude Code nur noch aus der Sandbox, wenn **jeder** Teil zu einem Eintrag in `excludedCommands` passt. `node .claude/kit/board.mjs issue-review check 2>&1 | head -40` läuft darum komplett in der Sandbox, weil `head` in keiner Liste steht — samt dem codex, das `board.mjs` startet, und ohne Netz. Dasselbe gilt für eine Umleitung in oder aus einer Datei (`codex exec … < prompt.txt`, `… > liste.json`), auch wenn sonst nichts in der Zeile steht. Nur `2>&1` (und jedes andere Umlenken auf einen Deskriptor wie `>&2`) lässt die Ausnahme stehen, gemessen unter 2.1.283.

**Kein `cd` in den Release-Worktree (Issue #1372).** `/push-main` und `/merge-production` legen ihren Worktree unter dem Temp-Verzeichnis an. Dorthin setzt Claude Code das Arbeitsverzeichnis nach jedem Aufruf zurück, und `cd <pfad> && node .claude/kit/checks.mjs …` fiele nach der Regel oben aus `excludedCommands` heraus. Die Skills nennen den Worktree deshalb in jedem Aufruf selbst: `git -C <pfad> …`, `node .claude/kit/checks.mjs run --in <pfad> …` und für jedes andere Kommando `node .claude/kit/worktree.mjs in <pfad> -- <kommando>`. Den Pfad liefert `worktree.mjs create` als realpath, weil `npm ci --prefix` über den macOS-Symlink des Temp-Verzeichnisses scheitert. Wer trotzdem mit `cd` im Worktree arbeiten will, trägt das Temp-Verzeichnis und seinen realpath unter `permissions.additionalDirectories` ein.

Der Installer trägt dagegen einen **`PreToolUse`-Hook** mit Matcher `Bash` in den `hooks`-Block der Projekt-`settings.json` ein: `node .claude/kit/board.mjs hook bash-check`. Er liest die Muster aus `sandbox.excludedCommands` und — nur aus Rücksicht auf ältere Settings, Claude Code selbst kennt den Schlüssel nicht — `sandbox.network.excludedCommands` von `.claude/settings.json` und `.claude/settings.local.json` und weist eine Bash-Zeile ab (Exit 2, Begründung an die Session), wenn ein Teil davon zu einem Muster passt und die Zeile zugleich

- in oder aus einer Datei umleitet (`<`, `>`, `>>`, `&>`, Here-Doc), oder
- eine Pipe oder einen weiteren Befehl (`|`, `&&`, `||`, `;`, Zeilenumbruch) enthält, dessen Teile nicht alle passen.

Zeichen in Anführungszeichen zählen nicht (`--text "a > b"` bleibt erlaubt), ebenso wenig Zeilen ohne passendes Muster. Die Begründung nennt das Muster und die richtige Form: das Kommando allein aufrufen; eine große Ausgabe legt Claude Code selbst in einer Datei ab, die ein zweiter Aufruf filtern kann. Kann der Hook seine Eingabe oder eine Settings-Datei nicht lesen, lässt er den Aufruf durch und schreibt eine Zeile auf stderr — ein kaputter Hook sperrt keine Session.

**Keine Hintergrundarbeit ohne Aufsicht.** Derselbe Hook `bash-check` weist einen Bash-Aufruf mit `run_in_background: true` ab, sobald `KIT_AGENT_MODEL` gesetzt ist (Exit 2, Begründung an die Session). Eine unbeaufsichtigte Session hat keinen Folge-Zug: Beendet sie ihren Zug, während der Befehl noch läuft, ist die Sitzung zu Ende und sein Ergebnis verloren — in der Nacht zum 30.09.2026 bei #1065, obwohl die Regel in den Skills stand. Der richtige Weg ist, den Befehl im Vordergrund aufzurufen; das Bash-Zeitlimit der Session reicht bis knapp unter das Rundenlimit (#668). Interaktiv bleibt Hintergrundarbeit erlaubt. Das Werkzeug `Agent` erfasst der Hook nicht: Ob ein Agent im Hintergrund läuft, steht nicht verlässlich im Aufruf (#1081).

**Wenn etwas schiefgeht:** Der Runner unterscheidet drei Fälle. **Infrastruktur-Fehlstart** — die Session selbst endet mit Exit ≠ 0 (Auth abgelaufen, CLI kaputt): harter Stopp, das Issue bleibt unangetastet in Ready, denn mit ihm ist nichts falsch; die CLI-Fehlermeldung steht direkt im Konsolen-Log. So räumt eine kaputte Umgebung nicht die ganze Ready-Spalte leer. **Fachlicher Fehlschlag** — die Session endet sauber (Exit 0), aber das Issue steht nicht in In review: der Runner kommentiert es und stellt es zurück ins Backlog, der Lauf geht mit dem nächsten Issue weiter. Ein **Timeout** (`--timeout-min`) zählt als issue-spezifisch — der Session ging die Zeit aus — und wird wie ein fachlicher Fehlschlag behandelt; **warum** sie ausging, folgt daraus nicht und steht allenfalls im Vermerk am Paket (siehe [Der Zeitabbruch](#der-zeitabbruch)). Hinterlässt eine Runde ohne Ergebnis einen unsauberen Working Tree und scheitert auch die Rettung (Salvage, siehe unten), sichert der Runner die Reste mit `git stash push --include-untracked -m "nachtrest #<id> <lauf>"`: Gesichert wird genau, was als Rest zählt, samt unversionierter Dateien. Die Karte geht ins Backlog, ihr Kommentar und ihr Laufstand `abgebrochen` nennen den Stash, und der Lauf geht mit dem nächsten Paket weiter. So hält ein Paket, das an sich selbst scheitert, nur sich an, und auf halben Änderungen wird trotzdem nicht weitergebaut. Zurück holst du die Reste mit `git stash list` und `git stash apply stash@{<n>}`. Ein Paket, das von einem in diesem Lauf abgebrochenen Paket abhängt, geht wie bisher am Abhängigkeits-Gate zurück und zeigt zusätzlich den Laufstand `wartet` mit „hängt an #N (abgebrochen in diesem Lauf)“. Harter Stopp (Exit ≠ 0) bleibt, wo ein Commit unvollständig sein kann: bei Resten nach einer **erfolgreichen** Runde, bei einer Rettung, die committet oder die Karte nach In review gezogen hat und trotzdem Reste lässt, und wenn sich die Reste nicht sichern lassen. Jedes Paket steht dabei mit seinem Laufstand an der eigenen Karte: `laeuft` zu Rundenbeginn, `fertig` bei In review mit Nachweis, `wartet` beim Halt und sonst `abgebrochen` mit Grund. Vor dem Start prüft der Runner außerdem: kein Issue in In progress (Crash-Rest), sauberer Working Tree, `buildChecks` vorhanden.

**Der vierte Ausgang: `angehalten`.** Eine Implementierungs-Session entscheidet, statt zu fragen: Was beim Umsetzen unklar ist und nicht in der Stopp-Klasse aus `CLAUDE-workflow.md` steht, wird entschieden und im Abschlussbericht unter `### Entscheidungen` protokolliert. Taucht dagegen eine Frage der Stopp-Klasse auf, wählt die Session nicht, sondern **hält an**: Sie nimmt ihren eigenen Anteil an den Änderungen zurück, zeichnet das Issue mit `kit:clarify`, benennt die Frage als Board-Kommentar und schiebt es nach Backlog. Der Runner erkennt das am Kommentar, schreibt eine eigene Log-Zeile und **läuft weiter**.

Dieser Ausgang ist von den beiden benachbarten zu unterscheiden, und genau dafür hat er einen eigenen Namen:

| Ausgang | Was passiert ist | Wer kommentiert und bewegt | Folge für den Lauf |
|---|---|---|---|
| `zurueckgestellt` | die Session hat die Aufgabe nicht fertigbekommen | der Runner | weiter mit dem nächsten Issue |
| `angehalten` | die Aufgabe ist lösbar, aber eine Entscheidung fehlt | die Session selbst — der Runner tut hier nichts | weiter mit dem nächsten Issue |
| `harterStopp` | die Umgebung oder der Arbeitsbaum ist kaputt | keiner, das Issue bleibt unangetastet | der Lauf endet |

Ein Halt ist **kein Fehlschlag**: Die Session hat richtig gehandelt, indem sie nicht geraten hat. Deshalb steht er im Ergebnisstand als eigener Zähler neben `erfolg`, `zurueckgestellt` und `fehlschlag` — wer die wartenden Entscheidungen morgens in der Rückstellungszahl suchen müsste, fände sie nicht. Der Weg nach vorn führt über `/requirement #T`: Der Skill nimmt den angehaltenen Task samt Entscheidungskommentar als Eingang und macht eine fachliche Anforderung daraus. Dieselbe Nummer-Form hat einen zweiten Eingang — eine `[Idea]`, die eine Abwägung verlangt; ist an ihr nichts abzuwägen, ist stattdessen `/task #N` der Weg. Das `kit:clarify` nimmt dabei ausschließlich der Mensch ab.

#### Der Halt an einer geschützten Datei

**Eine geschützte Datei ist keine Frage, sondern eine Handlung.** Manche Dateien darf nur ein Mensch schreiben — im Kit die Einstellungen unter `.claude/` (`settings.json`, `settings.local.json`, `.claude/hooks/`). Muss ein Paket eine davon ändern, hält es an, und zwar mit dem Label `kit:protected` statt `kit:clarify`: Bei `kit:clarify` wartet eine Entscheidung, bei `kit:protected` eine Handlung. Das Label ist wie `review:done` je Board einmal anzulegen; die Maschine setzt es, abnehmen darf es nur der Mensch. Der Halt-Kommentar beginnt mit `## Geschuetzte Datei`, nennt jede Datei mit der zitierten Zeile aus dem Paket und vermerkt als letzte Zeile `Label kit:protected gesetzt` oder, wenn das Label am Board fehlt, `Label kit:protected nicht gesetzt`. Der Lauf bricht am fehlenden Label nicht ab; frei wird die Karte aber erst nach einem Halt mit gesetztem Label.

**Vor dem Start.** Der Nacht-Runner prüft jedes Ready-Paket gegen die geschützten Pfade, bevor eine Session beginnt: Nennt die Aufgabe oder das Akzeptanzkriterium eine geschützte Datei und ist das Paket nicht freigegeben, geht es nach Backlog, bekommt das Label und den Halt-Kommentar, und der Lauf geht weiter. In der **Umsetzungsstufe der Kette** (Variante B) steht das Paket schon in Backlog; dort setzt der Runner Label und Kommentar ohne Move, und jedes Paket, das davon abhängt, bekommt den Abhängigkeits-Kommentar und bleibt ebenfalls liegen. Dieselbe Prüfung liefert `issue brief` am Tag mit der Folge `geschuetzt`.

**Wenn erst das Schreiben scheitert.** Nennt das Paket die Datei nicht und weist Claude Code den Schreibzugriff ab, hält die Session selbst an: eigenen Anteil namentlich zurücknehmen, Backlog, Label, Halt-Kommentar über `issue check-protected <id> --path <pfad>`. Befolgt sie das nicht und hinterlässt einen unsauberen Baum ohne Halt, fängt der Runner den Fall auf: Trägt ihr Stream in `permission_denials` ein abgewiesenes `Write` oder `Edit` auf einen geschützten Pfad, sichert er den Zwischenstand im Stash `nachtrest #<id> <lauf>`, zieht die Karte nach Backlog, vermerkt den Halt mit dem Ort des Zwischenstands und macht mit dem nächsten Paket weiter.

**Im Bericht** steht der Halt mit der Art `geschuetzt`, getrennt von den Stopp-Fragen: als eigene Kennzahl „Geschuetzte Dateien“ und unter „Wartende Handlung an geschuetzter Datei“, nicht unter „Offene Stopp-Frage“.

**Der Weg zurück:** die Änderung an der Datei selbst vornehmen, das Label `kit:protected` abnehmen, die Karte nach Ready ziehen. Beim nächsten Anlauf gilt das Paket als freigegeben und läuft normal durch.

**Salvage — wenn die Arbeit fertig ist, das Board es aber nicht weiß.** Eine Headless-Session hat keinen Folge-Turn. Startet sie einen langen Check im Hintergrund und beendet ihren Turn, bevor das Ergebnis da ist, ist es verloren — das Board zeigt einen Fehlschlag, obwohl die Arbeit vollständig war. Bevor der Runner bei „nicht in In review UND dirty" hart stoppt, prüft er deshalb selbst nach — mit **`node .claude/kit/checks.mjs run --finish <id> --fresh`** im Projekt, also genau dem Lauf, den auch der Abschluss einer Karte fährt. Der Weg über `checks.mjs` ist der Kern der Sache: Dieser Lauf hinterlässt die Zusammenfassung `.claude/checks-summary.json`, und **genau sie liest das Commit-Gate**. Fuhr der Runner die `buildChecks` früher selbst, maß er grün an einer Stelle, die das Gate nicht kennt — in der Zusammenfassung stand weiter das rote Ergebnis der Session, und die Salvage-Session konnte nicht committen: Die Rettung konnte in dieser Lage nie gelingen. Jetzt gibt es eine Wahrheit über „grün" statt zweier. `--fresh` gehört dazu, sonst übernähme das Kommando bei unverändertem Stand genau das rote Ergebnis, das der Runner anzweifelt; `--finish <id>` hält den Umfang des Kartenabschlusses (Paketstufe, ohne Zusammenspiel-Prüfungen und ohne Gütemessung) und ordnet den Lauf der Karte zu. Mit dem Weg kommt dessen **bereichsbezogene Auswahl**: Es laufen die Prüfungen der berührten Bereiche — eine eigene, weitere Auswahl wäre wieder die zweite Wahrheit, die der Vorfall gekostet hat. Prüfungen mit `stufe` `push` oder `merge` bleiben wie bisher außen vor, sie sind erst beim Veröffentlichen fällig. Sind die Checks grün, bekommt **genau eine** Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue zu prüfen, zu committen und das Board zu bewegen (Zeitlimit 10 Minuten; sie führt keine Builds mehr aus). Rote Checks oder ein gescheiterter Versuch haben je eine eigene Log-Zeile. Ohne Commit gehen die Reste in den Stash, und der Lauf geht weiter (siehe „Wenn etwas schiefgeht“). Die Vorprüfung merged dabei den `env`-Block aus `.claude/settings.json` und `.claude/settings.local.json` in ihre Umgebung — sonst fehlen ihr projektspezifische Variablen (etwa für Testcontainers), die sonst nur Claude Codes eigene Bash-Aufrufe bekommen, und sie meldet ein falsches Rot.

**Trägt der Salvage nicht, sind es drei Endzustände — nicht einer.** Sie verlangen morgens drei verschiedene Griffe. Der erste sichert die Reste im Stash, und die Nacht läuft weiter. Die beiden anderen enden im harten Stopp, weil dort ein Commit unvollständig sein kann. Protokollzeile, Board-Kommentar und der `grund` des Ergebnisstands nennen sie deshalb beim Namen:

| Endzustand | Was der Runner vorgefunden hat | Was daran zu tun ist |
|---|---|---|
| `SALVAGE-VERSUCH gescheitert` | kein neuer Commit, Karte nicht bewegt | die Session hat nichts hinterlassen; die Reste liegen im Stash `nachtrest #<id> <lauf>`, Grund und Laufstand nennen ihn |
| `SALVAGE UNVOLLSTAENDIG` | neuer Commit, Karte nicht bewegt | die Arbeit liegt lokal — der Commit-Hash und die liegengebliebenen Pfade stehen dabei, nur der Board-Zug fehlt |
| `SALVAGE WIDERSPRUECHLICH` | Karte in In review, Arbeitsbaum unsauber | die Karte behauptet mehr, als committet ist; die betroffenen Pfade stehen dabei |

Ob committet wurde, sagt der Vergleich des Commit-Hashes vor und nach der Salvage-Session: Vor der regulären Runde ist der Arbeitsbaum sauber, ein neuer Commit ist damit die einzige Spur, die sie sicher hinterlässt. **Das Board bewegt der Salvage erst bei sauberem Arbeitsbaum** — seine Anweisung schreibt die Reihenfolge vor: committen, `git status --porcelain` leer sehen, dann erst ziehen. Ohne sie wäre der dritte Fall die Regel statt die Ausnahme.

**Damit es gar nicht erst zum Salvage kommt.** Der Rettungsgriff behandelt den Schaden, nicht die Ursache — und er trug dreimal nicht, weil die Checks danach rot waren. Seit v1.54 setzt der Runner deshalb zwei Dinge davor:

- **Das `Monitor`-Werkzeug ist für Implementierungs-Sessions gesperrt** (`--disallowedTools Monitor`), und ihr Bash-Zeitlimit steht auf dem Rundenzeitlimit (`BASH_MAX_TIMEOUT_MS`, `BASH_DEFAULT_TIMEOUT_MS`). `Monitor` ist das Werkzeug, mit dem eine Session auf einen eigenen Hintergrundlauf wartet — und genau damit beendet sie ihren Zug. Ohne das Werkzeug bleibt ihr der Vordergrund-Aufruf, dessen Ergebnis sie noch verwerten kann; ohne das gehobene Zeitlimit stürbe sie dabei nach zehn Minuten an der Uhr statt am Code. Das ist eine Leitplanke, keine Bitte: Die Anweisung, einen Hintergrund-Check aktiv abzuwarten, steht seit Langem im `local-check`-Skill und stand im Kontext genau der Sessions, die trotzdem wartend endeten.
- **Der Runner misst erst, wenn kein Prozess der Session mehr läuft.** Nach dem Ende einer Session wartet er auf ihre Prozessgruppe, höchstens bis zum Rest des Rundenzeitlimits. Sonst startet die Salvage-Vorprüfung ihren eigenen Build neben einem noch laufenden — zwei gleichzeitige Testcontainers-Läufe reißen einander die Ressourcen weg, und das Rot sagt nichts über den Code. Läuft nach Ablauf der Frist noch etwas, steht ein Hinweis im Protokoll und der Lauf geht weiter.

**Die wartende Sitzung.** Für jede unbeaufsichtigte Sitzung gilt seit v2.0.3 die Regel: **Keine Session endet mit laufender eigener Arbeit.** Sie wartet auf das Ergebnis der langen Arbeit, die sie angestoßen hat, oder bricht diese ab und meldet den Abbruch als Fehlschlag. Hintergrundarbeit bleibt dabei ausdrücklich erlaubt; unzulässig ist allein das Aufhören, während sie noch läuft. Tut eine Sitzung es doch, sah das vorher aus wie ein reguläres Ende ohne Commit — also wie Aufgeben, obwohl die Arbeit womöglich fast fertig war.

**Erkannt wird am Schlusstext**, nicht am Werkzeug und nicht an der Zeit: Wendungen wie „warte auf", „läuft noch", „im Hintergrund" oder „sobald … fertig ist". **Das Warten auf einen Menschen zählt nicht** — ist im Schlusstext von einer Antwort, einer Rückmeldung, einer Freigabe, einem GO, einer Klärung oder einem Review die Rede, hat die Sitzung nichts verloren: Ihre Frage steht am Board, und der Halt-Weg oben hat sie schon verbucht. Gelesen wird ausschließlich der Schlusstext; eine Wartemeldung mitten im Lauf bleibt folgenlos, denn wer später fertig wird, sagt zum Schluss etwas anderes.

**Was der Runner dann tut.** Die Runde bekommt ihren eigenen Grund — dieselbe Zeile in Protokoll, Board-Kommentar und `grund` des Ergebnisstands, siehe die Tabelle unten. An das Arbeitspaket geht ein Kommentar unter dem Anker `## Nachtlauf: wartende Sitzung`: der Fall, der zuletzt bekannte Stand (der Schlusstext, ab 2.000 Zeichen gekürzt) und, sofern welche liegen, die Reste im Arbeitsverzeichnis. Die Einheit im Ergebnisstand trägt `wartendBeendet: true`. Am Ablauf ändert sich nichts: Bei sauberem Arbeitsbaum geht das Paket wie bei jedem Fehlschlag zurück ins Backlog und der Lauf läuft weiter. Die nächste Session, die das Paket zieht, nennt den Vermerk, statt stillschweigend auf halbem Weg weiterzumachen.

**Bei unsauberem Arbeitsbaum kommt der Salvage zuerst.** Rettet er die Runde, bleibt es dabei — dann war nichts verloren, und ein zweites Urteil über denselben Vorgang wäre eine zweite Wahrheit. Ist er nicht möglich (rote Checks) oder gescheitert, treten Grund, Vermerk und `wartendBeendet` hinzu; beim gescheiterten Salvage steht der Grund der wartenden Sitzung **vor** dessen Endzustand aus der Tabelle oben, denn es sind zwei Vorgänge: warum die reguläre Runde nichts hinterlassen hat, und was der Salvage vorgefunden hat.

**In der Nacht-Kette** endet eine Stufen-Session mit wartendem Schlusstext als `abgebrochen`, mit demselben Grund, und ihr Vermerk hängt am Dokument der Stufe — am Plan, am Paket. Einzige Ausnahme ist die Stufe `abdeckung`: Ihre Auskunft *ist* ein Text über laufende Arbeit, und eine Erkennung dort verwürfe den Befund genau dann, wenn er etwas zu sagen hat.

**Gezählt wird sie.** `effort.mjs` führt die wartend beendeten Sitzungen als eigene Größe und nennt sie im Befund in einer eigenen Zeile — auch bei null, und dann ausdrücklich als Null: Der Fall ist selten, und ein Schweigen ließe offen, ob er nicht eintrat oder nicht gezählt wurde.

**Der harte Stopp nennt den Grund, nicht nur den Zustand.** Bis v1.53 stand im Protokoll „nicht in In review UND Working Tree dirty" — das ist die Folge. Wer morgens sichtet, unterscheidet jetzt fünf Fälle mit fünf verschiedenen nächsten Schritten:

| Präfix im Protokoll | Was passiert ist |
|---|---|
| `Grund: Session regulaer beendet ohne Commit (end_turn)` | Die Session ist normal zu Ende gegangen, ohne fertig zu werden |
| `Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden` | Die Session hat eine lange Arbeit angestoßen und darauf gewartet — headless gibt es keinen Folge-Turn, siehe oben |
| `Grund: Session am Zeitlimit beendet` | Der Session ging die Zeit aus; woran, sagt der Vermerk am Paket — nicht diese Zeile |
| `Grund: Session mit is_error beendet` | Abbruch |
| `Grund: Pflichtcheck rot — <Kommando> (Session)` bzw. `(Vorpruefung des Runners)` | Arbeit am Code; das rote Kommando und die letzten 15 Zeilen seiner Ausgabe stehen dabei |

Der Grund steht im Protokoll, im Board-Kommentar und im `grund` des Ergebnisstands — dieselbe Zeile an allen drei Orten. Damit `stop_reason` überhaupt vorliegt, fordert der Implementierungslauf die Stream-Ausgabe seit v1.54 **immer** an, auch bei abgeschaltetem Verlaufsprotokoll (`--verbose no`); das frühere Feld `kennzahlenHinweis` im Ergebnisstand ist damit entfallen.

**Plattform-Shell für `buildChecks` und `formatFixCommand`.** Beide Werte sind frei konfigurierte Kommandozeilen und brauchen deshalb zwingend eine Shell — anders als die festen Kommandos des Board-Adapters, der seit v1.27 ganz ohne Shell auskommt. Der Runner startet sie in `/bin/sh`. **Folge:** Dieselbe Kommandozeile gilt auf macOS, Linux und WSL2. Verkettung mit `&&`, Pipes, Umleitungen wie `2>/dev/null` und Variablen wie `X=1 npm test` schreibst du in POSIX-Syntax, einmal für alle Plattformen. Die Variablen, die der Nacht-Runner seinen Sessions setzt (`LAUF_VARIABLEN` in `kit/night/laufvariablen.mjs`, etwa `NIGHT_ISSUE_ID`, `NIGHT_KETTE_STUFE`, `KIT_NIGHT_RUN`, `KIT_AGENT_MODEL`), erben die Prüfkommandos nicht; was in der Kommandozeile oder im `env`-Block der `settings.json` steht, gilt weiter.

**`formatFixCommand` — ein Formatverstoß darf keinen Lauf kippen.** Setzt du in der `workflow.config.json` ein Kommando, das Formatierung mechanisch repariert (`"formatFixCommand": "mvn spotless:apply"`, für Frontends etwa `"npx prettier --write ."`), dann läuft es bei roten Checks in der Salvage-Vorprüfung **genau einmal**, und die Checks werden **genau einmal** wiederholt. Werden sie dadurch grün, geht der Lauf weiter und das Protokoll weist den Eingriff mit `FORMAT-FIX angewendet` aus — kein stiller Eingriff. Bleiben sie rot, war das Format nicht die Ursache, und das Paket bricht ab, seine Reste gehen in den Stash. Hintergrund: Ein einzelner falsch umbrochener Javadoc-Kommentar hat einmal einen kompletten Nachtlauf beendet, obwohl die Arbeit korrekt war. Ein Formatverstoß ist deterministisch behebbar und sagt nichts über die fachliche Qualität — ein fehlgeschlagener Test dagegen schon, und mit ihm bricht das Paket ab. Ohne das Feld ändert sich nichts.

### Der Zeitabbruch

**Eine Session, die an der Uhr endet, hinterlässt einen Vermerk.** Bis v3.3 blieb vom Zeitlimit nur der Grund `Grund: Session am Zeitlimit beendet` — morgens stand an der Karte, *dass* die Zeit ausging, aber nichts darüber, wie weit die Sitzung gekommen war. Seither hängt der Runner in diesem Fall einen Kommentar unter dem Anker `## Nachtlauf: Zeitgrenze erreicht` an das Arbeitspaket. Er trägt vier Dinge: die Grenze, mit der diese Runde gerechnet hat (fehlt sie, steht „Grenze nicht bekannt" und keine erfundene Zahl); den **Stand nach eigener Auskunft der Sitzung**, also die Zeilen `FORTSCHRITT: AK<n> — …`, die sie unterwegs gemeldet hat; eine **Empfehlung** an den Menschen, das Paket in Teile zu schneiden, ausdrücklich als Vorschlag und **keine Vorgabe**; und die Reste im Arbeitsverzeichnis, sofern welche liegen.

Drei Zustände des Standes werden unterschieden und stehen verschieden im Text: „nicht beobachtet" (die Runde lief ohne Strom), „keine Auskunft" (die Sitzung hat bis zum Abbruch keine Fortschrittszeile gemeldet) und der gemeldete Stand selbst. Die ersten beiden zusammenzufassen wäre dieselbe Lüge wie eine 0 für einen fehlenden Messwert. Einen Schlusstext gibt es strukturell nicht: Am Zeitlimit wird die Sitzung samt Prozessgruppe gekillt, ein `result`-Ereignis kommt nie an.

**Aus dem Abbruch folgt keine Aussage über seine Ursache.** Dass die Zeit ausging, sagt nicht, ob das Paket zu groß geschnitten war, ob die Sitzung sich verlaufen hat oder ob ein einzelner Lauf ungewöhnlich lange gebraucht hat. Der Vermerk sagt das selbst — und deshalb sagt es auch keine andere Stelle anders: weder die Grund-Tabelle oben noch der Timeout-Absatz in „Wenn etwas schiefgeht".

**Gezählt wird der Fall zweimal.** Die Einheit im Ergebnisstand trägt `zeitlimitBeendet: true` — das Feld fehlt, wo der Fall nicht eintrat, statt `false` zu tragen: Ein `false` behauptete eine Messung, die es nicht gab. Der Lauf-Kopf desselben Standes trägt `zielUmsetzungMin`, die Zielmarke, mit der dieser Lauf gerechnet hat; die Auswertung misst jeden Stand gegen seine eigene Marke statt gegen die heutige Konfiguration, denn die kann zwischen zwei Nächten eine andere gewesen sein. Was daraus wird, steht unter [Aufwand des Prozesses](#aufwand-des-prozesses).

**Vorher schon sichtbar: die Einschätzung am Paket.** Jedes Arbeitspaket trägt seit `/issues` die Zeile `Sitzungsumfang: passt | reisst — <ein Satz>` in seinem `## Kontext`. Der Stufen-Block des Nachtberichts der Kette fasst sie zusammen und schließt mit der Zeile `- Voraussichtlich über der Sitzungszeitgrenze: #N, #M`; liegt kein solcher Fall vor, steht dort „keine", und ein Paket ohne die Zeile erscheint als „#N nicht eingeschätzt" — ein fehlendes Urteil ist kein gutes. Ohne diese Zeile müsste man morgens jede Karte öffnen, um die großen Pakete zu finden.

**Maßstab der Einschätzung ist die Zeitgrenze *einer Sitzung*** — `--timeout-min`, Vorgabe 60 Minuten, auch in der Nacht-Kette, wo jede Session mit derselben Grenze startet. Ausdrücklich **nicht** gemeint ist `night.kette.umsetzungMin`: Das ist das Budget der ganzen Umsetzungsstufe, wird nur zwischen zwei Sessions geprüft und sagt über ein einzelnes Paket nichts. Ebenso wenig gemeint ist die Zielmarke `night.zielUmsetzungMin` — sie ist eine Messlatte für die Auswertung, keine Abbruchgrenze.

### Das festgefahrene Paket

**Eine Sitzung, die immer wieder an derselben Prüfung scheitert, endet vor ihrer Zeitgrenze.** Bis dahin lief ein solches Paket weiter, bis die Uhr es stoppte, standardmäßig nach 60 Minuten: Die Sitzung änderte etwas, die Prüfung blieb rot, aus demselben Grund wie vorher. Die Zeit fehlte den übrigen Paketen der Nacht, und morgens stand am Paket nur der Vermerk zur Zeitgrenze, nicht, woran es hing. Seither bremst das Prüfwerkzeug selbst.

**Gezählt wird je Prüfung.** `checks.mjs run` merkt sich zu jedem roten Kommando seinen Fehlerabdruck: die Namen der gescheiterten Tests, bei einer Prüfung ohne Testnamen wie einem Build die erste Fehlermeldung. Zeitstempel, Dauern, temporäre Pfade und Zufallswerte bleiben dabei außer Acht. Scheitert dieselbe Prüfung hintereinander mit demselben Abdruck, wächst ihre Folge; grüne Ergebnisse anderer Prüfungen unterbrechen sie nicht. Sie endet erst, wenn genau diese Prüfung grün wird oder anders scheitert — ein anderer Test als zuvor gilt als Fortschritt. Als Versuch zählt jeder echte Lauf über `checks.mjs run`, Teilläufe eingeschlossen; ein übernommenes Ergebnis zählt nicht, ebenso wenig ein Test, den die Sitzung außerhalb des Werkzeugs startet.

**Die Grenze ist `night.festgefahrenNach`**, Vorgabe 3. Erreicht die Folge sie, kündigt der Lauf den letzten erlaubten Versuch an. Unbeaufsichtigt (gesetztes `KIT_AGENT_MODEL`) fährt der nächste Aufruf nichts mehr, auch nicht mit `--fresh`: Er gibt `Pruefung festgefahren: <Kommando> — <Fehler>` aus, lässt die vorige Zusammenfassung stehen, ergänzt allein `festgefahren.ausgeloest` und endet mit Exitcode 3. Die Bremse ist eine Regel des Werkzeugs, keine Bitte an das Modell: Die Sitzung bekommt kein Prüfergebnis mehr. Der Nacht-Runner erkennt die Marke im Strom und beendet die Sitzung.

**Was der Runner danach tut.** Für das Paket beginnt kein Rettungsversuch, der liefe nur erneut gegen dieselbe rote Prüfung. Liegen Änderungen im Arbeitsverzeichnis, sichert er sie wie bei jedem abgebrochenen Paket im Stash `nachtrest #<id> <lauf>`; misslingt das, endet die Nacht mit einem harten Stopp. Das Paket bekommt den Laufstand `run:aborted` mit dem Grund `Grund: Session an einer Pruefung festgefahren` und geht ins Backlog, die übrigen Pakete laufen auf sauberem Stand weiter. Ein eigenes Label gibt es nicht.

**Woran du es morgens erkennst.** Am Paket hängt ein Vermerk unter dem Anker `## Nachtlauf: an einer Pruefung festgefahren`. Er nennt die Prüfung, den wiederkehrenden Fehler, die Zahl der Versuche, die Laufzeit bis zum Abbruch und die Zeitgrenze der Sitzung; den Stash-Namen trägt der Kommentar davor, und war nichts zu sichern, sagt der Vermerk das selbst. Im Nachtbericht steht das Paket als eigener Ausgang: im Prüfbericht eine Zeile `festgefahren an <Prüfung> (<n> Versuche)` mit Laufzeit, Zeitgrenze und `gesparte Zeit (Schaetzung)`, unter `### Umsetzung` der Kette in der Liste „festgefahren“, und die Schlusszeile des Runners zählt `, N festgefahren`. Vom Zeitabbruch und von der wartenden Sitzung ist es damit getrennt: Dort ging die Zeit aus oder die Sitzung wartete; hier hing sie nachweislich an einer Prüfung.

**Weiter geht es so.** Den Fehler im Vermerk lesen, die Reste mit `git stash list` suchen und mit `git stash apply stash@{<n>}` zurückholen, das Paket nachbessern oder anders schneiden und es wieder nach Ready ziehen — erst dein neues GO lässt es wieder laufen. Ist es erledigt, räumt `git stash drop stash@{<n>}` den Eintrag.

**Interaktiv bricht nichts ab.** Ist `KIT_AGENT_MODEL` leer, gibt der Lauf nach dem letzten erlaubten und jedem weiteren gleichen Fehlschlag nur `Hinweis: festgefahren an <Kommando> — <n>-mal gleich gescheitert (<Fehler>)` aus; Ergebnis und Exitcode bleiben, du entscheidest.

### Zweiter Modus: die Nacht-Kette

**Seit dem Prozess-Umbau (September 2026) gibt es zwei Betriebsarten: die Umsetzungsnacht oben und die Nacht-Kette.** Die früheren Modi Review und Erzeugung sind mit Stufe 2 des Umbaus aus dem Runner entfallen; die Prüfkette dahinter — Marker als Gate, Fundklassen, Synthese, Routing-Label je Stufe — ging schon mit Stufe 1 (Umsetzungsplan in `docs/prozess-umbau-stufe-1.md`). Die Kette ersetzt beide: Eine fachliche Anforderung geht abends hinein, morgens liegen ein geprüfter Plan, die Arbeitspakete und ein Bericht an ihr vor — oder ein fertiger Plan geht hinein und kommt als Arbeitspakete wieder heraus (siehe [Ein fertiger Plan als Auftrag](#ein-fertiger-plan-als-auftrag)). Was danach mit den Paketen geschieht, entscheidet die **Variante** der gekennzeichneten Karte: Unter **Variante A** implementiert die Kette **nichts** — die Pakete bleiben im Backlog, das GO nach Ready ist weiterhin deins, und die Umsetzung ist die Nacht danach. Unter **Variante B** zieht die Kette die Pakete selbst nach Ready und setzt sie in derselben Nacht um — dein GO liegt dann bereits in der Kennzeichnung der Karte, nicht mehr im einzelnen Zug nach Ready.

**Die Geste:** das Label `kit:night` am gegroomten `[Requirement]`-Issue im Backlog — oder an einem fertigen `[Plan]`-Dokument, siehe [Ein fertiger Plan als Auftrag](#ein-fertiger-plan-als-auftrag). Der Runner **verbraucht es beim Start** der Kette — jedes Setzen autorisiert genau eine Kette; ein Abbruch führt zu einem Bericht mit Grund und einer neuen Geste, nicht zur stillen Wiederholung. Der Labelname kommt aus `night.kette.label` und muss am Board einmal angelegt sein (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`).

**Die Pruefung als Voraussetzung.** Das Kettenlabel allein genügt nicht mehr: Die gekennzeichnete Karte muss zu Beginn des Laufs zusätzlich das Label `review:done` tragen — die fachliche Anforderung ebenso wie das Plandokument eines Plan-Auftrags. Den Weg dahin geht `/issue-review <Nummer>`, das die Karte prüft und `review:done` setzt. Fehlt es, wird sie übersprungen: Sie behält ihr Kettenlabel, die Geste ist nicht verbraucht, und er bekommt einmal den Kommentar mit dem Anker `## Kette nicht gestartet: Pruefung fehlt`, der den Grund und den Weg über `/issue-review` nennt. Das ist ein anderer Fall als der Laufstand `Kette nicht gestartet` bei gescheitertem Reviewer-Vorflug: Dort waren die Reviewer nicht erreichbar, hier fehlt die Prüfung der Anforderung selbst — beide beginnen mit demselben Text, der Hinweis ist aber ein eigener Kommentar mit Anker, der Vorflug-Befund steht im Laufstand. Wie `kit:night` und `kit:carry-through` muss `review:done` am Board einmal angelegt sein; trägt keine einzige Karte es, meldet der Runner das im Protokoll.

**Die Variante:** ein zweites, unabhängiges Label an derselben Karte, `kit:carry-through` (`night.kette.varianteBLabel`), kennzeichnet sie für Variante B. Gelesen wird es dort, wo auch `kit:night` steht — bei einem Plan-Auftrag also am Plan, nicht an der fachlichen Anforderung dahinter. Anders als `kit:night` wird es **nicht verbraucht** — es bleibt an der Karte stehen, denn es kennzeichnet die Karte selbst und nicht nur den einen Lauf; eine spätere Kette zu ihr (etwa nach `angehalten`) liest es erneut. Fehlt es, gilt Variante A. Wie `kit:night` muss es am Board einmal angelegt sein.

**Start:**

```bash
node .claude/kit/night.mjs --chain --dry-run   # Kandidaten, Reviewer-Stand, Budgets — startet nichts
node .claude/kit/night.mjs --chain             # echter Lauf
```

Flags: `--max <N>` zählt hier **Ketten** (Default 3); `--model <id>` und `--verbose` wie oben — das Live-Verlaufsprotokoll läuft also auch hier ohne Flag, `--verbose no` schaltet es ab. `--label` gilt hier nicht — die Kette liest ihr Label aus der Config, und `--chain --label` wird abgewiesen. Die Schalter der entfallenen Modi weist der Runner mit einem Hinweis auf `--chain` ab; ein noch gesetztes altes Routing-Label bekommt eine Protokollzeile, keine Wirkung. Die `buildChecks`-Pflicht entfällt für die Kette: Sie baut nichts und committet nichts.

**Bedingungen:** Ein Kandidat trägt das Label, hat den Titel `[Requirement]` (oder `[Plan]`, siehe [Ein fertiger Plan als Auftrag](#ein-fertiger-plan-als-auftrag)), steht im **Backlog** und trägt kein `kit:clarify` — dort wartet eine Antwort, die vorher im Plan stehen muss. Eine Karte ohne beide Präfixe wird mit dem Grund übersprungen, dass das Kennzeichen an der fachlichen Anforderung oder am Plandokument gilt. Was das Label trägt, aber nicht laufen darf, steht mit Grund als `uebersprungen` im Ergebnisstand, und das Label bleibt. Vor der ersten Kette läuft der **Reviewer-Vorflug** wie früher: eine eigene Vorflug-Session prüft die Reviewer und den Tracker in der Umgebung der Sessions, nicht im Runner (siehe Allowlist unten). Schon davor steht jeder Kandidat im [Laufstand](#der-laufstand) auf `run:running` mit „Lauf angenommen um …, Vorabprüfung läuft“ — stirbt der Lauf in der Vorabprüfung, bleibt die Karte so nicht spurlos. Scheitert er, wird daraus `run:aborted` mit `Kette nicht gestartet um <Zeit>: <Grund>` im Laufstand, jeder Kandidat behält sein Label, und der Lauf endet hart — die Geste ist nicht verbraucht, denn es lief nichts. Ein eigener Kommentar entsteht dafür nicht mehr. Ein Trockenlauf setzt keinen Stand. Anders als die Umsetzungsnacht verlangt die Kette **keinen sauberen Arbeitsbaum und keine leere In-progress-Spalte**: Sie arbeitet in einem eigenen Worktree und läuft neben einer Umsetzungsnacht.

**Der Worktree.** Jede Kette bekommt einen `git worktree` unter dem Temp-Verzeichnis (`kette-<repo>-<F>-<stempel>`), in den der Runner `.claude/` der Hauptkopie spiegelt — Kit-Kopie, Skills, Settings, Token —, ohne die Protokolle. Beim lokalen Tracker zeigt die Config im Worktree auf das `issues`-Verzeichnis der Hauptkopie, damit die Karten dort entstehen. Nach der Kette wird der Worktree entfernt, und liegengebliebene Worktrees räumt der nächste Start.

**Der Ablauf je Stufe**, jede mit eigener Session im Worktree und gesetztem `KIT_AGENT_MODEL`:

| Stufe | Session | Ergebnis | wann die Kette hier endet |
|---|---|---|---|
| plan | `/techplan #F` | ein `[Plan]`-Dokument mit `Fachliche Quelle: Issue #F` — bei mehreren das jüngste | kein Plan: `abgebrochen`; Stopp-Frage in `## Offene Fragen`: `angehalten` — auch die Frage zu einem offenen Vertrag mit dem anderen Repo (P14), die alle offenen V-Nummern aufzählt |
| Formprüfung | `issue check-form` im Worktree der Kette, bei Rot eine Korrektursession mit genau den Verstößen — verlangt eine Meldung eine Frage unter `## Offene Fragen` (P14), schreibt sie diese dorthin, eine Zeile `Entschieden:` nie; bleiben beim Plan Testhinweise stehen, schreibt der Runner sie als Kommentar `## Testhinweise der Formpruefung` an den Plan | grüne Form, bis zu `korrekturrunden` Runden je Dokument; Testhinweise halten nichts an | weiterhin rot: `abgebrochen` |
| review | `/issue-review #M` — der Prüfer der Stufe `plan` | Marker `Plan-Review:`, Befunde und Einarbeitung als Kommentare am Plan | `kit:clarify` am Plan: `angehalten` mit der Frage aus dem letzten Kommentar |
| pakete | `/issues #M` | nur Karten mit `Plan: Issue #M` zählen; jede geht durch die Formprüfung | kein Paket und der Kommentar `Kein Eingang für /issues` am Plan: `angehalten`; kein Paket ohne ihn: `abgebrochen` |
| abdeckung | eine lesende Session hält die Pakete gegen den Fachplan oder gegen den Plan | ihr Text — Zuordnung, Ohne Paket, Zuwachs — im Ergebnisstand und im Bericht | nie: Die Abdeckung ist eine Auskunft, kein Tor; fehlt sie, steht der Grund im Bericht |
| umsetzung (nur Variante B) | `/implement-next #P` je Arbeitspaket, wortgleich mit der Umsetzungsnacht | Paket nach Ready gezogen, umgesetzt (In review) oder zurückgestellt; die Session erfährt von der Kette nichts, sie sieht ein reguläres Ready-Paket | Lock `night-umsetzung.lock` bereits gehalten **oder** Hauptkopie vor dem ersten Paket unsauber: Stufe ausgelassen, Rückfall auf Variante A, `unvollstaendig`; harter Stopp: `abgebrochen`; mindestens ein Paket hält an einer Stopp-Frage: `angehalten` (das Paket trägt `kit:clarify` bereits selbst, der Fachplan bekommt keinen zweiten Halt) |

Andere neue Karten ohne die Herkunftszeile stehen als „nicht zuordenbar" im Bericht; schreibt die Abdeckungs-Session entgegen ihrem Auftrag am Board, vermerkt der Bericht auch das.

**Eine Kette ohne ausgeführte Umsetzung heißt nicht gelungen.** Lässt die Stufe `umsetzung` ihre Arbeit aus — weil eine andere Umsetzung den Lock hält oder die Hauptkopie vor dem ersten Paket unsauber ist —, endet die Kette auf dem Ausgang `unvollstaendig`, nicht auf `fertig`. Er steht zwischen den beiden: Die Kette lief durch und hat etwas Bestelltes nicht getan; sie hält niemanden auf (anders als `angehalten` wartet keine Frage auf dich) und es ist nichts gerissen (anders als `abgebrochen`). Am Board erscheint der Vorgang **gelb ohne Fehlerklasse**, den Grund trägt sein Auszug. Der Nachtbericht nennt unter `### Umsetzung` als erste Zeile `- ausgelassen: <grund> — die Pakete bleiben in Backlog.`, und der Grund steht mit dem Präfix `Umsetzung ausgelassen:` schon oben unter `### Ausgang`. Damit ist am Morgen ohne Blick ins Protokoll zu sehen, dass die Bestellung „zieh die Pakete gleich durch" nicht ausgeführt wurde, was sie verhindert hat und wo die Pakete jetzt liegen. Vorher war dieser Fall von einer gelungenen Nacht nicht zu unterscheiden. **Die Sperre selbst bleibt:** Zwei Umsetzungen in einem Arbeitsverzeichnis gehen nicht, die Kette wartet nicht auf das Freiwerden und fällt wie bisher sofort auf Variante A zurück. Geändert hat sich allein, was du danach siehst. Die Pakete ziehst du morgens selbst nach Ready.

**Ohne Review-Freigabe fällt Variante B auf Variante A zurück.** Trägt das Projekt `issueReview.requiredBeforeReady: true`, prüft die Stufe `umsetzung` jedes Paket mit demselben Gate wie die Umsetzungsnacht — und frisch aus `/issues` geschnittene Pakete tragen noch keinen Review-Marker. Jedes Paket fällt damit aus der Stufe heraus und bleibt kommentiert in Backlog stehen; die Kette endet für diese Nacht wie unter Variante A, mit geprüftem Plan und Paketen im Backlog, ohne Umsetzung. Der Bericht nennt den Grund je Paket.

**Bricht die Review-Stufe ab, nachdem die Befunde schon am Plan stehen**, hinterlässt die Kette dort den Kommentar `## Review unvollstaendig` mit dem Grund des Abbruchs und dem Weg nach vorn (`/issue-review #M` von Hand). Genau diese Lücke trifft ein Abbruch am häufigsten — die Einarbeitung steht am Ende der Stufe —, und ohne Vermerk sieht das Dokument später aus wie ein ungeprüftes: Die Prüfung ist bezahlt, die Befunde stehen am Board, der Body trägt keinen `Plan-Review:`-Marker. Den Ausgang ändert der Vermerk nicht, er bleibt `abgebrochen` mit seinem Grund.

**Drei Ausgänge**, je Kette genau einer: `fertig` (Plan geprüft, Pakete liegen im Backlog), `angehalten` (eine Frage der Stopp-Klasse wartet auf dich) und `abgebrochen` (technisch oder am Budget gescheitert, mit Grund). Abbruchgründe sind: kein Plan oder kein Paket entstanden; Form nach den Korrekturrunden weiterhin verletzt; Zeitbudget einer Stufe erschöpft; Kostenbudget überschritten — geprüft **nach** der Session, nie mittendrin, denn ein halb geschriebenes Dokument wäre der teurere Fehler; Fehlstart einer Session; eine Stufen-Session, die mit laufender eigener Arbeit aufgehört hat ([Die wartende Sitzung](#nachtbetrieb), Ausnahme ist die Stufe `abdeckung`) — sie hinterlässt ihren Vermerk am Dokument ihrer Stufe. Ein Abbruch beendet nur diese Kette, der nächste Kandidat kommt dran.

**Budgets** stehen in `night.kette` der `workflow.config.json`, alle optional, mit diesen Startwerten:

```json
{
  "night": {
    "kette": {
      "label": "kit:night",
      "varianteBLabel": "kit:carry-through",
      "planMin": 20,
      "reviewMin": 15,
      "paketeMin": 15,
      "abdeckungMin": 10,
      "umsetzungMin": 120,
      "vorbereitungMin": 120,
      "kostenUsd": 50,
      "kostenUsdB": 150,
      "korrekturrunden": 2
    }
  }
}
```

`varianteBLabel` kennzeichnet die gekennzeichnete Karte für die Umsetzungsstufe (Variante B); `umsetzungMin` ist ihr Zeitbudget, `kostenUsdB` ihr eigener Kostendeckel.

Die Minuten gelten je Stufe (Korrekturrunden zählen gegen ihre Stufe), `kostenUsd` je Kette über alle Sessions, `korrekturrunden` je Dokument. Die Kette fordert den Session-Strom immer an: Kosten und Kennzahlen stehen je Stufe im Ergebnisstand (`art: "kette"`, die Budgets im Lauf-Kopf); eine Session ohne Kennzahl zählt 0 und erhöht `kostenUnbekannt`. Fehlt der Block oder einzelne Felder darin, gelten die Startwerte — und das ist sichtbar: Vor der ersten Kette nennt eine Protokollzeile die betroffenen Felder mit ihrem Wert, und der Lauf-Kopf des Ergebnisstands trägt sie als `budgetAusDefault`.

**Der Bericht an der gekennzeichneten Karte.** Bei jedem Ausgang hinterlässt die Kette einen Kommentar mit dem Anker `## Nachtbericht, Kette <stempel>` — an der Karte, an der du das Label gesetzt hast, beim Plan-Auftrag also am Plan: der Ausgang mit Grund; die Stufen (zuerst der Auftrag — `Plan #M (fachliche Quelle #F)` oder `fachliche Anforderung #F` —, dann die Variante, dann der Plan mit Dauer, Kosten, Korrekturrunden, Prüfer und Marker, beim übernommenen Plan stattdessen `als Auftrag uebernommen, nicht neu geschrieben`; Pakete mit Titeln; nicht zuordenbare Karten); **alle Entscheidungen der Nacht**, fortlaufend nummeriert — die Aufzählungspunkte aus `## Architektonische Entscheidungen` des Plans wörtlich und die `Entscheidung:`-Zeilen aus dem Kontext der Pakete; die abgelehnten Befunde aus dem Kommentar `## Einarbeitung, Runde 1`; die Abdeckung; Kennzahlen (Pakete erreicht, Dauer ab Kettenstart, Zahl der Entscheidungen und der Stopp-Fragen, Kosten von Budget, `kostenUnbekannt`); bei `angehalten` die offene Stopp-Frage; überholte Pläne; unter Variante B der Abschnitt `### Ursprungsdokumente` — welche Ursprungsdokumente nach In review gewandert sind oder, wenn der Plan nicht durch ist, warum nicht und welche Pakete fehlen. Er endet mit dem Satz `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` — und genau das ist das Morgen-Ritual: Bericht lesen, Plan und Pakete sichten, was gelten soll als Satz in den Fachplan schreiben, Pakete nach Ready ziehen.

**Wartende Berichte.** Nimmt der Tracker den Kommentar nicht an, liegt der Bericht als `.claude/night-bericht-<F>-<stempel>.md` in der Hauptkopie — kein Rest im Arbeitsbaum, wie `night-run-*` —, und das Feld `bericht` der Einheit nennt den Pfad. Beim nächsten Start jeder Betriebsart (nicht im Dry-Run) trägt der Runner wartende Berichte nach und löscht die Datei; bleibt der Tracker tot, bleibt sie liegen und der Lauf geht weiter.

**Der Rückweg nach `angehalten`.** Die Kette schreibt die eine Frage als Kommentar `## Kette angehalten` an die **gekennzeichnete Karte** — die, an der du abends das Label gesetzt hast — und setzt dort `kit:clarify`; Plan und bis dahin geschnittene Pakete bleiben als Entwurf stehen. Der Weg nach vorn führt über den **Plan**, und der Kommentar zählt seine Schritte auf: die Antwort als Eintrag unter `## Architektonische Entscheidungen` des Plans, `## Offene Fragen` wieder auf `- Keine.` (ein Zusatz dahinter ist erlaubt), `/issue-review #M`, `kit:clarify` am Plan und an der fachlichen Anforderung abnehmen, zuletzt `kit:night` an den Plan. Die nächste Kette nimmt ihn dann als **Plan-Auftrag** und fährt von der Stufe `pakete` an weiter. Die Antwort gehört **nicht** unter `## Offene Fragen`: Dort liest die Kette sie als weitere offene Frage und überspringt den Plan mit deinem eigenen Antworttext als Ausschlussgrund. Entsteht stattdessen ein neuer Plan (weil du erneut vom Fachplan aus startest), ist er der gültige; ältere Pläne zum selben Fachplan bekommen den Kommentar `Ueberholt durch Plan #M2` (kein Label, kein Move) und stehen im Bericht unter „Ueberholt". Jeden dieser Kommentare liest die Kette einmal zurück; findet sie ihn an der Karte nicht wieder, läuft sie weiter, führt den Plan aber nicht als überholt, sondern mit Grund unter „Ueberholt, nicht bestaetigt" — ein Bericht, der eine Handlung behauptet, die am Board niemand sieht, ist schlimmer als keiner. `kit:clarify` nimmt ausschließlich der Mensch ab — ein Lauf, der sein eigenes `kit:clarify` abräumen dürfte, könnte sich selbst freigeben.

**Kette und Umsetzung nebeneinander.** Die beiden Betriebsarten meinen verschiedene Karten und Spalten: `kit:night` am Fachplan im Backlog, `kit:nightrun` am Arbeitspaket in Ready. Ein Lauf ist immer genau eine Betriebsart (`--chain` oder nicht), aber zwei Läufe dürfen zur selben Zeit fahren — die Kette im Worktree, die Umsetzung in der Hauptkopie. Eine Einschränkung gilt unter **Variante B**: Ihre Stufe `umsetzung` baut wie die Umsetzungsnacht in der Hauptkopie, nicht im Worktree, und beide nehmen dafür denselben Lock `.claude/night-umsetzung.lock` — wer ihn zuerst hält, baut. Die Umsetzungsnacht lässt ihre Umsetzung bei belegtem Lock aus; die Kette wartet und versucht es alle 60 Sekunden erneut, höchstens bis ihr Umsetzungsbudget (`night.kette.umsetzungMin`) verbraucht ist — die Wartezeit zählt dazu, der Laufstand bleibt `läuft` mit dem Text „wartet auf die Umsetzung seit …“. Wird die Umsetzung nicht frei, lässt die Kette sie aus und endet als `unvollstaendig`. Unter Variante A gilt die Einschränkung nicht: Die Kette baut nie, und der Lock bleibt frei. **Der Zustand der Hauptkopie hält die Kette nicht auf:** Unkommittierte Reste — etwa aus einer parallel laufenden Umsetzungsnacht — prüft sie weder vorab noch nach der Vorflug-Session, weil sie die Hauptkopie gar nicht anfasst. Nur unter Variante B misst sie ihn einmal vor dem ersten Paket: Ist die Hauptkopie dann nicht sauber, lässt sie die Umsetzung **regulär aus** wie beim gehaltenen Lock — die Pakete bleiben in Backlog, der Grund mit den Dateinamen steht im Bericht, und der Lauf endet ohne Fehler. Bereinigen und die Pakete selbst nach Ready ziehen erledigt dann der Mensch.

**Ein Runner je Wurzel.** Es dürfen mehrere Ketten und Prüfläufe nebeneinander laufen, auch auf zwei Rechnern am selben Board. Eine fachliche Wurzel — die Anforderung samt den Plänen zu ihr — bearbeitet dabei genau ein Runner. Er beansprucht sie bei der Auswahl: Er liest den Laufstand der Karte, schreibt seinen eigenen Laufstand `läuft` mit den Zeilen `Lauf-ID: <host>/<pid>/<stempel>`, `Stand: <Zeit>` und `Position: <k> von <n>`, wartet eine Bestätigungsfrist und liest erneut. Gehört der jüngste Laufstand dann ihm, ist die Wurzel seine; sonst lässt er sie aus, nennt sie im Protokoll mit dem Grund „bereits von einem laufenden Runner beansprucht (`<Lauf-ID>`)“ und trägt sie im Journal als `abgegeben` aus, ohne die Karte weiter zu berühren. Eine beanspruchte Karte erkennt man also am Laufstand `läuft` mit Lauf-ID. **Übernahme nach einem Absturz:** Eine Lauf-ID gilt als tot, wenn auf demselben Rechner ihr Prozess nicht mehr läuft, oder von einem anderen Rechner aus, wenn `Stand:` älter ist als Position mal Gesamtbudget der Laufart plus 15 Minuten. Dann übernimmt ein späterer Start die Wurzel und nennt die Übernahme im Protokoll; die Kennzeichnung bleibt stehen, neu kennzeichnen muss niemand. **Geräumt wird nur, was einem toten Prozess gehört:** Jeder Worktree und jeder Kit-Stand trägt eine Halter-Datei `<ordner>.halter` mit Rechner und Prozess; ein Start entfernt nur Ordner ohne Halter oder mit beendetem Prozess und nennt die entfernten Reste im Protokoll.

#### Wie weit eine Kette läuft: das Ziel

**Das Ziel sagt, wo die Kette endet.** Ohne weiteres Label läuft eine Kette so weit, wie Variante und Projekt es zulassen. Mit einem Ziel-Label legst du je Karte fest, wie weit sie diesmal laufen soll: Diesen Fachplan lässt du nur planen und prüfen, jenen bis zu den Paketen, einen dritten bis zur Umsetzung und einen vierten bis zur vorbereiteten Veröffentlichung. Die Stufen stehen in fester Reihenfolge; ein Ziel bestimmt nur, wo die Kette endet, überspringen oder umstellen lässt sich nichts. Das Ziel hängt an derselben Karte wie `kit:night` — an der fachlichen Anforderung oder am Plandokument — und wirkt nur zusammen mit ihm: Ein Ziel ohne `kit:night` startet nichts und bleibt stehen.

| Ziel | letzte Stufe | was morgens dir gehört |
|---|---|---|
| `goal:plan` | `review` | Plan lesen, dann `kit:night` an den Plan. Der Plan ist geprüft, Pakete gibt es noch keine; die nächste Kette zerlegt ihn als Plan-Auftrag. |
| `goal:packages` | `abdeckung` | Pakete nach Ready ziehen. Plan, Pakete und ihre Abdeckung gegen die Anforderung (beim Plan ohne Anforderung gegen den Plan) liegen vor, gebaut ist nichts. |
| `goal:implementation` | `umsetzung` | Pakete in In review testen, dann `push main`. Die Kette hat die Pakete selbst nach Ready gezogen und umgesetzt, wie unter Variante B. |
| `goal:push-prepared` | `vorbereitung` | Meldung der Vorbereitung lesen, dann `push main`. Zusätzlich liegen Versionsvermerk und Änderungsnotiz als geprüfter Commit bereit, siehe [/push-main](/prozess#push-main). |

Die letzte Spalte steht nach dem Ende am Ziel wörtlich im [Laufstand](#der-laufstand), in der Zeile `Als Nächstes:` unter dem Kopf `fertig bis <Ziel>`. Wartet unter den nicht begonnenen Paketen ein Menschenschritt (`[Human]`-Karte), lautet sie stattdessen `Menschenschritt #<N> erledigen, dann kit:night an #<Karte> — <K> Paket(e) hängen daran.`, und der Nachtbericht führt unter `### Ausgang` unter `fertig` je Menschenschritt die Zeile `wartet auf Menschenschritt #<N> <Titel> — daran hängen #A, #B, …` (auch die Pakete, die nur mittelbar über andere daran hängen).

**Das GO steckt im Ziel.** Ein Ziel ab `umsetzung` ist zugleich das GO für die Pakete dieser Karte, genau wie `kit:carry-through`. Das bleibt gültig und zählt als `goal:implementation`; tragen beide an einer Karte, gilt das weiter reichende. Ohne eines von beiden zieht die Nacht kein Paket nach Ready. Den Push gibt auch `goal:push-prepared` nicht frei: Er bleibt deine Trigger-Phrase `push main`.

**Wie viele Modelle den Plan prüfen.** An einer fachlichen Anforderung legt `planreview:1` oder `planreview:2` fest, ob ein Modell oder zwei verschiedene den Plan prüfen; mehr gibt es nicht. Ohne Label gilt die Einstellung des Projekts. Zwei wählst du, wenn dir ein Plan heikel genug erscheint. Die Review-Stufe gibt die Zahl als `KIT_PLAN_REVIEWER` an ihre Session.

**Verbraucht wie `kit:night`.** Beim Start nimmt der Runner `kit:night`, das Ziel und `planreview:*` zusammen ab — jedes Setzen gilt für genau einen Lauf. Was gesetzt war, liest du danach im Laufstand in den Zeilen `Ziel:` und `Prüfer:`. Startest du eine Kette nach einem Halt oder nach dem Stehenbleiben an der Projektgrenze neu, gilt nur ein neu gesetztes Ziel; ohne verhält sie sich wie eine Kette ohne Ziel. `kit:carry-through` wird dagegen weiterhin nicht verbraucht.

**Die Labels je Board einmal anlegen.** `goal:plan`, `goal:packages`, `goal:implementation`, `goal:push-prepared`, `planreview:1` und `planreview:2` müssen wie `kit:night` je Board einmal angelegt sein (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`). Ihre Namen sind fest und nicht konfigurierbar.

**Was nicht passt, wird abgelehnt, bevor etwas entsteht.** Die Auswahl lehnt eine Karte mit dem Grund `unpassende Einstellung: …` ab, wenn sie

- mehr als ein `goal:*` oder beide `planreview:*` trägt,
- als Plandokument `goal:plan` trägt (der Plan steht schon) — gemeint ist `goal:plan` an einem Plandokument,
- als Plandokument ein `planreview:*` trägt — die Prüferzahl gilt nur an der fachlichen Anforderung, `planreview:*` an einem Plandokument wird darum abgelehnt,
- als fachliche Anforderung `planreview:*` trägt, ihr Plan aber schon einen `Plan-Review:`-Marker hat.

Die Karte behält dann alle ihre Labels und bekommt einmal den Kommentar `## Kette nicht gestartet: unpassende Einstellung` mit dem Grund und dem Schritt, der sie wieder startbar macht. Die Geste ist nicht verbraucht.

**Das Projekt bleibt Obergrenze.** Sperrt `night.kette.uebergaenge` einen Übergang vor dem Ziel, endet die Kette dort: Der Laufstand zeigt `run:waiting` mit `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` und nennt in der Zeile `Grenze:` die letzte erreichbare Stufe, und der Nachtbericht schreibt unter `### Ausgang` zusätzlich die Zeile `an der Projektgrenze stehen geblieben, nicht am Ziel <z>`. Für den Übergang in die Vorbereitung gibt es den fünften Schalter `umsetzungVorbereitung`; er steht ohne Eintrag auf `true`, nur ein ausdrückliches `false` hält die Kette vor der Vorbereitung an.

**Die Vorbereitung gehört dem ganzen Stand.** Erreicht mindestens eine Kette das Ziel `push-vorbereitet`, folgt nach allen Ketten des Laufs einmal die Stufe `vorbereitung`. Sie wartet, bis nichts mehr baut — bis die Umsetzungssperre frei ist und kein anderer Lauf dieses Projekts mehr baut —, höchstens `night.kette.vorbereitungMin` Minuten (Vorgabe 120, Warten und Prüflauf zusammen). Dann startet sie `/push-main prepare` in einem eigenen Worktree; was dort geschieht und wie `push main` den Stand morgens übernimmt, steht unter [/push-main](/prozess#push-main). Gepusht wird nachts nichts. Die Meldung steht als eigener Nachtbericht `## Nachtbericht, Kette <stempel> — Vorbereitung` an jeder Karte, die die Vorbereitung ausgelöst hat — mit Ergebnis, geprüftem Stand, den Paketen im Stand, offenen Prüfungen und gegebenenfalls der roten Prüfung samt den Karten, die sie berührt —, und an der festen Stelle `.claude/push-vorbereitung.json`. Läuft die Frist ab, heißt das Ergebnis „nicht vorbereitet“ mit dem Grund.

#### Ein fertiger Plan als Auftrag

**Die Geste am Plan.** Die Kette nimmt nicht nur eine fachliche Anforderung an, sondern auch ein fertiges Plandokument: `kit:night` an einem `[Plan]`-Issue im Backlog startet einen **Plan-Auftrag**. Das ist der Weg zurück aus einem Halt (siehe unten) und zugleich der Weg, einen tagsüber von Hand geschriebenen Plan über Nacht zerlegen zu lassen.

**Die vier Bedingungen** sind dieselben wie bei der fachlichen Anforderung, nur an der anderen Karte gemessen: Der Plan steht im **Backlog**, trägt `review:done`, trägt **kein** `kit:clarify` und hat eine gültige Herkunft. Für die Herkunft gibt es drei Lagen:

- **Keine Zeile `Fachliche Quelle:`** — der Plan ist ohne fachliche Anforderung entstanden, etwa aus einer Idee über `/triage` oder aus einem Gespräch. Er läuft als seine eigene Wurzel, und die Abdeckung hält die Pakete gegen den Plan; der Bericht sagt das.
- **Die Zeile `Fachliche Quelle: Issue #N` trifft eine Karte** — der Plan läuft wie bisher, die Abdeckung hält die Pakete gegen die Anforderung `#N`.
- **Die Zeile zeigt ins Leere** — sie nennt eine Karte, die sich nicht finden lässt. Der Plan bleibt liegen, und der Bericht nennt die Zeile.

Fehlt eine der Bedingungen, wird der Plan mit Grund übersprungen und behält sein Kettenlabel; die Geste ist nicht verbraucht. Dazu zählt auch eine offene Frage im Dokument selbst: Unter `## Offene Fragen` muss `- Keine.` stehen (ein Zusatz dahinter ist erlaubt).

**Was entfällt.** Ein Plan-Auftrag fährt die Stufen `plan` und `review` **nicht** — der Plan ist geschrieben und geprüft. Der Lauf beginnt bei der Stufe `pakete` (`/issues #M`) und geht weiter wie sonst: Abdeckung gegen die fachliche Anforderung `#N` oder gegen den Plan, unter Variante B die Umsetzung. Der Plan bleibt dabei unangetastet: Es entsteht **kein** zweites `[Plan]`-Dokument, seine Nummer wandert unverändert in die Herkunftszeile der Pakete und in den Bericht, und **kein** älterer Plan bekommt einen `Ueberholt durch Plan`-Kommentar. Im Bericht steht die Plan-Stufe deshalb als `als Auftrag uebernommen, nicht neu geschrieben` statt mit Dauer und Kosten.

**Die Variante am Plan.** `kit:carry-through` liest die Kette an derselben Karte wie `kit:night` — bei einem Plan-Auftrag also am Plan. Ein `kit:carry-through` an der fachlichen Anforderung dahinter bleibt dabei wirkungslos: Es gilt **Variante B** nur, wenn der Plan selbst gekennzeichnet ist.

**Zwei Kollisionsregeln** lösen auf, wenn mehr gekennzeichnet ist als nötig:

- **Die Anforderung weicht dem Plan.** Trägt eine fachliche Anforderung `#N` das Kettenlabel und zugleich ein aus ihr entstandener Plan, läuft der **Plan**; die Anforderung geht mit Grund nach `uebersprungen` und behält ihr Label. Das gilt auch, wenn der Plan selbst übersprungen wird — sonst plante die Nacht die Anforderung neu, während der fertige Plan danebenliegt.
- **Von zwei Plänen derselben Wurzel läuft der jüngere.** Tragen mehrere gekennzeichnete Pläne dieselbe fachliche Quelle, läuft der mit der höheren Nummer; der ältere geht mit Grund nach `uebersprungen`. Beide Gründe nennen die Nummer der Karte, die stattdessen läuft.

Ein Fachplan-Auftrag zu einer Anforderung und ein Plan-Auftrag zu einer anderen laufen dagegen in derselben Nacht beide — die Regeln greifen nur innerhalb derselben Wurzel. Eine weichende Karte verbraucht keinen `--max`-Platz.

#### Allowlist für fremde Reviewer

Reviewer mit `kind: "claude"` laufen als Leser-Agent `kit-pruefer` und brauchen keine Permission. Ein Reviewer mit **`kind: "command"`** wird im Review nicht mehr über die Bash der Session gestartet, sondern vom Kit: `node .claude/kit/board.mjs issue-review start` startet das fremde Werkzeug selbst, an seiner Lesegrenze. Dafür braucht der Review den Eintrag für `board.mjs` in der Allowlist und `node .claude/kit/board.mjs*` in `sandbox.excludedCommands` (siehe „Kit-Skripte mit Board-Zugriff“) — sonst läuft das Werkzeug in der Sandbox der Session, ohne Netz. Einen eigenen Eintrag für das Werkzeug braucht der Review nicht.

Der **Vorflug des Nacht-Runners** prüft die Reviewer dagegen weiter, indem er das fremde Kommando direkt startet, und braucht den Eintrag für das Werkzeug deshalb weiterhin. Fehlt er, erscheint nachts ein Permission-Prompt, den niemand beantwortet. Das ist kein Fehler mit Log-Zeile: **Die Session hängt bis zum Timeout.** Trag beides ein, bevor der erste Review-Lauf startet:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(codex:*)"
    ]
  }
}
```

Der Eintrag nennt das **Werkzeug**, nicht die volle Kommandozeile — aus demselben Grund wie bei den buildChecks oben (Präfix-Matching). Wer mehrere fremde CLIs konfiguriert hat, trägt jedes einzeln ein. Ein Setup mit ausschließlich `kind: "claude"`-Reviewern braucht den Werkzeug-Eintrag nicht.

### Der Laufstand

**Der Stand eines Laufs steht am Board, nicht im Prozess.** Bis dahin lebte er im laufenden Runner: Starb der Prozess, ging das Wissen mit ihm, denn der Nachtbericht entsteht erst beim Ausgang, und ein Absturz ist kein Ausgang. Deshalb trägt jede Karte einer Kette oder Umsetzungsnacht ihren eigenen Stand, sichtbar ohne Blick ins Protokoll.

**Drei Labels und ein Kommentar.** An der Karte hängt höchstens eines der drei Labels `run:running`, `run:aborted` und `run:waiting`, dazu genau ein Kommentar `## Laufstand`, der bei jedem Wechsel ersetzt wird. Er nennt den zuletzt begonnenen und den zuletzt abgeschlossenen Schritt, jeweils mit Zeitpunkt. Der Kommentar ist Tafel, nicht Verlauf; der Nachtbericht bleibt Verlauf. Wer wissen will, *was* in einer Nacht geschah, liest den Bericht; wer wissen will, *wo* eine Karte jetzt steht, liest den Laufstand.

**Abbruch und Halt sind unterscheidbar.** `run:aborted` heißt: technisch abgebrochen, Wiederholen genügt. `run:waiting` sagt im Laufstand wörtlich, worauf die Karte wartet, in einer von drei Formen:

- `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` — das Projekt hat den Übergang nicht freigegeben (siehe unten);
- `wartet: Karte ohne Freigabe zur Umsetzung` — der Übergang in die Umsetzung ist freigegeben, aber die Karte trägt kein `kit:carry-through`;
- „Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`“ — ein inhaltlicher Halt. Der Weg dafür über `kit:clarify` und den Kommentar `## Kette angehalten` bleibt, wie er ist.

**Ziel, Prüferzahl und Grenze.** Trug die Karte beim Start ein Ziel oder ein `planreview:*`, stehen ihre Werte in jeder Fassung unter dem Kopf, denn die Labels selbst sind dann verbraucht: `Ziel: <plan|pakete|umsetzung|push-vorbereitet>`, `Prüfer: <1|2>` und, wenn das Projekt einen Übergang vor dem Ziel sperrt, `Grenze: <letzte erreichbare Stufe>`. Endet die Kette an ihrem Ziel, lautet der Kopf `fertig bis <Ziel>`, und darunter steht die Zeile `Als Nächstes:` mit dem Schritt, der jetzt dir gehört (siehe [Wie weit eine Kette läuft](#wie-weit-eine-kette-läuft-das-ziel)). Ohne Ziel und ohne `planreview:*` sieht der Laufstand aus wie zuvor.

**Ein Protokoll je Schritt.** Jeder Schritt einer Karte — eine Stufe der Kette, eine Umsetzungsrunde, eine Prüfung des Prüflaufs — schreibt seine Runner-Zeilen und den Output seiner Session zusätzlich nach `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, ein zweiter Versuch nach `<karte>-<stufe>-v2.log`. Der Laufstand nennt den Pfad in der Zeile `Protokoll:`. So steht das Protokoll eines Schritts getrennt von gleichzeitig laufenden anderen Läufen. Das Tagesprotokoll `.claude/night-run-<datum>.log` bleibt und trägt in jeder Zeile die Lauf-Kennung in der Klammer des Zeitstempels: `[<Zeitpunkt> <lauf>]`.

**Wiederholen mit derselben Geste.** Einen eigenen Befehl für einen einzelnen Schritt gibt es nicht. `kit:night` an der Karte startet die Kette bei der ersten Stufe ohne Ergebnis: Was schon vorliegt — Plan, Prüfvermerk, Pakete, Abdeckung, umgesetzte Pakete in In review —, gilt als erledigt und entsteht nicht doppelt, auch wenn der vorige Lauf danach an der Uhr oder am Board scheiterte. Ein vorhandener Plan zählt dabei als Ergebnis, solange er nicht in Done steht; ein frischer Plan entsteht erst, wenn der alte in Done steht. Wer neu planen lassen will, schließt den alten Plan.

**Übergänge einzeln freigeben.** Welche Übergänge der Kette automatisch folgen dürfen, legt das Projekt in `night.kette.uebergaenge` fest, mit den vier Schaltern `planReview`, `reviewPakete`, `paketeAbdeckung` und `abdeckungUmsetzung`. Die Vorgabe des Kits gibt die ersten drei frei. Für `abdeckungUmsetzung` gibt es keine Vorgabe: Ohne Eintrag gilt das Verhalten von vor der Einstellung, eine Kette mit `kit:carry-through` setzt nach der Abdeckung um, eine ohne endet dort `fertig`. `abdeckungUmsetzung` wirkt nur zusammen mit `kit:carry-through` an der Karte: Das GO lässt sich nie projektweit erteilen, es bleibt an der einzelnen Karte. Ein ausdrückliches `false` hält eine Kette mit `kit:carry-through` vor der Umsetzung an, ein `true` lässt eine Kette ohne das Label mit `wartet: Karte ohne Freigabe zur Umsetzung` enden. Ein gesperrter Übergang endet mit `run:waiting` in der ersten Form oben.

**Ein Versuch, nur für den lebenden Lauf.** Einen automatischen Versuch gibt es nur bei Umgebungsfehlern, solange der Lauf lebt: Das Board war nicht erreichbar, oder eine Sitzung kam nicht zustande. Dann versucht der Lauf den Schritt nach einer Pause genau einmal erneut, und der Laufstand vermerkt „2. Versuch“. Scheitert auch er, hält der Lauf sichtbar an. Eine Sitzung, die zustande kam und ohne Ergebnis, am Zeitlimit oder ohne Nachweis endete, ist ein Paketfehler und bekommt keinen Versuch. Ein gestorbener Lauf wird nicht wiederholt: Er kann sich nicht selbst wiederholen, und ein Neustart von außen wäre ein Lauf ohne Geste. Seine Karten zeigen nach der Frist „nicht beendet“, und weiter geht es mit `kit:night`.

#### Der Wächter

Wer einen Lauf bemerkt, der ohne Abschied gestorben ist, und wann er als verstummt gilt.

Beim Laufbeginn startet der Runner einen abgekoppelten Wächter, der jede Minute nachsieht. Der Lauf schreibt dazu jede Minute ein Lebenszeichen in seine Puls-Datei `.claude/lauf/<lauf>.puls`. Als verstummt gilt er erst, wenn dieses Lebenszeichen älter als die Frist `night.stand.fristMin` ist (Vorgabe 10 Minuten) **und** der Runner-Prozess nicht mehr existiert. Ein Lauf, der lebt, gilt damit nie als verstummt, auch wenn ein Schritt lange keinen Puls schreibt. Ist der Lauf verstummt, setzt der Wächter jede Karte, die noch auf `laeuft` steht, auf `run:aborted` mit `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` und endet. Einen Neustart gibt es nicht. Starb der Wächter mit dem Rechner, holt der nächste Lauf das beim Start nach.

#### Das Journal

Was ein Lauf unterwegs festhält, damit sein Stand den Prozess überlebt.

Jeder Lauf schreibt jeden Stand, bevor er ihn ans Board gibt, als Zeile in sein Journal `.claude/lauf/<lauf>.jsonl`. Nimmt das Board einen Stand nicht an, bleibt die Zeile offen, und am Board gilt der zuletzt sichtbare Stand. Offene Zeilen werden nachgetragen, sobald das Board wieder antwortet: im selben Lauf beim nächsten Stand, sonst beim Start des nächsten Laufs. Das Protokoll nennt jeden Nachtrag mit „Laufstand nachgetragen“. Das Journal ist das Gedächtnis des Laufs; lesen musst du es nur, wenn das Board einen Stand schuldig blieb.

**Teilschnitt.** Stirbt die Stufe `pakete` mitten im Schnitt, trägt die Karte „pakete begonnen für #M“ ohne „pakete fertig für #M“. Der nächste Lauf wiederholt die Stufe dann nicht, sondern zeigt `run:aborted` mit „Teilschnitt vorhanden (#a, #b) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night“. Aufräumen heißt: die genannten Pakete am Board schließen oder löschen, dann `kit:night` erneut an die Karte. Pakete ohne jeden Laufstand-Eintrag, etwa von Hand angelegt, sind kein Teilschnitt.

**Reste im Stash.** Lässt ein gescheitertes Paket Änderungen im Arbeitsbaum zurück und gelingt die Rettung nicht, liegen sie im Stash `nachtrest #<id> <lauf>`, und der Laufstand des Pakets nennt ihn. Zurück holst du sie mit `git stash list` und `git stash apply stash@{<n>}`; ist das Paket erledigt, räumt `git stash drop stash@{<n>}` den Eintrag.

#### Die Belegfälle

Für jeden Belegfall der fachlichen Anforderung: welchen Stand die Karte danach am Board zeigt und mit welcher Geste es weitergeht.

| Fall | Kartenstand danach | Weg nach vorn |
|---|---|---|
| Spurlos: der Lauf stirbt in der Vorabprüfung | zuerst `run:running` mit „Lauf angenommen um …, Vorabprüfung läuft“, nach der Frist `run:aborted` mit `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` | Protokoll lesen, Ursache beheben, dann `kit:night` erneut an die Karte |
| Abgebrochen, obwohl fertig: die Prüfstufe reißt das Zeitbudget, der Prüfvermerk steht schon im Plan | `run:aborted` mit dem Grund; der Laufstand nennt den zuletzt abgeschlossenen Schritt | `kit:night` erneut an die Karte: Die Stufe gilt als vorgefunden, die Kette setzt bei der ersten Stufe ohne Ergebnis an |
| Ausgang unbekannt: das Board ist kurz nicht erreichbar | gelingt der Versuch nach der Pause, der Stand der Karte mit „2. Versuch“; scheitert er, `run:aborted` mit `abgebrochen, Umgebungsfehler um <zeit>: …`, die übrigen Karten des Laufs `run:waiting` mit `nicht begonnen: der Lauf hielt um <zeit> an — …` | nach einem gelungenen Versuch nichts; sonst, wenn das Board wieder antwortet, den Lauf erneut starten bzw. `kit:night` erneut an die Kette |
| Ein Paket hält die Nacht an: Sitzung ohne Commit, Zeitgrenze oder wartende Sitzung | nur dieses Paket `run:aborted` mit Grund, es geht ins Backlog; abhängige Pakete `run:waiting` mit „hängt an #N (abgebrochen in diesem Lauf)“; Reste im Stash `nachtrest #<id> <lauf>`; die übrigen Pakete laufen weiter | Grund lesen, Reste bei Bedarf aus dem Stash holen, das Paket nachbessern und wieder nach Ready ziehen |
| Ein Paket fährt sich fest: dieselbe Prüfung scheitert `night.festgefahrenNach`-mal auf dieselbe Weise, lange vor der Zeitgrenze | nur dieses Paket `run:aborted` mit `Grund: Session an einer Pruefung festgefahren`, Vermerk `## Nachtlauf: an einer Pruefung festgefahren` mit Prüfung, Fehler und Versuchen, es geht ins Backlog; Reste im Stash `nachtrest #<id> <lauf>`; im Nachtbericht der eigene Ausgang `festgefahren`, nicht Zeitgrenze oder wartende Sitzung; die übrigen Pakete laufen weiter | Fehler im Vermerk lesen, Reste bei Bedarf aus dem Stash holen, das Paket nachbessern und wieder nach Ready ziehen |
| Verschränkte Protokolle: Kette und Prüflauf laufen gleichzeitig | jeder Laufstand nennt in der Zeile `Protokoll:` die Datei `.claude/protokolle/<lauf>/<karte>-<stufe>.log` seines Schritts | die genannte Datei öffnen; im Tagesprotokoll trennt die Lauf-Kennung in `[<Zeitpunkt> <lauf>]` die Läufe |

### Mit einem lokalen Modell fahren

> **Ungetestet.** Dieser Abschnitt beschreibt einen Weg, der sich aus der Architektur des Runners ergibt und ohne jede Änderung am Kit funktionieren sollte — er ist hier aber **nicht praktisch erprobt**. Weder wurde LiteLLM aufgesetzt noch ein Lauf gegen ein lokales Modell gefahren. Nimm ihn als begründeten Vorschlag, nicht als Erfahrungsbericht.

Die Idee: einfache Issues nachts von einem lokalen Modell bauen lassen, während Review und anspruchsvolle Issues weiter über Anthropic laufen.

**Warum ein Proxy nötig ist.** Claude Code spricht ausschließlich die Anthropic Messages API; lokale Runner wie Ollama sprechen das OpenAI-Format. Dazwischen gehört ein Übersetzer — üblich ist [LiteLLM](https://docs.litellm.ai/). Zwei Dinge sind dabei unterschiedlich belastbar: Dass Claude Code über `ANTHROPIC_BASE_URL` auf einen eigenen Endpunkt zeigen kann, ist [offiziell dokumentiert](https://code.claude.com/docs/en/llm-gateway) (Gateway-Muster), ebenso `--model` pro Aufruf. Ein lokales Modell hinter diesem Endpunkt zu betreiben ist dagegen Community-Terrain und von Anthropic nicht supportet.

Eine minimale LiteLLM-Konfiguration:

```yaml
model_list:
  - model_name: lokal-qwen
    litellm_params:
      model: ollama/qwen2.5-coder:14b
      api_base: http://localhost:11434
```

**Mischbetrieb: die Variable dem Kommando voranstellen, nicht exportieren.**

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 3
```

`ANTHROPIC_BASE_URL` wirkt global für einen Prozess, `--model` dagegen pro Aufruf — das klingt nach einem Hindernis für den Mischbetrieb, ist hier aber keins. Der Runner startet jede Session als eigenen Kindprozess und reicht dabei `process.env` durch. Stellst du die Variable **dem Nachtlauf-Kommando voran**, gilt sie ausschließlich für dessen Sessions; eine parallel laufende interaktive Claude-Code-Sitzung bleibt unberührt. Ein `export` in der `.zshrc` würde genau das kaputt machen — dann liefe auch deine interaktive Arbeit über den Proxy.

**Aufteilung über Labels.** Das [Routing-Label](#nachtbetrieb) genügt für die Trennung, ein neues Flag braucht es nicht: Vergib den einfachen Issues ein eigenes Label (etwa `kit:lokal`) und fahre zwei Läufe nacheinander — einen mit lokalem Modell und diesem Label, einen regulären mit `kit:nightrun`.

**Der Review bleibt unberührt.** `/kit-review` nutzt das `reviewModel` aus der `workflow.config.json` und ist vom Nachtlauf-Modell vollständig entkoppelt. Was ein lokales Modell nachts gebaut hat, wird morgens trotzdem vom starken Modell begutachtet.

**Wo die Grenzen liegen — ungeschönt.** Eine Nacht-Session muss mehr können als Code schreiben: Sie muss Werkzeuge zuverlässig aufrufen (Board-Operationen über `board.mjs`, Datei-Edits, Git), eine mehrstufige Kette durchhalten und am Ende sauber committen. Kleine Modelle brechen erfahrungsgemäß genau daran, nicht am Programmieren selbst. Projekte mit scharfen Gates — Mutationstests, Coverage-Ratchets, mehrstufige Build-Ketten — sind für ein kleines lokales Modell realistisch außer Reichweite. Der sinnvolle Einsatzbereich sind Änderungen ohne Testpflicht: Dokumentation, Textkorrekturen, Konfigurationswerte, kleine mechanische Anpassungen.

**Was schützt, wenn es schiefgeht.** Nichts Kaputtes gelangt ins Repo: Die [Salvage-Vorprüfung](#nachtbetrieb) fährt die Pflicht-Prüfungen selbst, bevor überhaupt etwas committet wird, nach roten Checks gehen die Reste eines Pakets in den Stash statt in den nächsten Commit, und der Rest-Guard beendet den Lauf, sobald eine erfolgreiche Runde unkommittete Reste hinterlässt. Ein gescheiterter lokaler Lauf kostet dich Strom und Zeit, nicht die Codebasis.

**Einstieg.** Fang mit einem einzigen Doku-Issue an:

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1
```

Das Verlaufsprotokoll zeigt dir ohne Zutun jeden Tool-Aufruf der Session. Daran siehst du binnen Minuten, ob das Modell die Board-Operationen sauber hinbekommt — das ist der schnellste Machbarkeitstest, und er entscheidet die Frage, bevor du eine ganze Nacht investierst.

**Morgen-Ritual:** Protokoll lesen (`.claude/night-run-<datum>.log`: Issue, Dauer, Ergebnis, Commit pro Runde) — derselbe Stand liegt zusätzlich auswertbar als `.claude/night-run-<datum>-<uhrzeit>.json` daneben —, dann wie immer `/kit-review` → eigener Test → `push main`. Zurückgestellte Issues stehen kommentiert im Backlog.

## Aufwand des Prozesses

Jeder Ergebnisstand einer Nacht-Session (`.claude/night-run-<datum>-<uhrzeit>.json`) trägt seit Issue #748/#749 bereits Dauer, Kosten, Menge, Modell und Prüfstand. `node .claude/kit/effort.mjs evaluate` liest die jüngsten davon, aggregiert Zeit, Prüfungen, Umfang, Kosten und den Aufwand je Aufgabenstufe und schreibt daraus `.claude/aufwand.md` (für Menschen) sowie `.claude/aufwand.json` (für die beiden Ausgabestellen unten). Das Werkzeug sagt nur, was auffällt — nie, was zu tun ist, und es schweigt, wenn nichts auffällt.

**Wo der Befund erscheint.** An genau zwei Stellen, und beide zusammen: als Abschlussblock im Laufprotokoll `.claude/night-run-<datum>.log`, den jeder unbeaufsichtigte Lauf am Ende selbst schreibt, und im Skill `/push-main`, der `node .claude/kit/effort.mjs finding` vor dem ersten Schritt ausführt und die Ausgabe zeigt. Beide sind nötig: Läuft der Nachtbetrieb künftig ohne Zutun eines Menschen an, liest den Laufbericht womöglich niemand mehr; das Veröffentlichen bleibt dagegen ein Schritt, den ein Mensch selbst auslöst.

**Nach Aufgabenstufe.** Der Bericht trägt einen eigenen Abschnitt, der je Paar aus Aufgabenstufe und Gründlichkeit (`effort`) eine Zeile zeigt: Einheiten, Dauer, Kosten, rote Prüfstände und Nacharbeit, jede Zahl mit der Zahl der Läufe, die sie trägt. Damit lässt sich eine Stufe vor und nach einer Umstellung ihrer Gründlichkeit vergleichen, ohne dafür einen eigenen Vergleichslauf zu fahren. Derselbe Block steht als `jeStufe` in `.claude/aufwand.json`.

**Was dort als Nacharbeit zählt.** Eine Einheit, deren Endstatus nicht `in_review` ist **oder** deren Prüfstand rot war. Gezählt werden ausschließlich Arbeitspakete mit gestarteter Session — erkennbar an `art: "implementierung"` und einem Feld `endStatus`. Einheiten ohne Session (übersprungen, liegengeblieben, zurückgestellt) und die Einheiten der Nacht-Kette tragen weder Endstatus noch Prüfstand; als Nacharbeit gezählt wären sie allesamt eine, und die Quote maße nur, wie oft ein Gate hielt. Die Kosten dieser Tabelle sind die je Einheit gemeldeten Beträge, nicht die gerechnete Teilung aus dem Abschnitt „Kosten". Eine Zeile „ohne Stufe" steht am Ende: Sie sammelt Stände vor Issue #711 und Karten, deren Modell nicht über eine Stufe kam.

**Verteilung.** Die Summen sagen, wie viel Zeit insgesamt verging, nicht, wie sie sich über die Pakete verteilt. Der Abschnitt „Verteilung" zeigt darum je Laufart (`implementierung`, `kette`, `pruefung`) eine Tabelle mit einer Zeile je Aufgabenstufe („ohne Stufe" am Ende): für Dauer, Nachdenken, Werkzeugarbeit, Rest und Prüfläufe je Paket den Median und das 90. Perzentil, jeweils mit der Zahl der Werte und der Läufe dahinter. Gerechnet wird nach Nearest-Rank, jeder ausgegebene Wert ist also ein tatsächlich gemessener. Die dominierende Zeitart ist der größte der drei Mediane Nachdenken, Werkzeug und Rest; fehlt einer davon, steht „nicht bestimmbar" samt der Zeitart, die nicht gemessen ist. Prüfläufe je Paket zählen `prueflaeufe.arbeit.anzahl` und `prueflaeufe.abschluss.anzahl` zusammen; eine Einheit ohne diese Angabe geht nicht als 0 ein. Dazu kommt der Anteil der Zeitabbrüche, gezählt wie bei der Zielmarke. Die **Kettenstufe** (Plan, Review, Pakete, Abdeckung, Umsetzung) wird an der Einheit nicht erfasst und lässt sich deshalb nicht getrennt ausweisen; die Ketten-Einheiten stehen gemeinsam unter der Laufart `kette`. Derselbe Block steht als `verteilung` in `.claude/aufwand.json`.

**Die Zielmarke der Umsetzung.** Ein eigener Berichtsblock „Zielmarke der Umsetzung" zeigt, wie viele Umsetzungen die Zielmarke reißen: von wie vielen gemessenen Umsetzungen wie viele darüber liegen, um wie viel im Mittel und im Maximum. Gemittelt wird über die **Überschreitungen** und nicht über alle Versuche — wer die eingehaltenen mitmittelte, bekäme eine Zahl, die mit jedem weiteren guten Paket sinkt, ohne dass ein einziges schlechtes besser geworden wäre. Gezählt wird je **Versuch**, nicht je Paket: Ein Paket in zwei Anläufen zählt zweimal, und gerade der zweite Anlauf ist der teure. Die Marke stammt aus dem **Lauf-Kopf** des jeweiligen Standes (`zielUmsetzungMin`) und nicht aus der heutigen Konfiguration; Stände ohne diese Angabe — jeder vor v3.3 — stehen getrennt und gehen in keine dieser Zahlen ein. Derselbe Block steht als `zielmarke` in `.claude/aufwand.json`. Er sagt, was gezählt wurde, und nichts darüber, warum: Aus einer gerissenen Marke folgt keine Ursache.

**Zeitabbrüche stehen getrennt und gehen in keinen Mittelwert ein.** Eine Umsetzung, deren Einheit `zeitlimitBeendet` trägt (siehe [Der Zeitabbruch](#der-zeitabbruch)), zählt allein als Zeitabbruch — in keinen Versuch, in keine Reihe, in keinen Mittelwert. Ihre Fertigstellungsdauer ist unbekannt: Die Sitzung wurde an der Uhr abgebrochen, und wie lange sie noch gebraucht hätte, weiß niemand. Als Überschreitung geführt verschöbe sie das Mittel um einen Wert, den keine Messung trägt — eine Schätzung als Messung auszuweisen wäre falsch. Der Bericht nennt ihre Zahl deshalb in einem eigenen Satz. Fehlt jede Grundlage, steht dort „nicht gemessen" und keine 0.

**Auskünfte.** Ein eigener Berichtsblock „Auskünfte" zeigt je Umsetzungseinheit die Zeit, die auf das Beschaffen und Zerlegen von Board-Auskünften ging, in Minuten und mit der Zahl der Aufrufe — gemessen vom Nacht-Runner als Spanne vom Werkzeugaufruf bis zu seinem Ergebnis für jede Rückfrage an das Board und jedes Aufbereiten ihrer Antwort; Nachdenkzeit zählt nicht. Darunter steht das Mittel über die Umsetzungseinheiten samt der Zahl der Einheiten, die es tragen. Eine Umsetzungseinheit ist eine, deren Session mit `/implement-next`, `/implement-ready`, `/implement-test` oder `/implement-done` startete; alle anderen (Kette, Karten anlegen, Prüfläufe) stehen in einer eigenen Zeile „keine Umsetzung" und gehen nicht ins Mittel ein. Eine Einheit ohne Messung (`auskunft: null`) und eine aus einem Stand vor Issue #1026 ohne das Feld stehen als „nicht gemessen" und gehen nie als 0 ins Mittel ein. Derselbe Block steht als `auskuenfte` in `.claude/aufwand.json`.

**Transkripte nachträglich messen.** `node .claude/kit/effort.mjs info <transkript…>` misst Claude-Code-Transkripte (`*.jsonl` unter `~/.claude/projects/<projekt>/`) mit **derselben** Regel wie der Nacht-Runner — so lässt sich ein Referenzwert aus einem Lauf bestimmen, der vor der Messung lag. Die Ausgabe nennt je Datei und gesamt Minuten und Aufrufe, bei mehreren Dateien auch das Mittel je Datei. Eine nicht lesbare Datei oder eine ohne Zeitstempel wird ausdrücklich gemeldet und nicht als 0 gezählt; das Kommando endet dann mit Exit 1.

**Kein Gate.** Der Befund hält weder einen Lauf noch `/push-main` auf. Ein Fehlschlag der Auswertung ist eine Protokollzeile, kein Abbruch.

**Laufzahl und Schwellen ändern.** Beides steht im optionalen Block `aufwand` der `.claude/workflow.config.json` (siehe [Alle Einstellungen](/einstellungen)) — fehlt der Block oder ein Feld darin, gelten die eingebauten Vorgaben, ein bestehendes Projekt bekommt die Auswertung also ohne weitere Einrichtung. `aufwand.laeufe` bestimmt, wie viele der jüngsten Ergebnisstände einbezogen werden; `aufwand.schwellen` trägt die vier Grenzwerte (`pruefungAnteil`, `eingrenzungOhneWirkung`, `werkzeugAnteil`, `schreibkostenAnteil`), ab denen ein Befund erscheint. In der Einstellungs-Oberfläche steht der Block unter dem Thema „Nachtbetrieb".

## Verbrauch interaktiver Sitzungen

Der Nachtlauf meldet seinen Verbrauch selbst (siehe oben). Für die Sitzungen, in denen du selbst am Rechner sitzt, tut das der **Sitzungs-Melder**: `board.mjs session report` liest das Sitzungsprotokoll von Claude Code, summiert Eingabe-, Ausgabe- und Zwischenspeicher-Token und liefert sie über dieselbe Route ein wie der Runner — `POST /api/kanban/night-runs`, nur mit `kind`/`mode` **INTERACTIVE** und dem Startzeitpunkt der Sitzung als Schlüssel. Den Pfad des Protokolls nimmt er aus `--transcript` oder als `transcript_path` aus dem Rumpf, den ein Claude-Code-Hook auf stdin hereinreicht.

**Wer ihn ruft.** Niemand von Hand. Bei projektlokaler Installation trägt der Installer zwei Einträge in den `hooks`-Block von `.claude/settings.json` ein, und Claude Code ruft den Melder von selbst:

| Ereignis | Aufruf | Wirkung |
|---|---|---|
| `Stop` | `node .claude/kit/board.mjs session report` | fortschreibend, `complete: false`, gedrosselt auf eine Meldung je fünf Minuten |
| `SessionEnd` | `node .claude/kit/board.mjs session report --complete` | abschließend, `complete: true` — danach ist die Wegmarken-Datei leer |

Die Einträge stehen in der **Projekt**-Datei und nicht in den Nutzer-Einstellungen unter `~/.claude`: Das Zielprojekt kommt aus der Bindung des Tokens im Arbeitsverzeichnis, und eine nutzerweite Einstellung meldete aus jedem Verzeichnis — auch aus jedem fremden.

Der Installer **ergänzt** die Datei, er ersetzt sie nicht: `env`, `sandbox`, `permissions` und fremde Hook-Einträge bleiben stehen, und ein zweiter Lauf ändert nichts mehr. Ist `settings.json` kein lesbares JSON-Objekt, fasst er sie nicht an und nennt die beiden Einträge zum Nachtragen von Hand — was er nicht lesen kann, kann er auch nicht erhalten.

**Bleibt der Melder stumm,** obwohl Token und Tracker stimmen, lohnt ein Blick auf die Sandbox: Läuft sie im Projekt, braucht der Aufruf eine Netz-Freigabe — `node .claude/kit/board.mjs*` in `sandbox.excludedCommands` derselben Datei (siehe „Kit-Skripte mit Board-Zugriff"). Ohne sie kommt der Melder bis zur Einlieferung und scheitert dort mit `nicht-eingeliefert`; die Sitzung stört das nicht, nur der Verbrauch fehlt. `sandbox.network.excludedCommands` ist kein Schlüssel von Claude Code und wird stillschweigend ignoriert.

**Abschalten.** Den jeweiligen Eintrag aus dem `hooks`-Block in `.claude/settings.json` löschen: beide für ganz, nur den unter `Stop` für „nur am Sitzungsende". Die Datei ist nicht versioniert, die Entscheidung gilt also für deine Maschine. Ein späterer Installer-Lauf trägt den gelöschten Eintrag wieder ein — wer den Melder dauerhaft stillstellen will, nimmt ihm die Voraussetzung statt den Hook: Ohne projektgebundenes Token im Arbeitsverzeichnis und bei jedem `issueTracker` außer `toolbox` schweigt er von selbst und sagt das auch (`kein-token`, `kein-board`).

**Die bekannte Lücke: Worktrees.** Eine interaktive Sitzung in einem `git worktree` meldet **nicht**. Ein frisch angelegter Worktree trägt nur die versionierten Dateien, und `.claude/*` ist per `.gitignore` ausgeschlossen: Dort fehlen `settings.json` — also der Hook — und `.claude/kit/` — also der Melder. Für die Worktrees der Nacht-Kette ist das folgenlos, denn dort ist `KIT_AGENT_MODEL` gesetzt und der Melder schwiege ohnehin; der Runner meldet diese Sitzungen selbst. Wer dagegen von Hand einen Worktree anlegt und darin arbeitet, findet diesen Verbrauch im Leitstand nicht wieder. Abhilfe von Hand: `.claude/settings.json` und `.claude/kit/` aus dem Hauptarbeitsbaum hinüberkopieren.

**Zuordnung zu Karten.** `issue move` vermerkt jeden Zug nach *In progress* und *In review* mit Zeitstempel in `.claude/wegmarken.tsv`. Der Melder teilt die Sitzungssumme anhand dieser Zeitstempel auf die Karten auf. Was zwischen keinen zwei Wegmarken liegt, meldet er als Rest ohne Kartennummer — er steht in der Sitzungssumme, aber in keiner Karte. Dasselbe gilt für Zeiträume, in denen **zwei Karten gleichzeitig offen** waren: Laufen zwei Sitzungen im selben Verzeichnis, mischen sich ihre Wegmarken in einer Datei, und eine Zuordnung wäre geraten. Sie unterbleibt.

**Wann gemeldet wird.** Am Sitzungsende mit `complete: true` — danach ist die Wegmarken-Datei leer. Dazwischen fortschreibend mit `complete: false`, gedrosselt auf höchstens eine Meldung je fünf Minuten: Nur am Ende zu melden verlöre jede abgestürzte Sitzung, ungedrosselt erzeugte jeder Zug einen HTTP-Aufruf.

**Wann nicht gemeldet wird.** Bei gesetztem `KIT_AGENT_MODEL` schweigt der Melder vollständig — diese Sitzung hat der Nacht-Runner gestartet und meldet sie bereits selbst; ein zweiter Weg zählte sie doppelt. Ohne projektgebundenes Zugriffstoken im Arbeitsverzeichnis meldet er ebenfalls nichts; das Zielprojekt kommt aus der Bindung des Tokens und nicht aus dem Aufruf. Beides endet ohne Fehler: Der Melder ist Buchhaltung, keine Bedingung, und darf eine Sitzung nie stören. Aus demselben Grund bleibt eine gescheiterte Einlieferung folgenlos — die Wegmarken bleiben stehen, der nächste Versuch sieht denselben Abschnitt noch.

**Die Preistabelle will gepflegt werden.** Das Sitzungsprotokoll führt keinen Dollarbetrag, nur Tokenmengen. Der Betrag wird deshalb gerechnet, mit den Sätzen aus **`kit/preise.mjs`** (im installierten Projekt: `.claude/kit/preise.mjs`). Die Datei trägt im Kopf das Datum ihres Standes und die Quelle, aus der die Zahlen stammen. **Sie veraltet von allein:** Ein neues Modell fehlt darin, und dann meldet der Melder für die betroffene Summe **keinen** Betrag — nie eine 0 und nie einen geschätzten. Die Tokenmengen stehen trotzdem da. Wer im Leitstand einen fehlenden Betrag sieht, trägt das Modell in `MODELL_STUFEN` nach und setzt `PREISE_STAND` neu; die Stufen selbst ändern sich nur, wenn Anthropic die Preise ändert. Fehlt die Datei ganz — etwa neben einer einzeln kopierten `board.mjs` —, läuft der Melder weiter, eben ohne Betrag.

## Leitplanken statt Prompts

Ein Sprachmodell reproduziert das häufigste Muster seines Trainingskorpus, nicht das aktuellste. Eine vor Monaten abgekündigte API steht in Millionen Zeilen Altcode noch als der normale Weg; der Abkündigungshinweis ist ein Randfall gegen diese Masse. Das Ergebnis ist ein Denkfehler, vielfach materialisiert: dasselbe veraltete oder abgekündigte Idiom, über alle Aufrufstellen ausgerollt — und oft erst spät in einer externen Analyse sichtbar.

Für solche wiederkehrenden, klassenweiten Fehler gilt dasselbe Prinzip wie beim Coverage-Gate: eine **harte Leitplanke, die im Pflicht-Gate scheitert**, statt ein Prompt oder eine Doku, die bittet. Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen; eine Lint- oder Compiler-Regel in den `buildChecks`, die Agent und CI ohnehin durchlaufen, kann gar nicht erst grün committen. Konkret:

- **Die Leitplanke leitet aus vorhandenen Annotationen ab**, statt eine handgepflegte Verbotsliste zu führen, die selbst veraltet: `@typescript-eslint/no-deprecated` liest JSDoc-`@deprecated`, Java meldet mit `-Xlint:deprecation` und `-Werror` jede abgekündigte API als Build-Fehler. Der Analyzer skaliert mit dem Ökosystem, die Liste nur mit der Pflegedisziplin.
- **Das Gate ist der Hauptfang, SonarQube o. Ä. das Sicherheitsnetz.** Der Round-Trip über main fängt sicher, aber spät — der Fehler ist dann schon auf main. Der Check gehört nach vorn, in `/local-check` und `/implement-ready`, wo der Agent ihn vor Abschluss läuft.
- **Der konkrete Regel-Katalog lebt im jeweiligen Projekt** (`buildChecks` in der Config, Lint-Setup im Repo), nicht im Kit. Das Kit verankert nur das übertragbare Prinzip.

**Der Maßstab dahinter: „Regel im Text oder Regel im Werkzeug".** Er steht in `CLAUDE-workflow.md` und gilt für jede mitgelieferte Anweisung: Eine **Bedienvorgabe** — ihre Befolgung ist an Ausgabe oder Ergebnis ablesbar, ein Werkzeug könnte sie an der Stelle des Lesers ausführen — gehört ins Werkzeug; eine **Urteilsregel**, die eine Entscheidung im Einzelfall verlangt, bleibt im Text. Gemischte Regeln werden zerlegt, nicht gerundet. Welche Regel von `/local-check` nach diesem Maßstab wohin gewandert ist, führt die Aufstellung [Regeln im Werkzeug](regeln-im-werkzeug.md) — Zeile für Zeile, mit Art, Überführungsgrad und neuem Ort.

**Der Grenzfall: wenn keine Leitplanke zu haben ist.** Manches lässt sich nicht messen — ob ein Modell eine Aussage geglaubt hat, statt sie nachzuschlagen, etwa. Dort tritt die ausgewiesene Selbstauskunft an die Stelle des Gates: Die feste Antwortform „Mitteilung übernommen, ungeprüft — …" aus [Mitteilungen: glauben statt nachsehen](/prozess#mitteilungen-glauben-statt-nachsehen) zwingt nichts, macht aber jeden Verstoß zum sichtbaren Widerspruch. Sichtbarer Widerspruch statt Gate — dasselbe Prinzip, nur mit dem schwächeren Mittel, weil das stärkere hier nicht existiert.

## Was bewusst nicht im Kit ist

**Security-Gates gehören ins CI, nicht in einen Skill.** gitleaks findet Secrets, Semgrep oder SpotBugs finden SQL-Konkatenation und fehlende Input-Validation. Ein deterministisches Tool teilt mit keinem Sprachmodell einen blinden Fleck. Ein roter Build blockiert den Push mechanisch, verlässlicher als jedes Modell. Der Review-Skill ergänzt diese Tools, ersetzt sie nicht.

**Kein Multi-Tool-Adapter.** Das Konzept ist übertragbar, das Format nicht. Codex liest `AGENTS.md`, Cursor `.cursor/rules`. Wenn du mehrere Engines einsetzen willst, brauchst du die Skill-Bibliothek in mehreren Formaten parallel im Repo. Das ist machbar, aber nicht Bestandteil dieses Kits.

## Namen für Umsteiger von Version 4

**Skills.** Ein alter Name wird abgewiesen, und die Meldung nennt den neuen.

| Alt | Neu |
|-----|-----|
| `/kontext`, `/context` | `/session-start` |
| `/fachplan` | `/requirement` |
| `/review` | `/kit-review` |
| `/plan` (Wegweiser) | entfällt, der Planungsschritt ist `/techplan` |

**Kommando-Dateien.**

| Alt | Neu |
|-----|-----|
| `kit/befunde.mjs` | `kit/findings.mjs` |
| `kit/aufwand.mjs` | `kit/effort.mjs` |
| `kit/wirksamkeit.mjs` | `kit/effectiveness.mjs` |
| `einstellungen.mjs` | `settings.mjs` |

**Befehle.**

| Kommando | Alt | Neu |
|----------|-----|-----|
| `kit/board.mjs` | `kontext`, `sitzung` | `context`, `session` |
| `kit/board.mjs` | `issue melden`, `nightrun melden`, `sitzung melden` | `issue report`, `nightrun report`, `session report` |
| `kit/board.mjs` | `issue stand`, `issue auftrag`, `issue ursprung` | `issue run-state`, `issue brief`, `issue origin` |
| `kit/board.mjs` | `issue check-geschuetzt`, `issue vorgeschichte`, `issue fragen` | `issue check-protected`, `issue history`, `issue questions` |
| `kit/board.mjs` | `issue-review pruefauftrag` | `issue-review review-brief` |
| `kit/board.mjs` | `hook bash-pruefen` | `hook bash-check` |
| `kit/board.mjs` | `code schutz` mit `einrichten`, `aussetzen`, `wiederherstellen`, `nachpruefen` | `code protection` mit `setup`, `suspend`, `restore`, `verify` |
| `kit/checks.mjs` | `bereiche` | `areas` |
| `kit/findings.mjs` | `arten`, `pruefen`, `buchen`, `vorschlag`, `auswerten`, `befund` | `kinds`, `check`, `record`, `suggest`, `evaluate`, `finding` |
| `kit/effort.mjs` | `auswerten`, `befund`, `auskunft` | `evaluate`, `finding`, `info` |
| `kit/effectiveness.mjs` | `auswerten`, `befund`, `kandidaten` | `evaluate`, `finding`, `candidates` |
| `kit/worktree.mjs` | `anlegen`, `entfernen`, `im`, `nachziehen-pruefen`, `rueckweg` | `create`, `remove`, `in`, `catch-up-check`, `return` |
| `kit/worktree.mjs` | `vorbereitung-festhalten`, `vorbereitung-pruefen` | `record-preparation`, `check-preparation` |

**Optionen.**

| Kommando | Alt | Neu |
|----------|-----|-----|
| `kit/board.mjs` | `--teil`, `--zustand`, `--spalte`, `--pfad`, `--zweig`, `--nur-pfad` | `--part`, `--state`, `--column`, `--path`, `--branch`, `--path-only` |
| `kit/board.mjs` | `--stufe`, `--rolle`, `--datei`, `--material-datei`, `--auftrag`, `--ausgabe`, `--protokoll` | `--stage`, `--role`, `--file`, `--material-file`, `--brief`, `--output`, `--transcript` |
| `kit/board.mjs` | `--begriffe`, `--dateien`, `--ohne`, `--vergleich` | `--terms`, `--files`, `--without`, `--compare` |
| `kit/checks.mjs` | `--stufe`, `--bereich`, `--abschluss`, `--frisch`, `--wiederholen` | `--stage`, `--area`, `--finish`, `--fresh`, `--retry` |
| `kit/night.mjs` | `--kette`, `--pruefen`, `--waechter` | `--chain`, `--check`, `--watcher` |
| `kit/findings.mjs` | `--datei`, `--stufe`, `--karte`, `--art`, `--abgelehnt` | `--file`, `--stage`, `--card`, `--kind`, `--rejected` |
| `kit/effort.mjs` | `--laeufe` | `--runs` |
| `kit/effectiveness.mjs` | `--fenster` | `--window` |
| `kit/worktree.mjs` | `--praefix`, `--ergebnis`, `--offen`, `--verwerfen` | `--prefix`, `--result`, `--open`, `--discard` |
| `install.mjs` | `--sprache`, `--schutz` | `--language`, `--protection` |

**Auswahlwerte.**

| Stelle | Alt | Neu |
|--------|-----|-----|
| `kit/board.mjs --art` | `fachlich`, `idee`, `mensch` | `requirement`, `idea`, `human` |
| `kit/board.mjs --state` | `laeuft`, `abgebrochen`, `wartet`, `fertig` | `running`, `aborted`, `waiting`, `done` |
| `kit/board.mjs --stage` | `fachlich` | `requirement` |
| `kit/checks.mjs --stage` | `paket` | `package` |
| `kit/findings.mjs --stage` | `fachlich` | `requirement` |
| `kit/worktree.mjs --result` | `gruen`, `gruen-offen`, `rot` | `green`, `green-open`, `red` |
| `kit/worktree.mjs --fetch` | `fehlgeschlagen` | `failed` |
| `/push-main` | `vorbereiten`, `notfall` | `prepare`, `emergency` |

**Titel-Präfixe.** Neue Karten tragen nur die englischen; die deutschen erkennt das Kit an offenen Karten weiter.

| Alt | Neu |
|-----|-----|
| `[Fachlich]` | `[Requirement]` |
| `[Idee]` | `[Idea]` |
| `[Mensch]` | `[Human]` |

**Labels.** Das Kit setzt nur die englischen; die deutschen erkennt es an offenen Karten weiter und räumt sie ab, wo es das englische abräumen würde.

| Alt | Neu |
|-----|-----|
| `kit:klaeren` | `kit:clarify` |
| `kit:geschuetzt` | `kit:protected` |
| `kit:durchziehen` | `kit:carry-through` |
| `kit:pruefen` | `kit:check` |
| `lauf:laeuft` | `run:running` |
| `lauf:abgebrochen` | `run:aborted` |
| `lauf:wartet` | `run:waiting` |
| `review:fertig` | `review:done` |
| `ziel:plan` | `goal:plan` |
| `ziel:pakete` | `goal:packages` |
| `ziel:umsetzung` | `goal:implementation` |
| `ziel:push-vorbereitet` | `goal:push-prepared` |

## Lizenz

MIT. Das Kit ist frei verwendbar, veränderbar und weitergabe-fähig.
