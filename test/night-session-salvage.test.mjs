// Die Vorpruefung des Salvage (Issue #167, #168, #169, #919).
//
// Endet eine Runde ohne Board-Ergebnis, aber mit Arbeit im Baum, faehrt der Runner die
// Pflicht-Pruefungen selbst — ueber `checks.mjs run --abschluss <karte> --frisch`, damit
// derselbe Nachweis entsteht, den das Commit-Gate liest (Issue #919). Sind sie rot und ist
// ein `formatFixCommand` gesetzt, laeuft er genau einmal, und die Pruefungen laufen genau
// einmal nach (Issue #169). Die Umgebung bekommt den env-Block aus `.claude/settings.json`
// und `.claude/settings.local.json` dazu, wie Claude Code ihn seinen Bash-Aufrufen gibt
// (Issue #168).
//
// Im selben Prozess (Issue #1229, Plan #1199, E6): `verifyChecksForSalvage` bekommt ein
// `spawnSync`, das jeden Aufruf mitschreibt und ein vorgegebenes Ergebnis liefert. Wie der
// Runner die Rettung danach anordnet, pruefen die Ablauf-Pruefungen in
// test/ablauf-night-session-salvage.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CHECKS_PATH } from "../kit/night/grundlagen.mjs";
import { settingsEnv, verifyChecksForSalvage, salvagePrompt } from "../kit/night/session.mjs";
import { stdoutFangen } from "./helpers/session-attrappe.mjs";

/** Ein Projektverzeichnis mit den genannten settings-Dateien; `fn` laeuft darin. */
async function imProjekt(dateien, fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-salvage-"));
  const vorher = process.cwd();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(dir, ".claude", name), inhalt);
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(vorher);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ein `spawnSync`, das jeden Aufruf mitschreibt. `checks` liefert der Reihe nach die
 * Exitcodes von `checks.mjs run`; ein Aufruf ueber die Shell (der Format-Fix) endet mit 0.
 */
function aufrufAttrappe(checks) {
  const aufrufe = [];
  const spawnSync = (befehl, args, optionen) => {
    const checksLauf = args[0] === CHECKS_PATH;
    aufrufe.push({ art: checksLauf ? "checks" : "shell", befehl, args, env: optionen.env });
    if (!checksLauf) return { status: 0, stdout: "", stderr: "" };
    const status = checks.shift();
    return { status, stdout: status === 0 ? "alles gruen\n" : "rot: mvn verify\n", stderr: "" };
  };
  return { spawnSync, aufrufe };
}

const json = (wert) => JSON.stringify(wert);

// --- settingsEnv (Issue #168) ------------------------------------------------------

test("settingsEnv: der env-Block aus .claude/settings.json kommt in die Umgebung", async () => {
  await imProjekt({ "settings.json": json({ env: { NIGHT_TEST_ENV_VAR: "hello-from-settings" } }) }, (dir) => {
    assert.deepEqual(settingsEnv(dir), { NIGHT_TEST_ENV_VAR: "hello-from-settings" });
  });
});

test("settingsEnv: der env-Block aus .claude/settings.local.json kommt ebenfalls hinein", async () => {
  // settings.local.json ist gitignored und damit der uebliche Ort fuer
  // maschinenspezifische Werte (z. B. ein Colima-Socket-Pfad). Claude Code liest
  // beide Dateien — die Vorpruefung muss das auch tun (Issue #168).
  await imProjekt({ "settings.local.json": json({ env: { NIGHT_TEST_ENV_VAR: "from-local" } }) }, (dir) => {
    assert.deepEqual(settingsEnv(dir), { NIGHT_TEST_ENV_VAR: "from-local" });
  });
});

test("settingsEnv: settings.local.json gewinnt gegen settings.json (gleiche Precedence wie Claude Code)", async () => {
  await imProjekt({
    "settings.json": json({ env: { NIGHT_TEST_ENV_VAR: "from-shared", NUR_GETEILT: "ja" } }),
    "settings.local.json": json({ env: { NIGHT_TEST_ENV_VAR: "from-local" } }),
  }, (dir) => {
    assert.deepEqual(settingsEnv(dir), { NIGHT_TEST_ENV_VAR: "from-local", NUR_GETEILT: "ja" });
  });
});

test("settingsEnv: kaputtes JSON und ein fehlender env-Block lassen nur ihre Quelle ausfallen", async () => {
  await imProjekt({
    "settings.json": "{ kaputt",
    "settings.local.json": json({ permissions: {} }),
  }, (dir) => {
    assert.deepEqual(settingsEnv(dir), {});
  });
});

// --- verifyChecksForSalvage (Issue #919) ---------------------------------------------

test("Vorpruefung: faehrt checks.mjs run --abschluss <karte> --frisch, mit dem env-Block aus den settings", async () => {
  await imProjekt({ "settings.json": json({ env: { NIGHT_TEST_ENV_VAR: "hello-from-settings" } }) }, () => {
    const { spawnSync, aufrufe } = aufrufAttrappe([0]);
    const ergebnis = verifyChecksForSalvage({}, 7, { spawnSync });

    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.formatFixCmd, null);
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].befehl, process.execPath);
    assert.deepEqual(aufrufe[0].args, [CHECKS_PATH, "run", "--abschluss", "7", "--frisch"]);
    assert.equal(aufrufe[0].env.NIGHT_TEST_ENV_VAR, "hello-from-settings",
      "die Vorpruefung erbt nicht nur process.env, sie mergt den env-Block (kanban-kit #445)");
    assert.ok(ergebnis.output.startsWith(`$ node ${CHECKS_PATH} run --abschluss 7 --frisch\nalles gruen`), ergebnis.output);
  });
});

test("Vorpruefung: rote Pruefungen ohne formatFixCommand — kein Fix, das rote Kommando kommt aus dem Nachweis", async () => {
  const nachweis = json({ laufen: [{ cmd: "true", ergebnis: "gruen" }, { cmd: "mvn verify", ergebnis: "rot" }], ausgelassen: [] });
  await imProjekt({ "checks-summary.json": nachweis }, async () => {
    const { spawnSync, aufrufe } = aufrufAttrappe([1]);
    const { ergebnis, text } = await stdoutFangen(() => verifyChecksForSalvage({}, 7, { spawnSync }));

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.rotesKommando, "mvn verify");
    assert.deepEqual(aufrufe.map((a) => a.art), ["checks"], "ohne formatFixCommand laeuft nur die Vorpruefung");
    assert.doesNotMatch(text, /FORMAT-FIX/);
  });
});

// --- Format-Fix (Issue #169) ---
//
// Beobachtet bei kanban-kit#463: ein einzelner Javadoc-Zeilenumbruch liess
// Spotless rot laufen und stoppte damit einen ganzen Nachtlauf, obwohl die
// Arbeit vollstaendig war. Ein Formatverstoss ist mechanisch und deterministisch
// behebbar und sagt nichts ueber die fachliche Qualitaet.

test("Format-Fix: erst rote, nach dem Format-Kommando gruene Pruefungen — die Rettung darf beginnen", async () => {
  await imProjekt({}, async () => {
    const { spawnSync, aufrufe } = aufrufAttrappe([1, 0]);
    const { ergebnis, text } = await stdoutFangen(() =>
      verifyChecksForSalvage({ formatFixCommand: "  touch fixed.marker " }, 7, { spawnSync }));

    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.formatFixCmd, "touch fixed.marker", "der Salvage-Prompt nennt das Format-Kommando");
    assert.deepEqual(aufrufe.map((a) => a.art), ["checks", "shell", "checks"]);
    assert.ok(aufrufe[1].args.includes("touch fixed.marker"), `der Fix laeuft ueber die Shell: ${aufrufe[1].args.join(" ")}`);
    assert.match(text, /buildChecks rot — einmaliger Format-Fix wird angewendet: touch fixed\.marker/);
    assert.match(text, /FORMAT-FIX angewendet, buildChecks jetzt gruen/, "der angewendete Format-Fix muss im Protokoll sichtbar sein");
    assert.match(ergebnis.output, /alles gruen/, "die Ausgabe ist die des zweiten Durchgangs");
  });
});

test("Format-Fix: hilft er nicht, bleibt die Vorpruefung rot — und er lief genau einmal", async () => {
  await imProjekt({}, async () => {
    const { spawnSync, aufrufe } = aufrufAttrappe([1, 1]);
    const { ergebnis, text } = await stdoutFangen(() =>
      verifyChecksForSalvage({ formatFixCommand: "echo lauf >> fixcount.log" }, 7, { spawnSync }));

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.formatFixCmd, null);
    assert.deepEqual(aufrufe.map((a) => a.art), ["checks", "shell", "checks"], "keine Schleife, genau ein Versuch");
    assert.doesNotMatch(text, /FORMAT-FIX angewendet/, "der Fix hat nicht geholfen, darf also nicht als erfolgreich gemeldet werden");
  });
});

// --- Der Salvage-Prompt (Issue #672) ---------------------------------------------------

test("[night-27] der Salvage-Prompt verlangt `git status --porcelain` vor dem Board-Zug", () => {
  const prompt = salvagePrompt("7", "$ node checks.mjs run\nalles gruen", null);
  const pruefung = prompt.indexOf("git status --porcelain");
  const zug = prompt.indexOf("issue move");
  assert.ok(pruefung >= 0, `der Prompt verlangt keine Sauberkeitspruefung:\n${prompt}`);
  assert.ok(zug >= 0, `der Prompt nennt den Board-Zug nicht:\n${prompt}`);
  assert.ok(pruefung < zug,
    `die Sauberkeitspruefung steht hinter dem Board-Zug — genau die Reihenfolge, die #248 gekostet hat:\n${prompt}`);
});

// Issue #1287 (Plan #1283 A2): Zieht der Zug des Pakets Plan und Anforderung nach, nennt die
// Ausgabe von `issue move` das Feld `ursprung` — und der Kommentar der Rettung traegt es.
test("[ursprung] der Salvage-Prompt verlangt nach dem Board-Zug die Zeilen aus `ursprung` im Kommentar", () => {
  const prompt = salvagePrompt("7", "alles gruen", null);
  const zug = prompt.indexOf("issue move 7 in_review");
  const ursprung = prompt.indexOf("Feld `ursprung`");
  assert.ok(zug >= 0 && ursprung > zug, `der Satz zu ursprung fehlt oder steht vor dem Zug:\n${prompt}`);
  assert.ok(ursprung < prompt.indexOf("   d)"), `der Satz steht nicht im Schritt c):\n${prompt}`);
  const satz = prompt.slice(ursprung).split("\n").slice(0, 2).join(" ");
  assert.ok(satz.includes("Kommentar"), `die Zeilen gehoeren in den Kommentar:\n${satz}`);
});

test("der Salvage-Prompt zitiert die letzten Zeilen der Vorpruefung und nennt einen angewendeten Format-Fix", () => {
  const ausgabe = Array.from({ length: 20 }, (_, i) => `zeile ${i + 1}`).join("\n");
  const prompt = salvagePrompt("7", ausgabe, "npm run format");
  assert.match(prompt, /checks\.mjs run --abschluss 7 --frisch/);
  assert.match(prompt, /zeile 6\nzeile 7/, "die letzten 15 Zeilen stehen im Prompt");
  assert.doesNotMatch(prompt, /zeile 5\n/, "aeltere Zeilen fallen weg");
  assert.match(prompt, /"npm run format"/, "die Formatierungsaenderungen gehoeren mit in den Commit");
  assert.doesNotMatch(salvagePrompt("7", ausgabe, null), /Format-Kommando/);
});
