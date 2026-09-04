// Das Commit-Gate (Issue #470).
//
// `.githooks/gate.mjs` entscheidet, ob ein Commit entstehen darf: Es liest die
// Pruef-Zusammenfassung, die `checks.mjs run` hinterlassen hat, und vergleicht
// sie gegen den Index. Echtes Repo statt Fixture, wie in den uebrigen
// checks-Tests — die Fragen, um die es geht (gestagte Loeschung, Umbenennung,
// nachtraeglich geaenderte Datei), lassen sich nicht mocken.
//
// Der Gruenfall und der Fall mit leerer buildChecks-Liste erzeugen die
// Zusammenfassung ueber `checks.mjs run`, nicht per Hand: Sonst pruefte der Test
// die eigene Annahme ueber das Format statt den Bestand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mitRepo, git, run, datei } from "./helpers/checks-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(repoRoot, ".githooks", "gate.mjs");
const HOOK = join(repoRoot, ".githooks", "pre-commit");
const LEISE = { buildChecks: ["node -e \"process.exit(0)\""] };

/** Ruft das Gate im Wegwerf-Repo auf. `checks.mjs` liegt dort unter `.claude/kit/`. */
function gate(dir, ...args) {
  return spawnSync(process.execPath, [join(dir, ".githooks", "gate.mjs"), ...args], {
    cwd: dir,
    encoding: "utf-8",
  });
}

/** Legt Hook und Gate im Wegwerf-Repo an — das macht sonst der Installer (#473). */
function gateEinbauen(dir, { checksOrt = ".claude/kit" } = {}) {
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  writeFileSync(join(dir, ".githooks", "gate.mjs"), readFileSync(GATE, "utf-8"), "utf-8");
  writeFileSync(join(dir, ".githooks", "pre-commit"), readFileSync(HOOK, "utf-8"), { mode: 0o755 });
  if (checksOrt) {
    mkdirSync(join(dir, checksOrt), { recursive: true });
    writeFileSync(join(dir, checksOrt, "checks.mjs"), readFileSync(join(repoRoot, "kit", "checks.mjs"), "utf-8"), "utf-8");
  }
}

function zusammenfassungSchreiben(dir, daten) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(daten, null, 2) + "\n", "utf-8");
}

function zusammenfassungLesen(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8"));
}

test("[gate-1] gruene Zusammenfassung mit passenden Hashes wird angenommen — auch bei Umlaut im Namen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "Änderung.md", "Inhalt\n");
    run(dir);
    git(dir, "add", "Änderung.md");
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] fehlende Zusammenfassung wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /fehlt/);
    assert.match(res.stderr, /checks\.mjs run/);
  });
});

test("[gate-1] unlesbare Zusammenfassung wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "checks-summary.json"), "{kein json", "utf-8");
    datei(dir, "a.txt", "A\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /unlesbar/);
  });
});

test("[gate-1] gueltiges JSON ohne hashes wird als altes Format abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    zusammenfassungSchreiben(dir, { basis: "abc", geaendert: ["a.txt"], laufen: [] });
    datei(dir, "a.txt", "A\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /altes Format/);
  });
});

test("[gate-1] ein rotes Ergebnis wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    run(dir);
    const z = zusammenfassungLesen(dir);
    z.laufen = [{ cmd: "x", grund: "g", ergebnis: "rot" }];
    zusammenfassungSchreiben(dir, z);
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /rot/);
  });
});

test("[gate-1] ein nicht gestartetes Kommando wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    run(dir);
    const z = zusammenfassungLesen(dir);
    z.laufen = [{ cmd: "x", grund: "g", ergebnis: "nicht gestartet" }];
    zusammenfassungSchreiben(dir, z);
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /nicht gestartet/);
  });
});

test("[gate-1] eine gestagte Datei, die in hashes fehlt, wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    run(dir);
    datei(dir, "spaet.txt", "spaet\n");
    git(dir, "add", "spaet.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /spaet\.txt/);
    assert.match(res.stderr, /nicht geprueft/);
  });
});

test("[gate-1] eine nach der Pruefung geaenderte Datei wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "VORHER\n");
    run(dir);
    datei(dir, "a.txt", "NACHHER\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /a\.txt/);
    assert.match(res.stderr, /nach der Pruefung geaendert/);
  });
});

test("[gate-1] eine gestagte Loeschung mit null-Tombstone wird angenommen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    git(dir, "rm", "-q", "--cached", "README.md");
    rmSync(join(dir, "README.md"));
    run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] eine gestagte Loeschung ohne Tombstone wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    run(dir);
    git(dir, "rm", "-q", "README.md");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /README\.md/);
    assert.match(res.stderr, /Loeschung nicht geprueft/);
  });
});

test("[gate-1] eine gestagte Umbenennung wird angenommen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    git(dir, "mv", "README.md", "LIESMICH.md");
    run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] leeres Paket bei nicht leerem Index wird abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    run(dir);
    datei(dir, "spaet.txt", "x\n");
    git(dir, "add", "spaet.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /nicht geprueft/);
  });
});

test("[gate-1] leerer Index wird bei gruener Zusammenfassung angenommen und ohne abgewiesen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    run(dir);
    assert.equal(gate(dir, "pre-commit").status, 0, "leerer Index bei gruener Zusammenfassung");
    rmSync(join(dir, ".claude", "checks-summary.json"));
    assert.notEqual(gate(dir, "pre-commit").status, 0, "leerer Index ohne Zusammenfassung");
  });
});

test("[gate-1] leere buildChecks-Liste wird angenommen, und das Gate liest dabei keine Config", () => {
  mitRepo({ config: { buildChecks: [] } }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    run(dir);
    git(dir, "add", "a.txt");
    rmSync(join(dir, ".claude", "workflow.config.json"));
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] das Gate findet checks.mjs auch unter kit/", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir, { checksOrt: "kit" });
    run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] ohne checks.mjs an beiden Orten weist das Gate ab und nennt den Installer", () => {
  mitRepo({ config: LEISE }, (dir) => {
    run(dir);
    gateEinbauen(dir, { checksOrt: null });
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /checks\.mjs/);
    assert.match(res.stderr, /install/i);
  });
});

test("[gate-1] der Hook ist POSIX-sh, ausfuehrbar und faellt ohne node sichtbar aus", { skip: process.platform === "win32" }, () => {
  const syntax = spawnSync("sh", ["-n", HOOK], { encoding: "utf-8" });
  assert.equal(syntax.status, 0, `sh -n meldete: ${syntax.stderr}`);
  assert.match(readFileSync(HOOK, "utf-8"), /^#!\/bin\/sh/);

  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
    // Aufruf aus einem anderen Arbeitsverzeichnis und mit PATH ohne node: Der Hook
    // muss gate.mjs relativ zu sich selbst finden und den Ausfall melden.
    const res = spawnSync("sh", [join(dir, ".githooks", "pre-commit")], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, PATH: "/nonexistent" },
    });
    assert.notEqual(res.status, 0, "ohne node darf der Hook nicht durchlassen");
    assert.ok(`${res.stderr}${res.stdout}`.length > 0, "der Ausfall muss sichtbar sein");
  });
});

test("[gate-1] gate.mjs und der Hook liegen unter .githooks/", () => {
  assert.ok(existsSync(GATE), "gate.mjs fehlt");
  assert.ok(existsSync(HOOK), "pre-commit fehlt");
});
