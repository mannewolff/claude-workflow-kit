#!/usr/bin/env node
/**
 * Stellwerk Installer v2.0.0
 *
 * Kopiert die zehn Skills nach ~/.claude/skills/ oder ./.claude/skills/,
 * schreibt .claude/workflow.config.json und .claude/kit/board.mjs.
 *
 * Aufruf:
 *   node install.mjs
 *   node install.mjs --version
 *   npx github:mannewolff/claude-workflow-kit  (nach Veroeffentlichung)
 *
 * Breaking Change v2.0.0: Config-Schema nutzt codeHost + issueTracker statt provider.
 * Bestehende Configs mit provider werden beim Lesen still migriert.
 */

import { createInterface } from "node:readline";
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VERSION = "2.0.0";

// --- CLAUDE-workflow.md (eingebettet fuer Single-File-Portabilitaet) ---
const CLAUDE_WORKFLOW_MD = `# CLAUDE-workflow.md — Stellwerk-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt.
Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## Die neun Schritte

| Schritt | Aktor | Was passiert | Skill |
|---------|-------|-------------|-------|
| 1. Anforderung | Mensch | Formuliert oder diktiert die Anforderung | — |
| 2. Plan | KI | Erstellt Plan, stellt zur Diskussion, implementiert nichts | \`/plan\` |
| 3. Plan zu Issues | KI | Uebertraegt Plan in GitHub-Issues (Vier-Abschnitt-Format) | \`/issues\` |
| 4. GO | Mensch | Zieht Issues nach Ready — das ist das GO | — |
| 5. Implementierung | KI | Arbeitet Ready-Issues sequenziell ab, committet lokal | \`/implement-ready\` |
| 6. Lokale Pruefung | KI + Mensch | Pflicht-Checks + manuelle UI-Verifikation | \`/local-check\` |
| 7. Code-Review | KI | Startet Opus-Reviewer in frischer Session | \`/review\` |
| 7.5. Retro | KI | KI-Retrospektive, Memory konsolidieren | \`/retro\` |
| 8. Push | Mensch | Tippt \`push main\` — Claude pusht den Batch | \`/push-main\` |
| 9. Merge | Mensch | Tippt \`merge production\` — Claude erstellt PR | \`/merge-production\` |

---

## Die drei Stop-Punkte (nie automatisiert)

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet.
2. **Push (Schritt 8):** Trigger-Phrase \`push main\`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase \`merge production\`. Claude merged nicht.

Diese drei Schritte sind die Verantwortungsschwellen. Sie bleiben menschlich und tippbar.

---

## Kanban-Board (5 Spalten)

| Spalte | Bedeutung | Wer bewegt |
|--------|-----------|-----------|
| Backlog | Idee oder Issue mit offenen Fragen | Beide |
| Ready | Freigegeben, gilt als GO | Nur Mensch |
| In progress | Aktuelle Arbeit, ein Issue zur Zeit | KI beim Start |
| In review | Lokal fertig, nicht gepusht | KI beim Abschluss |
| Done | Mensch hat getestet, Push erfolgt | Nur Mensch |

Claude geht nur bis **In review**. Done setzt der Mensch nach seinem Test.

---

## Git-Workflow (strikt bindend)

1. Claude committet lokal, pusht NICHT automatisch.
2. Mensch testet lokal (Dev-Server starten, Golden Path durchklicken).
3. Mensch tippt \`push main\` — Claude pusht auf \`mainBranch\`.
4. Mensch testet auf Testserver.
5. Mensch tippt \`merge production\` — Claude erstellt PR \`mainBranch -> productionBranch\`.
6. Mensch merget den PR.

Absolut bindend:
- Kein Force-Push auf \`mainBranch\` oder \`productionBranch\` ohne explizite Einzelanweisung.
- Hooks (Pre-Commit / Pre-Push) werden nicht mit \`--no-verify\` umgangen.
- \`productionBranch\` wird nie direkt gepusht.

---

## Config (.claude/workflow.config.json)

\`\`\`json
{
  "codeHost": "github",
  "issueTracker": "github",
  "buildChecks": ["<build-kommando>", "<test-kommando>"],
  "mutationCommand": "<mutations-test-kommando oder leer>",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" },
  "local": { "issuesDir": "issues" }
}
\`\`\`

\`codeHost\` steuert den Code-Host (github | gitlab | local).
\`issueTracker\` steuert Issues und Board (github | gitlab | local).
Bei GitHub und GitLab zeigen beide auf denselben Wert.
Bestehende Configs mit \`provider\` werden automatisch migriert.

\`buildChecks\` und \`mutationCommand\` anpassen. Alle anderen Felder haben sinnvolle Defaults.

Beispiele fuer verschiedene Stacks:

| Stack | buildChecks | mutationCommand |
|-------|------------|-----------------|
| Java/Maven | \`["mvn verify"]\` | \`"mvn org.pitest:pitest-maven:mutationCoverage"\` |
| Node/npm | \`["npm test", "npm run build"]\` | \`""\` |
| Python | \`["pytest", "python -m build"]\` | \`""\` |
| Go | \`["go test ./...", "go build ./..."]\` | \`""\` |

---

## Pflichtchecks vor Push (Schritt 6)

Alle \`buildChecks\` aus der Config laufen gruen. Rote Checks blockieren den Push mechanisch.
Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen.
Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen.

---

## Issue-Format (Vier Abschnitte)

\`\`\`markdown
## Kontext
Warum wird diese Aufgabe gemacht?

## Aufgabe
Was konkret ist zu tun?

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist?
Portabilitaets-Konvention: Wenn eine Datei als eigenstaendig portabel gedacht ist (Installer, kopierbares Script), muss hier stehen: "lauffaehig ohne weiteren Repo-Kontext".

## Abhaengigkeiten
Keine. (oder: Issue #N muss vorher fertig sein)
\`\`\`

---

## Abschlussbericht-Format

\`\`\`
### Aenderungen
- \`Datei\` — kurze Beschreibung der Wirkung

### Tests und Checks
- <Kommando> -> <Ergebnis>

### Hinweise
- <Restrisiken, offene Punkte, manuelle Folgeschritte>
\`\`\`

---

## Prioritaeten bei Zielkonflikten

1. Sicherheit
2. Korrektheit
3. Datenintegritaet
4. Accessibility
5. Wartbarkeit
6. Performance
7. Visuelle Praeferenz
8. Bequemlichkeit der Implementierung

---

## KI-Retro (alle 1-2 Wochen)

\`/retro\` startet die KI-Retrospektive. Drei Fragen:
- Wo hat die Mensch-KI-Zusammenarbeit gehakt?
- Welche Memory-Eintraege sind veraltet?
- Welche Workflow-Regel braucht eine Schaerfung?

Output: konkrete Aenderungen an Memory-Dateien und CLAUDE*.md-Dateien.
`;

// --- board.mjs (Base64-eingebettet fuer Single-File-Portabilitaet) ---
// SYNC: Vor einem Release diesen String aus kit/board.mjs neu generieren:
//   node -e "const {readFileSync}=require('fs');process.stdout.write(Buffer.from(readFileSync('kit/board.mjs','utf-8')).toString('base64'))"
const BOARD_MJS_B64 = "IyEvdXNyL2Jpbi9lbnYgbm9kZQovKioKICogYm9hcmQubWpzIOKAlCBQcm92aWRlci1hZ25vc3Rpc2NoZXIgRWluc3RpZWdzcHVua3QgZnVlciBhbGxlIEJvYXJkLU9wZXJhdGlvbmVuLgogKiBMaWVzdCAuY2xhdWRlL3dvcmtmbG93LmNvbmZpZy5qc29uLCB3YWVobHQgYW5oYW5kIGlzc3VlVHJhY2tlci9jb2RlSG9zdCBkZW4gQWRhcHRlcgogKiB1bmQgZnVlaHJ0IGRpZSBhbmdlZm9yZGVydGUgT3BlcmF0aW9uIGF1cy4KICoKICogQXVzZ2FiZTogSlNPTiBhdWYgc3Rkb3V0LiBGZWhsZXI6IE1lbGR1bmcgYXVmIHN0ZGVyciwgRXhpdC1Db2RlIDEuCiAqCiAqIE51dHp1bmc6CiAqICAgbm9kZSBib2FyZC5tanMgaXNzdWUgY3JlYXRlIC0tdGl0bGUgIi4uLiIgLS1ib2R5ICIuLi4iCiAqICAgbm9kZSBib2FyZC5tanMgaXNzdWUgZ2V0IDxpZD4KICogICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBsaXN0IFstLXN0YXR1cyA8c3RhdHVzPl0KICogICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBtb3ZlIDxpZD4gPHN0YXR1cz4KICogICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBjb21tZW50IDxpZD4gLS10ZXh0ICIuLi4iCiAqICAgbm9kZSBib2FyZC5tanMgY29kZSByZXBvLW5hbWUKICogICBub2RlIGJvYXJkLm1qcyBjb2RlIHByIC0tZnJvbSA8YnJhbmNoPiAtLXRvIDxicmFuY2g+CiAqLwoKaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jLCBleGlzdHNTeW5jLCByZWFkZGlyU3luYywgbWtkaXJTeW5jIH0gZnJvbSAibm9kZTpmcyI7CmltcG9ydCB7IHJlc29sdmUsIGpvaW4sIGRpcm5hbWUsIGJhc2VuYW1lIH0gZnJvbSAibm9kZTpwYXRoIjsKaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gIm5vZGU6dXJsIjsKaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICJub2RlOmNoaWxkX3Byb2Nlc3MiOwoKY29uc3QgX19kaXJuYW1lID0gZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpOwoKY29uc3QgVkFMSURfU1RBVFVTRVMgPSBbImJhY2tsb2ciLCAicmVhZHkiLCAiaW5fcHJvZ3Jlc3MiLCAiaW5fcmV2aWV3IiwgImRvbmUiXTsKCi8vIFN0YXR1cy1MYWJlbC1NYXBwaW5nIGZ1ZXIgR2l0TGFiIChtdXNzIG1pdCBkZW4gdm9tIEluc3RhbGxlciBhbmdlbGVndGVuIExhYmVscyB1ZWJlcmVpbnN0aW1tZW4pCmNvbnN0IEdJVExBQl9MQUJFTFMgPSB7CiAgYmFja2xvZzogICAgICJCYWNrbG9nIiwKICByZWFkeTogICAgICAgIlJlYWR5IiwKICBpbl9wcm9ncmVzczogIkluIFByb2dyZXNzIiwKICBpbl9yZXZpZXc6ICAgIkluIFJldmlldyIsCiAgZG9uZTogICAgICAgICJEb25lIiwKfTsKCmNvbnN0IEhFTFAgPSBgYm9hcmQubWpzIOKAlCBCb2FyZC1BZGFwdGVyIGZ1ZXIgZGFzIGNsYXVkZS13b3JrZmxvdy1raXQKCk51dHp1bmc6CiAgbm9kZSBib2FyZC5tanMgaXNzdWUgY3JlYXRlIC0tdGl0bGUgIi4uLiIgLS1ib2R5ICIuLi4iCiAgbm9kZSBib2FyZC5tanMgaXNzdWUgZ2V0IDxpZD4KICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBsaXN0IFstLXN0YXR1cyA8c3RhdHVzPl0KICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBtb3ZlIDxpZD4gPHN0YXR1cz4KICBub2RlIGJvYXJkLm1qcyBpc3N1ZSBjb21tZW50IDxpZD4gLS10ZXh0ICIuLi4iCiAgbm9kZSBib2FyZC5tanMgY29kZSByZXBvLW5hbWUKICBub2RlIGJvYXJkLm1qcyBjb2RlIHByIC0tZnJvbSA8YnJhbmNoPiAtLXRvIDxicmFuY2g+CgpHdWVsdGlnZSBTdGF0dXMtV2VydGU6ICR7VkFMSURfU1RBVFVTRVMuam9pbigiIHwgIil9CgpLb25maWd1cmF0aW9uOiAuY2xhdWRlL3dvcmtmbG93LmNvbmZpZy5qc29uIChpc3N1ZVRyYWNrZXIsIGNvZGVIb3N0KQpGdWVyIEdpdEh1Yi1Cb2FyZC1JbnRlZ3JhdGlvbjogZ2l0aHViLnByb2plY3ROdW1iZXIgaW4gZGVyIENvbmZpZyBzZXR6ZW4uCmA7CgovLyAtLS0gU2hlbGwtSGlsZnNmdW5rdGlvbmVuIC0tLQoKZnVuY3Rpb24gZXhlYyhjbWQpIHsKICB0cnkgewogICAgcmV0dXJuIGV4ZWNTeW5jKGNtZCwgeyBlbmNvZGluZzogInV0Zi04Iiwgc3RkaW86IFsicGlwZSIsICJwaXBlIiwgInBpcGUiXSB9KS50cmltKCk7CiAgfSBjYXRjaCAoZSkgewogICAgdGhyb3cgbmV3IEVycm9yKGUuc3RkZXJyPy50b1N0cmluZygpLnRyaW0oKSB8fCBlLm1lc3NhZ2UpOwogIH0KfQoKZnVuY3Rpb24gZXhlY0pTT04oY21kKSB7CiAgcmV0dXJuIEpTT04ucGFyc2UoZXhlYyhjbWQpKTsKfQoKLy8gLS0tIEZlaGxlcmJlaGFuZGx1bmcgLS0tCgpmdW5jdGlvbiBmYWlsKG1zZykgewogIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBGZWhsZXI6ICR7bXNnfVxuYCk7CiAgcHJvY2Vzcy5leGl0KDEpOwp9CgpmdW5jdGlvbiBvdXQoZGF0YSkgewogIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KGRhdGEsIG51bGwsIDIpICsgIlxuIik7Cn0KCi8vIC0tLSBDb25maWcgbGFkZW4gLS0tCgpmdW5jdGlvbiBsb2FkQ29uZmlnKCkgewogIGNvbnN0IGNhbmRpZGF0ZXMgPSBbCiAgICByZXNvbHZlKCIuY2xhdWRlIiwgIndvcmtmbG93LmNvbmZpZy5qc29uIiksCiAgICBqb2luKF9fZGlybmFtZSwgIi4uIiwgIi5jbGF1ZGUiLCAid29ya2Zsb3cuY29uZmlnLmpzb24iKSwKICBdOwogIGZvciAoY29uc3QgcCBvZiBjYW5kaWRhdGVzKSB7CiAgICBpZiAoZXhpc3RzU3luYyhwKSkgewogICAgICB0cnkgewogICAgICAgIGNvbnN0IHJhdyA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKHAsICJ1dGYtOCIpKTsKICAgICAgICAvLyBSdWVja3dhZXJ0c2tvbXBhdGliaWxpdGFldDogcHJvdmlkZXIgLT4gY29kZUhvc3QvaXNzdWVUcmFja2VyCiAgICAgICAgaWYgKHJhdy5wcm92aWRlciAmJiAhcmF3LmNvZGVIb3N0KSByYXcuY29kZUhvc3QgPSByYXcucHJvdmlkZXI7CiAgICAgICAgaWYgKHJhdy5wcm92aWRlciAmJiAhcmF3Lmlzc3VlVHJhY2tlcikgcmF3Lmlzc3VlVHJhY2tlciA9IHJhdy5wcm92aWRlcjsKICAgICAgICByZXR1cm4gcmF3OwogICAgICB9IGNhdGNoIHsKICAgICAgICBmYWlsKGB3b3JrZmxvdy5jb25maWcuanNvbiBrb25udGUgbmljaHQgZ2VsZXNlbiB3ZXJkZW46ICR7cH1gKTsKICAgICAgfQogICAgfQogIH0KICBmYWlsKAogICAgIktlaW5lIC5jbGF1ZGUvd29ya2Zsb3cuY29uZmlnLmpzb24gZ2VmdW5kZW4uIEJpdHRlIHp1ZXJzdCBkZW4gSW5zdGFsbGVyIGF1c2Z1ZWhyZW4uIgogICk7Cn0KCi8vIC0tLSBBcmd1bWVudC1QYXJzZXIgLS0tCgpmdW5jdGlvbiBwYXJzZUFyZ3MoYXJndikgewogIGNvbnN0IHJlc3VsdCA9IHsgXzogW10gfTsKICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHsKICAgIGNvbnN0IGEgPSBhcmd2W2ldOwogICAgaWYgKGEuc3RhcnRzV2l0aCgiLS0iKSkgewogICAgICBjb25zdCBrZXkgPSBhLnNsaWNlKDIpOwogICAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07CiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuc3RhcnRzV2l0aCgiLS0iKSkgewogICAgICAgIHJlc3VsdFtrZXldID0gbmV4dDsKICAgICAgICBpKys7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgcmVzdWx0W2tleV0gPSB0cnVlOwogICAgICB9CiAgICB9IGVsc2UgewogICAgICByZXN1bHQuXy5wdXNoKGEpOwogICAgfQogIH0KICByZXR1cm4gcmVzdWx0Owp9CgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KLy8gR2l0SHViLUFkYXB0ZXIKLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CgpjbGFzcyBHaXRIdWJJc3N1ZVRyYWNrZXIgewogIGNvbnN0cnVjdG9yKGNvbmZpZykgewogICAgdGhpcy5fY2ZnID0gY29uZmlnOwogICAgdGhpcy5fcmVwb05hbWUgPSBudWxsOwogICAgdGhpcy5fcHJvamVjdElkID0gbnVsbDsKICAgIHRoaXMuX3N0YXR1c0ZpZWxkID0gbnVsbDsgLy8geyBpZCwgb3B0aW9uczogeyBbc3RhdHVzXTogb3B0aW9uSWQgfSB9CiAgfQoKICBfcmVwbygpIHsKICAgIGlmICghdGhpcy5fcmVwb05hbWUpIHsKICAgICAgdGhpcy5fcmVwb05hbWUgPSBleGVjKCJnaCByZXBvIHZpZXcgLS1qc29uIG5hbWVXaXRoT3duZXIgLXEgLm5hbWVXaXRoT3duZXIiKTsKICAgIH0KICAgIHJldHVybiB0aGlzLl9yZXBvTmFtZTsKICB9CgogIF9vd25lcigpIHsKICAgIHJldHVybiB0aGlzLl9yZXBvKCkuc3BsaXQoIi8iKVswXTsKICB9CgogIF9wcm9qZWN0TnVtYmVyKCkgewogICAgY29uc3QgbiA9IHRoaXMuX2NmZy5naXRodWI/LnByb2plY3ROdW1iZXI7CiAgICBpZiAoIW4pIGZhaWwoCiAgICAgICJnaXRodWIucHJvamVjdE51bWJlciBmZWhsdCBpbiB3b3JrZmxvdy5jb25maWcuanNvbi4gIiArCiAgICAgICJCaXR0ZSBlcmdhbnplbjogJ1wiZ2l0aHViXCI6IHsgXCJwcm9qZWN0TnVtYmVyXCI6IDxOPiB9JyIKICAgICk7CiAgICByZXR1cm4gbjsKICB9CgogIF9lbnN1cmVQcm9qZWN0TWV0YSgpIHsKICAgIGlmICh0aGlzLl9wcm9qZWN0SWQgJiYgdGhpcy5fc3RhdHVzRmllbGQpIHJldHVybjsKCiAgICBjb25zdCBvd25lciA9IHRoaXMuX293bmVyKCk7CiAgICBjb25zdCBudW0gPSB0aGlzLl9wcm9qZWN0TnVtYmVyKCk7CgogICAgLy8gUHJvamVjdC1JRAogICAgY29uc3QgcHJvamVjdExpc3QgPSBleGVjSlNPTihgZ2ggcHJvamVjdCBsaXN0IC0tb3duZXIgJHtvd25lcn0gLS1mb3JtYXQganNvbmApOwogICAgY29uc3QgcHJvamVjdCA9IChwcm9qZWN0TGlzdC5wcm9qZWN0cyB8fCBbXSkuZmluZCgocCkgPT4gcC5udW1iZXIgPT09IG51bSk7CiAgICBpZiAoIXByb2plY3QpIGZhaWwoYEdpdEh1YiBQcm9qZWN0ICMke251bX0gbmljaHQgZ2VmdW5kZW4gZnVlciBPd25lciAnJHtvd25lcn0nYCk7CiAgICB0aGlzLl9wcm9qZWN0SWQgPSBwcm9qZWN0LmlkOwoKICAgIC8vIFN0YXR1cy1GaWVsZCB1bmQgT3B0aW9uZW4KICAgIGNvbnN0IGZpZWxkcyA9IGV4ZWNKU09OKGBnaCBwcm9qZWN0IGZpZWxkLWxpc3QgJHtudW19IC0tb3duZXIgJHtvd25lcn0gLS1mb3JtYXQganNvbmApOwogICAgY29uc3Qgc3RhdHVzRmllbGQgPSAoZmllbGRzLmZpZWxkcyB8fCBbXSkuZmluZCgoZikgPT4gZi5uYW1lID09PSAiU3RhdHVzIik7CiAgICBpZiAoIXN0YXR1c0ZpZWxkKSBmYWlsKGBLZWluICdTdGF0dXMnLUZlbGQgaW4gR2l0SHViIFByb2plY3QgIyR7bnVtfSBnZWZ1bmRlbmApOwoKICAgIGNvbnN0IG9wdGlvbk1hcCA9IHt9OwogICAgZm9yIChjb25zdCBvcHQgb2Ygc3RhdHVzRmllbGQub3B0aW9ucyB8fCBbXSkgewogICAgICAvLyBOb3JtYWxpc2llcmUgZGVuIE9wdGlvbi1OYW1lbiBhdWYgZGVuIFN0YXR1cy1FbnVtCiAgICAgIGNvbnN0IGtleSA9IE9iamVjdC5rZXlzKEdJVEhVQl9TVEFUVVNfTkFNRVMpLmZpbmQoCiAgICAgICAgKGspID0+IEdJVEhVQl9TVEFUVVNfTkFNRVNba10udG9Mb3dlckNhc2UoKSA9PT0gb3B0Lm5hbWUudG9Mb3dlckNhc2UoKQogICAgICApOwogICAgICBpZiAoa2V5KSBvcHRpb25NYXBba2V5XSA9IG9wdC5pZDsKICAgIH0KICAgIHRoaXMuX3N0YXR1c0ZpZWxkID0geyBpZDogc3RhdHVzRmllbGQuaWQsIG9wdGlvbnM6IG9wdGlvbk1hcCB9OwogIH0KCiAgX2dldFByb2plY3RJdGVtSWQoaXNzdWVOdW1iZXIpIHsKICAgIGNvbnN0IG93bmVyID0gdGhpcy5fb3duZXIoKTsKICAgIGNvbnN0IG51bSA9IHRoaXMuX3Byb2plY3ROdW1iZXIoKTsKICAgIGNvbnN0IGl0ZW1zID0gZXhlY0pTT04oYGdoIHByb2plY3QgaXRlbS1saXN0ICR7bnVtfSAtLW93bmVyICR7b3duZXJ9IC0tZm9ybWF0IGpzb25gKTsKICAgIGNvbnN0IGl0ZW0gPSAoaXRlbXMuaXRlbXMgfHwgW10pLmZpbmQoCiAgICAgIChpKSA9PiBpLmNvbnRlbnQ/Lm51bWJlciA9PT0gTnVtYmVyKGlzc3VlTnVtYmVyKQogICAgKTsKICAgIGlmICghaXRlbSkgZmFpbChgSXNzdWUgIyR7aXNzdWVOdW1iZXJ9IG5pY2h0IGltIFByb2plY3QgQm9hcmQgIyR7bnVtfSBnZWZ1bmRlbmApOwogICAgcmV0dXJuIGl0ZW0uaWQ7CiAgfQoKICBhc3luYyBjcmVhdGVJc3N1ZSh7IHRpdGxlLCBib2R5IH0pIHsKICAgIGNvbnN0IHJlcG8gPSB0aGlzLl9yZXBvKCk7CiAgICBjb25zdCB1cmwgPSBleGVjKAogICAgICBgZ2ggaXNzdWUgY3JlYXRlIC0tcmVwbyAke3JlcG99IC0tdGl0bGUgJHtzaGVsbFF1b3RlKHRpdGxlKX0gLS1ib2R5ICR7c2hlbGxRdW90ZShib2R5IHx8ICIiKX1gCiAgICApOwogICAgY29uc3QgaWQgPSBTdHJpbmcodXJsLnNwbGl0KCIvIikucG9wKCkpOwoKICAgIC8vIEFucyBQcm9qZWN0IEJvYXJkIGhhZW5nZW4sIGZhbGxzIGtvbmZpZ3VyaWVydAogICAgaWYgKHRoaXMuX2NmZy5naXRodWI/LnByb2plY3ROdW1iZXIpIHsKICAgICAgdHJ5IHsKICAgICAgICBjb25zdCBvd25lciA9IHRoaXMuX293bmVyKCk7CiAgICAgICAgY29uc3QgbnVtID0gdGhpcy5fcHJvamVjdE51bWJlcigpOwogICAgICAgIGV4ZWMoYGdoIHByb2plY3QgaXRlbS1hZGQgJHtudW19IC0tb3duZXIgJHtvd25lcn0gLS11cmwgJHt1cmx9YCk7CiAgICAgICAgLy8gU3RhdHVzIGF1ZiBiYWNrbG9nIHNldHplbgogICAgICAgIGF3YWl0IHRoaXMubW92ZUlzc3VlKGlkLCAiYmFja2xvZyIpOwogICAgICB9IGNhdGNoIChlKSB7CiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYEhpbndlaXM6IEJvYXJkLVp1b3JkbnVuZyBmZWhsZ2VzY2hsYWdlbjogJHtlLm1lc3NhZ2V9XG5gKTsKICAgICAgfQogICAgfQogICAgcmV0dXJuIHsgaWQsIHVybCB9OwogIH0KCiAgYXN5bmMgZ2V0SXNzdWUoaWQpIHsKICAgIGNvbnN0IHJlcG8gPSB0aGlzLl9yZXBvKCk7CiAgICBjb25zdCBkYXRhID0gZXhlY0pTT04oCiAgICAgIGBnaCBpc3N1ZSB2aWV3ICR7aWR9IC0tcmVwbyAke3JlcG99IC0tanNvbiBudW1iZXIsdGl0bGUsYm9keSxzdGF0ZWAKICAgICk7CiAgICByZXR1cm4gewogICAgICBpZDogU3RyaW5nKGRhdGEubnVtYmVyKSwKICAgICAgdGl0bGU6IGRhdGEudGl0bGUsCiAgICAgIGJvZHk6IGRhdGEuYm9keSwKICAgICAgc3RhdHVzOiBudWxsLCAvLyBCb2FyZC1TdGF0dXMgbmljaHQgaW0gSXNzdWUtT2JqZWt0LCBlcmZvcmRlcnQgUHJvamVjdC1BYmZyYWdlCiAgICB9OwogIH0KCiAgYXN5bmMgbGlzdElzc3VlcyhzdGF0dXMpIHsKICAgIGNvbnN0IHJlcG8gPSB0aGlzLl9yZXBvKCk7CgogICAgaWYgKCFzdGF0dXMpIHsKICAgICAgY29uc3QgaXRlbXMgPSBleGVjSlNPTigKICAgICAgICBgZ2ggaXNzdWUgbGlzdCAtLXJlcG8gJHtyZXBvfSAtLXN0YXRlIG9wZW4gLS1qc29uIG51bWJlcix0aXRsZSxib2R5YAogICAgICApOwogICAgICByZXR1cm4gaXRlbXMubWFwKChpKSA9PiAoeyBpZDogU3RyaW5nKGkubnVtYmVyKSwgdGl0bGU6IGkudGl0bGUsIGJvZHk6IGkuYm9keSwgc3RhdHVzOiBudWxsIH0pKTsKICAgIH0KCiAgICAvLyBGaWx0ZXJ1bmcgbmFjaCBCb2FyZC1TdGF0dXMgdmlhIFByb2plY3QKICAgIGlmICghdGhpcy5fY2ZnLmdpdGh1Yj8ucHJvamVjdE51bWJlcikgewogICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZSgKICAgICAgICAiSGlud2VpczogT2huZSBnaXRodWIucHJvamVjdE51bWJlciBrZWluIEJvYXJkLVN0YXR1cy1GaWx0ZXIgbW9lZ2xpY2guIExpc3RlIGFsbGUgb2ZmZW5lbiBJc3N1ZXMuXG4iCiAgICAgICk7CiAgICAgIHJldHVybiB0aGlzLmxpc3RJc3N1ZXModW5kZWZpbmVkKTsKICAgIH0KCiAgICB0aGlzLl9lbnN1cmVQcm9qZWN0TWV0YSgpOwogICAgY29uc3Qgb3duZXIgPSB0aGlzLl9vd25lcigpOwogICAgY29uc3QgbnVtID0gdGhpcy5fcHJvamVjdE51bWJlcigpOwogICAgY29uc3QgaXRlbXMgPSBleGVjSlNPTihgZ2ggcHJvamVjdCBpdGVtLWxpc3QgJHtudW19IC0tb3duZXIgJHtvd25lcn0gLS1mb3JtYXQganNvbmApOwoKICAgIGNvbnN0IG9wdGlvbklkID0gdGhpcy5fc3RhdHVzRmllbGQub3B0aW9uc1tzdGF0dXNdOwogICAgaWYgKCFvcHRpb25JZCkgZmFpbChgU3RhdHVzICcke3N0YXR1c30nIGhhdCBrZWluZSBFbnRzcHJlY2h1bmcgaW0gR2l0SHViIFByb2plY3RgKTsKCiAgICByZXR1cm4gKGl0ZW1zLml0ZW1zIHx8IFtdKQogICAgICAuZmlsdGVyKChpKSA9PiBpLnN0YXR1cyA9PT0gZ2l0aHViU3RhdHVzTmFtZShzdGF0dXMpKQogICAgICAubWFwKChpKSA9PiAoewogICAgICAgIGlkOiBTdHJpbmcoaS5jb250ZW50Py5udW1iZXIpLAogICAgICAgIHRpdGxlOiBpLmNvbnRlbnQ/LnRpdGxlLAogICAgICAgIGJvZHk6IG51bGwsCiAgICAgICAgc3RhdHVzLAogICAgICB9KSkKICAgICAgLnNvcnQoKGEsIGIpID0+IE51bWJlcihhLmlkKSAtIE51bWJlcihiLmlkKSk7CiAgfQoKICBhc3luYyBtb3ZlSXNzdWUoaWQsIHRvKSB7CiAgICB0aGlzLl9lbnN1cmVQcm9qZWN0TWV0YSgpOwogICAgY29uc3QgaXRlbUlkID0gdGhpcy5fZ2V0UHJvamVjdEl0ZW1JZChpZCk7CiAgICBjb25zdCBvcHRpb25JZCA9IHRoaXMuX3N0YXR1c0ZpZWxkLm9wdGlvbnNbdG9dOwogICAgaWYgKCFvcHRpb25JZCkgZmFpbChgU3RhdHVzICcke3RvfScgaGF0IGtlaW5lIEVudHNwcmVjaHVuZyBpbSBHaXRIdWIgUHJvamVjdGApOwoKICAgIGV4ZWMoCiAgICAgIGBnaCBwcm9qZWN0IGl0ZW0tZWRpdCAtLWlkICR7aXRlbUlkfSAtLXByb2plY3QtaWQgJHt0aGlzLl9wcm9qZWN0SWR9IGAgKwogICAgICBgLS1maWVsZC1pZCAke3RoaXMuX3N0YXR1c0ZpZWxkLmlkfSAtLXNpbmdsZS1zZWxlY3Qtb3B0aW9uLWlkICR7b3B0aW9uSWR9YAogICAgKTsKICB9CgogIGFzeW5jIGNvbW1lbnRJc3N1ZShpZCwgdGV4dCkgewogICAgY29uc3QgcmVwbyA9IHRoaXMuX3JlcG8oKTsKICAgIGV4ZWMoYGdoIGlzc3VlIGNvbW1lbnQgJHtpZH0gLS1yZXBvICR7cmVwb30gLS1ib2R5ICR7c2hlbGxRdW90ZSh0ZXh0KX1gKTsKICB9Cn0KCi8vIE1hcHBpbmcgdm9uIGludGVybmVtIFN0YXR1cyBhdWYgR2l0SHViLVNwYWx0ZW5uYW1lbiAoYW5wYXNzYmFyIHBlciBDb25maWcpCmNvbnN0IEdJVEhVQl9TVEFUVVNfTkFNRVMgPSB7CiAgYmFja2xvZzogICAgICJCYWNrbG9nIiwKICByZWFkeTogICAgICAgIlJlYWR5IiwKICBpbl9wcm9ncmVzczogIkluIHByb2dyZXNzIiwKICBpbl9yZXZpZXc6ICAgIkluIHJldmlldyIsCiAgZG9uZTogICAgICAgICJEb25lIiwKfTsKCmZ1bmN0aW9uIGdpdGh1YlN0YXR1c05hbWUoc3RhdHVzKSB7CiAgcmV0dXJuIEdJVEhVQl9TVEFUVVNfTkFNRVNbc3RhdHVzXSB8fCBzdGF0dXM7Cn0KCmNsYXNzIEdpdEh1YkNvZGVIb3N0IHsKICBjb25zdHJ1Y3Rvcihjb25maWcpIHsgdGhpcy5fY2ZnID0gY29uZmlnOyB9CgogIGFzeW5jIGdldFJlcG9OYW1lKCkgewogICAgdHJ5IHsKICAgICAgcmV0dXJuIGV4ZWMoImdoIHJlcG8gdmlldyAtLWpzb24gbmFtZVdpdGhPd25lciAtcSAubmFtZVdpdGhPd25lciIpOwogICAgfSBjYXRjaCB7CiAgICAgIHJldHVybiBleGVjKCJnaXQgcmVtb3RlIGdldC11cmwgb3JpZ2luIDI+L2Rldi9udWxsIHx8IGJhc2VuYW1lICQocHdkKSIpOwogICAgfQogIH0KCiAgc3VwcG9ydHNQdWxsUmVxdWVzdHMoKSB7IHJldHVybiB0cnVlOyB9CgogIGFzeW5jIGNyZWF0ZVB1bGxSZXF1ZXN0KHsgZnJvbSwgdG8sIHRpdGxlIH0pIHsKICAgIGNvbnN0IHQgPSB0aXRsZSB8fCBgJHtmcm9tfSDihpIgJHt0b31gOwogICAgY29uc3QgdXJsID0gZXhlYygKICAgICAgYGdoIHByIGNyZWF0ZSAtLWJhc2UgJHt0b30gLS1oZWFkICR7ZnJvbX0gLS10aXRsZSAke3NoZWxsUXVvdGUodCl9IC0tYm9keSAiImAKICAgICk7CiAgICByZXR1cm4geyB1cmwgfTsKICB9Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQovLyBHaXRMYWItQWRhcHRlcgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KCmNsYXNzIEdpdExhYklzc3VlVHJhY2tlciB7CiAgYXN5bmMgY3JlYXRlSXNzdWUoeyB0aXRsZSwgYm9keSB9KSB7CiAgICBjb25zdCBvdXRwdXQgPSBleGVjKAogICAgICBgZ2xhYiBpc3N1ZSBjcmVhdGUgLS10aXRsZSAke3NoZWxsUXVvdGUodGl0bGUpfSAtLWRlc2NyaXB0aW9uICR7c2hlbGxRdW90ZShib2R5IHx8ICIiKX1gCiAgICApOwogICAgLy8gZ2xhYiBnaWJ0IGRpZSBJc3N1ZS1VUkwgYXVzLCB6LkIuIGh0dHBzOi8vZ2l0bGFiLmNvbS9vd25lci9yZXBvLy0vaXNzdWVzLzQyCiAgICBjb25zdCBtYXRjaCA9IG91dHB1dC5tYXRjaCgvXC9pc3N1ZXNcLyhcZCspLyk7CiAgICBpZiAoIW1hdGNoKSBmYWlsKGBLb25udGUgSXNzdWUtSUQgYXVzIGdsYWItQXVzZ2FiZSBuaWNodCBsZXNlbjogJHtvdXRwdXR9YCk7CiAgICBjb25zdCBpZCA9IG1hdGNoWzFdOwogICAgLy8gTGFiZWwgJ0JhY2tsb2cnIHNldHplbgogICAgdHJ5IHsKICAgICAgZXhlYyhgZ2xhYiBpc3N1ZSBlZGl0ICR7aWR9IC0tbGFiZWwgIkJhY2tsb2ciYCk7CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBIaW53ZWlzOiBCYWNrbG9nLUxhYmVsIGtvbm50ZSBuaWNodCBnZXNldHp0IHdlcmRlbjogJHtlLm1lc3NhZ2V9XG5gKTsKICAgIH0KICAgIHJldHVybiB7IGlkLCB1cmw6IG91dHB1dC50cmltKCkgfTsKICB9CgogIGFzeW5jIGdldElzc3VlKGlkKSB7CiAgICBjb25zdCBkYXRhID0gZXhlY0pTT04oYGdsYWIgaXNzdWUgdmlldyAke2lkfSAtLW91dHB1dCBqc29uYCk7CiAgICBjb25zdCBsYWJlbE5hbWVzID0gKGRhdGEubGFiZWxzIHx8IFtdKS5tYXAoKGwpID0+IGwubmFtZSB8fCBsKTsKICAgIGNvbnN0IHN0YXR1cyA9IGxhYmVsVG9TdGF0dXMobGFiZWxOYW1lcykgfHwgbnVsbDsKICAgIHJldHVybiB7CiAgICAgIGlkOiBTdHJpbmcoZGF0YS5paWQgfHwgZGF0YS5pZCksCiAgICAgIHRpdGxlOiBkYXRhLnRpdGxlLAogICAgICBib2R5OiBkYXRhLmRlc2NyaXB0aW9uLAogICAgICBzdGF0dXMsCiAgICB9OwogIH0KCiAgYXN5bmMgbGlzdElzc3VlcyhzdGF0dXMpIHsKICAgIGxldCBjbWQgPSAiZ2xhYiBpc3N1ZSBsaXN0IC0tc3RhdGUgb3BlbmVkIC0tb3V0cHV0IGpzb24iOwogICAgaWYgKHN0YXR1cykgewogICAgICBjb25zdCBsYWJlbCA9IEdJVExBQl9MQUJFTFNbc3RhdHVzXTsKICAgICAgaWYgKCFsYWJlbCkgZmFpbChgU3RhdHVzICcke3N0YXR1c30nIGhhdCBrZWluIEdpdExhYi1MYWJlbC1NYXBwaW5nYCk7CiAgICAgIGNtZCArPSBgIC0tbGFiZWwgJHtzaGVsbFF1b3RlKGxhYmVsKX1gOwogICAgfQogICAgY29uc3QgaXRlbXMgPSBleGVjSlNPTihjbWQpOwogICAgcmV0dXJuIChBcnJheS5pc0FycmF5KGl0ZW1zKSA/IGl0ZW1zIDogW10pCiAgICAgIC5tYXAoKGkpID0+IHsKICAgICAgICBjb25zdCBsYWJlbE5hbWVzID0gKGkubGFiZWxzIHx8IFtdKS5tYXAoKGwpID0+IGwubmFtZSB8fCBsKTsKICAgICAgICByZXR1cm4gewogICAgICAgICAgaWQ6IFN0cmluZyhpLmlpZCksCiAgICAgICAgICB0aXRsZTogaS50aXRsZSwKICAgICAgICAgIGJvZHk6IGkuZGVzY3JpcHRpb24sCiAgICAgICAgICBzdGF0dXM6IGxhYmVsVG9TdGF0dXMobGFiZWxOYW1lcykgfHwgbnVsbCwKICAgICAgICB9OwogICAgICB9KQogICAgICAuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEuaWQpIC0gTnVtYmVyKGIuaWQpKTsKICB9CgogIGFzeW5jIG1vdmVJc3N1ZShpZCwgdG8pIHsKICAgIGNvbnN0IGxhYmVsID0gR0lUTEFCX0xBQkVMU1t0b107CiAgICBpZiAoIWxhYmVsKSBmYWlsKGBTdGF0dXMgJyR7dG99JyBoYXQga2VpbiBHaXRMYWItTGFiZWwtTWFwcGluZ2ApOwogICAgLy8gQWxsZSBTdGF0dXMtTGFiZWxzIGVudGZlcm5lbiwgWmllbC1MYWJlbCBzZXR6ZW4KICAgIGNvbnN0IHVubGFiZWxBcmdzID0gT2JqZWN0LnZhbHVlcyhHSVRMQUJfTEFCRUxTKQogICAgICAubWFwKChsKSA9PiBgLS11bmxhYmVsICR7c2hlbGxRdW90ZShsKX1gKQogICAgICAuam9pbigiICIpOwogICAgZXhlYyhgZ2xhYiBpc3N1ZSBlZGl0ICR7aWR9ICR7dW5sYWJlbEFyZ3N9IC0tbGFiZWwgJHtzaGVsbFF1b3RlKGxhYmVsKX1gKTsKICB9CgogIGFzeW5jIGNvbW1lbnRJc3N1ZShpZCwgdGV4dCkgewogICAgZXhlYyhgZ2xhYiBpc3N1ZSBub3RlIGNyZWF0ZSAke2lkfSAtLW1lc3NhZ2UgJHtzaGVsbFF1b3RlKHRleHQpfWApOwogIH0KfQoKY2xhc3MgR2l0TGFiQ29kZUhvc3QgewogIGFzeW5jIGdldFJlcG9OYW1lKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgdXJsID0gZXhlYygiZ2l0IHJlbW90ZSBnZXQtdXJsIG9yaWdpbiIpOwogICAgICByZXR1cm4gdXJsLnJlcGxhY2UoL1wuZ2l0JC8sICIiKS5zcGxpdCgiLyIpLnNsaWNlKC0yKS5qb2luKCIvIik7CiAgICB9IGNhdGNoIHsKICAgICAgcmV0dXJuIGV4ZWMoImJhc2VuYW1lICQocHdkKSIpOwogICAgfQogIH0KCiAgc3VwcG9ydHNQdWxsUmVxdWVzdHMoKSB7IHJldHVybiB0cnVlOyB9CgogIGFzeW5jIGNyZWF0ZVB1bGxSZXF1ZXN0KHsgZnJvbSwgdG8sIHRpdGxlIH0pIHsKICAgIGNvbnN0IHQgPSB0aXRsZSB8fCBgJHtmcm9tfSAtPiAke3RvfWA7CiAgICBjb25zdCB1cmwgPSBleGVjKAogICAgICBgZ2xhYiBtciBjcmVhdGUgLS1zb3VyY2UtYnJhbmNoICR7ZnJvbX0gLS10YXJnZXQtYnJhbmNoICR7dG99IC0tdGl0bGUgJHtzaGVsbFF1b3RlKHQpfSAtLWRlc2NyaXB0aW9uICIiIC0teWVzYAogICAgKTsKICAgIC8vIGdsYWIgZ2lidCBkaWUgTVItVVJMIGF1cwogICAgY29uc3QgbWF0Y2ggPSB1cmwubWF0Y2goL2h0dHBzPzpcL1wvXFMrLyk7CiAgICByZXR1cm4geyB1cmw6IG1hdGNoID8gbWF0Y2hbMF0gOiB1cmwudHJpbSgpIH07CiAgfQp9CgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KLy8gTG9jYWwtQWRhcHRlcgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KCi8vIE1pbmltYWxlciBZQU1MLUZyb250bWF0dGVyLVBhcnNlciBmdWVyIGRpZSBJc3N1ZS1EYXRlaWVuIChrZWluIGV4dGVybmVzIE1vZHVsKQpmdW5jdGlvbiBwYXJzZUZyb250bWF0dGVyKGNvbnRlbnQpIHsKICBjb25zdCBtYXRjaCA9IGNvbnRlbnQubWF0Y2goL14tLS1cbihbXHNcU10qPylcbi0tLVxuPyhbXHNcU10qKSQvKTsKICBpZiAoIW1hdGNoKSByZXR1cm4geyBtZXRhOiB7fSwgYm9keTogY29udGVudCB9OwogIGNvbnN0IG1ldGEgPSB7fTsKICBmb3IgKGNvbnN0IGxpbmUgb2YgbWF0Y2hbMV0uc3BsaXQoIlxuIikpIHsKICAgIGNvbnN0IG0gPSBsaW5lLm1hdGNoKC9eKFx3Kyk6XHMqKC4qKSQvKTsKICAgIGlmIChtKSB7CiAgICAgIGxldCB2YWwgPSBtWzJdLnRyaW0oKS5yZXBsYWNlKC9eWyInXXxbIiddJC9nLCAiIik7CiAgICAgIG1ldGFbbVsxXV0gPSB2YWw7CiAgICB9CiAgfQogIHJldHVybiB7IG1ldGEsIGJvZHk6IG1hdGNoWzJdIH07Cn0KCmZ1bmN0aW9uIHNlcmlhbGl6ZUZyb250bWF0dGVyKG1ldGEsIGJvZHkpIHsKICBjb25zdCBsaW5lcyA9IE9iamVjdC5lbnRyaWVzKG1ldGEpLm1hcCgoW2ssIHZdKSA9PiBgJHtrfTogJHt2fWApOwogIHJldHVybiBgLS0tXG4ke2xpbmVzLmpvaW4oIlxuIil9XG4tLS1cbiR7Ym9keX1gOwp9CgpmdW5jdGlvbiBpc3N1ZXNEaXIoY29uZmlnKSB7CiAgcmV0dXJuIHJlc29sdmUoY29uZmlnLmxvY2FsPy5pc3N1ZXNEaXIgfHwgImlzc3VlcyIpOwp9CgpmdW5jdGlvbiBwYWRJZChuKSB7CiAgcmV0dXJuIFN0cmluZyhuKS5wYWRTdGFydCg0LCAiMCIpOwp9CgpjbGFzcyBMb2NhbElzc3VlVHJhY2tlciB7CiAgY29uc3RydWN0b3IoY29uZmlnKSB7IHRoaXMuX2NmZyA9IGNvbmZpZzsgfQoKICBfZGlyKCkgewogICAgcmV0dXJuIGlzc3Vlc0Rpcih0aGlzLl9jZmcpOwogIH0KCiAgX2FsbEZpbGVzKCkgewogICAgY29uc3QgZGlyID0gdGhpcy5fZGlyKCk7CiAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkgcmV0dXJuIFtdOwogICAgcmV0dXJuIHJlYWRkaXJTeW5jKGRpcikKICAgICAgLmZpbHRlcigoZikgPT4gZi5lbmRzV2l0aCgiLm1kIikpCiAgICAgIC5zb3J0KCk7IC8vIGF1ZnN0ZWlnZW5kIG5hY2ggRGF0ZWluYW1lID0gYXVmc3RlaWdlbmQgbmFjaCBpZAogIH0KCiAgX2ZpbGVQYXRoKGlkKSB7CiAgICByZXR1cm4gam9pbih0aGlzLl9kaXIoKSwgYCR7cGFkSWQoaWQpfS5tZGApOwogIH0KCiAgX3JlYWQoaWQpIHsKICAgIGNvbnN0IHAgPSB0aGlzLl9maWxlUGF0aChpZCk7CiAgICBpZiAoIWV4aXN0c1N5bmMocCkpIGZhaWwoYElzc3VlICR7aWR9IG5pY2h0IGdlZnVuZGVuOiAke3B9YCk7CiAgICBjb25zdCByYXcgPSByZWFkRmlsZVN5bmMocCwgInV0Zi04Iik7CiAgICBjb25zdCB7IG1ldGEsIGJvZHkgfSA9IHBhcnNlRnJvbnRtYXR0ZXIocmF3KTsKICAgIHJldHVybiB7IGlkOiBtZXRhLmlkIHx8IHBhZElkKGlkKSwgdGl0bGU6IG1ldGEudGl0bGUgfHwgIiIsIHN0YXR1czogbWV0YS5zdGF0dXMgfHwgImJhY2tsb2ciLCBjcmVhdGVkOiBtZXRhLmNyZWF0ZWQgfHwgIiIsIGJvZHkgfTsKICB9CgogIF9uZXh0SWQoKSB7CiAgICBjb25zdCBmaWxlcyA9IHRoaXMuX2FsbEZpbGVzKCk7CiAgICBpZiAoZmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gMTsKICAgIGNvbnN0IG51bXMgPSBmaWxlcy5tYXAoKGYpID0+IHBhcnNlSW50KGYsIDEwKSkuZmlsdGVyKChuKSA9PiAhaXNOYU4obikpOwogICAgcmV0dXJuIG51bXMubGVuZ3RoID4gMCA/IE1hdGgubWF4KC4uLm51bXMpICsgMSA6IDE7CiAgfQoKICBhc3luYyBjcmVhdGVJc3N1ZSh7IHRpdGxlLCBib2R5IH0pIHsKICAgIGNvbnN0IGRpciA9IHRoaXMuX2RpcigpOwogICAgbWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7CiAgICBjb25zdCBuID0gdGhpcy5fbmV4dElkKCk7CiAgICBjb25zdCBpZCA9IHBhZElkKG4pOwogICAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApOwogICAgY29uc3QgY29udGVudCA9IHNlcmlhbGl6ZUZyb250bWF0dGVyKAogICAgICB7IGlkOiBgIiR7aWR9ImAsIHN0YXR1czogImJhY2tsb2ciLCB0aXRsZSwgY3JlYXRlZDogdG9kYXkgfSwKICAgICAgYm9keSB8fCAiXG4jIyBLb250ZXh0XG5cbiMjIEF1ZmdhYmVcblxuIyMgQWt6ZXB0YW56a3JpdGVyaXVtXG5cbiMjIEFiaGFlbmdpZ2tlaXRlblxuIgogICAgKTsKICAgIHdyaXRlRmlsZVN5bmModGhpcy5fZmlsZVBhdGgobiksIGNvbnRlbnQsICJ1dGYtOCIpOwogICAgcmV0dXJuIHsgaWQsIHBhdGg6IHRoaXMuX2ZpbGVQYXRoKG4pIH07CiAgfQoKICBhc3luYyBnZXRJc3N1ZShpZCkgewogICAgcmV0dXJuIHRoaXMuX3JlYWQoaWQpOwogIH0KCiAgYXN5bmMgbGlzdElzc3VlcyhzdGF0dXMpIHsKICAgIHJldHVybiB0aGlzLl9hbGxGaWxlcygpCiAgICAgIC5tYXAoKGYpID0+IHsKICAgICAgICBjb25zdCByYXcgPSByZWFkRmlsZVN5bmMoam9pbih0aGlzLl9kaXIoKSwgZiksICJ1dGYtOCIpOwogICAgICAgIGNvbnN0IHsgbWV0YSwgYm9keSB9ID0gcGFyc2VGcm9udG1hdHRlcihyYXcpOwogICAgICAgIHJldHVybiB7IGlkOiBtZXRhLmlkIHx8IGJhc2VuYW1lKGYsICIubWQiKSwgdGl0bGU6IG1ldGEudGl0bGUgfHwgIiIsIHN0YXR1czogbWV0YS5zdGF0dXMgfHwgImJhY2tsb2ciLCBib2R5IH07CiAgICAgIH0pCiAgICAgIC5maWx0ZXIoKGkpID0+ICFzdGF0dXMgfHwgaS5zdGF0dXMgPT09IHN0YXR1cyk7CiAgfQoKICBhc3luYyBtb3ZlSXNzdWUoaWQsIHRvKSB7CiAgICBjb25zdCBwID0gdGhpcy5fZmlsZVBhdGgoaWQpOwogICAgaWYgKCFleGlzdHNTeW5jKHApKSBmYWlsKGBJc3N1ZSAke2lkfSBuaWNodCBnZWZ1bmRlbjogJHtwfWApOwogICAgY29uc3QgcmF3ID0gcmVhZEZpbGVTeW5jKHAsICJ1dGYtOCIpOwogICAgY29uc3QgeyBtZXRhLCBib2R5IH0gPSBwYXJzZUZyb250bWF0dGVyKHJhdyk7CiAgICBtZXRhLnN0YXR1cyA9IHRvOwogICAgd3JpdGVGaWxlU3luYyhwLCBzZXJpYWxpemVGcm9udG1hdHRlcihtZXRhLCBib2R5KSwgInV0Zi04Iik7CiAgfQoKICBhc3luYyBjb21tZW50SXNzdWUoaWQsIHRleHQpIHsKICAgIGNvbnN0IHAgPSB0aGlzLl9maWxlUGF0aChpZCk7CiAgICBpZiAoIWV4aXN0c1N5bmMocCkpIGZhaWwoYElzc3VlICR7aWR9IG5pY2h0IGdlZnVuZGVuOiAke3B9YCk7CiAgICBjb25zdCByYXcgPSByZWFkRmlsZVN5bmMocCwgInV0Zi04Iik7CiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsICIgIikuc2xpY2UoMCwgMTYpOwogICAgY29uc3QgY29tbWVudCA9IGBcblxuLS0tXG4qKktvbW1lbnRhcioqICgke3RpbWVzdGFtcH0pXG5cbiR7dGV4dH1gOwogICAgd3JpdGVGaWxlU3luYyhwLCByYXcgKyBjb21tZW50LCAidXRmLTgiKTsKICB9Cn0KCmNsYXNzIExvY2FsQ29kZUhvc3QgewogIGFzeW5jIGdldFJlcG9OYW1lKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgdXJsID0gZXhlYygiZ2l0IHJlbW90ZSBnZXQtdXJsIG9yaWdpbiAyPi9kZXYvbnVsbCIpOwogICAgICByZXR1cm4gdXJsLnJlcGxhY2UoL1wuZ2l0JC8sICIiKS5zcGxpdCgiLyIpLnBvcCgpOwogICAgfSBjYXRjaCB7CiAgICAgIHJldHVybiBiYXNlbmFtZShyZXNvbHZlKCIuIikpOwogICAgfQogIH0KCiAgc3VwcG9ydHNQdWxsUmVxdWVzdHMoKSB7IHJldHVybiBmYWxzZTsgfQoKICBhc3luYyBjcmVhdGVQdWxsUmVxdWVzdCh7IGZyb20sIHRvIH0pIHsKICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKAogICAgICBKU09OLnN0cmluZ2lmeSh7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIG1lc3NhZ2U6IGBMb2thbGVyIE1vZHVzOiBrZWluIFB1bGwgUmVxdWVzdC4gRnVlaHJlIGVpbmVuIGxva2FsZW4gTWVyZ2UgZHVyY2g6XG4gIGdpdCBjaGVja291dCAke3RvfVxuICBnaXQgbWVyZ2UgJHtmcm9tfVxuICBnaXQgcHVzaGAKICAgICAgfSwgbnVsbCwgMikgKyAiXG4iCiAgICApOwogICAgcHJvY2Vzcy5leGl0KDApOwogIH0KfQoKLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Ci8vIEhpbGZzZnVua3Rpb25lbgovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KCmZ1bmN0aW9uIHNoZWxsUXVvdGUoc3RyKSB7CiAgcmV0dXJuIGAnJHtTdHJpbmcoc3RyKS5yZXBsYWNlKC8nL2csICInXFwnJyIpfSdgOwp9CgpmdW5jdGlvbiBsYWJlbFRvU3RhdHVzKGxhYmVsTmFtZXMpIHsKICBmb3IgKGNvbnN0IFtzdGF0dXMsIGxhYmVsXSBvZiBPYmplY3QuZW50cmllcyhHSVRMQUJfTEFCRUxTKSkgewogICAgaWYgKGxhYmVsTmFtZXMuaW5jbHVkZXMobGFiZWwpKSByZXR1cm4gc3RhdHVzOwogIH0KICByZXR1cm4gbnVsbDsKfQoKLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Ci8vIEFkYXB0ZXItQXVzd2FobAovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KCmZ1bmN0aW9uIHJlc29sdmVUcmFja2VyKGNvbmZpZykgewogIHN3aXRjaCAoY29uZmlnLmlzc3VlVHJhY2tlcikgewogICAgY2FzZSAiZ2l0aHViIjogcmV0dXJuIG5ldyBHaXRIdWJJc3N1ZVRyYWNrZXIoY29uZmlnKTsKICAgIGNhc2UgImdpdGxhYiI6IHJldHVybiBuZXcgR2l0TGFiSXNzdWVUcmFja2VyKCk7CiAgICBjYXNlICJsb2NhbCI6ICByZXR1cm4gbmV3IExvY2FsSXNzdWVUcmFja2VyKGNvbmZpZyk7CiAgICBkZWZhdWx0OiBmYWlsKGBVbmJla2FubnRlciBpc3N1ZVRyYWNrZXI6ICcke2NvbmZpZy5pc3N1ZVRyYWNrZXJ9Jy4gRXJ3YXJ0ZXQ6IGdpdGh1YiB8IGdpdGxhYiB8IGxvY2FsYCk7CiAgfQp9CgpmdW5jdGlvbiByZXNvbHZlQ29kZUhvc3QoY29uZmlnKSB7CiAgc3dpdGNoIChjb25maWcuY29kZUhvc3QpIHsKICAgIGNhc2UgImdpdGh1YiI6IHJldHVybiBuZXcgR2l0SHViQ29kZUhvc3QoY29uZmlnKTsKICAgIGNhc2UgImdpdGxhYiI6IHJldHVybiBuZXcgR2l0TGFiQ29kZUhvc3QoKTsKICAgIGNhc2UgImxvY2FsIjogIHJldHVybiBuZXcgTG9jYWxDb2RlSG9zdCgpOwogICAgZGVmYXVsdDogZmFpbChgVW5iZWthbm50ZXIgY29kZUhvc3Q6ICcke2NvbmZpZy5jb2RlSG9zdH0nLiBFcndhcnRldDogZ2l0aHViIHwgZ2l0bGFiIHwgbG9jYWxgKTsKICB9Cn0KCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQovLyBEaXNwYXRjaAovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KCmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7CiAgY29uc3QgYXJndiA9IHByb2Nlc3MuYXJndi5zbGljZSgyKTsKCiAgaWYgKGFyZ3YubGVuZ3RoID09PSAwIHx8IGFyZ3ZbMF0gPT09ICItLWhlbHAiIHx8IGFyZ3ZbMF0gPT09ICItaCIpIHsKICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEhFTFApOwogICAgcHJvY2Vzcy5leGl0KDApOwogIH0KCiAgY29uc3QgW2F4aXMsIGNvbW1hbmQsIC4uLnJlc3RdID0gYXJndjsKICBjb25zdCBhcmdzID0gcGFyc2VBcmdzKHJlc3QpOwoKICBpZiAoYXhpcyA9PT0gImlzc3VlIikgewogICAgY29uc3QgY29uZmlnID0gbG9hZENvbmZpZygpOwogICAgY29uc3QgdHJhY2tlciA9IHJlc29sdmVUcmFja2VyKGNvbmZpZyk7CgogICAgc3dpdGNoIChjb21tYW5kKSB7CiAgICAgIGNhc2UgImNyZWF0ZSI6IHsKICAgICAgICBpZiAoIWFyZ3MudGl0bGUpIGZhaWwoIi0tdGl0bGUgaXN0IGVyZm9yZGVybGljaCIpOwogICAgICAgIG91dChhd2FpdCB0cmFja2VyLmNyZWF0ZUlzc3VlKHsgdGl0bGU6IGFyZ3MudGl0bGUsIGJvZHk6IGFyZ3MuYm9keSB8fCAiIiB9KSk7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KICAgICAgY2FzZSAiZ2V0IjogewogICAgICAgIGNvbnN0IGlkID0gYXJncy5fWzBdOwogICAgICAgIGlmICghaWQpIGZhaWwoImlkIGlzdCBlcmZvcmRlcmxpY2g6IGJvYXJkLm1qcyBpc3N1ZSBnZXQgPGlkPiIpOwogICAgICAgIG91dChhd2FpdCB0cmFja2VyLmdldElzc3VlKGlkKSk7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KICAgICAgY2FzZSAibGlzdCI6IHsKICAgICAgICBpZiAoYXJncy5zdGF0dXMgJiYgIVZBTElEX1NUQVRVU0VTLmluY2x1ZGVzKGFyZ3Muc3RhdHVzKSkgewogICAgICAgICAgZmFpbChgVW5ndWVsdGlnZXIgU3RhdHVzICcke2FyZ3Muc3RhdHVzfScuIEd1ZWx0aWc6ICR7VkFMSURfU1RBVFVTRVMuam9pbigiLCAiKX1gKTsKICAgICAgICB9CiAgICAgICAgb3V0KGF3YWl0IHRyYWNrZXIubGlzdElzc3VlcyhhcmdzLnN0YXR1cykpOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICAgIGNhc2UgIm1vdmUiOiB7CiAgICAgICAgY29uc3QgW2lkLCB0b1N0YXR1c10gPSBhcmdzLl87CiAgICAgICAgaWYgKCFpZCkgZmFpbCgiaWQgaXN0IGVyZm9yZGVybGljaDogYm9hcmQubWpzIGlzc3VlIG1vdmUgPGlkPiA8c3RhdHVzPiIpOwogICAgICAgIGlmICghdG9TdGF0dXMpIGZhaWwoInN0YXR1cyBpc3QgZXJmb3JkZXJsaWNoOiBib2FyZC5tanMgaXNzdWUgbW92ZSA8aWQ+IDxzdGF0dXM+Iik7CiAgICAgICAgaWYgKCFWQUxJRF9TVEFUVVNFUy5pbmNsdWRlcyh0b1N0YXR1cykpIHsKICAgICAgICAgIGZhaWwoYFVuZ3VlbHRpZ2VyIFN0YXR1cyAnJHt0b1N0YXR1c30nLiBHdWVsdGlnOiAke1ZBTElEX1NUQVRVU0VTLmpvaW4oIiwgIil9YCk7CiAgICAgICAgfQogICAgICAgIGF3YWl0IHRyYWNrZXIubW92ZUlzc3VlKGlkLCB0b1N0YXR1cyk7CiAgICAgICAgb3V0KHsgb2s6IHRydWUsIGlkLCBzdGF0dXM6IHRvU3RhdHVzIH0pOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICAgIGNhc2UgImNvbW1lbnQiOiB7CiAgICAgICAgY29uc3QgaWQgPSBhcmdzLl9bMF07CiAgICAgICAgaWYgKCFpZCkgZmFpbCgiaWQgaXN0IGVyZm9yZGVybGljaDogYm9hcmQubWpzIGlzc3VlIGNvbW1lbnQgPGlkPiAtLXRleHQgXCIuLi5cIiIpOwogICAgICAgIGlmICghYXJncy50ZXh0KSBmYWlsKCItLXRleHQgaXN0IGVyZm9yZGVybGljaCIpOwogICAgICAgIGF3YWl0IHRyYWNrZXIuY29tbWVudElzc3VlKGlkLCBhcmdzLnRleHQpOwogICAgICAgIG91dCh7IG9rOiB0cnVlLCBpZCB9KTsKICAgICAgICBicmVhazsKICAgICAgfQogICAgICBkZWZhdWx0OgogICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEhFTFApOwogICAgICAgIGZhaWwoYFVuYmVrYW5udGVyIGlzc3VlLUJlZmVobDogJyR7Y29tbWFuZH0nYCk7CiAgICB9CgogIH0gZWxzZSBpZiAoYXhpcyA9PT0gImNvZGUiKSB7CiAgICBjb25zdCBjb25maWcgPSBsb2FkQ29uZmlnKCk7CiAgICBjb25zdCBob3N0ID0gcmVzb2x2ZUNvZGVIb3N0KGNvbmZpZyk7CgogICAgc3dpdGNoIChjb21tYW5kKSB7CiAgICAgIGNhc2UgInJlcG8tbmFtZSI6CiAgICAgICAgb3V0KHsgcmVwb05hbWU6IGF3YWl0IGhvc3QuZ2V0UmVwb05hbWUoKSB9KTsKICAgICAgICBicmVhazsKICAgICAgY2FzZSAicHIiOiB7CiAgICAgICAgaWYgKCFhcmdzLmZyb20pIGZhaWwoIi0tZnJvbSBpc3QgZXJmb3JkZXJsaWNoIik7CiAgICAgICAgaWYgKCFhcmdzLnRvKSBmYWlsKCItLXRvIGlzdCBlcmZvcmRlcmxpY2giKTsKICAgICAgICBpZiAoIWhvc3Quc3VwcG9ydHNQdWxsUmVxdWVzdHMoKSkgewogICAgICAgICAgZmFpbCgiRGllc2VyIGNvZGVIb3N0IHVudGVyc3R1ZXR6dCBrZWluZSBQdWxsIFJlcXVlc3RzLiBOdXR6ZSBlaW5lbiBsb2thbGVuIGdpdC1NZXJnZS4iKTsKICAgICAgICB9CiAgICAgICAgb3V0KGF3YWl0IGhvc3QuY3JlYXRlUHVsbFJlcXVlc3QoeyBmcm9tOiBhcmdzLmZyb20sIHRvOiBhcmdzLnRvLCB0aXRsZTogYXJncy50aXRsZSB9KSk7CiAgICAgICAgYnJlYWs7CiAgICAgIH0KICAgICAgZGVmYXVsdDoKICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShIRUxQKTsKICAgICAgICBmYWlsKGBVbmJla2FubnRlciBjb2RlLUJlZmVobDogJyR7Y29tbWFuZH0nYCk7CiAgICB9CgogIH0gZWxzZSB7CiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShIRUxQKTsKICAgIGZhaWwoYFVuYmVrYW5udGUgQWNoc2U6ICcke2F4aXN9Jy4gRXJ3YXJ0ZXQ6IGlzc3VlIHwgY29kZWApOwogIH0KfQoKbWFpbigpLmNhdGNoKChlcnIpID0+IHsKICBwcm9jZXNzLnN0ZGVyci53cml0ZShgVW5lcndhcnRldGVyIEZlaGxlcjogJHtlcnIubWVzc2FnZX1cbmApOwogIHByb2Nlc3MuZXhpdCgxKTsKfSk7Cg==";

// --- Defaults (eingebettet, damit install.mjs als Single-File portabel ist) ---
const schema = {
  defaults: {
    codeHost: "github",
    issueTracker: "github",
    buildChecks: [],
    mutationCommand: "",
    mainBranch: "main",
    productionBranch: "production",
    reviewScope: "diff",
    reviewModel: "claude-opus-4-8",
    triggers: { go: "GO", push: "push main", merge: "merge production" },
    local: { issuesDir: "issues" },
  },
  validationRules: [
    {
      field: "codeHost",
      rule: "enum",
      allowed: ["github", "gitlab", "local"],
      error: "codeHost muss 'github', 'gitlab' oder 'local' sein.",
    },
    {
      field: "issueTracker",
      rule: "enum",
      allowed: ["github", "gitlab", "local"],
      error: "issueTracker muss 'github', 'gitlab' oder 'local' sein.",
    },
    {
      field: "reviewScope",
      rule: "enum",
      allowed: ["diff", "full"],
      error: "reviewScope muss 'diff' oder 'full' sein.",
    },
    {
      field: "reviewModel",
      rule: "pattern",
      pattern: "^claude-",
      error: "reviewModel muss eine Claude-Modell-ID sein (z.B. 'claude-opus-4-8').",
    },
  ],
};
const DEFAULTS = schema.defaults;

// --- Stdin-Lese-Infrastruktur ---
// Liest alle Zeilen vorab wenn kein TTY (Pipe/CI), liefert sie der Reihe nach.
// Im TTY-Modus nutzt readline normal interaktiv.

let _pipedLines = null;

async function loadPipedLines() {
  if (process.stdin.isTTY) return;
  _pipedLines = [];
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    _pipedLines.push(line);
  }
}

function ask(rl, question) {
  if (_pipedLines !== null) {
    const line = _pipedLines.shift() ?? "";
    process.stdout.write(question + line + "\n");
    return Promise.resolve(line);
  }
  return new Promise((resolve) => rl.question(question, resolve));
}

// --- Hilfsfunktionen ---

function validate(field, value) {
  const rules = schema.validationRules || [];
  for (const rule of rules) {
    if (rule.field !== field) continue;
    if (rule.rule === "enum" && !rule.allowed.includes(value)) {
      return rule.error;
    }
    if (rule.rule === "pattern" && !new RegExp(rule.pattern).test(value)) {
      return rule.error;
    }
  }
  return null;
}

async function askWithDefault(rl, question, defaultValue, field) {
  while (true) {
    const raw = await ask(rl, `${question} [${defaultValue}]: `);
    const value = raw.trim() === "" ? defaultValue : raw.trim();
    const error = field ? validate(field, value) : null;
    if (error) {
      console.error(`  Fehler: ${error}`);
      if (_pipedLines !== null) throw new Error(`Validation failed in non-interactive mode: ${error}`);
      continue;
    }
    return value;
  }
}

function copySkills(skillsSrc, targetDir) {
  const skills = [
    "plan", "issues", "implement-ready", "local-check",
    "review", "retro", "push-main", "merge-production",
    "kontext", "document",
  ];
  mkdirSync(targetDir, { recursive: true });
  for (const skill of skills) {
    const src = join(skillsSrc, skill);
    const dest = join(targetDir, skill);
    if (!existsSync(src)) {
      console.warn(`  Warnung: ${src} nicht gefunden, wird uebersprungen.`);
      continue;
    }
    cpSync(src, dest, { recursive: true });
    console.log(`  ✓ ${skill}`);
  }
}

// --- GitLab Label Setup ---

const GITLAB_LABELS = [
  { name: "Backlog",     color: "#e2e2e2" },
  { name: "Ready",       color: "#0075ca" },
  { name: "In Progress", color: "#e4e669" },
  { name: "In Review",   color: "#d93f0b" },
  { name: "Done",        color: "#0e8a16" },
];

async function setupGitLabLabels(rl) {
  const raw = await ask(rl, "\nGitLab-Labels jetzt automatisch anlegen? (glab muss eingeloggt sein) [j/n]: ");
  if (raw.trim().toLowerCase() !== "j") {
    console.log(`  Labels manuell anlegen: Backlog, Ready, "In Progress", "In Review", Done`);
    console.log(`  Wichtig: Leerzeichen in den Namen verwenden, kein Bindestrich.\n`);
    return;
  }
  console.log("\nLege GitLab-Labels an:");
  const { execSync } = await import("node:child_process");
  for (const label of GITLAB_LABELS) {
    try {
      execSync(`glab label create --name "${label.name}" --color "${label.color}"`, { stdio: "pipe" });
      console.log(`  ✓ ${label.name}`);
    } catch (e) {
      const msg = e.stderr?.toString() ?? "";
      if (msg.includes("already exists") || msg.includes("has already been taken")) {
        console.log(`  ~ ${label.name} (bereits vorhanden)`);
      } else {
        console.warn(`  ✗ ${label.name}: ${msg.trim()}`);
      }
    }
  }
  console.log(`\n  Labels angelegt. Jetzt manuell das Board einrichten:`);
  console.log(`  Issues → Boards → "Add list" → je eine Spalte fuer jedes Label anlegen.`);
  console.log(`  Reihenfolge: Backlog → Ready → In Progress → In Review → Done`);
  console.log(`  (Board-Spalten lassen sich nicht per CLI anlegen — das ist eine GitLab-Einschraenkung.)\n`);
}

// --- Hauptprogramm ---

async function main() {
  if (process.argv.includes("--version")) {
    console.log(`Stellwerk install.mjs v${VERSION}`);
    process.exit(0);
  }

  await loadPipedLines();
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : { close: () => {} };

  console.log("\n=== Stellwerk Installer ===\n");
  console.log("Dieser Installer richtet die Stellwerk-Skill-Bibliothek ein.");
  console.log("Sechs Fragen, dann bist du fertig.\n");

  // Frage 1: global oder projekt
  let scope;
  while (true) {
    const raw = await ask(rl, "Skills global (~/.claude/skills/) oder nur fuer dieses Projekt (.claude/skills/)? [global/projekt]: ");
    const answer = raw.trim().toLowerCase();
    if (answer === "" || answer === "global") { scope = "global"; break; }
    if (answer === "projekt") { scope = "projekt"; break; }
    console.error("  Bitte 'global' oder 'projekt' eingeben.");
  }

  // Bestehende Config als Defaults laden (Update-Modus)
  const existingConfigPath = scope === "global"
    ? join(homedir(), ".claude", "workflow.config.json")
    : resolve(".claude", "workflow.config.json");
  let existingConfig = {};
  if (existsSync(existingConfigPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(existingConfigPath, "utf-8"));
      console.log("  Bestehende workflow.config.json gefunden — Werte als Defaults uebernommen.\n");
    } catch {
      console.warn("  Hinweis: Bestehende workflow.config.json konnte nicht gelesen werden.\n");
    }
  }
  // Rueckwaertskompatibilitaet: altes provider-Feld auf codeHost/issueTracker migrieren
  if (existingConfig.provider && !existingConfig.codeHost) existingConfig.codeHost = existingConfig.provider;
  if (existingConfig.provider && !existingConfig.issueTracker) existingConfig.issueTracker = existingConfig.provider;
  const D = { ...DEFAULTS, ...existingConfig };

  // Frage 2: codeHost
  const codeHost = await askWithDefault(
    rl,
    "Code-Host: 'github', 'gitlab' oder 'local'?",
    D.codeHost,
    "codeHost"
  );

  // Frage 3: issueTracker
  const issueTracker = await askWithDefault(
    rl,
    "Issue-Tracker: 'github', 'gitlab' oder 'local'?",
    D.issueTracker ?? codeHost,
    "issueTracker"
  );

  // Frage 5: mainBranch
  const mainBranch = await askWithDefault(rl, "Haupt-Branch (mainBranch)", D.mainBranch);

  // Frage 6: productionBranch
  const productionBranch = await askWithDefault(rl, "Production-Branch (productionBranch)", D.productionBranch);

  // Frage 7: reviewScope
  const reviewScope = await askWithDefault(
    rl,
    "Review-Umfang: 'diff' (nur Aenderungen) oder 'full' (gesamter Quelltext)?",
    D.reviewScope,
    "reviewScope"
  );

  // Frage 8: reviewModel
  const reviewModel = await askWithDefault(
    rl,
    "Reviewer-Modell (muss mit 'claude-' beginnen)",
    D.reviewModel,
    "reviewModel"
  );

  // Frage 6 (nur bei globalem Install): Vault-Pfad für kontext.config.json
  let vaultPath = "";
  if (scope === "global") {
    const raw = await ask(rl, "Pfad zum Memory-Vault für /kontext (leer = überspringen): ");
    vaultPath = raw.trim();
  }

  rl.close();

  // --- Pfade berechnen ---
  const skillsSrc = join(__dirname, "skills");
  const targetBase = scope === "global"
    ? join(homedir(), ".claude")
    : resolve(".claude");
  const skillsTarget = join(targetBase, "skills");
  const configTarget = join(targetBase, "workflow.config.json");
  const workflowMdTarget = join(targetBase, "CLAUDE-workflow.md");
  const workflowMdSrc = join(__dirname, "templates", "CLAUDE-workflow.md");

  // --- Skills kopieren ---
  console.log(`\nKopiere Skills nach ${skillsTarget}:`);
  copySkills(skillsSrc, skillsTarget);

  // --- Config schreiben ---
  const config = {
    codeHost,
    issueTracker,
    buildChecks: DEFAULTS.buildChecks,
    mutationCommand: DEFAULTS.mutationCommand,
    mainBranch,
    productionBranch,
    reviewScope,
    reviewModel,
    triggers: DEFAULTS.triggers,
    local: DEFAULTS.local,
  };
  mkdirSync(targetBase, { recursive: true });
  writeFileSync(configTarget, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`\n✓ Config geschrieben: ${configTarget}`);

  // --- kontext.config.json schreiben (nur bei globalem Install mit Vault-Pfad) ---
  if (scope === "global" && vaultPath) {
    const kontextConfig = {
      vault: vaultPath,
      always: ["Index.md", "Profil.md"],
      projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
    };
    const kontextConfigTarget = join(targetBase, "kontext.config.json");
    writeFileSync(kontextConfigTarget, JSON.stringify(kontextConfig, null, 2) + "\n", "utf-8");
    console.log(`✓ kontext.config.json geschrieben: ${kontextConfigTarget}`);
  }

  // --- CLAUDE-workflow.md ablegen ---
  writeFileSync(workflowMdTarget, CLAUDE_WORKFLOW_MD, "utf-8");
  console.log(`✓ CLAUDE-workflow.md abgelegt: ${workflowMdTarget}`);

  // --- board.mjs ausschreiben ---
  const kitDir = join(targetBase, "kit");
  mkdirSync(kitDir, { recursive: true });
  const boardTarget = join(kitDir, "board.mjs");
  writeFileSync(boardTarget, Buffer.from(BOARD_MJS_B64, "base64").toString("utf-8"), "utf-8");
  console.log(`✓ board.mjs geschrieben: ${boardTarget}`);

  // --- .gitignore ergänzen (nur projektlokal) ---
  if (scope === "projekt") {
    const gitignorePath = resolve(".gitignore");
    const entry = ".claude/";
    let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    const lines = content.split("\n");
    if (!lines.some((l) => l.trim() === entry)) {
      content = content.endsWith("\n") || content === "" ? content + entry + "\n" : content + "\n" + entry + "\n";
      writeFileSync(gitignorePath, content, "utf-8");
      console.log(`✓ .gitignore: '${entry}' eingetragen`);
    } else {
      console.log(`✓ .gitignore: '${entry}' bereits vorhanden`);
    }
  }

  console.log("\n=== Fertig ===");
  console.log(`Starte eine neue Claude-Code-Session im Projekt.`);
  console.log(`Die zehn Skills erscheinen in /help.\n`);
  if (codeHost === "gitlab" || issueTracker === "gitlab") {
    console.log(`GitLab: Stelle sicher dass 'glab auth login' durchgefuehrt wurde.`);
    await setupGitLabLabels(rl);
  } else if (codeHost === "github" || issueTracker === "github") {
    console.log(`GitHub: Stelle sicher dass 'gh auth login' durchgefuehrt wurde.\n`);
  }
  console.log(`Naechster Schritt: workflow.config.json anpassen (buildChecks, mutationCommand).`);
  console.log(`Pfad: ${configTarget}\n`);
}

main().catch((err) => {
  console.error("\nFehler:", err.message);
  process.exit(1);
});
