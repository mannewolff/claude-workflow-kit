// Ablauf-Pruefung: Dass board.mjs die Achsen nightrun und sitzung an den Teil weiterreicht, die Antwort als eine Zeile JSON ausgibt, einen Abbruch mit Exit 1 meldet und den Hook-Rumpf von stdin liest, belegt nur ein gestartetes kit/board.mjs gegen einen echten HTTP-Endpunkt.
//
// Die Melder ueber die Kommandozeile (Issue #669, #734, umgestellt mit Issue #1222). Deutung,
// Aufteilung, Drosselung und jeder Schweige-Grund stehen im selben Prozess in
// `test/board-melder-*.test.mjs`; hier bleibt, was einen Prozess braucht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const STAND = {
  schemaFassung: 1, start: "2026-09-16T10:00:00.000Z", art: "implementierung", abschluss: "regulaer", complete: true,
  einheiten: [{ id: "7", titel: "T", ausgang: "erfolg", pruefung: { zustand: "geprueft" } }],
};

const PROTOKOLL = JSON.stringify({
  type: "assistant",
  timestamp: "2026-09-18T08:00:00.000Z",
  message: { id: "a", model: "claude-sonnet-5", usage: { input_tokens: 0, output_tokens: 100 } },
}) + "\n";

async function mitServer(fn) {
  const { server, requests, host } = await starteServer((req) =>
    req.url === "/api/kanban/night-runs" && req.method === "POST" ? { status: 200, json: { outcome: "REPLACED" } } : null);
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-melder-cli-");
  try {
    await fn({ dir, requests });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

test("[night-31] nightrun melden schickt die Meldung mit Token an /api/kanban/night-runs", async () => {
  await mitServer(async ({ dir, requests }) => {
    const datei = join(dir, "stand.json");
    writeFileSync(datei, JSON.stringify(STAND));
    const res = await runBoardAsync(dir, ["nightrun", "melden", "--datei", datei], { TBX_TOKEN: "test-token" });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, outcome: "REPLACED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-kanban-token"], "test-token");
    assert.equal(requests[0].headers["content-type"], "application/json");
    assert.equal(JSON.parse(requests[0].body).kind, "NIGHT");
  });
});

test("[night-31] nightrun melden bricht mit Exit 1 und Grund ab", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-melder-cli-");
  try {
    const res = await runBoardAsync(dir, ["nightrun", "melden", "--datei", join(dir, "x.json")], {});
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Fehler: Einlieferung nur mit issueTracker toolbox/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[board-11] sitzung melden liest den Pfad aus dem Hook-Rumpf auf stdin und meldet mit Token", async () => {
  await mitServer(async ({ dir, requests }) => {
    const pfad = join(dir, "protokoll.jsonl");
    writeFileSync(pfad, PROTOKOLL, "utf-8");
    const res = await runBoardAsync(dir, ["sitzung", "melden", "--complete"], { TBX_TOKEN: "test-token", KIT_AGENT_MODEL: "" }, JSON.stringify({ transcript_path: pfad }));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, gemeldet: true, complete: true, karten: 0, outcome: "REPLACED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-kanban-token"], "test-token");
    assert.equal(JSON.parse(requests[0].body).kind, "INTERACTIVE");
  });
});

test("unbekannte Befehle der beiden Achsen zeigen die Hilfe und brechen ab", async () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-melder-cli-");
  try {
    for (const achse of ["nightrun", "sitzung"]) {
      const res = await runBoardAsync(dir, [achse, "gibtsnicht"], {});
      assert.equal(res.status, 1, achse);
      assert.match(res.stdout, /node board\.mjs nightrun melden/, `${achse}: die Hilfe fehlt`);
      assert.match(res.stderr, new RegExp(`Unbekannter ${achse}-Befehl: 'gibtsnicht'`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
