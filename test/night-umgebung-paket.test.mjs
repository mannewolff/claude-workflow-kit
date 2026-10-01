// Umgebung oder Paket: ein Versuch fuer Umgebungsfehler des lebenden Laufs (Issue #1088,
// Plan #1079 E13, E15).
//
// Ein gescheiterter Board-Aufruf des Runners und ein Sitzungsstart, der mit Exit ungleich 0
// endet, ohne dass die Sitzung ein einziges Ereignis gemeldet hat, sind Umgebung: Nach der
// Pause `night.stand.pauseMin` folgt genau ein zweiter Versuch, und die Karte traegt den
// Vermerk "2. Versuch". Scheitert auch er, haelt der Lauf an: Die laufende Karte steht auf
// `abgebrochen`, jede Karte, die der Lauf als naechste aufgenommen haette, zeigt "nicht
// begonnen" mit Grund und Zeitpunkt. Eine Sitzung, die zustande kam und ohne Ergebnis
// endete, ist dagegen ein Paketfehler — ohne Versuch.
//
// Geprueft am lokalen Tracker mit dem echten CLI. Vor board.mjs der Kit-Kopie liegt ein
// Stoerer, der ausgewaehlte Aufrufe scheitern laesst; die Pause ist ueber `pauseMin` auf
// Millisekunden herabgesetzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  NUR_POSIX, run as ketteRun, mitProjekt, umgebung, sessions, fachplan, stand, EREIGNIS, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
// 6 ms: kurz genug fuer die Suite, lang genug, dass die Pause ein eigener Schritt bleibt.
const PAUSE_MIN = 0.0001;
const ERFOLG = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;

function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, KIT_NIGHT_WAECHTER: "0", NIGHT_VORFLUG_CMD: "true", ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board-echt.mjs"), ...cliArgs], { cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: cwd } });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Ein Projekt mit lokalem Tracker. board.mjs der Kit-Kopie ist ein Stoerer: Er liest
 * `helfer/stoerung.json` (`{ muster, mal }`) und laesst die ersten `mal` Aufrufe, deren
 * Argumente auf `muster` passen, mit Exit 1 scheitern; alles andere reicht er weiter.
 */
function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-umgebung-"));
  const kit = join(dir, ".claude", "kit");
  mkdirSync(kit, { recursive: true });
  mkdirSync(join(dir, "helfer"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(kit, "board-echt.mjs"));
  const stoerung = join(dir, "helfer", "stoerung.json");
  writeFileSync(join(kit, "board.mjs"), [
    'import { readFileSync, writeFileSync, existsSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    `const pfad = ${JSON.stringify(stoerung)};`,
    'const aufruf = process.argv.slice(2).join(" ");',
    "if (existsSync(pfad)) {",
    '  const s = JSON.parse(readFileSync(pfad, "utf-8"));',
    "  if (s.mal > 0 && new RegExp(s.muster).test(aufruf)) {",
    "    s.mal--;",
    "    writeFileSync(pfad, JSON.stringify(s));",
    String.raw`    process.stderr.write("Board-Timeout: keine Antwort binnen 120000 ms\n");`,
    "    process.exit(1);",
    "  }",
    "}",
    `const res = spawnSync(process.execPath, [${JSON.stringify(join(kit, "board-echt.mjs"))}, ...process.argv.slice(2)], { stdio: "inherit" });`,
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    night: { stand: { pauseMin: PAUSE_MIN } },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*\n.claude/checks-summary.json\n.claude/night-umsetzung.lock\n.claude/wegmarken.tsv\n.claude/bewegungen.tsv\n.claude/lauf/\nissues/\nhelfer/\n");
  for (const a of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Night Test"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function mitDir(fn) {
  const dir = setupProjekt();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function karte(dir, titel, { labels = ["kit:nightrun"], status = "ready" } = {}) {
  const { id } = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  for (const label of labels) board(dir, "issue", "label", "add", String(id), label);
  if (status) board(dir, "issue", "move", String(id), status);
  return String(id);
}

function stoeren(dir, muster, mal) {
  writeFileSync(join(dir, "helfer", "stoerung.json"), JSON.stringify({ muster, mal }));
}

/** Der Laufstand-Kommentar einer Karte (der letzte) oder `null`. */
function laufstand(dir, id) {
  const bloecke = readFileSync(join(dir, "issues", `${id}.md`), "utf-8")
    .split("\n---\n**Kommentar**").slice(1).filter((b) => /\n## Laufstand\b/.test(b));
  return bloecke.at(-1) ?? null;
}

const labels = (dir, id) => board(dir, "issue", "get", id).labels;
const spalte = (dir, id) => board(dir, "issue", "get", id).status;

/** Die Sitzungen des Fakes: je Zeile die Kartennummer. */
const sitzungen = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n").filter(Boolean) : []);

/** Fake einer Implementierungs-Session: protokolliert und fuehrt danach `rest` aus. */
const fake = (logPfad, rest) => `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(logPfad)}; ${rest}`;

// --- Belegfall 3 (#1026): ein Board-Aufruf scheitert einmal ---

test("[#1026] ein Board-Aufruf scheitert einmal: Pause, zweiter Versuch, Vermerk an der Karte, der Lauf geht weiter", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Erstes Paket");
    const b = karte(dir, "Zweites Paket");
    stoeren(dir, `^issue get ${a}$`, 1);
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, [], { NIGHT_CLAUDE_CMD: fake(log, ERFOLG) });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.match(res.stdout, /Umgebungsfehler: board\.mjs issue get \d+ schlug fehl.*Board-Timeout/);
    assert.match(res.stdout, /2\. Versuch nach \d+(\.\d+)? s Pause/);
    assert.deepEqual(sitzungen(log), [a, b], "der Lauf ging nach dem zweiten Versuch nicht weiter");
    assert.equal(spalte(dir, a), "in_review");
    assert.equal(spalte(dir, b), "in_review");
    const text = laufstand(dir, a);
    assert.ok(text, "die Karte traegt keinen Laufstand");
    assert.match(text, /2\. Versuch/);
    // Der Fake hinterlaesst keinen Pruefnachweis; die Runde endet darum ohne gueltigen
    // Nachweis — hier zaehlt, dass ihr Stand den Vermerk traegt.
    assert.match(text, /Runde beendet: \w+ um /);
    // Seit Issue #1089 (E2) steht jedes Paket mit Laufstand — den Vermerk traegt nur die erste.
    assert.doesNotMatch(laufstand(dir, b), /2\. Versuch/, "die zweite Karte hatte keinen Umgebungsfehler");
  });
});

// --- Board scheitert zweimal: der Lauf haelt an ---

test("[E15] scheitert auch der zweite Versuch am Board, haelt der Lauf an und die naechsten Karten zeigen 'nicht begonnen'", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Erstes Paket");
    const b = karte(dir, "Zweites Paket");
    const c = karte(dir, "Drittes Paket");
    const idee = karte(dir, "[Idee] Bleibt am Gate");
    const fremd = karte(dir, "Ohne Routing-Label", { labels: [] });
    stoeren(dir, `^issue get ${b}$`, 2);
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, [], { NIGHT_CLAUDE_CMD: fake(log, ERFOLG) });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sitzungen(log), [a], "nach dem Anhalten lief noch eine Session");
    assert.equal(spalte(dir, a), "in_review");
    assert.doesNotMatch(laufstand(dir, a), /2\. Versuch/);

    assert.ok(labels(dir, b).includes("lauf:abgebrochen"), `Labels #${b}: ${labels(dir, b)}`);
    assert.match(laufstand(dir, b), /2\. Versuch/);
    assert.match(laufstand(dir, b), /Board-Timeout/);

    assert.ok(labels(dir, c).includes("lauf:wartet"), `Labels #${c}: ${labels(dir, c)}`);
    const text = laufstand(dir, c);
    assert.match(text, /nicht begonnen/);
    assert.match(text, /Board-Timeout/, "der Grund fehlt");
    assert.match(text, /um \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "der Zeitpunkt fehlt");

    assert.equal(laufstand(dir, idee), null, "eine Karte, die am Gate scheitert, waere nicht aufgenommen worden");
    assert.equal(laufstand(dir, fremd), null, "eine Karte ohne Routing-Label waere nicht aufgenommen worden");
    assert.equal(spalte(dir, c), "ready", "eine nicht begonnene Karte bleibt, wo sie ist");
  });
});

// --- Belegfall #1008: der Sitzungsstart scheitert ---

test("[#1008] Sitzungsstart mit Exit ungleich 0 ohne Sitzungsereignis: ein Versuch nach der Pause", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Erstes Paket");
    const b = karte(dir, "Zweites Paket");
    const log = join(dir, "helfer", "sessions.log");
    const merker = join(dir, "helfer", "einmal");
    const res = run(dir, [], {
      NIGHT_CLAUDE_CMD: fake(log, `if [ ! -f ${JSON.stringify(merker)} ]; then touch ${JSON.stringify(merker)}; echo "Failed to start: connection reset" >&2; exit 1; fi; ${ERFOLG}`),
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sitzungen(log), [a, a, b], "der Sitzungsstart wurde nicht genau einmal wiederholt");
    assert.match(res.stdout, /Umgebungsfehler: Sitzungsstart zu #\d+ gescheitert \(Exit 1\)/);
    assert.equal(spalte(dir, a), "in_review");
    assert.equal(spalte(dir, b), "in_review");
    assert.match(laufstand(dir, a), /2\. Versuch/);
    assert.doesNotMatch(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/);
  });
});

test("[#1008] scheitert auch der zweite Sitzungsstart, haelt der Lauf an", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Erstes Paket");
    const b = karte(dir, "Zweites Paket");
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, [], { NIGHT_CLAUDE_CMD: fake(log, 'echo "Failed to start" >&2; exit 1') });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sitzungen(log), [a, a]);
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/);
    assert.equal(spalte(dir, a), "ready", "eine kaputte Umgebung bewegt keine Karte");
    assert.ok(labels(dir, a).includes("lauf:abgebrochen"), `Labels #${a}: ${labels(dir, a)}`);
    assert.match(laufstand(dir, a), /2\. Versuch/);
    assert.ok(labels(dir, b).includes("lauf:wartet"), `Labels #${b}: ${labels(dir, b)}`);
    assert.match(laufstand(dir, b), /nicht begonnen/);
  });
});

// --- Paket: die Sitzung kam zustande ---

test("[E13] eine Sitzung, die zustande kam und ohne Ergebnis endete, ist ein Paketfehler ohne Versuch", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Scheitert an sich");
    const b = karte(dir, "Laeuft danach");
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, [], {
      NIGHT_CLAUDE_CMD: fake(log, `if [ "$NIGHT_ISSUE_ID" = "${a}" ]; then ${EREIGNIS}; exit 1; fi; ${ERFOLG}`),
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sitzungen(log), [a, b], "eine zustande gekommene Sitzung wurde wiederholt");
    assert.doesNotMatch(res.stdout, /2\. Versuch/);
    assert.doesNotMatch(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/);
    assert.notEqual(spalte(dir, a), "in_review");
    assert.equal(spalte(dir, b), "in_review");
    // Der Paketfehler steht an seiner Karte (Issue #1089, E2): abgebrochen, mit Grund.
    assert.ok(labels(dir, a).includes("lauf:abgebrochen"), `Labels #${a}: ${labels(dir, a)}`);
    assert.match(laufstand(dir, a), /Runde beendet: deferred um [^\n]+\n\nGrund: /);
  });
});

// --- Laufstand je Paket (Issue #1089, E2) ---

test("[E2] jedes Paket steht mit Laufstand: laeuft zu Rundenbeginn, danach sein Ausgang", NUR_POSIX, () => {
  mitDir((dir) => {
    const a = karte(dir, "Ein Paket");
    const log = join(dir, "helfer", "sessions.log");
    // Die Session sieht ihre eigene Karte: Der Stand `laeuft` steht schon, waehrend sie arbeitet.
    const res = run(dir, [], { NIGHT_CLAUDE_CMD: fake(log, `grep -q "lauf:laeuft" issues/$NIGHT_ISSUE_ID.md && echo laeuft >> ${JSON.stringify(log)}; ${ERFOLG}`) });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(sitzungen(log), [a, "laeuft"], "zu Rundenbeginn stand kein laeuft an der Karte");
    // Ohne Pruefnachweis kein `fertig`: Die Karte steht in In review, ihr Stand nennt den Mangel.
    assert.ok(labels(dir, a).includes("lauf:abgebrochen"), `Labels #${a}: ${labels(dir, a)}`);
    assert.match(laufstand(dir, a), /Runde beendet: fehlschlag um [^\n]+\n\nNachweis fehlt/);
  });
});

// --- Die Kette: Pakete des Auftrags ohne Ergebnis ---

test("[E15] haelt die Kette wegen der Umgebung an, zeigen die Pakete des Auftrags ohne Ergebnis 'nicht begonnen'", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, abdeckung: 'echo "Failed to start" >&2; exit 1' } });
    const res = ketteRun(dir, ["--kette"], env);
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);

    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "abdeckung").length, 2, "der Sitzungsstart wurde nicht genau einmal wiederholt");
    const lauf = stand(dir);
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.ok(einheit, "keine Einheit der Kette");
    const fachKarte = readFileSync(join(dir, "issues", `${F}.md`), "utf-8");
    assert.match(fachKarte, /lauf:abgebrochen/);
    assert.match(fachKarte, /2\. Versuch/);

    const pakete = readdirSync(join(dir, "issues")).map((n) => readFileSync(join(dir, "issues", n), "utf-8"))
      .filter((t) => /^title: "?Paket \d/m.test(t));
    assert.equal(pakete.length, 2, "die Pakete fehlen");
    for (const text of pakete) {
      assert.match(text, /lauf:wartet/);
      assert.match(text, /nicht begonnen/);
    }
  }, {}, "night-umgebung-kette-", { night: { stand: { pauseMin: PAUSE_MIN } } });
});
