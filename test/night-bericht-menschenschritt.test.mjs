// Wartet eine Kette auf einen Menschenschritt, steht das im Laufstand und unter Ausgang
// (Issue #1281).
//
// Anlass: Die Kette an #1264 baute sieben von elf Paketen und blieb an der `[Mensch]`-Karte
// #1273 haengen; #1274 hing direkt, #1275 und #1276 mittelbar daran. Der Ausgang bleibt
// `fertig` (Vertrag mit der Laufmeldung, Plan #1243 E6) — darunter steht je Menschenschritt
// `wartet auf Menschenschritt #<N> <Titel> — daran hängen …`, und die Zeile `Als Nächstes:`
// des Laufstands nennt den Handgriff statt des Textes aus ALS_NAECHSTES. Ohne
// Menschenschritt bleiben Bericht und Laufstand wortgleich.
//
// Zwei Ebenen: `berichtBauen` als reine Funktion an Fixtures, dazu die Kette im Prozess
// (`ketteImProzess`) fuer Laufstand, Bericht am Board und Schlusszeile des Protokolls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtBauen, wartendeMenschenschritte } from "../kit/night/bericht.mjs";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, planKarte, planBody, paketBody, KETTE_LABEL, GLATT } from "./helpers/kette-fixture.mjs";

const F = "1264";
const P = "1265";
const MENSCH = "1273";
const MENSCH_TITEL = "[Mensch] Windows-Runner im CI abmelden";
const MENSCHENSCHRITT = "Menschenschritt — wird nicht implementiert, die Karte wartet auf einen Menschen und ist nicht gescheitert.";
const abhaengig = (...ids) => `Abhaengigkeit ${ids.map((d) => "#" + d).join(", ")} nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.`;

function ausgangBlock(text) {
  return text.split("### Ausgang\n\n")[1].split("\n\n")[0].split("\n");
}

// --- Reine Funktion ---

function bericht(nichtBegonnen, pakete) {
  const einheit = {
    id: F, ausgang: "fertig", variante: "B", ziel: "push-vorbereitet",
    stufen: { plan: { id: P }, pakete: { ids: pakete.map((k) => k.id) }, umsetzung: { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen } },
  };
  return berichtBauen(einheit, { plan: { id: P, title: "[Plan] X", body: "" }, pakete, stempel: "s" });
}

const karte = (id, title = `Paket ${id}`) => ({ id, title, body: "" });

/** Der Anlass: #1273 ist der Menschenschritt, #1274 haengt direkt, #1275 und #1276 mittelbar daran. */
const ANLASS = [
  { id: MENSCH, grund: MENSCHENSCHRITT, mensch: true },
  { id: "1274", grund: abhaengig(MENSCH), unmet: [MENSCH] },
  { id: "1275", grund: abhaengig("1274"), unmet: ["1274"] },
  { id: "1276", grund: abhaengig("1275"), unmet: ["1275"] },
];
const ANLASS_KARTEN = [karte(MENSCH, MENSCH_TITEL), karte("1274"), karte("1275"), karte("1276")];

test("Anlass: unter ### Ausgang stehen fertig und der wartende Menschenschritt mit allen hängenden Paketen", () => {
  assert.deepEqual(ausgangBlock(bericht(ANLASS, ANLASS_KARTEN)), [
    "fertig",
    `wartet auf Menschenschritt #${MENSCH} ${MENSCH_TITEL} — daran hängen #1274, #1275, #1276`,
  ]);
});

test("ein Menschenschritt ohne hängende Pakete", () => {
  const nicht = [ANLASS[0], { id: "1280", grund: "Zeitbudget umsetzung (60 min) erschoepft" }];
  assert.deepEqual(ausgangBlock(bericht(nicht, [...ANLASS_KARTEN, karte("1280")])), [
    "fertig",
    `wartet auf Menschenschritt #${MENSCH} ${MENSCH_TITEL} — daran hängt kein weiteres Paket`,
  ]);
});

test("zwei Menschenschritte: je eine Zeile, ein Paket an beiden zählt bei beiden", () => {
  const nicht = [
    ANLASS[0],
    { id: "1277", grund: MENSCHENSCHRITT, mensch: true },
    { id: "1278", grund: abhaengig(MENSCH, "1277"), unmet: [MENSCH, "1277"] },
    { id: "1279", grund: abhaengig("1277"), unmet: ["1277"] },
  ];
  const karten = [karte(MENSCH, MENSCH_TITEL), karte("1277", "[Mensch] Token erneuern"), karte("1278"), karte("1279")];
  assert.deepEqual(ausgangBlock(bericht(nicht, karten)), [
    "fertig",
    `wartet auf Menschenschritt #${MENSCH} ${MENSCH_TITEL} — daran hängen #1278`,
    "wartet auf Menschenschritt #1277 [Mensch] Token erneuern — daran hängen #1278, #1279",
  ]);
  assert.deepEqual(wartendeMenschenschritte({ nichtBegonnen: nicht }), [
    { id: MENSCH, haengen: ["1278"] },
    { id: "1277", haengen: ["1278", "1279"] },
  ]);
});

test("ohne Menschenschritt bleibt der Bericht wortgleich", () => {
  const nicht = [{ id: "1274", grund: abhaengig("99"), unmet: ["99"] }];
  const mit = bericht(nicht, [karte("1274")]);
  const ohneFelder = bericht([{ id: "1274", grund: abhaengig("99") }], [karte("1274")]);
  assert.equal(mit, ohneFelder);
  assert.deepEqual(ausgangBlock(mit), ["fertig"]);
  assert.deepEqual(wartendeMenschenschritte({ nichtBegonnen: nicht }), []);
  assert.deepEqual(wartendeMenschenschritte(undefined), []);
});

// --- Die Kette im Prozess ---

/** Fachplan F mit ziel:umsetzung, ein geprufter Plan P, der Laufstand nach der Abdeckung, dazu die Pakete. */
function karten(pakete, fremde = []) {
  const markiert = planBody().replace("Plan-Modell: fixture-modell", "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-28, Nachtlauf)");
  const fach = fachplanKarte(F, { labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "ziel:umsetzung", "lauf:abgebrochen"] });
  fach.comments = [{ body: `## Laufstand\n\nzuletzt abgeschlossen: abdeckung fertig für #${P} um 2026-09-28T03:05:00.000Z` }];
  const paketKarten = pakete.map(({ id, title = `Paket ${id}`, status = "backlog", deps = [] }, i) => ({
    id, title, status, labels: [],
    body: paketBody(P, F, { n: i + 1, aufgabe: `Paket ${id}.`, abhaengigkeiten: deps.length > 0 ? deps.map((d) => `- Issue #${d}`).join("\n") : "Keine." }),
  }));
  return [fach, planKarte(P, F, { body: markiert }), ...paketKarten, ...fremde];
}

async function kette(pakete, fremde = []) {
  const r = await ketteImProzess({ karten: karten(pakete, fremde), sitzung: GLATT, kette: { uebergaenge: { abdeckungUmsetzung: true } } });
  assert.equal(r.code, 0, r.ausgabe);
  const staende = r.journal.filter((z) => z.art === "stand" && z.karte === F).map((z) => z.text);
  const amBoard = r.karte(F).comments.map((c) => c.body).find((b) => b.includes("### Ausgang"));
  const schluss = r.ausgabe.split("\n").find((z) => z.includes("Nacht-Kette beendet:"));
  return { r, laufstand: staende.at(-1), bericht: amBoard, schluss };
}

const ANLASS_PAKETE = [
  { id: "1266", status: "in_review" },
  { id: MENSCH, title: MENSCH_TITEL },
  { id: "1274", deps: [MENSCH] },
  { id: "1275", deps: ["1274"] },
  { id: "1276", deps: ["1275"] },
];

test("Anlass im Prozess: Laufstand nennt den Menschenschritt, Bericht und Protokoll ebenso", async () => {
  const { laufstand, bericht: text, schluss } = await kette(ANLASS_PAKETE);
  assert.ok(laufstand.startsWith(`fertig bis umsetzung\nAls Nächstes: Menschenschritt #${MENSCH} erledigen, dann kit:night an #${F} — 3 Paket(e) hängen daran.\n\nZiel: umsetzung\n`), laufstand);
  assert.deepEqual(ausgangBlock(text), [
    "fertig",
    `wartet auf Menschenschritt #${MENSCH} ${MENSCH_TITEL} — daran hängen #1274, #1275, #1276`,
  ]);
  assert.match(schluss, /, \d+ Paket\(e\) nicht begonnen, 1 Menschenschritt\(e\) offen\.$/);
});

test("zwei Menschenschritte im Prozess: beide mit Komma, die hängenden Pakete einmal gezählt", async () => {
  const { laufstand, schluss } = await kette([
    { id: MENSCH, title: MENSCH_TITEL },
    { id: "1277", title: "[Mensch] Token erneuern" },
    { id: "1278", deps: [MENSCH, "1277"] },
  ]);
  assert.ok(laufstand.startsWith(`fertig bis umsetzung\nAls Nächstes: Menschenschritt #${MENSCH}, #1277 erledigen, dann kit:night an #${F} — 1 Paket(e) hängen daran.\n`), laufstand);
  assert.match(schluss, /, 2 Menschenschritt\(e\) offen\.$/);
});

test("ein Menschenschritt ohne hängende Pakete im Prozess: 0 Paket(e)", async () => {
  const { laufstand } = await kette([{ id: "1266", status: "in_review" }, { id: MENSCH, title: MENSCH_TITEL }]);
  assert.ok(laufstand.startsWith(`fertig bis umsetzung\nAls Nächstes: Menschenschritt #${MENSCH} erledigen, dann kit:night an #${F} — 0 Paket(e) hängen daran.\n`), laufstand);
});

test("ohne Menschenschritt im Prozess: Laufstand, Ausgang und Schlusszeile wie heute", async () => {
  const { laufstand, bericht: text, schluss } = await kette([
    { id: "1266", status: "in_review" },
    { id: "1274", deps: ["1266", "1290"] },
  ], [{ id: "1290", title: "Fremde Karte", status: "backlog", labels: [], body: "## Aufgabe\n\nx\n" }]);
  assert.ok(laufstand.startsWith("fertig bis umsetzung\nAls Nächstes: Pakete in In review testen, dann `push main`.\n\nZiel: umsetzung\n"), laufstand);
  assert.deepEqual(ausgangBlock(text), ["fertig"]);
  assert.match(schluss, /, \d+ Paket\(e\) nicht begonnen\.$/);
  assert.doesNotMatch(text, /Menschenschritt/);
});
