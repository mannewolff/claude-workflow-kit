// `issue-review synthese-check` — das Kommando um den Beleg-Abgleich (Issue #592).
//
// Ein Pruefkern (`syntheseBelegt` aus #591), zwei Eingaenge: Der Board-Weg nimmt
// die Kartennummer und paart die juengste Synthese mit dem letzten Vorschlag
// davor; der Datei-Weg nimmt zwei Dateien. Der zweite Weg ist keine Bequemlichkeit
// — interaktiv liegt die Zustimmung des Menschen VOR dem ersten Schreibbefehl, am
// Board steht dann noch nichts, was zu pruefen waere (Plan #589, A6).
//
// Geprueft wird gegen die echten Paare aus test/fixtures/synthese (Issue #590).
// Die Zahl der Uebernahmen kommt aus dem Parser selbst und nicht aus einer im Test
// notierten Zahl: Die Schlusszeile der Synthesen ist in sechs von sieben Karten
// falsch, und eine abgeschriebene Zahl waere dieselbe Sorte Selbstauskunft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSyntheseZeilen } from "../kit/board.mjs";
import { setupProjekt, runBoard, runBoardAsync, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(repoRoot, "test", "fixtures", "synthese");

const KARTEN = ["579", "580", "583", "584", "585", "587", "589"];
const MIT_TOKEN = { TBX_TOKEN: "test-token" };
const CONFIG = { codeHost: "local", issueTracker: "toolbox" };

function pfad(verzeichnis, datei) {
  return join(FIXTURES, verzeichnis, datei);
}

function lies(verzeichnis, datei) {
  return readFileSync(pfad(verzeichnis, datei), "utf-8");
}

function herkunft(verzeichnis) {
  return JSON.parse(lies(verzeichnis, "herkunft.json"));
}

const mitVorschlag = KARTEN.filter((id) => herkunft(id).vorschlagIndex !== null);
const ohneVorschlag = KARTEN.filter((id) => !mitVorschlag.includes(id));

function uebernommen(text) {
  return parseSyntheseZeilen(text).filter((p) => p.ausgang === "uebernommen");
}

/** Ein Fixture-Projekt fuer die Dauer eines Tests, danach restlos weg. */
async function mitProjekt(fn, praefix = "board-synthese-") {
  const dir = setupProjekt(CONFIG, praefix);
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Datei-Weg, synchron: liefert Exit-Code und geparste stdout-Ausgabe. */
function dateiWeg(dir, syntheseP, vorschlagP) {
  const argv = ["issue-review", "synthese-check"];
  if (syntheseP !== null) argv.push("--synthese-file", syntheseP);
  if (vorschlagP !== null) argv.push("--vorschlag-file", vorschlagP);
  const res = runBoard(dir, argv);
  return { status: res.status, stderr: res.stderr, json: JSON.parse(res.stdout) };
}

/** Mock-Server, Fixture, Aufraeumen — Muster `mitBoard` aus board-label-sync.test.mjs. */
async function mitBoard(karten, fn, { kommentare = [] } = {}) {
  const antwort = (req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      const g = {};
      for (const k of karten) (g[k.column] ||= []).push(k);
      return { status: 200, json: g };
    }
    if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: kommentare };
    return null;
  };
  const { server, host } = await starteServer(antwort);
  const dir = setupProjekt({ ...CONFIG, toolbox: { host } }, "board-synthese-board-");
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

function karte(number) {
  return { id: number * 100, number, title: `Karte ${number}`, body: "## Kontext\n\nText.\n", column: "IN_REVIEW", position: 0 };
}

function kommentar(body) {
  return { author: "Manfred (Admin)", body, createdAt: "2026-09-10T14:00:00Z" };
}

/** Der Board-Weg gegen den Mock: liefert Exit-Code und geparste stdout-Ausgabe. */
async function boardWeg(dir, id) {
  const res = await runBoardAsync(dir, ["issue-review", "synthese-check", String(id)], MIT_TOKEN);
  return { status: res.status, stderr: res.stderr, json: JSON.parse(res.stdout) };
}

// --- Datei-Weg: die Fixtures aus #590 ---

test("[board-3] jedes aufbereitete Fixture-Paar meldet ok und keinen Befund", async () => {
  await mitProjekt(async (dir) => {
    for (const id of mitVorschlag) {
      const ergebnis = dateiWeg(dir, pfad(`${id}-aufbereitet`, "synthese.md"), pfad(`${id}-aufbereitet`, "vorschlag.md"));
      assert.equal(ergebnis.status, 0, `${id}-aufbereitet: ${ergebnis.stderr}`);
      assert.deepEqual(ergebnis.json.ohneBeleg, [], `${id}-aufbereitet: unerwartete Befunde`);
      assert.equal(ergebnis.json.ok, true);
      assert.equal(ergebnis.json.gepruefte, uebernommen(lies(`${id}-aufbereitet`, "synthese.md")).length);
    }
  });
});

test("[board-3] dieselben Karten unaufbereitet melden je uebernommen-Punkt beleg-fehlt", async () => {
  await mitProjekt(async (dir) => {
    for (const id of mitVorschlag) {
      const ergebnis = dateiWeg(dir, pfad(id, "synthese.md"), pfad(id, "vorschlag.md"));
      const anzahl = uebernommen(lies(id, "synthese.md")).length;
      assert.equal(ergebnis.status, 0, `${id}: ${ergebnis.stderr}`);
      assert.equal(ergebnis.json.ok, false);
      assert.equal(ergebnis.json.gepruefte, anzahl, `${id}: gepruefte`);
      assert.equal(ergebnis.json.ohneBeleg.length, anzahl, `${id}: ohneBeleg.length`);
      for (const b of ergebnis.json.ohneBeleg) {
        assert.equal(b.grund, "beleg-fehlt", `${id}: ${b.fund.slice(0, 60)}`);
        assert.deepEqual(Object.keys(b).sort(), ["fund", "grund", "reviewer"]);
      }
    }
  });
});

test("[board-3] eine entfernte Belegstelle ergibt genau einen zitat-nicht-gefunden", async () => {
  await mitProjekt(async (dir) => {
    for (const id of mitVorschlag) {
      const synthese = lies(`${id}-aufbereitet`, "synthese.md");
      const ziel = uebernommen(synthese).find((p) => !p.gestrichen && p.zitat);
      assert.ok(ziel, `${id}-aufbereitet: kein Punkt mit Zitat`);
      const beschnitten = join(dir, "vorschlag-ohne-beleg.md");
      writeFileSync(beschnitten, lies(`${id}-aufbereitet`, "vorschlag.md").replace(ziel.zitat, ""));

      const ergebnis = dateiWeg(dir, pfad(`${id}-aufbereitet`, "synthese.md"), beschnitten);
      assert.equal(ergebnis.status, 0, ergebnis.stderr);
      assert.equal(ergebnis.json.ok, false);
      assert.equal(ergebnis.json.ohneBeleg.length, 1, `${id}-aufbereitet: nicht genau ein Befund`);
      assert.equal(ergebnis.json.ohneBeleg[0].grund, "zitat-nicht-gefunden");
      assert.equal(ergebnis.json.ohneBeleg[0].fund, ziel.fund);
    }
  });
});

// Die fuenf Karten ohne Body-Vorschlag am Board sind der Nachweis fuer diesen
// Grund: Ihre vorschlag.md ist leer, und eine leere Datei ist kein Vorschlag.
test("[board-3] die Fixtures ohne Body-Vorschlag melden je uebernommen-Punkt vorschlag-fehlt", async () => {
  await mitProjekt(async (dir) => {
    assert.deepEqual(ohneVorschlag, ["579", "580", "583", "584", "585"]);
    for (const id of ohneVorschlag) {
      const ergebnis = dateiWeg(dir, pfad(id, "synthese.md"), pfad(id, "vorschlag.md"));
      const punkte = uebernommen(lies(id, "synthese.md"));
      assert.equal(ergebnis.status, 0, `${id}: ${ergebnis.stderr}`);
      assert.equal(ergebnis.json.ok, false);
      assert.equal(ergebnis.json.gepruefte, punkte.length, `${id}: gepruefte`);
      assert.deepEqual(
        ergebnis.json.ohneBeleg.map((b) => b.grund),
        punkte.map(() => "vorschlag-fehlt"),
        `${id}: Gruende`
      );
      assert.deepEqual(
        ergebnis.json.ohneBeleg.map((b) => b.fund),
        punkte.map((p) => p.fund),
        `${id}: Funde`
      );
    }
  });
});

// Nichts behauptet, nichts zu belegen — auch ohne Vorschlag.
test("[board-3] eine Synthese ohne uebernommen-Punkt ist gruen, auch ohne Vorschlag", async () => {
  await mitProjekt(async (dir) => {
    const synthese = join(dir, "synthese-ohne-uebernahme.md");
    writeFileSync(synthese, [
      "## Synthese, Runde 1",
      "",
      "### Entscheidungen",
      "",
      '- fable, "Ein Fund" — **verworfen**: Begruendung.',
      "",
      "Übernommen: 0 · Verworfen: 1",
      "",
    ].join("\n"));
    const leer = join(dir, "vorschlag-leer.md");
    writeFileSync(leer, "");

    const ergebnis = dateiWeg(dir, synthese, leer);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.deepEqual(ergebnis.json, { ok: true, gepruefte: 0, ohneBeleg: [] });
  });
});

// Der Kopf ist erlaubt, aber nicht gefordert: Interaktiv liegt ein Entwurf vor,
// und der traegt die Kommentar-Ueberschrift nicht notwendig schon.
test("[board-3] der Datei-Weg liest einen Entwurf ohne Kommentarkopf genauso", async () => {
  await mitProjekt(async (dir) => {
    const id = mitVorschlag[0];
    const ohneKopf = (text) => text.split("\n").slice(1).join("\n");
    const synthese = join(dir, "synthese-ohne-kopf.md");
    const vorschlag = join(dir, "vorschlag-ohne-kopf.md");
    writeFileSync(synthese, ohneKopf(lies(`${id}-aufbereitet`, "synthese.md")));
    writeFileSync(vorschlag, ohneKopf(lies(`${id}-aufbereitet`, "vorschlag.md")));

    const ergebnis = dateiWeg(dir, synthese, vorschlag);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.deepEqual(ergebnis.json.ohneBeleg, []);
    assert.equal(ergebnis.json.gepruefte, uebernommen(lies(`${id}-aufbereitet`, "synthese.md")).length);
  });
});

// Ein Vorschlag, der nach dem Kopf keine nicht leere Zeile hat, ist kein Vorschlag.
test("[board-3] eine vorschlag.md mit nur dem Kopf gilt als fehlend", async () => {
  await mitProjekt(async (dir) => {
    const id = mitVorschlag[0];
    const nurKopf = join(dir, "vorschlag-nur-kopf.md");
    writeFileSync(nurKopf, "## Body-Vorschlag, Runde 1\n\n");

    const ergebnis = dateiWeg(dir, pfad(`${id}-aufbereitet`, "synthese.md"), nurKopf);
    assert.equal(ergebnis.json.ok, false);
    assert.ok(ergebnis.json.ohneBeleg.length > 0);
    for (const b of ergebnis.json.ohneBeleg) assert.equal(b.grund, "vorschlag-fehlt");
  });
});

// --- Board-Weg ---

test("[board-3] geprueft wird das zuletzt stehende Runde-1-Paar, nicht das erste", async () => {
  const id = mitVorschlag[0];
  const vorschlag = lies(`${id}-aufbereitet`, "vorschlag.md");
  const kommentare = [
    kommentar(vorschlag),
    kommentar(lies(`${id}-aufbereitet`, "synthese.md")),
    kommentar(vorschlag),
    kommentar(lies(id, "synthese.md")),
  ];
  await mitBoard([karte(7)], async (dir) => {
    const ergebnis = await boardWeg(dir, 7);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(ergebnis.json.ok, false, "das erste (belegte) Paar wurde geprueft");
    const anzahl = uebernommen(lies(id, "synthese.md")).length;
    assert.equal(ergebnis.json.gepruefte, anzahl);
    for (const b of ergebnis.json.ohneBeleg) assert.equal(b.grund, "beleg-fehlt");
  }, { kommentare });
});

// Ein Regex `^##\s*Synthese\b` traefe auch diesen Kommentar (Bindestrich ist
// Wortgrenze) — der Abgleich wuerde sich selbst pruefen, keine uebernommen-Zeile
// finden und gruen melden. Nachts faellt das niemandem auf.
test("[board-3] ein Synthese-Abgleich hinter der Synthese verdraengt sie nicht", async () => {
  const id = mitVorschlag[0];
  const kommentare = [
    kommentar(lies(`${id}-aufbereitet`, "vorschlag.md")),
    kommentar(lies(`${id}-aufbereitet`, "synthese.md")),
    kommentar("## Synthese-Abgleich, Runde 1\n\nAlle Uebernahmen belegt.\n"),
  ];
  await mitBoard([karte(7)], async (dir) => {
    const ergebnis = await boardWeg(dir, 7);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.ok(ergebnis.json.gepruefte > 0, "der Abgleich wurde statt der Synthese geprueft");
    assert.equal(ergebnis.json.gepruefte, uebernommen(lies(`${id}-aufbereitet`, "synthese.md")).length);
    assert.deepEqual(ergebnis.json.ohneBeleg, []);
  }, { kommentare });
});

test("[board-3] ein Vorschlag nach der juengsten Synthese zaehlt nicht als deren Vorschlag", async () => {
  const id = mitVorschlag[0];
  const kommentare = [
    kommentar(lies(`${id}-aufbereitet`, "synthese.md")),
    kommentar(lies(`${id}-aufbereitet`, "vorschlag.md")),
  ];
  await mitBoard([karte(7)], async (dir) => {
    const ergebnis = await boardWeg(dir, 7);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(ergebnis.json.ok, false);
    assert.ok(ergebnis.json.ohneBeleg.length > 0);
    for (const b of ergebnis.json.ohneBeleg) assert.equal(b.grund, "vorschlag-fehlt");
  }, { kommentare });
});

test("[board-3] ein Vorschlag mit anderer Rundennummer paart nicht", async () => {
  const id = mitVorschlag[0];
  const vorschlag = lies(`${id}-aufbereitet`, "vorschlag.md")
    .replace("## Body-Vorschlag, Runde 1", "## Body-Vorschlag, Runde 2");
  const kommentare = [kommentar(vorschlag), kommentar(lies(`${id}-aufbereitet`, "synthese.md"))];
  await mitBoard([karte(7)], async (dir) => {
    const ergebnis = await boardWeg(dir, 7);
    assert.equal(ergebnis.json.ok, false);
    for (const b of ergebnis.json.ohneBeleg) assert.equal(b.grund, "vorschlag-fehlt");
  }, { kommentare });
});

test("[board-3] eine Karte ohne Synthese-Kommentar ist gruen", async () => {
  const kommentare = [kommentar("## Issue-Review, Runde 1\n\nEin Befund.\n")];
  await mitBoard([karte(7)], async (dir) => {
    const ergebnis = await boardWeg(dir, 7);
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.deepEqual(ergebnis.json, { ok: true, gepruefte: 0, ohneBeleg: [] });
  }, { kommentare });
});

// --- Abgewiesene Aufrufe ---

test("[board-3] ein abgewiesener Aufruf traegt JSON auf stdout, die Meldung auf stderr und Exit 1", async () => {
  await mitProjekt(async (dir) => {
    const faelle = [
      { name: "gar keine Eingabe", argv: [] },
      { name: "nur --synthese-file", argv: ["--synthese-file", pfad("587", "synthese.md")] },
      { name: "nur --vorschlag-file", argv: ["--vorschlag-file", pfad("587", "vorschlag.md")] },
      { name: "beide Wege zugleich", argv: ["7", "--synthese-file", pfad("587", "synthese.md"), "--vorschlag-file", pfad("587", "vorschlag.md")] },
      { name: "--synthese-file ohne Pfad", argv: ["--synthese-file", "--vorschlag-file", pfad("587", "vorschlag.md")] },
    ];
    for (const fall of faelle) {
      const res = runBoard(dir, ["issue-review", "synthese-check", ...fall.argv]);
      assert.equal(res.status, 1, `${fall.name}: Exit ${res.status}`);
      const json = JSON.parse(res.stdout);
      assert.equal(json.ok, false, fall.name);
      assert.equal(json.gepruefte, 0, fall.name);
      assert.deepEqual(json.ohneBeleg, [], fall.name);
      assert.match(json.fehler, /--synthese-file/, fall.name);
      assert.match(json.fehler, /--vorschlag-file/, fall.name);
      assert.match(json.fehler, /Kartennummer/, fall.name);
      assert.ok(res.stderr.includes(json.fehler), `${fall.name}: Meldung fehlt auf stderr`);
    }
  });
});

test("[board-3] eine nicht lesbare Datei wird als Aufruf abgewiesen, nicht als Befund", async () => {
  await mitProjekt(async (dir) => {
    const fehlt = join(dir, "gibt-es-nicht.md");
    const res = runBoard(dir, ["issue-review", "synthese-check", "--synthese-file", fehlt, "--vorschlag-file", pfad("587", "vorschlag.md")]);
    assert.equal(res.status, 1);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.deepEqual(json.ohneBeleg, []);
    assert.match(json.fehler, /gibt-es-nicht\.md/);
    assert.ok(res.stderr.includes(json.fehler));
  });
});

test("[board-3] eine Kartennummer, die es am Board nicht gibt, wird abgewiesen", async () => {
  await mitBoard([karte(7)], async (dir) => {
    const res = await runBoardAsync(dir, ["issue-review", "synthese-check", "4711"], MIT_TOKEN);
    assert.equal(res.status, 1, res.stderr);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.gepruefte, 0);
    assert.deepEqual(json.ohneBeleg, []);
    assert.match(json.fehler, /4711/);
    assert.ok(res.stderr.includes(json.fehler));
  });
});

// --- HELP ---

test("[board-3] --help nennt beide Aufrufformen des Kommandos", async () => {
  await mitProjekt(async (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /issue-review synthese-check <id>/);
    assert.match(res.stdout, /issue-review synthese-check --synthese-file <pfad> --vorschlag-file <pfad>/);
  });
});
