// Ablauf-Pruefung: Die Vorgaben fuer Board und checks.mjs starten die Kommandos unter .claude/kit/ als Kindprozess, und Exit-Code und Fehlerzeile setzt nur die Kommandozeile.
//
// Die uebrigen Tests von kit/wirksamkeit.mjs rufen das Werkzeug im selben Prozess ueber
// `aufrufen` und geben Board und `checks.mjs bereiche` als Attrappen-Funktionen
// (Issue #1213, Plan #1199 E6). Was dabei ungeprueft bliebe, belegt diese Datei an
// echten Prozessen: dass ohne Attrappe genau die Kommandos des Projekts unter
// `.claude/kit/` starten — der Board-Adapter mit EINEM Sammelaufruf (Issue #788) —, und
// dass die Kommandozeile Exit-Code und Fehlerzeile setzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const WIRKSAMKEIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "wirksamkeit.mjs");

const TAG_MS = 24 * 60 * 60 * 1000;
const vorTagen = (n) => new Date(Date.now() - n * TAG_MS).toISOString();

/**
 * Ein Wegwerf-Projekt mit Ausfuehrungsprotokoll, Bewegungsprotokoll und Config. Bewusst
 * ohne test/helpers/wirksamkeit-fixture.mjs: Diese Datei soll nur an wirksamkeit.mjs
 * haengen, und die Formen der beiden Protokollzeilen sind hier kurz genug.
 */
function mitProjekt({ ausfuehrungen = [], bewegungen = [], config }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "wirksamkeit-ablauf-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "ausfuehrungen.tsv"), ausfuehrungen.map((z) => `${z}\n`).join(""), "utf-8");
    writeFileSync(join(dir, ".claude", "bewegungen.tsv"), bewegungen.map((z) => `${z}\n`).join(""), "utf-8");
    if (config) writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config), "utf-8");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const moved = (tage, spalte) => ({ type: "MOVED", createdAt: vorTagen(tage), detail: `Verschoben nach ${spalte}` });

/** Ein Stub unter `.claude/kit/`, der jeden Aufruf protokolliert und `antwort` ausgibt. */
function stub(name, antwort) {
  return [
    'import { appendFileSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "const hier = dirname(fileURLToPath(import.meta.url));",
    `appendFileSync(join(hier, "${name}.log"), process.argv.slice(2).join(" ") + "\\n");`,
    `process.stdout.write(${JSON.stringify(JSON.stringify(antwort))});`,
  ].join("\n");
}

function stubsAnlegen(dir) {
  const kit = join(dir, ".claude", "kit");
  mkdirSync(kit, { recursive: true });
  writeFileSync(join(kit, "board.mjs"), stub("board", { 12: [moved(5, "In review"), moved(4, "Done")] }), "utf-8");
  writeFileSync(join(kit, "checks.mjs"), stub("checks", { bereiche: [], kommandos: 1, freigestellt: [], ohneZuordnung: [], dateien: 1 }), "utf-8");
  return (name) => {
    const pfad = join(kit, `${name}.log`);
    return existsSync(pfad) ? readFileSync(pfad, "utf-8").split("\n").filter(Boolean) : [];
  };
}

function cli(dir, ...cliArgs) {
  return spawnSync(process.execPath, [WIRKSAMKEIT, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

test("[wirksamkeit-1213] ohne Attrappe starten Board und checks.mjs aus .claude/kit/, das Board mit einem Sammelaufruf", () => {
  mitProjekt({
    config: { issueTracker: "github", buildChecks: ["node --test"] },
    ausfuehrungen: [`${vorTagen(1)}\tnode --test\tgruen\t1000`],
    bewegungen: [`${vorTagen(5)}\t12\tin_review`],
  }, (dir) => {
    const aufrufe = stubsAnlegen(dir);
    const res = cli(dir, "auswerten");

    assert.equal(res.status, 0, res.stderr);
    const e = JSON.parse(res.stdout);
    assert.equal(e.bereiche.vermerk ?? null, null, "der Zuschnitt aus checks.mjs kam nicht an");
    assert.equal(e.ruecklauf.status, "berechnet", "der Verlauf aus dem Board kam nicht an");
    assert.deepEqual(aufrufe("board"), ["issue activity --ids 12"]);
    assert.deepEqual(aufrufe("checks"), ["bereiche"]);
  });
});

test("[wirksamkeit-1213] die Kommandozeile setzt bei einem abgewiesenen Aufruf Exit 1 mit Fehlerzeile", () => {
  mitProjekt({}, (dir) => {
    const res = cli(dir, "befund", "--fenster", "3");

    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /^Fehler: 'befund' nimmt keine Argumente/);
  });
});

/** Legt `.claude/wirksamkeit.json` mit den genannten Pruefungen an. */
function standAnlegen(dir, pruefungen) {
  writeFileSync(join(dir, ".claude", "wirksamkeit.json"), JSON.stringify({ pruefungen }), "utf-8");
}

test("[wirksamkeit-1398] kandidaten gibt je Reparaturkandidat eine Zeile aus und rechnet nicht neu", () => {
  mitProjekt({ ausfuehrungen: [`${vorTagen(1)}\tnode --test\tgruen\t1000`] }, (dir) => {
    standAnlegen(dir, [
      { cmd: "node --test", wackler: 4, reparaturkandidat: true },
      { cmd: "npx eslint .", wackler: 2, reparaturkandidat: false },
      { cmd: "npm run build", wackler: 3, reparaturkandidat: true },
    ]);
    const res = cli(dir, "kandidaten");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout,
      "Reparaturkandidat: node --test — 4 Wackler im Zeitfenster\n"
      + "Reparaturkandidat: npm run build — 3 Wackler im Zeitfenster\n");
    assert.equal(existsSync(join(dir, ".claude", "wirksamkeit.md")), false, "kandidaten hat neu ausgewertet");
  });
});

test("[wirksamkeit-1398] kandidaten bleibt ohne Kandidaten und ohne Datei leer mit Exit 0", () => {
  mitProjekt({}, (dir) => {
    const ohneDatei = cli(dir, "kandidaten");
    assert.equal(ohneDatei.status, 0, ohneDatei.stderr);
    assert.equal(ohneDatei.stdout, "");

    standAnlegen(dir, [{ cmd: "node --test", wackler: 2, reparaturkandidat: false }]);
    const ohneKandidaten = cli(dir, "kandidaten");
    assert.equal(ohneKandidaten.status, 0, ohneKandidaten.stderr);
    assert.equal(ohneKandidaten.stdout, "");
  });
});

test("[wirksamkeit-1398] ein unbekannter Befehl nennt kandidaten unter den erwarteten", () => {
  mitProjekt({}, (dir) => {
    const res = cli(dir, "gibtsnicht");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Erwartet: auswerten, befund oder kandidaten/);
  });
});
