// Der Pruefstufen-Redaktor M3 gegen einen fehlerhaften Bestand (Issue #815,
// einstellungen-20).
//
// Drei Funde des Reviews v2.0.0..HEAD, alle im selben Redaktor: Ein Bestand ohne `rollen`
// riss den Aufbau des Themas Review ab, die erste Aenderung ohne vorhandenen
// `reviewStufen`-Block schrieb der bearbeiteten Stufe die Bestandsvorgabe statt ihrer
// Katalogrollen zu, und ein Befund des Servers fand keine Zeile, weil die Stufe ihren Pfad
// nicht nannte. Belegt wird das ausfuehrbar: Das Browser-Skript laeuft im VM-Testrahmen mit
// Fake-DOM gegen den echten Testserver (test/helpers/oberflaeche-vm.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pruefe, ROLLEN_KATALOG } from "../kit/einstellungen.mjs";
import { mitServer, projekt, TEAM } from "./helpers/einstellungen-fixture.mjs";
import { oberflaecheStarten } from "./helpers/oberflaeche-vm.mjs";

/** Ein vollstaendiger, gueltiger Block: jede Stufe mit ihren Katalogrollen. */
const KATALOG_BLOCK = Object.fromEntries(
  Object.entries(ROLLEN_KATALOG).map(([stufe, rollen]) => [stufe, { reviewer: rollen.length, rollen: [...rollen] }]),
);

/** Oeffnet das Projekt und stellt auf das Thema Review — dort stehen M1 bis M3. */
async function reviewThema(s, name = "alpha") {
  const seite = await oberflaecheStarten({ basis: s.basis, token: s.token });
  seite.klick(seite.projektKnopf(name));
  await seite.ruhe();
  seite.klick(seite.knopf(seite.ids.themen, "Review"));
  // Die Vorschau-Anforderungen des Aufbaus abraeumen, damit ein Test nur seine eigene misst.
  seite.feuere();
  await seite.ruhe();
  return seite;
}

/** Die Platte von M3 und ihre drei Stufen in der Reihenfolge fachlich, plan, issue. */
function stufen(seite) {
  const m3 = seite.platten()[2];
  return { m3, plaetze: seite.alle(m3, (e) => e.klassen().includes("stufe")) };
}

function konfig(s, name = "alpha") {
  return JSON.parse(readFileSync(join(s.wurzel, name, ".claude", "workflow.config.json"), "utf-8"));
}

test("[einstellungen-20] eine Stufe ohne rollen bricht das Thema Review nicht ab", async () => {
  const team = { ...TEAM, reviewStufen: { ...KATALOG_BLOCK, plan: { reviewer: 1 } } };
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await reviewThema(s);
    const { m3, plaetze } = stufen(seite);

    // Das Thema baut vollstaendig auf: M3 steht da, und die Teile danach ebenso.
    const titel = seite.platten().map((p) => seite.alle(p, (e) => e.klassen().includes("platte-pfad"))[0].textContent);
    assert.deepEqual(titel.slice(0, 3), ["Reviewer", "Paarungen", "Prüfstufen"], "die Teile des Themas Review fehlen");
    assert.ok(titel.length > 3, "nach M3 bricht der Aufbau des Themas ab");
    assert.deepEqual(
      plaetze.map((p) => seite.alle(p, (e) => e.tagName === "H4")[0].textContent),
      ["Fachplan", "Plan", "Arbeitspaket"],
      "M3 zeichnet nicht alle drei Stufen",
    );
    // Der Altfehler steht markiert da, statt den Aufbau abzureissen (Plan E6).
    assert.ok(m3.textContent.includes("reviewStufen.plan.rollen: fehlt"), "der Befund zur Stufe fehlt an M3");
  });
});

test("[einstellungen-20] die Anzeige einer Stufe ohne rollen aendert den gespeicherten Wert nicht", async () => {
  const team = { ...TEAM, reviewStufen: { ...KATALOG_BLOCK, plan: { reviewer: 1 } } };
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await reviewThema(s);
    const { m3 } = stufen(seite);

    // Geglaettet wird nur fuer die Darstellung: Der Teil hat nichts Offenes, und die Datei
    // traegt den Bestand unveraendert weiter.
    assert.ok(m3.textContent.includes("keine offene Änderung"), "das Zeichnen hat eine Aenderung angelegt");
    assert.deepEqual(konfig(s).reviewStufen.plan, { reviewer: 1 }, "die Datei wurde beim Zeichnen veraendert");
  });
});

test("[einstellungen-20] die erste Aenderung ohne reviewStufen-Block legt auch die bearbeitete Stufe mit ihren Katalogrollen an", async () => {
  await mitServer((w) => projekt(w, "alpha", { stand: "5.0.0" }), async (s) => {
    const seite = await reviewThema(s);
    const { m3, plaetze } = stufen(seite);

    // Die Stufe issue von der Bestandsvorgabe (2 Pruefer) auf einen Pruefer stellen.
    seite.klick(seite.alle(plaetze[2], (e) => e.tagName === "BUTTON" && e.textContent === "−")[0]);
    seite.klick(seite.knopf(m3, "Speichern"));
    await seite.ruhe();

    const datei = konfig(s);
    assert.deepEqual(datei.reviewStufen.issue, { reviewer: 1, rollen: [...ROLLEN_KATALOG.issue] }, "die bearbeitete Stufe traegt nicht ihre Katalogrollen");
    assert.deepEqual(pruefe(datei, {}).filter((b) => b.art === "fehler"), [], "die erste Aenderung hat einen Fehler geschrieben");
  });
});

test("[einstellungen-20] ein Befund des Servers zu einer Stufe steht an ihrer Zeile", async () => {
  const team = { ...TEAM, reviewStufen: KATALOG_BLOCK };
  await mitServer((w) => projekt(w, "alpha", { team, stand: "5.0.0" }), async (s) => {
    const seite = await reviewThema(s);
    const { plaetze } = stufen(seite);

    // Dieselbe Rolle zweimal — ueber das Select moeglich, vom Server abgelehnt.
    const zweite = seite.alle(plaetze[1], (e) => e.tagName === "SELECT")[1];
    zweite.value = ROLLEN_KATALOG.plan[0];
    zweite.ausloesen("change");
    seite.feuere();
    await seite.ruhe();

    const stelle = seite.alle(stufen(seite).m3, (e) => e.dataset.pfad === "reviewStufen.plan")[0];
    assert.ok(stelle, "die Stufe plan nennt ihren Pfad nicht");
    assert.match(stelle.querySelector(".befunde").textContent, /nennt einen Eintrag doppelt/, "der Befund steht nicht im Behaelter der Stufe");
    assert.ok(stelle.querySelector(".zeile").klassen().includes("zeile-warn"), "die Zeile der Stufe ist nicht markiert");
  });
});
