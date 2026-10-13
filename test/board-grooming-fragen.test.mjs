// Offene Fragen eines Fachplans lesen (Issue #1511, Plan #1510 A2, E2–E4): `fragenLesen`
// zerlegt den Abschnitt `## Offene Fragen an den PO` in Vermerk, Fragen und ungegliederten
// Text, `vermerkZeile` erzeugt den Vermerk „Keine“, den die Nacht-Kette als erledigt liest.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fragenLesen, vermerkZeile } from "../kit/board/grooming.mjs";
import { offeneFragenGrund } from "../kit/night/kette.mjs";

const fachplan = (abschnitt, ueberschrift = "## Offene Fragen an den PO") =>
  `## Ziel\nz\n\n## Fachliche Akzeptanzkriterien\n1. k\n\n## Nicht-Ziele\n- n\n\n${ueberschrift}\n${abschnitt}\n\n## Anhang\n- keine Frage\n`;

const ANTWORT = "   **Antwort (PO, 2026-10-10):** Ja.";

test("Listenformen <n>., -, * und + sind je eine Frage", () => {
  for (const marke of ["1.", "-", "*", "+"]) {
    const r = fragenLesen(fachplan(`${marke} Erste Frage?\n${marke} Zweite Frage?`));
    assert.deepEqual(r.fragen.map((f) => f.text), ["Erste Frage?", "Zweite Frage?"], `Listenform ${marke}`);
    assert.deepEqual(r.fragen.map((f) => f.nr), [1, 2]);
    assert.equal(r.offen, 2);
    assert.deepEqual(r.ungegliedert, []);
  }
});

test("Antwortzeile mit Urheber und Datum entscheidet die Frage, mit und ohne **", () => {
  const r = fragenLesen(fachplan(`1. Fett?\n${ANTWORT}\n2. Schlicht?\n   Antwort (PO, 2026-10-10): Nein.`));
  assert.deepEqual(r.fragen.map((f) => f.entschieden), [true, true]);
  assert.equal(r.fragen[0].antwortZeile, "**Antwort (PO, 2026-10-10):** Ja.");
  assert.equal(r.fragen[1].antwortZeile, "Antwort (PO, 2026-10-10): Nein.");
  assert.equal(r.offen, 0);
});

test("Antwortzeile ohne Urheber oder ohne Datum laesst die Frage offen", () => {
  const r = fragenLesen(fachplan([
    "1. Ohne Urheber?", "   **Antwort (2026-10-10):** Ja.",
    "2. Ohne Datum?", "   **Antwort (PO):** Ja.",
    "3. Leerer Urheber?", "   Antwort (, 2026-10-10): Ja.",
    "4. Nur das Wort?", "   Antwort: Ja.",
  ].join("\n")));
  assert.deepEqual(r.fragen.map((f) => f.entschieden), [false, false, false, false]);
  assert.deepEqual(r.fragen.map((f) => f.antwortZeile), [null, null, null, null]);
  assert.equal(r.offen, 4);
});

test("eingerueckte Folgezeilen gehoeren zur Frage davor", () => {
  const r = fragenLesen(fachplan(`1. Erste Zeile\n   zweite Zeile\n\n   dritte Zeile\n${ANTWORT}\n2. Naechste?`));
  assert.equal(r.fragen.length, 2);
  assert.equal(r.fragen[0].text, "Erste Zeile\nzweite Zeile\n\ndritte Zeile");
  assert.equal(r.fragen[0].entschieden, true);
  assert.equal(r.fragen[1].entschieden, false);
  assert.deepEqual(r.ungegliedert, []);
});

test("eine eingerueckte Unterliste ist Folgezeile, keine eigene Frage", () => {
  const r = fragenLesen(fachplan("1. Welche Variante?\n   - Variante a\n   - Variante b"));
  assert.equal(r.fragen.length, 1);
  assert.equal(r.offen, 1);
});

test("Listenelemente in einem Code-Fence zaehlen nicht, auch keine Antwortzeile darin", () => {
  const r = fragenLesen(fachplan([
    "```markdown", "1. Beispielfrage?", "   **Antwort (PO, 2026-10-10):** Beispiel.", "```",
    "1. Echte Frage?", "   ~~~", "   **Antwort (PO, 2026-10-10):** im Fence", "   ~~~",
  ].join("\n")));
  assert.equal(r.fragen.length, 1);
  assert.equal(r.fragen[0].text.split("\n")[0], "Echte Frage?");
  assert.equal(r.fragen[0].entschieden, false);
  assert.deepEqual(r.ungegliedert, []);
});

test("der Vermerk „Keine…“ als erste Zeile ist vermerk und keine Frage", () => {
  const vermerk = "Keine. Die 2 Fragen hat der PO am 2026-10-10 entschieden, die Antworten stehen unter der jeweiligen Frage.";
  const r = fragenLesen(fachplan(`${vermerk}\n\n1. Eins?\n${ANTWORT}\n2. Zwei?\n${ANTWORT}`));
  assert.equal(r.vermerk, vermerk);
  assert.equal(r.fragen.length, 2);
  assert.equal(r.offen, 0);
  assert.deepEqual(r.ungegliedert, []);
});

test("der Vermerk in Listenform „- Keine“ zaehlt nicht als Frage", () => {
  const r = fragenLesen(fachplan("- Keine"));
  assert.equal(r.vermerk, "- Keine");
  assert.deepEqual(r.fragen, []);
  assert.equal(r.offen, 0);
});

test("„Keine“ erst nach einer Frage ist kein Vermerk", () => {
  const r = fragenLesen(fachplan("1. Frage?\n- Keine weitere"));
  assert.equal(r.vermerk, null);
  assert.equal(r.fragen.length, 2);
});

test("Fliesstext ohne Listenform landet absatzweise in ungegliedert", () => {
  const r = fragenLesen(fachplan("Soll der Export auch CSV koennen?\nOder nur JSON?\n\nWer entscheidet ueber das Format?"));
  assert.deepEqual(r.fragen, []);
  assert.deepEqual(r.ungegliedert, ["Soll der Export auch CSV koennen?\nOder nur JSON?", "Wer entscheidet ueber das Format?"]);
  assert.equal(r.vermerk, null);
});

test("nicht eingerueckter Text nach einer Frage beendet sie und ist ungegliedert", () => {
  const r = fragenLesen(fachplan("1. Frage?\nLoser Satz dahinter."));
  assert.equal(r.fragen.length, 1);
  assert.equal(r.fragen[0].text, "Frage?");
  assert.deepEqual(r.ungegliedert, ["Loser Satz dahinter."]);
});

test("der Abschnitt endet an der naechsten ##-Ueberschrift", () => {
  const r = fragenLesen(fachplan("1. Nur diese?"));
  assert.equal(r.fragen.length, 1);
});

test("Ueberschrift in beiden Sprachen", () => {
  const de = fragenLesen(fachplan("1. Frage?", "## Offene Fragen an den PO"));
  const en = fragenLesen(fachplan("1. Question?", "## Open questions for the PO"));
  assert.equal(de.fragen.length, 1);
  assert.equal(en.fragen.length, 1);
  assert.equal(en.fragen[0].text, "Question?");
});

test("`## Offene Fragen` eines Plans ist nicht der Abschnitt an den PO", () => {
  const r = fragenLesen("## Ziel\nz\n\n## Offene Fragen\n1. Stopp-Frage?\n");
  assert.deepEqual(r, { vermerk: null, fragen: [], ungegliedert: [], offen: 0 });
});

test("ohne Abschnitt: nichts offen, nichts gelesen", () => {
  assert.deepEqual(fragenLesen("## Ziel\nz\n"), { vermerk: null, fragen: [], ungegliedert: [], offen: 0 });
  assert.deepEqual(fragenLesen(""), { vermerk: null, fragen: [], ungegliedert: [], offen: 0 });
});

test("Zeilenenden CRLF werden wie LF gelesen", () => {
  const r = fragenLesen(fachplan(`1. Frage?\n${ANTWORT}`).replaceAll("\n", "\r\n"));
  assert.equal(r.fragen.length, 1);
  assert.equal(r.fragen[0].entschieden, true);
});

test("ein gegroomter Fachplan aus dem Bestand: 7 Fragen, alle entschieden", () => {
  const fragen = Array.from({ length: 7 }, (_, i) => `${i + 1}. **Frage ${i + 1}?** Erlaeuterung.\n${ANTWORT}`).join("\n");
  const r = fragenLesen(fachplan(`${vermerkZeile(7, "2026-10-10")}\n\n${fragen}`));
  assert.equal(r.fragen.length, 7);
  assert.equal(r.offen, 0);
  assert.ok(r.vermerk.startsWith("Keine. Die 7 Fragen"));
});

test("vermerkZeile: Mehrzahl und Einzahl im Wortlaut aus E4", () => {
  assert.equal(vermerkZeile(3, "2026-10-12"),
    "Keine. Die 3 Fragen hat der PO am 2026-10-12 entschieden, die Antworten stehen unter der jeweiligen Frage.");
  assert.equal(vermerkZeile(1, "2026-10-12"),
    "Keine. Die 1 Frage hat der PO am 2026-10-12 entschieden, die Antwort steht unter der Frage.");
});

test("vermerkZeile nimmt ein Date und schreibt das Kalenderdatum", () => {
  assert.match(vermerkZeile(2, new Date("2026-10-12T08:00:00Z")), /am 2026-10-12 entschieden/);
});

test("vermerkZeile weist eine Zahl unter 1 und ein falsches Datum ab", () => {
  assert.throws(() => vermerkZeile(0, "2026-10-12"), /Zahl/);
  assert.throws(() => vermerkZeile(1.5, "2026-10-12"), /Zahl/);
  assert.throws(() => vermerkZeile(2, "12.10.2026"), /Datum/);
});

test("Gleichlauf: offeneFragenGrund liest den Vermerk aus vermerkZeile als erledigt", () => {
  for (const zahl of [1, 4]) {
    const body = fachplan(`${vermerkZeile(zahl, "2026-10-12")}\n\n1. Frage?\n${ANTWORT}`);
    assert.equal(offeneFragenGrund(body), null, `Vermerk mit ${zahl}`);
    assert.equal(fragenLesen(body).vermerk, vermerkZeile(zahl, "2026-10-12"));
  }
  assert.notEqual(offeneFragenGrund(fachplan("1. Frage?")), null, "Gegenprobe: ohne Vermerk offen");
});

// Der geklaerte Stand einer Idee aus /triage hat dieselbe Form wie die offenen Fragen
// (Issue #1627, Plan #1623 A5): derselbe Leser, nur der Name der Ueberschrift ist ein anderer.
test("fragenLesen liest den Abschnitt ## Geklärter Stand, deutsch und englisch", () => {
  const punkte = `- Erster Punkt?\n${ANTWORT}\n- Zweiter Punkt?\n- Dritter Punkt?\n   Antwort (Manne, 2026-10-13): Nein.`;
  for (const ueberschrift of ["## Geklärter Stand", "## Clarified state"]) {
    const r = fragenLesen(`## Idee\ni\n\n${ueberschrift}\n${punkte}\n\n## Anhang\n- kein Punkt\n`, "geklaerterStand");
    assert.deepEqual(r.fragen.map((f) => f.text), ["Erster Punkt?", "Zweiter Punkt?", "Dritter Punkt?"], ueberschrift);
    assert.deepEqual(r.fragen.map((f) => f.entschieden), [true, false, true], ueberschrift);
    assert.equal(r.offen, 1, ueberschrift);
  }
});

test("ohne Name der Ueberschrift liest fragenLesen weiter nur die offenen Fragen an den PO", () => {
  const body = `## Geklärter Stand\n- Punkt?\n\n## Offene Fragen an den PO\n- Frage?\n${ANTWORT}\n`;
  assert.deepEqual(fragenLesen(body).fragen.map((f) => f.text), ["Frage?"]);
  assert.deepEqual(fragenLesen(body, "geklaerterStand").fragen.map((f) => f.text), ["Punkt?"]);
});
