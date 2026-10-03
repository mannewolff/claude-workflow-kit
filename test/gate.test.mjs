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
import { join } from "node:path";

import { mitRepo, git, run, datei, gate, gateEinbauen, posixShell, shellPfad, GATE, HOOK } from "./helpers/checks-repo.mjs";

const LEISE = { buildChecks: ["node -e \"process.exit(0)\""] };

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

/** Die Umgebung ohne jeden PATH-Eintrag — unter Windows heisst er `Path`. */
function ohnePath() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
}

test("[gate-1] der Hook ist POSIX-sh, ausfuehrbar und faellt ohne node sichtbar aus", () => {
  const syntax = spawnSync(posixShell(), ["-n", shellPfad(HOOK)], { encoding: "utf-8" });
  assert.equal(syntax.status, 0, `sh -n meldete: ${syntax.stderr}`);
  assert.match(readFileSync(HOOK, "utf-8"), /^#!\/bin\/sh/);

  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
    // Aufruf aus einem anderen Arbeitsverzeichnis und mit PATH ohne node: Der Hook
    // muss gate.mjs relativ zu sich selbst finden und den Ausfall melden.
    const res = spawnSync(posixShell(), [shellPfad(join(dir, ".githooks", "pre-commit"))], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...ohnePath(), PATH: "/nonexistent" },
    });
    assert.notEqual(res.status, 0, "ohne node darf der Hook nicht durchlassen");
    assert.ok(`${res.stderr}${res.stdout}`.length > 0, "der Ausfall muss sichtbar sein");
  });
});

test("[gate-1] gate.mjs und der Hook liegen unter .githooks/", () => {
  assert.ok(existsSync(GATE), "gate.mjs fehlt");
  assert.ok(existsSync(HOOK), "pre-commit fehlt");
});

// --- Der Bereichslauf deckt keinen Commit (Code-Review zu #922) ---
//
// `--bereich` grenzt die gefahrenen Pruefungen ein, bestimmt `geaendert` und `hashes`
// aber weiterhin aus dem Anker. Ohne eigenen Zweig traegt damit JEDE geaenderte Datei
// einen Hash, und das Gate liesse den Commit durch — auch fuer Bereiche, deren
// Pruefungen nie liefen. Der eingegrenzte Lauf bleibt richtig; er ist nur kein
// Abschlussnachweis.

const ZWEI_BEREICHE = {
  buildChecks: [
    { cmd: "node -e \"process.exit(0)\" # frontend", areas: ["frontend"] },
    { cmd: "node -e \"process.exit(0)\" # backend", areas: ["backend"] },
  ],
  checkAreas: { frontend: ["frontend/**"], backend: ["backend/**"] },
};

test("[gate-1] ein Bereichslauf deckt den Commit nicht, auch wenn er gruen ist", () => {
  mitRepo({ config: ZWEI_BEREICHE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "frontend/App.tsx");
    datei(dir, "backend/Main.java");

    const lauf = run(dir, "--bereich", "frontend");
    assert.equal(lauf.status, 0, `der Bereichslauf selbst muss gruen sein: ${lauf.stdout}${lauf.stderr}`);

    git(dir, "add", "frontend/App.tsx", "backend/Main.java");
    const res = gate(dir, "pre-commit");

    assert.notEqual(res.status, 0, "das Gate muss einen Teilnachweis abweisen");
    assert.match(`${res.stdout}${res.stderr}`, /eingegrenzt auf den Bereich 'frontend'/);
  });
});

test("[gate-1] nach dem uneingeschraenkten Lauf nimmt das Gate denselben Stand an", () => {
  mitRepo({ config: ZWEI_BEREICHE }, (dir) => {
    gateEinbauen(dir);
    datei(dir, "frontend/App.tsx");
    datei(dir, "backend/Main.java");

    run(dir, "--bereich", "frontend");
    run(dir);

    git(dir, "add", "frontend/App.tsx", "backend/Main.java");
    const res = gate(dir, "pre-commit");

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

// --- Die Weiche zum Gate des festen Kit-Stands (Issue #1102, Plan #1101 A6) ---
//
// Arbeitet ein unbeaufsichtigter Lauf mit dem Kit des letzten Pushs, startet der Hook das
// Gate des Stands statt des Gates neben sich — aber nur, wenn KIT_STAND_PFAD gesetzt ist,
// der Baum die Markierung traegt UND das Gate des Stands vorliegt. Die Variable allein erbt
// jedes Fixture-Repo eines Tests, das in einer naechtlichen Sitzung laeuft.

/** Ein Stand, dessen Gate sich in `spur` eintraegt und durchlaesst. */
function fremderStand(dir) {
  const stand = join(dir, "stand");
  mkdirSync(join(stand, ".githooks"), { recursive: true });
  writeFileSync(join(stand, ".githooks", "gate.mjs"),
    'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.STAND_SPUR, process.argv.slice(2).join(" ") + "\\n");\n');
  return stand;
}

function hookMitStand(dir, env) {
  return spawnSync(posixShell(), [shellPfad(join(dir, ".githooks", "pre-commit"))], { cwd: dir, encoding: "utf-8", env: { ...process.env, ...env } });
}

test("[kitstand-6] mit Markierung und KIT_STAND_PFAD startet der Hook das Gate des Stands", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    const stand = fremderStand(dir);
    const spur = join(dir, "spur.txt");
    writeFileSync(join(dir, ".claude", "kit-stand.json"), JSON.stringify({ commit: "abc", pfad: stand, pid: process.pid }));

    const res = hookMitStand(dir, { KIT_STAND_PFAD: stand, STAND_SPUR: spur });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(spur, "utf-8"), "pre-commit\n", "das Gate des Stands lief mit dem Hook-Argument");
  });
});

test("[kitstand-6] ohne Markierung bleibt der Hook beim eigenen Gate, auch mit KIT_STAND_PFAD", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    const stand = fremderStand(dir);
    const spur = join(dir, "spur.txt");

    const res = hookMitStand(dir, { KIT_STAND_PFAD: stand, STAND_SPUR: spur });

    assert.notEqual(res.status, 0, "das eigene Gate weist ohne Zusammenfassung ab");
    assert.match(res.stderr, /Zusammenfassung fehlt/);
    assert.equal(existsSync(spur), false, "das Gate des Stands darf nicht laufen");
  });
});

test("[kitstand-6] fehlt das Gate des Stands, bleibt der Hook beim eigenen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    gateEinbauen(dir);
    writeFileSync(join(dir, ".claude", "kit-stand.json"), JSON.stringify({ commit: "abc", pfad: "/nicht/vorhanden", pid: process.pid }));

    const res = hookMitStand(dir, { KIT_STAND_PFAD: "/nicht/vorhanden" });

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Zusammenfassung fehlt/, "das eigene Gate lief");
  });
});
