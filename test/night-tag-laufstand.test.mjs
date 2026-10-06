// Der Prueflauf beansprucht seine Wurzel und setzt einen Laufstand (Plan #1113, Baustein D,
// E8; Issue #1189, #1234).
//
// Eine Kette sieht einen laufenden Prueflauf, und zwei Prueflaeufe sehen einander: Der
// Prueflauf beansprucht nach der Auswahl wie die Kette und vermerkt am Ende jeder Karte ihren
// Ausgang. Gefahren im selben Prozess gegen die Board-Attrappe (Plan #1199, E6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { hostname } from "node:os";

import { pruefLaufStand, pruefLaufFassung } from "../kit/night/tag.mjs";
import { REVIEW_FERTIG_LABEL, beanspruchtGrund, belegteWurzeln, waehleKettenKandidaten } from "../kit/night/kette.mjs";
import { kommentareVon } from "../kit/night/bericht.mjs";
import {
  BUDGET, PRUEF_LABEL, jeKarte, pruefKarte, pruefLaufImProzess, pruefungBefunde, pruefungGeprueft, pruefungHalt,
} from "./helpers/tag-fixture.mjs";

/** Der juengste Laufstand-Kommentar einer Karte, leer ohne ihn. */
const laufstandVon = (karte) => kommentareVon(karte).findLast((k) => k.startsWith("## Laufstand")) ?? "";
const laufLabels = (karte) => karte.labels.filter((l) => l.startsWith("lauf:"));

// --- Die Zuordnung der Ausgaenge (E8) ---

test("[night-1189] geprueft wird fertig, klaeren wartet, unvollstaendig und uebersprungen brechen mit Grund ab", () => {
  assert.equal(pruefLaufStand({ ausgang: "geprueft" }).zustand, "fertig");
  const klaeren = pruefLaufStand({ ausgang: "klaeren", frage: "Welche Zielgruppe gilt?\nmehr" });
  assert.equal(klaeren.zustand, "wartet");
  assert.match(klaeren.text, /Welche Zielgruppe gilt\?/);
  const rest = pruefLaufStand({ ausgang: "unvollstaendig", schritt: "befunde", grund: "Zeitbudget erschoepft" });
  assert.equal(rest.zustand, "abgebrochen");
  assert.match(rest.text, /Zeitbudget erschoepft/);
  assert.match(rest.text, /befunde/);
  const deckel = pruefLaufStand({ ausgang: "uebersprungen", grund: "Kostenbudget: 3.00 $ von 2 $ nach Pruefung 2" });
  assert.equal(deckel.zustand, "abgebrochen");
  assert.match(deckel.text, /Kostenbudget: 3\.00 \$ von 2 \$/);
});

test("[night-1189] der eigene Laufstand aendert die Fassung einer Karte nicht", () => {
  const body = "## Ziel\n\nEin Ziel.\n";
  const mitStand = `${body}\n\n---\n**Kommentar** (2026-10-05T10:00:00Z)\n\n## Laufstand\n\nLauf angenommen\n\nLauf-ID: a/1/x\n`;
  assert.equal(pruefLaufFassung(mitStand), pruefLaufFassung(body));
  const mitBefund = `${body}\n\n---\n**Kommentar** (2026-10-05T10:00:00Z)\n\n## Fachplan-Review, Runde 1\n\n- Fund\n`;
  assert.notEqual(pruefLaufFassung(mitBefund), pruefLaufFassung(body), "andere Kommentare bleiben Teil der Fassung");
});

// --- Der Laufstand am Board, je Ausgang ---

test("[night-1189] die Ausgaenge einer Session setzen den Laufstand der Karte", async () => {
  const r = await pruefLaufImProzess({
    karten: [pruefKarte(1), pruefKarte(2), pruefKarte(3)],
    sitzung: jeKarte({ 1: pruefungGeprueft, 2: pruefungHalt, 3: pruefungBefunde }),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(laufLabels(r.karte("1")), [], "fertig traegt kein Laufstand-Label");
  assert.match(laufstandVon(r.karte("1")), /geprueft/);
  assert.deepEqual(laufLabels(r.karte("2")), ["lauf:wartet"]);
  assert.match(laufstandVon(r.karte("2")), /Welche der beiden Zielgruppen/);
  assert.deepEqual(laufLabels(r.karte("3")), ["lauf:abgebrochen"]);
  assert.match(laufstandVon(r.karte("3")), /unvollstaendig/);
  assert.match(laufstandVon(r.karte("3")), /Fachplan-Review-Marker/, "der Grund steht im Laufstand");
  for (const id of ["1", "2", "3"]) {
    assert.match(laufstandVon(r.karte(id)), /^Lauf-ID: /m, `#${id}: der Laufstand nennt den Runner`);
  }
});

test("[night-1189] am Kostendeckel uebersprungene Karten brechen mit Grund ab", async () => {
  const r = await pruefLaufImProzess({
    karten: [pruefKarte(1), pruefKarte(2)],
    sitzung: (s) => ({ ...jeKarte({ 1: pruefungGeprueft })(s), kosten: 3 }),
    budget: { ...BUDGET, kostenUsd: 2 },
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.sitzungen.length, 1);
  assert.deepEqual(laufLabels(r.karte("2")), ["lauf:abgebrochen"]);
  assert.match(laufstandVon(r.karte("2")), /Kostenbudget: 3\.00 \$ von 2 \$/);
  assert.ok(r.karte("2").labels.includes(PRUEF_LABEL), "das Kennzeichen bleibt");
});

// --- Gegenseitiger Ausschluss (Kriterium 2 aus #1014) ---

/** Ein Laufstand `laeuft`, den dieser Testprozess haelt — er lebt, solange der Test laeuft. */
function lebenderHalter(karte) {
  const halter = `${hostname().split(".")[0]}/${process.pid}/2026-10-05-000000`;
  karte.labels.push("lauf:laeuft");
  karte.comments = [{ body: `## Laufstand\n\nLauf angenommen\n\nLauf-ID: ${halter}\nStand: 2026-10-06T01:59:00.000Z\n` }];
  return halter;
}

test("[night-1189] ein Prueflauf laesst eine Wurzel aus, die ein laufender Runner haelt, und schreibt nichts an sie", async () => {
  const belegt = pruefKarte(1, { titel: "[Fachlich] Belegt" });
  // Der Halter kann eine Kette oder ein zweiter Prueflauf sein — der Laufstand nennt die
  // Laufart nicht, und beide schreiben ihn auf demselben Weg.
  const halter = lebenderHalter(belegt);
  const r = await pruefLaufImProzess({ karten: [belegt, pruefKarte(2, { titel: "[Fachlich] Frei" })], sitzung: jeKarte({ 2: pruefungGeprueft }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(r.ausgabe.includes(beanspruchtGrund(halter)), r.ausgabe);
  assert.deepEqual(r.sitzungen.map((s) => s.issue), ["2"], "nur die freie Karte wird geprueft");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "2").ausgang, "geprueft");
  assert.ok(r.karte("1").labels.includes(PRUEF_LABEL), "das Kennzeichen der belegten Karte bleibt");
  assert.deepEqual(laufLabels(r.karte("1")), ["lauf:laeuft"]);
  assert.match(laufstandVon(r.karte("1")), new RegExp(halter), "der Laufstand des Halters bleibt stehen");
  assert.equal(r.lauf.einheiten.find((e) => e.id === "1").ausgang, "uebersprungen");
});

test("[night-1189] waehrend ein Prueflauf eine Karte prueft, laesst eine Kette ihre Wurzel aus", async () => {
  let gesehen = null;
  const kettensicht = (s) => {
    // Was eine Kette jetzt saehe: dieselbe Karte mit Kettenlabel, die Belegung aus dem Laufstand.
    const karte = s.board("issue", "get", s.issue);
    const kette = { ...karte, labels: [...karte.labels, "kit:night", REVIEW_FERTIG_LABEL] };
    gesehen = waehleKettenKandidaten([kette], "kit:night", 5, { belegt: belegteWurzeln([kette], "kit:night") });
    pruefungGeprueft(s);
  };
  const r = await pruefLaufImProzess({ karten: [pruefKarte(1, { titel: "[Fachlich] In Pruefung" })], sitzung: kettensicht });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(gesehen.kandidaten.length, 0, "die Kette darf die Wurzel nicht waehlen, solange der Prueflauf laeuft");
  assert.equal(gesehen.uebersprungen.length, 1);
  assert.match(gesehen.uebersprungen[0].grund, /^bereits von einem laufenden Runner beansprucht \(.+\/\d+\/.+\)$/);
  // Nach dem Lauf ist die Wurzel wieder frei.
  const danach = { ...r.karte("1"), labels: [...r.karte("1").labels, "kit:night", REVIEW_FERTIG_LABEL] };
  assert.equal(waehleKettenKandidaten([danach], "kit:night", 5).kandidaten.length, 1);
  assert.deepEqual(laufLabels(r.karte("1")), []);
});

test("[night-1189] ohne gekennzeichnete Karte setzt der Prueflauf keinen Laufstand", async () => {
  const r = await pruefLaufImProzess({ karten: [pruefKarte(1, { labels: ["kit:anderes"] })] });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(laufstandVon(r.karte("1")), "");
});
