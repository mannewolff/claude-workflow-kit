// Das Budget der Wiederholschleife per Umgebungsvariable (Issue #842).
//
// Seit Issue #834 wiederholt der Toolbox-Adapter bei 5xx, bis das Gesamtbudget
// erschoepft ist. Die Unit-Tests dazu stellen Uhr und Schlaf (board-wiederholung),
// aber jeder Test, der board.mjs als eigenen Prozess gegen einen dauerhaft mit 5xx
// antwortenden Server startet, wartet real — mit KIT_AGENT_MODEL aus der Fixture
// zwei volle Minuten je Aufruf. KIT_TOOLBOX_BUDGET_MS kuerzt das Budget; die Fixture
// setzt die Variable fuer alle ihre Aufrufe.
//
// Die Regel selbst (30 s interaktiv, 120 s nachts) bleibt in board-wiederholung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { toolboxBudgetMs } from "../kit/board.mjs";
import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

test("KIT_TOOLBOX_BUDGET_MS schlaegt beide Regelwerte", () => {
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "200" }), 200);
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: " 200 " }), 200);
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "200", KIT_AGENT_MODEL: "claude-opus-5" }), 200);
});

test("Ein unbrauchbarer Wert faellt auf die Regel zurueck", () => {
  for (const wert of ["", "   ", "0", "-5", "abc", "1.5"]) {
    assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: wert }), 30_000, wert);
    assert.equal(
      toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: wert, KIT_AGENT_MODEL: "claude-opus-5" }),
      120_000,
      wert
    );
  }
});

test("Ohne die Variable gilt die Regel unveraendert", () => {
  assert.equal(toolboxBudgetMs({}), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" }), 120_000);
});

test("Ein Fixture-Aufruf gegen einen 5xx-Server endet in Sekunden, nicht in Minuten", async () => {
  const { server, host } = await starteServer(() => ({ status: 503, json: { message: "kaputt" } }));
  const dir = setupProjekt(
    { codeHost: "local", issueTracker: "toolbox", toolbox: { host } },
    "board-budget-"
  );
  try {
    const start = Date.now();
    const res = await runBoardAsync(dir, ["issue", "list"], { TBX_TOKEN: "test-token" });
    const dauer = Date.now() - start;
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Toolbox-API-Fehler: HTTP 503/);
    assert.ok(dauer < 5_000, `Aufruf brauchte ${dauer} ms — die Fixture setzt KIT_TOOLBOX_BUDGET_MS nicht`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});
