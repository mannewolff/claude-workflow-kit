// Der Zaehler der Prueflaeufe am Session-Strom (Issue #924, Plan #917, E1/E2/E3/E7/E9).
//
// Anders als der Werkzeugzeit-Beobachter DEUTET dieser hier: Er liest das Kommando eines
// Bash-Aufrufs und haelt es gegen die konfigurierten `buildChecks`. Darum sitzt er neben
// jenem und nicht in ihm (E1) — die Uhr bleibt eine Uhr.
//
// Drei Ebenen werden geprueft: `prueflaufBeobachter()` an aufgezeichneten Stromzeilen,
// `prueflaeufeAddieren()` als reine Summe zweier Sessions, und der Weg in den
// Ergebnisstand E2E ueber einen Nachtlauf mit Fake-Session — dieselbe Linie wie
// night-zeiten.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { prueflaufBeobachter, prueflaeufeAddieren, runSession } from "../kit/night.mjs";

// Die buildChecks dieses Repos in Kurzform: zwei Gruppen als String, eine als Objekt mit
// `cmd` — beide Formen muss der Beobachter lesen (E2).
const GRUPPE_A = 'node --test "test/night-*.test.mjs" "test/board-*.test.mjs"';
const GRUPPE_B = 'node --test "test/skills-*.test.mjs" "test/docs-*.test.mjs"';
const CHECKS = [GRUPPE_A, { cmd: GRUPPE_B, areas: ["skills-doku"] }, "npx eslint kit tools test"];

/** Ein `assistant`-Ereignis mit einem Bash-`tool_use` je Kommando. */
function bashAufrufe(...paare) {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: paare.map(([id, command]) => ({ type: "tool_use", id, name: "Bash", input: { command } })),
    },
  });
}

/** Ein `user`-Ereignis mit einem `tool_result` zur gegebenen Id. */
function toolResult(id) {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  });
}

/** Fuettert den Beobachter mit Paaren [zeile, zeitstempel] und liefert sein Ergebnis. */
function beobachte(paare, checks = CHECKS) {
  const b = prueflaufBeobachter(checks);
  for (const [zeile, ts] of paare) b.zeile(zeile, ts);
  return b.ergebnis();
}

/** Ein einzelner Bash-Aufruf mit Ergebnis, 100 ms Spanne. */
function einAufruf(command, checks = CHECKS) {
  return beobachte([
    [bashAufrufe(["t1", command]), 1000],
    [toolResult("t1"), 1100],
  ], checks);
}

// ============================================================
// prueflaufBeobachter — was zaehlt und was nicht
// ============================================================

test("[night-924] drei gezielte Laeufe sind drei Prueflaeufe und keine vollstaendige Gruppe", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node --test test/night-prueflaeufe.test.mjs"]), 1000],
    [toolResult("t1"), 1500],
    [bashAufrufe(["t2", "node --test test/night-zeiten.test.mjs"]), 2000],
    [toolResult("t2"), 2300],
    [bashAufrufe(["t3", "node --test test/checks-run.test.mjs"]), 3000],
    [toolResult("t3"), 3200],
  ]);
  assert.equal(erg.anzahl, 3);
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.dauerMs, 500 + 300 + 200, "dauerMs ist die Summe der zugeordneten Spannen");
});

test("[night-924] ein Aufruf, der woertlich einem buildChecks-Kommando entspricht, ist eine vollstaendige Gruppe", () => {
  const erg = einAufruf(GRUPPE_A);
  assert.equal(erg.volle, 1);
  assert.equal(erg.anzahl, 1, "die vollstaendige Gruppe ist ein Prueflauf wie jeder andere — volle zaehlt zusaetzlich");
  assert.equal(erg.volleNoetig, 0);
});

test("[night-924] ein buildChecks-Eintrag in Objektform wird wie die String-Form gelesen", () => {
  const erg = einAufruf(GRUPPE_B);
  assert.equal(erg.volle, 1, "die cmd-Form eines Eintrags ist dasselbe Kommando");
  assert.equal(erg.anzahl, 1);
});

test("[night-924] ein checks.mjs run --bereich ist der sanktionierte Gruppenlauf: volleNoetig, nicht volle", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run --bereich board");
  assert.equal(erg.volleNoetig, 1);
  assert.equal(erg.volle, 0, "der Bereichslauf darf nicht unter die Verstoesse geraten (Plan #917, E3)");
  assert.equal(erg.anzahl, 1);
});

test("[night-924] ein node --test auf eine einzelne Datei ist keine vollstaendige Gruppe", () => {
  const erg = einAufruf("node --test test/night-zeiten.test.mjs");
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.anzahl, 1, "gezaehlt wird er trotzdem — er ist ein Prueflauf der Arbeit");
});

test("[night-924] ein checks.mjs run ohne --bereich ist der Abschlussversuch und erhoeht arbeit.anzahl nicht", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run");
  assert.equal(erg.anzahl, 0, "sonst stuende der Abschlussversuch in zwei Zahlen (Plan #917, E9)");
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.dauerMs, 0);
});

test("[night-924] auch checks.mjs run --frisch bleibt Abschlussversuch, mit --bereich bleibt es der Gruppenlauf", () => {
  assert.equal(einAufruf("node .claude/kit/checks.mjs run --frisch").anzahl, 0);
  const mitBereich = einAufruf("node .claude/kit/checks.mjs run --bereich=board --frisch");
  assert.equal(mitBereich.volleNoetig, 1, "--bereich=<name> ist dieselbe Wahl wie --bereich <name>");
  assert.equal(mitBereich.anzahl, 1);
});

test("[night-924] ein Aufruf mit fremdem Programm zaehlt nicht", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "git status --porcelain"], ["t2", "ls -la"]), 1000],
    [toolResult("t1"), 1100],
    [toolResult("t2"), 1200],
  ]);
  assert.equal(erg.anzahl, 0);
  assert.equal(erg.dauerMs, 0);
});

test("[night-924] eine Umgebungszuweisung vor dem Programm verdeckt es nicht", () => {
  assert.equal(einAufruf("NODE_OPTIONS=--no-warnings node --test test/board-cli.test.mjs").anzahl, 1);
});

test("[night-924] nur Bash-Aufrufe zaehlen — ein Read oder ein Agent mit demselben Text nicht", () => {
  const erg = beobachte([
    [JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { command: GRUPPE_A } }] },
    }), 1000],
    [toolResult("t1"), 1100],
  ]);
  assert.equal(erg.anzahl, 0);
  assert.equal(erg.volle, 0);
});

test("[night-924] parallele Prueflaeufe eines Schubs zaehlen einzeln, jeder mit seiner eigenen Spanne", () => {
  const erg = beobachte([
    [bashAufrufe(["a", "node --test test/a.test.mjs"], ["b", "node --test test/b.test.mjs"]), 1000],
    [toolResult("a"), 1200],
    [toolResult("b"), 1500],
  ]);
  assert.equal(erg.anzahl, 2, "zwei gestartete Laeufe sind zwei Laeufe, auch wenn sie nebeneinander liefen");
  assert.equal(erg.dauerMs, 200 + 500);
});

test("[night-924] ein Prueflauf ohne Ergebnis zaehlt als gestartet, seine Dauer geht nicht ein", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node --test test/a.test.mjs"]), 1000],
    [toolResult("t1"), 1100],
    [bashAufrufe(["t2", "node --test test/b.test.mjs"]), 2000],
    // kein tool_result: Strom am Zeitlimit abgeschnitten
  ]);
  assert.equal(erg.anzahl, 2, "gestartet hat die Session beide");
  assert.equal(erg.dauerMs, 100, "die offene Spanne waere eine Schaetzung");
});

test("[night-924] unlesbare Zeilen, fehlendes Kommando und fehlende Id werden tolerant uebersprungen", () => {
  const erg = beobachte([
    ["kein JSON", 900],
    ["", 905],
    ["{abgeschnitten", 910],
    [undefined, 915],
    [JSON.stringify({ type: "assistant", message: {} }), 920],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: GRUPPE_A } }] } }), 930],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash" }] } }), 940],
    [JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "unbekannt" }] } }), 950],
    [bashAufrufe(["t1", GRUPPE_A]), 1000],
    [toolResult("t1"), 1300],
  ]);
  assert.equal(erg.anzahl, 1, "der eine lesbare Aufruf muss trotz Muell davor gezaehlt werden");
  assert.equal(erg.volle, 1);
  assert.equal(erg.dauerMs, 300);
});

test("[night-924] ohne buildChecks zaehlt der Beobachter keine Arbeit, aber weiter den Bereichslauf", () => {
  assert.deepEqual(beobachte([[bashAufrufe(["t1", "mvn verify"]), 1000], [toolResult("t1"), 1100]], []),
    { anzahl: 0, volle: 0, volleNoetig: 0, dauerMs: 0 });
  const bereich = einAufruf("node .claude/kit/checks.mjs run --bereich board", []);
  assert.equal(bereich.volleNoetig, 1, "der Bereichslauf ist per Aufrufweg erkennbar, nicht ueber die Programme");
});

test("[night-924] der Beobachter nimmt eine bereits geparste Zeile entgegen und ergebnis() ist mehrfach abrufbar", () => {
  const b = prueflaufBeobachter(CHECKS);
  b.zeile(JSON.parse(bashAufrufe(["t1", GRUPPE_A])), 1000);
  b.zeile(JSON.parse(toolResult("t1")), 1100);
  assert.deepEqual(b.ergebnis(), b.ergebnis());
  assert.deepEqual(b.ergebnis(), { anzahl: 1, volle: 1, volleNoetig: 0, dauerMs: 100 });
});

// ============================================================
// prueflaeufeAddieren — die Sessions einer Einheit
// ============================================================

test("[night-924] zwei Sessions derselben Einheit addieren ihre Prueflaeufe feldweise", () => {
  const runde = { arbeit: { anzahl: 12, volle: 4, volleNoetig: 1, dauerMs: 1_980_000 } };
  const salvage = { arbeit: { anzahl: 2, volle: 1, volleNoetig: 0, dauerMs: 60_000 } };
  assert.deepEqual(prueflaeufeAddieren(runde, salvage), {
    arbeit: { anzahl: 14, volle: 5, volleNoetig: 1, dauerMs: 2_040_000 },
  });
});

test("[night-924] die Summe enthaelt keine Abschlusszahl und keine Zielmarke (Plan #917, E7)", () => {
  const summe = prueflaeufeAddieren(
    { arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 } },
    { arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 } },
  );
  assert.deepEqual(Object.keys(summe), ["arbeit"]);
  assert.deepEqual(Object.keys(summe.arbeit).sort(), ["anzahl", "dauerMs", "volle", "volleNoetig"]);
});

// ============================================================
// E2E — der Weg in den Ergebnisstand und die Stufe ohne Strom
// ============================================================

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

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

function einheit(dir, id) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  const s = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";

/** Ein Bash-Aufruf im Strom der Fake-Session: tool_use, kurze Pause, tool_result. */
function schub(id, command) {
  return [
    `echo '${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } })}'`,
    "sleep 0.05",
    `echo '${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } })}'`,
  ].join("\n");
}

test("[night-924] nach einer Session mit Prueflaeufen traegt die Einheit prueflaeufe.arbeit neben zeiten", NUR_POSIX, () => {
  const dir = setupProjekt("night-prueflaeufe-stand-");
  try {
    const issue = board(dir, "issue", "create", "--title", "Mit Prueflaeufen", "--body", "## Abhaengigkeiten\nKeine.");
    const id = String(issue.id);
    board(dir, "issue", "move", id, "ready");
    const fake = [
      schub("p1", "true"),                    // woertlich das buildChecks-Kommando: volle Gruppe
      schub("p2", "true --nur-ein-teil"),     // dasselbe Programm, gezielt: nur anzahl
      schub("p3", "git status --porcelain"),  // fremdes Programm: zaehlt nicht
      SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW,
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.ok(e.prueflaeufe, "die Einheit traegt kein prueflaeufe-Feld");
    assert.ok(e.zeiten, "prueflaeufe steht NEBEN zeiten, nicht an seiner Stelle");
    assert.equal(e.prueflaeufe.arbeit.anzahl, 2, "der git-Aufruf ist kein Prueflauf");
    assert.equal(e.prueflaeufe.arbeit.volle, 1);
    assert.equal(e.prueflaeufe.arbeit.volleNoetig, 0);
    assert.ok(e.prueflaeufe.arbeit.dauerMs > 0, `die Spannen haetten gemessen sein muessen: ${e.prueflaeufe.arbeit.dauerMs}`);
    assert.equal(e.zeiten.prueflaeufe, undefined, "die Zeiten bleiben unveraendert (zeitenBauen)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-924] eine Stufe ohne Strom liefert prueflaeufe: null — nicht gemessen ist nicht null Laeufe", NUR_POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), "night-prueflaeufe-ohne-strom-"));
  try {
    const prog = join(dir, "stufen-programm");
    writeFileSync(prog, "#!/bin/sh\necho fertig\n", { mode: 0o755 });
    const res = await runSession("1", { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false }, {
      kommando: prog,
      aufgabenstufe: "leicht",
      stufenName: "lokal",
      prompt: "/implement-next #1",
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.prueflaeufe, null, "ohne Strom gibt es nichts zu zaehlen — 0 hiesse gemessen, keiner");
    assert.equal(res.werkzeugzeit, null, "dieselbe Regel wie bei der Werkzeugzeit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
