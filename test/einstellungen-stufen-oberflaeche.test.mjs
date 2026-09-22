// Der Aufgabenstufen-Redaktor M11 (Issue #847, Plan #843 E7).
//
// `night.stufen` stand bis hierher als JSON-Text im Text-Teil. Der Fachplan #837 verlangt
// eine Auswahl je Stufe ohne JSON-Eingabe (AK 3, PO-Antwort 5) — die Gruendlichkeit aus
// #845 ist ueber einen Textblock nicht zumutbar zu pflegen. Belegt wird das ausfuehrbar:
// Das Browser-Skript laeuft im VM-Testrahmen mit Fake-DOM gegen den echten Testserver
// (test/helpers/oberflaeche-vm.mjs), wie schon bei M3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pruefe, TEILE } from "../kit/einstellungen.mjs";
import { mitServer, projekt, TEAM } from "./helpers/einstellungen-fixture.mjs";
import { oberflaecheStarten } from "./helpers/oberflaeche-vm.mjs";

const MODELLE = ["claude-opus-5", "claude-sonnet-5"];

/** Die Team-Config dieses Tests: die Modellliste und optional ein Stufenblock. */
const teamMit = (stufen) => ({ ...TEAM, night: { modelle: [...MODELLE], ...(stufen ? { stufen } : {}) } });

function konfig(s, name = "alpha") {
  return JSON.parse(readFileSync(join(s.wurzel, name, ".claude", "workflow.config.json"), "utf-8"));
}

/** Oeffnet das Projekt und stellt auf das Thema Nachtbetrieb — dort steht M11. */
async function nachtThema(s, name = "alpha") {
  const seite = await oberflaecheStarten({ basis: s.basis, token: s.token });
  seite.klick(seite.projektKnopf(name));
  await seite.ruhe();
  seite.klick(seite.knopf(seite.ids.themen, "Nachtbetrieb"));
  // Die Vorschau-Anforderungen des Aufbaus abraeumen, damit ein Test nur seine eigene misst.
  seite.feuere();
  await seite.ruhe();
  return seite;
}

/** Die Platte von M11 und ihre drei Bloecke in der Reihenfolge schwer, mittel, leicht. */
function stufenTeil(seite) {
  const titel = TEILE.find((t) => t.kennung === "m11").titel;
  const platte = seite.platten().find((p) => seite.alle(p, (e) => e.klassen().includes("platte-pfad"))[0].textContent === titel);
  assert.ok(platte, `der Teil '${titel}' steht nicht im Thema Nachtbetrieb`);
  return { platte, bloecke: seite.alle(platte, (e) => e.klassen().includes("stufe")) };
}

const wahlKnopf = (seite, block, text) => seite.alle(block, (e) => e.tagName === "BUTTON" && e.textContent === text)[0];
const auswahlen = (seite, block) => seite.alle(block, (e) => e.tagName === "SELECT");
const felder = (seite, block) => seite.alle(block, (e) => e.tagName === "INPUT");

/** Waehlt in einem Select und loest das change-Ereignis aus, wie ein Mensch es tut. */
function waehle(sel, wert) {
  sel.value = wert;
  sel.ausloesen("change");
}

async function speichere(seite, platte) {
  seite.klick(seite.knopf(platte, "Speichern"));
  await seite.ruhe();
}

test("[einstellungen-21] der Teil Aufgabenstufen steht unter Nachtbetrieb mit einem Block je Stufe", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: teamMit({ schwer: { modell: "claude-opus-5" } }), stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const { platte, bloecke } = stufenTeil(seite);

    assert.equal(bloecke.length, 3, "der Teil zeichnet nicht drei Bloecke");
    assert.deepEqual(
      bloecke.map((b) => seite.alle(b, (e) => e.tagName === "H4")[0].textContent),
      ["Schwer", "Mittel", "Leicht"],
    );
    // Der Pfad steht am Block: Ein Befund zu night.stufen.<stufe> findet darueber seine Zeile.
    assert.deepEqual(
      bloecke.map((b) => seite.alle(b, (e) => e.dataset.pfad !== undefined)[0].dataset.pfad),
      ["night.stufen.schwer", "night.stufen.mittel", "night.stufen.leicht"],
    );
    assert.ok(platte.textContent.includes("keine offene Änderung"), "das Zeichnen hat eine Aenderung angelegt");
  });
});

test("[einstellungen-21] night.stufen steht nicht mehr als JSON-Text da", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: teamMit({ leicht: { modell: "claude-sonnet-5" } }), stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const textPlatten = seite.platten().filter((p) => seite.alle(p, (e) => e.tagName === "TEXTAREA").length > 0);
    for (const p of textPlatten) {
      assert.equal(
        seite.alle(p, (e) => e.dataset.pfad === "night.stufen").length,
        0,
        "night.stufen hat noch eine Eingabe in Dateischreibweise",
      );
    }
  });
});

test("[einstellungen-21] eine Gruendlichkeit waehlen und speichern schreibt ein gueltiges effort", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: teamMit({ schwer: { modell: "claude-opus-5" } }), stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const { platte, bloecke } = stufenTeil(seite);

    const [modell, gruendlichkeit] = auswahlen(seite, bloecke[0]);
    assert.equal(modell.value, "claude-opus-5", "die Modellwahl zeigt den Bestand nicht");
    assert.equal(gruendlichkeit.value, "", "ohne effort steht die Voreinstellung nicht da");
    waehle(gruendlichkeit, "high");
    await speichere(seite, platte);

    const datei = konfig(s);
    assert.deepEqual(datei.night.stufen.schwer, { modell: "claude-opus-5", effort: "high" });
    assert.deepEqual(pruefe(datei, null).filter((b) => b.art === "fehler"), [], "der geschriebene Stand ist fehlerhaft");
  });
});

test("[einstellungen-21] Voreinstellung entfernt das Feld effort wieder", async () => {
  const team = teamMit({ mittel: { modell: "claude-sonnet-5", effort: "medium" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const { platte, bloecke } = stufenTeil(seite);

    const [, gruendlichkeit] = auswahlen(seite, bloecke[1]);
    assert.equal(gruendlichkeit.value, "medium", "die vorhandene Gruendlichkeit steht nicht in der Auswahl");
    waehle(gruendlichkeit, "");
    await speichere(seite, platte);

    assert.deepEqual(konfig(s).night.stufen.mittel, { modell: "claude-sonnet-5" });
  });
});

test("[einstellungen-21] der Wechsel zu Kommando entfernt modell und effort", async () => {
  const team = teamMit({ leicht: { modell: "claude-sonnet-5", effort: "low" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const seite1 = stufenTeil(seite);

    seite.klick(wahlKnopf(seite, seite1.bloecke[2], "Kommando"));
    const nach = stufenTeil(seite).bloecke[2];
    assert.equal(auswahlen(seite, nach).length, 0, "nach dem Wechsel steht noch eine Modell- oder Gruendlichkeitswahl da");
    const [kommando, name] = felder(seite, nach);
    seite.tippe(kommando, "mein-runner");
    seite.tippe(name, "Mein Runner");
    await speichere(seite, stufenTeil(seite).platte);

    assert.deepEqual(konfig(s).night.stufen.leicht, { kommando: "mein-runner", name: "Mein Runner" });
  });
});

test("[einstellungen-21] eine bestehende Kommando-Stufe wird richtig geladen", async () => {
  const team = teamMit({ schwer: { kommando: "fremdes-programm --tu-was", name: "Fremdes Programm" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const { platte, bloecke } = stufenTeil(seite);

    assert.equal(wahlKnopf(seite, bloecke[0], "Kommando").getAttribute("aria-selected"), "true");
    assert.equal(wahlKnopf(seite, bloecke[0], "Modell").getAttribute("aria-selected"), "false");
    assert.deepEqual(felder(seite, bloecke[0]).map((f) => f.value), ["fremdes-programm --tu-was", "Fremdes Programm"]);
    assert.equal(auswahlen(seite, bloecke[0]).length, 0, "die Kommando-Stufe zeigt eine Modellwahl");
    // Die beiden anderen Stufen sind leer und schreiben nichts.
    assert.equal(wahlKnopf(seite, bloecke[1], "Keine").getAttribute("aria-selected"), "true");
    assert.ok(platte.textContent.includes("keine offene Änderung"), "das Laden hat eine Aenderung angelegt");
  });
});

test("[einstellungen-21] eine Stufe auf Keine stellen entfernt ihren Eintrag", async () => {
  const team = teamMit({ schwer: { modell: "claude-opus-5" }, leicht: { modell: "claude-sonnet-5" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);

    seite.klick(wahlKnopf(seite, stufenTeil(seite).bloecke[0], "Keine"));
    await speichere(seite, stufenTeil(seite).platte);

    // Nur die bearbeitete Stufe faellt weg; was der Mensch nicht angefasst hat, bleibt stehen.
    assert.deepEqual(konfig(s).night.stufen, { leicht: { modell: "claude-sonnet-5" } });
  });
});

test("[einstellungen-21] ein Befund der Konfigurationspruefung steht am Block seiner Stufe", async () => {
  // Der Wechsel zu Kommando laesst das Feld zunaechst leer — das Schema weist das ab. Der
  // Grund gehoert an die Zeile, die ihn ausgeloest hat, nicht in den Fuss des Teils.
  const team = teamMit({ schwer: { modell: "claude-opus-5" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);

    seite.klick(wahlKnopf(seite, stufenTeil(seite).bloecke[0], "Kommando"));
    seite.feuere();
    await seite.ruhe();

    const stelle = seite.alle(stufenTeil(seite).bloecke[0], (e) => e.dataset.pfad === "night.stufen.schwer")[0];
    assert.match(stelle.querySelector(".befunde").textContent, /mindestens 1 Zeichen/, "der Befund steht nicht am Block der Stufe");
    assert.ok(stelle.querySelector(".zeile").klassen().includes("zeile-warn"), "die Zeile der Stufe ist nicht markiert");
  });
});

test("[einstellungen-21] ein Modell, das night.modelle nicht kennt, bleibt waehlbar und wird benannt", async () => {
  // Kriterium 4a sinngemaess: Der Bestand springt nicht still auf das erste Modell. Der
  // Befund stand schon in der Datei und steht deshalb am Teil, nicht an der Zeile.
  const team = teamMit({ mittel: { modell: "claude-unbekannt" } });
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await nachtThema(s);
    const { platte, bloecke } = stufenTeil(seite);

    assert.equal(auswahlen(seite, bloecke[1])[0].value, "claude-unbekannt", "die Modellwahl zeigt den Bestand nicht");
    assert.match(platte.textContent, /night\.stufen\.mittel\.modell/, "der Altbefund steht nicht am Teil");
    assert.ok(platte.textContent.includes("keine offene Änderung"), "das Zeichnen hat eine Aenderung angelegt");
  });
});
