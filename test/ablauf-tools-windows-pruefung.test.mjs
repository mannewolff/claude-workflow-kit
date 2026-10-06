// Ablauf-Pruefung: drei Faelle pruefen die Kommandozeile der Windows-Rueckmeldung mit Ausgabe und Exitcode.
//
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
import { STARTGRENZE_MS, exitCodeFuer, faelligeAbfrage, fristUeberschritten, meldungFuer, urteilFuer, vorab } from "../tools/windows-pruefung.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

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
    lfAttribute(join(wurzel, ".gitattributes"));
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

// ---- --vorab: Warten auf die Windows-Pruefung vor dem Push (Issue #1153, Plan #1150) --
//
// Der Ablauf laeuft in-process mit ersetzten Abhaengigkeiten: Die Uhr ist eine Variable,
// und `warte` rueckt sie vor, statt echte Minuten zu warten. Die Verdrahtung der
// Umgebungs-Hooks belegen zwei Kindprozesse, die ohne Warten enden.

const MIN = 60_000;
const job = (ergebnis, gestartet = null) => ({ status: "egal", jobs: [{ name: JOB, ergebnis, gestartet }] });

/** Abhaengigkeiten fuer `vorab`: `antworten` liefert je Abfrage den Status (oder null). */
function fakes(antworten, { pushAntworten = [] } = {}) {
  const t = { jetzt: 1_000_000_000_000 };
  const pushes = [];
  const gewartet = [];
  const zeilen = [];
  let abfrage = 0;
  const deps = {
    revParse: () => SHA,
    frageCiStatus: (sha) => {
      assert.equal(sha, SHA);
      const a = typeof antworten === "function" ? antworten(abfrage, t.jetzt) : antworten[Math.min(abfrage, antworten.length - 1)];
      abfrage += 1;
      return a;
    },
    push: (args) => {
      pushes.push(args);
      return pushAntworten[pushes.length - 1] ?? { ok: true, stderr: "" };
    },
    jetzt: () => t.jetzt,
    warte: async (ms) => {
      gewartet.push(ms);
      t.jetzt += ms;
    },
    ausgabe: (zeile) => zeilen.push(zeile),
  };
  return { deps, t, pushes, gewartet, zeilen, abfragen: () => abfrage };
}

test("[1153] fristUeberschritten: Startgrenze ab dem Vorab-Push, solange der Job nicht gestartet ist", () => {
  assert.equal(STARTGRENZE_MS, 15 * MIN);
  assert.equal(fristUeberschritten({ pushUm: 0, gestartet: null, jetzt: 15 * MIN - 1 }), null);
  assert.match(fristUeberschritten({ pushUm: 0, gestartet: null, jetzt: 15 * MIN }), /Startgrenze/);
});

test("[1153] fristUeberschritten: 30 Minuten ab dem Start des Jobs, nicht ab dem Push", () => {
  const start = new Date(40 * MIN).toISOString();
  assert.equal(fristUeberschritten({ pushUm: 0, gestartet: start, jetzt: 70 * MIN - 1 }), null);
  assert.match(fristUeberschritten({ pushUm: 0, gestartet: start, jetzt: 70 * MIN }), /30 Minuten/);
});

test("[1153] vorab grün: Push, Abfrage alle 30 s mit Fortschrittszeile, Exit 0", async () => {
  const f = fakes([status(), job("laeuft", null), job("laeuft", "2026-10-04T12:00:00Z"), job("gruen", "2026-10-04T12:00:00Z")]);
  const r = await vorab(f.deps);
  assert.deepEqual(r, { ergebnis: "gruen", commit: SHA, grund: r.grund });
  assert.equal(exitCodeFuer(r.ergebnis), 0);
  assert.deepEqual(f.gewartet, [30_000, 30_000, 30_000]);
  assert.equal(f.pushes.length, 2);
  assert.equal(f.zeilen.filter((z) => /Abfrage \d/.test(z)).length, 3, f.zeilen.join("\n"));
});

test("[1153] vorab rot: Urteil rot, Exit 1; ein roter anderer Job zaehlt nicht", async () => {
  const anderer = { status: "rot", jobs: [{ name: "sonarqube", ergebnis: "rot", gestartet: null }] };
  const f = fakes([anderer, anderer, job("rot", "2026-10-04T12:00:00Z")]);
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "rot");
  assert.equal(r.commit, SHA);
  assert.equal(exitCodeFuer(r.ergebnis), 1);
  assert.equal(f.pushes.length, 2, "ein roter anderer Job ist kein Endurteil");
});

test("[1153] vorab: Frist 30 Minuten nach dem Start ueberschritten, kein verwertbares Ergebnis, Exit 2", async () => {
  // Ab der dritten Abfrage meldet der Job seinen Start, zwei Minuten nach dem Push.
  const gestartetAb = (n) => (n >= 3 ? new Date(f.t0 + 2 * MIN).toISOString() : null);
  const f = fakes((n) => (n === 0 ? status() : job("laeuft", gestartetAb(n))));
  f.t0 = f.t.jetzt;
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "kein-ergebnis");
  assert.match(r.grund, /30 Minuten/);
  assert.equal(exitCodeFuer(r.ergebnis), 2);
  const vergangen = f.t.jetzt - (f.t0 + 2 * MIN);
  assert.ok(vergangen >= 30 * MIN && vergangen < 30 * MIN + 30_000, `beendet nach ${vergangen} ms ab Start`);
});

test("[1153] vorab: der Job startet nicht innerhalb der Startgrenze, kein verwertbares Ergebnis", async () => {
  const f = fakes([status(), job("laeuft", null)]);
  const t0 = f.t.jetzt;
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "kein-ergebnis");
  assert.match(r.grund, /Startgrenze/);
  const vergangen = f.t.jetzt - t0;
  assert.ok(vergangen >= STARTGRENZE_MS && vergangen < STARTGRENZE_MS + 30_000, `beendet nach ${vergangen} ms`);
});

test("[1153] vorab: eine dauerhaft scheiternde Abfrage endet ohne verwertbares Ergebnis", async () => {
  const f = fakes([null]);
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "kein-ergebnis");
  assert.match(r.grund, /Abfrage/);
  assert.equal(f.pushes.length, 2, "ohne erste Antwort liegt kein Endurteil vor, also wird gepusht");
  assert.ok(f.t.jetzt - 1_000_000_000_000 < STARTGRENZE_MS, "endet vor der Startgrenze");
});

test("[1153] vorab: ein vorliegendes Endurteil wird ohne Push und ohne Warten uebernommen", async () => {
  for (const ergebnis of ["gruen", "rot"]) {
    const f = fakes([job(ergebnis, "2026-10-04T12:00:00Z")]);
    const r = await vorab(f.deps);
    assert.equal(r.ergebnis, ergebnis);
    assert.deepEqual(f.pushes, [], "der Push-Hook wird nicht aufgerufen");
    assert.deepEqual(f.gewartet, []);
    assert.equal(f.abfragen(), 1);
  }
});

test("[1153] vorab: Push-Folge ist Loeschen, dann Anlegen, ohne +; ein fehlender Zweig ist kein Fehler", async () => {
  const f = fakes([status(), job("gruen", "2026-10-04T12:00:00Z")], {
    pushAntworten: [{ ok: false, stderr: "error: unable to delete 'windows-vorab': remote ref does not exist" }],
  });
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "gruen");
  assert.deepEqual(f.pushes, [
    ["push", "origin", "--delete", "windows-vorab"],
    ["push", "origin", "HEAD:refs/heads/windows-vorab"],
  ]);
  assert.ok(f.pushes.flat().every((a) => !a.includes("+")), "kein Force-Push");
});

test("[1153] vorab: ein gescheiterter Push ist kein verwertbares Ergebnis, ohne Warten", async () => {
  const f = fakes([status()], { pushAntworten: [{ ok: true, stderr: "" }, { ok: false, stderr: "rejected" }] });
  const r = await vorab(f.deps);
  assert.equal(r.ergebnis, "kein-ergebnis");
  assert.match(r.grund, /Push/);
  assert.deepEqual(f.gewartet, []);
});

/** Kindprozess `--vorab` mit Fakes fuer CI und Push; endet ohne Warten. */
function vorabProzess(ciQuelle, pushQuelle) {
  return mitRepo(ciQuelle, (ctx) => {
    const pushFake = join(ctx.wurzel, "fake-push.mjs");
    const pushLog = join(ctx.wurzel, "pushes.txt");
    writeFileSync(pushFake, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(pushLog)}, process.argv.slice(2).join(" ") + "\\n");\n${pushQuelle}\n`);
    const r = spawnSync(process.execPath, [werkzeug, "--vorab"], {
      cwd: ctx.wurzel,
      encoding: "utf8",
      env: { ...process.env, WINDOWS_PRUEFUNG_CI_CMD: ctx.fake, WINDOWS_PRUEFUNG_PUSH_CMD: pushFake },
      timeout: 30_000,
    });
    const pushes = existsSync(pushLog) ? readFileSync(pushLog, "utf8").split("\n").filter(Boolean) : [];
    const sha = git(ctx.wurzel, "rev-parse", "HEAD");
    return { r, pushes, sha, aufrufe: ctx.aufrufe() };
  });
}

test("[1153] Kindprozess --vorab: vorliegendes Grün, Exit 0, Schlusszeile und JSON, kein Push", () => {
  const { r, pushes, sha, aufrufe } = vorabProzess(antwort([[JOB, "gruen"]]), "");
  assert.equal(r.status, 0, r.stderr);
  const zeilen = r.stdout.trim().split("\n");
  assert.deepEqual(JSON.parse(zeilen.at(-1)), { ergebnis: "gruen", commit: sha, grund: JSON.parse(zeilen.at(-1)).grund });
  assert.match(zeilen.at(-2), /grün/);
  assert.deepEqual(pushes, []);
  assert.deepEqual(aufrufe, [`code ci-status --commit ${sha}`]);
});

test("[1153] Kindprozess --vorab: gescheiterter Push, Exit 2, Push-Folge ueber den Hook", () => {
  const { r, pushes, sha } = vorabProzess(antwort([[JOB, "laeuft"]]), `if (process.argv.includes("--delete")) process.exit(0); process.stderr.write("rejected"); process.exit(1);`);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim().split("\n").at(-1)).ergebnis, "kein-ergebnis");
  assert.equal(JSON.parse(r.stdout.trim().split("\n").at(-1)).commit, sha);
  assert.deepEqual(pushes, ["push origin --delete windows-vorab", "push origin HEAD:refs/heads/windows-vorab"]);
});

test("[1171] Kindprozess --vorab: git laeuft mit LC_ALL=C, ein fehlender Zweig ist auch bei deutschem git harmlos", () => {
  const meldung = `if (process.argv.includes("--delete")) { process.stderr.write(process.env.LC_ALL === "C" ? "error: unable to delete 'windows-vorab': remote ref does not exist" : "Fehler: Konnte 'windows-vorab' nicht löschen: Remote-Referenz existiert nicht."); process.exit(1); } process.stderr.write("rejected"); process.exit(1);`;
  const { r, pushes } = vorabProzess(antwort([[JOB, "laeuft"]]), meldung);
  const ergebnis = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.match(ergebnis.grund, /nicht anlegen/, ergebnis.grund);
  assert.deepEqual(pushes, ["push origin --delete windows-vorab", "push origin HEAD:refs/heads/windows-vorab"]);
});

test("[1171] Kindprozess --vorab: ein anderer Loeschfehler bleibt ein Fehler", () => {
  const { r, pushes } = vorabProzess(antwort([[JOB, "laeuft"]]), `process.stderr.write("ERROR: Permission to repo denied"); process.exit(1);`);
  assert.equal(r.status, 2, r.stderr);
  const ergebnis = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.match(ergebnis.grund, /nicht loeschen: ERROR: Permission to repo denied/);
  assert.deepEqual(pushes, ["push origin --delete windows-vorab"]);
});
