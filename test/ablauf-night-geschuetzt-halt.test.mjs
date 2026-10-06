// Ablauf-Pruefung: ein Fall unterscheidet den Halt an einer geschuetzten Datei im ganzen Lauf von night.mjs mit Attrappen-Session.
//
// Der Runner unterscheidet den Halt an einer geschuetzten Datei von einer Stopp-Frage
// (Issue #1050, Plan #987, E12, E13, Verifizierung 10; fachliche Quelle #868, Kriterium 5).
//
// Scheitert eine Session erst beim Schreiben am Schutz, haelt sie an: eigenen Anteil
// zuruecknehmen, Backlog, Label (darf fehlen, E11), Halt-Kommentar mit dem Anker. Bis hierher
// kannte `istHalt` nur `kit:klaeren` samt Folgesatz und wertete diesen Halt als Fehlschlag —
// und jede Stelle, die einen Halt benennt, nannte ihn "Stopp-Frage". Morgens stuende dann
// eine Entscheidung im Bericht, wo eine Handlung wartet.
//
// Label, Anker und Folgesatz kommen aus den Konstanten des Runners, nicht als Literal: Eine
// Abschrift bliebe gruen, waehrend Skill und Runner auseinanderliefen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  istHalt, umsetzungHaltGrund, berichtBauen,
  HALT_FOLGESATZ, KLAEREN_LABEL, GESCHUETZT_LABEL, GESCHUETZT_ANKER,
} from "../kit/night.mjs";

import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

// --- istHalt: die Art des Halts ---

const HALT_TEXT = `Beim Umsetzen tauchte eine Abwaegung auf. ${HALT_FOLGESATZ}`;
const GESCHUETZT_TEXT = `${GESCHUETZT_ANKER}\n\nDie Aenderung an \`.claude/settings.json\` nimmt ein Mensch vor.`;

const karte = ({ status = "backlog", labels = [], kommentare = [] } = {}) => ({
  status, labels, comments: kommentare.map((body) => ({ body })),
});
const VORHER = karte({ status: "in_progress" });

test("[night-halt] istHalt liefert geschuetzt fuer Anker plus Backlog, mit Label", () => {
  assert.equal(istHalt(VORHER, karte({ labels: [GESCHUETZT_LABEL], kommentare: [GESCHUETZT_TEXT] })), "geschuetzt");
});

test("[night-halt] istHalt liefert geschuetzt fuer Anker plus Backlog, ohne Label", () => {
  assert.equal(istHalt(VORHER, karte({ kommentare: [GESCHUETZT_TEXT] })), "geschuetzt");
});

test("[night-halt] istHalt liefert klaeren fuer kit:klaeren samt Folgesatz", () => {
  assert.equal(istHalt(VORHER, karte({ labels: [KLAEREN_LABEL], kommentare: [HALT_TEXT] })), "klaeren");
});

test("[night-halt] istHalt liefert null fuer kit:klaeren ohne Folgesatz", () => {
  assert.equal(istHalt(VORHER, karte({ labels: [KLAEREN_LABEL], kommentare: ["Eine Frage ohne den Satz."] })), null);
});

test("[night-halt] istHalt liefert null fuer den Anker ohne Backlog-Move", () => {
  assert.equal(istHalt(VORHER, karte({ status: "in_progress", labels: [GESCHUETZT_LABEL], kommentare: [GESCHUETZT_TEXT] })), null);
});

test("[night-halt] istHalt wertet einen Anker von vor der Session nicht", () => {
  const vorher = karte({ status: "in_progress", kommentare: [GESCHUETZT_TEXT] });
  assert.equal(istHalt(vorher, karte({ kommentare: [GESCHUETZT_TEXT] })), null);
});

// --- Stufengrund der Kette ---

test("[night-halt] der Stufengrund nennt den geschuetzten Halt nicht als Stopp-Frage", () => {
  const { grund, haltArt } = umsetzungHaltGrund({ angehalten: ["11"], haltArten: { 11: "geschuetzt" } });
  assert.equal(haltArt, "geschuetzt");
  assert.match(grund, /^Stufe umsetzung: #11 haelt an einer geschuetzten Datei$/);
  assert.doesNotMatch(grund, /Stopp-Frage/);
});

test("[night-halt] der Stufengrund nennt beide Arten getrennt", () => {
  const { grund, haltArt } = umsetzungHaltGrund({ angehalten: ["11", "12"], haltArten: { 11: "klaeren", 12: "geschuetzt" } });
  assert.equal(haltArt, "klaeren");
  assert.equal(grund, "Stufe umsetzung: #11 haelt an einer Stopp-Frage; #12 haelt an einer geschuetzten Datei");
});

test("[night-halt] der Stufengrund fuer eine Stopp-Frage bleibt, wie er war", () => {
  // Auch ohne `haltArten` — ein Stand, der die Art nicht kennt, ist ein klaeren-Halt.
  const { grund, haltArt } = umsetzungHaltGrund({ angehalten: ["11"] });
  assert.equal(haltArt, "klaeren");
  assert.equal(grund, "Stufe umsetzung: #11 haelt an einer Stopp-Frage");
});

// --- Bericht: Zaehler und Abschnitt ---

function einheitAngehalten(haltArten) {
  const angehalten = Object.keys(haltArten);
  return {
    ausgang: "angehalten",
    grund: umsetzungHaltGrund({ angehalten, haltArten }).grund,
    variante: "B",
    stufen: { pakete: { ids: angehalten }, umsetzung: { umgesetzt: [], angehalten, haltArten, nichtBegonnen: [] } },
  };
}

test("[night-halt] der Bericht fuehrt den geschuetzten Halt nicht unter den Stopp-Fragen", () => {
  const text = berichtBauen(einheitAngehalten({ 11: "geschuetzt" }), { stempel: "x", start: 0, jetzt: 0 });
  assert.match(text, /- Stopp-Fragen: 0\n/);
  assert.match(text, /- Geschuetzte Dateien: 1\n/);
  assert.ok(!text.includes("### Offene Stopp-Frage"), "der geschuetzte Halt steht als Stopp-Frage im Bericht");
  assert.match(text, /### Wartende Handlung an geschuetzter Datei\n\nStufe umsetzung: #11 haelt an einer geschuetzten Datei/);
});

test("[night-halt] der Bericht fuehrt eine Stopp-Frage wie bisher", () => {
  const text = berichtBauen(einheitAngehalten({ 11: "klaeren" }), { stempel: "x", start: 0, jetzt: 0 });
  assert.match(text, /- Stopp-Fragen: 1\n/);
  assert.doesNotMatch(text, /Geschuetzte Dateien/);
  assert.match(text, /### Offene Stopp-Frage\n\nStufe umsetzung: #11 haelt an einer Stopp-Frage/);
  assert.ok(!text.includes("### Wartende Handlung an geschuetzter Datei"));
});

test("[night-halt] der Bericht nennt bei beiden Arten beide", () => {
  const text = berichtBauen(einheitAngehalten({ 11: "klaeren", 12: "geschuetzt" }), { stempel: "x", start: 0, jetzt: 0 });
  assert.match(text, /- Stopp-Fragen: 1\n/);
  assert.match(text, /- Geschuetzte Dateien: 1\n/);
  assert.ok(text.includes("### Offene Stopp-Frage"));
  assert.ok(text.includes("### Wartende Handlung an geschuetzter Datei"));
});

// --- E2E: Logzeile und Dirty-Guard im echten Runner ---

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/checks-summary.json\nsessions.log\n");
  lfAttribute(join(dir, ".gitattributes"));
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

function einheit(dir, id) {
  const datei = readdirSync(join(dir, ".claude")).find((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n));
  const s = JSON.parse(readFileSync(join(dir, ".claude", datei), "utf-8"));
  return s.einheiten.find((e) => String(e.id) === String(id));
}

const BOARD = "node .claude/kit/board.mjs";
const kommentar = (text) => `${BOARD} issue comment "$NIGHT_ISSUE_ID" --text ${JSON.stringify(text)} > /dev/null`;
const label = (name) => `${BOARD} issue label add "$NIGHT_ISSUE_ID" ${name} > /dev/null`;
const NACH_BACKLOG = `${BOARD} issue move "$NIGHT_ISSUE_ID" backlog > /dev/null`;

/** Der Halt an einer geschuetzten Datei in der Reihenfolge aus E13 — wahlweise ohne Label. */
const geschuetztFake = (mitLabel) => [NACH_BACKLOG, ...(mitLabel ? [label(GESCHUETZT_LABEL)] : []), kommentar(GESCHUETZT_TEXT)].join(" && ");
const klaerenFake = [label(KLAEREN_LABEL), kommentar(HALT_TEXT), NACH_BACKLOG].join(" && ");

for (const mitLabel of [true, false]) {
  test(`[night-halt] die Logzeile nennt den geschuetzten Halt (${mitLabel ? "mit" : "ohne"} Label), nicht die offene Entscheidung`, () => {
    const dir = setupProjekt("night-geschuetzt-halt-");
    try {
      const id = readyIssue(dir, "[Task] Scheitert am Schutz");
      const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: geschuetztFake(mitLabel) });
      assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout, /angehalten: eine Handlung an einer geschuetzten Datei wartet auf einen Menschen/, res.stdout);
      assert.doesNotMatch(res.stdout, /offene Entscheidung/, "der geschuetzte Halt erscheint als offene Entscheidung");
      assert.doesNotMatch(res.stdout, /Session ohne In-review-Ergebnis beendet/, "der Halt wurde als Rueckstellung verbucht");
      const e = einheit(dir, id);
      assert.equal(e.ausgang, "angehalten");
      assert.equal(e.haltArt, "geschuetzt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("[night-halt] die Logzeile einer Stopp-Frage bleibt die offene Entscheidung", () => {
  const dir = setupProjekt("night-geschuetzt-halt-klaeren-");
  try {
    const id = readyIssue(dir, "[Task] Haelt an");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: klaerenFake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /angehalten: eine offene Entscheidung wartet auf einen Menschen/);
    assert.equal(einheit(dir, id).haltArt, "klaeren");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [art, fake, muster] of [
  ["geschuetzt", geschuetztFake(false), /HALT MIT UNSAUBEREM BAUM nach [\d.]+ min: Issue #\d+ haelt an einer geschuetzten Datei, aber der Working Tree ist dirty — kein Salvage, harter Stopp\./],
  ["klaeren", klaerenFake, /HALT MIT UNSAUBEREM BAUM nach [\d.]+ min: Issue #\d+ traegt kit:klaeren, aber der Working Tree ist dirty — kein Salvage, harter Stopp\./],
]) {
  test(`[night-halt] der Dirty-Guard stoppt hart, wenn ein ${art}-Halt an einem unsauberen Baum haengt`, () => {
    const dir = setupProjekt(`night-geschuetzt-halt-dirty-${art}-`);
    try {
      const erstes = readyIssue(dir, "[Task] Haelt an, laesst aber liegen");
      const zweites = readyIssue(dir, "Kommt nicht mehr dran");
      const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: `${fake} && echo rest > zwischenstand.txt` });
      assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout, muster, res.stdout);
      assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH/, "an einer angehaltenen Karte darf kein Salvage laufen");
      const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
      assert.deepEqual(ready, [zweites], "das zweite Issue haette unangetastet bleiben muessen");
      assert.match(board(dir, "issue", "get", erstes).body || "", /Nachtlauf: Halt mit unsauberem Working Tree/);
      assert.match(einheit(dir, erstes).grund || "", /zwischenstand\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// --- Auffang im Runner (Issue #1051, Plan #987, E20) ---
//
// Befolgt die Session den Rueckfall-Halt nicht und hinterlaesst einen unsauberen Baum ohne
// Label und ohne Anker, faengt der Runner den Fall selbst auf — sofern ihr Stream eine
// abgewiesene Schreibanfrage auf einen geschuetzten Pfad traegt.
//
// Format des Stream-Fixtures nach dem Beleg an Issue #1042 (echter Stream der Nacht vom
// 2026-09-21, Fall #799, Claude Code 2.1.236): Die `result`-Zeile traegt
// `permission_denials` mit je `tool_name` (`Edit` oder `Write`), `tool_use_id` und
// `tool_input.file_path` als absolutem Pfad. Abweisungen des Hooks `bash-pruefen` stehen in
// derselben Liste mit `tool_name: "Bash"` und loesen den Auffang nicht aus.

const abweisung = (werkzeug, pfadAusdruck) =>
  `{"type":"result","subtype":"success","is_error":false,"result":"ABGEWIESEN","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_0","tool_input":{"command":"ls | head"}},{"tool_name":"${werkzeug}","tool_use_id":"toolu_1","tool_input":{"file_path":"'"${pfadAusdruck}"'","old_string":"a","new_string":"b"}}]}`;

/** Die Session des ersten Pakets laesst einen Rest liegen und meldet die Abweisung; jede andere schreibt nur ins Sitzungsprotokoll. */
const auffangFake = (erstes, stream) =>
  `if [ "$NIGHT_ISSUE_ID" = "${erstes}" ]; then echo rest > zwischenstand.txt; printf '%s\\n' '${stream}'; else echo "$NIGHT_ISSUE_ID" >> sessions.log; fi`;

function auffangLauf(praefix, stream) {
  const dir = setupProjekt(praefix);
  const erstes = readyIssue(dir, "[Task] Scheitert am Schutz und vermerkt nichts");
  const zweites = readyIssue(dir, "Danach");
  const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: auffangFake(erstes, stream(dir)) });
  return { dir, erstes, zweites, res };
}

const stashListe = (dir) => run(dir, "git", ["stash", "list"]).stdout;
const sitzungen = (dir) => {
  try { return readFileSync(join(dir, "sessions.log"), "utf-8").split("\n").filter(Boolean); } catch { return []; }
};

for (const werkzeug of ["Edit", "Write"]) {
  test(`[night-1051] mit Abweisung (${werkzeug}) auf einen geschuetzten Pfad: Stash, sauberer Baum, Anker-Kommentar, das naechste Paket startet`, () => {
    const { dir, erstes, zweites, res } = auffangLauf("night-1051-auffang-", (d) => abweisung(werkzeug, `${d}/.claude/settings.json`));
    try {
      assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout, /AUFFANG GESCHUETZT/, res.stdout);
      assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH/, "vor dem Auffang darf kein Salvage laufen");

      assert.equal(run(dir, "git", ["status", "--porcelain", "--", "zwischenstand.txt"]).stdout, "", "der Baum ist nicht sauber");
      assert.match(stashListe(dir), new RegExp(`nachtrest #${erstes} `), "der Zwischenstand liegt nicht im Stash");

      const karte = board(dir, "issue", "get", erstes);
      assert.equal(karte.status, "backlog");
      const text = karte.body || "";
      assert.ok(text.includes(GESCHUETZT_ANKER), "der Anker-Kommentar fehlt");
      assert.match(text, /\.claude\/settings\.json/, "der abgewiesene Pfad fehlt im Kommentar");
      assert.match(text, new RegExp(`Zwischenstand: Stash „nachtrest #${erstes} `), "der Ort des Zwischenstands fehlt im Kommentar");

      assert.deepEqual(sitzungen(dir), [zweites], "das naechste Paket hat keine Session bekommen");
      const e = einheit(dir, erstes);
      assert.equal(e.ausgang, "angehalten");
      assert.equal(e.haltArt, "geschuetzt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [fall, stream] of [
  ["ohne Abweisung", () => `{"type":"result","subtype":"success","is_error":false,"result":"fertig","permission_denials":[]}`],
  ["mit Abweisung auf einen fremden Pfad", (d) => abweisung("Edit", `${d}/src/frei.mjs`)],
]) {
  test(`[night-1051] ${fall}: kein Auffang, der Bestand greift (Salvage)`, () => {
    const { dir, erstes, res } = auffangLauf("night-1051-bestand-", stream);
    try {
      assert.doesNotMatch(res.stdout, /AUFFANG GESCHUETZT/, res.stdout);
      assert.match(res.stdout, /SALVAGE-VERSUCH/, "der Bestand beginnt mit dem Salvage");
      assert.ok(!(board(dir, "issue", "get", erstes).body || "").includes(GESCHUETZT_ANKER), "ohne Abweisung entsteht kein Anker-Kommentar");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("[night-1051] abgewieseneSchreibpfade liest nur Schreibwerkzeuge, relativ zum Baum, ohne Pfade ausserhalb", async () => {
  const { abgewieseneSchreibpfade } = await import("../kit/night.mjs");
  const baum = mkdtempSync(join(tmpdir(), "night-1051-pfade-"));
  try {
    const stream = [
      `{"type":"assistant","message":{"content":[]}}`,
      "kein JSON, permission_denials",
      JSON.stringify({ type: "result", permission_denials: [
        { tool_name: "Bash", tool_use_id: "t0", tool_input: { command: "ls" } },
        { tool_name: "Edit", tool_use_id: "t1", tool_input: { file_path: join(baum, ".claude", "settings.json") } },
        { tool_name: "Write", tool_use_id: "t2", tool_input: { file_path: join(baum, ".claude", "hooks", "probe.sh") } },
        { tool_name: "Write", tool_use_id: "t3", tool_input: { file_path: "/ganz/woanders/datei.txt" } },
        { tool_name: "Edit", tool_use_id: "t4", tool_input: { file_path: join(baum, ".claude", "settings.json") } },
      ] }),
    ].join("\n");
    assert.deepEqual(abgewieseneSchreibpfade(stream, baum), [".claude/settings.json", ".claude/hooks/probe.sh"]);
    assert.deepEqual(abgewieseneSchreibpfade(`{"type":"result","permission_denials":[]}`, baum), []);
    assert.deepEqual(abgewieseneSchreibpfade(undefined, baum), []);
  } finally {
    rmSync(baum, { recursive: true, force: true });
  }
});

test("[night-1051] GESCHUETZT_ABGEWIESEN steht in Runner und Board gleichlautend", async () => {
  const runner = await import("../kit/night.mjs");
  const brett = await import("../kit/board.mjs");
  assert.equal(runner.GESCHUETZT_ABGEWIESEN, brett.GESCHUETZT_ABGEWIESEN);
});
