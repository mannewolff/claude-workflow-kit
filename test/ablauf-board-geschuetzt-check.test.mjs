// Ablauf-Pruefung: `issue check-geschuetzt` fuehrt der Einstieg kit/board.mjs; er liest Karte und
// Kommentare ueber den Tracker, und der Befund ist JSON-Ausgabe und Exitcode des Prozesses.
//
// `issue check-geschuetzt` — Treffer, Freigabe und Halt-Kommentar eines Pakets (Issue #1045,
// Plan #987, E5, E6, E11, E17).
//
// Der Halt-Kommentar ist Schreib- und Leseformat zugleich: Das Gate liest beim naechsten
// Anlauf aus genau diesem Text zurueck, welche Pfade der Mensch freigegeben hat. Darum
// prueft der Rundlauf-Test, dass der erzeugte Text wieder eingelesen freigibt.
//
// Geschuetzte Pfade kommen aus `GESCHUETZTE_PFADE`, nie als Literal (E18): Sonst hielte das
// eigene Gate die Pakete dieses Plans an.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  GESCHUETZTE_PFADE,
  GESCHUETZT_ABGEWIESEN,
  GESCHUETZT_ANKER,
  GESCHUETZT_LABEL,
  GESCHUETZT_LABEL_GESETZT,
  GESCHUETZT_LABEL_NICHT_GESETZT,
  geschuetztKommentar,
  geschuetztFreigabe,
} from "../kit/board/geschuetzt.mjs";
import { setupProjekt, runBoard, runBoardAsync, starteServer, toolboxMitKommentaren } from "./helpers/board-fixture.mjs";

const EINSTELLUNGEN = GESCHUETZTE_PFADE[0];
const LOKAL_EINSTELLUNGEN = GESCHUETZTE_PFADE[1];
const AUFGABE_ZEILE = `In \`${EINSTELLUNGEN}\` einen Eintrag ergaenzen.`;
const KRITERIUM_ZEILE = `- \`${LOKAL_EINSTELLUNGEN}\` traegt den Eintrag.`;

function paket({ aufgabe = AUFGABE_ZEILE, kriterium = "- `node --test` ist gruen." } = {}) {
  return `## Kontext
Warum.

## Aufgabe
${aufgabe}

## Akzeptanzkriterium
${kriterium}

## Abhängigkeiten
Keine.
`;
}

const UNBETROFFEN = paket({ aufgabe: "In `kit/board.mjs` etwas aendern." });

function halt(pfade, labelZeile) {
  const liste = pfade.map((p) => "- `" + p + "`").join("\n");
  return `${GESCHUETZT_ANKER}\n\n${liste}\n\n${labelZeile}`;
}

// --- Kommando am lokalen Tracker -----------------------------------------------------

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function lokalDatei({ titel = "[Task] Paket", body, labels = [], kommentare = [] }) {
  const labelZeile = labels.length > 0 ? "labels: " + labels.join(", ") + "\n" : "";
  let inhalt = `---\nid: "0007"\ntype: task\nstatus: ready\ntitle: ${titel}\n${labelZeile}---\n\n${body}`;
  for (const k of kommentare) inhalt += `\n\n---\n**Kommentar** (2026-09-30 08:00)\n\n${k}`;
  return inhalt;
}

function mitLokal(karte, fn) {
  const dir = setupProjekt(LOKAL, "board-check-geschuetzt-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  const datei = join(dir, "issues", "0007.md");
  writeFileSync(datei, lokalDatei(karte), "utf-8");
  try {
    return fn(dir, datei);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function json(res) {
  return JSON.parse(res.stdout);
}

/** Die Faelle aus dem Akzeptanzkriterium, je Adapter einmal durchgespielt. */
const FAELLE = [
  {
    name: "betroffenes Paket: ok false, Treffer mit Pfad und Zeile, Exit 1",
    karte: { body: paket() },
    pruefe(res) {
      assert.equal(res.status, 1, res.stderr);
      const r = json(res);
      assert.equal(r.ok, false);
      assert.deepEqual(r.treffer, [{ pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE }]);
      assert.equal(r.label, false);
      assert.equal(r.freigegeben, false);
      assert.equal(r.kommentar, geschuetztKommentar(r.treffer));
      assert.match(r.handlung, /Mensch/);
    },
  },
  {
    name: "unbetroffenes Paket: ok true, Exit 0",
    karte: { body: UNBETROFFEN },
    pruefe(res) {
      assert.equal(res.status, 0, res.stderr);
      const r = json(res);
      assert.deepEqual({ ok: r.ok, treffer: r.treffer, label: r.label, freigegeben: r.freigegeben, kommentar: r.kommentar },
        { ok: true, treffer: [], label: false, freigegeben: false, kommentar: null });
      assert.equal(typeof r.handlung, "string");
    },
  },
  {
    name: "freigegebene Karte nach E5: ok true, freigegeben true",
    karte: { body: paket(), kommentare: [halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT)] },
    pruefe(res) {
      assert.equal(res.status, 0, res.stderr);
      const r = json(res);
      assert.equal(r.ok, true);
      assert.equal(r.freigegeben, true);
      assert.equal(r.treffer.length, 1);
    },
  },
  {
    name: "Halt-Kommentar mit 'nicht gesetzt' und ohne Label: ok false",
    karte: { body: paket(), kommentare: [halt([EINSTELLUNGEN], GESCHUETZT_LABEL_NICHT_GESETZT)] },
    pruefe(res) {
      assert.equal(res.status, 1);
      assert.equal(json(res).ok, false);
      assert.equal(json(res).freigegeben, false);
    },
  },
  {
    name: "Halt-Kommentar ohne Label, aber mit einem weiteren, nicht genannten Pfad: ok false",
    karte: { body: paket({ kriterium: KRITERIUM_ZEILE }), kommentare: [halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT)] },
    pruefe(res) {
      assert.equal(res.status, 1);
      const r = json(res);
      assert.equal(r.ok, false);
      assert.equal(r.freigegeben, false);
      assert.deepEqual(r.treffer.map((t) => t.pfad), [EINSTELLUNGEN, LOKAL_EINSTELLUNGEN]);
    },
  },
  {
    name: "Karte mit Label, aber ohne Pfad: ok false, menschliche Handlung wartet",
    karte: { body: UNBETROFFEN, labels: [GESCHUETZT_LABEL] },
    pruefe(res) {
      assert.equal(res.status, 1);
      const r = json(res);
      assert.equal(r.ok, false);
      assert.equal(r.label, true);
      assert.deepEqual(r.treffer, []);
      assert.equal(r.kommentar, null);
      assert.match(r.handlung, /menschliche Handlung wartet/);
    },
  },
  {
    name: "Karte mit Label und freigebendem Kommentar: ok false, solange das Label haengt",
    karte: { body: paket(), labels: [GESCHUETZT_LABEL], kommentare: [halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT)] },
    pruefe(res) {
      assert.equal(res.status, 1);
      assert.deepEqual({ ok: json(res).ok, label: json(res).label, freigegeben: json(res).freigegeben }, { ok: false, label: true, freigegeben: false });
    },
  },
];

for (const fall of FAELLE) {
  test(`local: ${fall.name}`, () => {
    mitLokal(fall.karte, (dir, datei) => {
      const vorher = readFileSync(datei, "utf-8");
      fall.pruefe(runBoard(dir, ["issue", "check-geschuetzt", "7"]));
      assert.equal(readFileSync(datei, "utf-8"), vorher, "Spalte, Labels und Kommentare bleiben unveraendert");
    });
  });
}

test("local: Rundlauf ueber das Kommando — der ausgegebene Kommentar gibt nach Abnahme des Labels frei", () => {
  mitLokal({ body: paket({ kriterium: KRITERIUM_ZEILE }) }, (dir, datei) => {
    const erst = json(runBoard(dir, ["issue", "check-geschuetzt", "7"]));
    assert.equal(erst.ok, false);
    writeFileSync(datei, lokalDatei({ body: paket({ kriterium: KRITERIUM_ZEILE }), kommentare: [`${erst.kommentar}\n\n${GESCHUETZT_LABEL_GESETZT}`] }), "utf-8");
    const res = runBoard(dir, ["issue", "check-geschuetzt", "7"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual({ ok: json(res).ok, freigegeben: json(res).freigegeben }, { ok: true, freigegeben: true });
  });
});

test("local: die Schreibsperren der Projektwurzel zaehlen mit", () => {
  mitLokal({ body: paket({ aufgabe: "In `geheim/schluessel.txt` etwas aendern." }) }, (dir) => {
    assert.equal(runBoard(dir, ["issue", "check-geschuetzt", "7"]).status, 0);
    writeFileSync(join(dir, EINSTELLUNGEN), JSON.stringify({ permissions: { deny: ["Edit(geheim/**)"] } }), "utf-8");
    const res = runBoard(dir, ["issue", "check-geschuetzt", "7"]);
    assert.equal(res.status, 1);
    assert.deepEqual(json(res).treffer.map((t) => t.pfad), ["geheim/schluessel.txt"]);
  });
});

test("local: ohne Kartennummer oder mit unbekannter Karte Exit 1", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const ohne = runBoard(dir, ["issue", "check-geschuetzt"]);
    assert.equal(ohne.status, 1);
    assert.match(ohne.stderr, /check-geschuetzt/);
    assert.equal(runBoard(dir, ["issue", "check-geschuetzt", "99"]).status, 1);
  });
});

test("der Hilfetext nennt das Kommando", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /issue check-geschuetzt <id>/);
    assert.match(res.stdout, /issue check-geschuetzt <id> \[--pfad <pfad>\]/);
  });
});

// --- --pfad: der beim Schreiben abgewiesene Pfad (Issue #1053, Plan #987, E13, E17) ---

test("local: --pfad mit geschuetztem Pfad ergibt ok false und den Pfad in der Backtick-Liste", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const res = runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", EINSTELLUNGEN]);
    assert.equal(res.status, 1, res.stderr);
    const r = json(res);
    assert.equal(r.ok, false);
    assert.deepEqual(r.treffer, [{ pfad: EINSTELLUNGEN, zeile: GESCHUETZT_ABGEWIESEN }]);
    assert.equal(GESCHUETZT_ABGEWIESEN, "beim Schreiben abgewiesen");
    assert.ok(r.kommentar.split("\n").includes(`- \`${EINSTELLUNGEN}\``), r.kommentar);
    assert.equal(r.kommentar, geschuetztKommentar(r.treffer));
  });
});

test("local: --pfad — der Kommentar samt 'gesetzt' wird von geschuetztFreigabe als Halt-Kommentar erkannt", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const r = json(runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", EINSTELLUNGEN]));
    const body = `${r.kommentar}\n\n${GESCHUETZT_LABEL_GESETZT}`;
    assert.equal(geschuetztFreigabe(r.treffer, [{ body }], []), true);
    assert.equal(geschuetztFreigabe(r.treffer, [{ body }], [GESCHUETZT_LABEL]), false, "solange das Label haengt");
  });
});

test("local: --pfad mehrfach — jeder geschuetzte Pfad ist ein Treffer, ein fremder keiner", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const r = json(runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", EINSTELLUNGEN, "--pfad", "kit/board.mjs", "--pfad", LOKAL_EINSTELLUNGEN]));
    assert.deepEqual(r.treffer.map((t) => t.pfad), [EINSTELLUNGEN, LOKAL_EINSTELLUNGEN]);
  });
});

test("local: --pfad mit fremdem Pfad ergibt keinen Treffer", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const res = runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", "kit/board.mjs"]);
    assert.equal(res.status, 0, res.stderr);
    const r = json(res);
    assert.deepEqual({ ok: r.ok, treffer: r.treffer, kommentar: r.kommentar }, { ok: true, treffer: [], kommentar: null });
  });
});

test("local: --pfad absolut unter der Projektwurzel trifft wie relativ", () => {
  mitLokal({ body: UNBETROFFEN }, (dir) => {
    const absolut = join(realpathSync(dir), EINSTELLUNGEN);
    const r = json(runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", absolut]));
    assert.deepEqual(r.treffer, [{ pfad: absolut, zeile: GESCHUETZT_ABGEWIESEN }]);
  });
});

test("local: --pfad ergaenzt die Treffer aus dem Body", () => {
  mitLokal({ body: paket() }, (dir) => {
    const r = json(runBoard(dir, ["issue", "check-geschuetzt", "7", "--pfad", LOKAL_EINSTELLUNGEN]));
    assert.deepEqual(r.treffer, [
      { pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE },
      { pfad: LOKAL_EINSTELLUNGEN, zeile: GESCHUETZT_ABGEWIESEN },
    ]);
  });
});

// --- Kommando am Toolbox-Mock --------------------------------------------------------

test("toolbox", async (t) => {
  const karten = FAELLE.map((f, i) => ({
    id: 900 + i, number: 10 + i, title: "[Task] Paket", body: f.karte.body, column: "READY", position: i,
    labels: (f.karte.labels || []).map((name) => ({ name })),
  }));
  const kommentare = {};
  FAELLE.forEach((f, i) => {
    kommentare[900 + i] = (f.karte.kommentare || []).map((body, j) => ({ id: 40 + j, author: "manne", body, createdAt: "2026-09-28T08:00:00Z" }));
  });
  const { server, requests, host } = await starteServer(toolboxMitKommentaren({ karten, kommentare }));
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-check-geschuetzt-tbx-");
  try {
    for (const [i, fall] of FAELLE.entries()) {
      await t.test(fall.name, async () => {
        fall.pruefe(await runBoardAsync(dir, ["issue", "check-geschuetzt", String(10 + i)], { TBX_TOKEN: "test-token" }));
      });
    }
    await t.test("nur lesende Requests", () => {
      assert.deepEqual(requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`), []);
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
