// Der Anker und die Randfaelle um ihn herum (Issue #423).
//
// Welcher Anker fachlich richtig ist, entscheidet der Aufrufer. Was passiert,
// wenn der uebergebene Anker nicht taugt, entscheidet dieses Kommando — und zwar
// immer zugunsten von mehr Pruefung. Der teuerste Fall steht mittendrin: ein
// leerer `--since`-Wert. Er entsteht im /local-check-Skill, wenn die
// merge-base-Substitution fehlschlaegt. Wuerde er als "nicht angegeben" gelesen,
// griffe der Default HEAD, und auf sauberem, committetem Tree liefe keine
// einzige Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mitRepo, plan, checks, datei, git, kommandos, CHECKS } from "./helpers/checks-repo.mjs";

const CONFIG = {
  buildChecks: [
    { cmd: "npm run build", areas: ["frontend"] },
    { cmd: "mvn verify", areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
};

test("ein committetes Paket gilt mit --since auf den Stand davor nicht als leer", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const davor = git(dir, "rev-parse", "HEAD");
    datei(dir, "frontend/src/App.tsx");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "Arbeitspaket");

    const ergebnis = plan(dir, "--since", davor);

    assert.equal(ergebnis.leeresPaket, false, "die committete Aenderung wurde nicht gesehen");
    assert.deepEqual(ergebnis.geaendert, ["frontend/src/App.tsx"]);
    assert.deepEqual(ergebnis.bereiche, ["frontend"]);
    assert.deepEqual(kommandos(ergebnis.laufen), ["npm run build"]);
    assert.ok(davor.startsWith(ergebnis.basis), `basis ${ergebnis.basis} zeigt nicht auf ${davor}`);
  });
});

test("ohne --since ist HEAD der Anker: der Commit selbst zaehlt dann nicht mehr", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "Arbeitspaket");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, true);
  });
});

test("ein nicht aufloesbarer Anker zieht den vollen Umfang", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir, "--since", "gibtsnicht");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.equal(ergebnis.leeresPaket, false);
    assert.equal(ergebnis.basis, "gibtsnicht", "basis traegt den uebergebenen Ref-Text nicht");
    assert.deepEqual(kommandos(ergebnis.laufen).sort(), ["mvn verify", "npm run build"]);
    for (const e of ergebnis.laufen) {
      assert.match(e.grund, /gibtsnicht/, `Grund nennt den Anker nicht: ${e.grund}`);
    }
  });
});

test("ein leerer Anker gilt wie ein nicht aufloesbarer, nie wie ein fehlender", () => {
  // Sauberer, committeter Tree: Mit dem Default HEAD waere das Ergebnis
  // leeresPaket und keine Pruefung — genau der stille Ausfall aus Issue #427.
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir, "--since", "");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.equal(ergebnis.leeresPaket, false);
    assert.deepEqual(kommandos(ergebnis.laufen).sort(), ["mvn verify", "npm run build"]);
  });
});

test("fehlende Config endet mit Exit ungleich 0", () => {
  // Ein Kommando, das ohne Config stillschweigend "nichts zu pruefen" meldet,
  // zeigt in die unsichere Richtung.
  mitRepo({ ohneConfig: true }, (dir) => {
    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /workflow\.config\.json/);
    assert.equal(res.stdout.trim(), "", "ohne Config darf kein JSON-Ergebnis entstehen");
  });
});

test("die Nutzungshilfe laeuft in einem leeren Verzeichnis ohne Config und ohne Repo", () => {
  // Das Kit liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus:
  // die Datei allein, ohne Repo-Kontext, muss antworten koennen.
  const dir = mkdtempSync(join(tmpdir(), "checks-nackt-"));
  try {
    const kopie = join(dir, "checks.mjs");
    copyFileSync(CHECKS, kopie);
    for (const cliArgs of [[], ["--help"], ["-h"]]) {
      const res = spawnSync(process.execPath, [kopie, ...cliArgs], { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `checks.mjs ${cliArgs.join(" ")} endete mit ${res.status}: ${res.stderr}`);
      assert.match(res.stdout, /plan/, "die Nutzungshilfe nennt das Unterkommando nicht");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
