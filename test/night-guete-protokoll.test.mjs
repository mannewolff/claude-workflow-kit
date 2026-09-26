// Die Guetemessung im Protokoll des Nacht-Runners (Issue #764, Plan #753,
// fachliche Quelle #738).
//
// Die Messung laeuft seit Issue #763, aber sie ist nur dort sichtbar, wo gerade
// gemessen wird. AK 9 des Fachplans verlangt den Anteil nach jedem Lauf — auch
// wenn er genuegt: Sonst bliebe genau das Problem bestehen, das der Fachplan
// beschreibt, naemlich dass das Ergebnis angesehen wird und dann nichts
// passiert. Der Runner liest die Zusammenfassung ohnehin schon; eine Zeile mehr
// kostet nichts und ist die Stelle, an der ein Absinken frueh auffaellt (E6).
//
// Die zweite Aussage ist die wichtigere: Die Zeile ist ein Protokoll und kein
// Gate. Ein Halt wegen verfehlter Marke ist bereits ueber den roten Lauf
// abgebildet (Issue #763) — der Ausgang eines Laufs darf sich dadurch, dass das
// Feld in der Zusammenfassung steht, nicht aendern.
//
// Wie in test/night-checks-bericht.test.mjs faehrt der Session-Fake den ECHTEN
// `checks.mjs run`: Ein von Hand geschriebenes JSON wuerde das Format einfrieren,
// das die andere Datei pflegt — und genau die Kopplung, um die es geht, nicht
// pruefen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

/** Ein Kommando im PIT-Format: `Killed 42 (84%)` in der Ausgabe. */
const MISST_84 = `node -e "console.log('Killed 42 (84%)')"`;
const MUSTER = String.raw`\((\d+)%\)`;

// Das Gate des Abschlusses: ein Paketstufen-Eintrag, der weder eine Guetemessung noch
// `nichtBeimAbschluss` traegt. Ohne ihn startet der Nacht-Runner nicht (Issue #950), und
// er steht in BEIDEN Konfigurationen, damit sie bis auf das guete-Feld gleich bleiben —
// der dritte Test vergleicht sie.
const GATE = { cmd: "true", always: true };

/** Dasselbe Kommando einmal als Guetemessung und einmal als gewoehnliche Pruefung. */
const MIT_GUETE = [{ cmd: MISST_84, always: true, guete: { muster: MUSTER, marke: 80 } }, GATE];
const OHNE_GUETE = [{ cmd: MISST_84, always: true }, GATE];

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(buildChecks) {
  const dir = mkdtempSync(join(tmpdir(), "night-guete-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  for (const datei of ["board.mjs", "checks.mjs"]) {
    copyFileSync(join(repoRoot, "kit", datei), join(dir, ".claude", "kit", datei));
  }
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks,
    checkAreas: { kit: ["kit/**"] }, local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "bestand.txt"), "Bestand\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const FAKE = [
  'echo "$NIGHT_ISSUE_ID" >> sessions.log',
  'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"',
  "node .claude/kit/checks.mjs run > /dev/null 2>&1",
  'git add -A && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"',
  'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
].join("\n");

/** Ein vollstaendiger Nachtlauf ueber ein Ready-Issue; liefert Ausgang und Protokoll. */
function lauf(buildChecks, fn) {
  const dir = setupProjekt(buildChecks);
  try {
    const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const id = String(issue.id);
    board(dir, "issue", "move", id, "ready");
    assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
    assert.equal(run(dir, "git", ["commit", "-q", "-m", "Issues"]).status, 0);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE });
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    fn({ dir, id, res, inReview: board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id)) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gueteZeile = (stdout, id) => stdout.split("\n").find((z) => z.includes(`Issue #${id}`) && /Guete/.test(z));

test("[night-49] traegt die Zusammenfassung ein guete-Feld, nennt das Protokoll Anteil und Marke", NUR_POSIX, () => {
  lauf(MIT_GUETE, ({ id, res }) => {
    const zeile = gueteZeile(res.stdout, id);
    assert.ok(zeile, `keine Guete-Zeile fuer Issue #${id} im Protokoll:\n${res.stdout}`);
    assert.match(zeile, /84 %/, "der erreichte Anteil fehlt in der Zeile");
    assert.match(zeile, /Marke 80 %/, "die Marke fehlt in der Zeile");
  });
});

test("[night-49] ohne guete-Feld steht keine solche Zeile im Protokoll", NUR_POSIX, () => {
  lauf(OHNE_GUETE, ({ id, res }) => {
    assert.equal(gueteZeile(res.stdout, id), undefined,
      `ohne Guetemessung darf keine Guete-Zeile entstehen:\n${res.stdout}`);
  });
});

test("[night-49] der Ausgang des Laufs ist derselbe, ob das guete-Feld vorliegt oder nicht", NUR_POSIX, () => {
  // Die Zeile ist ein Protokoll und kein Gate: Ein Halt wegen verfehlter Marke
  // ist bereits ueber den roten Lauf abgebildet (Issue #763). Verglichen werden
  // Exit-Code, Board-Zustand und die Summenzeile des Pruefteils — dieselbe
  // Messung, einmal benannt und einmal nicht.
  const ergebnisse = [];
  for (const checks of [MIT_GUETE, OHNE_GUETE]) {
    lauf(checks, ({ id, res, inReview }) => {
      ergebnisse.push({
        status: res.status,
        inReview: inReview.includes(id),
        // Ohne den Zeitstempel: Er steht vor jeder Protokollzeile und unterschiede
        // zwei sonst gleiche Laeufe.
        summe: (res.stdout.split("\n").find((z) => /Summe:/.test(z)) ?? "").replace(/^\[[^\]]+\]/, ""),
      });
    });
  }
  assert.equal(ergebnisse[0].status, ergebnisse[1].status);
  assert.equal(ergebnisse[0].inReview, true);
  assert.equal(ergebnisse[1].inReview, true);
  assert.ok(ergebnisse[0].summe, "der Pruefteil des Berichts fehlt");
  assert.equal(ergebnisse[0].summe, ergebnisse[1].summe,
    "das guete-Feld hat die Bilanz des Laufs veraendert");
});
