// Ablauf-Pruefung: die freiwillige Umstellung eines Projekts mit `node install.mjs --language en|de` (Issue #1438, Plan #1420 E7, E12) — sichtbar nur am echten Installer an einer Kopie eines Projekts.
//
// Die Umstellung setzt die Spracheinstellung, benennt die Schluessel in workflow.config.json und
// der lokalen Override-Datei um, legt vorher workflow.config.json.vor-umstellung an und listet,
// was umbenannt wurde und was offen bleibt. Gesetzte Labelwerte aendert sie nicht (E7). Den
// Board-Teil liefert `node .claude/kit/board.mjs issue list`; hier steht statt seiner eine
// Attrappe ueber den Test-Hook INSTALL_BOARD_FAKE (wie INSTALL_SCHUTZ_FAKE) — kein Netz.
//
// cwd und HOME zeigen in ein Wegwerf-Verzeichnis, dieselbe Vorkehrung wie in
// ablauf-install-flow.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Ein deutsches Projekt, wie es heute im Bestand liegt: deutsche Schluessel und Werte, ein
// frei gewaehlter Bereichsname, gesetzte Labels mit deutschen Vorgabewerten und ein eigenes Label.
const DEUTSCH = {
  codeHost: "github",
  issueTracker: "github",
  mainBranch: "main",
  buildChecks: [{ cmd: "npm test", areas: ["kern"], stufe: "paket" }, { cmd: "npm run lint", always: true, art: "hinweis" }],
  checkAreas: { kern: ["src/**"] },
  ohnePruefung: [{ muster: "docs/**", grund: "nur Text" }],
  pushPruefung: { ort: "buildDienst", zweig: "kit-pruefung" },
  night: {
    kette: { label: "kit:durchziehen", varianteBLabel: "mein:label", planMin: 30 },
    stand: { labels: { laeuft: "lauf:laeuft" }, fristMin: 20 },
  },
  pruefLauf: { label: "kit:pruefen" },
};
const LOKAL = { reviewModel: "claude-opus-5-5", reviewLesegrenze: 100 };

function fixture(praefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

function deutschesProjekt(praefix) {
  const dir = fixture(praefix);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(DEUTSCH, null, 2) + "\n");
  writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify(LOKAL, null, 2) + "\n");
  return dir;
}

/** Die Attrappe fuer `board.mjs issue list`: gibt die Karten als JSON aus oder scheitert. */
function boardFake(dir, karten) {
  const skript = join(dir, "board-fake.mjs");
  writeFileSync(skript, karten
    ? `console.log(${JSON.stringify(JSON.stringify(karten))});\n`
    : 'console.error("gh: nicht angemeldet"); process.exit(1);\n');
  return { INSTALL_BOARD_FAKE: skript };
}

const KARTEN = [
  { id: "7", title: "[Fachlich] Alte Anforderung", status: "backlog", labels: ["kit:klaeren"] },
  { id: "8", title: "[Requirement] Neue Anforderung", status: "ready", labels: ["kit:clarify"] },
  { id: "9", title: "[Plan] Plan", status: "ready", labels: [] },
];

function installiere(dir, argv, extraEnv = {}, antworten = [], installer = INSTALLER) {
  return spawnSync(process.execPath, [installer, ...argv], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), ...extraEnv },
  });
}

const lies = (dir, name) => JSON.parse(readFileSync(join(dir, ".claude", name), "utf-8"));

test("--language en legt die Sicherung an, benennt Config und Override-Datei um und laesst Werte und Labels stehen", () => {
  const dir = deutschesProjekt("install-umstellung-en-");
  try {
    const original = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");
    const res = installiere(dir, ["--language", "en"], boardFake(dir, KARTEN));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(readFileSync(join(dir, ".claude", "workflow.config.json.vor-umstellung"), "utf-8"), original);

    const c = lies(dir, "workflow.config.json");
    assert.equal(c.language, "en");
    assert.equal("sprache" in c, false);
    assert.deepEqual(c.buildChecks, [
      { cmd: "npm test", areas: ["kern"], stage: "package" },
      { cmd: "npm run lint", always: true, kind: "hint" },
    ]);
    assert.deepEqual(c.checkAreas, { kern: ["src/**"] }, "frei gewaehlte Bereichsnamen bleiben");
    assert.deepEqual(c.noCheck, [{ pattern: "docs/**", reason: "nur Text" }]);
    assert.deepEqual(c.pushCheck, { location: "buildService", branch: "kit-pruefung" });
    assert.deepEqual(c.night, {
      chain: { label: "kit:durchziehen", variantBLabel: "mein:label", planMin: 30 },
      status: { labels: { running: "lauf:laeuft" }, deadlineMin: 20 },
    });
    assert.deepEqual(c.checkRun, { label: "kit:pruefen" });

    assert.deepEqual(lies(dir, "workflow.config.local.json"), { reviewModel: "claude-opus-5-5", reviewReadLimit: 100 });

    // Der Bericht: umbenannt, offen, Board, Skills.
    assert.match(res.stdout, /ohnePruefung → noCheck/);
    assert.match(res.stdout, /buildChecks\[0\]\.stufe: paket → package/);
    assert.match(res.stdout, /workflow\.config\.local\.json: reviewLesegrenze → reviewReadLimit/);
    assert.match(res.stdout, /night\.kette\.label: kit:durchziehen .*kit:carry-through/);
    assert.match(res.stdout, /night\.stand\.labels\.laeuft: lauf:laeuft .*run:running/);
    assert.match(res.stdout, /pruefLauf\.label: kit:pruefen .*kit:check/);
    assert.doesNotMatch(res.stdout, /mein:label/, "ein selbst gewaehltes Label ist nicht offen");
    assert.match(res.stdout, /#7 \[Fachlich\] Alte Anforderung/);
    assert.doesNotMatch(res.stdout, /#8 /, "eine Karte mit englischem Praefix ist nicht offen");
    assert.doesNotMatch(res.stdout, /#9 /, "[Plan] heisst in beiden Sprachen gleich");
    const fehlend = res.stdout.split("\n").find((z) => z.includes("auf keiner Karte")) ?? "";
    assert.match(fehlend, /kit:protected/, "ein englisches Label, das auf keiner Karte steht, wird genannt");
    assert.doesNotMatch(fehlend, /kit:clarify/, "ein englisches Label, das am Board steht, fehlt nicht");
    assert.doesNotMatch(fehlend, /kit:night/, "ein Label, das in beiden Sprachen gleich heisst, ist nicht offen");
    assert.doesNotMatch(res.stdout, /Skills und Regeltexte bleiben deutsch/, "die Umstellung bringt Skills und Regeltexte selbst mit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1569] --sprache endet mit Exit 1 und nennt --language, die Config bleibt", () => {
  const dir = deutschesProjekt("install-umstellung-sprache-");
  try {
    const vorher = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");
    for (const argv of [["--sprache", "en"], ["--sprache=en"]]) {
      const res = installiere(dir, argv, boardFake(dir, KARTEN));
      assert.equal(res.status, 1, `${res.stderr}\n${res.stdout}`);
      assert.match(res.stderr, /'--sprache'.*'--language'/);
    }
    assert.equal(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"), vorher);
    assert.equal(existsSync(join(dir, ".claude", "workflow.config.json.vor-umstellung")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--language de fuehrt zurueck: gleich dem Original bis auf das Sprachfeld", () => {
  const dir = deutschesProjekt("install-umstellung-zurueck-");
  try {
    const hin = installiere(dir, ["--language", "en"], boardFake(dir, KARTEN));
    assert.equal(hin.status, 0, `${hin.stderr}\n${hin.stdout}`);
    const englisch = readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8");

    const zurueck = installiere(dir, ["--language", "de"], boardFake(dir, KARTEN));
    assert.equal(zurueck.status, 0, `${zurueck.stderr}\n${zurueck.stdout}`);

    const { sprache, ...rest } = lies(dir, "workflow.config.json");
    assert.equal(sprache, "de");
    assert.deepEqual(rest, DEUTSCH);
    assert.deepEqual(lies(dir, "workflow.config.local.json"), LOKAL);
    assert.equal(readFileSync(join(dir, ".claude", "workflow.config.json.vor-umstellung"), "utf-8"), englisch,
      "die Sicherung haelt den Stand vor dieser Umstellung");
    assert.match(zurueck.stdout, /noCheck → ohnePruefung/);
    assert.match(zurueck.stdout, /#8 \[Requirement\] Neue Anforderung/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ein nicht erreichbares Board wird im Bericht genannt, die Umstellung gelingt trotzdem", () => {
  const dir = deutschesProjekt("install-umstellung-board-");
  try {
    const res = installiere(dir, ["--language=en"], boardFake(dir, null));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(lies(dir, "workflow.config.json").language, "en");
    assert.match(res.stdout, /Board nicht erreichbar.*gh: nicht angemeldet/);
    assert.match(res.stdout, /night\.kette\.label: kit:durchziehen/, "die Config-Bestaende stehen trotzdem im Bericht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--language ohne gueltige Sprache oder ohne Config bricht ab und schreibt nichts", () => {
  const ohne = fixture("install-umstellung-ohne-");
  const falsch = deutschesProjekt("install-umstellung-falsch-");
  try {
    const res = installiere(ohne, ["--language", "en"], boardFake(ohne, KARTEN));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /workflow\.config\.json/);
    assert.equal(existsSync(join(ohne, ".claude", "workflow.config.json")), false);

    const res2 = installiere(falsch, ["--language", "fr"], boardFake(falsch, KARTEN));
    assert.equal(res2.status, 1);
    assert.match(res2.stderr, /de.*en/);
    assert.deepEqual(lies(falsch, "workflow.config.json"), DEUTSCH);
    assert.equal(existsSync(join(falsch, ".claude", "workflow.config.json.vor-umstellung")), false);
  } finally {
    rmSync(ohne, { recursive: true, force: true });
    rmSync(falsch, { recursive: true, force: true });
  }
});

// Ein neues englisches Projekt: Sprache en, GitHub mit Schutz (Attrappe meldet scharf). Der
// Installer schreibt pushPruefung — in einem englischen Projekt unter dem englischen Namen.
test("Ein neues englisches Projekt bekommt englische Schluessel", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "install-neu-en-")));
  mkdirSync(join(dir, "home"), { recursive: true });
  try {
    const skript = join(dir, "schutz-fake.mjs");
    writeFileSync(skript, 'console.log(JSON.stringify({ ergebnis: "scharf", grund: "Attrappe" }));\n');
    const antworten = ["en", "projekt", "github", "j", "j", "pruefzweig", "github", "", "", "", "", "", "", ""];
    const res = installiere(dir, [], { INSTALL_SCHUTZ_FAKE: skript }, antworten);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = lies(dir, "workflow.config.json");
    assert.equal(c.language, "en");
    assert.deepEqual(c.pushCheck, { location: "buildService", branch: "pruefzweig" });
    assert.equal("pushPruefung" in c, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Regeltexte, Pruefer und Pruefrollen je Projektsprache (Issue #1464, Plan #1420 E12, E17) ---
//
// Skills gibt es seit Issue #1566 nur in einer Fassung: Jedes Projekt bekommt dieselben, und die
// Umstellung laesst sie stehen. Der Spiegel en/ reist als eigene Blobs in install.mjs. Solange er leer ist, hat keine Datei
// eine englische Fassung; die Faelle unten brauchen aber beides, eine englische und eine
// fehlende. Darum laeuft eine Kopie des Installers, deren Spiegel-Blobs einen Teil tragen —
// genau so, wie tools/sync-blobs.mjs sie aus en/ backt.

const SPIEGEL = {
  TEMPLATES_EN_B64: { "CLAUDE-workflow.md": "# Workflow (en)\n" },
  AGENTS_EN_B64: { "kit-pruefer.md": "# Checker (en)\n" },
  KIT_ROLLEN_EN_B64: { "code-review.md": "# Code review (en)\n" },
};

function installerMitSpiegel(dir) {
  let src = readFileSync(INSTALLER, "utf-8");
  for (const [konstante, inhalt] of Object.entries(SPIEGEL)) {
    const re = new RegExp(`(const ${konstante} = ")[A-Za-z0-9+/=]*(";)`);
    assert.match(src, re, konstante);
    src = src.replace(re, `$1${Buffer.from(JSON.stringify(inhalt), "utf-8").toString("base64")}$2`);
  }
  mkdirSync(join(dir, "verteilt"), { recursive: true });
  const pfad = join(dir, "verteilt", "install.mjs");
  writeFileSync(pfad, src);
  return pfad;
}

const deutscheQuelle = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");
const installiert = (dir, ...teile) => readFileSync(join(dir, ".claude", ...teile), "utf-8");

/** Englische Fassung, wo der Spiegel sie traegt, sonst die deutsche. Die Skills nur in einer Fassung. */
function assertFassungen(dir, sprache) {
  const en = sprache === "en";
  assertSkills(dir);
  assert.equal(installiert(dir, "CLAUDE-workflow.md"), en ? "# Workflow (en)\n" : deutscheQuelle("templates", "CLAUDE-workflow.md"));
  assert.equal(installiert(dir, "CLAUDE-Plan.md"), deutscheQuelle("templates", "CLAUDE-Plan.md"));
  assert.equal(installiert(dir, "agents", "kit-pruefer.md"), en ? "# Checker (en)\n" : deutscheQuelle("agents", "kit-pruefer.md"));
  assert.equal(installiert(dir, "kit", "rollen", "code-review.md"), en ? "# Code review (en)\n" : deutscheQuelle("kit", "rollen", "code-review.md"));
  assert.equal(installiert(dir, "kit", "rollen", "pruefbarkeit.md"), deutscheQuelle("kit", "rollen", "pruefbarkeit.md"));
}

/** Jeder Skill liegt in der einen Fassung aus skills/, keiner der alten Namen. */
function assertSkills(dir) {
  for (const name of ["requirement", "techplan", "session-start", "kit-review"]) {
    assert.equal(installiert(dir, "skills", name, "SKILL.md"), deutscheQuelle("skills", name, "SKILL.md"), name);
  }
  for (const alt of ["fachplan", "kontext", "context", "review", "plan", "local-check"]) {
    assert.equal(existsSync(join(dir, ".claude", "skills", alt)), false, `${alt} wurde installiert`);
  }
}

const NEU = ["projekt", "github", "j", "j", "pruefzweig", "github", "", "", "", "", "", "", ""];
const schutzFake = (dir) => {
  const skript = join(dir, "schutz-fake.mjs");
  writeFileSync(skript, 'console.log(JSON.stringify({ ergebnis: "scharf", grund: "Attrappe" }));\n');
  return { INSTALL_SCHUTZ_FAKE: skript };
};

test("Ein neues englisches Projekt bekommt die englischen Fassungen unter den gewohnten Pfaden, fehlende deutsch und genannt, Skills in der einen Fassung", () => {
  const dir = fixture("install-fassung-en-");
  try {
    const res = installiere(dir, [], schutzFake(dir), ["en", ...NEU], installerMitSpiegel(dir));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assertFassungen(dir, "en");

    const rueckfall = res.stdout.split("\n").filter((z) => z.includes("Installed in German"));
    assert.ok(!rueckfall.some((z) => z.includes(join(dir, ".claude", "skills"))), "Skills haben nur eine Fassung, also keinen Rueckfall");
    const regeltexte = rueckfall.find((z) => z.includes("CLAUDE-Plan.md")) ?? "";
    assert.doesNotMatch(regeltexte, /CLAUDE-workflow\.md/);
    assert.ok(rueckfall.some((z) => z.includes("pruefbarkeit.md") && !z.includes("code-review.md")), "die Pruefrollen werden genannt");
    assert.ok(!rueckfall.some((z) => z.includes("kit-pruefer.md")), "der Pruefer hat eine englische Fassung");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ein neues deutsches Projekt bekommt die deutschen Fassungen und keinen Rueckfall-Hinweis", () => {
  const dir = fixture("install-fassung-de-");
  try {
    const res = installiere(dir, [], schutzFake(dir), ["de", ...NEU], installerMitSpiegel(dir));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assertFassungen(dir, "de");
    assert.doesNotMatch(res.stdout, /Deutsch installiert|Installed in German/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Prueft Regeltexte, Pruefer und Pruefrollen; die Skills prueft der Aufrufer selbst. */
function assertSprachdateien(dir, sprache) {
  const en = sprache === "en";
  assert.equal(installiert(dir, "CLAUDE-workflow.md"), en ? "# Workflow (en)\n" : deutscheQuelle("templates", "CLAUDE-workflow.md"));
  assert.equal(installiert(dir, "agents", "kit-pruefer.md"), en ? "# Checker (en)\n" : deutscheQuelle("agents", "kit-pruefer.md"));
  assert.equal(installiert(dir, "kit", "rollen", "code-review.md"), en ? "# Code review (en)\n" : deutscheQuelle("kit", "rollen", "code-review.md"));
}

test("Die Umstellung tauscht Regeltexte, Pruefer und Rollen, keine Skills, hin und zurueck, und nennt, was deutsch bleibt", () => {
  const dir = deutschesProjekt("install-umstellung-fassung-");
  try {
    // Ein Skill, den der Mensch angepasst hat: Die Umstellung tauscht keine Skills mehr.
    mkdirSync(join(dir, ".claude", "skills", "techplan"), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", "techplan", "SKILL.md"), "# eigen\n");
    const installer = installerMitSpiegel(dir);
    const hin = installiere(dir, ["--language", "en"], boardFake(dir, KARTEN), [], installer);
    assert.equal(hin.status, 0, `${hin.stderr}\n${hin.stdout}`);
    assertSprachdateien(dir, "en");
    assert.equal(installiert(dir, "skills", "techplan", "SKILL.md"), "# eigen\n", "die Umstellung hat einen Skill getauscht");
    assert.equal(existsSync(join(dir, ".claude", "skills", "requirement")), false, "die Umstellung hat Skills angelegt");
    // Berichtet wird in der Sprache vor der Umstellung, die Liste steht unter "Offen".
    const offen = hin.stdout.slice(hin.stdout.indexOf("Offen ("));
    assert.match(offen, /Deutsch installiert.*CLAUDE-Plan\.md/);
    assert.doesNotMatch(offen, /Deutsch installiert.*skills/);
    assert.equal(existsSync(join(dir, ".claude", "kit", "board.mjs")), false, "die Umstellung schreibt nur die Sprachfassungen");

    const zurueck = installiere(dir, ["--language", "de"], boardFake(dir, KARTEN), [], installer);
    assert.equal(zurueck.status, 0, `${zurueck.stderr}\n${zurueck.stdout}`);
    assertSprachdateien(dir, "de");
    assert.equal(installiert(dir, "skills", "techplan", "SKILL.md"), "# eigen\n");
    assert.doesNotMatch(zurueck.stdout, /Deutsch installiert|Installed in German/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
