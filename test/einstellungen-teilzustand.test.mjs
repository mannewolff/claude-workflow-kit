// Entwurf, Vorschau-Timer und Eingabefelder je Teil (Issue #814, einstellungen-19).
//
// Die Oberflaeche haelt ihren Zustand je Teil getrennt: Das Speichern eines Teils
// verwirft nur dessen Entwurf, jede angeforderte Vorschau eines Teils wird geholt, ein
// Projektwechsel raeumt alle Timer ab, und eine eingehende Vorschau nimmt dem gerade
// bearbeiteten Eingabefeld weder Fokus noch Cursor noch halb getippten Text. Belegt wird
// das ausfuehrbar: Das Browser-Skript laeuft im VM-Testrahmen mit Fake-DOM gegen den
// echten Testserver (test/helpers/oberflaeche-vm.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mitServer, projekt, TEAM } from "./helpers/einstellungen-fixture.mjs";
import { oberflaecheStarten } from "./helpers/oberflaeche-vm.mjs";

// buildChecks und ein Bereich, damit M4 ein Kommandofeld, ein Neu-Feld und eine
// Musterliste zeigt; der Kit-Stand entspricht der Oberflaeche, damit das Projekt
// bearbeitbar ist.
const KONFIG = { ...TEAM, checkAreas: { kern: ["kit/**"] } };

async function offenesProjekt(s, name) {
  const seite = await oberflaecheStarten({ basis: s.basis, token: s.token });
  seite.klick(seite.projektKnopf(name));
  await seite.ruhe();
  return seite;
}

test("[einstellungen-19] das Speichern eines Teils laesst den Entwurf des anderen stehen", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: KONFIG, stand: "5.0.0" }), async (s) => {
    const seite = await offenesProjekt(s, "alpha");
    seite.klick(seite.knopf(seite.ids.themen, "Nachtbetrieb"));
    await seite.ruhe();
    const zahlen = (platte) => seite.alle(platte, (e) => e.tagName === "INPUT" && e.type === "number");
    const [m6, m8] = seite.platten();

    // M8 (Aufwand): die Laufzahl aendern — ein Entwurf, der nur in der Arbeitskopie lebt.
    seite.tippe(zahlen(m8)[0], "7");
    // M6 (Nacht-Kette): das Planbudget aendern und genau diesen Teil speichern.
    seite.tippe(zahlen(m6)[0], "25");
    seite.klick(seite.knopf(m6, "Speichern"));
    await seite.ruhe();

    const datei = JSON.parse(readFileSync(join(s.wurzel, "alpha", ".claude", "workflow.config.json"), "utf-8"));
    assert.equal(datei.night?.kette?.planMin, 25, "M6 wurde nicht gespeichert");
    assert.equal(datei.aufwand, undefined, "der Entwurf von M8 wurde mitgespeichert");

    // Der Entwurf von M8 ist noch da: Das Feld zeigt weiter den getippten Wert.
    const [, m8Danach] = seite.platten();
    assert.equal(zahlen(m8Danach)[0].value, "7", "der Aufwand-Entwurf wurde beim Speichern von M6 verworfen");
  });
});

test("[einstellungen-19] jede angeforderte Vorschau eines Teils wird geholt", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: KONFIG, stand: "5.0.0" }), async (s) => {
    const seite = await offenesProjekt(s, "alpha");
    // Die Anforderungen des Startthemas abraeumen, damit nur Review misst.
    seite.feuere();
    await seite.ruhe();

    seite.klick(seite.knopf(seite.ids.themen, "Review"));
    const davor = seite.anfragen.length;
    seite.feuere();
    await seite.ruhe();

    const teile = seite.anfragen
      .slice(davor)
      .filter((a) => a.pfad.endsWith("/vorschau"))
      .map((a) => a.body.teil)
      .sort();
    assert.deepEqual(teile, ["m10", "m2", "m3"], "die Anforderung eines Teils verdraengte die eines anderen");
  });
});

test("[einstellungen-19] ein Projektwechsel raeumt die Timer des alten Projekts ab", async () => {
  const aufbau = (w) => {
    projekt(w, "alpha", { team: KONFIG, stand: "5.0.0" });
    projekt(w, "beta", { team: KONFIG, stand: "5.0.0" });
  };
  await mitServer(aufbau, async (s) => {
    const seite = await offenesProjekt(s, "alpha");
    assert.ok(seite.wartend() > 0, "das Startthema muesste Vorschauen angefordert haben");

    const davor = seite.anfragen.length;
    seite.klick(seite.projektKnopf("beta"));
    // Der Wechsel hat begonnen; was jetzt noch feuert, fragte fuer das alte Projekt.
    seite.feuere();
    await seite.ruhe();

    const alteVorschau = seite.anfragen
      .slice(davor)
      .filter((a) => a.pfad.includes("/vorschau") && a.pfad.includes("alpha"));
    assert.deepEqual(alteVorschau, [], "ein Timer des alten Projekts hat nach dem Wechsel gefeuert");
  });
});

test("[einstellungen-19] die aufgeloeste Vorschau nimmt dem Eingabefeld weder Fokus noch Cursor noch halb getippten Text", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: KONFIG, stand: "5.0.0" }), async (s) => {
    const seite = await offenesProjekt(s, "alpha");
    const [m4] = seite.platten();

    const kommando = seite.alle(m4, (e) => e.tagName === "INPUT" && e.klassen().includes("kommando"))[0];
    seite.tippe(kommando, "node --test --watch", 6);
    // Halb getippter Text in den Neu-Feldern: ein Kommando und ein Muster, beide ohne Enter.
    seite.alle(m4, (e) => e.placeholder === "Kommando hinzufügen …")[0].value = "npx es";
    seite.alle(m4, (e) => e.placeholder === "+ Muster, Enter")[0].value = "tools/**";

    seite.feuere();
    await seite.ruhe();

    const aktiv = seite.dokument.activeElement;
    assert.ok(aktiv instanceof Object && aktiv.tagName === "INPUT" && aktiv.klassen().includes("kommando"), "der Fokus liegt nicht mehr auf dem Kommandofeld");
    assert.equal(aktiv.value, "node --test --watch", "der getippte Wert ging verloren");
    assert.equal(aktiv.selectionStart, 6, "die Cursorposition ging verloren");
    assert.equal(aktiv.selectionEnd, 6, "die Cursorposition ging verloren");

    const [m4Danach] = seite.platten();
    assert.equal(seite.alle(m4Danach, (e) => e.placeholder === "Kommando hinzufügen …")[0].value, "npx es", "das halb getippte Kommando ist weg");
    assert.equal(seite.alle(m4Danach, (e) => e.placeholder === "+ Muster, Enter")[0].value, "tools/**", "das halb getippte Muster ist weg");
  });
});
