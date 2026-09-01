// Der Zweifelsfall (Issue #423).
//
// Eine Auswahl, die falsch ausfaellt, nimmt Pruefung weg — der Fehler geht in die
// unsichere Richtung und faellt niemandem auf. Deshalb gibt es genau eine
// Richtung, in die dieses Kommando im Zweifel irrt: mehr pruefen. Hier stehen
// die Faelle, in denen das greifen muss — eine Datei ohne passendes Muster, eine
// Loeschung, eine Umbenennung — und der eine Fall, der gar nicht erst laufen
// darf: ein vertippter Bereichsname.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, plan, checks, datei, git, eintrag, kommandos } from "./helpers/checks-repo.mjs";

const CONFIG = {
  buildChecks: [
    "npx eslint .",
    { cmd: "npm run build", areas: ["frontend"] },
    { cmd: "mvn verify", areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
};

test("eine Datei ohne passendes Muster zieht den vollen Umfang und nennt sich beim Namen", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "docs/neu.md");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ausgelassen, [], "im vollen Umfang wird nichts ausgelassen");
    assert.deepEqual(kommandos(ergebnis.laufen).sort(), ["mvn verify", "npm run build", "npx eslint ."]);
    // Ohne den Dateinamen ist das Signal wertlos: Man weiss, dass alles laeuft,
    // aber nicht, welches Muster fehlt.
    for (const e of ergebnis.laufen) {
      assert.match(e.grund, /docs\/neu\.md/, `Grund nennt die ausloesende Datei nicht: ${e.grund}`);
    }
  });
});

test("eine nicht zugeordnete Pruefung laeuft auch im Regelfall mit", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.ok(kommandos(ergebnis.laufen).includes("npx eslint ."));
    assert.match(eintrag(ergebnis.laufen, "npx eslint .").grund, /nicht zugeordnet/);
  });
});

test("eine geloeschte Datei zaehlt als Aenderung", () => {
  // Eine geloeschte Datei richtet oft mehr an als eine geaenderte.
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "backend/src/Service.java");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "Service");
    rmSync(join(dir, "backend", "src", "Service.java"));

    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, false);
    assert.deepEqual(ergebnis.geaendert, ["backend/src/Service.java"]);
    assert.deepEqual(ergebnis.bereiche, ["backend"]);
    assert.ok(kommandos(ergebnis.laufen).includes("mvn verify"));
  });
});

test("eine Umbenennung zaehlt mit beiden Pfaden", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/alt.tsx", "export const x = 1;\n");
    datei(dir, "backend/.keep", "");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "alt");
    git(dir, "mv", "frontend/alt.tsx", "backend/neu.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.geaendert.sort(), ["backend/neu.tsx", "frontend/alt.tsx"]);
    assert.deepEqual(ergebnis.bereiche, ["backend", "frontend"]);
    assert.deepEqual(kommandos(ergebnis.laufen).sort(), ["mvn verify", "npm run build", "npx eslint ."]);
    assert.equal(ergebnis.vollerUmfang, false);
  });
});

test("ein unbekannter Bereichsname endet mit Exit ungleich 0 und nennt die bekannten Schluessel", () => {
  const config = {
    buildChecks: [{ cmd: "npm run build", areas: ["frontnend"] }],
    checkAreas: CONFIG.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0, "ein Tippfehler im Bereichsnamen darf nicht durchgehen");
    assert.match(res.stderr, /frontnend/, "die Meldung nennt den unbekannten Namen nicht");
    assert.match(res.stderr, /frontend/, "die Meldung nennt die bekannten Schluessel nicht");
    assert.match(res.stderr, /backend/);
  });
});
