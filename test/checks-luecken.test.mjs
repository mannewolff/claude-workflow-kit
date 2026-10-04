// Die Fehler- und Randpfade von kit/checks.mjs (Issue #504).
//
// Diese Datei traegt das Commit-Gate: Was sie nicht prueft, faellt beim Commit
// auf und nicht vorher. Genau deshalb duerfen ihre Fehlerpfade nicht ungetestet
// bleiben — ein Abbruch, der nie gelaufen ist, koennte statt der Meldung eine
// zweite Ausnahme werfen, und der Lauf endete mit einer Spur, die niemand liest.
//
// Drei Gruppen stehen hier:
//   - die Abbrueche, die eine kaputte Umgebung melden (kaputte Config, git, das
//     scheitert, ein Zaehlabgleich, der nicht aufgeht),
//   - `settingsEnv`, das den env-Block aus .claude/settings*.json einsammelt und
//     dabei nur die kaputte Quelle fallen lassen darf, nie den ganzen Lauf,
//   - die CLI-Grammatik: unbekanntes Argument, unbekannter Befehl,
//     Nutzungshilfe — und der Unterschied zwischen 'Fehler' und 'Unerwarteter
//     Fehler'.
//
// Wo git scheitern muss, startet checks.mjs ueber den Test-Hook `CHECKS_GIT_FAKE` ein
// Fake-`git` als Node-Skript (Issue #1136): Es reicht alles durch und faelscht genau
// ein Unterkommando. Ohne die Variable startet checks.mjs das echte git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHECKS, mitRepo, plan, run, checks, checksMitFakeGit, fakeGitOhne,
  zusammenfassung, datei, kommandos, eintrag,
} from "./helpers/checks-repo.mjs";
import { vergleicheText, gitStart } from "../kit/checks.mjs";

/** Ein Kommando, das nichts ausgibt und gruen endet. */
const LEISE = "node -e \"process.exit(0)\"";

// --- Test-Hook fuer git (Issue #1136) -----------------------------------------

test("ohne CHECKS_GIT_FAKE startet checks.mjs das echte git mit unveraenderten Argumenten", () => {
  assert.deepEqual(gitStart(["diff", "--name-only"], {}), { cmd: "git", args: ["diff", "--name-only"] });
  assert.deepEqual(gitStart(["status"], { CHECKS_GIT_FAKE: "" }), { cmd: "git", args: ["status"] },
    "eine leere Variable gilt als nicht gesetzt");
});

test("mit CHECKS_GIT_FAKE startet checks.mjs das Node-Skript mit dem laufenden Node", () => {
  assert.deepEqual(
    gitStart(["hash-object", "--stdin-paths"], { CHECKS_GIT_FAKE: "/x/git.mjs" }),
    { cmd: process.execPath, args: ["/x/git.mjs", "hash-object", "--stdin-paths"] },
  );
});

// --- Abbrueche --------------------------------------------------------------

test("eine kaputte workflow.config.json endet rot und nennt den Parser-Grund", () => {
  // Ein Kommando, das eine kaputte Config stillschweigend als leer liest, meldet
  // 'nichts zu pruefen' — der Fehler in die unsichere Richtung.
  mitRepo({ configText: "{ \"buildChecks\": [\n" }, (dir) => {
    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0, "eine kaputte Config darf nicht durchgehen");
    assert.match(res.stderr, /kein gueltiges JSON/);
    assert.match(res.stderr, /workflow\.config\.json/);
    assert.equal(res.stdout.trim(), "", "ohne lesbare Config darf kein JSON-Ergebnis entstehen");
  });
});

test("buildChecks als String statt Array endet als 'Unerwarteter Fehler'", () => {
  // Der Unterschied traegt die Diagnose: 'Fehler' ist eine Lage, die checks.mjs
  // kennt und benennt; 'Unerwarteter Fehler' ist ein Programmierfehler in der
  // Config, der ungefiltert durchschlaegt. Beides als 'Fehler' auszugeben naehme
  // dem Leser genau diese Unterscheidung.
  mitRepo({ configText: "{ \"buildChecks\": \"npm test\" }\n" }, (dir) => {
    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /^Unerwarteter Fehler: /, `stderr war: ${res.stderr}`);
  });
});

test("scheitert git diff nach aufgeloestem Anker, endet der Lauf rot und nennt den Anker", () => {
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    fakeGitOhne(dir, "diff", "fatal: fake diff");
    datei(dir, "a.txt", "A\n");

    const res = checksMitFakeGit(dir, "plan");

    assert.notEqual(res.status, 0, "ein gescheitertes git diff darf nicht als 'keine Aenderung' durchgehen");
    assert.match(res.stderr, /git diff gegen/);
    assert.match(res.stderr, /fake diff/, "die Meldung reicht die git-Ausgabe nicht durch");
  });
});

test("scheitert git status, endet der Lauf rot — obwohl git diff schon geliefert hat", () => {
  // Der teure Fall: `rev-parse` und `diff` sind durch, die getrackten Aenderungen
  // stehen schon in der Menge. Ohne Abbruch fehlte nur das Ungetrackte, und der
  // Lauf saehe wie ein vollstaendiger aus.
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    fakeGitOhne(dir, "status", "fatal: fake status");

    const res = checksMitFakeGit(dir, "plan");

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /git status schlug fehl/);
    assert.match(res.stderr, /fake status/);
  });
});

test("scheitert git hash-object, endet run rot und schreibt keine Zusammenfassung", () => {
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    fakeGitOhne(dir, "hash-object", "fatal: fake hash-object");
    datei(dir, "a.txt", "A\n");

    const res = checksMitFakeGit(dir, "run");

    assert.notEqual(res.status, 0, "ohne Hashes darf das Commit-Gate keinen Nachweis bekommen");
    assert.match(res.stderr, /git hash-object schlug fehl/);
    assert.match(res.stderr, /fake hash-object/);
  });
});

test("scheitert git hash-object stumm, traegt die Meldung trotzdem nur den Schritt", () => {
  // Ein Abbruch ohne stderr ist kein hypothetischer Fall: Endet der Prozess durch
  // ein Signal, ist `status` null und `stderr` leer. Ohne den Leerstring-Ersatz
  // stuende dort 'undefined' statt einer Meldung — und der eigentliche Abbruch
  // ginge in einem TypeError unter, der nichts mit git zu tun hat.
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    fakeGitOhne(dir, "hash-object", null);
    datei(dir, "a.txt", "A\n");

    const res = checksMitFakeGit(dir, "run");

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /^Fehler: git hash-object schlug fehl: *$/m, `stderr war: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /undefined/);
  });
});

test("liefert git hash-object mehr Hashes als Pfade, endet run rot und nennt beide Zahlen", () => {
  // Ein Zeilenumbruch im Dateinamen: `--stdin-paths` liest zeilenweise, also wird
  // aus drei Pfaden eine Eingabe mit vier Zeilen und git antwortet mit vier
  // Hashes. Ohne den Abgleich bekaemen die Pfade fremde Hashes zugeordnet, und
  // das Commit-Gate pruefte gegen einen Nachweis, der nichts bezeugt.
  //
  // Windows verbietet den Zeilenumbruch im Dateinamen (Issue #1146). Dort reicht ein
  // Fake-git dieselbe Eingabe mit einer Zeile mehr an das echte git weiter: drei
  // Pfade, vier Zeilen, vier Hashes — dieselbe Lage, dieselbe Zusage.
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    datei(dir, "a", "A\n");
    datei(dir, "b", "B\n");
    let res;
    if (process.platform === "win32") {
      datei(dir, "c", "C\n");
      fakeGitZeileMehr(dir);
      res = checksMitFakeGit(dir, "run");
    } else {
      datei(dir, "a\nb", "AB\n");
      res = run(dir);
    }

    assert.notEqual(res.status, 0, "ein Zaehlabgleich, der nicht aufgeht, darf nicht durchgehen");
    assert.match(res.stderr, /git hash-object lieferte 4 Hashes fuer 3 Pfade/);
  });
});

/** Fake-git, das an `hash-object --stdin-paths` den ersten Pfad ein zweites Mal anhaengt. */
function fakeGitZeileMehr(dir) {
  mkdirSync(join(dir, "fakebin"), { recursive: true });
  writeFileSync(join(dir, "fakebin", "git.mjs"), [
    "// Generiert von test/checks-luecken.test.mjs (Issue #1146) — kein Produktivcode.",
    'import { spawnSync } from "node:child_process";',
    'import { readFileSync } from "node:fs";',
    "const argv = process.argv.slice(2);",
    'let opts = { stdio: "inherit" };',
    'if (argv[0] === "hash-object") {',
    String.raw`  const pfade = readFileSync(0, "utf-8").split("\n").filter(Boolean);`,
    String.raw`  opts = { input: [...pfade, pfade[0]].join("\n") + "\n", stdio: ["pipe", "inherit", "inherit"] };`,
    "}",
    'const res = spawnSync("git", argv, opts);',
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"), "utf-8");
}

// --- settingsEnv ------------------------------------------------------------

test("eine kaputte settings.json laesst nur diese Quelle ausfallen, nicht den Lauf", () => {
  // Der Nachweis ist wichtiger als die Zeile: Ein Lauf, der beide Quellen
  // verwirft, waere ebenfalls 'weitergelaufen' — und die Variable aus der
  // intakten Datei fehlte still. Genau daran scheiterte kanban-kit #445.
  const config = {
    buildChecks: [{ cmd: "node -e \"process.exit(process.env.KIT_TEST_VAR === 'x' ? 0 : 1)\"", always: true }],
  };
  mitRepo({ config }, (dir) => {
    datei(dir, ".claude/settings.json", "{ das ist kein JSON\n");
    datei(dir, ".claude/settings.local.json", JSON.stringify({ env: { KIT_TEST_VAR: "x" } }) + "\n");
    datei(dir, "a.txt", "A\n");

    const res = run(dir);

    assert.equal(res.status, 0, `die intakte Quelle haette durchkommen muessen: ${res.stdout}${res.stderr}`);
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, config.buildChecks[0].cmd).ergebnis, "gruen");
  });
});

test("settings.local.json gewinnt gegen settings.json beim selben Schluessel", () => {
  // Precedence wie in Claude Code. Die local-Datei ist gitignored und damit der
  // Ort fuer maschinenspezifische Werte — gaebe die geteilte Datei den Ausschlag,
  // waere die local-Datei wirkungslos, wo sie am noetigsten ist.
  const config = {
    buildChecks: [{ cmd: "node -e \"process.exit(process.env.KIT_TEST_VAR === 'lokal' ? 0 : 1)\"", always: true }],
  };
  mitRepo({ config }, (dir) => {
    datei(dir, ".claude/settings.json", JSON.stringify({ env: { KIT_TEST_VAR: "geteilt" } }) + "\n");
    datei(dir, ".claude/settings.local.json", JSON.stringify({ env: { KIT_TEST_VAR: "lokal" } }) + "\n");
    datei(dir, "a.txt", "A\n");

    const res = run(dir);

    assert.equal(res.status, 0, `settings.local.json hat sich nicht durchgesetzt: ${res.stdout}${res.stderr}`);
  });
});

test("eine settings.json ohne env-Block und eine mit env als String kippen den Lauf nicht", () => {
  // Beide Formen sind moeglich (settings.json traegt weit mehr als env), und
  // beide duerfen weder etwas beisteuern noch etwas kaputtmachen. Ein
  // `Object.assign` gegen einen String schriebe die Zeichen als Indizes in die
  // Umgebung — der Lauf saehe gruen aus und die Umgebung waere Unsinn.
  const config = { buildChecks: [{ cmd: "node -e \"process.exit(process.env['0'] === undefined ? 0 : 1)\"", always: true }] };
  mitRepo({ config }, (dir) => {
    datei(dir, ".claude/settings.json", JSON.stringify({ permissions: { allow: [] } }) + "\n");
    datei(dir, ".claude/settings.local.json", JSON.stringify({ env: "PATH=/nirgendwo" }) + "\n");
    datei(dir, "a.txt", "A\n");

    const res = run(dir);

    assert.equal(res.status, 0, `ein env, das kein Objekt ist, darf nicht uebernommen werden: ${res.stdout}${res.stderr}`);
  });
});

// --- Muster und Grundtexte --------------------------------------------------

test("ein Bereich ohne Musterliste trifft nichts und zieht den vollen Umfang", () => {
  // `checkAreas: { name: null }` ist ein halb gepflegter Eintrag. Er darf nicht
  // werfen — aber er darf auch nicht heimlich alles treffen: Die Datei findet
  // dann kein Muster, und das ist der Ausgang 'mehr pruefen'.
  const config = {
    buildChecks: [{ cmd: LEISE, areas: ["leer"] }],
    checkAreas: { leer: null },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true, "ein Bereich ohne Muster darf keine Datei zuordnen");
    assert.deepEqual(ergebnis.bereiche, []);
    assert.match(eintrag(ergebnis.laufen, LEISE).grund, /src\/a\.txt/);
  });
});

test("mehrere Bereiche an einer Pruefung stehen im Grund im Plural — beruehrt wie unberuehrt", () => {
  const config = {
    buildChecks: [
      { cmd: "echo zwei-beruehrt", areas: ["frontend", "backend"] },
      { cmd: "echo zwei-unberuehrt", areas: ["docs", "infra"] },
    ],
    checkAreas: {
      frontend: ["frontend/**"], backend: ["backend/**"], docs: ["docs/**"], infra: ["infra/**"],
    },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/App.tsx");
    datei(dir, "backend/Service.java");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo zwei-beruehrt"]);
    assert.match(eintrag(ergebnis.laufen, "echo zwei-beruehrt").grund, /Bereiche frontend, backend beruehrt/);
    assert.match(eintrag(ergebnis.ausgelassen, "echo zwei-unberuehrt").grund, /Bereiche docs, infra unberuehrt/);
  });
});

test("vergleicheText in kit/checks.mjs kennt drei Ausgaenge, auch die Gleichheit", () => {
  // Der Gleichheitsfall faellt bei `sort` nie an, solange die Liste keine
  // Duplikate traegt — die 0 muss trotzdem stimmen, sonst waere die Ordnung
  // keine.
  assert.equal(vergleicheText("a", "b"), -1);
  assert.equal(vergleicheText("b", "a"), 1);
  assert.equal(vergleicheText("a", "a"), 0);
});

// --- CLI --------------------------------------------------------------------

test("ein unbekanntes Argument endet rot und nennt es beim Namen", () => {
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    const res = checks(dir, "plan", "--sinces", "HEAD");

    assert.notEqual(res.status, 0, "ein vertipptes Argument darf nicht stillschweigend wirkungslos bleiben");
    assert.match(res.stderr, /Unbekanntes Argument: '--sinces'/);
  });
});

test("--since ohne Wert gilt wie ein leerer Wert: voller Umfang", () => {
  // Steht `--since` am Ende, ist der Wert nicht 'nicht angegeben', sondern
  // fehlend — als Default HEAD gelesen liefe auf sauberem Tree keine einzige
  // Pruefung.
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    const ergebnis = plan(dir, "--since");

    assert.equal(ergebnis.vollerUmfang, true);
    assert.equal(ergebnis.leeresPaket, false);
    assert.equal(ergebnis.basis, "");
    assert.deepEqual(kommandos(ergebnis.laufen), [LEISE]);
  });
});

test("ein unbekannter Befehl endet rot, nennt ihn und gibt die Nutzungshilfe aus", () => {
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    const res = checks(dir, "planx");

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Unbekannter Befehl: 'planx'/);
    assert.match(res.stderr, /Erwartet: plan, run oder bereiche/);
    assert.match(res.stdout, /--since/, "ohne Nutzungshilfe bliebe der Leser ohne naechsten Schritt");
  });
});

test("kein Argument, --help und -h geben die Nutzungshilfe mit Exit 0 aus", () => {
  // Denselben Fall prueft checks-anker.test.mjs gegen eine Kopie der Datei, um
  // die Portabilitaet zu belegen. Hier laeuft das Original aus dem Repo, im
  // Repo-Kontext — die Nutzungshilfe darf auch dann nicht in `plan` abbiegen.
  mitRepo({ config: { buildChecks: [LEISE] } }, (dir) => {
    for (const cliArgs of [[], ["--help"], ["-h"]]) {
      const res = checks(dir, ...cliArgs);

      assert.equal(res.status, 0, `checks.mjs ${cliArgs.join(" ")} endete mit ${res.status}: ${res.stderr}`);
      assert.match(res.stdout, /node checks\.mjs plan/);
      assert.match(res.stdout, /node checks\.mjs run/);
    }
  });
});

test("ist argv[1] nicht aufloesbar, laedt das Modul trotzdem und startet kein CLI", () => {
  // Der Guard rechnet mit dem Symlink-Fall (macOS: /var -> /private/var). Loest
  // sich argv[1] gar nicht auf, darf er nicht werfen: Das Modul steckte dann in
  // einem Ladefehler, und ein Import — etwa aus der Testsuite — kaeme nie an.
  const dir = mkdtempSync(join(tmpdir(), "checks-argv-"));
  try {
    const loader = join(dir, "loader.mjs");
    writeFileSync(loader, [
      "// Generiert von test/checks-luecken.test.mjs (Issue #504) — kein Produktivcode.",
      String.raw`import { rmSync } from "node:fs";`,
      String.raw`import { pathToFileURL } from "node:url";`,
      // Sich selbst loeschen: Das Modul ist gelesen, argv[1] zeigt danach ins
      // Leere — genau die Lage, die realpathSync scheitern laesst.
      "rmSync(process.argv[1]);",
      "await import(pathToFileURL(process.argv[2]).href);",
      String.raw`process.stdout.write("geladen\n");`,
      "",
    ].join("\n"), "utf-8");

    const res = spawnSync(process.execPath, [loader, CHECKS], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, `der Import scheiterte: ${res.stderr}`);
    assert.match(res.stdout, /geladen/);
    assert.doesNotMatch(res.stdout, /node checks\.mjs/, "das Modul hat als CLI gestartet statt nur zu laden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
