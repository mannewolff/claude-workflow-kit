// Ablauf-Pruefung: Die Weiche zwischen Variante A und B sitzt in der Stufenfolge der Kette im Einstieg; Stufen, Vorschau, Hilfe und Schlusszeile zeigt nur ein Lauf des echten Runners. varianteVon prueft test/night-session-variante.test.mjs.
//
// Variantenerkennung der Nacht-Kette: varianteVon und die Weiche in der Stufenfolge
// (Plan #691, E2/E3/E12; Issue #694).
//
// varianteVon ist rein und pruefbar an Fixtures: kein Wurf, auch nicht ohne budget.
// Die Stufenfolge bleibt unter Variante A bei den vier bestehenden Stufen; das macht
// dieses Paket fuer sich pruefbar, bevor die Stufe `umsetzung` in #695 dazukommt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  NIGHT, run, board, mitProjekt, fachplan, umgebung, sessions,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-fixture.mjs";

test("[night-33] die Stufenfolge: Variante A endet nach abdeckung, unveraendert", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    assert.equal(board(dir, "issue", "get", F).labels.includes("kit:night"), false, "das Kettenlabel bleibt beim Start verbraucht");
  });
});

test("[night-33] eine Karte mit dem Variante-B-Label fuehrt die Stufe umsetzung, das Label bleibt stehen", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    durchziehen(dir, F);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    // Was die Stufe umsetzung im Einzelnen tut, prueft night-kette-umsetzung.test.mjs;
    // hier steht nur die Weiche: Unter B kommt sie hinter abdeckung dazu.
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe),
      ["plan", "review", "pakete", "abdeckung", "umsetzung", "umsetzung"]);
    const fach = board(dir, "issue", "get", F);
    assert.equal(fach.labels.includes("kit:night"), false, "das Kettenlabel ist beim Start verbraucht");
    assert.ok(fach.labels.includes("kit:durchziehen"), "das Variante-B-Label wird nicht verbraucht");
  });
});

test("[night-33] der Dry-Run nennt je Kandidat die Variante", () => {
  mitProjekt((dir) => {
    const a = fachplan(dir, "[Fachlich] Variante A");
    const b = fachplan(dir, "[Fachlich] Variante B");
    durchziehen(dir, b);
    const res = run(dir, ["--kette", "--dry-run", "--max", "2"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${a} \\[Fachlich\\] Variante A -> Kette 1 \\(Variante A\\)`));
    assert.match(res.stdout, new RegExp(`#${b} \\[Fachlich\\] Variante B -> Kette 2 \\(Variante B\\)`));
    assert.ok(board(dir, "issue", "get", b).labels.includes("kit:durchziehen"), "der Dry-Run veraendert kein Label");
  });
});

test("[night-33] --help nennt kit:durchziehen und beide Varianten", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /kit:durchziehen/);
  assert.match(res.stdout, /Variante A/);
  assert.match(res.stdout, /Variante B/);
});

test("[night-33] die Schlusszeile Morgen-Ritual nennt beide Varianten und das Label aus night.kette.varianteBLabel", () => {
  mitProjekt((dir) => {
    fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const zeile = res.stdout.split("\n").find((z) => z.includes("Morgen-Ritual:"));
    assert.ok(zeile, "keine Morgen-Ritual-Zeile im Protokoll");
    assert.match(zeile, /Variante A/);
    assert.match(zeile, /Variante B/);
    assert.match(zeile, /kit:durchziehen/);
  });
});
