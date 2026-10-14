// Pruefsatz zu Vertraegen in der Rolle architektur-bestand (Issue #1617, Plan #1611 E10):
// Mit `vertragsRepos` setzt `montiere` die Namen der Partnerrepos ein, ohne das Feld entfaellt
// der Block samt Marken. Die Rollendateien liest der Test echt, die englische ueber `lies`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { issueReviewPruefauftrag } from "../kit/board/issue-review.mjs";

const WURZEL = join(import.meta.dirname, "..");
const EN_ROLLE = readFileSync(join(WURZEL, "en", "kit", "rollen", "architektur-bestand.md"), "utf-8");
const SATZ_DE = "Legt der Plan etwas fest, das kanban-kit liest oder schreibt, ohne es unter `### Verträge` zu nennen? Dann ist das ein Fund.";
const SATZ_EN = "Does the plan fix something that kanban-kit reads or writes without naming it under `### Contracts`? Then that is a finding.";

const board = { async getIssue(id) { return { id: String(id), title: "[Plan] Karte", body: "## Ziel\nDer Plan.\n" }; } };

async function montiere(config, englisch = false) {
  const verz = mkdtempSync(join(tmpdir(), "vertraege-rolle-"));
  const datei = join(verz, "auftrag.md");
  const lies = (pfad) => {
    if (englisch && pfad.endsWith("architektur-bestand.md")) return EN_ROLLE;
    return existsSync(pfad) ? readFileSync(pfad, "utf-8") : null;
  };
  try {
    const antwort = await issueReviewPruefauftrag({ role: "architektur-bestand", id: "10", file: datei }, { config, board, lies });
    assert.equal(antwort.ok, true, JSON.stringify(antwort));
    return readFileSync(datei, "utf-8");
  } finally {
    rmSync(verz, { recursive: true, force: true });
  }
}

for (const [sprache, englisch, satz] of [["deutsch", false, SATZ_DE], ["englisch", true, SATZ_EN]]) {
  test(`architektur-bestand (${sprache}) traegt mit vertragsRepos den Pruefsatz mit dem Repo-Namen`, async () => {
    const text = await montiere({ vertragsRepos: [{ name: "kanban-kit" }] }, englisch);
    assert.ok(text.includes(satz), text);
    assert.doesNotMatch(text, /\{\{[#/]?VERTR/);
  });

  test(`architektur-bestand (${sprache}) ohne vertragsRepos laesst den Block samt Marken weg`, async () => {
    const text = await montiere({}, englisch);
    assert.ok(!text.includes(satz.slice(0, 20)));
    assert.doesNotMatch(text, /VERTRAEGE|VERTRAGSREPOS/);
  });
}
