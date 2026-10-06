// Ablauf-Pruefung: Ein gesperrter Uebergang wirkt erst in der Stufenfolge der Kette im Einstieg, mit Board-Labels und Laufstand an der Karte; die Lesart der Schalter prueft test/night-session-uebergaenge.test.mjs.
//
// Das Projekt gibt die Uebergaenge der Kette einzeln frei (Plan #1079, E1, E12; Issue #1087).
//
// `night.kette.uebergaenge` traegt vier Schalter: `planReview`, `reviewPakete` und
// `paketeAbdeckung` (Vorgabe `true`) sowie `abdeckungUmsetzung` (ohne Vorgabe: Fehlt er,
// gilt das Verhalten von vor #1087 — Variante A endet `fertig`, Variante B setzt um;
// Issue #1105). Ein
// gesperrter Uebergang endet mit `lauf:wartet` und dem Wortlaut aus E1, die Kette mit dem
// Ausgang `unvollstaendig`. Gesperrt wird nur das AUTOMATISCHE Folgen: Ein neues
// `kit:night` setzt bei der ersten Stufe ohne Ergebnis an und laeuft dort los (#1086).
// `abdeckungUmsetzung` wirkt nur zusammen mit `kit:durchziehen` — das GO bleibt an der Karte.
//
// Wie in den uebrigen Ketten-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo mit
// lokalem Tracker; die Sessions sind Shell-Fakes ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  run, board, mitProjekt, fachplan, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-ablauf.mjs";
import { fachplanB } from "./helpers/kette-umsetzung-fixture.mjs";

const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };
const MIT_UMSETZUNG = { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG };

const kartenText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const labels = (dir, id) => board(dir, "issue", "get", id).labels ?? [];

function einheitVon(dir, id) {
  const einheiten = stand(dir).einheiten.filter((e) => e.id === id);
  assert.ok(einheiten.length > 0, `keine Einheit fuer #${id}`);
  return einheiten.at(-1);
}

function wartetMit(dir, F, text) {
  assert.ok(labels(dir, F).includes("lauf:wartet"), `Labels: ${labels(dir, F)}`);
  assert.ok(kartenText(dir, F).includes(text), `Laufstand ohne '${text}':\n${kartenText(dir, F)}`);
}

test("[night-uebergaenge] planReview: false — nach der Planstufe wartet die Karte, ein neues kit:night setzt bei review an", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "unvollstaendig", einheit.grund);
    wartetMit(dir, F, "wartet: Übergang planReview im Projekt nicht freigegeben — weiter mit kit:night");

    board(dir, "issue", "label", "add", F, "kit:night");
    const zweiter = run(dir, ["--kette"], env);
    assert.equal(zweiter.status, 0, `${zweiter.stdout}\n${zweiter.stderr}`);
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    assert.equal(einheitVon(dir, F).ausgang, "fertig");
    assert.ok(!labels(dir, F).includes("lauf:wartet"), `Labels: ${labels(dir, F)}`);
  }, { uebergaenge: { planReview: false } });
});

test("[night-uebergaenge] ohne Feld, Variante A: die drei ersten Uebergaenge folgen, die Kette endet fertig wie vor #1087", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: MIT_UMSETZUNG });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    assert.equal(einheitVon(dir, F).ausgang, "fertig");
    assert.ok(!labels(dir, F).some((l) => l.startsWith("lauf:")), `Labels: ${labels(dir, F)}`);
  }, { uebergaenge: undefined });
});

// Issue #1105: Vor #1087 setzte eine Kette mit kit:durchziehen nach der Abdeckung um. Ohne
// Eintrag im Projekt gilt das weiter — erst ein ausdrueckliches `false` haelt sie an.
test("[night-uebergaenge] ohne Feld, Variante B: nach der Abdeckung folgt die Umsetzung, kein lauf:wartet", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    board(dir, "issue", "label", "add", F, "kit:durchziehen");
    const env = umgebung(dir, { stufen: MIT_UMSETZUNG });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const stufen = sessions(env.logPfad).map((s) => s.stufe);
    assert.deepEqual(stufen.slice(0, 4), ["plan", "review", "pakete", "abdeckung"]);
    assert.ok(stufen.length > 4 && stufen.slice(4).every((s) => s === "umsetzung"), `Stufen: ${stufen}`);
    const einheit = einheitVon(dir, F);
    assert.notEqual(einheit.stufen.umsetzung, undefined, "die Stufe umsetzung lief");
    assert.ok(!labels(dir, F).includes("lauf:wartet"), `Labels: ${labels(dir, F)}`);
    assert.ok(!kartenText(dir, F).includes("wartet: Übergang abdeckungUmsetzung"), kartenText(dir, F));
  }, { uebergaenge: undefined });
});

test("[night-uebergaenge] abdeckungUmsetzung: true ohne kit:durchziehen — die Karte wartet auf ihre Freigabe, keine Umsetzung", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: MIT_UMSETZUNG });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    assert.equal(einheitVon(dir, F).ausgang, "unvollstaendig");
    wartetMit(dir, F, "wartet: Karte ohne Freigabe zur Umsetzung");
    assert.equal(board(dir, "issue", "list", "--status", "ready").length, 0, "kein Paket in Ready");
  }, { uebergaenge: { abdeckungUmsetzung: true } });
});

test("[night-uebergaenge] abdeckungUmsetzung: false mit kit:durchziehen — wartet mit dem Uebergangs-Text, keine Umsetzung", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: MIT_UMSETZUNG });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    const einheit = einheitVon(dir, F);
    assert.equal(einheit.ausgang, "unvollstaendig");
    assert.equal(einheit.stufen.umsetzung, undefined, "die Stufe umsetzung lief nicht");
    wartetMit(dir, F, "wartet: Übergang abdeckungUmsetzung im Projekt nicht freigegeben — weiter mit kit:night");
    assert.equal(board(dir, "issue", "list", "--status", "ready").length, 0, "kein Paket in Ready");
  }, { uebergaenge: { abdeckungUmsetzung: false } });
});
