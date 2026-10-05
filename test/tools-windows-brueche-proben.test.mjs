// Eingebaute Windows-Brueche erscheinen bei jedem Lauf an allen drei Meldeorten
// (Issue #1164, Plan #1150, E11, E13, E18; Kriterium 3 aus #1147).
//
// Je Art liegt unter test/fixtures/windows-brueche/ ein gezielt eingebauter Bruch neben
// einem vermerkten Gegenbeispiel. Dieser Test faehrt in jeder Suite und zeigt:
//   (a) das Werkzeug meldet je Fixture genau den eingebauten Bruch mit Datei und Art und
//       kein Gegenbeispiel;
//   (b) `kit/checks.mjs run --abschluss` (Paketabschluss) und `--stufe push`
//       (Veroeffentlichung) tragen diese Funde als `hinweis:`-Zeilen in `berichtszeilen` und
//       `hinweise[]` und bleiben `gruen`;
//   (c) der Nacht-Runner uebernimmt eine solche Zusammenfassung in Einheit, Log und
//       Nachtbericht unter `### Umsetzung`.
// Verliert eine Fixture ihren Bruch, schlaegt (a) fehl — die Pruefung kann nicht
// unbemerkt stumpf werden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { datei, mitRepo, run, zusammenfassung } from "./helpers/checks-repo.mjs";
import { berichtBauen } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WERKZEUG = join(repoRoot, "tools", "windows-brueche.mjs");
const FIXTURES = join(repoRoot, "test", "fixtures", "windows-brueche");
const NAMEN = "dateien-namen.txt";
const NIGHT = join(repoRoot, "kit", "night.mjs");

/** Je Fixture-Datei die Art ihres eingebauten Bruchs; jede der sieben Arten kommt vor. */
const PROBEN = {
  "dateien-namen.txt": "dateien",
  "dateien.txt": "dateien",
  "fakes.txt": "fakes",
  "kommandos-skill.txt": "kommandos",
  "kommandos.txt": "kommandos",
  "pfade.txt": "pfade",
  "prozesse.txt": "prozesse",
  "skips.txt": "skips",
  "zeilenenden.txt": "zeilenenden",
};
const ARTEN = ["pfade", "kommandos", "dateien", "prozesse", "skips", "zeilenenden", "fakes"];

function werkzeugLauf(wurzel) {
  return spawnSync(process.execPath, [WERKZEUG, "--wurzel", wurzel, "--namen", join(wurzel, NAMEN)], { encoding: "utf-8" });
}

/** Die Funde ohne das Praefix `Hinweis: `, so wie checks.mjs sie in `hinweise[]` fuehrt. */
function funde(stdout) {
  return stdout.split(/\r?\n/).filter((z) => z.startsWith("Hinweis: ")).map((z) => z.slice("Hinweis: ".length));
}

/**
 * Was an den Fixtures unter `wurzel` von der Erwartung abweicht, als Liste lesbarer Saetze;
 * leer heisst: je Datei genau ein Fund ihrer Art, und er liegt vor dem Gegenbeispiel.
 */
function probenAbweichungen(wurzel) {
  const r = werkzeugLauf(wurzel);
  if (r.status !== 0) return [`Werkzeug endete mit Exit ${r.status}: ${r.stderr}`];
  const abweichungen = [];
  const gefunden = funde(r.stdout);
  for (const [datei, art] of Object.entries(PROBEN)) {
    const eigene = gefunden.filter((f) => f.startsWith(`${datei}:`));
    if (eigene.length !== 1) {
      abweichungen.push(`${datei}: ${eigene.length} Funde statt genau einem (${art})`);
      continue;
    }
    const treffer = /^[^:]+:(\d+) — ([a-z]+): /.exec(eigene[0]);
    if (!treffer || treffer[2] !== art) {
      abweichungen.push(`${datei}: Fund nicht der Art ${art}: ${eigene[0]}`);
      continue;
    }
    const zeilen = readFileSync(join(wurzel, datei), "utf-8").split(/\r?\n/);
    const gegen = datei === NAMEN ? 1 : zeilen.findIndex((z) => z.includes("Gegenbeispiel"));
    if (Number(treffer[1]) > gegen) abweichungen.push(`${datei}: der Fund liegt im Gegenbeispiel: ${eigene[0]}`);
  }
  for (const f of gefunden) {
    if (!Object.keys(PROBEN).some((datei) => f.startsWith(`${datei}:`))) abweichungen.push(`unerwarteter Fund: ${f}`);
  }
  return abweichungen;
}

test("[1164] die Proben decken jede der sieben Arten ab", () => {
  assert.deepEqual([...new Set(Object.values(PROBEN))].sort(), [...ARTEN].sort());
});

test("[1164] (a) das Werkzeug meldet je Art genau den eingebauten Bruch mit Datei und Art, kein Gegenbeispiel", () => {
  assert.deepEqual(probenAbweichungen(FIXTURES), []);
});

test("[1164] (a) verliert eine Fixture ihren Bruch, faellt die Probe auf", () => {
  const dir = mkdtempSync(join(tmpdir(), "windows-proben-"));
  try {
    cpSync(FIXTURES, dir, { recursive: true });
    const pfad = join(dir, "prozesse.txt");
    const zeilen = readFileSync(pfad, "utf-8").split(/\r?\n/);
    const bruch = zeilen.findIndex((z) => z.includes("Bruch:")) + 1;
    zeilen.splice(bruch, 1);
    writeFileSync(pfad, zeilen.join("\n"));

    assert.deepEqual(probenAbweichungen(dir), ["prozesse.txt: 0 Funde statt genau einem (prozesse)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Der Hinweis-Eintrag im Wegwerf-Repo, auf die Fixtures dieses Repositories gerichtet. */
const HINWEIS_CMD = `node "${WERKZEUG}" --wurzel "${FIXTURES}" --namen "${join(FIXTURES, NAMEN)}"`;
const HINWEIS_CONFIG = {
  buildChecks: [{ cmd: HINWEIS_CMD, art: "hinweis", always: true }],
  checkAreas: { frontend: ["frontend/**"] },
};

/**
 * Faehrt checks.mjs mit den Argumenten im Wegwerf-Repo und gibt seine Zusammenfassung. Das
 * Paket aendert eine Datei: Ein leeres Paket faehrt beim Abschluss keine Pruefung.
 */
function meldeort(...cliArgs) {
  let summary = null;
  mitRepo({ config: HINWEIS_CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");
    const res = run(dir, ...cliArgs);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    summary = zusammenfassung(dir);
  });
  return summary;
}

const ERWARTET = funde(werkzeugLauf(FIXTURES).stdout);

for (const [ort, cliArgs] of [["Paketabschluss", ["--abschluss", "1164"]], ["Veroeffentlichung", ["--stufe", "push"]]]) {
  test(`[1164] (b) ${ort}: die eingebauten Brueche stehen in berichtszeilen und hinweise[], jeder Eintrag bleibt gruen`, () => {
    assert.equal(ERWARTET.length, Object.keys(PROBEN).length, ERWARTET.join("\n"));
    const summary = meldeort(...cliArgs);

    assert.ok(summary.laufen.length > 0, "der Hinweis-Eintrag ist gelaufen");
    for (const e of summary.laufen) assert.equal(e.ergebnis, "gruen", JSON.stringify(e));
    assert.deepEqual(summary.hinweise, [{ cmd: HINWEIS_CMD, zeilen: ERWARTET }]);
    for (const zeile of ERWARTET) {
      assert.ok(summary.berichtszeilen.includes(`hinweis: ${zeile}`), `fehlt in berichtszeilen: ${zeile}`);
    }
  });
}

// ---- (c) Nacht-Runner ---------------------------------------------------------

function nightRun(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = nightRun(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Projekt fuer den Runner mit lokalem Tracker; die Zusammenfassung liegt ungetrackt unter bin/. */
function nachtProjekt(summary) {
  const dir = mkdtempSync(join(tmpdir(), "windows-proben-nacht-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
  writeFileSync(join(dir, "bin", "zusammenfassung.json"), JSON.stringify(summary));
  for (const args of [
    ["init", "-q"],
    ["config", "core.autocrlf", "false"],
    ["config", "user.email", "test@example.invalid"],
    ["config", "user.name", "Night Test"],
    ["add", "-A"],
    ["commit", "-q", "-m", "setup"],
  ]) {
    const res = nightRun(dir, "git", args);
    assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function einheit(dir, id) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n));
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const treffer = stand.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand`);
  return treffer;
}

const FAKE_SESSION = [
  "cp bin/zusammenfassung.json .claude/checks-summary.json",
  'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt" && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"',
  'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
].join("\n");

test("[1164] (c) der Nacht-Runner uebernimmt die eingebauten Brueche in Einheit, Log und Nachtbericht", () => {
  const summary = meldeort("--abschluss", "1164");
  const dir = nachtProjekt(summary);
  try {
    const issue = board(dir, "issue", "create", "--title", "Paket mit Proben", "--body", "## Abhaengigkeiten\nKeine.");
    const id = String(issue.id);
    board(dir, "issue", "move", id, "ready");

    const res = nightRun(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: FAKE_SESSION });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    // Einheit
    const e = einheit(dir, id);
    assert.deepEqual(e.pruefung.hinweise, [{ cmd: HINWEIS_CMD, zeilen: ERWARTET }]);
    assert.equal(e.ausgang, "erfolg", "die Einheit bleibt trotz Hinweisen erfolgreich");

    // Log
    const ausgabe = `${res.stdout}\n${res.stderr}`;
    for (const zeile of ERWARTET) {
      assert.ok(ausgabe.includes(`- Issue #${id}: hinweis: ${zeile}`), `fehlt im Log: ${zeile}`);
    }

    // Nachtbericht
    const kette = {
      id: "1", ausgang: "fertig", variante: "B",
      stufen: { umsetzung: { umgesetzt: [{ id, stufe: "mittel" }], angehalten: [], nichtBegonnen: [] } },
    };
    const text = berichtBauen(kette, { pakete: [{ id, title: "Paket mit Proben" }], einheiten: [e], stempel: "s" });
    const umsetzung = new Set(text.slice(text.indexOf("### Umsetzung"), text.indexOf("### Entscheidungen der Nacht")).split(/\r?\n/));
    for (const zeile of ERWARTET) {
      assert.ok(umsetzung.has(`- Issue #${id}: hinweis: ${zeile}`), `fehlt unter ### Umsetzung: ${zeile}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
