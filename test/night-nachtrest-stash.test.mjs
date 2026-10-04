// Ein gescheitertes Paket haelt nur sich und seine Abhaengigen an (Issue #1089, Plan #1079
// E2, E14, E15).
//
// Belegfall 4 aus #1075: Ein einzelnes gescheitertes Paket hielt die ganze Nacht an. Jetzt
// steht jedes Paket mit seinem Laufstand an der Karte — `laeuft` zu Rundenbeginn, `fertig`
// bei In review mit Nachweis, `abgebrochen` mit Grund bei Fehlschlag. Reste nach einer
// gescheiterten Rettung landen im Stash `nachtrest #<id> <lauf>`, und die Nacht laeuft
// weiter. Ein Paket, das an einem in diesem Lauf abgebrochenen Paket haengt, zeigt `wartet`.
// Reste nach einem Erfolg bleiben harter Stopp.
//
// Geprueft am lokalen Tracker mit dem echten CLI und dem echten checks.mjs (die Rettung
// faehrt die Pflicht-Checks extern, bevor sie startet).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Eigener Sperrpfad je Testprozess (Issue #958): die Rettung faehrt das echte checks.mjs.
import "./helpers/checks-sperre.mjs";
import { UMSETZUNG_ERFOLG } from "./helpers/kette-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, env = {}) {
  return spawnSync(process.execPath, [NIGHT], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, KIT_NIGHT_WAECHTER: "0", NIGHT_VORFLUG_CMD: "true", ...env },
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
  const dir = mkdtempSync(join(tmpdir(), "night-nachtrest-"));
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    mkdirSync(join(dir, "helfer"), { recursive: true });
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
    copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    }, null, 2));
    writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*\n.claude/checks-summary.json\n.claude/night-umsetzung.lock\n.claude/wegmarken.tsv\n.claude/bewegungen.tsv\n.claude/ausfuehrungen.tsv\n.claude/lauf/\n.claude/protokolle/\nissues/\nhelfer/\n");
    writeFileSync(join(dir, "code.txt"), "Bestand\n");
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

function karte(dir, titel, abhaengigkeiten = "Keine.") {
  const { id } = board(dir, "issue", "create", "--title", titel, "--body", `## Abhängigkeiten\n\n${abhaengigkeiten}`);
  board(dir, "issue", "label", "add", String(id), "kit:nightrun");
  board(dir, "issue", "move", String(id), "ready");
  return String(id);
}

const roh = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const labels = (dir, id) => board(dir, "issue", "get", id).labels;
const spalte = (dir, id) => board(dir, "issue", "get", id).status;

/** Der letzte Laufstand-Kommentar einer Karte oder `null`. */
function laufstand(dir, id) {
  const bloecke = roh(dir, id).split("\n---\n**Kommentar**").slice(1).filter((b) => /\n## Laufstand\b/.test(b));
  return bloecke.at(-1) ?? null;
}

/** Die Zustaende einer Karte im Journal des Laufs, in Zeilenfolge. */
function journalZustaende(dir, id) {
  const ordner = join(dir, ".claude", "lauf");
  const journal = readdirSync(ordner).find((n) => n.endsWith(".jsonl"));
  return readFileSync(join(ordner, journal), "utf-8").trim().split("\n").map((z) => JSON.parse(z))
    .filter((z) => z.art === "stand" && z.karte === id).map((z) => z.zustand);
}

const sitzungen = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n").filter(Boolean) : []);

/** Die Fake-Session: protokolliert (die Rettung mit Zusatz) und verzweigt je Karte. */
function fake(logPfad, faelle, sonst = ":") {
  const zweige = Object.entries(faelle).map(([id, zeilen]) => `  ${id}) ${zeilen} ;;`).join("\n");
  return [
    `echo "$NIGHT_ISSUE_ID\${NIGHT_SALVAGE:+-rettung}" >> ${JSON.stringify(logPfad)}`,
    'if [ -n "$NIGHT_SALVAGE" ]; then exit 0; fi',
    'case "$NIGHT_ISSUE_ID" in', zweige, `  *) ${sonst} ;;`, "esac",
  ].join("\n");
}

test("[Belegfall 4] ein Paket ohne Ergebnis und eines mit Resten nach gescheiterter Rettung halten nur sich an — Stash, Laufstand, das unabhaengige Paket laeuft", () => {
  mitDir((dir) => {
    const ohne = karte(dir, "Ohne Ergebnis");
    const reste = karte(dir, "Laesst Reste liegen");
    const abhaengig = karte(dir, "Haengt am Paket mit Resten", `Issue #${reste}`);
    const frei = karte(dir, "Unabhaengig");
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, {
      NIGHT_CLAUDE_CMD: fake(log, {
        [reste]: `echo halb >> code.txt; echo neu > neu-${reste}.txt`,
        [frei]: UMSETZUNG_ERFOLG,
      }),
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/);
    assert.deepEqual(sitzungen(log), [ohne, reste, `${reste}-rettung`, frei], "das unabhaengige Paket lief nicht");

    // Der Stash traegt die Reste samt unversionierter Datei, der Baum ist danach sauber.
    const stashes = git(dir, "stash", "list");
    assert.match(stashes, new RegExp(String.raw`: nachtrest #${reste} \d{4}-\S+$`, "m"), stashes);
    assert.match(git(dir, "diff", "--name-only", "stash@{0}^1", "stash@{0}"), /^code\.txt$/m);
    assert.match(git(dir, "ls-tree", "-r", "--name-only", "stash@{0}^3"), new RegExp(`^neu-${reste}\\.txt$`, "m"));
    assert.equal(git(dir, "status", "--porcelain", "--", ".", ":(exclude)issues"), "");
    assert.doesNotMatch(git(dir, "show", "--name-only", "--format=", "HEAD"), /neu-|code\.txt/, "das naechste Paket baute auf den Resten auf");

    // Beide gescheiterten Pakete stehen mit Stand und Grund.
    assert.ok(labels(dir, ohne).includes("lauf:abgebrochen"), `Labels #${ohne}: ${labels(dir, ohne)}`);
    assert.match(laufstand(dir, ohne), /Runde beendet: deferred um /);
    assert.match(laufstand(dir, ohne), /Grund: [^\n]+; die Karte ging ins Backlog/);
    assert.ok(labels(dir, reste).includes("lauf:abgebrochen"), `Labels #${reste}: ${labels(dir, reste)}`);
    assert.match(laufstand(dir, reste), /Runde beendet: abgebrochen um /);
    assert.match(laufstand(dir, reste), new RegExp(`Stash „nachtrest #${reste} `));
    assert.match(laufstand(dir, reste), /SALVAGE-VERSUCH gescheitert/);
    assert.equal(spalte(dir, reste), "backlog");
    assert.match(roh(dir, reste), new RegExp(`Die Reste liegen im Stash „nachtrest #${reste} `));

    // Das abhaengige Paket wartet, sein Rueckstell-Kommentar ist der von heute.
    assert.ok(labels(dir, abhaengig).includes("lauf:wartet"), `Labels #${abhaengig}: ${labels(dir, abhaengig)}`);
    assert.match(laufstand(dir, abhaengig), new RegExp(`hängt an #${Number(reste)} \\(abgebrochen in diesem Lauf\\)`));
    assert.ok(roh(dir, abhaengig).includes(`Nachtlauf: Abhaengigkeit #${Number(reste)} nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.\n\nAbhaengigkeiten, wie der Nachtlauf sie liest:`));
    assert.equal(spalte(dir, abhaengig), "backlog");

    // Laufstand je Paket: laeuft zu Rundenbeginn, fertig bei In review mit Nachweis.
    assert.equal(spalte(dir, frei), "in_review");
    assert.deepEqual(journalZustaende(dir, frei), ["laeuft", "fertig"]);
    assert.match(laufstand(dir, frei), /In review mit Nachweis \(geprueft\), Commit [0-9a-f]+/);
    assert.ok(!labels(dir, frei).some((l) => l.startsWith("lauf:")), `Labels #${frei}: ${labels(dir, frei)}`);
    assert.deepEqual(journalZustaende(dir, ohne), ["laeuft", "abgebrochen"]);
    assert.deepEqual(journalZustaende(dir, abhaengig), ["wartet"]);

    assert.match(res.stdout, /Nacht-Runner beendet: 1 erfolgreich, 2 zurueckgestellt, 0 ohne gueltigen Nachweis, 3 Session\(s\) gestartet, 0 angehalten, 1 abgebrochen mit Resten im Stash\./);
  });
});

test("[E14] Reste nach einem Erfolg bleiben harter Stopp — kein Stash, kein weiteres Paket", () => {
  mitDir((dir) => {
    const a = karte(dir, "Erfolg mit Rest");
    const b = karte(dir, "Laeuft nicht mehr");
    const log = join(dir, "helfer", "sessions.log");
    const res = run(dir, { NIGHT_CLAUDE_CMD: fake(log, { [a]: `${UMSETZUNG_ERFOLG}; echo rest > rest.txt` }) });
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /HARTER STOPP: erfolgreiche Runde zu Issue #\d+ hat unkommittete Reste hinterlassen/);
    assert.deepEqual(sitzungen(log), [a]);
    assert.equal(git(dir, "stash", "list"), "");
    assert.ok(existsSync(join(dir, "rest.txt")), "der Rest wurde angefasst");
    assert.ok(labels(dir, a).includes("lauf:abgebrochen"), `Labels #${a}: ${labels(dir, a)}`);
    assert.equal(spalte(dir, b), "ready");
  });
});
