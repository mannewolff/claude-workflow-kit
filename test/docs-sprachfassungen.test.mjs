// tools/sprachfassungen.mjs haelt die deutsche und die englische Doku gleich (Issue #1355,
// Plan #1348 E5, E6, E9). Der erste Fall prueft das Repo selbst und laeuft darum in jedem
// Prueflauf vor dem Commit mit (E7); die Fixture-Faelle unter KIT_ROOT zeigen je Abweichung
// Seite und Abschnitt in der Meldung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "sprachfassungen.mjs");

function lauf(args, root) {
  const env = { ...process.env };
  if (root) env.KIT_ROOT = root;
  else delete env.KIT_ROOT;
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf-8", env });
}

const SEITE = [
  "# Seite",
  "",
  "Einleitung.",
  "",
  "## Erster",
  "",
  "Text eins.",
  "",
  "```bash",
  "# kein Kopf, sondern ein Kommentar im Codeblock",
  "echo eins",
  "```",
  "",
  "## Zweiter",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "### Dritter",
  "",
  "Ende.",
  "",
].join("\n");

const START_SEITE = ["---", "layout: home", "hero:", "  name: Kit", "---", ""].join("\n");

const EINSTELLUNGEN = [
  "# Doku",
  "",
  "Vorwort.",
  "",
  "## Alle Einstellungen",
  "",
  "Text davor.",
  "",
  "<!-- einstellungen:start -->",
  "### `mainBranch`",
  "",
  "Erzeugter Text.",
  "<!-- einstellungen:ende -->",
  "",
  "## Danach",
  "",
  "Schluss.",
  "",
].join("\n");

/** Die Stempel einer deutschen Seite, wie --erwartet sie ausgibt: [{ stempel, kopf }]. */
function erwartet(dir, seite) {
  const res = lauf(["--erwartet", seite], dir);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout
    .trim()
    .split("\n")
    .map((z) => {
      const m = /^<!-- de: ([0-9a-f]{12}) --> {2}(\S.*)$/.exec(z);
      assert.ok(m, `unerwartete Zeile: ${z}`);
      return { stempel: m[1], kopf: m[2] };
    });
}

/** Englische Fassung: der deutsche Text mit dem Stempel unter jeder Ueberschrift. */
function englisch(deutsch, stempel) {
  const kopfe = stempel.filter((s) => s.kopf.startsWith("#"));
  let i = 0;
  let imCode = false;
  let erzeugt = false;
  const aus = [];
  for (const zeile of deutsch.split("\n")) {
    if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;
    if (zeile === "<!-- einstellungen:start -->") erzeugt = true;
    if (zeile === "<!-- einstellungen:ende -->") erzeugt = false;
    aus.push(zeile);
    if (!imCode && !erzeugt && /^#{1,6}\s/.test(zeile) && i < kopfe.length) {
      aus.push(`<!-- de: ${kopfe[i].stempel} -->`);
      i++;
    }
  }
  return aus.join("\n");
}

function mitFixture(fn, { aktiv = false, historisch = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sprachfassungen-"));
  try {
    mkdirSync(join(dir, "docs", "en"), { recursive: true });
    mkdirSync(join(dir, "docs-site"));
    writeFileSync(join(dir, "docs-site", "sprachen.json"), JSON.stringify({ englischAktiv: aktiv, historisch }));
    writeFileSync(join(dir, "docs", "seite.md"), SEITE);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function schreibeEn(dir, name, text) {
  writeFileSync(join(dir, "docs", "en", `${name}.md`), text);
}

test("--check ist im Repo gruen", () => {
  const res = lauf(["--check"]);
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test("--erwartet nennt je Ueberschrift einen 12-stelligen Stempel ueber den deutschen Abschnitt", () => {
  mitFixture((dir) => {
    const st = erwartet(dir, "seite");
    assert.deepEqual(
      st.map((s) => s.kopf),
      ["# Seite", "## Erster", "## Zweiter", "### Dritter"]
    );
    const abschnitt = "# Seite\n\nEinleitung.\n";
    const hash = createHash("sha256").update(abschnitt).digest("hex").slice(0, 12);
    assert.equal(st[0].stempel, hash);
    // Zeilenenden sind normalisiert: CRLF ergibt dieselben Stempel.
    writeFileSync(join(dir, "docs", "seite.md"), SEITE.replaceAll("\n", "\r\n"));
    assert.deepEqual(erwartet(dir, "seite"), st);
  });
});

test("--erwartet wsl2 laeuft auf dem Repo", () => {
  const res = lauf(["--erwartet", "wsl2"]);
  assert.equal(res.status, 0, res.stderr);
  const zeilen = res.stdout.trim().split("\n");
  assert.ok(zeilen.length > 3);
  for (const z of zeilen) assert.match(z, /^<!-- de: [0-9a-f]{12} -->\s+#{1,6} /);
});

test("eine vollstaendige, gestempelte Fassung ist gruen", () => {
  mitFixture((dir) => {
    schreibeEn(dir, "seite", englisch(SEITE, erwartet(dir, "seite")));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 0, res.stderr);
  });
});

test("veralteter Stempel nennt Seite, Abschnitt und erwarteten Stempel", () => {
  mitFixture((dir) => {
    const st = erwartet(dir, "seite");
    schreibeEn(dir, "seite", englisch(SEITE, st));
    writeFileSync(join(dir, "docs", "seite.md"), SEITE.replace("Text eins.", "Text eins, geaendert."));
    const neu = erwartet(dir, "seite");
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /seite\.md/);
    assert.match(res.stderr, /## Erster/);
    assert.ok(res.stderr.includes(neu[1].stempel), res.stderr);
    assert.doesNotMatch(res.stderr, /## Zweiter/);
  });
});

test("fehlende Ueberschrift mitten in der Seite ist eine Luecke", () => {
  mitFixture((dir) => {
    const en = englisch(SEITE, erwartet(dir, "seite"));
    const ohne = en.replace(/## Zweiter\n<!-- de: [0-9a-f]{12} -->\n\n\| a \| b \|\n\|---\|---\|\n\| 1 \| 2 \|\n\n/, "");
    assert.notEqual(ohne, en);
    schreibeEn(dir, "seite", ohne);
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /seite\.md/);
    assert.match(res.stderr, /## Zweiter/);
  });
});

test("vertauschte Reihenfolge wird gemeldet", () => {
  mitFixture((dir) => {
    const st = erwartet(dir, "seite");
    const en = englisch(SEITE, st);
    const a = en.indexOf("## Erster");
    const b = en.indexOf("## Zweiter");
    const c = en.indexOf("### Dritter");
    const getauscht = en.slice(0, a) + en.slice(b, c) + en.slice(a, b) + en.slice(c);
    schreibeEn(dir, "seite", getauscht);
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /seite\.md/);
    assert.match(res.stderr, /## Erster/);
    assert.match(res.stderr, /Reihenfolge/);
  });
});

test("fehlender Codeblock wird je Abschnitt gemeldet", () => {
  mitFixture((dir) => {
    const en = englisch(SEITE, erwartet(dir, "seite"));
    schreibeEn(dir, "seite", en.replace(/```bash\n[\s\S]*?```\n/, ""));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /seite\.md/);
    assert.match(res.stderr, /## Erster/);
    assert.match(res.stderr, /Codebl/);
  });
});

test("ein lueckenloses Anfangsstueck ist bei englischAktiv false gruen, eine Luecke nicht", () => {
  mitFixture((dir) => {
    const en = englisch(SEITE, erwartet(dir, "seite"));
    const anfang = en.slice(0, en.indexOf("## Zweiter"));
    schreibeEn(dir, "seite", anfang);
    assert.equal(lauf(["--check"], dir).status, 0);

    const luecke = en.slice(0, en.indexOf("## Erster")) + en.slice(en.indexOf("## Zweiter"), en.indexOf("### Dritter"));
    schreibeEn(dir, "seite", luecke);
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /seite\.md/);
    assert.match(res.stderr, /## Erster/);
    assert.match(res.stderr, /Luecke|Lücke/);
  });
});

test("historische Seite ohne Verweis auf das deutsche Original wird gemeldet", () => {
  mitFixture(
    (dir) => {
      writeFileSync(join(dir, "docs", "alt.md"), "# Alt\n\nText.\n\n## Teil\n\nMehr.\n");
      schreibeEn(dir, "alt", "# Old\n\nThis page is a historical document and is available in German only.\n");
      const res = lauf(["--check"], dir);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /alt\.md/);
      assert.match(res.stderr, /\]\(\/alt\)/);

      schreibeEn(dir, "alt", "# Old\n\nThis page is a historical document and is available in German only. See [the original](/alt).\n");
      const gruen = lauf(["--check"], dir);
      assert.equal(gruen.status, 0, gruen.stderr);
    },
    { historisch: ["alt"] }
  );
});

test("veralteter Stempel in Abschnitt 0 einer Seite mit Frontmatter", () => {
  mitFixture((dir) => {
    writeFileSync(join(dir, "docs", "index.md"), START_SEITE);
    const st = erwartet(dir, "index");
    assert.equal(st.length, 1);
    const mitStempel = (s) => START_SEITE.replace(/---\n$/, `---\n<!-- de: ${s} -->\n`);
    schreibeEn(dir, "index", mitStempel(st[0].stempel));
    const gruen = lauf(["--check"], dir);
    assert.equal(gruen.status, 0, gruen.stderr);

    writeFileSync(join(dir, "docs", "index.md"), START_SEITE.replace("name: Kit", "name: Kit 2"));
    const neu = erwartet(dir, "index");
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /index\.md/);
    assert.match(res.stderr, /Abschnitt 0/);
    assert.ok(res.stderr.includes(neu[0].stempel), res.stderr);
  });
});

test("geaenderter Text zwischen den Einstellungs-Markern bleibt ohne Meldung", () => {
  mitFixture((dir) => {
    writeFileSync(join(dir, "docs", "doku.md"), EINSTELLUNGEN);
    const st = erwartet(dir, "doku");
    assert.deepEqual(
      st.map((s) => s.kopf),
      ["# Doku", "## Alle Einstellungen", "## Danach"]
    );
    schreibeEn(dir, "doku", englisch(EINSTELLUNGEN, st).replace("Erzeugter Text.", "Generated text.\n\n### `extra`\n\nMore."));
    writeFileSync(join(dir, "docs", "doku.md"), EINSTELLUNGEN.replace("Erzeugter Text.", "Neu erzeugter Text."));
    assert.deepEqual(erwartet(dir, "doku"), st);
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 0, res.stderr);

    writeFileSync(join(dir, "docs", "doku.md"), EINSTELLUNGEN.replace("Text davor.", "Text davor, geaendert."));
    const rot = lauf(["--check"], dir);
    assert.equal(rot.status, 1);
    assert.match(rot.stderr, /## Alle Einstellungen/);
  });
});

test("bei englischAktiv true ist eine fehlende Seite eine Abweichung", () => {
  mitFixture(
    (dir) => {
      const res = lauf(["--check"], dir);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /en\/seite\.md/);
      assert.match(res.stderr, /# Seite/);
    },
    { aktiv: true }
  );
});

test("bei englischAktiv true ist ein blosses Anfangsstueck eine Abweichung", () => {
  mitFixture(
    (dir) => {
      const en = englisch(SEITE, erwartet(dir, "seite"));
      schreibeEn(dir, "seite", en.slice(0, en.indexOf("### Dritter")));
      const res = lauf(["--check"], dir);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /### Dritter/);
    },
    { aktiv: true }
  );
});
