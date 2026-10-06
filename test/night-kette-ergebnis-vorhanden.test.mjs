// Jede Kettenstufe erkennt ihr vorhandenes Ergebnis (Plan #1079, E2, E9, E10, E11; Issue #1086).
//
// Vor jeder Stufe und nach jedem Abbruch prueft die Kette am Board, ob das Ergebnis der
// Stufe schon vorliegt, statt vorher und nachher zu vergleichen. Ist es da, endet die
// Stufe `fertig` mit `vorgefunden: true`, und es startet keine Session. `kit:night` an
// der Karte ist damit die Geste fuer den Wiedereinstieg: Die Kette beginnt bei der ersten
// Stufe ohne Ergebnis.
//
// Wie in den uebrigen Ketten-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo mit
// lokalem Tracker; die Sessions sind Shell-Fakes ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paketUmgesetzt } from "../kit/night/kette.mjs";
import {
  run, board, mitProjekt, fachplan, planauftrag, planBody, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";
import { fachplanB } from "./helpers/kette-umsetzung-fixture.mjs";

const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };
const MARKER = "Plan-Review: opus (2026-09-28, Nachtlauf)";

/** Ein Plan zum Fachplan F, wie ihn ein frueherer Lauf hinterliess — ohne Kettenlabel. */
function planVorhanden(dir, F, { marker = false, status = "backlog" } = {}) {
  const body = marker ? planBody().replace("Plan-Modell: fixture-modell", `Plan-Modell: fixture-modell\n${MARKER}`) : planBody();
  const P = planauftrag(dir, F, { label: null, geprueft: false, body });
  if (status !== "backlog") board(dir, "issue", "move", P, status);
  return P;
}

/** Zwei Arbeitspakete zum Plan P, wie /issues sie anlegte. */
function paketeVorhanden(dir, F, P) {
  return [1, 2].map((n) => String(board(dir, "issue", "create", "--title", `Paket ${n}`, "--body",
    `## Kontext\n\nPlan: Issue #${P}\nFachliche Quelle: Issue #${F}\n\n## Aufgabe\n\nPaket ${n}.\n\n## Akzeptanzkriterium\n\n- node --test\n\n## Abhängigkeiten\n\nKeine.\n`).id));
}

/** Setzt den Laufstand einer Karte, wie ihn ein frueherer Lauf hinterliess. */
function laufstand(dir, karte, zustand, text) {
  mkdirSync(join(dir, "helfer"), { recursive: true });
  const datei = join(dir, "helfer", `laufstand-${karte}.md`);
  writeFileSync(datei, text);
  board(dir, "issue", "stand", karte, "--zustand", zustand, "--text-file", datei);
}

function einheitVon(dir, id) {
  const einheit = stand(dir).einheiten.find((e) => e.id === id);
  assert.ok(einheit, `keine Einheit fuer #${id}`);
  return einheit;
}

const kartenText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

test("[night-ergebnis] kit:night an einem Fachplan mit fertigem Plan startet bei review", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["review", "pakete", "abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.plan.id, P);
    assert.equal(einheit.stufen.plan.vorgefunden, true);
    assert.equal(board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title)).length, 1, "kein zweiter Plan");
    assert.equal("vorgefunden" in einheit.stufen.review, false, "die Stufe review lief selbst");
  });
});

test("[night-ergebnis] Plan mit Pruefvermerk: plan und review vorgefunden, keine Session dafuer", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.plan.vorgefunden, true);
    assert.equal(einheit.stufen.review.vorgefunden, true);
    assert.equal(einheit.stufen.review.marker, true);
    assert.equal(einheit.stufen.plan.id, P);
  });
});

test("[night-ergebnis] Laufstand 'pakete fertig fuer #M': pakete vorgefunden, nur die Abdeckung laeuft", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    const ids = paketeVorhanden(dir, F, P);
    laufstand(dir, F, "abgebrochen", `zuletzt begonnen: abdeckung begonnen für #${P} um 2026-09-28T03:00:00.000Z\nzuletzt abgeschlossen: pakete fertig für #${P} um 2026-09-28T02:50:00.000Z`);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.pakete.vorgefunden, true);
    assert.deepEqual(einheit.stufen.pakete.ids, ids);
    assert.equal(board(dir, "issue", "list").filter((i) => /^Paket /.test(i.title)).length, 2, "keine doppelten Pakete");
  });
});

test("[night-ergebnis] Laufstand 'abdeckung fertig fuer #M': die ganze Kette ist vorgefunden, keine Session", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    paketeVorhanden(dir, F, P);
    laufstand(dir, F, "fertig", `zuletzt begonnen: abdeckung begonnen für #${P} um 2026-09-28T03:00:00.000Z\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z`);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad), []);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    for (const s of ["plan", "review", "pakete", "abdeckung"]) assert.equal(einheit.stufen[s].vorgefunden, true, `Stufe ${s}`);
  });
});

test("[night-ergebnis] Variante B: Pakete in In review mit Nachweis sind vorgefunden, keine Umsetzungs-Session", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const P = planVorhanden(dir, F, { marker: true });
    const ids = paketeVorhanden(dir, F, P);
    for (const id of ids) board(dir, "issue", "move", id, "in_review");
    laufstand(dir, F, "abgebrochen", `zuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z`);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad), []);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.umsetzung.vorgefunden, true);
  });
});

test("[night-ergebnis] Umsetzung: In review ohne gueltigen Nachweis zaehlt nicht als vorgefunden", () => {
  const mangel = "Nachtlauf: Nachweis fehlt — die Session hat keine Pruefung gefahren. Die Karte bleibt in In review und der Commit unangetastet — bitte den Stand pruefen.";
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [] }), true);
  assert.equal(paketUmgesetzt({ status: "done", comments: [] }), true);
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: mangel }] }), false);
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: "Nachtlauf: Nachweis rot — npm test endete rot. Die Karte bleibt …" }] }), false);
  assert.equal(paketUmgesetzt({ status: "backlog", comments: [] }), false);
  assert.equal(paketUmgesetzt({ status: "ready", comments: [] }), false);
  assert.equal(paketUmgesetzt(null), false);
});

test("[night-ergebnis] Belegfall 2 (#868): Review am Zeitlimit, Marker im Plan — fertig und vorgefunden", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, review: `${REVIEW_MARKER}; sleep 60` } });
    const res = run(dir, ["--kette"], { ...env, NIGHT_TIMEOUT_MS: "6000", NIGHT_TIMEOUT_STUFE: "review" });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.review.vorgefunden, true);
    assert.equal(einheit.stufen.review.marker, true);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
  });
});

test("[night-ergebnis] ein vorgefundener Plan bekommt keinen Ueberholt-Kommentar, auch keiner in Done", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const alt = planVorhanden(dir, F, { status: "done" });
    const P = planVorhanden(dir, F, { marker: true });
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = einheitVon(dir, F);
    assert.equal(einheit.stufen.plan.id, P);
    assert.equal("ueberholt" in einheit, false);
    assert.doesNotMatch(kartenText(dir, P), /Ueberholt durch Plan/);
    assert.doesNotMatch(kartenText(dir, alt), /Ueberholt durch Plan/);
  });
});

test("[night-ergebnis] ein Plan in Done zaehlt nicht als vorgefunden: die Stufe plan laeuft", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const alt = planVorhanden(dir, F, { marker: true, status: "done" });
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.notEqual(einheit.stufen.plan.id, alt);
    assert.equal("vorgefunden" in einheit.stufen.plan, false);
  });
});

for (const status of ["ready", "in_review"]) {
  test(`[night-ergebnis] ein Plan in ${status} zaehlt als vorgefunden`, () => {
    mitProjekt((dir) => {
      const F = fachplan(dir);
      const P = planVorhanden(dir, F, { status });
      const env = umgebung(dir, { stufen: ERZEUGEN });
      const res = run(dir, ["--kette"], env);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

      assert.equal(sessions(env.logPfad)[0]?.stufe, "review");
      const einheit = einheitVon(dir, F);
      assert.equal(einheit.stufen.plan.id, P);
      assert.equal(einheit.stufen.plan.vorgefunden, true);
    });
  });
}

test("[night-ergebnis] Teilschnitt im Laufstand: abgebrochen mit den Paketen, kein Versuch", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    const [a, b] = paketeVorhanden(dir, F, P);
    laufstand(dir, F, "abgebrochen", `zuletzt begonnen: pakete begonnen für #${P} um 2026-09-28T02:40:00.000Z\nzuletzt abgeschlossen: review fertig für #${P} um 2026-09-28T02:30:00.000Z`);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad), [], "kein Versuch");
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.equal(einheit.grund, `Teilschnitt vorhanden (#${a}, #${b}) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night`);
    assert.equal(board(dir, "issue", "list").filter((i) => /^Paket /.test(i.title)).length, 2);
    const karte = board(dir, "issue", "get", F);
    assert.ok(karte.labels.includes("lauf:abgebrochen"), `Labels: ${karte.labels}`);
    assert.match(kartenText(dir, F), /Teilschnitt vorhanden/);
  });
});

test("[night-ergebnis] Teilschnitt im Journal eines frueheren Laufs: abgebrochen, kein Versuch", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    const [a, b] = paketeVorhanden(dir, F, P);
    mkdirSync(join(dir, ".claude", "lauf"), { recursive: true });
    const zeilen = [
      { art: "lauf", zeit: "2026-09-28T02:00:00.000Z", pid: 999999, text: "begonnen" },
      { art: "stand", nr: 1, zeit: "2026-09-28T02:40:00.000Z", karte: F, zustand: "laeuft", text: `zuletzt begonnen: pakete begonnen für #${P} um 2026-09-28T02:40:00.000Z`, status: "offen" },
      { art: "quittung", nr: 1, zeit: "2026-09-28T02:40:01.000Z" },
      { art: "lauf", zeit: "2026-09-28T02:45:00.000Z", pid: 999999, text: "abgebrochen, SIGTERM" },
    ];
    writeFileSync(join(dir, ".claude", "lauf", "2026-09-28-020000.jsonl"), zeilen.map((z) => JSON.stringify(z)).join("\n") + "\n");
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad), []);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, new RegExp(`Teilschnitt vorhanden \\(#${a}, #${b}\\)`));
  });
});

test("[night-ergebnis] Pakete ohne jeden Laufstand-Eintrag: die Stufe pakete laeuft wie bisher (Issue #895)", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const P = planVorhanden(dir, F, { marker: true });
    paketeVorhanden(dir, F, P);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal("vorgefunden" in einheit.stufen.pakete, false);
  });
});

test("[night-ergebnis] der Laufstand je Stufe steht an der Karte, die die Kette traegt", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const P = einheitVon(dir, F).stufen.plan.id;
    const karte = board(dir, "issue", "get", F);
    assert.ok(!karte.labels.some((l) => l.startsWith("lauf:")), `nach dem Ende haengt kein Laufstand-Label: ${karte.labels}`);
    const text = kartenText(dir, F);
    assert.equal(text.split("## Laufstand").length - 1, 1, "genau ein Laufstand-Kommentar");
    assert.match(text, new RegExp(`abdeckung fertig für #${P}\\b`));
    // Das Journal fuehrt den Verlauf: Beginn und Ende jeder Stufe.
    const ordner = join(dir, ".claude", "lauf");
    const journal = readdirSync(ordner).filter((n) => n.endsWith(".jsonl")).map((n) => readFileSync(join(ordner, n), "utf-8")).join("\n");
    for (const eintrag of [`plan begonnen für #${F}`, `plan fertig für #${F}`, `review fertig für #${P}`, `pakete begonnen für #${P}`, `pakete fertig für #${P}`]) {
      assert.ok(journal.includes(eintrag), `Journal ohne '${eintrag}'`);
    }
  });
});
