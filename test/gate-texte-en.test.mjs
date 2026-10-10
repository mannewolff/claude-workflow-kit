// Ablauf-Pruefung: Ob ein englisches Projekt nur englische Meldungen des Commit-Gates sieht, belegt nur ein echter Prozess aus einem Wegwerf-Repository.
//
// Commit-Gate .githooks/gate.mjs und pre-commit zweisprachig (Issue #1458, Plan #1420 E13, E14).
//
// Beide Dateien legt der Installer allein in jedes Projekt. gate.mjs importiert nur
// Node-Bordmittel, traegt seine Texttabelle selbst und liest die Sprache selbst aus
// `.claude/workflow.config.json` (`language`, sonst `sprache`, sonst `de`); der Hook
// `pre-commit` ist POSIX-sh und traegt seine Tabelle als Variablenpaare `de_<schluessel>` /
// `en_<schluessel>`. Hier steht, was das Paket zusaetzlich zu den deutschen Wortlaut-Tests
// verlangt:
//
//   - Paritaet: je Tabelle dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben je Datei; ein englisches Projekt sieht keine deutsche Meldung.
//   - Lauffaehig aus einem Wegwerf-Repository ohne Kit-Dateien.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { TEXTE } from "../.githooks/gate.mjs";
import { pruefeParitaet } from "../kit/board/namen.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE_QUELLE = join(WURZEL, ".githooks", "gate.mjs");
const HOOK_QUELLE = join(WURZEL, ".githooks", "pre-commit");

/** Die Tabelle des Hooks aus seinen Zeilen `de_<k>='…'` / `en_<k>='…'`; `%s` gilt als Platzhalter. */
function hookTexte() {
  const tabelle = { de: {}, en: {} };
  for (const zeile of readFileSync(HOOK_QUELLE, "utf-8").split("\n")) {
    const m = /^(de|en)_(\w+)='([^']*)'$/.exec(zeile);
    if (!m) continue;
    let n = 0;
    tabelle[m[1]][m[2]] = m[3].replaceAll("%s", () => `{p${++n}}`);
  }
  return tabelle;
}

const git = (cwd, ...args) => {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
};

/** Ein Wegwerf-Repository mit `.githooks/gate.mjs` und `pre-commit` allein — keine Kit-Datei. */
function mitRepo(praefix, config, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.org");
    git(dir, "config", "user.name", "Test");
    mkdirSync(join(dir, ".githooks"));
    copyFileSync(GATE_QUELLE, join(dir, ".githooks", "gate.mjs"));
    copyFileSync(HOOK_QUELLE, join(dir, ".githooks", "pre-commit"));
    chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
    if (config !== undefined) {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config));
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Eine Attrappe von `kit/checks.mjs`, die nur den Pfad der Zusammenfassung liefert. */
function checksAttrappe(dir) {
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "checks.mjs"),
    'import { join } from "node:path";\nexport const zusammenfassungPfad = (cwd) => join(cwd, ".claude", "checks-summary.json");\n');
}

function zusammenfassung(dir, daten) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "checks-summary.json"), typeof daten === "string" ? daten : JSON.stringify(daten));
}

function gate(dir, ...args) {
  const res = spawnSync(process.execPath, [join(dir, ".githooks", "gate.mjs"), ...args], { cwd: dir, encoding: "utf-8" });
  return { ...res, alles: `${res.stdout}${res.stderr}` };
}

function hook(dir, env = {}) {
  const res = spawnSync("sh", [join(dir, ".githooks", "pre-commit")], {
    cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_STAND_PFAD: "", ...env },
  });
  return { ...res, alles: `${res.stdout}${res.stderr}` };
}

/** Die festen Bruchstuecke der deutschen Texte, die im Englischen nicht vorkommen. */
function deutscheBruchstuecke(tabelle) {
  const englisch = Object.values(tabelle.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(tabelle.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

function keinDeutsch(ausgabe, wo) {
  const gefunden = [TEXTE, hookTexte()].flatMap(deutscheBruchstuecke).filter((s) => ausgabe.includes(s));
  assert.deepEqual(gefunden, [], `deutsche Meldung in einem englischen Projekt (${wo})`);
}

const EN = { language: "en" };

test("[1458] die Texttabellen von gate.mjs und pre-commit haben in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  assert.ok(Object.keys(TEXTE.de).length >= 10, "die Tabelle traegt die Texte des Gates");
  const hookTabelle = hookTexte();
  assert.deepEqual(pruefeParitaet(hookTabelle), []);
  assert.deepEqual(Object.keys(hookTabelle.de).sort(), ["gate_fehlt", "node_fehlt"]);
});

test("[1458] aus einem Wegwerf-Repository ohne Kit-Dateien laeuft das Gate und meldet englisch", () => {
  mitRepo("gate-en-leer-", EN, (dir) => {
    assert.equal(existsSync(join(dir, "kit")), false);
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 1, res.alles);
    assert.match(res.stderr, /^Commit rejected — checks\.mjs is in neither \.claude\/kit\/ nor kit\/ — please run the installer\.\n {2}node \.claude\/kit\/checks\.mjs run\n$/);
    keinDeutsch(res.alles, "ohne checks.mjs");
  });
});

test("[1458] ohne Config bleibt das Gate deutsch", () => {
  mitRepo("gate-de-leer-", undefined, (dir) => {
    const res = gate(dir, "pre-commit");
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "Commit abgewiesen — checks.mjs liegt weder unter .claude/kit/ noch unter kit/ — bitte den Installer laufen lassen.\n  node .claude/kit/checks.mjs run\n");
  });
});

test("[1458] die Sprache: language vor sprache, ein unbekannter Wert gilt als Deutsch", () => {
  const faelle = [
    [{ sprache: "en" }, /^Commit rejected/],
    [{ language: "de", sprache: "en" }, /^Commit abgewiesen/],
    [{ language: "en", sprache: "de" }, /^Commit rejected/],
    [{ language: "fr" }, /^Commit abgewiesen/],
  ];
  for (const [config, erwartet] of faelle) {
    mitRepo("gate-sprache-", config, (dir) => {
      assert.match(gate(dir, "pre-commit").stderr, erwartet, JSON.stringify(config));
    });
  }
});

test("[1458] englische Stichproben: Zusammenfassung fehlt, unlesbar, altes Format", () => {
  mitRepo("gate-en-zf-", EN, (dir) => {
    checksAttrappe(dir);
    writeFileSync(join(dir, "a.txt"), "A\n");
    git(dir, "add", "a.txt");

    let res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — the check summary is missing\.\n {2}node \.claude\/kit\/checks\.mjs run\n$/);

    zusammenfassung(dir, "{kein json");
    res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — the check summary is unreadable\./);

    zusammenfassung(dir, { laufen: [] });
    res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — the check summary has an old format without hashes — please run the installer\./);
    keinDeutsch(res.alles, "altes Format");
  });
});

test("[1458] englische Stichproben: rote Pruefung und Bereichslauf, der Vertragswert bleibt", () => {
  mitRepo("gate-en-rot-", EN, (dir) => {
    checksAttrappe(dir);
    zusammenfassung(dir, { laufen: [{ cmd: "npm test", ergebnis: "rot" }], hashes: {} });
    let res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — the check ended rot \(npm test\)\./);

    zusammenfassung(dir, { laufen: [], hashes: {}, bereichWahl: "docs" });
    res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — the check ran limited to the area 'docs' and does not cover the commit — please run 'node \.claude\/kit\/checks\.mjs run' without --bereich\./);
    keinDeutsch(res.alles, "Bereichslauf");
  });
});

test("[1458] englische Stichproben: nicht geprueft, Loeschung nicht geprueft, nach der Pruefung geaendert", () => {
  mitRepo("gate-en-index-", EN, (dir) => {
    checksAttrappe(dir);
    writeFileSync(join(dir, "alt.txt"), "alt\n");
    git(dir, "add", "alt.txt");
    git(dir, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "start");

    writeFileSync(join(dir, "neu.txt"), "neu\n");
    git(dir, "add", "neu.txt");
    zusammenfassung(dir, { laufen: [], hashes: {} });
    let res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — neu\.txt: not checked\./);

    zusammenfassung(dir, { laufen: [], hashes: { "neu.txt": "0000000000000000000000000000000000000000" } });
    res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — neu\.txt: changed after the check\./);

    git(dir, "reset", "-q", "neu.txt");
    git(dir, "rm", "-q", "alt.txt");
    zusammenfassung(dir, { laufen: [], hashes: {} });
    res = gate(dir, "pre-commit");
    assert.match(res.stderr, /^Commit rejected — alt\.txt: deletion not checked\./);
    keinDeutsch(res.alles, "Index");
  });
});

test("[1458] englische Stichprobe: unbekanntes Kommando", () => {
  mitRepo("gate-en-kommando-", EN, (dir) => {
    const res = gate(dir, "irgendwas");
    assert.equal(res.status, 2);
    assert.equal(res.stderr, "gate.mjs: the only command is 'pre-commit'.\n");
  });
});

test("[1458] pre-commit: fehlendes Gate englisch und deutsch", () => {
  mitRepo("hook-en-", EN, (dir) => {
    rmSync(join(dir, ".githooks", "gate.mjs"));
    const res = hook(dir);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, `pre-commit: ${join(dir, ".githooks")}/gate.mjs is missing — commit rejected.\n`);
    keinDeutsch(res.alles, "pre-commit ohne Gate");
  });
  mitRepo("hook-de-", undefined, (dir) => {
    rmSync(join(dir, ".githooks", "gate.mjs"));
    const res = hook(dir);
    assert.equal(res.stderr, `pre-commit: ${join(dir, ".githooks")}/gate.mjs fehlt — Commit abgewiesen.\n`);
  });
});

test("[1458] pre-commit: node nicht im PATH, englisch; mit language vor sprache", (t) => {
  const pfad = "/usr/bin:/bin";
  if (["/usr/bin/node", "/bin/node"].some(existsSync)) {
    t.skip("node liegt im System-PATH");
    return;
  }
  mitRepo("hook-en-node-", { language: "en", sprache: "de" }, (dir) => {
    const res = hook(dir, { PATH: pfad });
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "pre-commit: node not in PATH — commit rejected.\n");
  });
  mitRepo("hook-de-node-", { language: "fr", sprache: "en" }, (dir) => {
    const res = hook(dir, { PATH: pfad });
    assert.equal(res.stderr, "pre-commit: node nicht im PATH — Commit abgewiesen.\n");
  });
});

test("[1458] pre-commit ruft in einem englischen Projekt das Gate, das englisch meldet", () => {
  mitRepo("hook-en-gate-", EN, (dir) => {
    const res = hook(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Commit rejected — checks\.mjs is in neither/);
    keinDeutsch(res.alles, "pre-commit mit Gate");
  });
});
