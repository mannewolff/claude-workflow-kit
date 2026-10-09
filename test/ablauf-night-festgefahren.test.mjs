// Ablauf-Pruefung: das festgefahrene Paket — vom Strom der Sitzung bis zu Stash, Karte,
// Einheit und Laufstand im Wegwerf-Repo (Issue #1390, Plan #1386, E2, E7–E10).
//
// Faehrt eine Sitzung dieselbe Pruefung zu oft gleich rot, bremst `checks.mjs run` sie
// (#1388), und der Runner beendet die Sitzung (#1389). Diese Datei haelt fest, wie der
// Runner die Runde danach wertet: als eigener Ausgang `festgefahren`, ohne Rettungsversuch,
// Aenderungen im Stash des Pakets, Karte mit Vermerk ins Backlog, Laufstand `abgebrochen`,
// und das naechste Paket beginnt auf sauberem Baum. Nicht als Zeitabbruch: Die beendete
// Sitzung traegt kein `zeitlimitBeendet`.
//
// Die Sitzung ist ein Fake ueber NIGHT_CLAUDE_CMD: Sie schreibt den Aufruf von
// `checks.mjs run` und dessen gebremstes Ergebnis in den Strom und haengt danach — die
// Bremse beendet sie lange vor der Zeitgrenze. Den Vermerkstext selbst prueft
// night-wartend-zeitlimit-vermerk im selben Prozess.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { FESTGEFAHREN_ANKER, ZEITLIMIT_ANKER, werteRunde, rundenMerkerZuruecksetzen, wartendAbhaengigkeiten } from "../kit/night/wartend.mjs";
import { FESTGEFAHREN_MARKE } from "../kit/night/session.mjs";
import { UMSETZUNG_ERFOLG } from "./helpers/kette-ablauf.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

// Woertlich ein zweites Mal — der Test ist die Gegenprobe zur Konstanten.
const GRUND_WORTLAUT = "Grund: Session an einer Pruefung festgefahren";
const PRUEFUNG = "npm test";
const FEHLER = "test/a.test.mjs: erwartet 2";
// Die Zeitgrenze der Runde: weit ueber der Bremse, damit ein Ende an der Uhr auffiele.
const TIMEOUT_MS = 20_000;

const UMGEBUNG = { NIGHT_TIMEOUT_MS: String(TIMEOUT_MS), NIGHT_KILL_GRACE_MS: "300" };

function run(cwd, env = {}) {
  return spawnSync(process.execPath, [NIGHT, "--label", "none"], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, KIT_NIGHT_WAECHTER: "0", NIGHT_VORFLUG_CMD: "true", ...UMGEBUNG, ...env },
  });
}

function git(cwd, ...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  return res.stdout;
}

function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd } });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function mitDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-festgefahren-"));
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    mkdirSync(join(dir, "helfer"), { recursive: true });
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
    cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
    copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    }, null, 2));
    writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*\n.claude/checks-summary.json\n.claude/night-umsetzung.lock\n.claude/wegmarken.tsv\n.claude/bewegungen.tsv\n.claude/ausfuehrungen.tsv\n.claude/lauf/\n.claude/protokolle/\nissues/\nhelfer/\n");
    writeFileSync(join(dir, "code.txt"), "Bestand\n");
    lfAttribute(join(dir, ".gitattributes"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "test@example.invalid");
    git(dir, "config", "user.name", "Night Test");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "setup");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function karte(dir, titel) {
  const { id } = board(dir, "issue", "create", "--title", titel, "--body", "## Abhängigkeiten\n\nKeine.");
  board(dir, "issue", "move", String(id), "ready");
  return String(id);
}

const roh = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const labels = (dir, id) => board(dir, "issue", "get", id).labels;
const spalte = (dir, id) => board(dir, "issue", "get", id).status;
const sitzungen = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n").filter(Boolean) : []);

/** Der letzte Laufstand-Kommentar einer Karte oder `null`. */
function laufstand(dir, id) {
  const bloecke = roh(dir, id).split("\n---\n**Kommentar**").slice(1).filter((b) => /\n## Laufstand\b/.test(b));
  return bloecke.at(-1) ?? null;
}

/** Die Einheit zu einem Issue aus der einen Ergebnisstand-Datei des Laufs. */
function einheit(dir, id) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n));
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet: ${dateien.join(", ")}`);
  const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const treffer = stand.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id}`);
  return treffer;
}

/** Die Strom-Zeilen eines gebremsten `checks.mjs run`, als Shell-Befehle. */
function gebremstImStrom() {
  const aufruf = { type: "assistant", message: { content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "node .claude/kit/checks.mjs run --abschluss 1" } }] } };
  const ergebnis = {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "c1", content: `Exit code 3\n${FESTGEFAHREN_MARKE} ${PRUEFUNG} — ${FEHLER}\n3-mal gleich gescheitert; es laeuft keine Pruefung mehr (Exit 3).\n` }] },
  };
  return `printf '%s\\n' '${JSON.stringify(aufruf)}'; printf '%s\\n' '${JSON.stringify(ergebnis)}'`;
}

/** Die Fake-Session: protokolliert (die Rettung mit Zusatz) und verzweigt je Karte. */
function fake(logPfad, faelle, sonst = ":") {
  const zweige = Object.entries(faelle).map(([id, zeilen]) => `  ${id}) ${zeilen} ;;`).join("\n");
  return [
    `echo "$NIGHT_ISSUE_ID\${NIGHT_SALVAGE:+-rettung}" >> ${JSON.stringify(logPfad)}`,
    'if [ -n "$NIGHT_SALVAGE" ]; then exit 0; fi',
    'case "$NIGHT_ISSUE_ID" in', zweige, `  *) ${sonst} ;;`, "esac",
  ].join("\n");
}

test("[night-1390] festgefahren mit Aenderungen: kein Salvage, Stash, Vermerk, Backlog, Laufstand abgebrochen — das naechste Paket beginnt sauber", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Faehrt sich fest");
    const naechstes = karte(dir, "Laeuft danach");
    const log = join(dir, "helfer", "sessions.log");
    const start = Date.now();
    const res = run(dir, {
      NIGHT_CLAUDE_CMD: fake(log, {
        [fest]: `echo halb >> code.txt; echo neu > neu-${fest}.txt; ${gebremstImStrom()}; sleep 30`, // # haengt — die Bremse beendet die Sitzung
        [naechstes]: UMSETZUNG_ERFOLG,
      }),
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(Date.now() - start < TIMEOUT_MS, "die Sitzung lief bis an die Zeitgrenze statt bis zur Bremse");
    assert.doesNotMatch(res.stdout, /HARTER STOPP|INFRASTRUKTUR/);
    assert.ok(res.stdout.includes(GRUND_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);

    // Kein Rettungsversuch: Er liefe nur erneut gegen dieselbe rote Pruefung.
    assert.deepEqual(sitzungen(log), [fest, naechstes], "eine Salvage-Session lief oder das naechste Paket fehlt");

    // Der Stash des Pakets traegt die Aenderungen, der Baum ist danach sauber.
    const stashes = git(dir, "stash", "list");
    assert.match(stashes, new RegExp(String.raw`: nachtrest #${fest} \d{4}-\S+$`, "m"), stashes);
    assert.match(git(dir, "diff", "--name-only", "stash@{0}^1", "stash@{0}"), /^code\.txt$/m);
    assert.equal(git(dir, "status", "--porcelain", "--", ".", ":(exclude)issues"), "");
    assert.doesNotMatch(git(dir, "show", "--name-only", "--format=", "HEAD"), /neu-|code\.txt/, "das naechste Paket baute auf den Aenderungen auf");
    assert.equal(spalte(dir, naechstes), "in_review");

    // Die Karte: Backlog, ein Kommentar mit Stash vorne und Vermerk unter dem neuen Anker.
    assert.equal(spalte(dir, fest), "backlog");
    const text = roh(dir, fest);
    const kommentar = text.split("\n---\n**Kommentar**").find((b) => b.includes(FESTGEFAHREN_ANKER));
    assert.ok(kommentar, `kein Vermerk unter ${FESTGEFAHREN_ANKER}:\n${text}`);
    assert.match(kommentar, new RegExp(`Die Reste liegen im Stash „nachtrest #${fest} `));
    assert.ok(kommentar.includes(PRUEFUNG) && kommentar.includes(FEHLER), kommentar);
    assert.match(kommentar, /Versuche: 3/);
    assert.ok(!text.includes(ZEITLIMIT_ANKER), "eine Bremsung ist kein Zeitabbruch");

    // Die Einheit: eigener Ausgang, das Feld festgefahren ganz hinten, kein Zeitlimit-Feld.
    const e = einheit(dir, fest);
    assert.equal(e.ausgang, "festgefahren");
    assert.equal(e.grund, GRUND_WORTLAUT);
    assert.equal(Object.keys(e).at(-1), "festgefahren", `das Feld steht nicht hinten: ${Object.keys(e).join(", ")}`);
    assert.deepEqual(e.festgefahren, { pruefung: PRUEFUNG, fehler: FEHLER, versuche: 3, zeitgrenzeMs: TIMEOUT_MS });
    assert.ok(!("zeitlimitBeendet" in e), JSON.stringify(e));

    // Laufstand abgebrochen (E10), mit dem Stash im Grund.
    assert.ok(labels(dir, fest).includes("lauf:abgebrochen"), `Labels #${fest}: ${labels(dir, fest)}`);
    assert.match(laufstand(dir, fest), /Runde beendet: festgefahren um /);
    assert.match(laufstand(dir, fest), new RegExp(`Stash „nachtrest #${fest} `));
  });
});

test("[night-1390] scheitert der Stash, endet die Nacht mit hartem Stopp", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Faehrt sich fest, Stash scheitert");
    const danach = karte(dir, "Laeuft nicht mehr");
    const log = join(dir, "helfer", "sessions.log");
    // Die Sperre des Index laesst `git stash push` scheitern; `git status` liest weiter.
    const res = run(dir, {
      NIGHT_CLAUDE_CMD: fake(log, { [fest]: `echo halb >> code.txt; touch .git/index.lock; ${gebremstImStrom()}; sleep 30` }), // # haengt — die Bremse beendet die Sitzung
    });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /HARTER STOPP: Reste zu Issue #\d+ liessen sich nicht im Stash sichern/);
    assert.deepEqual(sitzungen(log), [fest], "nach dem harten Stopp lief noch ein Paket oder eine Rettung");
    assert.equal(spalte(dir, danach), "ready");
    assert.equal(einheit(dir, fest).ausgang, "harterStopp");
  });
});

test("[night-1390] festgefahren bei sauberem Baum: kein Stash, Vermerk unter dem neuen Anker, kein zeitlimitBeendet", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Faehrt sich fest ohne Aenderung");
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, { NIGHT_CLAUDE_CMD: fake(log, { [fest]: `${gebremstImStrom()}; sleep 30` }) }); // # haengt — die Bremse beendet die Sitzung
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(git(dir, "stash", "list"), "");
    assert.equal(spalte(dir, fest), "backlog");
    const text = roh(dir, fest);
    assert.ok(text.includes(FESTGEFAHREN_ANKER), text);
    assert.match(text, /keine Aenderungen im Arbeitsverzeichnis/);
    assert.ok(!text.includes(ZEITLIMIT_ANKER), text);
    const e = einheit(dir, fest);
    assert.equal(e.ausgang, "festgefahren");
    assert.ok(!("zeitlimitBeendet" in e), JSON.stringify(e));
    assert.equal(Object.keys(e).at(-1), "festgefahren");
    assert.ok(labels(dir, fest).includes("lauf:abgebrochen"), `Labels #${fest}: ${labels(dir, fest)}`);
  });
});

test("[night-1390] eine Sitzung, die erst auf SIGKILL endet, ist kein Infrastrukturfehler", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Ignoriert SIGTERM");
    const log = join(dir, "helfer", "sessions.log");
    // Ein ignoriertes Signal erben auch die Kinder: Erst SIGKILL beendet die Gruppe.
    const res = run(dir, { NIGHT_CLAUDE_CMD: fake(log, { [fest]: `trap '' TERM; ${gebremstImStrom()}; while :; do sleep 0.2; done` }) }); // # haengt — die Bremse beendet die Sitzung
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/);
    assert.equal(einheit(dir, fest).ausgang, "festgefahren");
  });
});

test("[night-1390] ohne Strom: die ausgeloeste Bremse in der Zusammenfassung macht die Runde festgefahren", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Gebremst ohne Strom");
    const log = join(dir, "helfer", "sessions.log");
    const zusammenfassung = JSON.stringify({
      laufen: [],
      festgefahren: { folgen: {}, ausgeloest: { pruefung: PRUEFUNG, fehler: FEHLER, versuche: 4, zeitpunkt: "2026-10-09T03:00:00.000Z" } },
    });
    const res = run(dir, { NIGHT_CLAUDE_CMD: fake(log, { [fest]: `printf '%s' '${zusammenfassung}' > .claude/checks-summary.json` }) });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const e = einheit(dir, fest);
    assert.equal(e.ausgang, "festgefahren");
    assert.deepEqual(e.festgefahren, { pruefung: PRUEFUNG, fehler: FEHLER, versuche: 4, zeitgrenzeMs: TIMEOUT_MS });
    assert.ok(roh(dir, fest).includes(FESTGEFAHREN_ANKER));
  });
});

test("[night-1390] das Ergebnisobjekt von laufeImplementierung traegt festgefahren", () => {
  mitDir((dir) => {
    const fest = karte(dir, "Faehrt sich fest");
    const log = join(dir, "helfer", "sessions.log");
    // Im eigenen Prozess, denn die Schlusszeile des Einstiegs zeigt den Zaehler erst im
    // Darstellungspaket: Einstieg laden (bindet den Laufabschluss an), vorbereiten, laufen.
    const treiber = [
      `const n = await import(${JSON.stringify(pathToFileURL(NIGHT).href)});`,
      `const w = await import(${JSON.stringify(pathToFileURL(join(repoRoot, "kit", "night", "wartend.mjs")).href)});`,
      `const g = await import(${JSON.stringify(pathToFileURL(join(repoRoot, "kit", "night", "grundlagen.mjs")).href)});`,
      'const args = g.parseArgs(["--label", "none"]);',
      "const e = await w.laufeImplementierung(args, n.vorbereiten(args));",
      'console.log("ERGEBNIS " + JSON.stringify({ festgefahren: e.festgefahren, abgebrochen: e.abgebrochen, deferred: e.deferred }));',
      "process.exit(0);",
    ].join("\n");
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", treiber], {
      cwd: dir, encoding: "utf-8",
      env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: dir, KIT_NIGHT_WAECHTER: "0", NIGHT_VORFLUG_CMD: "true", ...UMGEBUNG,
        NIGHT_CLAUDE_CMD: fake(log, { [fest]: `${gebremstImStrom()}; sleep 30` }) }, // # haengt — die Bremse beendet die Sitzung
    });
    const zeile = res.stdout.split("\n").find((z) => z.startsWith("ERGEBNIS "));
    assert.ok(zeile, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(JSON.parse(zeile.slice("ERGEBNIS ".length)), { festgefahren: 1, abgebrochen: 0, deferred: 0 });
  });
});

// --- Der Infrastruktur-Guard im selben Prozess: ohne Sitzungsereignis, erst auf SIGKILL ---

after(() => wartendAbhaengigkeiten());

test("[night-1390] werteRunde: eine gebremste Sitzung ohne Ereignis und mit SIGKILL bleibt beim Paket", async () => {
  rundenMerkerZuruecksetzen();
  const aufrufe = [];
  wartendAbhaengigkeiten({
    board: (...args) => {
      aufrufe.push(args);
      return args[1] === "get" ? { id: "7", status: "in_progress", labels: [], comments: [] } : { ok: true };
    },
    leseKarte: () => ({ id: "7", status: "in_progress" }),
    gitClean: () => true,
    gitReste: () => [],
  });
  const ausgang = await werteRunde({
    top: { id: "7", title: "Gebremst" },
    res: { status: null, signal: "SIGKILL", error: null, stdout: "", stderr: "", timeoutMs: 60_000, festgefahren: { pruefung: PRUEFUNG, fehler: FEHLER, versuche: 3 } },
    minutes: "0.5", args: {}, salvageAttempted: new Set(), pruefung: { zustand: "rot", rotesKommando: PRUEFUNG, rotesErgebnis: "rot" },
    vorher: { id: "7", status: "in_progress", labels: [], comments: [] }, sessionWahl: { kommando: "mein-agent" },
  });
  assert.equal(ausgang, "festgefahren", "eine Bremsung ist kein gescheiterter Sitzungsstart");
  assert.deepEqual(aufrufe.filter((a) => a[1] === "move").map((a) => a[3]), ["backlog"]);
});
