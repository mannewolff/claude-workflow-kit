// Die Zeiten je Einheit (Issue #749, Plan #745, E1/E2).
//
// Nachdenken ist `apiDauerMs` der Session, Werkzeugarbeit kommt vom Beobachter aus
// Issue #748, der Rest ist die Session-Dauer selbst — die Begriffe stammen aus Issue #737.
//
// Drei Ebenen werden geprueft: `zeitenBauen()` ist die reine Feldkonstruktion (wie
// `verbrauchAddieren`), `zeitenAddieren()` die reine Summe zweier Sessions (wie
// `kennzahlenAddieren`), beide direkt an Fixtures pruefbar. Das Schreiben auf die Einheit
// (`zeitenErfassen`, privat) ist E2E geprueft, wie `verbrauchErfassen` in
// night-ergebnisstand.test.mjs — mit demselben `findLast`-Ziel-Muster: Ein zweiter
// Aufruf fuer dieselbe Karte (Salvage) trifft dieselbe, juengste Einheit und addiert
// seine Zeiten zu denen der ersten (Issue #820).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { zeitenBauen, zeitenAddieren } from "../kit/night.mjs";

// ============================================================
// zeitenBauen — reine Feldkonstruktion
// ============================================================

test("[night-51] der Regelfall: nachdenkenMs aus apiDauerMs, werkzeugMs/werkzeugSchuebe/nebenlaeufigeSchuebe vom Beobachter, dauerMs durchgereicht", () => {
  const kennzahlen = { apiDauerMs: 296247, kostenUsd: 1 };
  const werkzeug = { werkzeugMs: 1234, schuebe: 3, nebenlaeufigeSchuebe: 1, offeneSchuebe: 0 };
  assert.deepEqual(zeitenBauen(50000, kennzahlen, werkzeug), {
    dauerMs: 50000,
    nachdenkenMs: 296247,
    werkzeugMs: 1234,
    werkzeugSchuebe: 3,
    nebenlaeufigeSchuebe: 1,
    offeneSchuebe: 0,
  });
});

test("[night-51] ein Schub ohne Ergebnis: werkzeugMs wird null, offeneSchuebe traegt die Zahl", () => {
  const kennzahlen = { apiDauerMs: 8000 };
  // Der Beobachter meldet die Spanne der abgeschlossenen Schuebe mit; sie ist unvollstaendig,
  // solange ein Schub ohne tool_result geblieben ist. Als Zahl gaebe sie sich als Messung aus.
  const werkzeug = { werkzeugMs: 1234, schuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 1 };
  assert.deepEqual(zeitenBauen(50000, kennzahlen, werkzeug), {
    dauerMs: 50000,
    nachdenkenMs: 8000,
    werkzeugMs: null,
    werkzeugSchuebe: 2,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 1,
  });
});

test("[night-51] keine Kennzahlen: nachdenkenMs bleibt null, die anderen Felder bleiben", () => {
  const werkzeug = { werkzeugMs: 500, schuebe: 1, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const z = zeitenBauen(10000, null, werkzeug);
  assert.equal(z.nachdenkenMs, null);
  assert.equal(z.werkzeugMs, 500);
  assert.equal(z.werkzeugSchuebe, 1);
  assert.equal(z.nebenlaeufigeSchuebe, 0);
  assert.equal(z.offeneSchuebe, 0);
  assert.equal(z.dauerMs, 10000);
});

test("[night-51] kein Beobachter-Ergebnis: werkzeugMs, werkzeugSchuebe, nebenlaeufigeSchuebe und offeneSchuebe bleiben null", () => {
  const kennzahlen = { apiDauerMs: 8000 };
  const z = zeitenBauen(10000, kennzahlen, null);
  assert.equal(z.nachdenkenMs, 8000);
  assert.equal(z.werkzeugMs, null);
  assert.equal(z.werkzeugSchuebe, null);
  assert.equal(z.nebenlaeufigeSchuebe, null);
  assert.equal(z.offeneSchuebe, null);
  assert.equal(z.dauerMs, 10000);
});

test("[night-51] beides fehlt: nur dauerMs bleibt eine Zahl, der Rest ist null — nie 0", () => {
  const z = zeitenBauen(5000, null, null);
  assert.deepEqual(z, {
    dauerMs: 5000, nachdenkenMs: null, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: null, offeneSchuebe: null,
  });
});

test("[night-51] eine 0 bleibt eine 0, kein `|| null`", () => {
  const kennzahlen = { apiDauerMs: 0 };
  const werkzeug = { werkzeugMs: 0, schuebe: 0, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenBauen(0, kennzahlen, werkzeug), {
    dauerMs: 0, nachdenkenMs: 0, werkzeugMs: 0, werkzeugSchuebe: 0, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0,
  });
});

// ============================================================
// zeitenAddieren — reine Summe zweier Sessions derselben Einheit
// ============================================================

test("[night-51] zwei vollstaendig gemessene Sessions: jedes Feld ist die Summe", () => {
  const runde = { dauerMs: 3_600_000, nachdenkenMs: 1000, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 1, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: 600, werkzeugSchuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: 10_000,
    werkzeugMs: 1000,
    werkzeugSchuebe: 5,
    nebenlaeufigeSchuebe: 1,
    offeneSchuebe: 0,
  });
});

test("[night-51] ein offener Schub auf einer Seite: die Schuebe summieren sich, die Werkzeugzeit der Einheit bleibt null", () => {
  // So kommt es aus `zeitenBauen`: Wer offene Schuebe hat, hat schon dort werkzeugMs null.
  const runde = { dauerMs: 3_600_000, nachdenkenMs: 1000, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: null, werkzeugSchuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 1 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: 10_000,
    werkzeugMs: null,
    werkzeugSchuebe: 5,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 1,
  });
});

test("[night-51] eine unvollstaendige Messung auf einer Seite macht die Summe null, nie die andere Zahl", () => {
  const runde = { dauerMs: 3_600_000, nachdenkenMs: null, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: null,
    werkzeugMs: null,
    werkzeugSchuebe: null,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 0,
  });
});

// ============================================================
// zeitenErfassen — E2E: Einheit, Ziel und Ueberschreiben
// ============================================================

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, buildChecks = ["true"]) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

function einheit(dir, id) {
  const s = stand(dir);
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";

const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"total_cost_usd":2.4124460000000005,"usage":{"input_tokens":70,"output_tokens":17688},' +
  '"result":"Abschlussbericht gekuerzt.","type":"result"}';
const RESULT_AUSGEBEN = `echo '${RESULT_ZEILE}'`;

// Ein Schub mit einem tool_use und seinem tool_result: eine messbare Spanne dazwischen.
const SCHUB = [
  `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"true"}}]}}'`,
  "sleep 0.05",
  `echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'`,
].join("\n");

test("[night-51] nach einer Session mit Kennzahlen und Beobachter-Ergebnis traegt die Einheit zeiten mit allen sechs Feldern", NUR_POSIX, () => {
  const dir = setupProjekt("night-zeiten-regel-");
  try {
    const id = readyIssue(dir, "Volle Zeiten");
    const fake = [SCHUB, RESULT_AUSGEBEN, SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const z = einheit(dir, id).zeiten;
    assert.ok(z, "die Einheit traegt kein zeiten-Feld");
    assert.deepEqual(Object.keys(z).sort(), ["dauerMs", "nachdenkenMs", "nebenlaeufigeSchuebe", "offeneSchuebe", "werkzeugMs", "werkzeugSchuebe"]);
    assert.equal(z.nachdenkenMs, 296247, "nachdenkenMs ist apiDauerMs der Session");
    assert.ok(typeof z.dauerMs === "number" && z.dauerMs > 0, `dauerMs muss eine positive Zahl sein: ${z.dauerMs}`);
    assert.ok(typeof z.werkzeugMs === "number" && z.werkzeugMs > 0, `werkzeugMs haette gemessen sein muessen: ${z.werkzeugMs}`);
    assert.equal(z.werkzeugSchuebe, 1);
    assert.equal(z.nebenlaeufigeSchuebe, 0);
    assert.equal(z.offeneSchuebe, 0, "jeder Schub hat sein tool_result bekommen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-51] keine Kennzahlen: nachdenkenMs bleibt null, Werkzeugzeit und Dauer bleiben gemessen", NUR_POSIX, () => {
  const dir = setupProjekt("night-zeiten-ohne-kennzahlen-");
  try {
    const id = readyIssue(dir, "Ohne Kennzahlen");
    // Kein result-Ereignis: leseKennzahlen() liefert null.
    const fake = [SCHUB, SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const z = einheit(dir, id).zeiten;
    assert.equal(z.nachdenkenMs, null, "ohne result-Ereignis bleibt nachdenkenMs null, nicht 0");
    assert.ok(typeof z.werkzeugMs === "number" && z.werkzeugMs > 0, "die Werkzeugzeit bleibt gemessen");
    assert.ok(typeof z.dauerMs === "number" && z.dauerMs > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-51] Session ohne Karte (Vorflug) schreibt keine zeiten in irgendeine Einheit — genau eine Einheit im Stand", NUR_POSIX, () => {
  const dir = setupProjekt("night-zeiten-ohne-karte-");
  try {
    const id = readyIssue(dir, "Regulaeres Paket");
    const fake = [SCHUB, RESULT_AUSGEBEN, SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    // Der Implementierungslauf faehrt keinen Vorflug (der ist der Kette vorbehalten) —
    // dieser Test belegt darum, dass genau eine Einheit im Stand steht: die des
    // bearbeiteten Pakets, keine zusaetzliche fuer eine Session ohne Karte.
    const s = stand(dir);
    assert.equal(s.einheiten.length, 1, `nur die eine Einheit des Pakets erwartet: ${JSON.stringify(s.einheiten)}`);
    assert.equal(s.einheiten[0].id, id);
    assert.ok(s.einheiten[0].zeiten, "die einzige Einheit traegt ihre Zeiten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-51] laeuft dieselbe Karte mehrfach (Salvage), trifft es die juengste Einheit und addiert ihre Zeiten", NUR_POSIX, () => {
  // Rote buildChecks lassen die erste (regulaere) Session als dirty zurueck; gruene
  // buildChecks (per Fake selbst geschrieben) erlauben danach den Salvage-Versuch — das
  // ist der einzige Weg in diesem Runner, an dem eine Karte zwei Sessions bekommt
  // (Issue #167), und beide muessen dieselbe (einzige) Einheit treffen.
  const dir = setupProjekt("night-zeiten-mehrfach-", ["true"]);
  try {
    const id = readyIssue(dir, "Salvage-Kandidat");
    const regulaer = [
      SCHUB,
      // duration_api_ms 1000: die regulaere Session, die nichts abschliesst.
      `echo '{"type":"result","duration_api_ms":1000,"num_turns":1,"total_cost_usd":0.1}'`,
      'echo dirty > "dirty-$NIGHT_ISSUE_ID.txt"',
    ].join("\n");
    const salvage = [
      SCHUB, SCHUB,
      // duration_api_ms 9000: die Salvage-Session, deutlich verschieden von der ersten.
      `echo '{"type":"result","duration_api_ms":9000,"num_turns":2,"total_cost_usd":0.2}'`,
      SUMMARY_GRUEN,
      // git add -A statt nur work-$id.txt: nimmt die dirty-$id.txt der regulaeren
      // Session mit, sonst bliebe der Baum nach dem Move unsauber.
      'git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
      NACH_IN_REVIEW,
    ].join("\n");
    const fake = `if [ -n "$NIGHT_SALVAGE" ]; then\n${salvage}\nelse\n${regulaer}\nfi`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.einheiten.length, 1, "regulaere und Salvage-Session teilen sich eine Einheit");
    const z = einheit(dir, id).zeiten;
    assert.equal(z.nachdenkenMs, 10000, "1000 der Runde plus 9000 der Rettung — die Einheit hat beides gekostet");
    assert.equal(z.werkzeugSchuebe, 3, "ein Schub der Runde plus zwei der Rettung");
    assert.equal(z.offeneSchuebe, 0);
    assert.ok(z.werkzeugMs > 0);
    assert.ok(typeof z.dauerMs === "number" && z.dauerMs > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-51] misst eine der beiden Sessions unvollstaendig, bleibt das Feld in der Summe null", NUR_POSIX, () => {
  // Wie oben, nur gibt die Salvage-Session kein result-Ereignis aus: ihre apiDauerMs fehlt.
  // Die 1000 der regulaeren Runde allein stehenzulassen, gaebe einen Teil als Ganzes aus.
  const dir = setupProjekt("night-zeiten-summe-unvollstaendig-", ["true"]);
  try {
    const id = readyIssue(dir, "Salvage ohne Kennzahlen");
    const regulaer = [
      SCHUB,
      `echo '{"type":"result","duration_api_ms":1000,"num_turns":1,"total_cost_usd":0.1}'`,
      'echo dirty > "dirty-$NIGHT_ISSUE_ID.txt"',
    ].join("\n");
    const salvage = [
      SCHUB,
      SUMMARY_GRUEN,
      'git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
      NACH_IN_REVIEW,
    ].join("\n");
    const fake = `if [ -n "$NIGHT_SALVAGE" ]; then\n${salvage}\nelse\n${regulaer}\nfi`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const z = einheit(dir, id).zeiten;
    assert.equal(z.nachdenkenMs, null, "ohne apiDauerMs der Rettung ist die Nachdenkzeit der Einheit unbekannt");
    assert.equal(z.werkzeugSchuebe, 2, "die gezaehlten Schuebe beider Sessions bleiben eine Summe");
    assert.ok(typeof z.dauerMs === "number" && z.dauerMs > 0, "die Dauer war auf beiden Seiten gemessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
