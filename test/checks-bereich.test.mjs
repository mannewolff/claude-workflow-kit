// Die Dateien ohne Zuordnung und der Bereichslauf (Issue #922, Plan #917).
//
// Zwei Stuecke, die beide an der Bereichsachse haengen:
//
//   - `ohneZuordnung` sammelt JEDE geaenderte Datei, die kein Muster trifft
//     (Kriterium 9 der fachlichen Quelle #913). Der Grund-Text nennt weiter nur
//     die erste — er ist Text fuer Menschen und wird anderswo woertlich gelesen,
//     also darf er sich nicht mitbewegen. Beides zusammen ist der Punkt: Der
//     Beobachter braucht die volle Liste als Daten, ohne einen Satz zu parsen.
//   - `--bereich <name>` ist der sanktionierte Weg fuer den notwendigen
//     Gruppenlauf. Ohne ihn liesse sich am Lauf nicht ablesen, ob jemand die
//     Auswahl umgangen hat oder ob fuer die geaenderte Datei nur die ganze
//     Gruppe existiert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, plan, run, checks, datei, git, kommandos, eintrag, zusammenfassung } from "./helpers/checks-repo.mjs";

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

test("jede Datei ohne Muster steht in ohneZuordnung und im Grund (Issue #1003)", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "a-ohne-muster.txt");
    datei(dir, "b-ohne-muster.txt");
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ohneZuordnung, ["a-ohne-muster.txt", "b-ohne-muster.txt"]);
    assert.equal(
      eintrag(ergebnis.laufen, "npm run build").grund,
      "voller Umfang: 'a-ohne-muster.txt', 'b-ohne-muster.txt' treffen kein Muster",
    );
  });
});

test("trifft jede Datei ein Muster, bleibt ohneZuordnung leer", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.ohneZuordnung, []);
  });
});

test("ein nicht aufloesbarer Anker erfindet keinen Eintrag in ohneZuordnung", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--since", "gibt-es-nicht");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ohneZuordnung, []);
  });
});

test("--bereich faehrt die Pruefgruppen genau dieses Bereichs", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    // Eine Datei ohne Muster: ohne das Flag zoege sie den vollen Umfang nach sich.
    datei(dir, "notizen.txt");

    const ergebnis = plan(dir, "--bereich", "frontend");

    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(kommandos(ergebnis.laufen), ["npm run build"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["mvn verify"]);
    assert.match(eintrag(ergebnis.laufen, "npm run build").grund, /Bereichslauf/);
    assert.match(eintrag(ergebnis.ausgelassen, "mvn verify").grund, /Bereichslauf/);
  });
});

test("run --bereich fuehrt genau die Kommandos dieses Bereichs aus", () => {
  const config = {
    buildChecks: [
      { cmd: "echo x > lief-frontend.txt", areas: ["frontend"] },
      { cmd: "echo x > lief-backend.txt", areas: ["backend"] },
    ],
    checkAreas: CONFIG.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "backend/src/Service.java");

    const res = run(dir, "--bereich", "frontend");

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stderr}`);
    assert.ok(existsSync(join(dir, "lief-frontend.txt")), "die Pruefung des Bereichs ist nicht gelaufen");
    assert.ok(!existsSync(join(dir, "lief-backend.txt")), "eine fremde Pruefung ist trotzdem gelaufen");
  });
});

test("ein unbekannter Bereichsname schlaegt fehl und nennt die konfigurierten Bereiche", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const res = checks(dir, "run", "--bereich", "fronend");

    assert.notEqual(res.status, 0, "der unbekannte Bereich lief durch");
    assert.match(res.stderr, /fronend/);
    assert.match(res.stderr, /frontend/);
    assert.match(res.stderr, /backend/);
  });
});

test("ein fehlender Wert hinter --bereich ist derselbe Fehler wie ein falscher", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const res = checks(dir, "plan", "--bereich");

    assert.notEqual(res.status, 0, "--bereich ohne Wert lief durch");
    assert.match(res.stderr, /frontend/);
  });
});

test("--bereich bleibt mit --stufe kombinierbar: die Kumulation gilt weiter", () => {
  const config = {
    buildChecks: [
      { cmd: "npm run build", areas: ["frontend"] },
      { cmd: "npm run e2e", areas: ["frontend"], stufe: "push" },
      { cmd: "mvn verify", areas: ["backend"] },
    ],
    checkAreas: CONFIG.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const paket = plan(dir, "--bereich", "frontend");
    assert.deepEqual(kommandos(paket.laufen), ["npm run build"]);
    assert.match(eintrag(paket.ausgelassen, "npm run e2e").grund, /Stufe push/);

    const push = plan(dir, "--bereich", "frontend", "--stufe", "push");
    assert.deepEqual(kommandos(push.laufen), ["npm run build", "npm run e2e"]);
    assert.deepEqual(kommandos(push.ausgelassen), ["mvn verify"]);
  });
});

test("--bereich laesst --since unberuehrt: der Anker bestimmt weiter die Dateiliste", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--bereich", "backend", "--since", "HEAD");

    assert.deepEqual(ergebnis.geaendert, ["frontend/src/App.tsx"]);
    assert.deepEqual(kommandos(ergebnis.laufen), ["mvn verify"]);
  });
});

// --- Der Bereichslauf als Teilnachweis (Code-Review zu #922) ---
//
// Eigene Kommandos statt der CONFIG oben: Die Faelle hier fahren `run` wirklich, und
// `npm run build` / `mvn verify` gibt es im Wegwerf-Repo nicht — sie liefen rot und
// pruefeten am Gegenstand vorbei.
const CONFIG_LAUF = {
  buildChecks: [
    { cmd: "node -e \"process.exit(0)\" # frontend", areas: ["frontend"] },
    { cmd: "node -e \"process.exit(0)\" # backend", areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
};
//
// Zwei Loecher, die der Review aufgedeckt hat. Beide entstehen daraus, dass ein
// `--bereich`-Lauf zwar WENIGER Pruefungen faehrt, `geaendert` und `hashes` aber
// weiterhin aus dem Anker bestimmt — er sah damit aus wie ein vollstaendiger Lauf.

test("ein uneingeschraenkter Lauf uebernimmt das Ergebnis eines Bereichslaufs nicht", () => {
  mitRepo({ config: CONFIG_LAUF }, (dir) => {
    datei(dir, "frontend/src/App.tsx");
    datei(dir, "backend/src/Main.java");

    // Erst eingegrenzt: nur die Frontend-Pruefung laeuft.
    const eingegrenzt = run(dir, "--bereich", "frontend");
    assert.equal(eingegrenzt.status, 0, `${eingegrenzt.stdout}${eingegrenzt.stderr}`);
    assert.equal(zusammenfassung(dir).bereichWahl, "frontend");

    // Dann uneingeschraenkt auf demselben Stand: Ohne den Vergleich der Eingrenzung
    // uebernaehme dieser Lauf das Ergebnis oben — Basis, Stufe, Dateien und Hashes
    // sind identisch —, und die faellige Backend-Pruefung liefe nie.
    const voll = run(dir);
    assert.doesNotMatch(voll.stdout, /Ergebnis uebernommen/, "der volle Lauf darf nicht uebernehmen");
    const nachher = zusammenfassung(dir);
    assert.equal(nachher.bereichWahl, null, "ohne --bereich traegt die Zusammenfassung null");
    assert.ok(
      kommandos(nachher.laufen).some((c) => c.includes("# backend")),
      `die Backend-Pruefung muss laufen, lief: ${kommandos(nachher.laufen).join(", ")}`,
    );
  });
});

test("zwei Bereichslaeufe auf verschiedene Bereiche uebernehmen einander nicht", () => {
  mitRepo({ config: CONFIG_LAUF }, (dir) => {
    datei(dir, "frontend/src/App.tsx");
    datei(dir, "backend/src/Main.java");

    run(dir, "--bereich", "frontend");
    const zweiter = run(dir, "--bereich", "backend");

    assert.doesNotMatch(zweiter.stdout, /Ergebnis uebernommen/);
    assert.equal(zusammenfassung(dir).bereichWahl, "backend");
  });
});

test("derselbe Bereichslauf auf unveraendertem Stand uebernimmt weiterhin", () => {
  mitRepo({ config: CONFIG_LAUF }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    run(dir, "--bereich", "frontend");
    const zweiter = run(dir, "--bereich", "frontend");

    // Die Wiederverwendung selbst bleibt unangetastet: Gleiche Eingrenzung, gleicher
    // Stand, gleiches Ergebnis (Issue #863).
    assert.match(zweiter.stdout, /Ergebnis uebernommen/);
  });
});

// --- install.mjs: nur Blobs (Issue #1178) ---
//
// `install.mjs` traegt Skills, Vorlagen und Kit-Dateien als Blob-Konstanten, je eine
// Zeile, und `sync-blobs` aendert sie bei jeder Aenderung an einer Quelle mit. Die
// Quelle selbst steht im Diff und waehlt ihre Pruefungen; die gespiegelte Blob-Zeile
// sagt nichts Eigenes. Darum beruehrt `install.mjs` den Bereich nur, wenn mindestens
// eine geaenderte Zeile KEINE Blob-Konstante ist.
const CONFIG_BLOBS = {
  buildChecks: [
    { cmd: "node --test test/install-*.test.mjs", areas: ["installer"] },
    { cmd: "npm run build", areas: ["frontend"] },
  ],
  checkAreas: {
    installer: ["install.mjs"],
    frontend: ["frontend/**"],
  },
};

const INSTALLER = [
  "#!/usr/bin/env node",
  "const SKILL_A_B64 = \"QUFB\";",
  "const SKILL_B_B64 = \"QkJC\";",
  "function installieren() {",
  "  return 1;",
  "}",
  "",
].join("\n");

/** Legt `install.mjs` an und committet es, damit der Diff gegen HEAD nur die Aenderung zeigt. */
function mitInstaller(fn) {
  mitRepo({ config: CONFIG_BLOBS }, (dir) => {
    datei(dir, "install.mjs", INSTALLER);
    git(dir, "add", "install.mjs");
    git(dir, "commit", "-q", "-m", "install.mjs");
    fn(dir);
  });
}

test("nur Blob-Zeilen geaendert: installer bleibt unberuehrt, der Grund nennt 'install.mjs: nur Blobs'", () => {
  mitInstaller((dir) => {
    datei(dir, "install.mjs", INSTALLER.replace("QUFB", "WFhY"));
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["frontend"]);
    assert.ok(ergebnis.geaendert.includes("install.mjs"), "install.mjs faellt aus dem Nachweis");
    assert.deepEqual(kommandos(ergebnis.laufen), ["npm run build"]);
    assert.equal(
      eintrag(ergebnis.ausgelassen, "node --test test/install-*.test.mjs").grund,
      "Bereich installer unberuehrt (install.mjs: nur Blobs)",
    );
  });
});

test("eine Nicht-Blob-Zeile geaendert: installer ist beruehrt", () => {
  mitInstaller((dir) => {
    datei(dir, "install.mjs", INSTALLER.replace("QUFB", "WFhY").replace("return 1;", "return 2;"));

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["installer"]);
    assert.deepEqual(kommandos(ergebnis.laufen), ["node --test test/install-*.test.mjs"]);
  });
});

test("eine neue Blob-Konstante: installer bleibt unberuehrt", () => {
  mitInstaller((dir) => {
    datei(dir, "install.mjs", INSTALLER.replace("const SKILL_B_B64", "const SKILL_NEU_B64 = \"TkVV\";\nconst SKILL_B_B64"));

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, []);
    assert.deepEqual(kommandos(ergebnis.laufen), []);
    assert.match(eintrag(ergebnis.ausgelassen, "node --test test/install-*.test.mjs").grund, /install\.mjs: nur Blobs/);
  });
});

test("eine geloeschte Blob-Konstante: installer bleibt unberuehrt", () => {
  mitInstaller((dir) => {
    datei(dir, "install.mjs", INSTALLER.replace("const SKILL_B_B64 = \"QkJC\";\n", ""));

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, []);
    assert.equal(ergebnis.vollerUmfang, false);
    assert.match(eintrag(ergebnis.ausgelassen, "node --test test/install-*.test.mjs").grund, /install\.mjs: nur Blobs/);
  });
});

test("ein neu angelegtes install.mjs beruehrt installer, auch wenn es nur Blobs traegt", () => {
  mitRepo({ config: CONFIG_BLOBS }, (dir) => {
    datei(dir, "install.mjs", "const SKILL_A_B64 = \"QUFB\";\n");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["installer"]);
  });
});

test("der Berichtsblock nennt 'install.mjs: nur Blobs' bei der Auslassung", () => {
  const config = {
    buildChecks: [
      { cmd: "node -e \"process.exit(0)\" # installer", areas: ["installer"] },
      { cmd: "node -e \"process.exit(0)\" # frontend", areas: ["frontend"] },
    ],
    checkAreas: CONFIG_BLOBS.checkAreas,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "install.mjs", INSTALLER);
    git(dir, "add", "install.mjs");
    git(dir, "commit", "-q", "-m", "install.mjs");
    datei(dir, "install.mjs", INSTALLER.replace("QkJC", "WVlZ"));
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /ausgelassen: node -e "process\.exit\(0\)" # installer → Bereich installer unberuehrt \(install\.mjs: nur Blobs\)/);
  });
});
