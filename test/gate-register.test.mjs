/**
 * gate-register.test.mjs — die beiden Gate-Register werden vollstaendig ausgeliefert.
 *
 * `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` liegen anders als `CLAUDE-workflow.md` nur
 * EINMAL im Repo: als Vorlage unter `templates/`, aus der `tools/sync-blobs.mjs` den Blob
 * in install.mjs backt. Die Kopie unter `.claude/` ist reine Installer-Ausgabe und
 * bewusst nicht versioniert — deshalb gibt es hier auch keinen Drift-Test zwischen
 * Vorlage und Kopie, wie ihn `docs-lebenszyklus` fuer die Prozessdatei fuehrt. Er waere
 * in CI rot, wo die Kopie gar nicht existiert.
 *
 * Dass der Blob zur Vorlage passt, bewacht `tools/sync-blobs.mjs --check` als buildCheck.
 * Hier geht es darum, dass der Installer die Register ueberhaupt kennt und dass jedes
 * Gate die Form hat, auf die sich ein Befund berufen kann.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(root, ...teile), "utf-8");

const REGISTER = [
  ["CLAUDE-Fachplan.md", "F"],
  ["CLAUDE-Plan.md", "P"],
];

test("install.mjs liefert beide Register aus und legt sie neben CLAUDE-workflow.md ab", () => {
  const install = lies("install.mjs");
  for (const konstante of ["CLAUDE_FACHPLAN_MD_B64", "CLAUDE_PLAN_MD_B64"]) {
    const m = install.match(new RegExp(`const ${konstante} = "([A-Za-z0-9+/=]*)";`));
    assert.ok(m, `${konstante} fehlt in install.mjs`);
    assert.ok(m[1].length > 0, `${konstante} ist leer — sync-blobs.mjs wurde nicht gelaufen`);
  }
  // targetBase ist ~/.claude (global) oder ./.claude (lokal); beide Register muessen
  // denselben Weg gehen wie CLAUDE-workflow.md, sonst laedt `/kontext` sie nie.
  for (const [datei] of REGISTER) {
    assert.match(
      install,
      new RegExp(`join\\(targetBase, "${datei}"\\)`),
      `install.mjs legt ${datei} nicht in targetBase ab`
    );
  }
});

test("Jedes Register nennt seine Gates nummeriert und markiert sie", () => {
  for (const [datei, praefix] of REGISTER) {
    const text = lies("templates", datei);
    const ueberschriften = text.match(new RegExp(`^## ${praefix}\\d+ .*$`, "gm")) || [];
    assert.ok(ueberschriften.length >= 10, `${datei} hat nur ${ueberschriften.length} Gates`);
    for (const zeile of ueberschriften) {
      // Ein gestrichenes Gate behaelt seine Nummer, traegt aber keinen Marker mehr.
      if (/gestrichen/.test(zeile)) continue;
      assert.match(
        zeile,
        /`\[(maschinell|Urteil|maschinell \+ Urteil)\]`$/,
        `${datei}: "${zeile}" traegt keinen gueltigen Marker`
      );
    }
  }
});

// Ohne diesen Abschnitt erklaert ein Reviewer irgendwann jeden Fund zum Verstoss —
// dann steht `kit:klaeren` an jedem Ticket und das Register blockiert, statt zu fuehren.
test("Jedes Register grenzt ab, was ausdruecklich kein Gate ist", () => {
  for (const [datei] of REGISTER) {
    assert.match(lies("templates", datei), /^## Ausdruecklich kein Gate$/m,
      `${datei} fehlt der Abschnitt "Ausdruecklich kein Gate"`);
  }
});

// Eine neu vergebene Nummer macht jeden aelteren Befund zweideutig ("F4 verletzt" —
// welches F4?). Gestrichene Gates behalten die Nummer und stehen hier.
test("Gestrichene Gates stehen unter 'Verbrannte Nummern'", () => {
  for (const [datei, praefix] of REGISTER) {
    const text = lies("templates", datei);
    const gestrichen = (text.match(new RegExp(`^## (${praefix}\\d+) — gestrichen`, "gm")) || [])
      .map((z) => z.match(new RegExp(`${praefix}\\d+`))[0]);
    if (gestrichen.length === 0) continue;
    const abschnitt = text.split("## Verbrannte Nummern")[1];
    assert.ok(abschnitt, `${datei} hat gestrichene Gates, aber keinen Abschnitt "Verbrannte Nummern"`);
    for (const nummer of gestrichen) {
      assert.match(abschnitt, new RegExp(`\\*\\*${nummer}\\*\\*`),
        `${datei}: ${nummer} ist gestrichen, steht aber nicht unter "Verbrannte Nummern"`);
    }
  }
});
