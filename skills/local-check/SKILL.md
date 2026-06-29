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

### 1. Build-Checks aus der Config

Führe alle Kommandos in `buildChecks` sequenziell aus:

```bash
<kommando aus buildChecks[0]>
<kommando aus buildChecks[1]>
...
```

Bei Fehler: Ausgabe zeigen, Ursache analysieren, Fix vorschlagen. Nicht stillschweigend weitermachen.

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

- ✅ mvn verify → BUILD SUCCESS (47 Tests, 0 Fehler)
- ✅ npm run build → fertig in 3,2s
- ✅ Mutations-Test → 87% (Schwelle 80% erreicht)
- ⏳ UI-Verifikation → manuelle Prüfung durch Manne ausstehend

Alle automatisierten Checks grün. UI-Check steht aus.
```

Roter Check (`❌`) stoppt den Prozess. Nicht weitergehen, bevor der Fehler geklärt ist.

## Stop-Punkt

Nach grüner Checklist wartet der Prozess auf den Start von `/review` (Schritt 7). Push erfolgt erst nach expliziter Trigger-Phrase `push main`.
