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
  KETTE_UNGEPRUEFT_ANKER,
} from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung, stand, boardFakeInstallieren,
} from "./helpers/kette-fixture.mjs";

/** Wie oft der Anker des Hinweis-Kommentars an der Karte steht. */
function ankerZaehlen(dir, id) {
  const body = String(board(dir, "issue", "get", id).body || "");
  return body.split(KETTE_UNGEPRUEFT_ANKER).length - 1;
}

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

// Der Lauf-Kopf vermerkt den Grund, statt ihn nur zu protokollieren (Issue #744), und
// seit Issue #885 benennt der Satz den Fall: Die Karte dieser Lage traegt das
// Kettenlabel, geht aber ungeprueft ueber `kettenAusschluss` nach `uebersprungen` —
// also der Fall `ketteAlleUebersprungen`, nicht das fehlende Label.
test("[night-44] eine Kette ohne Kandidaten vermerkt den Fall der uebersprungenen Karten als noWorkReason", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      stand(dir).noWorkReason,
      "Keine Kette zu fahren: alle 1 Fachplaene mit dem Label 'kit:night' wurden uebersprungen, "
      + "weil eine Voraussetzung fehlt.",
    );
  });
});

// --- Der Kommentar an der abgelehnten Anforderung und der Hinweis auf das
//     unbekannte Kennzeichen (Fachplan #702, Kriterien 4 und 8; Issue #719) ---

test("[night-42] die abgelehnte Anforderung bekommt einmal den Kommentar mit Anker, Grund und Schritt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(ankerZaehlen(dir, roh), 1, "der Hinweis-Kommentar steht nicht genau einmal an der Karte");
    const body = String(board(dir, "issue", "get", roh).body || "");
    assert.match(body, new RegExp(`/issue-review #${roh} pruefen lassen`));
    assert.match(body, /das setzt review:fertig/);
    assert.match(body, /das Label kit:night bleibt dran/);
    assert.match(res.stdout, new RegExp(`#${roh}: Hinweis-Kommentar`));
  });
});

test("[night-42] ein zweiter Lauf schreibt den Kommentar nicht noch einmal", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    assert.equal(run(dir, ["--kette"], umgebung(dir)).status, 0);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(ankerZaehlen(dir, roh), 1, "der Folgelauf hat einen zweiten Kommentar geschrieben");
    assert.match(res.stdout, /steht schon am Board/);
  });
});

test("[night-42] der Dry-Run zeigt die Ablehnung und schreibt keinen Kommentar", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette", "--dry-run"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${roh} .*-> uebersprungen \\(${UNGEPRUEFT_PRAEFIX}`));
    assert.equal(ankerZaehlen(dir, roh), 0, "der Dry-Run hat am Board geschrieben");
  });
});

test("[night-42] ein fehlgeschlagener Board-Aufruf wird protokolliert und bricht den Lauf nicht ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    boardFakeInstallieren(dir);
    const res = run(dir, ["--kette"], { ...umgebung(dir), BOARD_FAKE_ABLEHNEN: roh });
    assert.equal(res.status, 0, `der Lauf ist am Board-Fehler gescheitert: ${res.stderr}`);
    assert.match(res.stdout, new RegExp(`#${roh}: Hinweis-Kommentar nicht geschrieben`));
    assert.equal(ankerZaehlen(dir, roh), 0);
    assert.match(res.stdout, /Keine Kette zu fahren/);
  });
});

test("[night-42] traegt keine Karte review:fertig, meldet der Lauf das unbekannte Kennzeichen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /keine Karte am Board traegt 'review:fertig'/);
    assert.match(res.stdout, /noch nicht angelegt/);
    assert.match(res.stdout, /\/issue-review/);
  });
});

test("[night-42] der Hinweis erscheint auch in der Vorschau", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    const res = run(dir, ["--kette", "--dry-run"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /keine Karte am Board traegt 'review:fertig'/);
  });
});

test("[night-42] der Hinweis bleibt aus, sobald eine Karte der Liste das Label traegt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const roh = fachplan(dir, "[Fachlich] Ungeprueft", "kit:night", false);
    fachplan(dir, "[Fachlich] Anderswo geprueft", null, true);
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!/keine Karte am Board traegt/.test(res.stdout), `der Hinweis steht trotz vorhandenem Label:\n${res.stdout}`);
    assert.equal(ankerZaehlen(dir, roh), 1, "die Ablehnung selbst bleibt kommentiert");
  });
});

test("[night-42] ohne Ablehnung wegen fehlender Pruefung bleibt der Hinweis aus", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const karte = fachplan(dir, "[Fachlich] Offene Frage", "kit:night", false);
    board(dir, "issue", "label", "add", karte, "kit:klaeren");
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /traegt kit:klaeren/);
    assert.ok(!/keine Karte am Board traegt/.test(res.stdout), `der Hinweis steht ohne Adressaten:\n${res.stdout}`);
    assert.equal(ankerZaehlen(dir, karte), 0, "die Karte mit kit:klaeren wurde faelschlich kommentiert");
  });
});
