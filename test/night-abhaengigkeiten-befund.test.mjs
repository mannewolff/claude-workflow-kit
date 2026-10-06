// Der Abhaengigkeitsbefund im selben Prozess (Issue #1227, Plan #1199, E6): Das Board ist
// eine Attrappe, eingesetzt ueber `abhaengigkeitenAbhaengigkeiten`. Befund, Kreise, die
// erfuellten Abhaengigkeiten und der Lauf-Cache werden direkt gegen den Teil geprueft; den
// Weg durch den echten Runner belegt ablauf-night-abhaengigkeiten-befund.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  abhaengigkeitenAbhaengigkeiten, abhaengigkeitsBefund, abhaengigkeitsBlock, abhaengigkeitsZeilen,
  kreiseAb, satisfiedIds, gateKarte, leseKarte, kreisLogZeile, wartetAufPush,
} from "../kit/night/abhaengigkeiten.mjs";

afterEach(() => abhaengigkeitenAbhaengigkeiten());

/** Ein Board aus Karten `{ id, title, body, status }`; zaehlt die Abrufe je Nummer. */
function boardAttrappe(karten, { kaputt = new Set() } = {}) {
  const abrufe = new Map();
  const get = (id) => {
    abrufe.set(Number(id), (abrufe.get(Number(id)) ?? 0) + 1);
    return kaputt.has(Number(id)) ? null : karten.find((k) => String(k.id) === String(id)) ?? null;
  };
  abhaengigkeitenAbhaengigkeiten({
    board: (...a) => {
      if (a[1] === "list") return karten.filter((k) => k.status === a[3]).map(({ id, title, status }) => ({ id, title, status }));
      const k = get(a[2]);
      if (!k) throw new Error(`#${a[2]} nicht abrufbar`);
      return k;
    },
    boardRoh: (...a) => {
      const k = get(a[2]);
      return k ? { status: 0, json: k } : { status: 1, json: null };
    },
  });
  return abrufe;
}

const deps = (...n) => ["## Abhaengigkeiten", ...n.map((x) => "Issue #" + x)].join("\n");

test("[night-1149] erfuellt ist, was nicht in Backlog, Ready oder In progress liegt", () => {
  boardAttrappe([
    { id: 1, title: "A", body: "", status: "backlog" },
    { id: 2, title: "B", body: "", status: "ready" },
    { id: 3, title: "C", body: "", status: "in_progress" },
    { id: 4, title: "D", body: "", status: "in_review" },
  ]);
  const erfuellt = satisfiedIds();
  assert.deepEqual([1, 2, 3, 4, 9999].map((n) => erfuellt.has(n)), [false, false, false, true, true]);
  erfuellt.add(2);
  assert.equal(erfuellt.has(2), true);
});

test("[night-1062] der Befund nennt Herkunft, Titel und Dokument-Art je Abhaengigkeit", () => {
  boardAttrappe([
    { id: 5, title: "Schon fertig", body: "", status: "in_review" },
    { id: 6, title: "[Plan] Ein Plandokument", body: "", status: "backlog" },
  ]);
  const body = "## Abhaengigkeiten\nIssue #5 muss vorher fertig sein.\nDer Rahmen steht in #6.";
  const befund = abhaengigkeitsBefund({ id: 7 }, body, satisfiedIds());
  assert.equal(befund.paket, 7);
  assert.deepEqual(befund.kreise, []);
  const [fertig, plan] = befund.abhaengigkeiten;
  assert.equal(fertig.erfuellt, true);
  assert.equal(fertig.herkunft, "verweiszeile");
  assert.equal(fertig.dokument, null);
  assert.equal(plan.erfuellt, false);
  assert.equal(plan.herkunft, "text");
  assert.equal(plan.dokument, "[Plan]");

  const block = abhaengigkeitsBlock(befund).split("\n");
  assert.equal(block[0], "Abhaengigkeiten, wie der Nachtlauf sie liest:");
  assert.match(block[1], /^- #5 \(Schon fertig\): erfuellt, aus einer Verweiszeile: „Issue #5 muss vorher fertig sein\.“$/);
  assert.match(block[2], /^- #6 \(\[Plan\] Ein Plandokument\): unerfuellt, aus erlaeuterndem Text: .*Plandokument wird nie durch Umsetzung erledigt\.$/);
  assert.ok(abhaengigkeitsZeilen(befund).every((z) => z.startsWith("    - #")));
});

test("[night-1064] ohne Abhaengigkeit gibt es keine Probelauf-Zeile", () => {
  boardAttrappe([]);
  assert.deepEqual(abhaengigkeitsZeilen(abhaengigkeitsBefund({ id: 1 }, "## Abhaengigkeiten\nKeine.", satisfiedIds())), []);
  assert.deepEqual(abhaengigkeitsZeilen(null), []);
});

test("[night-1063] zwei Pakete, die sich festhalten, tragen denselben Kreis ab der kleineren Nummer", () => {
  boardAttrappe([
    { id: 11, title: "A", body: deps(12), status: "ready" },
    { id: 12, title: "B", body: deps(11), status: "ready" },
  ]);
  const erfuellt = satisfiedIds();
  assert.deepEqual(kreiseAb(12, erfuellt), [[11, 12]]);
  const befund = abhaengigkeitsBefund({ id: 12 }, deps(11), erfuellt);
  assert.deepEqual(befund.kreise, [{ karten: [11, 12], steht: true }]);
  assert.match(abhaengigkeitsBlock(befund), /\nKreis: #11 -> #12 -> #11$/);
  assert.equal(kreisLogZeile(12, befund.kreise[0]), "#12 steht in einem Kreis: #11 -> #12 -> #11");
});

test("[night-1063] wer nur an einem Kreis haengt, wartet auf ihn; ein Selbstbezug ist ein Kreis aus einem Paket", () => {
  boardAttrappe([
    { id: 21, title: "A", body: deps(22), status: "ready" },
    { id: 22, title: "B", body: deps(23), status: "ready" },
    { id: 23, title: "C", body: deps(22), status: "backlog" },
    { id: 24, title: "D", body: deps(24), status: "ready" },
  ]);
  const erfuellt = satisfiedIds();
  const befund = abhaengigkeitsBefund({ id: 21 }, deps(22), erfuellt);
  assert.deepEqual(befund.kreise, [{ karten: [22, 23], steht: false }]);
  assert.match(abhaengigkeitsBlock(befund), /dieses Paket wartet auf einen Kreis\.$/);
  assert.deepEqual(kreiseAb(24, erfuellt), [[24]]);
});

test("[night-1063] ein scheiternder Abruf beendet den Pfad, und jede Karte wird je Lauf hoechstens einmal geholt", () => {
  const abrufe = boardAttrappe([
    { id: 31, title: "A", body: deps(32, 33), status: "ready" },
    { id: 32, title: "B", body: deps(33), status: "ready" },
    { id: 33, title: "C", body: deps(34), status: "backlog" },
    { id: 34, title: "D", body: deps(31), status: "backlog" },
  ], { kaputt: new Set([34]) });
  const erfuellt = satisfiedIds();
  // Die Listen tragen keinen Body, #34 laesst sich nicht holen: Der Pfad 31 -> 33 -> 34 endet dort.
  assert.deepEqual(kreiseAb(31, erfuellt), []);
  assert.deepEqual(kreiseAb(32, erfuellt), []);
  for (const [nummer, n] of abrufe) assert.equal(n, 1, `#${nummer} ${n}-mal abgerufen`);
  assert.equal(leseKarte(34), null);
});

test("[night-1063] gateKarte nimmt den Body aus dem Cache und holt nur, was fehlt", () => {
  const abrufe = boardAttrappe([{ id: 41, title: "A", body: "x", status: "ready" }]);
  satisfiedIds();
  assert.equal(gateKarte({ id: 41 }).body, "x");
  assert.equal(gateKarte({ id: 41 }).body, "x");
  assert.equal(abrufe.get(41), 1);
});

test("[night-1104] wartetAufPush liest nur Verweiszeilen mit dem Zusatz", () => {
  const body = "## Abhaengigkeiten\n- Issue #8 (wartet auf Push)\nIssue #9\n- Issue #8 (wartet auf Push)";
  assert.deepEqual(wartetAufPush(body), [8]);
  assert.deepEqual(wartetAufPush("kein Abschnitt"), []);
});

test("abhaengigkeitenAbhaengigkeiten weist unbekannte Namen ab", () => {
  assert.throws(() => abhaengigkeitenAbhaengigkeiten({ git: () => {} }), /kennt keine Abhaengigkeit 'git'/);
});
