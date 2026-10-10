// Die Prüfrollen als Dateien unter kit/rollen/ und der Leser-Agent kit-pruefer (Issue #1376,
// Plan #1375, A1, A2, E3, E4, E10).
//
// Jede Rolle steht an genau einem Ort, als Datei je Rolle mit vollständigem eigenem Rahmen.
// Der gemeinsame Fundblock samt Satz zur Form des Stands steht darum in jeder Dokument-Rolle
// wörtlich (E4) — dieser Test hält ihn über alle Rollen gleich. Was ohne fachliche Quelle
// oder Vorlage entfällt, steht in Blöcken, an denen ein Werkzeug es erkennt (E3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLLEN_KATALOG } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rollenDir = join(repoRoot, "kit", "rollen");
const dokumentRollen = Object.values(ROLLEN_KATALOG).flat();
const alleRollen = [...dokumentRollen, "code-review"];

function rolle(name) {
  return readFileSync(join(rollenDir, `${name}.md`), "utf8");
}

// Von der Gegenprobe-Zeile bis zum Satz für den leeren Befund: der Teil des Fundblocks, der
// in jeder Dokument-Rolle gleich lautet. Die Zeile davor (Fundstelle) ist rollenspezifisch.
function gemeinsamerBlock(text) {
  const start = text.indexOf("- Gegenprobe:");
  const endeSatz = "Wenn du nichts findest, schreibe das ausdrücklich hin.";
  const ende = text.indexOf(endeSatz);
  if (start < 0 || ende < 0) return null;
  return text.slice(start, ende + endeSatz.length);
}

function ohneBloecke(text, name) {
  return text.replaceAll(new RegExp(`\\{\\{#${name}\\}\\}[\\s\\S]*?\\{\\{/${name}\\}\\}`, "g"), "");
}

test("jede Rolle aus ROLLEN_KATALOG und code-review hat eine Datei unter kit/rollen/", () => {
  for (const name of alleRollen) {
    assert.ok(existsSync(join(rollenDir, `${name}.md`)), `kit/rollen/${name}.md fehlt`);
  }
});

test("der gemeinsame Fundblock samt Form des Stands ist in allen Dokument-Rollen wörtlich gleich (E4)", () => {
  const bloecke = dokumentRollen.map((name) => [name, gemeinsamerBlock(rolle(name))]);
  for (const [name, block] of bloecke) {
    assert.ok(block, `${name}: gemeinsamer Fundblock fehlt`);
    assert.match(block, /— geprueft, bestaetigt/, `${name}: Satz zur Form des Stands fehlt`);
    assert.match(block, /\{\{ARTEN\}\}/, `${name}: {{ARTEN}} fehlt im Fundblock`);
  }
  const [erster, vorlage] = bloecke[0];
  for (const [name, block] of bloecke.slice(1)) {
    assert.equal(block, vorlage, `${name} weicht im gemeinsamen Fundblock von ${erster} ab`);
  }
});

test("{{QUELLE_BODY}} steht nur im QUELLE-Block, {{VORLAGE_PFAD}} nur im VORLAGE-Block (E3)", () => {
  for (const name of alleRollen) {
    const text = rolle(name);
    for (const marke of ["QUELLE", "VORLAGE"]) {
      const auf = text.split(`{{#${marke}}}`).length - 1;
      const zu = text.split(`{{/${marke}}}`).length - 1;
      assert.equal(auf, zu, `${name}: Blockmarken ${marke} unausgeglichen`);
    }
    assert.doesNotMatch(ohneBloecke(text, "QUELLE"), /\{\{QUELLE_BODY\}\}/, `${name}: {{QUELLE_BODY}} außerhalb des QUELLE-Blocks`);
    assert.doesNotMatch(ohneBloecke(text, "VORLAGE"), /\{\{VORLAGE_PFAD\}\}/, `${name}: {{VORLAGE_PFAD}} außerhalb des VORLAGE-Blocks`);
  }
  const architektur = rolle("architektur-bestand");
  assert.match(architektur, /\{\{#QUELLE\}\}--- FACHLICHE QUELLE ---\n\{\{QUELLE_BODY\}\}\{\{\/QUELLE\}\}/);
  assert.match(architektur, /\{\{#VORLAGE\}\}[^\n]*\{\{VORLAGE_PFAD\}\}[^\n]*\{\{\/VORLAGE\}\}/);
});

test("architektur-bestand stellt die Frage zur fachlichen Quelle als letzte Frage im QUELLE-Block", () => {
  const text = rolle("architektur-bestand");
  const nummern = [...text.matchAll(/^(?:\{\{#QUELLE\}\})?(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(nummern, [1, 2, 3, 4, 5, 6]);
  assert.match(text, /^\{\{#QUELLE\}\}6\. Stellt der Plan her, was die fachliche Quelle verlangt/m);
});

test("schnitt-abhaengigkeiten trägt den Rahmen von architektur-bestand, fünf Fragen und nennt keine andere Rolle", () => {
  const text = rolle("schnitt-abhaengigkeiten");
  for (const andere of alleRollen.filter((r) => r !== "schnitt-abhaengigkeiten")) {
    assert.ok(!text.includes(andere), `schnitt-abhaengigkeiten nennt die Rolle ${andere}`);
  }
  const einleitung = rolle("architektur-bestand").split("\n")[0];
  assert.equal(text.split("\n")[0], einleitung);
  assert.match(text, /--- PLAN ---\n\{\{ISSUE_BODY\}\}/);
  assert.match(text, /\{\{#QUELLE\}\}--- FACHLICHE QUELLE ---\n\{\{QUELLE_BODY\}\}\{\{\/QUELLE\}\}/);
  const nummern = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(nummern, [1, 2, 3, 4, 5]);
  assert.match(text, /^5\. Was kann RAUS\?/m);
});

test("code-review trägt den Prompt aus /review mit {{REVIEW_MATERIAL}} und {{ARTEN}}", () => {
  const text = rolle("code-review");
  assert.match(text, /^Du bist Code-Reviewer\./);
  assert.match(text, /\{\{ARTEN\}\}/);
  assert.match(text, /--- REVIEW-MATERIAL ---\n\{\{REVIEW_MATERIAL\}\}/);
});

test("agents/kit-pruefer.md darf nur lesen und trägt kein Modell (A2, E10)", () => {
  const text = readFileSync(join(repoRoot, "agents", "kit-pruefer.md"), "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "Frontmatter fehlt");
  const zeilen = frontmatter[1].split("\n");
  assert.ok(zeilen.includes("name: kit-pruefer"));
  assert.ok(zeilen.some((z) => z.startsWith("description: ")));
  assert.deepEqual(zeilen.filter((z) => z.startsWith("tools:")), ["tools: Read, Grep, Glob"]);
  assert.equal(zeilen.filter((z) => z.startsWith("model:")).length, 0);
});
