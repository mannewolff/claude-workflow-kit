---
name: local-check
description: Schritt 6 des 9-Schritt-Prozesses — führt die Pflicht-Checks aus der Config aus und gibt eine grüne Checklist zurück. Nutze diesen Skill wenn der Nutzer /local-check aufruft oder Schritt 6 (lokale Prüfung) startet.
user-invocable: true
---

# Local Check

Schritt 6 des 9-Schritt-Prozesses: Alle Pflicht-Checks laufen lokal durch. Output ist eine grüne (oder explizit rote) Checklist.

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Relevante Felder — alle gelten **teamweit** und sind lokal nicht überschreibbar:
- `buildChecks`: Liste der auszuführenden Build-/Test-Kommandos (z.B. `["mvn verify", "npm run build"]`)
- `mutationCommand`: Mutations-Test-Kommando (optional, z.B. `"mvn org.pitest:pitest-maven:mutationCoverage"`)
- `formatFixCommand`: Kommando, das Formatierungsverstöße mechanisch behebt (optional, z.B. `"mvn spotless:apply"` oder `"npx prettier --write ."`). Wird heute nur vom Nacht-Runner genutzt (Issue #169).
- `mainBranch`: Basis-Branch für den Prüf-Anker (Default: `main`). Der Platzhalter `<mainBranch>` in den Kommandos unten steht für diesen Wert aus `.claude/workflow.config.json` — wie ihn die Push-Skills bereits lesen.

Dass diese Felder im Repository liegen, ist der Punkt: Hätte jeder seine eigenen `buildChecks`, hieße „grün" bei zwei Entwicklern nicht dasselbe.

Fehlt die Config: Führe `buildChecks: []` aus und weise darauf hin, dass keine Checks konfiguriert sind.

## Pflicht-Checks

**Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.** Grün heißt „über der vereinbarten Schwelle", nicht „vollständig getestet". Als Vertrauenssignal trägt eine Metrik nur, wenn sie ehrlich bleibt: Eine Lücke muss echt ungetestete Logik bedeuten, nie stillschweigend ausgeschlossenes Rauschen. Liegt der Coverage-Report unter dem im Projekt vereinbarten Ziel (siehe Projekt-Guide bzw. `workflow.config.json`), das explizit als Signal ausweisen statt es still durchzuwinken — der Mensch entscheidet, ob reingeschaut oder Tests nachgezogen werden.

**Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.** Ein KI-Modell reproduziert das häufigste, nicht das aktuellste Muster seines Trainingskorpus — abgekündigte APIs und veraltete Idiome tauchen deshalb wiederholt und flächendeckend auf. Solche Fehlerklassen gehören als harte Lint-/Compiler-Leitplanke in die `buildChecks` dieses Gates, nicht als Bitte in eine CLAUDE-`*`.md: Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen, eine Leitplanke im Gate kann gar nicht erst grün committen. Die Leitplanke leitet aus den vorhandenen Annotationen ab, statt eine handgepflegte Verbotsliste zu führen (die selbst veraltet) — z. B. `@typescript-eslint/no-deprecated` (liest JSDoc-`@deprecated`), Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets. SonarQube o. Ä. bleibt Sicherheitsnetz, nicht Hauptfang: Der Round-Trip über `main` fängt sicher, aber spät — der Check gehört nach vorn, in dieses Gate.

**Leitplanke: Lang laufende Checks brauchen einen großzügigen Zeitrahmen.** Das Bash-Tool killt Kommandos nach einem generischen Default von rund zwei Minuten, wenn kein größerer Wert übergeben wird. Ein `mvn verify` mit vollem Testcontainers-IT-Lauf, ein Mutationstest oder ein Multi-Modul-Build überschreiten das unter Last regelmäßig — der Check stirbt dann nicht an einem echten Fehler, sondern an der Uhr. Deshalb für solche Kommandos immer einen großzügigen Zeitrahmen explizit setzen: Richtwert mindestens 5 Minuten, bei IT-lastigen Multi-Modul-Builds 15 Minuten und mehr. Das bleibt eine Bitte an den Aufrufer, weil ein Werkzeug sich **nicht mehr Zeit geben kann, als sein Aufrufer** ihm einräumt. Läuft ein Check trotzdem in den Timeout, ihn **nicht** stillschweigend mit demselben Wert erneut starten — entweder den Timeout erhöhen und das benennen, oder den Check eindeutig als Fehlschlag zurückmelden. Ein zweiter Lauf ins gleiche Limit kostet die doppelte Zeit und liefert dieselbe Nicht-Antwort. Unsichtbar bleibt ein Abbruch an der Uhr dabei nicht: `checks.mjs run` schreibt seine Zusammenfassung begleitend, und nur die letzte Fassung ist abgeschlossen — stirbt der Lauf an der Uhr, bleibt sie **unabgeschlossen und ungrün**.

**Leitplanke: Keine Session endet mit laufender eigener Arbeit.** „Ich melde mich, sobald der Lauf durch ist" ist nur dann eine gültige Aussage, wenn danach garantiert noch ein Zug folgt, der das Ergebnis liest. Das ist nicht immer der Fall: In manchen Ausführungskontexten endet mit genau dieser Ankündigung die gesamte Ausführung — der Hintergrundprozess und sein Ergebnis gehen unwiederbringlich verloren, und eine außenstehende Beobachtung (z. B. ein Kanban-Board) sieht nur einen Fehlschlag, obwohl die eigentliche Arbeit bereits fertig war. Wer einen langen Lauf angestoßen hat, wartet deshalb auf sein Ergebnis oder bricht ihn ab und meldet den Abbruch als Fehlschlag. Hintergrundarbeit bleibt erlaubt; unzulässig ist allein das Aufhören, während sie noch läuft (Issue #754).

### 1. Build-Checks aus der Config

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

Das Kommando wählt die betroffenen `buildChecks` aus und führt genau sie aus. `<mainBranch>` ist der Wert aus `.claude/workflow.config.json` (Default: `main`).

**Gefahren wird die Paketstufe.** Der Aufruf trägt kein `--stufe`: Die Paketstufe ist die Vorgabe, und sie bleibt hier die richtige. Der mechanische Halt vor dem Push sitzt seit skills-20 in `/push-main` selbst — dieser Schritt ist die lokale Prüfung vor der menschlichen Testrunde, und sie teuer zu machen nähme ihr den Nutzen. Trägt eine Prüfung im Projekt die Stufe `push` oder `merge`, erscheint sie darum in der Liste `ausgelassen`, mit ihrer Stufe als Grund. Das ist **kein Mangel**, sondern ihr Zeitpunkt: Sie läuft in `/push-main` bzw. `/merge-production`. In der Checklist steht sie wie jede andere Auslassung.

**Und hier wird kein `--abschluss` gesetzt.** Das ist kein Versehen, sondern der
Unterschied der Zeitpunkte: `--abschluss` gehoert an das Ende **einer** Karte, wo die
`implement-*`-Skills vor ihrem Commit gegen `HEAD` messen. Dieser Schritt misst den Stand
**mehrerer Pakete** gegen den Merge-Base — er schliesst keine Karte ab, und die
Zusammenspiel-Pruefungen (`nichtBeimAbschluss`) sind hier genau die, die gebraucht werden.

**Warum dieser Anker und nicht `HEAD`.** Dieser Schritt läuft **nach** dem lokalen Commit aus Schritt 5. Auf sauberem Arbeitsbaum sähe `git diff HEAD` nichts — das Kommando meldete `leeresPaket`, ließe **jede** Prüfung aus, und der Bericht wiese das als korrekt aus. Der letzte gepushte Stand ist der richtige Bezug: Der Schritt sichert alles ab, was seit dem letzten Push dazugekommen ist, also genau das, was gleich hinausgeht. (Die `implement-*`-Skills prüfen dagegen **vor** dem Commit gegen den Default `HEAD` — dort misst er genau ein Arbeitspaket.)

**Randfall: leerer Anker.** Schlägt `git merge-base` fehl (kein `origin`, detached HEAD, kein gemeinsamer Vorfahre), liefert die Substitution einen **leeren String**, und der Aufruf wird zu `--since ""`. `checks.mjs` behandelt einen leeren Anker wie einen nicht auflösbaren und fährt den **vollen Umfang** — nie wie einen fehlenden. Ein fehlender ergäbe den Default `HEAD` und damit auf committetem Stand gar keine Prüfung. Diese Zusicherung nicht „vereinfachen": Sie ist der Grund, warum ein kaputter Anker zu mehr Prüfung führt statt zu keiner.

Bei Fehler: Ausgabe zeigen, Ursache analysieren, Fix vorschlagen. Nicht stillschweigend weitermachen.

**Bevorzugt im Vordergrund ausführen** — das Ergebnis ist dann direkt sichtbar und eindeutig dem Check zuzuordnen.

Den **Rückgabewert** des Prüfkommandos liest `checks.mjs run` selbst: Es ruft jedes Kommando auf und wertet dessen eigenen Wert aus, nicht den einer Kette, die jemand um den Aufruf herum baut. Eine Anleitung, den Wert erst in eine Datei zu schreiben und von dort zu lesen, braucht es dafür nicht mehr. Das gilt für den Aufruf durch `run`; baut ein Projekt in seinem `cmd` selbst eine Kette, sorgt es dort dafür, dass der Wert nicht maskiert wird.

Auch die Prüfung auf **allgemeine Fehlermerkmale** übernimmt `run`: Es prüft die Ausgabe jedes Kommandos auf eine feste Liste, und ein Treffer färbt die Prüfung rot, auch bei Rückgabewert 0.

Beides ist eine Bedienvorgabe, die das Werkzeug trägt statt dieses Texts — siehe den Maßstab „Regel im Text oder Regel im Werkzeug" in `CLAUDE-workflow.md`.

### 1b. Format-Fix bei roten Checks (wenn konfiguriert)

Nur wenn mindestens ein `buildChecks`-Kommando rot ist **und** `formatFixCommand` in der geteilten Config gesetzt ist:

```bash
<formatFixCommand>
```

Danach die Prüfung **genau einmal** erneut ausführen — derselbe `checks.mjs run`-Aufruf mit demselben Anker:

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

Kein Loop, keine zweite Runde — dieselbe Grenze wie im Nacht-Runner (Issue #169), aus demselben Grund: Ein Fix, der beim ersten Mal nichts bewirkt, bewirkt beim zweiten Mal auch nichts, kostet aber die volle Laufzeit noch einmal.

Dass die Auswahl beim zweiten Lauf größer ausfallen kann als beim ersten, ist gewollt: Der Fix hat Dateien geändert, also hat sich die Betroffenheit geändert.

Nicht nachfragen, bevor der Fix läuft — eine Formatierung ist mechanisch und über `git diff` vollständig einsehbar. Wohl aber melden, dass er lief.

**Berichtspflicht.** Ein Format-Fix hinterlässt uncommittete Änderungen im Arbeitsbaum. Eine Checklist, die danach nur „alles grün" sagt, ist irreführend: Sie beschreibt einen Zustand, den es im letzten Commit nicht gibt. Der Bericht muss beides ausweisen:

```
- ❌ npm run lint → 3 Formatierungsverstöße
- 🔧 Format-Fix (npx prettier --write .) → ausgeführt, 3 Dateien geändert
- ✅ npm run lint → grün (nach Format-Fix)

Hinweis: Der Format-Fix hat den Arbeitsbaum verändert. Die Änderungen müssen
committet werden, sonst ist der nächste Lauf wieder rot.
```

Bleiben die Checks nach dem Fix rot, gilt unverändert: roter Check stoppt den Prozess. Der Bericht sagt dann ausdrücklich, dass der Format-Fix lief und **nicht gereicht hat** — sonst sucht der Mensch an der falschen Stelle.

Ohne gesetztes `formatFixCommand` entfällt dieser Schritt ersatzlos.

### 2. Mutations-Test (wenn konfiguriert)

```bash
<mutationCommand>
```

Nur wenn `mutationCommand` in der Config gesetzt ist. Wenn der Test nicht lokal ausführbar ist (kein Build-Tool, kein Daemon), das explizit vermerken.

**`mutationCommand` bleibt unverändert und läuft weiterhin immer.** Es steht nicht in `buildChecks` und ist damit **nicht Teil der bereichsbezogenen Auswahl** — es wird direkt ausgeführt, ohne `checks.mjs`, unabhängig davon, welche Bereiche der Anker findet. Das ist Absicht und keine Lücke: Es war im Bestand schon dem Build nachgelagert, und es in die Auswahl zu ziehen erweiterte den Zuschnitt der Umstellung.

**`mutationCommand` ist keine Gütemessung.** Die beiden liegen inhaltlich nah beieinander — auch die Gütemessung misst, wie viele absichtlich eingebauten Fehler die Tests bemerken —, aber `mutationCommand` bleibt, was es war: ein nachgelagertes Kommando. Es trägt **keine Marke**, sein Ergebnis wird nicht ausgewertet, und es löst **keinen Halt** aus; ein Wert, der niemandem gefällt, bleibt eine Zahl im Bericht. Wer die Verbindlichkeit will, führt sein Kommando stattdessen als `buildChecks`-Eintrag mit `guete`-Block (`muster` und `marke`): Erst dort wird der gemessene Anteil erhoben, gegen die Marke gehalten und ein Wert darunter zum roten Lauf wie jede andere rote Pflichtprüfung. Beides zugleich zu setzen ergibt zwei Läufe desselben Werkzeugs, von denen nur einer zählt.

### 3. Manuelle UI-Verifikation (bei Frontend-Änderungen)

Wenn die letzten Commits Frontend-Dateien betreffen:

> **Manuelle Prüfung erforderlich:** Starte den Dev-Server (`<startkommando>`) und klicke durch:
> - Golden Path: <Beschreibung des Hauptfalls>
> - Edge Cases: <Beschreibung der Grenzfälle>
>
> Melde das Ergebnis, bevor es weitergeht.

Die KI kann keinen Browser bedienen. Dieser Schritt bleibt beim Menschen.

## Ergebnis

Checklist im Format:

```
### Lokale Prüfung

- ✅ <gelaufener Check> → <Ergebnis>
- ✅ <gelaufener Check> → <Ergebnis>
- ⏭️ <ausgelassener Check> → ausgelassen (<Grund aus checks.mjs>)
- ✅ Mutations-Test → <Ergebnis>
- ⏳ UI-Verifikation → manuelle Prüfung ausstehend

Alle betroffenen Checks grün. UI-Check steht aus.
```

Die Checklist nennt **gelaufene und ausgelassene** Prüfungen, jede Auslassung mit dem Grund, den `checks.mjs` ausgibt. Nur die Läufe zu nennen genügt nicht: Ein verkürzter Lauf sähe sonst aus wie ein vollständiger, und der Mensch müsste die Auslassungen indirekt erschließen. Meldet das Kommando `leeresPaket`, steht das ausdrücklich als eigene Zeile („keine Prüfung, weil seit dem letzten Push nichts verändert wurde") — nicht als leere Liste.

Wenn `buildChecks` leer ist: Hinweis ausgeben "Keine buildChecks konfiguriert. Passe `.claude/workflow.config.json` an — die Datei gehört ins Repository, die Änderung also committen." Kein Fehler, kein Abbruch.

Roter Check (`❌`) stoppt den Prozess. Nicht weitergehen, bevor der Fehler geklärt ist.

## Stop-Punkt

Nach grüner Checklist wartet der Prozess auf den Start von `/review` (Schritt 7). Push erfolgt erst nach expliziter Trigger-Phrase `push main`.
