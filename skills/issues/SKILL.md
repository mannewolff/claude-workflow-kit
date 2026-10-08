---
name: issues
description: Schritt 3 des 9-Schritt-Prozesses — überführt einen freigegebenen Plan in kleinteilige GitHub-Issues im Vier-Abschnitt-Format. Nutze diesen Skill wenn der Nutzer /issues aufruft, Issues aus einem Plan erstellen will oder Schritt 3 des Prozesses startet.
user-invocable: true
---

# Issues
Schritt 3 des 9-Schritt-Prozesses: Der freigegebene Plan wird in ein oder mehrere Issues überführt. Das Issue ist ab jetzt die Quelle der Wahrheit, nicht der Chat.

## Ablauf
### 1. Plan prüfen
**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Erkennungsmerkmal ist **gesetztes `KIT_AGENT_MODEL`** und ausdrücklich kein zweites Signal. Der Nacht-Runner stellt dem Auftrag zwar einen Satz voran, der die Betriebsart benennt; **maßgeblich bleibt allein `KIT_AGENT_MODEL`, der Hinweis im Prompt wiederholt es nur** — sein Fehlen ist keine Entwarnung.

Der Eingang ist ein `[Plan]`-Dokument, übergeben als `/issues #N` und gelesen mit `node .claude/kit/board.mjs issue get <N>`. Zwei Bedingungen prüft die Session selbst: `title` trägt das Präfix `[Plan]`, und die erste nicht leere Zeile unter `## Offene Fragen` — außerhalb von Codeblöcken — beginnt mit `- Keine.`; Text dahinter in derselben Zeile ist erlaubt. Ein Marker am Plan ist keine Bedingung: Ob der Plan geprüft wurde, entscheidet der Mensch mit dem Routing-Label, das der Runner bei der Kandidatenauswahl liest und die Session nicht nachprüft.

**Fehlerpfad:** Fehlt unbeaufsichtigt eine der beiden Bedingungen, wird **nicht gefragt** — nachts antwortet niemand. Die Session schreibt einen Board-Kommentar an das Dokument, dessen erste Zeile lautet `Kein Eingang für /issues: <fehlendes Praefix | offene Stopp-Frage>`, legt **kein** Issue an und endet.

**Interaktiv:** Prüfe, ob ein in **dieser Session** freigegebener Plan existiert. Wenn nein: **STOPP — keine Issues anlegen.** Verweise darauf, dass erst `/techplan` laufen und freigegeben werden muss. Eine Ideen-/Use-Case-Liste im Chat ist **kein** freigegebener Plan.

### Entscheiden statt fragen
Was beim Schneiden unklar ist und nicht in der Stopp-Klasse aus `CLAUDE-workflow.md` (Abschnitt „Entscheiden statt fragen") steht, entscheidet die Session und schreibt es als Zeile in den `## Kontext` des betroffenen Pakets, im Format von dort:
```
Entscheidung: <Frage>. Gewählt: <Weg>. Verworfen: <Alternative>. Grund: <ein Satz>. Rückbau: <trivial | eine Datei | Migration>.
```

Eine Stopp-Frage wird interaktiv gestellt; unbeaufsichtigt endet der Skill mit dem Kommentar `Kein Eingang für /issues: offene Stopp-Frage` am Plan und legt kein Paket an. Stopp-Klasse und Format werden nicht wiederholt.

### 2. Issues schneiden
Ein Issue = ein logischer Schritt, der eigenständig getestet werden kann. Kriterien:
- Ein Issue löst genau eine Sache und kann isoliert committed und reviewed werden
- Es hat messbare Akzeptanzkriterien
- Abhängigkeiten zu anderen Issues sind explizit
- Was sich nicht in überschaubarem Aufwand erledigen lässt, wird in Sub-Issues geschnitten
- Portabilitaets-Konvention: Wenn eine Datei oder ein Artefakt als eigenstaendig portabel gedacht ist (Installer, Single-File-Tool, kopierbares Script), muss das Akzeptanzkriterium explizit enthalten: "lauffaehig ohne weiteren Repo-Kontext". Ohne diesen Prueffall bleibt die Portabilitaet ungetestet.
- Vorlage-Konvention: Bringt der Mensch eine Vorlage mit — einen Gestaltungsentwurf, ein Mockup, eine Skizze —, trägt jedes Dokument der Kette die Zeile `Vorlage: <Pfad> — verbindlich | Anregung`: `/fachplan` im Abschnitt `## Ziel`, `/techplan` im Kopf des Plans, `/issues` im `## Kontext` jedes Pakets, das Aussehen oder Aufbau einer Ansicht berührt. Bei „verbindlich“ entscheidet `/techplan` keine offene Gestaltungsfrage gegen die Vorlage — ein Widerspruch ist eine Stopp-Frage, nachts `kit:klaeren` —, und jedes solche Paket nennt die Stelle der Vorlage und trägt als Akzeptanzkriterium die Abnahme per Bildschirmfoto neben der Vorlage; `issue check-form` weist ein Paket mit verbindlicher Vorlage ohne Bildschirmfoto im Akzeptanzkriterium ab (I5).
- Sitzungsumfang-Konvention: Jedes Paket traegt im `## Kontext` die Zeile `Sitzungsumfang: passt | reisst — <ein Satz>`, nach dem Muster von `Aufgabenstufe:`. Zwei Werte und ein Satz — ausdruecklich **keine geschaetzte Minutenzahl** und **keine dritte Zwischenstufe**: Eine Minutenzahl behauptete eine Messung, die niemand vorgenommen hat, und eine Zwischenstufe nimmt der Einschaetzung ihre einzige Aussage. Massstab ist die Zeitgrenze **einer Sitzung** aus `--timeout-min` (Vorgabe 60 Minuten) — auch in der Nacht-Kette, wo jede Session mit derselben Grenze startet. Ausdruecklich **nicht gemeint** sind die Zielmarke `night.zielUmsetzungMin` und `night.kette.umsetzungMin`: Letzteres ist das Budget der ganzen Stufe, wird nur zwischen zwei Sessions geprueft und sagt ueber ein einzelnes Paket nichts. Die Zeile ist ein **Hinweis, keine Sperre** — sie haelt nichts auf und sperrt den Weg nach Ready nicht; `issue check-form` kennt keine Regel dazu.
- Guetemess-Konvention: Der Abschnitt `## Akzeptanzkriterium` ruft **keine Guetemessung** auf — kein `mutationCommand`, kein Kommando eines `buildChecks`-Eintrags mit `guete`-Block und keins aus dem Config-Feld `guetekommandos`. Eine Mutationspruefung laeuft einmal je Veroeffentlichung an ihrer Stufe, nicht einmal je Paket: In der Runde kostet sie Zeit, die dem Paket fehlt, und ein Vollauf sprengt das Rundenzeitlimit. Wo die Guete fuer ein Paket zaehlt, steht sie als Marke in der Konfiguration, nicht als Zeile in der Karte. `issue check-form` weist ein Paket ab, dessen Akzeptanzkriterium eines dieser Kommandos nennt (I6).
  - **Die Konvention gilt ohne Ausnahme — auch fuer das Paket, das den Mess-Treiber selbst baut.** Genau dort ist die Versuchung am groessten: Die Config kennt den Treiber noch nicht, also schweigt I6, und ein echter Vollauf wandert als Nachweis ins Kriterium. In kanban-kit #1215 waren es drei Vollaeufe, weit ueber eine Stunde; der Code war nach 15 Minuten fertig, die Runde starb an der Nachweiszeile. Was das Kriterium belegt, sind **Tests auf Fixtures oder abgelegten Berichten** — dass der Treiber wirklich durchlaeuft, steht unter `### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)`, nie im Akzeptanzkriterium.
  - **Keine `Entscheidung:`-Zeile hebt die Konvention auf.** Eine Zeile im `## Kontext`, die einen Vollauf oder eine Guetemessung mit `Gewaehlt: ja` ins Paket holt, weist `issue check-form` als I6-Verstoss ab. Ein Treiber, den das Projekt erst baut, gehoert mit seinem Kommando-Praefix ins Config-Feld `guetekommandos` — dann greift I6, bevor er existiert.

Autor-Modell-Konvention: Jedes Issue traegt im Kontext-Abschnitt die Zeile `Autor-Modell: <wert>`. Der Wert entsteht in dieser Reihenfolge:

1. `KIT_AGENT_MODEL`, wenn gesetzt — der Nacht-Runner fuellt sie aus `--model`.
2. sonst die **Selbstauskunft der Session**: das Modell, unter dem sie laeuft.
3. nur wenn beides nicht zu ermitteln ist: woertlich `unbekannt`.

**Die Zeile wird nie weggelassen** — eine fehlende Zeile und ein unbekannter Autor sind zwei verschiedene Zustaende, und die Prüfung muss sie unterscheiden koennen. Der Wert ist eine Selbstauskunft, kein Nachweis; das reicht fuer seinen Zweck: Der Autor soll nicht sein eigener Reviewer werden. **Das ist keine Bitte, sondern eine Leitplanke.** `board.mjs issue create` legt kein Issue an, wenn die Zeile fehlt, und meldet stattdessen einen Fehler. Zwei Wege, sie zu liefern: im `--body` mitschreiben (der Normalfall dieses Skills) oder `--author-model <modell>` uebergeben — dann setzt der Adapter sie selbst in den Kontext-Abschnitt. Ist `KIT_AGENT_MODEL` gesetzt und weder Zeile noch Flag vorhanden, springt der Wert daraus ein; nachts kann eine Session also nicht an der eigenen Leitplanke scheitern.

Plan-Modell-Konvention: Nennt der zugrunde liegende Plan eine Zeile `Plan-Modell: <wert>` (siehe `/techplan`), traegt jedes technische Issue sie **zusaetzlich** im Kontext-Abschnitt:
```
Autor-Modell: claude-opus-5
Plan-Modell: claude-sonnet-5
```

Stimmen beide ueberein, genuegt die `Autor-Modell`-Zeile. **Weichen sie ab, stehen beide da** — das ist kein Fehlerfall, sondern der interessante: Ein Plan von einem Modell und Issues von einem anderen sind zwei Autorschaften, und wer spaeter einen Mangel sucht, muss wissen, welche der beiden gemeint ist.

Kopien-Konvention: Aendert ein Issue eine Datei, von der das Repo eine Dogfooding-Kopie fuehrt (Skills, Kit-Tools), verlangt die Aufgabe **`node tools/sync-blobs.mjs`** — nicht "die Kopie mitziehen". Das Tool gleicht `.claude/kit/` und `.claude/skills/` selbst ab und macht `--check` rot, wenn etwas driftet.

Kriterien-Konvention: Der Abschnitt `## Akzeptanzkriterium` enthaelt **ausschliesslich Kriterien, die eine Session selbst pruefen kann** — ausfuehrbare Kommandos, Dateizustaende, Testergebnisse. Was ein menschliches Urteil oder eine menschliche Handlung braucht (Klick durch eine UI, Blick auf ein gerendertes Dokument, Urteil ueber Textqualitaet, Livetest gegen eine fremde Instanz), kommt in einen eigenen Block mit **woertlich dieser Ueberschrift**:
```markdown
## Akzeptanzkriterium
- <maschinell pruefbar>

### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)
- <was ein Mensch prueft, bevor das Issue auf Done geht>
```

Die Ueberschrift ist der Anker, an dem `implement-*` und der Nacht-Runner den Block erkennen — sinngemaess umformuliert wirkt sie nicht. Was die Konvention **nicht** erlaubt: ein Kriterium als manuell zu deklarieren, nur weil es muehsam automatisch zu pruefen waere. Die Frage lautet nicht "ist es unbequem", sondern "braucht es ein menschliches Urteil oder eine menschliche Handlung". Ein Wegwerf-Verzeichnis anzulegen und ein Kommando darin laufen zu lassen ist automatisierbar und gehoert nach oben; zu beurteilen, ob eine Doku verstaendlich ist, gehoert nach unten. Ohne diese Grenze wandert mit der Zeit alles Unbequeme in den unteren Block.

Menschenschritt-Konvention: Liegt die **ganze** Aufgabe eines Pakets ausserhalb des Repositories — eine Einstellung in einer Weboberflaeche, ein Konto, ein Zugang, eine Freigabe — und kann kein Zug einer Sitzung sie erledigen, traegt der Titel das Praefix `[Mensch]`. Das ist etwas anderes als der Block `### Manuelle Pruefung` darueber: Der nimmt einen **Teil** eines Pakets aus dem Session-Abschluss heraus, `[Mensch]` nimmt das **ganze** Paket aus der Umsetzung. Sonst bleibt es ein Arbeitspaket im Vier-Abschnitt-Format und faellt bei `issue check-form` in die Stufe `issue`; die Aufgabe beschreibt die Handlung, das Akzeptanzkriterium, woran der Mensch erkennt, dass sie getan ist. Ohne das Praefix startet der Nacht-Runner eine Session, die den Fall zwar richtig erkennt und nichts tut — er kann diese richtige Untaetigkeit aber nicht von einem Fehlschlag unterscheiden, und die Karte wandert ins Backlog, wo sie wie ein gescheitertes Paket aussieht.

Konvention „Geschuetzte Datei“: Nennt eine geplante Aenderung einen geschuetzten Pfad — eine Datei, die nur ein Mensch schreiben darf —, wird sie beim Schneiden als eigene `[Mensch]`-Karte herausgetrennt. Das Restpaket nennt diese Karte unter `## Abhaengigkeiten` als `Issue #N`; solange sie nicht erledigt ist, stellt der Abhaengigkeits-Mechanismus das Restpaket zurueck. Welche Pfade geschuetzt sind, wird hier nicht abgeschrieben: Massgeblich sind `GESCHUETZTE_PFADE` in `kit/board.mjs` und die `deny`-Eintraege der Einstellungen. Davon getrennt die installierte Kopie (`.claude/kit/`, `.claude/skills/`, `.claude/CLAUDE-*.md`): Ein Paket, das die Kopie aendern will, ist falsch geschnitten — gemeint ist die Quelle, und die Kopie zieht `node tools/sync-blobs.mjs` bzw. ein Kit-Update nach. `issue check-form` weist beides ab: einen geschuetzten Pfad als I8, die installierte Kopie in `## Aufgabe` als I9. Ein `[Mensch]`-Paket selbst ist von I7 bis I9 ausgenommen. Spricht ein Paket nur ueber einen geschuetzten Pfad, ohne ihn zu aendern — in einem Test, einer Sperrliste, der Dokumentation —, kennzeichnet `(nur genannt)` unmittelbar hinter dem Backtick-Pfad die blosse Erwaehnung, zum Beispiel ``Die Liste `AUSNAHMEN` um `.claude/settings.json` (nur genannt) ergaenzen.``: Dieser Pfad zaehlt in dieser Zeile weder fuer I8 noch fuer I7. Ein zweites Vorkommen ohne Kennzeichnung bleibt ein Treffer, und schreibt die Session den Pfad doch, weist Claude Code das Schreiben ab.

Konvention „Dateien in Backticks“: `## Aufgabe` nennt die Dateien, die das Paket aendert, als Backtick-Token — ein Token mit `/` oder mit Dateiendung, nicht ein Label oder eine Konstante. Erst daran setzt jede Erkennung an; `issue check-form` weist ein Paket ohne einen solchen Dateipfad in `## Aufgabe` ab (I7).

### 3. Issues im Vier-Abschnitt-Format anlegen
Jedes Issue bekommt vier Abschnitte:
```
## Kontext
Warum wird diese Aufgabe gemacht? Was fehlt vorher, welche Vorgeschichte gehört dazu?
Autor-Modell: <Wert von KIT_AGENT_MODEL, sonst 'unbekannt'>

## Aufgabe
Was konkret ist zu tun? Betroffene Dateien, zu schreibende Tests (bei TDD zuerst), konkrete Änderungen.

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist? Konkret, messbar oder ausführbar.

## Abhängigkeiten
Welche anderen Issues müssen zuerst fertig sein? Oder: "Keine."
```

**Abhängigkeits-Konvention (maschinenlesbar):** Der Abschnitt enthält entweder exakt `Keine.` oder explizite Referenzen der Form `Issue #N` (mehrere möglich, je eine pro Zeile). Erläuternder Freitext ist zusätzlich erlaubt — aber wenn ein anderes Issue gemeint ist, muss die `#N`-Referenz dabeistehen. Grund: Der Nacht-Runner (`kit/night.mjs`) wertet ausschließlich `#N`-Referenzen aus und stellt Issues mit unerfüllten Abhängigkeiten automatisch zurück; eine nur in Prosa beschriebene Abhängigkeit ist für ihn unsichtbar. Unerfüllt ist eine Abhängigkeit nur, solange ihre Karte in Backlog, Ready oder In progress liegt; jede andere Lage — In review, Done, archiviert, nicht auf dem Board — gilt als erfüllt, auch eine vertippte Nummer. Abhängigkeiten auf fremde Repos als `owner/repo#N` schreiben (mit Repo-Präfix) — sie werden bewusst nicht als lokale Issues gewertet.

**Jede lokale `#N` im Abschnitt zählt — auch in Erläuterungen.** „Nicht #N: …" hält das Paket genauso fest wie `Issue #N`. Eine Verweiszeile beginnt nach optionalem Leerraum und optionalem Listenzeichen (`-`, `*`, `+`, `1.`) mit `Issue #N` und trägt keine weitere lokale Nummer; jede andere Nummer stammt aus erläuterndem Text, auch eine im Codeblock des Abschnitts. Was nicht aus einer Verweiszeile stammt oder auf ein Dokument (`[Plan]`, `[Fachlich]`, `[Idee]`) zeigt, melden `check-form` und `create` beim Schreiben unter `hinweise` (siehe beim Anlegen unten). Eine Nummer, die nur erklärt, gehört in den `## Kontext`.

**Wartet ein Paket auf einen Push, sagt es das an der Verweiszeile:** `Issue #N (wartet auf Push)`. Der Zusatz gilt, wenn das Paket das geänderte Werkzeug, den Skill oder den Regeltext von #N **als Werkzeug** braucht; baut es nur auf dessen Code auf, zählt das nicht, und der Zusatz entfällt. Grund: Unbeaufsichtigte Läufe arbeiten mit dem Kit-Stand des letzten Pushs, ein Werkzeug aus #N wirkt dort also erst nach `push main`, auch wenn #N schon in In review steht. `/issues` setzt den Zusatz beim Schneiden; die Kette zieht ein so gekennzeichnetes Paket auch unter Variante B nicht nach Ready.

**Rückverweise auf Plan und fachliche Quelle:** Die Kette soll an jedem Punkt lesbar sein — vom Arbeitspaket zum Plan, vom Plan zur fachlichen Anforderung. Beide Verweise stehen **im Kontext-Abschnitt**, unmittelbar untereinander und in dieser Reihenfolge:

```
Plan: Issue #M
Fachliche Quelle: Issue #N
Plan-Entscheidungen: E<n>, …
```

- `Plan: Issue #M` — entstehen die Arbeitspakete aus einem `[Plan]`-Issue `#M` (angelegt von `/techplan`, siehe Issue #275), trägt jedes von ihnen diese Zeile.
- `Fachliche Quelle: Issue #N` — entstehen sie aus einem fachlichen Issue (`[Fachlich]`-Titel, via `/techplan #N`), kommt dieser Verweis dazu.
- `Plan-Entscheidungen: E<n>, …` — jedes Paket aus einem `[Plan]`-Issue nennt die Eintraege unter `## Architektonische Entscheidungen` des Plans, auf die seine Aufgabe sich beruft, oder woertlich `Plan-Entscheidungen: Keine.`. `issue auftrag` liest die Zeile, um der Umsetzung genau diese Entscheidungen im Wortlaut mitzugeben; fehlt sie, liefert der Auftrag alle Eintraege des Plans und sagt, dass das Paket keine Auswahl nennt.

**Niemals in den Abhängigkeiten-Abschnitt — beide nicht.** Der Nacht-Runner wertet dort jede `Issue #N`-Referenz als Abhängigkeit. Weder das Plandokument noch das fachliche Issue wird Done, solange seine Arbeitspakete laufen: Das fachliche Issue wird erst Done, wenn seine technischen Kinder fertig sind, das Plandokument ohnehin nie durch Umsetzung. Stünde der Verweis unten, blieben alle Kinder nachts dauerhaft zurückgestellt (Henne-Ei).

Der Satz bleibt trotz des Feldes `--derived-from` (siehe unten) korrekt: `derivedFrom` ist keine Body-Zeile und kann in gar keinem Abschnitt stehen; „beide" meint weiterhin die zwei Zeilen. Der Grund ist schärfer, als der Wortlaut vermuten lässt — `parseDeps` in `kit/night.mjs` wertet über `LOKALE_REFERENZ` **jedes** `#N` im Abhängigkeiten-Abschnitt als Abhängigkeit, auch ohne das Wort `Issue` davor.

**Dasselbe zusätzlich als Feld ans Board: `--derived-from`.** Neben den Body-Zeilen bekommt `issue create` die Kartennummer des **nächsten Vorfahren** mit (Issue #356) — das `[Plan]`-Issue `#M`, sonst das fachliche Issue `#N`, sonst gar nichts:

```bash
node .claude/kit/board.mjs issue create --title "Titel" --derived-from <M> --body-file <tmpdir>/neues-issue.md
```

- Liegt ein `[Plan]`-Issue vor: `--derived-from <M>`.
- Fehlt es (Plan nur in der Session freigegeben, oder Bahn 1 ohne Plandokument): Rückfall auf `--derived-from <N>`, das fachliche Issue.
- Fehlt beides: Die Option entfällt ersatzlos — kein Platzhalter, keine Null.
- **Sonderfall Pool-Idee:** Lieferte `issue create` für das Plandokument `{ideaId, pending: true}`, existiert keine Nummer `#M`. Dann greift **derselbe Rückfall** auf das fachliche Issue — kein eigener Zweig, nur derselbe.

**Feld und Zeile sagen dasselbe, sind aber verschieden haltbar — und keines ersetzt das andere.** Das Feld ist die **abfragbare** Form: Das Board kann danach gruppieren, ohne Bodies zu zerlegen. Die Zeile ist die **dauerhafte**: Ein **Projektwechsel löscht die Herkunft** am Board — die der verschobenen Karte und die aller Karten, die auf sie zeigen —, die Body-Zeilen überleben ihn. Dazu kennen `github`, `gitlab` und `local` gar kein solches Feld. Wer die Zeilen später als Dopplung zum Feld streicht, verliert die Herkunft beim ersten Umzug.

**Abgrenzung zur Plan-Modell-Konvention (Issue #266):** `Plan-Modell:` sagt, **welches Modell** den Plan geschrieben hat — den Urheber. `Plan: Issue #M` sagt, **wo er steht** — den Fundort. Beide Zeilen sind unabhängig voneinander: `Plan-Modell:` darf bei identischem Plan- und Issue-Autor entfallen, die `Plan:`-Zeile wird davon nicht berührt und steht auch dann.

**Zwei Randfälle:**

- **Plan ohne `[Plan]`-Issue:** `/issues` nimmt auch einen Plan an, der lediglich in derselben Session freigegeben wurde. Dann entsteht **keine `Plan:`-Zeile**, keine `Plan-Entscheidungen:`-Zeile und auch kein Platzhalter — die Zeile hängt allein daran, ob ein `[Plan]`-Issue als Quelle vorliegt.
- **Plan ohne fachliche Quelle:** Steht hinter dem Plandokument keine fachliche Anforderung, steht nur `Plan: Issue #M`.

Issue anlegen ueber den Board-Adapter:
```bash
printenv TMPDIR
```

Bleibt die Ausgabe von `printenv TMPDIR` leer (Linux und WSL2 ohne Sandbox), gilt `/tmp` als `<tmpdir>`.

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Kontext
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

Vor dem Anlegen prüft ein Kommando die Form jedes Pakets; erst bei `ok: true` folgt `issue create`, Verstöße werden in der Datei behoben und erneut geprüft:
```bash
node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/neues-issue.md --title "<Titel>"
```

```bash
node .claude/kit/board.mjs issue create --title "Titel" --body-file <tmpdir>/neues-issue.md
```

**Die `hinweise` aus `check-form` und `create` werden gelesen.** Neben `ok` und `verstoesse` kann das JSON den Schlüssel `hinweise` tragen. Ein Eintrag mit `art: schreibweise` nennt eine Nummer aus erläuterndem Text, ein Eintrag mit `art: dokument` einen Verweis auf ein Dokument, ein Eintrag mit `art: unbekannt` eine Nummer, die das Board nicht kennt — sie gilt als erfüllt, ein Tippfehler hielte also nichts fest. Alle drei berühren weder `ok` noch den Exit-Code, zeigen aber, was der Nachtlauf als Abhängigkeit lesen wird. Je Eintrag gilt: Ist die Nummer nicht gemeint, wird der Text vor dem Anlegen korrigiert — die Nummer verlässt den Abschnitt oder wandert in den `## Kontext` —, und `check-form` läuft erneut. Ist sie gemeint, bleibt der Text, und der Abschluss nennt den Hinweis mit Paket und Nummer. Meldet erst `create` einen Hinweis, gilt dieselbe Regel; die Korrektur geht dann per `issue update <id> --body-file <tmpdir>/neues-issue.md` an die angelegte Karte. Unbeaufsichtigt gilt dasselbe ohne Rückfrage: Die Session entscheidet je Nummer selbst.

Jeder Block ist ein **eigener** Werkzeugaufruf, die Datei liegt außerhalb des Projektverzeichnisses, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board". **Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere Mutation.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer Nummer eine `ideaId` mit `pending: true`, ist das Issue als board-lose Idee im Projekt-Ideen-Pool gelandet — die Board-Nummer entsteht erst, wenn der Mensch die Idee einplant. Konsequenzen für diesen Skill:
- Der Abschluss listet solche Issues mit **Titeln** (plus `ideaId`), nicht mit Nummern, und weist darauf hin, dass die Nummern beim Einplanen entstehen.
- Abhängigkeiten zwischen frisch angelegten Issues können noch keine `Issue #N`-Referenz tragen. Sie werden als erläuternder Freitext mit dem **Titel** des anderen Issues notiert; die `Issue #N`-Referenz trägt der Mensch beim Einplanen nach. Für den Nacht-Runner gilt Freitext ohne `#N` als keine prüfbare Abhängigkeit — bewusst akzeptiert, die Ready-Reihenfolge legt ohnehin der Mensch fest.

Status bleibt **Backlog**. Die Bewegung nach Ready ist das menschliche GO (Schritt 4) — Claude zieht Issues nie eigenmaechtig nach Ready. (Beim Ideen-Pool-Flow entsprechend: Einplanen und Ready-Ziehen sind menschlich.)

### 3b. Übernommene Review-Funde gegenlesen
Liegt ein `[Plan]`-Issue `#M` vor, liest die Session **vor dem Schneiden** dessen Kommentare mit `node .claude/kit/board.mjs issue get <M>` — die Befunde der Plan-Prüfung und vor allem `## Einarbeitung, Runde 1` mit der Liste der übernommenen Funde. Nach dem Schneiden prüft sie je übernommenem Fund, ob er in mindestens einem Paket ankommt: als Aufgabe, als Akzeptanzkriterium oder als `Entscheidung:`-Zeile. Ein Fund, der im Plan-Body steht, aber in keinem Paket ankommt, geht beim Übertrag verloren. Der Abschluss nennt jeden solchen Fund unter **Nicht übertragene Review-Funde** mit seiner Kennung und einem Satz, sonst steht dort „keine“. Unbeaufsichtigt geht dieselbe Liste als Kommentar am Plan. Trägt der Plan keinen Einarbeitungs-Kommentar, entfällt der Schritt, und der Abschluss sagt das.

### 4. Abschluss
**Die Empfehlung steht im Paket, nicht nur im Bericht.** Ist `night.stufen` in `.claude/workflow.config.json` nicht aktiv, trägt jedes angelegte Issue im Abschnitt `## Kontext` — neben `Autor-Modell:` — die Zeile `Empfohlenes Modell: <name>`. Der Nacht-Runner liest genau sie und startet die Session der Karte damit; eine Empfehlung, die nur in der Tabelle unten steht, findet er nicht. Der Name kommt aus `night.modelle`, absteigend nach Stärke geordnet: **erster Eintrag** für Aufgaben mit Architektur-, Sicherheits- oder komplexer Interaktionslogik (OAuth-Flows, neue Komponenten mit viel Zustand, Nebenläufigkeit, Datenmigrationen), **letzter Eintrag** für mechanische, klar spezifizierte Aufgaben (ein Enum erweitern, Typen nachziehen, Restyling nach Vorlage, eine Änderung nach bestehendem Muster). Fehlt die Liste oder ist sie leer, **entfällt die Zeile ersatzlos** — eine erfundene Angabe wäre schlechter als keine, und der Runner fällt ohne Zeile auf das Modell des Laufs zurück.

**Ist `night.stufen` aktiv**, trägt jedes Paket stattdessen die Zeilen `Aufgabenstufe: <schwer|mittel|leicht>` und `Stufengrund: <ein Satz>` und **keine** `Empfohlenes Modell:`-Zeile — `Autor-Modell:` bleibt, sie ist eine Herkunftsangabe, keine Empfehlung. Die mitgelieferte Regel, genau einmal im Kit: **schwer** bei Architektur-, Sicherheits- oder komplexer Interaktionslogik, **mittel** bei Änderungen an mehreren Stellen nach bestehendem Muster, **leicht** bei mechanischen, klar umrissenen Änderungen; ein belegtes `night.stufenRegel` ersetzt sie. Die Stufe gilt unabhängig davon, wann und auf welchem Weg ein Paket entsteht — auch für Pakete aus der Nacht-Kette.

Liste danach alle angelegten Issues mit Nummern und Titeln und ergänze die Tabelle: ohne aktive Einstellung mit Empfehlung und Begründung, mit aktiver Einstellung mit Stufe, Begründung und dem ihr zugeordneten Modell. Sie hilft dem Menschen, vor dem GO zu entscheiden — die Zeile(n) im Paket tragen den Wert für die Maschine, die Tabelle die Begründung für den Leser:

| Issue | Empfehlung/Stufe | Sitzungsumfang | Begründung |
|-------|-------------------|----------------|------------|
| #N | <Modell bzw. schwer\|mittel\|leicht> | <passt\|reisst> | <ein Satz> |

Nenne darunter die Pakete mit `Sitzungsumfang: reisst` beim Namen — "Voraussichtlich ueber der Sitzungszeitgrenze: #N, #M", sonst "keine" —, damit die Einschaetzung vor dem GO nicht nur in den Karten steht. Schreibe danach: "Alle Issues liegen in Backlog. Zieh die Issues die du umsetzen willst nach Ready — das ist dein GO." Wer ein Paket prüfen lassen will, ruft `/issue-review #N`; der Regelfall ist Ready ohne Paket-Review.

## Stop-Punkt
Dieser Skill endet nach dem Anlegen der Issues. Kein Code, kein Commit. Das GO (Ready-Bewegung) macht der Mensch. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die entstandenen Arbeitspakete selbst nach Ready. Die Ausnahme gilt dem Runner, nicht diesem Skill — keine Ready-Bewegung durch diesen Skill.
