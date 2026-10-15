// Die Einstellungsoberflaeche in einem englischen Projekt (Issue #1441, Plan #1420 E9, E10).
//
// Intern arbeitet die Oberflaeche mit den deutschen Namen (E9). Gezeigt werden in einem
// englischen Projekt die englischen Namen und die Beschreibungen aus
// tools/config-referenz.en.json, die tools/sync-blobs.mjs einbettet wie das Schema und die
// Namenstabelle (E10). Beim Schreiben bekommt jeder Schluessel seinen englischen Namen, auch
// ein vorhandener deutscher (Issue #1725, Plan #1710 A2); ein vorhandener Aufzaehlungswert
// behaelt seine Schreibweise. Ein deutsches Projekt sieht aus wie vorher.
// Ablauf-Pruefung: Einbettung und Drift zeigt nur sync-blobs als Programm in einem Wegwerf-Repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { aenderungsliste, anzeigePfad, projektZustand, speichere, vorschau, SCHEMA, SEITEN_BAUSTEINE } from "../kit/settings.mjs";
import { benenneWieVorlage, normalisiereConfig, SCHLUESSEL } from "../kit/board/config-namen.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const REFERENZ = join(repoRoot, "tools", "config-referenz.en.json");
const EINSTELLUNGEN = join(repoRoot, "kit", "settings.mjs");
const TEXTE = JSON.parse(readFileSync(REFERENZ, "utf-8"));

/** Ein Wegwerf-Projekt mit `team`; `fn` bekommt Projekt, Optionen und Pfad. */
function mitProjekt(team, fn) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-englisch-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-englisch-home-"));
  try {
    const pfad = projekt(wurzel, "p", { team, stand: "5.0.0" });
    return fn({ projekt: { name: "p", pfad }, optionen: { home, eigenerStand: "5.0.0" }, pfad });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

const datei = (pfad) => JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8"));
const eintraege = (zustand) => Object.values(zustand.themen).flat().flatMap((t) => t.eintraege);
const eintrag = (zustand, pfad) => eintraege(zustand).find((e) => e.pfad === pfad);

const ENGLISCH = {
  language: "en",
  codeHost: "local",
  issueTracker: "local",
  buildChecks: [{ cmd: "node --test", stage: "package" }],
  noCheck: [{ pattern: "docs/**", reason: "Doku" }],
  mainBranch: "main",
  triggers: { go: "GO" },
};

test("[1441-1] ein englisches Projekt traegt die englischen Namen und Beschreibungen", () => {
  mitProjekt(ENGLISCH, ({ projekt: p, optionen }) => {
    const zustand = projektZustand(p, optionen);
    assert.deepEqual(zustand.grundlagen.namen, { ...SCHLUESSEL }, "die Namen der Projektsprache gehen an die Seite");
    const ohne = eintrag(zustand, "ohnePruefung");
    assert.ok(ohne, "noCheck aus der Datei steht unter seinem Pfad ohnePruefung, nicht als unbekanntes Feld");
    assert.deepEqual(ohne.team, [{ muster: "docs/**", grund: "Doku" }]);
    assert.equal(eintrag(zustand, "noCheck"), undefined, "der englische Name erscheint nicht als eigenes Feld");
    assert.equal(ohne.beschreibung, TEXTE.ohnePruefung.text);
    assert.equal(ohne.schema.items.properties.muster.description, TEXTE["ohnePruefung[].muster"].text);
    const ausloeser = eintrag(zustand, "triggers");
    assert.equal(ausloeser.schema.properties.go.description, TEXTE["triggers.go"].text);
    assert.equal(SCHEMA.properties.triggers.properties.go.description === TEXTE["triggers.go"].text, false, "das eingebettete Schema bleibt deutsch");
  });
});

test("[1441-2] anzeigePfad zeigt einen Pfad unter den Namen der Projektsprache", () => {
  assert.equal(anzeigePfad("ohnePruefung[0].muster", SCHLUESSEL), "noCheck[0].pattern");
  assert.equal(anzeigePfad("buildChecks[2].stufe", SCHLUESSEL), "buildChecks[2].stage");
  assert.equal(anzeigePfad("night.festgefahrenNach", SCHLUESSEL), "night.stuckAfter");
  assert.equal(anzeigePfad("checkAreas.meinBereich", SCHLUESSEL), "checkAreas.meinBereich", "frei gewaehlte Namen bleiben");
  assert.equal(anzeigePfad("ohnePruefung", null), "ohnePruefung", "ohne Namen bleibt der Pfad deutsch");
  const skript = Object.values(SEITEN_BAUSTEINE).join("\n");
  assert.match(skript, /function anzeigePfad\(/, "die Seite traegt dieselbe Fassung");
});

test("[1441-3] ein neu gesetzter Schluessel landet unter dem englischen Namen, ein vorhandener behaelt seinen", () => {
  mitProjekt(ENGLISCH, ({ projekt: p, optionen, pfad }) => {
    const r = speichere(p, {
      ebene: "team",
      aenderungen: [
        { pfad: "reviewLesegrenze", wert: "--ro" },
        { pfad: "ohnePruefung", wert: [{ muster: "docs/**", grund: "Doku" }, { muster: "*.md", grund: "Text" }] },
        { pfad: "buildChecks", wert: [{ cmd: "node --test", stufe: "paket" }, { cmd: "npm run e2e", stufe: "paket", nichtBeimAbschluss: "zusammenspiel" }] },
      ],
      hashes: projektZustand(p, optionen).hashes,
    }, optionen);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const neu = datei(pfad);
    assert.equal(neu.reviewReadLimit, "--ro");
    assert.equal(neu.reviewLesegrenze, undefined);
    assert.deepEqual(neu.noCheck, [{ pattern: "docs/**", reason: "Doku" }, { pattern: "*.md", reason: "Text" }]);
    assert.equal(neu.ohnePruefung, undefined);
    assert.deepEqual(neu.buildChecks, [{ cmd: "node --test", stage: "package" }, { cmd: "npm run e2e", stage: "package", notAtCompletion: "interplay" }]);
  });
});

test("[1441-4] ein vorhandener deutscher Name in einem englischen Projekt wird englisch geschrieben (#1725)", () => {
  const gemischt = { ...ENGLISCH, noCheck: undefined, ohnePruefung: [{ muster: "docs/**", grund: "Doku" }], reviewLesegrenze: "--alt" };
  mitProjekt(gemischt, ({ projekt: p, optionen, pfad }) => {
    const r = speichere(p, {
      ebene: "team",
      aenderungen: [
        { pfad: "reviewLesegrenze", wert: "--nur-lesen" },
        { pfad: "ohnePruefung", wert: [{ muster: "docs/**", grund: "Doku" }, { muster: "*.md", grund: "Text" }] },
      ],
      hashes: projektZustand(p, optionen).hashes,
    }, optionen);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const neu = datei(pfad);
    assert.equal(neu.reviewReadLimit, "--nur-lesen");
    assert.equal(neu.reviewLesegrenze, undefined);
    assert.deepEqual(neu.noCheck[0], { pattern: "docs/**", reason: "Doku" }, "der vorhandene Eintrag bekommt englische Namen");
    assert.equal(neu.ohnePruefung, undefined);
    assert.deepEqual(neu.buildChecks, ENGLISCH.buildChecks, "was nicht geaendert wurde, bleibt, wie es war");
  });
});

test("[1441-5] ein deutsches Projekt sieht unveraendert aus und schreibt englische Schluessel (#1725)", () => {
  const deutsch = { codeHost: "local", issueTracker: "local", buildChecks: ["node --test"], mainBranch: "main" };
  mitProjekt(deutsch, ({ projekt: p, optionen, pfad }) => {
    const zustand = projektZustand(p, optionen);
    assert.equal(zustand.grundlagen.namen, null);
    const grenze = eintrag(zustand, "reviewLesegrenze");
    assert.equal(grenze.beschreibung, SCHEMA.properties.reviewLesegrenze.description);
    assert.deepEqual(grenze.schema, SCHEMA.properties.reviewLesegrenze);
    const r = speichere(p, {
      ebene: "team",
      aenderungen: [{ pfad: "reviewLesegrenze", wert: "--ro" }, { pfad: "ohnePruefung", wert: [{ muster: "*.md", grund: "Text" }] }],
      hashes: zustand.hashes,
    }, optionen);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const neu = datei(pfad);
    assert.equal(neu.reviewReadLimit, "--ro");
    assert.deepEqual(neu.noCheck, [{ pattern: "*.md", reason: "Text" }]);
  });
});

test("[1441-8] der Fuss eines Teils nennt den Pfad in der Projektsprache", () => {
  const saetze = aenderungsliste({ ohnePruefung: [] }, { ohnePruefung: [{ muster: "a", grund: "b" }] }, null, SCHLUESSEL).map((a) => a.satz);
  assert.deepEqual(saetze, ["noCheck hat jetzt 1 Einträge statt 0"]);
  mitProjekt(ENGLISCH, ({ projekt: p, optionen }) => {
    const r = vorschau(p, { ebene: "team", teil: "m4", aenderungen: [{ pfad: "ohnePruefung", wert: [] }], hashes: projektZustand(p, optionen).hashes }, optionen);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.aenderungen.map((a) => [a.pfad, a.satz]), [["ohnePruefung", "noCheck now has 0 entries instead of 1"]], "ein englisches Projekt bekommt den Satz englisch (Issue #1456)");
  });
});

test("[1441-9] benenneWieVorlage: Schluessel englisch, vorhandene Werte unter ihrem Namen, Doppelung bleibt stehen", () => {
  const roh = { language: "en", noCheck: [{ pattern: "a", reason: "b" }], ohnePruefung: [{ muster: "x", grund: "y" }], buildChecks: [{ cmd: "t", stufe: "paket" }] };
  const de = normalisiereConfig(roh).config;
  de.buildChecks.push({ cmd: "u", stufe: "push" });
  de.mainBranch = "main";
  assert.deepEqual(benenneWieVorlage(de, roh, "en"), {
    language: "en",
    noCheck: [{ pattern: "a", reason: "b" }],
    ohnePruefung: [{ muster: "x", grund: "y" }],
    buildChecks: [{ cmd: "t", stage: "paket" }, { cmd: "u", stage: "push" }],
    mainBranch: "main",
  });
  delete de.ohnePruefung;
  assert.equal("ohnePruefung" in benenneWieVorlage(de, roh, "en"), false, "wer die Einstellung entfernt, entfernt beide Namen");
  assert.throws(() => benenneWieVorlage(de, roh, "fr"), /unbekannte Sprache/);
});

// --- Einbettung der englischen Referenz durch tools/sync-blobs.mjs ---

const eingebettet = (pfad) => readFileSync(pfad, "utf-8").match(/const CONFIG_REFERENZ_EN_B64 = "([^"]*)";/)?.[1];

test("[1441-6] die englische Referenz im Repo ist eingebettet und stimmt mit der Quelle ueberein", () => {
  assert.equal(Buffer.from(eingebettet(EINSTELLUNGEN) ?? "", "base64").toString("utf-8"), readFileSync(REFERENZ, "utf-8"));
});

const KONSTANTEN = ["CONFIG_EXAMPLE_B64", "CLAUDE_WORKFLOW_MD_B64", "CLAUDE_FACHPLAN_MD_B64", "CLAUDE_PLAN_MD_B64", "BOARD_MJS_B64", "NIGHT_MJS_B64", "CHECKS_MJS_B64", "PREISE_MJS_B64", "WORKTREE_MJS_B64", "FINDINGS_MJS_B64", "EFFORT_MJS_B64", "EFFECTIVENESS_MJS_B64", "KIT_NIGHT_B64", "KIT_BOARD_B64", "KIT_ROLLEN_B64", "KIT_TEXTE_B64", "KIT_CHECKS_B64", "GATE_MJS_B64", "PRE_COMMIT_B64", "SKILLS_B64", "AGENTS_B64", "TEMPLATES_EN_B64", "AGENTS_EN_B64", "KIT_ROLLEN_EN_B64"];

/** Minimales Repo mit allem, was sync-blobs.mjs anfasst, und der echten englischen Referenz. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sync-referenz-en-"));
  for (const ordner of ["tools", "kit/board", "templates", "skills/beispiel", ".githooks"]) mkdirSync(join(dir, ordner), { recursive: true });
  writeFileSync(join(dir, ".githooks", "gate.mjs"), 'console.log("gate");\n');
  writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  for (const d of ["CLAUDE-workflow.md", "CLAUDE-Fachplan.md", "CLAUDE-Plan.md"]) writeFileSync(join(dir, "templates", d), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), "{}\n");
  writeFileSync(join(dir, "templates", "workflow.config.schema.json"), "{}\n");
  writeFileSync(join(dir, "skills", "beispiel", "SKILL.md"), "# Beispiel\n");
  for (const d of ["board.mjs", "night.mjs", "checks.mjs", "preise.mjs", "effort.mjs", "effectiveness.mjs", "findings.mjs", "worktree.mjs"]) {
    writeFileSync(join(dir, "kit", d), `const KIT_VERSION = "1.0.0";\n`);
  }
  writeFileSync(join(dir, "kit", "board", "config-namen.mjs"), "export {};\n");
  writeFileSync(join(dir, "kit", "board", "namen.mjs"), "export {};\n");
  copyFileSync(REFERENZ, join(dir, "tools", "config-referenz.en.json"));
  writeFileSync(join(dir, "kit", "settings.mjs"), `const KIT_VERSION = "1.0.0";\nconst SCHEMA_B64 = "";\nconst CONFIG_NAMEN_B64 = "";\nconst CONFIG_REFERENZ_EN_B64 = "";\nconst NAMEN_B64 = "";\n`);
  writeFileSync(join(dir, "install.mjs"), ['const VERSION = "1.0.0";', ...KONSTANTEN.map((k) => `const ${k} = "";`), ""].join("\n"));
  return dir;
}

function syncBlobs(dir, ...args) {
  return spawnSync(process.execPath, [join(repoRoot, "tools", "sync-blobs.mjs"), ...args], { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

test("[1441-7] sync-blobs bettet die englische Referenz ein, und --check wird rot, wenn sie abweicht", () => {
  const dir = fixture();
  try {
    assert.equal(syncBlobs(dir).status, 0);
    assert.equal(Buffer.from(eingebettet(join(dir, "kit", "settings.mjs")), "base64").toString("utf-8"), readFileSync(REFERENZ, "utf-8"));
    assert.equal(syncBlobs(dir, "--check").status, 0);
    const quelle = join(dir, "tools", "config-referenz.en.json");
    writeFileSync(quelle, readFileSync(quelle, "utf-8").replace("Language of the kit", "Language of this kit"));
    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /settings\.mjs.*tools\/config-referenz\.en\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
