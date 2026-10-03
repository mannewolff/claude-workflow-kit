// Rueckmeldung zur Windows-Pruefung der CI (Issue #1129, Plan #1128, E3 bis E5).
//
// Das Werkzeug laeuft als `SessionStart`- und `UserPromptSubmit`-Hook im Kit-Repository
// und meldet einen roten Job `check (windows-latest)` fuer `origin/main`. Die reinen
// Entscheidungen pruefen die exportierten Funktionen; der Hook selbst laeuft als echter
// Kindprozess in einem Wegwerf-Repository, und `WINDOWS_PRUEFUNG_CI_CMD` ersetzt
// `board.mjs` durch einen Node-Fake — nur ein echter Kindprozess belegt, dass die Frist
// von fuenf Sekunden eine haengende Abfrage wirklich abbricht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { faelligeAbfrage, meldungFuer, urteilFuer } from "../tools/windows-pruefung.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const werkzeug = join(repoRoot, "tools", "windows-pruefung.mjs");
const JOB = "check (windows-latest)";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const status = (...jobs) => ({ status: "egal", jobs: jobs.map(([name, ergebnis]) => ({ name, ergebnis })) });

// ---- urteilFuer -------------------------------------------------------------

test("[1129] urteilFuer wertet nur den Windows-Job", () => {
  assert.equal(urteilFuer(status([JOB, "rot"], ["check (ubuntu-latest)", "gruen"])), "rot");
  assert.equal(urteilFuer(status([JOB, "gruen"], ["sonarqube", "rot"])), "gruen");
  assert.equal(urteilFuer(status([JOB, "laeuft"])), "laeuft");
});

test("[1129] urteilFuer: ohne Windows-Job laeuft die Pruefung noch, ein unlesbarer Status ist ein Abfragefehler", () => {
  assert.equal(urteilFuer(status(["sonarqube", "rot"])), "laeuft");
  assert.equal(urteilFuer(null), null);
  assert.equal(urteilFuer({ status: "rot" }), null);
});

// ---- faelligeAbfrage --------------------------------------------------------

test("[1129] faelligeAbfrage: ohne Vorrat oder fuer einen neuen Commit ist die Abfrage faellig", () => {
  assert.equal(faelligeAbfrage(null, SHA, 0), true);
  assert.equal(faelligeAbfrage({ commit: "anders", ergebnis: "rot", abgefragtUm: 0 }, SHA, 0), true);
});

test("[1129] faelligeAbfrage: ein festes Ergebnis wird vorgehalten", () => {
  for (const ergebnis of ["gruen", "rot"]) {
    assert.equal(faelligeAbfrage({ commit: SHA, ergebnis, abgefragtUm: 0 }, SHA, 10 * 3600_000), false);
  }
});

test("[1129] faelligeAbfrage: laeuft der Job noch, frühestens nach zwei Minuten erneut", () => {
  const vorrat = { commit: SHA, ergebnis: "laeuft", abgefragtUm: 1_000_000 };
  assert.equal(faelligeAbfrage(vorrat, SHA, 1_000_000 + 119_999), false);
  assert.equal(faelligeAbfrage(vorrat, SHA, 1_000_000 + 120_000), true);
});

test("[1129] faelligeAbfrage: nach einem Abfragefehler gilt dieselbe Sperre", () => {
  const vorrat = { commit: SHA, ergebnis: null, abgefragtUm: 0 };
  assert.equal(faelligeAbfrage(vorrat, SHA, 60_000), false);
  assert.equal(faelligeAbfrage(vorrat, SHA, 120_000), true);
});

// ---- meldungFuer ------------------------------------------------------------

test("[1129] meldungFuer: Rot meldet einmal je Sitzung", () => {
  const rot = { commit: SHA, ergebnis: "rot", abgefragtUm: 0, gemeldet: [] };
  const erst = meldungFuer(rot, { session: "s1", ereignis: "UserPromptSubmit" });
  assert.match(erst.meldung, /^Windows-Prüfung rot für 0123456 \(`check \(windows-latest\)`\), siehe `gh run list --commit 0123456789abcdef0123456789abcdef01234567`$/);
  assert.deepEqual(erst.vorrat.gemeldet, ["s1"]);
  const zweit = meldungFuer(erst.vorrat, { session: "s1", ereignis: "UserPromptSubmit" });
  assert.equal(zweit.meldung, null);
  assert.notEqual(meldungFuer(zweit.vorrat, { session: "s2", ereignis: "UserPromptSubmit" }).meldung, null);
});

test("[1129] meldungFuer: bei SessionStart erneut, solange rot", () => {
  const rot = { commit: SHA, ergebnis: "rot", abgefragtUm: 0, gemeldet: ["s1"] };
  assert.notEqual(meldungFuer(rot, { session: "s1", ereignis: "SessionStart" }).meldung, null);
});

test("[1129] meldungFuer: Grün, laeuft und Abfragefehler schweigen", () => {
  for (const ergebnis of ["gruen", "laeuft", null]) {
    const r = meldungFuer({ commit: SHA, ergebnis, abgefragtUm: 0, gemeldet: [] }, { session: "s1", ereignis: "SessionStart" });
    assert.equal(r.meldung, null, `ergebnis ${ergebnis}`);
  }
});

// ---- der Hook als Kindprozess -----------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Wegwerf-Repository mit `origin/main` und einem Fake fuer `code ci-status`. */
function mitRepo(fakeQuelle, fn) {
  const wurzel = mkdtempSync(join(tmpdir(), "windows-pruefung-"));
  try {
    git(wurzel, "init", "-q");
    git(wurzel, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
    git(wurzel, "update-ref", "refs/remotes/origin/main", "HEAD");
    const sha = git(wurzel, "rev-parse", "origin/main");
    const fake = join(wurzel, "fake-ci.mjs");
    const zaehler = join(wurzel, "aufrufe.txt");
    writeFileSync(fake, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(zaehler)}, process.argv.slice(2).join(" ") + "\\n");\n${fakeQuelle}\n`);
    const aufrufe = () => (existsSync(zaehler) ? readFileSync(zaehler, "utf8").split("\n").filter(Boolean) : []);
    return fn({ wurzel, sha, fake, aufrufe, vorrat: join(wurzel, ".claude", "windows-pruefung.json") });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
}

function hook({ wurzel, fake }, ereignis, session) {
  const eingabe = JSON.stringify({ session_id: session, hook_event_name: ereignis, cwd: wurzel });
  const r = spawnSync(process.execPath, [werkzeug, "--hook"], {
    cwd: wurzel,
    input: eingabe,
    encoding: "utf8",
    env: { ...process.env, WINDOWS_PRUEFUNG_CI_CMD: fake },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `Exit ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const antwort = (jobs) => `process.stdout.write(${JSON.stringify(JSON.stringify(status(...jobs)))});`;

test("[1129] Hook: Rot meldet einmal je Sitzung und erneut bei SessionStart", () => {
  mitRepo(antwort([[JOB, "rot"]]), (ctx) => {
    const erst = hook(ctx, "SessionStart", "s1");
    const meldung = JSON.parse(erst).systemMessage;
    assert.equal(meldung, `Windows-Prüfung rot für ${ctx.sha.slice(0, 7)} (\`${JOB}\`), siehe \`gh run list --commit ${ctx.sha}\``);
    assert.equal(hook(ctx, "UserPromptSubmit", "s1"), "");
    assert.notEqual(hook(ctx, "SessionStart", "s1"), "");
    assert.notEqual(hook(ctx, "UserPromptSubmit", "s2"), "");
    assert.deepEqual(ctx.aufrufe(), [`code ci-status --commit ${ctx.sha}`], "der Vorrat haelt das rote Ergebnis");
  });
});

test("[1129] Hook: Grün schweigt und wird vorgehalten", () => {
  mitRepo(antwort([[JOB, "gruen"]]), (ctx) => {
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
    assert.equal(hook(ctx, "UserPromptSubmit", "s1"), "");
    assert.equal(ctx.aufrufe().length, 1);
    assert.equal(JSON.parse(readFileSync(ctx.vorrat, "utf8")).ergebnis, "gruen");
  });
});

test("[1129] Hook: laeuft schweigt, die Zwei-Minuten-Sperre haelt die naechste Abfrage zurueck", () => {
  mitRepo(antwort([[JOB, "laeuft"]]), (ctx) => {
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
    assert.equal(hook(ctx, "UserPromptSubmit", "s1"), "");
    assert.equal(ctx.aufrufe().length, 1);
  });
});

test("[1129] Hook: ein roter anderer Job bleibt still", () => {
  mitRepo(antwort([[JOB, "gruen"], ["sonarqube", "rot"]]), (ctx) => {
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
  });
});

test("[1129] Hook: Exit ungleich 0 und unlesbares JSON schweigen", () => {
  mitRepo(`process.stdout.write("{}"); process.exit(1);`, (ctx) => {
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
  });
  mitRepo(`process.stdout.write("kein json");`, (ctx) => {
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
  });
});

test("[1129] Hook: ohne origin/main und ohne lesbare Eingabe schweigt er mit Exit 0", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "windows-pruefung-leer-"));
  try {
    const r = spawnSync(process.execPath, [werkzeug, "--hook"], { cwd: wurzel, input: "kaputt", encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[1129] Hook: eine haengende Abfrage wird nach fuenf Sekunden abgebrochen, der Hook schweigt", () => {
  mitRepo(`setInterval(() => {}, 1000);`, (ctx) => {
    const start = Date.now();
    assert.equal(hook(ctx, "SessionStart", "s1"), "");
    const dauer = Date.now() - start;
    assert.ok(dauer >= 4_500, `zu frueh beendet: ${dauer} ms`);
    assert.ok(dauer < 20_000, `nicht abgebrochen: ${dauer} ms`);
  });
});
