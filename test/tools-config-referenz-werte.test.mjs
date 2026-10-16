// Ablauf-Pruefung: Die Referenz entsteht nur beim Start von tools/config-referenz.mjs als Programm gegen eine Kopie mit KIT_ROOT.
//
// Die Einstellungszeile nennt den Wertebereich aus minimum, maximum und const des Schemas,
// und die Vorgaben von reviewStages sagen, dass sie nur gelten, wenn der ganze Block fehlt
// (Issue #1669, Code-Review zu #1653). Gleich gebaute Geschwister, deren Zeilen bis auf das
// unterscheidende Pfadglied wörtlich gleich sind, stehen in einer Zeile mit `{a,b,c}` im Pfad
// (Issue #1732). Jedes Wurzelfeld der Teile „Beim Einrichten nötig“ und „Lohnt sich“ trägt in
// der Vorgabetabelle einen `wann`-Satz, jede Gruppe der Feinabstimmung einen `gruppe`-Satz;
// fehlt einer, ist das ein Fehler der Tabelle (Issue #1733).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");
const DATEIEN = ["templates/workflow.config.schema.json", "docs/einstellungen.md", "docs/en/einstellungen.md", "tools/config-referenz.en.json", "tools/config-referenz.vorgaben.json"];

function erzeugt(tabelleAendern) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-werte-"));
  try {
    for (const d of ["templates", "docs", join("docs", "en"), "tools"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of DATEIEN) copyFileSync(join(repoRoot, f), join(dir, f));
    if (tabelleAendern) {
      const pfad = join(dir, "tools", "config-referenz.vorgaben.json");
      writeFileSync(pfad, JSON.stringify(tabelleAendern(JSON.parse(readFileSync(pfad, "utf-8")))));
    }
    const res = spawnSync(process.execPath, [TOOL], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
    return {
      res,
      de: res.status === 0 ? readFileSync(join(dir, "docs", "einstellungen.md"), "utf-8") : "",
      en: res.status === 0 ? readFileSync(join(dir, "docs", "en", "einstellungen.md"), "utf-8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Die Pfade, für die ein Pfad mit `{a,b,c}` steht. */
function ausgeklappt(pfad) {
  const a = pfad.indexOf("{");
  const b = pfad.indexOf("}", a);
  if (a < 0 || b < 0) return [pfad];
  return pfad.slice(a + 1, b).split(",").flatMap((glied) => ausgeklappt(pfad.slice(0, a) + glied + pfad.slice(b + 1)));
}

/** Die Zeile einer Einstellung im erzeugten Teil, auch eine zusammengezogene. */
const zeile = (text, pfad) =>
  text.split("\n").find((z) => {
    const ende = z.indexOf("` — ");
    return z.startsWith("- `") && ende > 0 && ausgeklappt(z.slice(3, ende)).includes(pfad);
  }) ?? "";

test("Wertebereich aus minimum und maximum steht in der Zeile", () => {
  const { res, de, en } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(zeile(de, "buildChecks[].quality.marker"), /Werte: 0 bis 100\./);
  assert.match(zeile(en, "buildChecks[].quality.marker"), /Values: 0 to 100\./);
});

test("nur minimum wird als untere Grenze genannt", () => {
  const { de, en } = erzeugt();
  assert.match(zeile(de, "reviewStages.requirement.reviewer"), /Werte: ab 1\./);
  assert.match(zeile(en, "reviewStages.requirement.reviewer"), /Values: from 1\./);
});

test("const wird als einziger Wert genannt", () => {
  const { de, en } = erzeugt();
  const de_ = de.split("\n").filter((z) => /^- `[^`]*\.defaults` — /.test(z));
  const en_ = en.split("\n").filter((z) => /^- `[^`]*\.defaults` — /.test(z));
  assert.ok(de_.length > 0, "keine Zeile mit const gefunden");
  for (const z of de_) assert.match(z, /Wert: `true`\./);
  for (const z of en_) assert.match(z, /Value: `true`\./);
});

test("reviewStages nennt die Bedingung: Vorgabe nur, wenn der ganze Block fehlt", () => {
  const { de, en } = erzeugt();
  assert.match(zeile(de, "reviewStages"), /nur, wenn der ganze Block fehlt/);
  assert.match(zeile(en, "reviewStages"), /only if the whole block is missing/);
  for (const stufe of ["requirement", "plan", "issue"]) {
    for (const feld of ["reviewer", "roles"]) {
      assert.match(zeile(de, `reviewStages.${stufe}.${feld}`), /nur, wenn der ganze Block `reviewStages` fehlt/, `${stufe}.${feld}`);
      assert.match(zeile(en, `reviewStages.${stufe}.${feld}`), /only if the whole `reviewStages` block is missing/, `${stufe}.${feld}`);
    }
  }
});

test("eine Bedingung ohne englische Fassung ist ein Fehler der Tabelle", () => {
  const { res } = erzeugt((t) => ({ ...t, reviewStufen: { ...t.reviewStufen, bedingung: { de: "nur so" } } }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /reviewStufen: bedingung braucht de und en/);
});

test("gleich beschriebene Geschwister stehen in einer Zeile mit {a,b,c} im Pfad", () => {
  const { res, de, en } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  for (const text of [de, en]) {
    const z = zeile(text, "night.tiers.hard.model");
    assert.ok(z.startsWith("- `night.tiers.{hard,medium,easy}.model` — "), z);
    assert.equal(zeile(text, "night.tiers.medium.model"), z);
    assert.equal(zeile(text, "night.tiers.easy.model"), z);
    assert.equal(text.split("\n").filter((x) => x.includes("night.tiers.") && x.includes(".model`")).length, 1);
  }
  // Gleiche Zeilen verschiedener Wurzelfelder sind keine Geschwister und bleiben getrennt.
  assert.ok(zeile(de, "noCheck[].pattern").startsWith("- `noCheck[].pattern` — "), zeile(de, "noCheck[].pattern"));
  assert.ok(zeile(de, "scaffoldOnly[].pattern").startsWith("- `scaffoldOnly[].pattern` — "), zeile(de, "scaffoldOnly[].pattern"));
  assert.ok(zeile(de, "reviewStages.requirement.reviewer").startsWith("- `reviewStages.{requirement,plan}.reviewer` — "), zeile(de, "reviewStages.requirement.reviewer"));
});

test("weicht eine Geschwisterzeile ab, bleibt sie für sich", () => {
  const satz = { de: "Eigenes Modell der schweren Stufe.", en: "Own model of the hard tier." };
  const { res, de, en } = erzeugt((t) => ({ ...t, "night.stufen.schwer.modell": { satz } }));
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(zeile(de, "night.tiers.hard.model").startsWith("- `night.tiers.hard.model` — Eigenes Modell"), zeile(de, "night.tiers.hard.model"));
  assert.ok(zeile(en, "night.tiers.hard.model").startsWith("- `night.tiers.hard.model` — Own model"));
  for (const text of [de, en]) assert.ok(zeile(text, "night.tiers.medium.model").startsWith("- `night.tiers.{medium,easy}.model` — "));
});

test("weicht nur die englische Fassung ab, bleiben die Zeilen in beiden Fassungen getrennt", () => {
  const satz = { de: "Modell-ID für diese Stufe.", en: "Own model of the hard tier." };
  const { res, de, en } = erzeugt((t) => ({ ...t, "night.stufen.schwer.modell": { satz } }));
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(zeile(de, "night.tiers.hard.model").startsWith("- `night.tiers.hard.model` — Modell-ID"), zeile(de, "night.tiers.hard.model"));
  assert.ok(zeile(en, "night.tiers.hard.model").startsWith("- `night.tiers.hard.model` — Own model"));
  for (const text of [de, en]) assert.ok(zeile(text, "night.tiers.medium.model").startsWith("- `night.tiers.{medium,easy}.model` — "));
});

test("die Vorgabetabelle des Repos ist ohne Fehler", () => {
  const { res } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.doesNotMatch(res.stderr, /passt nicht zum Schema/);
});

test("ein fehlendes wann eines Wurzelfelds der ersten beiden Teile ist ein Fehler", () => {
  const { res } = erzeugt((t) => {
    const { wann, ...rest } = t.vertragsRepos;
    return { ...t, vertragsRepos: rest };
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /vertragsRepos \(contractRepos\): wann fehlt/);
});

test("eine fehlende gruppe einer Gruppe der Feinabstimmung ist ein Fehler", () => {
  const { res } = erzeugt((t) => {
    const { gruppe, ...rest } = t["night.kette"];
    return { ...t, "night.kette": rest };
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /night\.kette \(night\.chain\): gruppe fehlt/);
});

test("wann außerhalb der ersten beiden Teile ist ein Fehler", () => {
  const wann = { de: "Setzt man nie.", en: "Never set." };
  const { res } = erzeugt((t) => ({ ...t, befunde: { ...t.befunde, wann }, "vertragsRepos[].name": { wann } }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /befunde \(findings\): wann steht nur an einem Wurzelfeld der Teile/);
  assert.match(res.stderr, /vertragsRepos\[\]\.name \(contractRepos\[\]\.name\): wann steht nur an einem Wurzelfeld der Teile/);
});

test("gruppe außerhalb der Gruppen der Feinabstimmung ist ein Fehler", () => {
  const gruppe = { de: "Keine Gruppe.", en: "No group." };
  const { res } = erzeugt((t) => ({ ...t, "night.modell": { ...t["night.modell"], gruppe } }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /night\.modell \(night\.model\): gruppe steht nur an einer Gruppe der Feinabstimmung/);
});

test("ein wann ohne englische Fassung ist ein Fehler der Tabelle", () => {
  const { res } = erzeugt((t) => ({ ...t, vertragsRepos: { ...t.vertragsRepos, wann: { de: "nur so" } } }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /vertragsRepos: wann braucht de und en/);
});
