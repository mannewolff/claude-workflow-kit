// Ablauf-Pruefung: Das Commit-Gate ist ein eigenes Programm, das der Hook als Prozess startet; seinen Ausgang sieht nur, wer es so startet.
//
// Das Commit-Gate (Issue #470; seit Issue #1212 unter diesem Namen, mit den Gate-Faellen
// aus den checks-Tests, die sonst im selben Prozess laufen).
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
import { pathToFileURL } from "node:url";

import { mitRepo, git, run, datei, posixShell } from "./helpers/checks-repo.mjs";
import { gate, gateEinbauen, GATE, HOOK } from "./helpers/checks-ablauf.mjs";

const LEISE = { buildChecks: ["node -e \"process.exit(0)\""] };

function zusammenfassungSchreiben(dir, daten) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(daten, null, 2) + "\n", "utf-8");
}

function zusammenfassungLesen(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8"));
}

test("[gate-1] gruene Zusammenfassung mit passenden Hashes wird angenommen — auch bei Umlaut im Namen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "Änderung.md", "Inhalt\n");
    await run(dir);
    git(dir, "add", "Änderung.md");
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] fehlende Zusammenfassung wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /fehlt/);
    assert.match(res.stderr, /checks\.mjs run/);
  });
});

test("[gate-1] unlesbare Zusammenfassung wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
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

test("[gate-1] gueltiges JSON ohne hashes wird als altes Format abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    zusammenfassungSchreiben(dir, { basis: "abc", geaendert: ["a.txt"], laufen: [] });
    datei(dir, "a.txt", "A\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /altes Format/);
  });
});

test("[gate-1] ein rotes Ergebnis wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    await run(dir);
    const z = zusammenfassungLesen(dir);
    z.laufen = [{ cmd: "x", grund: "g", ergebnis: "rot" }];
    zusammenfassungSchreiben(dir, z);
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /rot/);
  });
});

test("[gate-1] ein nicht gestartetes Kommando wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    await run(dir);
    const z = zusammenfassungLesen(dir);
    z.laufen = [{ cmd: "x", grund: "g", ergebnis: "nicht gestartet" }];
    zusammenfassungSchreiben(dir, z);
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /nicht gestartet/);
  });
});

test("[gate-1] eine gestagte Datei, die in hashes fehlt, wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    await run(dir);
    datei(dir, "spaet.txt", "spaet\n");
    git(dir, "add", "spaet.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /spaet\.txt/);
    assert.match(res.stderr, /nicht geprueft/);
  });
});

test("[gate-1] eine nach der Pruefung geaenderte Datei wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "VORHER\n");
    await run(dir);
    datei(dir, "a.txt", "NACHHER\n");
    git(dir, "add", "a.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /a\.txt/);
    assert.match(res.stderr, /nach der Pruefung geaendert/);
  });
});

test("[gate-1] eine gestagte Loeschung mit null-Tombstone wird angenommen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    git(dir, "rm", "-q", "--cached", "README.md");
    rmSync(join(dir, "README.md"));
    await run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] eine gestagte Loeschung ohne Tombstone wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    await run(dir);
    git(dir, "rm", "-q", "README.md");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /README\.md/);
    assert.match(res.stderr, /Loeschung nicht geprueft/);
  });
});

test("[gate-1] eine gestagte Umbenennung wird angenommen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    git(dir, "mv", "README.md", "LIESMICH.md");
    await run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] leeres Paket bei nicht leerem Index wird abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    await run(dir);
    datei(dir, "spaet.txt", "x\n");
    git(dir, "add", "spaet.txt");
    const res = gate(dir, "pre-commit");
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /nicht geprueft/);
  });
});

test("[gate-1] leerer Index wird bei gruener Zusammenfassung angenommen und ohne abgewiesen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    await run(dir);
    assert.equal(gate(dir, "pre-commit").status, 0, "leerer Index bei gruener Zusammenfassung");
    rmSync(join(dir, ".claude", "checks-summary.json"));
    assert.notEqual(gate(dir, "pre-commit").status, 0, "leerer Index ohne Zusammenfassung");
  });
});

test("[gate-1] leere buildChecks-Liste wird angenommen, und das Gate liest dabei keine Config", async () => {
  await mitRepo({ config: { buildChecks: [] } }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "a.txt", "A\n");
    await run(dir);
    git(dir, "add", "a.txt");
    rmSync(join(dir, ".claude", "workflow.config.json"));
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] das Gate findet checks.mjs auch unter kit/", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir, { checksOrt: "kit" });
    await run(dir);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

test("[gate-1] ohne checks.mjs an beiden Orten weist das Gate ab und nennt den Installer", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    await run(dir);
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

test("[gate-1] der Hook ist POSIX-sh, ausfuehrbar und faellt ohne node sichtbar aus", async () => {
  const syntax = spawnSync(posixShell(), ["-n", HOOK], { encoding: "utf-8" });
  assert.equal(syntax.status, 0, `sh -n meldete: ${syntax.stderr}`);
  assert.match(readFileSync(HOOK, "utf-8"), /^#!\/bin\/sh/);

  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
    // Aufruf aus einem anderen Arbeitsverzeichnis und mit PATH ohne node: Der Hook
    // muss gate.mjs relativ zu sich selbst finden und den Ausfall melden.
    const res = spawnSync(posixShell(), [join(dir, ".githooks", "pre-commit")], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...ohnePath(), PATH: "/nonexistent" },
    });
    assert.notEqual(res.status, 0, "ohne node darf der Hook nicht durchlassen");
    assert.ok(`${res.stderr}${res.stdout}`.length > 0, "der Ausfall muss sichtbar sein");
  });
});

test("[gate-1] gate.mjs und der Hook liegen unter .githooks/", async () => {
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

test("[gate-1] ein Bereichslauf deckt den Commit nicht, auch wenn er gruen ist", async () => {
  await mitRepo({ config: ZWEI_BEREICHE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "frontend/App.tsx");
    datei(dir, "backend/Main.java");

    const lauf = await run(dir, "--bereich", "frontend");
    assert.equal(lauf.status, 0, `der Bereichslauf selbst muss gruen sein: ${lauf.stdout}${lauf.stderr}`);

    git(dir, "add", "frontend/App.tsx", "backend/Main.java");
    const res = gate(dir, "pre-commit");

    assert.notEqual(res.status, 0, "das Gate muss einen Teilnachweis abweisen");
    assert.match(`${res.stdout}${res.stderr}`, /eingegrenzt auf den Bereich 'frontend'/);
  });
});

test("[gate-1] nach dem uneingeschraenkten Lauf nimmt das Gate denselben Stand an", async () => {
  await mitRepo({ config: ZWEI_BEREICHE }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "frontend/App.tsx");
    datei(dir, "backend/Main.java");

    await run(dir, "--bereich", "frontend");
    await run(dir);

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
  return spawnSync(posixShell(), [join(dir, ".githooks", "pre-commit")], { cwd: dir, encoding: "utf-8", env: { ...process.env, ...env } });
}

test("[kitstand-6] mit Markierung und KIT_STAND_PFAD startet der Hook das Gate des Stands", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    const stand = fremderStand(dir);
    const spur = join(dir, "spur.txt");
    writeFileSync(join(dir, ".claude", "kit-stand.json"), JSON.stringify({ commit: "abc", pfad: stand, pid: process.pid }));

    const res = hookMitStand(dir, { KIT_STAND_PFAD: stand, STAND_SPUR: spur });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(spur, "utf-8"), "pre-commit\n", "das Gate des Stands lief mit dem Hook-Argument");
  });
});

test("[kitstand-6] ohne Markierung bleibt der Hook beim eigenen Gate, auch mit KIT_STAND_PFAD", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    const stand = fremderStand(dir);
    const spur = join(dir, "spur.txt");

    const res = hookMitStand(dir, { KIT_STAND_PFAD: stand, STAND_SPUR: spur });

    assert.notEqual(res.status, 0, "das eigene Gate weist ohne Zusammenfassung ab");
    assert.match(res.stderr, /Zusammenfassung fehlt/);
    assert.equal(existsSync(spur), false, "das Gate des Stands darf nicht laufen");
  });
});

test("[kitstand-6] fehlt das Gate des Stands, bleibt der Hook beim eigenen", async () => {
  await mitRepo({ config: LEISE }, async (dir) => {
    gateEinbauen(dir);
    writeFileSync(join(dir, ".claude", "kit-stand.json"), JSON.stringify({ commit: "abc", pfad: "/nicht/vorhanden", pid: process.pid }));

    const res = hookMitStand(dir, { KIT_STAND_PFAD: "/nicht/vorhanden" });

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Zusammenfassung fehlt/, "das eigene Gate lief");
  });
});

// --- Hinweis-Pruefungen (Issue #1155, Plan #1150, E12) ---
//
// Ein Hinweis-Eintrag endet gruen, auch mit Fund. Das Gate liest nur `ergebnis` und
// bleibt unveraendert — der Fund haelt den Commit nicht an.

test("[gate-1] ein Hinweis-Eintrag mit Fund laesst den Commit zu", async () => {
  const config = {
    buildChecks: [{ cmd: "node hinweis.mjs", always: true, art: "hinweis" }],
  };
  await mitRepo({ config }, async (dir) => {
    gateEinbauen(dir);
    datei(dir, "hinweis.mjs", "console.log('Hinweis: kit/a.mjs:1 — pfade: Schraegstrich');\nprocess.exit(1);\n");
    const lauf = await run(dir);
    assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
    assert.deepEqual(zusammenfassungLesen(dir).hinweise, [{ cmd: "node hinweis.mjs", zeilen: ["kit/a.mjs:1 — pfade: Schraegstrich"] }]);

    git(dir, "add", "hinweis.mjs");
    const res = gate(dir, "pre-commit");

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

// --- Gate-Faelle aus den checks-Tests (Issue #1212) ----------------------------
//
// Die Zusammenfassung pruefen die checks-Tests im selben Prozess; ob das Gate sie
// annimmt, steht hier, weil nur das Gate als Prozess es zeigt.

/** Legt Hook und Gate an und committet sie — ungetrackt zaehlten sie als Aenderung des Pakets. */
function gateCommitten(dir) {
  gateEinbauen(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "gate");
}

test("[934] eine Datei mit ohnePruefung-Treffer bleibt im Nachweis — das Gate laesst ihren Commit durch (E2)", async () => {
  const config = {
    buildChecks: [{ cmd: "node -e \"process.exit(0)\"", areas: ["frontend"] }],
    checkAreas: { frontend: ["frontend/**"] },
    ohnePruefung: [{ muster: "CHANGELOG.md", grund: "Release-Protokoll; keine Pruefung liest seinen Inhalt" }],
  };
  await mitRepo({ config }, async (dir) => {
    gateCommitten(dir);
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");
    assert.equal((await run(dir)).status, 0);

    git(dir, "add", "CHANGELOG.md");
    const tor = gate(dir, "pre-commit");
    assert.equal(tor.status, 0, `das Gate weist den Commit ab: ${tor.stdout}${tor.stderr}`);
  });
});

test("[checks-11] das Commit-Gate nimmt die uebernommene Zusammenfassung an", async () => {
  const config = { buildChecks: [{ cmd: "node .claude/zaehler.mjs", always: true }], checkAreas: { kern: ["src/**"] } };
  await mitRepo({ config }, async (dir) => {
    gateEinbauen(dir);
    // Der Zaehler liegt unter `.claude/`, hinter der Ignore-Regel: Er veraendert den Stand nicht.
    datei(dir, ".claude/zaehler.mjs", "import { appendFileSync } from 'node:fs';\nappendFileSync('.claude/zaehler.txt', 'x\\n');\n");
    datei(dir, "src/a.txt");

    await run(dir);
    const zweiter = await run(dir);
    git(dir, "add", "src/a.txt");
    const res = gate(dir, "pre-commit");

    assert.match(zweiter.stdout, /Ergebnis uebernommen/, "Vorbedingung: der zweite Lauf hat uebernommen");
    assert.equal(readFileSync(join(dir, ".claude", "zaehler.txt"), "utf-8"), "x\n");
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  });
});

const WARTEND = ".claude/vorhaben-wartend-probe.md";

/** Macht `.claude/vorhaben-wartend-*` fuer git sichtbar und stellt das Gate bereit (Issue #546). */
function wartendSichtbar(dir) {
  gateEinbauen(dir);
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\n!.claude/vorhaben-wartend-*\n");
  git(dir, "add", ".gitignore", ".githooks");
  git(dir, "commit", "-q", "-m", "Gate und sichtbare wartende Notizen");
}

test("[checks-2] neben einer ungestagten wartenden Notiz passiert der Commit der regulaeren Aenderung das Gate", async () => {
  const config = { buildChecks: [{ cmd: "node -e \"process.exit(0)\"", areas: ["quelle"] }], checkAreas: { quelle: ["src/**"] } };
  await mitRepo({ config }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, "src/a.js", "// A\n");
    datei(dir, WARTEND, "# wartet\n");
    assert.equal((await run(dir)).status, 0);

    // Die ungestagte Notiz erreicht das Gate nicht, es liest nur `git diff --cached`.
    git(dir, "add", "src/a.js");
    const g = gate(dir, "pre-commit");
    assert.equal(g.status, 0, `das Gate wies ab: ${g.stdout}${g.stderr}`);
  });
});

// Bewusst `[gate-1]` und nicht `[checks-2]`: Der Fall belegt bestehendes
// Gate-Verhalten — ein Hash je gestagter Datei — und kein neues. Er ist der
// Nachweis zu Plan #545, A11: Der Ausschluss traegt nur ausserhalb des Index.
test("[gate-1] eine gestagte wartende Notiz weist das Gate weiterhin als nicht geprueft ab", async () => {
  const config = {
    buildChecks: [{ cmd: "node -e \"process.exit(0)\"", areas: ["quelle"] }],
    checkAreas: { quelle: ["src/**"], lokal: [".claude/**"] },
  };
  await mitRepo({ config }, async (dir) => {
    wartendSichtbar(dir);
    datei(dir, WARTEND, "# wartet\n");
    await run(dir);
    git(dir, "add", WARTEND);

    const g = gate(dir, "pre-commit");

    assert.notEqual(g.status, 0, "eine gestagte Notiz darf nicht durchgehen");
    assert.match(g.stderr, /vorhaben-wartend-probe\.md/);
    assert.match(g.stderr, /nicht geprueft/);
  });
});

test("[1072] nach einem roten Teillauf nennen Gate und lesePruefung die tatsaechlich rote Gruppe", async () => {
  // Jedes Kommando haengt seinen Namen an ein Protokoll und ist rot, solange `.claude/rot-<name>` liegt.
  const B = "node .claude/k.mjs b";
  const config = { buildChecks: [{ cmd: "node .claude/k.mjs a", areas: ["kern"] }, { cmd: B, areas: ["kern"] }], checkAreas: { kern: ["src/**"] } };
  await mitRepo({ config }, async (dir) => {
    // Gate und Hook liegen vor dem ersten Lauf, sonst aenderten sie zwischen den Laeufen die Auswahl.
    gateEinbauen(dir);
    datei(dir, ".claude/k.mjs", [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "const name = process.argv[2];",
      String.raw`appendFileSync('.claude/protokoll.txt', name + '\n');`,
      "process.exit(existsSync('.claude/rot-' + name) ? 1 : 0);",
      "",
    ].join("\n"));
    datei(dir, ".claude/rot-b", "");
    datei(dir, "src/a.txt");
    await run(dir);
    datei(dir, "src/a.txt", "halb korrigiert\n");
    rmSync(join(dir, ".claude", "protokoll.txt"));
    await run(dir);
    assert.equal(readFileSync(join(dir, ".claude", "protokoll.txt"), "utf-8"), "b\n", "Vorbedingung: ein roter Teillauf");

    git(dir, "add", "src/a.txt");
    const g = gate(dir, "pre-commit");
    assert.equal(g.status, 1);
    assert.match(g.stderr, /endete rot \(node \.claude\/k\.mjs b\)/);

    const night = pathToFileURL(join(import.meta.dirname, "..", "kit", "night.mjs")).href;
    const skript = `import { lesePruefung } from ${JSON.stringify(night)};`
      + "process.stdout.write(JSON.stringify(lesePruefung('7')));";
    const n = spawnSync(process.execPath, ["--input-type=module", "-e", skript], { cwd: dir, encoding: "utf-8" });
    assert.equal(n.status, 0, n.stderr);
    const pruefung = JSON.parse(n.stdout);
    assert.equal(pruefung.zustand, "rot");
    assert.equal(pruefung.rotesKommando, B);
    assert.equal(pruefung.rotesErgebnis, "rot");
  });
});
