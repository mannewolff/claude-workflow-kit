// Die Sperre der Nacht-Kette gegen ungepruefte Fachplaene (Fachplan #702, Plan #716; Issue #718).
//
// `--kette` nimmt eine fachliche Anforderung nur auf, wenn sie neben dem Kettenlabel
// auch `review:fertig` traegt. Die Sperre sitzt in `kettenAusschluss` hinter
// `kit:klaeren` und wirkt dadurch in Lauf und Vorschau gleichermassen: Beide gehen
// durch dieselbe `waehleKettenKandidaten`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  waehleKettenKandidaten, pruefungFehltGrund, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL,
} from "../kit/night.mjs";
import { NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, stand } from "./helpers/kette-fixture.mjs";

test("[night-19] ohne review:fertig geht der Fachplan mit Grund und naechstem Schritt in uebersprungen", () => {
  const karten = [
    { id: "1", title: "[Fachlich] Geprueft", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL] },
    { id: "2", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:night"] },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.deepEqual(r.kandidaten.map((k) => k.id), ["1"], "die gepruefte Karte laeuft, die ungepruefte nicht");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["2"]);
  const grund = r.uebersprungen[0].grund;
  assert.ok(grund.startsWith(UNGEPRUEFT_PRAEFIX), `der Grund beginnt nicht mit dem festen Praefix: ${grund}`);
  assert.match(grund, /\/issue-review #2 pruefen lassen/);
  assert.match(grund, /das setzt review:fertig/);
  assert.match(grund, /das Label kit:night bleibt dran/);
});

test("[night-19] der Grundtext trennt festes Praefix und Schritt-Teil", () => {
  const g = pruefungFehltGrund("0007", "kit:eigenes");
  assert.equal(g.praefix, UNGEPRUEFT_PRAEFIX);
  assert.equal(g.praefix, "ungeprueft: Label 'review:fertig' fehlt");
  assert.match(g.schritt, /^mit \/issue-review #0007 pruefen lassen/);
  assert.ok(!g.schritt.includes(g.praefix), "der Schritt-Teil wiederholt das Praefix nicht");
  assert.ok(g.text.startsWith(g.praefix) && g.text.includes(g.schritt), "der Text setzt beide Teile zusammen");
});

test("[night-19] kit:klaeren gewinnt ueber die fehlende Pruefung — der spezifischere Grund bleibt", () => {
  const karten = [{ id: "3", title: "[Fachlich] Offene Frage", status: "backlog", labels: ["kit:night", "kit:klaeren"] }];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.equal(r.kandidaten.length, 0);
  assert.match(r.uebersprungen[0].grund, /^traegt kit:klaeren/);
  assert.ok(!r.uebersprungen[0].grund.startsWith(UNGEPRUEFT_PRAEFIX), "die Pruefsperre hat den Klaeren-Grund verdraengt");
});

test("[night-19] der Grundtext nennt das Kettenlabel aus der Config, nicht kit:night fest", () => {
  const karten = [{ id: "4", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:eigenes"] }];
  const r = waehleKettenKandidaten(karten, "kit:eigenes", 5);
  const grund = r.uebersprungen[0].grund;
  assert.match(grund, /das Label kit:eigenes bleibt dran/);
  assert.ok(!grund.includes("kit:night"), `der feste Name kit:night steht im Grundtext: ${grund}`);
});

test("[night-19] der Dry-Run zeigt die Ablehnung mit Grund und naechstem Schritt vorab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geprueft = fachplan(dir, "[Fachlich] Geprueft");
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette", "--dry-run"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${geprueft} \\[Fachlich\\] Geprueft -> Kette 1`));
    assert.match(res.stdout, new RegExp(`#${roh} .*-> uebersprungen \\(ungeprueft: Label 'review:fertig' fehlt`));
    assert.match(res.stdout, new RegExp(`/issue-review #${roh} pruefen lassen`));
    assert.match(res.stdout, /das Label kit:night bleibt dran/);
    assert.match(res.stdout, /Dry-Run beendet: 1 Kette\(n\) wuerden laufen/);
  });
});

test("[night-19] im Lauf behaelt die ungepruefte Karte ihr Kettenlabel und steht mit Grund im Ergebnisstand", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Keine Kette zu fahren/);
    const karte = board(dir, "issue", "get", roh);
    assert.ok(karte.labels.includes("kit:night"), "das Kettenlabel ist verbraucht, obwohl keine Kette lief");
    assert.ok(!karte.labels.includes(REVIEW_FERTIG_LABEL), "die Karte war ungeprueft");
    const einheit = stand(dir).einheiten.find((e) => e.id === roh);
    assert.equal(einheit.ausgang, "uebersprungen");
    assert.ok(einheit.grund.startsWith(UNGEPRUEFT_PRAEFIX), `der Ergebnisstand nennt den Grund nicht: ${einheit.grund}`);
  });
});
