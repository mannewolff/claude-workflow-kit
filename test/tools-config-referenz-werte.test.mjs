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
const DATEIEN = ["templates/workflow.config.schema.json", "templates/workflow.config.json", "docs/einstellungen.md", "docs/en/einstellungen.md", "tools/config-referenz.en.json", "tools/config-referenz.vorgaben.json"];

function erzeugt(tabelleAendern, nachher) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-werte-"));
  try {
    for (const d of ["templates", "docs", join("docs", "en"), "tools"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of DATEIEN) copyFileSync(join(repoRoot, f), join(dir, f));
    if (tabelleAendern) {
      const pfad = join(dir, "tools", "config-referenz.vorgaben.json");
      writeFileSync(pfad, JSON.stringify(tabelleAendern(JSON.parse(readFileSync(pfad, "utf-8")))));
    }
    const res = spawnSync(process.execPath, [TOOL], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
    const beispiel = (sprache) => {
      const pfad = join(dir, "templates", `workflow.config.example.${sprache}.jsonc`);
      return res.status === 0 ? readFileSync(pfad, "utf-8") : "";
    };
    return {
      res,
      check: nachher ? nachher(dir) : null,
      beispielDe: beispiel("de"),
      beispielEn: beispiel("en"),
      de: res.status === 0 ? readFileSync(join(dir, "docs", "einstellungen.md"), "utf-8") : "",
      en: res.status === 0 ? readFileSync(join(dir, "docs", "en", "einstellungen.md"), "utf-8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Text einer Beispieldatei ohne ganze Kommentarzeilen, als Objekt. */
const aktiv = (text) => JSON.parse(text.split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n"));

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

// Die Gliederung nach Zweck (Issue #1734, Plan #1710 A7, A8, E4, E6): `### <Teil>` je Teil in der
// Reihenfolge der Seite, der `wann`-Satz am Ende der Zeile jedes Wurzelfelds der ersten beiden
// Teile, der `gruppe`-Satz vor jeder Gruppe der Feinabstimmung, das Kennzeichen im Teil „Vom Kit
// verwaltet“ und eine Zeile für `version`.

const TEIL_KOEPFE = {
  de: ["### Beim Einrichten nötig", "### Lohnt sich", "### Vom Kit verwaltet", "### Feinabstimmung"],
  en: ["### Needed at setup", "### Worth setting", "### Managed by the kit", "### Fine-tuning"],
};

/** Der erzeugte Teil zwischen den Markern als Zeilen. */
const blockZeilen = (text) => text.slice(text.indexOf("<!-- einstellungen:start -->"), text.indexOf("<!-- einstellungen:ende -->")).split("\n");

/** Je Teilüberschrift die Zeilen darunter bis zur nächsten. */
function nachTeil(text) {
  const teile = new Map();
  let aktuell = null;
  for (const z of blockZeilen(text)) {
    if (z.startsWith("### ")) {
      aktuell = z;
      teile.set(aktuell, []);
    } else if (aktuell) teile.get(aktuell).push(z);
  }
  return teile;
}

const TABELLE = JSON.parse(readFileSync(join(repoRoot, "tools", "config-referenz.vorgaben.json"), "utf-8"));

test("die Teile stehen als ###-Überschriften ohne Backtick in der Reihenfolge der Seite", () => {
  const { res, de, en } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  for (const [sprache, text] of [["de", de], ["en", en]]) {
    const koepfe = blockZeilen(text).filter((z) => z.startsWith("#"));
    assert.deepEqual(koepfe, TEIL_KOEPFE[sprache]);
  }
});

test("jede Einstellung steht unter der Überschrift ihres Teils", async () => {
  const { teilVon } = await import("../kit/board/config-teile.mjs");
  const { de } = erzeugt();
  const kopfJeTeil = Object.fromEntries(["einrichten", "lohnt", "verwaltet", "fein"].map((t, i) => [t, TEIL_KOEPFE.de[i]]));
  for (const [kopf, zeilen] of nachTeil(de)) {
    for (const z of zeilen.filter((x) => x.startsWith("- `"))) {
      const pfad = z.slice(3, z.indexOf("` — "));
      assert.equal(kopfJeTeil[teilVon(pfad)], kopf, pfad);
    }
  }
});

test("jedes Wurzelfeld der ersten beiden Teile trägt seinen wann-Satz am Ende seiner Zeile", async () => {
  const { SCHLUESSEL } = await import("../kit/board/config-namen.mjs");
  const { de, en } = erzeugt();
  const mitWann = Object.entries(TABELLE).filter(([, e]) => e.wann);
  assert.ok(mitWann.length >= 20, `nur ${mitWann.length} wann-Sätze`);
  for (const [pfad, { wann }] of mitWann) {
    const englisch = SCHLUESSEL[pfad] ?? pfad;
    assert.ok(zeile(de, englisch).endsWith(` ${wann.de}`), zeile(de, englisch));
    assert.ok(zeile(en, englisch).endsWith(` ${wann.en}`), zeile(en, englisch));
  }
  // Ein Unterfeld trägt keinen wann-Satz, auch nicht den seines Wurzelfelds.
  assert.ok(!zeile(de, "contractRepos[].name").includes(TABELLE.vertragsRepos.wann.de));
});

test("jede Gruppe der Feinabstimmung leitet ihr gruppe-Satz ein", () => {
  const { de, en } = erzeugt();
  const englisch = { "night.kette": "night.chain", "night.stufen": "night.tiers", "night.stand": "night.status", pruefLauf: "checkRun", aufwand: "workload", wirksamkeit: "effectiveness", befunde: "findings" };
  const mitGruppe = Object.entries(TABELLE).filter(([, e]) => e.gruppe);
  assert.ok(mitGruppe.length >= 8, `nur ${mitGruppe.length} gruppe-Sätze`);
  for (const [sprache, text] of [["de", de], ["en", en]]) {
    const zeilen = nachTeil(text).get(TEIL_KOEPFE[sprache][3]);
    for (const [pfad, { gruppe }] of mitGruppe) {
      const p = englisch[pfad] ?? pfad;
      const i = zeilen.findIndex((z) => z.startsWith(`- \`${p}\` — `));
      assert.ok(i > 0, `${p} fehlt in der Feinabstimmung`);
      const davor = zeilen.slice(0, i).findLast((z) => z.trim());
      assert.equal(davor, gruppe[sprache], `${sprache}: ${p}`);
    }
  }
});

test("der Teil „Vom Kit verwaltet“ trägt das Kennzeichen, version hat eine Zeile", () => {
  const { de, en } = erzeugt();
  const erwartet = {
    provider: ["_Veraltet._", "_Deprecated._"],
    scenariosFrom: ["_Vom Installer gesetzt._", "_Set by the installer._"],
    version: ["_Vom Installer gesetzt._", "_Set by the installer._"],
    scaffoldOnly: ["_Intern._", "_Internal._"],
  };
  for (const [pfad, [kd, ke]] of Object.entries(erwartet)) {
    assert.ok(zeile(de, pfad).startsWith(`- \`${pfad}\` — ${kd} `), zeile(de, pfad));
    assert.ok(zeile(en, pfad).startsWith(`- \`${pfad}\` — ${ke} `), zeile(en, pfad));
    assert.ok(nachTeil(de).get(TEIL_KOEPFE.de[2]).includes(zeile(de, pfad)), pfad);
  }
  // Das Kennzeichen steht nur an der Zeile des Wurzelfelds.
  assert.doesNotMatch(zeile(de, "scaffoldOnly[].pattern"), /_Intern\._/);
});

// --- Die kommentierte Beispieldatei (Issue #1735, Plan #1710 A9, E3) ---

test("die Beispieldatei trägt die Einstellungen des ersten Teils aktiv mit Beispielwerten", () => {
  const { res, beispielDe, beispielEn } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const vorlage = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.json"), "utf-8"));
  for (const [sprache, text] of [["de", beispielDe], ["en", beispielEn]]) {
    const bsp = aktiv(text);
    assert.equal(bsp.language, sprache);
    assert.deepEqual(bsp.issueReview, vorlage.issueReview, `${sprache}: issueReview steht nicht als Block der Vorlage`);
    assert.equal(bsp.issueReview.reviewers.length, 3);
    assert.deepEqual(bsp.buildChecks, vorlage.buildChecks);
    assert.equal(bsp.mainBranch, vorlage.mainBranch);
    // Alles außerhalb des ersten Teils steht nicht aktiv.
    for (const feld of ["history", "night", "triggers", "version", "mutationCommand"]) assert.ok(!(feld in bsp), `${sprache}: ${feld} steht aktiv`);
  }
});

test("über jeder Einstellung steht derselbe Satz wie auf der Seite", () => {
  const { de, en, beispielDe, beispielEn } = erzeugt();
  for (const [seite, text, teil] of [[de, beispielDe, "Lohnt sich"], [en, beispielEn, "Worth setting"]]) {
    const zeilen = text.split("\n");
    assert.ok(zeilen.includes(`  // === ${teil} ===`), teil);
    for (const [feld, wert] of [["history", "true"], ["reviewScope", '"diff"'], ["mainBranch", '"main"']]) {
      const i = zeilen.findIndex((z) => new RegExp(`^  (// )?"${feld}": `).test(z));
      assert.ok(i > 0, `${feld} fehlt`);
      if (feld !== "mainBranch") assert.equal(zeilen[i], `  // "${feld}": ${wert},`);
      const satz = zeile(seite, feld).slice(`- \`${feld}\` — `.length);
      assert.equal(zeilen[i - 1], `  // ${satz}`, feld);
    }
  }
});

test("Unterfelder stehen mit ihrem Satz an ihrer Stelle, Gruppen mit ihrem gruppe-Satz", () => {
  const { de, beispielDe } = erzeugt();
  const zeilen = beispielDe.split("\n");
  const i = zeilen.findIndex((z) => /^\s*\/\/ "label": "kit:night",?$/.test(z));
  assert.ok(i > 0, "night.chain.label fehlt");
  assert.equal(zeilen[i - 1].trim(), `// ${zeile(de, "night.chain.label").slice("- `night.chain.label` — ".length)}`);
  assert.ok(zeilen.includes(`  // ${TABELLE.night.gruppe.de}`), "der gruppe-Satz von night fehlt");
});

test("--check meldet eine veränderte Beispieldatei", () => {
  const { check } = erzeugt(null, (dir) => {
    const pfad = join(dir, "templates", "workflow.config.example.en.jsonc");
    writeFileSync(pfad, readFileSync(pfad, "utf-8") + "// angehängt\n");
    return spawnSync(process.execPath, [TOOL, "--check"], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
  });
  assert.equal(check.status, 1);
  assert.match(check.stderr, /workflow\.config\.example\.en\.jsonc/);
});
