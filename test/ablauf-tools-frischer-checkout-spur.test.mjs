// Ablauf-Pruefung: der Spur-Einstieg startet den frischen Checkout als eigenes Programm; das zeigt nur der Start.
//
// Schutztest des Spur-Einstiegs fuer den frischen Checkout (Issue #1037, Plan #1035).
//
// Der Einstieg wird ueber `NODE_OPTIONS=--import <file-URL>` in jeden Node-Prozess
// des frischen Laufs geladen und schreibt die Dateizugriffe mit, die unterhalb der
// Wurzel fehlschlagen. Daran erkennt das Pruefwerkzeug den stillen Fall: Ein Test ist
// im frischen Checkout gruen, hat aber eine Datei gesucht, die dort fehlt.
//
// Jeder Fall startet deshalb einen echten `node`-Prozess mit dem Einstieg, genau so,
// wie ihn das Werkzeug startet, und liest danach die Spurdatei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const spur = join(repoRoot, "tools", "frischer-checkout-spur.mjs");
const spurUrl = pathToFileURL(spur).href;

/** Legt Wurzel und Spurordner an, ruft `fn` und raeumt beides wieder ab. */
function mitWurzel(fn) {
  const wurzel = mkdtempSync(join(tmpdir(), "spur-wurzel-"));
  const ablage = mkdtempSync(join(tmpdir(), "spur-ablage-"));
  try {
    return fn({ wurzel, spurdatei: join(ablage, "spur.jsonl") });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(ablage, { recursive: true, force: true });
  }
}

/** Schreibt `inhalt` nach `wurzel/name` und startet ihn mit dem Einstieg. */
function starte({ wurzel, spurdatei }, name, inhalt, { urls = [spurUrl], env = {}, mitSpur = true } = {}) {
  const pfad = join(wurzel, name);
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
  const umgebung = { ...process.env, KIT_CHECKOUT_TESTDATEI: "", ...env };
  umgebung.NODE_OPTIONS = urls.map((u) => `--import ${u}`).join(" ");
  if (mitSpur) umgebung.KIT_CHECKOUT_SPUR = spurdatei;
  else delete umgebung.KIT_CHECKOUT_SPUR;
  if (!("KIT_CHECKOUT_WURZEL" in env)) umgebung.KIT_CHECKOUT_WURZEL = wurzel;
  const r = spawnSync(process.execPath, [name], { cwd: wurzel, env: umgebung, encoding: "utf8" });
  assert.equal(r.status, 0, `Prozess scheiterte: ${r.stderr}`);
  return r;
}

function zeilen(spurdatei) {
  if (!existsSync(spurdatei)) return [];
  return readFileSync(spurdatei, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

test("[1037] existsSync auf einen fehlenden relativen Pfad ergibt eine Zeile relativ zur Wurzel", () => {
  mitWurzel((ctx) => {
    starte(ctx, "a.mjs", `import fs from "node:fs";\nfs.existsSync(".claude/x.md");\n`);
    assert.deepEqual(zeilen(ctx.spurdatei), [{ datei: null, pfad: ".claude/x.md", zugriff: "existsSync" }]);
  });
});

test("[1037] benannter ESM-Import, readFileSync mit ENOENT und fs/promises.readFile werden erfasst", () => {
  mitWurzel((ctx) => {
    starte(
      ctx,
      "b.mjs",
      [
        `import { existsSync, readFileSync } from "node:fs";`,
        `import { readFile } from "node:fs/promises";`,
        `existsSync("eins.md");`,
        `try { readFileSync("zwei.md"); } catch {}`,
        `try { await readFile("drei/vier.md"); } catch {}`,
        ``,
      ].join("\n"),
    );
    assert.deepEqual(
      zeilen(ctx.spurdatei).map((z) => [z.pfad, z.zugriff]),
      [
        ["eins.md", "existsSync"],
        ["zwei.md", "readFileSync"],
        ["drei/vier.md", "promises.readFile"],
      ],
    );
  });
});

test("[1037] ein fehlender Pfad ausserhalb der Wurzel und ein vorhandener Pfad erzeugen keine Zeile", () => {
  mitWurzel((ctx) => {
    const draussen = join(dirname(ctx.spurdatei), "fehlt-draussen.md");
    writeFileSync(join(ctx.wurzel, "da.md"), "x");
    starte(
      ctx,
      "c.mjs",
      [
        `import { existsSync, readFileSync, statSync } from "node:fs";`,
        `existsSync(${JSON.stringify(draussen)});`,
        `existsSync("da.md");`,
        `readFileSync("da.md");`,
        `statSync("da.md");`,
        ``,
      ].join("\n"),
    );
    assert.deepEqual(zeilen(ctx.spurdatei), []);
  });
});

test("[1037] Wurzel und Zugriff ueber tmpdir- und realpath-Form treffen sich (macOS /var gegen /private/var)", () => {
  mitWurzel((ctx) => {
    const echt = realpathSync(ctx.wurzel);
    // Zugriff ueber den realpath, Wurzel als tmpdir-Pfad
    starte(ctx, "d.mjs", `import { existsSync } from "node:fs";\nexistsSync(${JSON.stringify(join(echt, "fehlt-a.md"))});\n`);
    // Zugriff ueber den tmpdir-Pfad, Wurzel als realpath
    starte(ctx, "e.mjs", `import { existsSync } from "node:fs";\nexistsSync(${JSON.stringify(join(ctx.wurzel, "sub", "fehlt-b.md"))});\n`, {
      env: { KIT_CHECKOUT_WURZEL: echt },
    });
    assert.deepEqual(
      zeilen(ctx.spurdatei).map((z) => z.pfad),
      ["fehlt-a.md", "sub/fehlt-b.md"],
    );
  });
});

test("[1037] ohne KIT_CHECKOUT_SPUR entsteht keine Datei, und der Prozess verhaelt sich wie ohne Einstieg", () => {
  mitWurzel((ctx) => {
    const skript = [
      `import { existsSync, readFileSync } from "node:fs";`,
      `console.log(existsSync("fehlt.md"), existsSync("f.mjs"));`,
      `try { readFileSync("fehlt.md"); } catch (e) { console.log(e.code); }`,
      ``,
    ].join("\n");
    const mit = starte(ctx, "f.mjs", skript, { mitSpur: false });
    const ohne = starte(ctx, "f.mjs", skript, { mitSpur: false, urls: [] });
    assert.equal(existsSync(ctx.spurdatei), false);
    assert.equal(mit.stdout, ohne.stdout);
    assert.equal(mit.stdout, "false true\nENOENT\n");
  });
});

test("[1037] zweimal geladen schreibt jeder Fehlschlag genau eine Zeile", () => {
  mitWurzel((ctx) => {
    starte(
      ctx,
      "g.mjs",
      [
        `import { existsSync } from "node:fs";`,
        `import { stat } from "node:fs/promises";`,
        `existsSync("eins.md");`,
        `try { await stat("zwei.md"); } catch {}`,
        ``,
      ].join("\n"),
      { urls: [spurUrl, `${spurUrl}?zweiter`] },
    );
    assert.deepEqual(
      zeilen(ctx.spurdatei).map((z) => z.pfad),
      ["eins.md", "zwei.md"],
    );
  });
});

test("[1037] ein Kindprozess einer *.test.mjs schreibt seine Zeile mit dieser Testdatei", () => {
  mitWurzel((ctx) => {
    writeFileSync(join(ctx.wurzel, "kind.mjs"), `import { existsSync } from "node:fs";\nexistsSync(".claude/x.md");\n`);
    starte(
      ctx,
      join("test", "eltern.test.mjs"),
      [
        `import { spawnSync } from "node:child_process";`,
        `const r = spawnSync(process.execPath, ["kind.mjs"], { env: { ...process.env }, encoding: "utf8" });`,
        `if (r.status !== 0) { console.error(r.stderr); process.exit(1); }`,
        ``,
      ].join("\n"),
    );
    assert.deepEqual(zeilen(ctx.spurdatei), [
      { datei: "test/eltern.test.mjs", pfad: ".claude/x.md", zugriff: "existsSync" },
    ]);
  });
});
