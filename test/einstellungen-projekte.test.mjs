// Projektsuche und Kit-Stand in kit/einstellungen.mjs (Issue #677, Plan #674 E9, E10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { vergleicheVersion } from "../kit/einstellungen.mjs";
import { mitServer, projekt } from "./helpers/einstellungen-fixture.mjs";

test("[einstellungen-5] gefunden werden der Startordner und direkte Unterverzeichnisse mit Config", async () => {
  const aufbau = (wurzel) => {
    projekt(wurzel, ".", { stand: "1.0.0" });
    projekt(wurzel, "alpha", { stand: "1.0.0" });
    projekt(join(wurzel, "gruppe"), "tief", { stand: "1.0.0" });
    mkdirSync(join(wurzel, "ohne-config"), { recursive: true });
    writeFileSync(join(wurzel, "datei.txt"), "x");
  };
  await mitServer(aufbau, async ({ anfrage, wurzel }) => {
    const liste = await (await anfrage("/api/projekte")).json();
    const namen = liste.projekte.map((p) => p.name).sort();
    assert.equal(namen.length, 2, JSON.stringify(namen));
    assert.ok(namen.includes("alpha"));
    assert.ok(namen.includes(basename(wurzel)), "der Startordner fehlt");
  });
});

test("[einstellungen-5] der Kit-Stand kommt aus dem Projekt, sonst aus ~/.claude/kit, sonst ist er unbekannt", async () => {
  const aufbau = (wurzel, home) => {
    projekt(wurzel, "eigen", { stand: "1.0.0" });
    projekt(wurzel, "global");
    projekt(wurzel, "neuer", { stand: "9.0.0" });
    mkdirSync(join(home, ".claude", "kit"), { recursive: true });
    writeFileSync(join(home, ".claude", "kit", "board.mjs"), 'const KIT_VERSION = "4.9.9";\n');
  };
  await mitServer(aufbau, async ({ anfrage }) => {
    const liste = (await (await anfrage("/api/projekte")).json()).projekte;
    const p = (name) => liste.find((x) => x.name === name);
    assert.equal(p("eigen").kitStand, "1.0.0");
    assert.equal(p("eigen").bearbeitbar, true);
    assert.equal(p("global").kitStand, "4.9.9");
    assert.equal(p("global").bearbeitbar, true);
    assert.equal(p("neuer").bearbeitbar, false);
    assert.match(p("neuer").hinweis, /neuer/);
  });
  await mitServer((wurzel) => projekt(wurzel, "ohne"), async ({ anfrage }) => {
    const p = (await (await anfrage("/api/projekte")).json()).projekte[0];
    assert.equal(p.kitStand, null);
    assert.equal(p.bearbeitbar, false);
    assert.match(p.hinweis, /unbekannt/);
  });
});

test("[einstellungen-5] Versionen werden je Stelle numerisch verglichen", () => {
  assert.ok(vergleicheVersion("1.9.0", "1.53.1") < 0);
  assert.ok(vergleicheVersion("1.53.1", "1.53.1") === 0);
  assert.ok(vergleicheVersion("2.0.0", "1.99.99") > 0);
});

test("[einstellungen-5] ein unbekannter Projektname liefert 404, auch mit .. oder /", async () => {
  await mitServer((w) => projekt(w, "alpha", { stand: "1.0.0" }), async ({ anfrage }) => {
    for (const name of ["beta", "..", "alpha%2F..%2F..", "%2Fetc"]) {
      const res = await anfrage(`/api/projekt/${name}`);
      assert.equal(res.status, 404, name);
    }
  });
});
