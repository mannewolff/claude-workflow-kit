// Der Hinweis auf Pruefkommandos, die jedem Bereich zugeordnet sind (Issue #1214, Plan #1199,
// E13, Fachplan #1198, Kriterium 11).
//
// Das Urteil `hervorgehoben` gilt je Bereich. Eine schwere Suite eines Projekts zeigt sich
// aber am Kommando: Nennt es alle oder alle bis auf einen Bereich, laeuft es bei jeder
// Aenderung. Dafuer gibt es ein eigenes Urteil je Kommando (`breit`) und im Block
// `Fuer den Abschlussbericht:` eine Hinweiszeile — ausser die Breite ist ueber
// `gekoppelteBereiche` begruendet. Im selben Prozess (E6), ueber `helpers/checks-repo.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, checks, datei, git } from "./helpers/checks-repo.mjs";

const HINWEIS = (cmd) =>
  `hinweis: ${cmd} ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs bereiche)`;

/** Erfolgreicher Aufruf mit JSON-Ausgabe. */
function json(dir, ...args) {
  const res = checks(dir, ...args);
  assert.equal(res.status, 0, `checks.mjs ${args.join(" ")} schlug fehl (${res.status}): ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Der Block `Fuer den Abschlussbericht:` eines `run`, Zeile fuer Zeile. */
async function berichtsblock(dir) {
  const res = await checks(dir, "run");
  assert.equal(res.status, 0, `checks.mjs run schlug fehl (${res.status}): ${res.stdout}${res.stderr}`);
  const ab = res.stdout.indexOf("Fuer den Abschlussbericht:");
  assert.ok(ab >= 0, `kein Berichtsblock in:\n${res.stdout}`);
  return res.stdout.slice(ab).split("\n");
}

/** Eine Aenderung in `src/`, damit plan und run etwas auszuwaehlen haben. */
function aendern(dir) {
  datei(dir, "src/a.txt", "neu\n");
  git(dir, "add", "-A");
}

function urteil(ausgabe, cmd) {
  const treffer = ausgabe.kommandoUrteile.find((k) => k.cmd === cmd);
  assert.ok(treffer, `Kommando '${cmd}' fehlt im Urteil je Kommando`);
  return treffer;
}

const BEREICHE = { kern: ["src/**"], doku: ["docs/**"], werkzeug: ["tools/**"] };

test("[checks-1214] ein Kommando mit allen Bereichen ist breit und bekommt die Hinweiszeile", async () => {
  const config = {
    buildChecks: [
      { cmd: "echo alles", areas: ["kern", "doku", "werkzeug"] },
      { cmd: "echo kern", areas: ["kern"] },
      { cmd: "echo doku", areas: ["doku"] },
    ],
    checkAreas: BEREICHE,
  };
  await mitRepo({ config }, async (dir) => {
    const ausgabe = json(dir, "bereiche");
    assert.equal(urteil(ausgabe, "echo alles").breit, true);
    assert.equal(urteil(ausgabe, "echo kern").breit, false);
    assert.equal(urteil(ausgabe, "echo doku").breit, false);
    assert.deepEqual([urteil(ausgabe, "echo alles").nennend, urteil(ausgabe, "echo alles").von], [3, 3]);

    aendern(dir);
    assert.deepEqual(json(dir, "plan").zuschnitt, [HINWEIS("echo alles").slice("hinweis: ".length)]);
    const block = await berichtsblock(dir);
    assert.ok(block.includes(HINWEIS("echo alles")), block.join("\n"));
    assert.ok(!block.includes(HINWEIS("echo kern")), "ein schmales Kommando bekommt keine Zeile");
  });
});

test("[checks-1214] ein Kommando mit allen Bereichen bis auf einen ist breit", async () => {
  const config = {
    buildChecks: [
      { cmd: "echo fast", areas: ["kern", "doku"] },
      { cmd: "echo kern", areas: ["kern"] },
      { cmd: "echo werkzeug", areas: ["werkzeug"] },
    ],
    checkAreas: BEREICHE,
  };
  await mitRepo({ config }, async (dir) => {
    assert.equal(urteil(json(dir, "bereiche"), "echo fast").breit, true);
    aendern(dir);
    const block = await berichtsblock(dir);
    assert.ok(block.includes(HINWEIS("echo fast")), block.join("\n"));
  });
});

test("[checks-1214] unter drei bereichsgebundenen Kommandos ist keines breit und es gibt keine Zeile", async () => {
  const config = {
    buildChecks: [
      { cmd: "echo alles", areas: ["kern", "doku", "werkzeug"] },
      { cmd: "echo kern", areas: ["kern"] },
      { cmd: "echo immer", always: true },
      { cmd: "echo push", areas: ["kern", "doku", "werkzeug"], stufe: "push" },
    ],
    checkAreas: BEREICHE,
  };
  await mitRepo({ config }, async (dir) => {
    const ausgabe = json(dir, "bereiche");
    assert.equal(urteil(ausgabe, "echo alles").breit, false);
    assert.equal(ausgabe.kommandoUrteile.length, 2, "nur bereichsgebundene Kommandos der Paketstufe");

    aendern(dir);
    assert.equal(json(dir, "plan").zuschnitt, undefined, "ohne breites Kommando fehlt das Feld");
    const block = await berichtsblock(dir);
    assert.ok(!block.some((z) => z.includes("ist jedem Bereich zugeordnet")), block.join("\n"));
  });
});

test("[checks-1214] ein gekoppelter Bereich mit Grund unterdrueckt die Zeile, das Urteil bleibt", async () => {
  const config = {
    buildChecks: [
      { cmd: "echo alles", areas: ["kern", "doku", "werkzeug"] },
      { cmd: "echo kern", areas: ["kern"] },
      { cmd: "echo doku", areas: ["doku"] },
    ],
    checkAreas: BEREICHE,
    gekoppelteBereiche: [{ bereich: "werkzeug", grund: "Jede Testgruppe laedt das Werkzeug." }],
  };
  await mitRepo({ config }, async (dir) => {
    const alles = urteil(json(dir, "bereiche"), "echo alles");
    assert.equal(alles.breit, true, "die Kopplung ist kein Ausschalter des Urteils");
    assert.equal(alles.kopplungsgrund, "Jede Testgruppe laedt das Werkzeug.");

    aendern(dir);
    assert.equal(json(dir, "plan").zuschnitt, undefined);
    const block = await berichtsblock(dir);
    assert.ok(!block.some((z) => z.includes("ist jedem Bereich zugeordnet")), block.join("\n"));
  });
});

test("[checks-1214] das Urteil hervorgehoben je Bereich bleibt unveraendert", async () => {
  const config = {
    buildChecks: [
      { cmd: "echo alles", areas: ["kern", "doku", "werkzeug"] },
      { cmd: "echo kern", areas: ["kern"] },
      { cmd: "echo doku", areas: ["doku"] },
    ],
    checkAreas: BEREICHE,
  };
  await mitRepo({ config }, async (dir) => {
    const ausgabe = json(dir, "bereiche");
    const je = Object.fromEntries(ausgabe.bereiche.map((b) => [b.name, [b.nennend, b.von, b.hervorgehoben]]));
    // kern und doku stehen in 2 von 3 (alle bis auf eines), werkzeug nur in 1 von 3.
    assert.deepEqual(je, { kern: [2, 3, true], doku: [2, 3, true], werkzeug: [1, 3, false] });
    assert.equal(ausgabe.kommandos, 3);
  });
});
