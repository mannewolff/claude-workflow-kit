---
name: local-check
description: Schritt 6 des 9-Schritt-Prozesses — führt die Pflicht-Checks aus der Config aus und gibt eine grüne Checklist zurück. Nutze diesen Skill wenn der Nutzer /local-check aufruft oder Schritt 6 (lokale Prüfung) startet.
user-invocable: true
---

# Local Check

Schritt 6 des 9-Schritt-Prozesses: Alle Pflicht-Checks laufen lokal durch. Output ist eine grüne (oder explizit rote) Checklist.

## Vorbedingung

Lies `.claude/workflow.config.json`. Relevante Felder:
- `buildChecks`: Liste der auszuführenden Build-/Test-Kommandos (z.B. `["mvn verify", "npm run build"]`)
- `mutationCommand`: Mutations-Test-Kommando (optional, z.B. `"mvn org.pitest:pitest-maven:mutationCoverage"`)

Fehlt die Config: Führe `buildChecks: []` aus und weise darauf hin, dass keine Checks konfiguriert sind.

## Pflicht-Checks

**Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.** Grün heißt „über der vereinbarten Schwelle", nicht „vollständig getestet". Als Vertrauenssignal trägt eine Metrik nur, wenn sie ehrlich bleibt: Eine Lücke muss echt ungetestete Logik bedeuten, nie stillschweigend ausgeschlossenes Rauschen. Liegt der Coverage-Report unter dem im Projekt vereinbarten Ziel (siehe Projekt-Guide bzw. `workflow.config.json`), das explizit als Signal ausweisen statt es still durchzuwinken — der Mensch entscheidet, ob reingeschaut oder Tests nachgezogen werden.

**Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.** Ein KI-Modell reproduziert das häufigste, nicht das aktuellste Muster seines Trainingskorpus — abgekündigte APIs und veraltete Idiome tauchen deshalb wiederholt und flächendeckend auf. Solche Fehlerklassen gehören als harte Lint-/Compiler-Leitplanke in die `buildChecks` dieses Gates, nicht als Bitte in eine CLAUDE-`*`.md: Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen, eine Leitplanke im Gate kann gar nicht erst grün committen. Die Leitplanke leitet aus den vorhandenen Annotationen ab, statt eine handgepflegte Verbotsliste zu führen (die selbst veraltet) — z. B. `@typescript-eslint/no-deprecated` (liest JSDoc-`@deprecated`), Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets. SonarQube o. Ä. bleibt Sicherheitsnetz, nicht Hauptfang: Der Round-Trip über `main` fängt sicher, aber spät — der Check gehört nach vorn, in dieses Gate.

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

Wenn `buildChecks` leer ist: Hinweis ausgeben "Keine buildChecks konfiguriert. Passe `.claude/workflow.config.json` an." Kein Fehler, kein Abbruch.

Roter Check (`❌`) stoppt den Prozess. Nicht weitergehen, bevor der Fehler geklärt ist.

## Stop-Punkt

Nach grüner Checklist wartet der Prozess auf den Start von `/review` (Schritt 7). Push erfolgt erst nach expliziter Trigger-Phrase `push main`.
