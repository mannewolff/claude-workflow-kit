Plan-Modell: GPT-5 (Codex)

## Ziel

Das ist **Bahn 2**.

Das `claude-workflow-kit` wird zum **`ki-workflow-kit`** weiterentwickelt. Alle 15 Workflow-Skills und der vollstaendige 9-Schritt-Prozess sollen sowohl mit Claude Code als auch mit Codex funktionieren:

- interaktive Arbeit,
- Planung und Issue-Erstellung,
- Implementierung und lokale Checks,
- Reviews mit frischen Modellen,
- Push- und Merge-Stop-Punkte,
- Kontext-Vault und Dokumentation,
- unbeaufsichtigter Nachtbetrieb.

Die vorhandenen Konfigurationsdateien bleiben gemeinsame Quelle fuer beide Agenten:

- `.claude/workflow.config.json`
- `.claude/workflow.config.local.json`
- `.claude/kontext.config.json`
- `.claude/settings.json`
- `.claude/settings.local.json`

Es werden zunaechst keine parallelen `.codex`-Kopien dieser fachlichen Konfiguration eingefuehrt.

## Betroffene Bereiche

- Kanonische Skills unter `skills/`
- Claude-Ausgabe unter `.claude/skills/`
- Codex-Ausgabe unter `.agents/skills/`
- Prozessbeschreibung unter `templates/CLAUDE-workflow.md`
- neue Codex-Projektanweisung `AGENTS.md`
- `install.mjs`
- `kit/board.mjs`
- `kit/night.mjs`
- `tools/sync-blobs.mjs`
- `.gitignore`
- `.codex/config.toml`
- Konfigurationsschema und Templates
- Tests unter `test/`
- README, Dokumentation, Website, Changelog und Release-Prozess
- Repository-, Paket- und Sonar-Bezeichnungen

Die vorhandene `.agents/skills`-Kopie ist kein belastbarer Ausgangspunkt: Sie ist gitignored, veraltet und enthaelt fehlerhafte mechanische Ersetzungen wie `.Codex/kit`, `Codex-opus-5` und `Codex Sonnet`.

## Architektonische Entscheidungen

### Ein fachlicher Kern, zwei Host-Ausgaben

Die fachlichen Workflow-Regeln werden nur einmal unter `skills/` gepflegt. Daraus entstehen kontrolliert:

- Claude-Skills unter `.claude/skills/`
- Codex-Skills unter `.agents/skills/`

Host-spezifische Unterschiede werden ueber kleine Adapter oder gezielte Templates abgebildet, nicht durch zwei unabhaengig gepflegte vollstaendige Skill-Saetze.

Begruendung: Die bereits vorhandene Codex-Kopie zeigt, dass vollstaendige Kopien sofort driften.

### `.agents/skills` ist das Codex-Ziel

Codex laedt Repository-Skills offiziell aus `.agents/skills` und benutzerweite Skills aus `~/.agents/skills`.

Begruendung: Damit folgt das Kit dem nativen Codex-Erkennungsmechanismus und benoetigt keine Sonderkonfiguration fuer seine Skills.

### `AGENTS.md` ergaenzt die Claude-Prozessdatei

Fuer Codex wird eine `AGENTS.md` erzeugt, die dieselben verbindlichen Prozessregeln enthaelt wie die Claude-Projektanweisung. Beide Dateien werden aus einer gemeinsamen neutralen Prozessquelle erzeugt.

Begruendung: Codex liest `AGENTS.md` automatisch vor der Arbeit und unterstuetzt verschachtelte Projektanweisungen.

### Die `.claude`-Konfiguration bleibt vorerst gemeinsam

`board.mjs`, alle Skills und beide Nacht-Runner verwenden weiterhin dieselben fachlichen Config-Dateien unter `.claude`.

`.codex/config.toml` enthaelt ausschliesslich Codex-native Einstellungen wie Sandbox, Umgebungsvariablen und Freigabestrategie. Es dupliziert keine Workflow-Felder.

Begruendung: Damit gibt es genau eine Team-Konfiguration und bestehende Projekte funktionieren ohne Config-Migration.

### Modell- und Agentenidentitaet werden getrennt

Zusaetzlich zu `KIT_AGENT_MODEL` wird `KIT_AGENT_KIND=claude|codex` eingefuehrt.

Feste Texte wie:

- `Co-Authored-By: Claude Sonnet ...`
- „Opus-Subagent“
- Modellnamen mit zwingendem `claude-`-Praefix

werden durch konfigurierbare beziehungsweise zur Laufzeit ermittelte Werte ersetzt.

Begruendung: Modell, ausfuehrender Agent und Review-Werkzeug sind unterschiedliche Eigenschaften.

### Reviews bekommen Host-Adapter

Die fachlichen Review-Prompts und Rollen bleiben gemeinsam. Nur das Starten einer frischen Session ist hostspezifisch:

- Claude: Claude-Subagent beziehungsweise Claude CLI
- Codex: Codex-Subagent beziehungsweise `codex exec`
- Fremdmodell: konfiguriertes Kommando ueber stdin

Begruendung: Ein blosses Ersetzen von `kind: "claude"` durch `kind: "codex"` wuerde gemischte Reviews und bestehende Konfigurationen zerstoeren.

### Der Nacht-Runner unterstuetzt beide Agenten

`night.mjs` erhaelt `--agent claude|codex`. Der Codex-Adapter verwendet `codex exec` mit:

- JSONL-Ausgabe,
- ephemeraler Session,
- explizitem Modell und Reasoning-Aufwand,
- `workspace-write`,
- einer fuer unbeaufsichtigte Laeufe geeigneten Freigabestrategie.

`danger-full-access` wird kein Default.

Begruendung: Schreibzugriff und Freigabeverhalten muessen fuer den unbeaufsichtigten Codex-Betrieb explizit und mit moeglichst kleinen Rechten festgelegt werden.

### Technische Portierung vor Umbenennung

Zuerst wird Funktionsparitaet hergestellt. Danach werden Produkt, Dokumentation und externe Bezeichnungen zu `ki-workflow-kit` umbenannt.

Begruendung: So lassen sich Portierungsfehler von reinen Namensaenderungen unterscheiden.

## Geplante Aenderungen

### 1. Paritaetsmatrix und Schutztests

Fuer alle 15 Skills wird festgehalten:

- Ausloesung in Claude und Codex
- gelesene Konfiguration
- Board-Operationen
- Datei- und Git-Schreibzugriffe
- Subagenten und Reviewer
- menschliche Stop-Punkte
- Eignung fuer den Nachtbetrieb

Neue Tests verhindern:

- `.Codex`-Pfade,
- erfundene Claude-Modellnamen fuer Codex,
- feste Claude-Co-Author-Zeilen,
- fehlende oder veraltete Codex-Skills,
- unterschiedliche fachliche Pflichtregeln zwischen beiden Ausgaben.

### 2. Skills agentenneutralisieren

Alle Quelldateien unter `skills/` werden geprueft und ueberarbeitet:

- „Claude“ nur noch dort, wo wirklich Claude Code gemeint ist.
- Allgemeine Prozessregeln sprechen von „KI“ oder „Agent“.
- Claude-Aufruf `/plan` und Codex-Aufruf `$plan` werden hostspezifisch dokumentiert.
- `.claude/kit/board.mjs` bleibt zunaechst der gemeinsame ausfuehrbare Pfad.
- `review` und `issue-review` erhalten explizite Claude-/Codex-Ausfuehrungszweige.
- `kontext`, `document` und `retro` beruecksichtigen `AGENTS.md` zusaetzlich zu Claude-Projektdateien.
- Commit-Zuordnung wird aus der echten Agentenidentitaet erzeugt oder konfigurierbar deaktiviert.

### 3. Prozessbeschreibung generieren

Eine neutrale Prozessquelle wird eingefuehrt. Daraus werden erzeugt:

- Claude-Prozessdatei
- Codex-`AGENTS.md`
- gegebenenfalls Auszuege fuer README und Dokumentation

Die Inhalte bleiben fachlich identisch; lediglich Aufrufsyntax und Hostbegriffe unterscheiden sich.

### 4. Installer auf Dualbetrieb erweitern

Der Installer fragt zusaetzlich:

- Claude,
- Codex,
- beide.

Er installiert abhaengig von Auswahl und Scope:

- `.claude/skills` oder `~/.claude/skills`
- `.agents/skills` oder `~/.agents/skills`
- gemeinsame `.claude/kit`-Runtime
- gemeinsame `.claude/workflow.config.json`
- Claude-Prozessdatei
- Codex-`AGENTS.md`
- optional eine vorsichtig ergaenzte `.codex/config.toml`

Vorhandene Configs und fremde `.codex/config.toml`-Eintraege bleiben erhalten. Re-Installationen werden idempotent.

Die `.gitignore` wird so angepasst, dass `.agents/skills`, `AGENTS.md` und benoetigte `.codex`-Teamdateien versionierbar sind, persoenliche Einstellungen und Laufzeitdaten aber ignoriert bleiben.

### 5. Board- und Config-Code entkoppeln

`board.mjs` wird von Claude-Annahmen bereinigt:

- generische Fehlermeldungen,
- `KIT_AGENT_KIND`,
- beliebige Modell-IDs,
- Reviewer-Typen fuer Claude, Codex und Kommando,
- Kontextsuche mit `AGENTS.md` und Claude-Projektdateien.

Die bestehenden `.claude`-Config-Pfade und ihre Praezedenz bleiben erhalten.

### 6. Nacht-Runner portieren

`night.mjs` bekommt eine interne Executor-Schnittstelle:

- `ClaudeExecutor`
- `CodexExecutor`

Der Codex-Zweig uebernimmt:

- Start ueber `codex exec`
- JSONL-Interpretation
- Modell und Reasoning-Aufwand
- Sandbox- und Approval-Konfiguration
- Weitergabe von `KIT_AGENT_KIND` und `KIT_AGENT_MODEL`
- Codex-spezifische Diagnose bei Rechte- oder Netzwerkproblemen

Unveraendert bleiben:

- Ready-Reihenfolge,
- Dirty-Tree-Gate,
- Timeout,
- Salvage,
- Board-Zustand als Erfolgskriterium,
- kein automatischer Push,
- Review-Nacht und Implementierungsnacht als getrennte Laeufe.

Die Umgebungsvariablen aus `.claude/settings.json` und `.claude/settings.local.json` werden auch fuer den Codex-Nachtlauf uebernommen. Damit verwenden die durch den Runner gestarteten Build-Checks dieselbe Umgebung wie bisher.

### 7. Synchronisation absichern

`tools/sync-blobs.mjs` wird erweitert:

- Claude- und Codex-Skills erzeugen und pruefen
- `.agents/skills` in die Dogfooding-Pruefung aufnehmen
- fehlende oder zusaetzliche Skills erkennen
- Claude-Prozessdatei und `AGENTS.md` pruefen
- beide Runner-Ausgaben beziehungsweise Adapter synchron halten
- Drift im Build hart melden

### 8. Repository selbst mit beiden Agenten dogfooden

Dieses Repository erhaelt versioniert:

- gueltige `.agents/skills`
- `AGENTS.md`
- eine passende `.codex/config.toml`
- dieselbe `.claude/workflow.config.json` fuer beide Agenten

Danach werden bewusst einzelne Issues mit Claude und einzelne mit Codex abgearbeitet.

### 9. Umbenennung zu `ki-workflow-kit`

Nach erreichter Paritaet:

- Installer-Texte und Versionsausgabe umbenennen
- README und Dokumentation umstellen
- Website-Navigation und Seitentitel aktualisieren
- Board-UI umbenennen
- Changelog und Release-Prozess anpassen
- GitHub-Repository umbenennen
- alte GitHub-URL und Installationsbefehle auf Weiterleitung pruefen
- Sonar-Projekt und externe Verweise migrieren
- kompatiblen Major-Release veroeffentlichen

Die alten `.claude`-Pfade bleiben trotz Produktumbenennung zunaechst unterstuetzt und werden ausdruecklich als gemeinsame Legacy-Konfiguration dokumentiert.

## Offene Fragen

- Keine.

## Verifizierung

- Gesamte bestehende Testsuite mit `node --test`.
- Synchronitaetspruefung mit `node tools/sync-blobs.mjs --check`.
- Installer-Matrix:
  - Claude/Codex/beide
  - global/projektlokal
  - Neuinstallation/Re-Install
  - vorhandene Claude- und Codex-Konfiguration
- Strukturtests fuer alle 15 Skills in beiden Zielverzeichnissen.
- Tests fuer beliebige Claude- und Codex-Modell-IDs.
- Config-Tests fuer:
  - `workflow.config.json`
  - `workflow.config.local.json`
  - `kontext.config.json`
  - `settings.json`
  - `settings.local.json`
- Prozess-Fakes fuer Claude-Stream und Codex-JSONL.
- Lokaler Codex-Smoke-Test mit Datei-Issue-Tracker:
  - Issue nach Ready
  - Nachtlauf mit Codex
  - lokaler Commit
  - Board-Bewegung nach `In review`
  - kein Push
- Smoke-Test des Review-Modus mit Claude- und Codex-Reviewern.
- Pruefung, dass Codex `AGENTS.md` und `.agents/skills` tatsaechlich laedt.
- Pruefung der Sandbox- und Netzwerkfehlerpfade.
- Abschliessend je ein vollstaendiger Beispielprozess mit Claude Code und Codex.
