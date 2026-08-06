---
name: local-check
description: Schritt 6 des 9-Schritt-Prozesses — führt die Pflicht-Checks aus der Config aus und gibt eine grüne Checklist zurück. Nutze diesen Skill wenn der Nutzer /local-check aufruft oder Schritt 6 (lokale Prüfung) startet.
user-invocable: true
---

# Local Check

Schritt 6 des 9-Schritt-Prozesses: Alle Pflicht-Checks laufen lokal durch. Output ist eine grüne (oder explizit rote) Checklist.

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Relevante Felder — alle drei gelten **teamweit** und sind lokal nicht überschreibbar:
- `buildChecks`: Liste der auszuführenden Build-/Test-Kommandos (z.B. `["mvn verify", "npm run build"]`)
- `mutationCommand`: Mutations-Test-Kommando (optional, z.B. `"mvn org.pitest:pitest-maven:mutationCoverage"`)
- `formatFixCommand`: Kommando, das Formatierungsverstöße mechanisch behebt (optional, z.B. `"mvn spotless:apply"` oder `"npx prettier --write ."`). Wird heute nur vom Nacht-Runner genutzt (Issue #169).

Dass diese Felder im Repository liegen, ist der Punkt: Hätte jeder seine eigenen `buildChecks`, hieße „grün" bei zwei Entwicklern nicht dasselbe.

Fehlt die Config: Führe `buildChecks: []` aus und weise darauf hin, dass keine Checks konfiguriert sind.

## Pflicht-Checks

**Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.** Grün heißt „über der vereinbarten Schwelle", nicht „vollständig getestet". Als Vertrauenssignal trägt eine Metrik nur, wenn sie ehrlich bleibt: Eine Lücke muss echt ungetestete Logik bedeuten, nie stillschweigend ausgeschlossenes Rauschen. Liegt der Coverage-Report unter dem im Projekt vereinbarten Ziel (siehe Projekt-Guide bzw. `workflow.config.json`), das explizit als Signal ausweisen statt es still durchzuwinken — der Mensch entscheidet, ob reingeschaut oder Tests nachgezogen werden.

**Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.** Ein KI-Modell reproduziert das häufigste, nicht das aktuellste Muster seines Trainingskorpus — abgekündigte APIs und veraltete Idiome tauchen deshalb wiederholt und flächendeckend auf. Solche Fehlerklassen gehören als harte Lint-/Compiler-Leitplanke in die `buildChecks` dieses Gates, nicht als Bitte in eine CLAUDE-`*`.md: Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen, eine Leitplanke im Gate kann gar nicht erst grün committen. Die Leitplanke leitet aus den vorhandenen Annotationen ab, statt eine handgepflegte Verbotsliste zu führen (die selbst veraltet) — z. B. `@typescript-eslint/no-deprecated` (liest JSDoc-`@deprecated`), Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets. SonarQube o. Ä. bleibt Sicherheitsnetz, nicht Hauptfang: Der Round-Trip über `main` fängt sicher, aber spät — der Check gehört nach vorn, in dieses Gate.

**Leitplanke: Lang laufende Checks brauchen einen explizit gesetzten Timeout.** Das Bash-Tool killt Kommandos nach einem generischen Default von rund zwei Minuten, wenn kein größerer Wert übergeben wird. Ein `mvn verify` mit vollem Testcontainers-IT-Lauf, ein Mutationstest oder ein Multi-Modul-Build überschreiten das unter Last regelmäßig — der Check stirbt dann nicht an einem echten Fehler, sondern an der Uhr, und im schlechtesten Fall endet die Session kommentarlos, ohne je ein Ergebnis gemeldet zu haben. Deshalb für solche Kommandos immer einen großzügigen Timeout explizit setzen: Richtwert mindestens 5 Minuten, bei IT-lastigen Multi-Modul-Builds 15 Minuten und mehr. Läuft ein Check trotzdem in den Timeout, ihn **nicht** stillschweigend mit demselben Wert erneut starten — entweder den Timeout erhöhen und das benennen, oder den Check eindeutig als Fehlschlag zurückmelden. Ein zweiter Lauf ins gleiche Limit kostet die doppelte Zeit und liefert dieselbe Nicht-Antwort.

**Leitplanke: Ein im Hintergrund gestarteter Check muss vor dem Abschluss tatsächlich abgeholt werden.** „Ich melde mich, sobald der Lauf durch ist" ist nur dann eine gültige Aussage, wenn danach garantiert noch ein Zug folgt, der das Ergebnis liest. Das ist nicht immer der Fall: In manchen Ausführungskontexten endet mit genau dieser Ankündigung die gesamte Ausführung — der Hintergrundprozess und sein Ergebnis gehen unwiederbringlich verloren, und eine außenstehende Beobachtung (z. B. ein Kanban-Board) sieht nur einen Fehlschlag, obwohl die eigentliche Arbeit bereits fertig war. Deshalb: einen im Hintergrund gestarteten Pflichtcheck vor Abschluss des Berichts immer aktiv abwarten und den geschriebenen Exit-Code einlesen (siehe oben) — nie mit einer bloßen Ankündigung enden. Reicht die verbleibende Zeit dafür nicht, den Check eindeutig als offen/nicht verifiziert kennzeichnen, statt eine Rückmeldung zu versprechen, die möglicherweise nie erfolgt.

### 1. Build-Checks aus der Config

Führe alle Kommandos in `buildChecks` sequenziell aus:

```bash
<kommando aus buildChecks[0]>
<kommando aus buildChecks[1]>
...
```

Bei Fehler: Ausgabe zeigen, Ursache analysieren, Fix vorschlagen. Nicht stillschweigend weitermachen.

**Bevorzugt im Vordergrund ausführen** — der Exit-Code ist dann direkt sichtbar und eindeutig dem Check zuzuordnen.

Wird ein langer Check dennoch in den Hintergrund verschoben: den **echten** Exit-Code in eine Datei schreiben und von dort auswerten, statt dem automatisch gemeldeten Abschluss-Status der Kommandokette zu vertrauen:

```bash
<kommando> > log.txt 2>&1 ; echo "EXIT=$?" >> log.txt
```

Ein nachgestelltes `echo` maskiert den Exit-Code, wenn die Auswertung nur auf den gemeldeten Abschluss-Status der gesamten Kommandokette schaut — der ist dann immer der von `echo` (0), nicht der des eigentlichen Checks. Die Auswertung muss den in der Datei geschriebenen Wert lesen (`grep "^EXIT="`), nicht den Status der Kommandokette selbst.

Zusätzlich zu tool-spezifischen Erfolgsmeldungen generisch auf `[ERROR]` bzw. `BUILD FAILURE` im Log prüfen, nicht nur auf enge Stichworte (z. B. nur PIT-Survivors oder nur das Wort „FAILURE") — sonst rutschen andere Fehlerarten (z. B. Formatierungs- oder Lint-Violations) unbemerkt durch.

### 1b. Format-Fix bei roten Checks (wenn konfiguriert)

Nur wenn mindestens ein `buildChecks`-Kommando rot ist **und** `formatFixCommand` in der geteilten Config gesetzt ist:

```bash
<formatFixCommand>
```

Danach die `buildChecks` **genau einmal** erneut ausführen. Kein Loop, keine zweite Runde — dieselbe Grenze wie im Nacht-Runner (Issue #169), aus demselben Grund: Ein Fix, der beim ersten Mal nichts bewirkt, bewirkt beim zweiten Mal auch nichts, kostet aber die volle Laufzeit noch einmal.

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

- ✅ <buildChecks[0]> → <Ergebnis>
- ✅ <buildChecks[1]> → <Ergebnis>
- ✅ Mutations-Test → <Ergebnis>
- ⏳ UI-Verifikation → manuelle Prüfung ausstehend

Alle automatisierten Checks grün. UI-Check steht aus.
```

Wenn `buildChecks` leer ist: Hinweis ausgeben "Keine buildChecks konfiguriert. Passe `.claude/workflow.config.json` an — die Datei gehört ins Repository, die Änderung also committen." Kein Fehler, kein Abbruch.

Roter Check (`❌`) stoppt den Prozess. Nicht weitergehen, bevor der Fehler geklärt ist.

## Stop-Punkt

Nach grüner Checklist wartet der Prozess auf den Start von `/review` (Schritt 7). Push erfolgt erst nach expliziter Trigger-Phrase `push main`.
