// Der volle Prüfstand der Einheit (Issue #749, Review-Fund).
//
// `lesePruefung()` reichte bisher nur `laufen` und `ausgelassen` durch. Kriterium 2 der
// Auswertung fragt, wie oft eine Pruefung im vollen statt im eingegrenzten Umfang lief —
// dafuer braucht der Prufstand zusaetzlich `vollerUmfang`, `leeresPaket`, `basis`,
// `bereiche` und `dauerGesamtMs` aus der Pruef-Zusammenfassung von checks.mjs.
//
// E2E wie test/night-ergebnisstand.test.mjs: Der Fake schreibt die Zusammenfassung
// selbst statt checks.mjs — der Test misst, was der Runner aus der Datei macht, nicht
// wie sie entsteht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
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

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Der eine Ergebnisstand des Laufs. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einem Issue. */
function einheit(dir, id) {
  const s = stand(dir);
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';

/** Eine Pruef-Zusammenfassung mit vollem Prüfstand, geschrieben vom Fake statt checks.mjs. */
function summary(felder) {
  return `printf '%s' '${JSON.stringify(felder)}' > .claude/checks-summary.json`;
}

test("[night-46] eine Zusammenfassung mit vollerUmfang: true traegt vollerUmfang, leeresPaket, basis, bereiche und dauerGesamtMs im Prüfstand", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-voll-");
  try {
    const id = readyIssue(dir, "Voller Umfang");
    const zusammenfassung = {
      laufen: [{ cmd: "true", ergebnis: "gruen", grund: "kein Anker lesbar", dauerMs: 42 }],
      ausgelassen: [],
      vollerUmfang: true,
      leeresPaket: false,
      basis: "HEAD",
      bereiche: ["kit", "test"],
      dauerGesamtMs: 42,
    };
    const fake = [summary(zusammenfassung), ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const p = einheit(dir, id).pruefung;
    assert.equal(p.zustand, "geprueft");
    assert.equal(p.vollerUmfang, true);
    assert.equal(p.leeresPaket, false);
    assert.equal(p.basis, "HEAD");
    assert.deepEqual(p.bereiche, ["kit", "test"]);
    assert.equal(p.dauerGesamtMs, 42);
    // Die laufen-Eintraege tragen ihr dauerMs unveraendert mit.
    assert.equal(p.laufen[0].dauerMs, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-46] eine Zusammenfassung ohne vollerUmfang (alter Stand) traegt vollerUmfang: null, nicht false", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-alt-");
  try {
    const id = readyIssue(dir, "Alter Stand ohne Umfangsfelder");
    // Ein Stand aus der Zeit vor Issue #749: nur laufen und ausgelassen, keine der neuen Felder.
    const zusammenfassung = { laufen: [{ cmd: "true", ergebnis: "gruen", grund: "beruehrt" }], ausgelassen: [] };
    const fake = [summary(zusammenfassung), ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const p = einheit(dir, id).pruefung;
    assert.equal(p.zustand, "geprueft");
    assert.equal(p.vollerUmfang, null, "ein fehlendes Feld ist unbekannt, nicht eingegrenzt");
    assert.equal(p.leeresPaket, null);
    assert.equal(p.basis, null);
    assert.equal(p.bereiche, null);
    assert.equal(p.dauerGesamtMs, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-46] die bestehenden Zustaende bleiben gleich: rot, leeresPaket und unlesbar tragen weiterhin ihren Zustand", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-zustaende-");
  try {
    // rot: ein nicht gruener Eintrag.
    const rotesIssue = readyIssue(dir, "Rote Pruefung");
    const rot = { laufen: [{ cmd: "true", ergebnis: "rot", grund: "beruehrt" }], ausgelassen: [], vollerUmfang: false };
    const fakeRot = [summary(rot), 'echo dirty > "dirty-$NIGHT_ISSUE_ID.txt"'].join("\n");
    const resRot = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose", "--max", "1"], { NIGHT_CLAUDE_CMD: fakeRot });
    assert.equal(resRot.status, 1, "eine unbewegte, unsaubere Karte stoppt hart");
    assert.equal(einheit(dir, rotesIssue).pruefung.zustand, "rot");
    assert.equal(einheit(dir, rotesIssue).pruefung.vollerUmfang, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-46] leeresPaket traegt ebenfalls die Umfangsfelder", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-leer-");
  try {
    const id = readyIssue(dir, "Leeres Paket");
    const leer = { leeresPaket: true, basis: "abc123", bereiche: [], dauerGesamtMs: 3 };
    const fake = [summary(leer), ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const p = einheit(dir, id).pruefung;
    assert.equal(p.zustand, "leeresPaket");
    assert.equal(p.leeresPaket, true);
    assert.equal(p.basis, "abc123");
    assert.deepEqual(p.bereiche, []);
    assert.equal(p.dauerGesamtMs, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-46] eine unlesbare Zusammenfassung bleibt unlesbar", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-unlesbar-");
  try {
    const id = readyIssue(dir, "Unlesbare Zusammenfassung");
    const fake = [
      "printf '%s' 'kein json' > .claude/checks-summary.json",
      ARBEIT_UND_COMMIT,
      NACH_IN_REVIEW,
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(einheit(dir, id).pruefung.zustand, "unlesbar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-46] ungeprueft (keine Zusammenfassungsdatei) bleibt unveraendert", NUR_POSIX, () => {
  const dir = setupProjekt("night-pruefstand-ungeprueft-");
  try {
    const id = readyIssue(dir, "Ungeprueft");
    const fake = [ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(einheit(dir, id).pruefung.zustand, "ungeprueft");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
