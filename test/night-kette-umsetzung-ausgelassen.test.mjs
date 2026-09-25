// Eine Kette, die ihre bestellte Umsetzung nicht ausfuehren konnte (Issue #862).
//
// Unter Variante B laesst die Stufe umsetzung ihre Arbeit aus, wenn der Umsetzungs-Lock
// belegt ist oder die Hauptkopie vor dem ersten Paket unsauber ist. Beides ist richtig —
// zwei Umsetzungen in einem Checkout gehen nicht, und einen fremden Arbeitsstand raeumt
// nur ein Mensch auf. Falsch war nur, was der Mensch danach sah: Die Kette endete auf
// `fertig` und stand am Morgen als gelungen am Brett, obwohl die Pakete unangetastet in
// Backlog lagen und die Bestellung nicht ausgefuehrt war.
//
// Seit Issue #862 traegt dieser Fall den eigenen Ausgang `unvollstaendig`, und der
// Nachtbericht nennt die drei Dinge, die der Mensch braucht: dass die Umsetzung
// ausgelassen wurde, was sie verhindert hat und wo die Pakete jetzt liegen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { UMSETZUNG_LOCK, UMSETZUNG_AUSGELASSEN_PRAEFIX } from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";
import { ERZEUGEN, fachplanB, umsetzung, stehenInBacklog, keinRestInArbeit } from "./helpers/kette-umsetzung-fixture.mjs";

/**
 * Belegt den Umsetzungs-Lock der Hauptkopie mit der Id dieses Testprozesses.
 *
 * Die eigene Id ist die einzige, von der der Test sicher weiss, dass sie lebt — und nur
 * ein lebender Prozess laesst `umsetzungLockNehmen` auf `art: "belegt"` gehen. Eine
 * erfundene Nummer waere fuer den Runner ein verwaister Lock, den er aufraeumt.
 */
function lockBelegen(dir) {
  const pfad = join(dir, UMSETZUNG_LOCK);
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, `${process.pid}\n`, "utf-8");
  return process.pid;
}

const fachplanText = (dir, F) => readFileSync(join(dir, "issues", `${F}.md`), "utf-8");

test("[night-862] ein belegter Lock laesst die Kette unvollstaendig enden, nicht fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const pid = lockBelegen(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "unvollstaendig", `die Kette gilt weiter als gelungen: ${einheit.grund}`);
    assert.ok(einheit.grund.startsWith(UMSETZUNG_AUSGELASSEN_PRAEFIX),
      `der Grund nennt die ausgelassene Umsetzung nicht: ${einheit.grund}`);
    assert.match(einheit.grund, new RegExp(`Prozess ${pid}`), "der Grund nennt die haltende Sperre nicht");

    // Die Stufe fuehrt die Auslassung als eigenen Befund — der Bericht liest sie von dort.
    assert.match(stufe.ausgelassen, new RegExp(`Prozess ${pid}`));
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), einheit.stufen.pakete.ids);
    assert.deepEqual(stufe.umgesetzt, []);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0,
      "es lief eine Umsetzungs-Session, obwohl der Lock belegt war");

    stehenInBacklog(dir, einheit.stufen.pakete.ids);
    keinRestInArbeit(dir);
    assert.match(res.stdout, /Nacht-Kette beendet: 0 fertig, 1 unvollstaendig/);
  });
});

test("[night-862] der Nachtbericht nennt Auslassung, Sperre und den Stand der Pakete", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const pid = lockBelegen(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const text = fachplanText(dir, F);
    // Der Ausgang steht ganz oben: Wer nur die ersten Zeilen liest, sieht schon hier,
    // dass die Bestellung nicht ausgefuehrt wurde.
    assert.match(text, new RegExp(`### Ausgang\\n\\nunvollstaendig — ${UMSETZUNG_AUSGELASSEN_PRAEFIX}`));
    const abschnitt = text.split("### Umsetzung")[1] ?? "";
    assert.match(abschnitt, /- ausgelassen: /, "der Abschnitt Umsetzung nennt die Auslassung nicht");
    assert.match(abschnitt, new RegExp(`Prozess ${pid}`), "der Abschnitt Umsetzung nennt die Sperre nicht");
    assert.match(abschnitt, /die Pakete bleiben in Backlog/, "der Bericht sagt nicht, wo die Pakete liegen");
  });
});

test("[night-862] eine unsaubere Hauptkopie endet ebenso unvollstaendig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const schmutz = `echo rest > ${JSON.stringify(dir)}/rest.md`;
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, abdeckung: schmutz, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "unvollstaendig", einheit.grund);
    assert.match(einheit.grund, /nicht sauber/);
    assert.match(einheit.grund, /rest\.md/);
    assert.match(stufe.ausgelassen, /nicht sauber/);
    assert.match(fachplanText(dir, F), /- ausgelassen: .*rest\.md.* — die Pakete bleiben in Backlog\./);
    stehenInBacklog(dir, einheit.stufen.pakete.ids);
  });
});

test("[night-862] eine gelungene Umsetzung bleibt fertig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(stufe.ausgelassen, undefined, "eine gelaufene Stufe traegt keine Auslassung");
    assert.equal(fachplanText(dir, F).includes("- ausgelassen:"), false);
    assert.match(res.stdout, /Nacht-Kette beendet: 1 fertig, 0 unvollstaendig/);
  });
});

test("[night-862] eine Kette ohne bestellte Umsetzung bleibt vom belegten Lock unberuehrt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Variante A: kein kit:durchziehen, also gar keine Stufe umsetzung — der Lock einer
    // fremden Umsetzung darf eine reine Planungskette nicht faerben.
    const F = fachplan(dir);
    lockBelegen(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.umsetzung, undefined, "die Stufe umsetzung lief unter Variante A");
    assert.equal(fachplanText(dir, F).includes("### Umsetzung"), false);
    assert.equal(board(dir, "issue", "get", F).status, "backlog");
  });
});
