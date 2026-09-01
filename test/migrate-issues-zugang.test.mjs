// Fehler- und Zugangspfade des Migrationswerkzeugs (Issue #405).
//
// Die drei Bestandsdateien (migrate-issues, -import, -verify) pruefen die
// Gluecksfaelle und die fachlichen Abbrueche. Was dort fehlt, sind die Wege, auf
// denen das Werkzeug gar nicht erst arbeiten kann: kein `gh` im PATH, eine kaputte
// Konfiguration, ein fehlender Host, ein unlesbares Token, ein toter Endpunkt.
//
// Diese Wege sind kein Beiwerk. Sie sind das, was ein Anwender beim ERSTEN Lauf
// sieht — und die Meldung ist dann die ganze Diagnose. Ein `undefined` an dieser
// Stelle kostet eine Stunde Suche.
//
// Aufbau wie im import-Test: das ECHTE Script mit cwd in einem Fixture-Verzeichnis,
// kanban-kit als lokaler HTTP-Mock, `gh` als Fake-Binary im PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupProjekt, schreibeConfig, fakeCli, starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");
const REPO_URL = "https://github.com/mannewolff/claude-workflow-kit";

// Unter Windows uebersprungen: `fakeCli` legt das Fake-`gh` als endungslose Datei mit
// Shebang an, und dort entscheidet die ENDUNG (.cmd/.bat/.exe), ob etwas startbar
// ist. Wortgleich zu den drei Bestandsdateien (Issue #197, #231).
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

function runMigrate(dir, cliArgs, extraEnv = {}) {
  const env = { ...process.env };
  delete env.KIT_AGENT_MODEL;
  delete env.TBX_TOKEN;
  Object.assign(env, {
    PATH: `${join(dir, "fakebin")}:${process.env.PATH}`,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
  }, extraEnv);
  return new Promise((fertig) => {
    execFile(process.execPath, [MIGRATE, ...cliArgs], { cwd: dir, env }, (err, stdout, stderr) => {
      fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** Ein Fixture, dessen import-Lauf bis zur Zugangsaufloesung kommt. */
async function importFixture(praefix, config, { eintraege = [{ number: 101, title: "Issue 101", body: "B", comments: [], labels: [], spalte: "Backlog" }] } = {}) {
  const dir = setupProjekt(config, praefix);
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${REPO_URL}\n` }]);
  const datei = join(dir, "export.json");
  writeFileSync(datei, JSON.stringify(eintraege, null, 2), "utf-8");
  return { dir, datei, ende: () => rmSync(dir, { recursive: true, force: true }) };
}

// ============================================================
// exec: das Werkzeug selbst fehlt
// ============================================================

test("export ohne gh im PATH nennt das fehlende Werkzeug statt eines Systemfehlers", async () => {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-kein-gh-");
  try {
    // PATH auf ein leeres Verzeichnis: Ein installiertes gh der Entwicklermaschine
    // darf hier nicht einspringen, sonst prueft der Test nichts.
    const leer = join(dir, "leerbin");
    mkdirSync(leer, { recursive: true });
    const res = await runMigrate(dir, ["export"], { PATH: leer });

    assert.equal(res.status, 1, `export haette mit Exit 1 enden muessen: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /gh nicht gefunden — ist es installiert und im PATH\?/,
      "die Meldung nennt das fehlende Werkzeug nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scheitert gh fachlich, steht seine eigene Meldung im Fehler", NUR_POSIX, async () => {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, "migrate-gh-rot-");
  try {
    fakeCli(dir, "gh", [{ match: "repo view", stderr: "gh: not authenticated\n", exit: 1 }]);
    const res = await runMigrate(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /not authenticated/,
      "die Meldung von gh selbst fehlt — ohne sie ist der Fehler nicht zuzuordnen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Konfiguration
// ============================================================

test("eine kaputte workflow.config.json wird als solche gemeldet, nicht als fehlend", async () => {
  const dir = setupProjekt({}, "migrate-config-kaputt-");
  try {
    schreibeConfig(dir, "{ das ist kein JSON");
    const res = await runMigrate(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /ist kein gueltiges JSON/,
      "die Meldung unterscheidet nicht zwischen kaputt und fehlend");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne github.projectNumber bricht export mit einem fachlichen Hinweis ab", async () => {
  const dir = setupProjekt({ issueTracker: "github" }, "migrate-ohne-projekt-");
  try {
    const res = await runMigrate(dir, ["export"]);

    assert.equal(res.status, 1, "export haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /github\.projectNumber fehlt/,
      "die fehlende Projektnummer wird nicht benannt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// kanban-kit-Zugang: Host
// ============================================================

test("ohne toolbox.host und ohne tbx-Login nennt import beide Auswege", NUR_POSIX, async () => {
  const f = await importFixture("migrate-ohne-host-", { issueTracker: "github", github: { projectNumber: 14 } });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Kein kanban-kit-Host gefunden/, "der fehlende Host wird nicht benannt");
    assert.match(res.stderr, /toolbox\.host[\s\S]*tbx auth login/,
      "die Meldung nennt nicht beide Auswege");
  } finally {
    f.ende();
  }
});

test("fehlt toolbox.host, springt der Host aus dem tbx-Login ein", NUR_POSIX, async () => {
  const { server, requests, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { id: 5001, number: 101 } };
    return undefined;
  });
  const f = await importFixture("migrate-host-aus-login-", { issueTracker: "github", github: { projectNumber: 14 } });
  try {
    // Der tbx-Login liefert Host UND Token — genau der Fall, fuer den der Rueckfall da ist.
    mkdirSync(join(f.dir, "tbx-config"), { recursive: true });
    writeFileSync(join(f.dir, "tbx-config", "config.json"), JSON.stringify({ host }), "utf-8");
    writeFileSync(join(f.dir, "tbx-config", "tokens.json"), JSON.stringify({ token: "login-token" }), "utf-8");

    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 0, `import haette durchlaufen muessen: ${res.stderr}`);
    const create = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.ok(create, "es wurde keine Karte angelegt — der Host aus dem Login griff nicht");
    assert.equal(create.headers["x-kanban-token"], "login-token",
      "das Token aus dem tbx-Login wurde nicht mitgeschickt");
  } finally {
    server.close();
    f.ende();
  }
});

test("eine kaputte tbx-config wird still uebergangen, nicht zum Absturz", NUR_POSIX, async () => {
  const f = await importFixture("migrate-tbx-kaputt-", { issueTracker: "github", github: { projectNumber: 14 } });
  try {
    mkdirSync(join(f.dir, "tbx-config"), { recursive: true });
    writeFileSync(join(f.dir, "tbx-config", "config.json"), "{ kaputt", "utf-8");

    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    // Die kaputte Datei ist kein eigener Fehler: Sie gilt als "kein Login vorhanden",
    // und der Lauf endet an der Stelle, an der er auch ohne sie enden wuerde.
    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Kein kanban-kit-Host gefunden/,
      "die kaputte tbx-config wurde nicht als fehlender Login behandelt");
    assert.doesNotMatch(res.stderr, /JSON/,
      "ein JSON-Parserfehler darf hier nicht durchschlagen");
  } finally {
    f.ende();
  }
});

// ============================================================
// kanban-kit-Zugang: Token
// ============================================================

test("ein Klartext-Token in der eingecheckten Config bricht ab", NUR_POSIX, async () => {
  const f = await importFixture("migrate-klartext-token-", {
    issueTracker: "github", github: { projectNumber: 14 },
    toolbox: { host: "http://127.0.0.1:9", token: "geheim" },
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /kein Klartext-Token in workflow\.config\.json/,
      "das Klartext-Token wurde nicht beanstandet");
    assert.doesNotMatch(res.stderr, /geheim/,
      "das Token selbst darf nicht in der Fehlermeldung stehen");
  } finally {
    f.ende();
  }
});

test("ein nicht lesbares toolbox.tokenFile nennt Pfad und Ursache", NUR_POSIX, async () => {
  const f = await importFixture("migrate-tokenfile-weg-", {
    issueTracker: "github", github: { projectNumber: 14 },
    toolbox: { host: "http://127.0.0.1:9", tokenFile: ".claude/gibt-es-nicht" },
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /toolbox\.tokenFile '\.claude\/gibt-es-nicht' nicht lesbar/,
      "der Pfad der Token-Datei fehlt in der Meldung");
  } finally {
    f.ende();
  }
});

test("das Token aus toolbox.tokenFile wird gelesen und mitgeschickt", NUR_POSIX, async () => {
  const { server, requests, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 200, json: {} };
    if (req.method === "POST" && req.url === "/api/kanban/items") return { status: 200, json: { id: 5001, number: 101 } };
    return undefined;
  });
  const f = await importFixture("migrate-tokenfile-", {
    issueTracker: "github", github: { projectNumber: 14 },
    toolbox: { host, tokenFile: ".claude/kanban-token" },
  });
  try {
    // Mit Zeilenumbruch: Genau so legt der Anwender die Datei an, und genau deshalb
    // trimmt das Werkzeug.
    writeFileSync(join(f.dir, ".claude", "kanban-token"), "datei-token\n", "utf-8");

    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 0, `import haette durchlaufen muessen: ${res.stderr}`);
    const create = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.ok(create, "es wurde keine Karte angelegt");
    assert.equal(create.headers["x-kanban-token"], "datei-token",
      "das Token aus der Datei wurde nicht (oder ungetrimmt) mitgeschickt");
  } finally {
    server.close();
    f.ende();
  }
});

test("ohne Token aus Env, Datei oder Login nennt import alle drei Auswege", NUR_POSIX, async () => {
  const f = await importFixture("migrate-ohne-token-", {
    issueTracker: "github", github: { projectNumber: 14 },
    toolbox: { host: "http://127.0.0.1:9" },
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"]);

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /Kein kanban-kit-Token gefunden/, "das fehlende Token wird nicht benannt");
    assert.match(res.stderr, /TBX_TOKEN[\s\S]*toolbox\.tokenFile[\s\S]*tbx auth login/,
      "die Meldung nennt nicht alle drei Auswege");
  } finally {
    f.ende();
  }
});

// ============================================================
// kanban-kit-Zugang: der Endpunkt selbst
// ============================================================

test("ein toter Endpunkt wird als Erreichbarkeitsproblem gemeldet, mit Host", NUR_POSIX, async () => {
  // Port 9 (discard) nimmt keine HTTP-Verbindung an: fetch scheitert in der
  // Transportschicht, nicht mit einem Status.
  const f = await importFixture("migrate-tot-", {
    issueTracker: "github", github: { projectNumber: 14 },
    toolbox: { host: "http://127.0.0.1:9" },
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"], { TBX_TOKEN: "t" });

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /kanban-kit nicht erreichbar \(http:\/\/127\.0\.0\.1:9\)/,
      "die Meldung nennt den Host nicht — ohne ihn ist nicht erkennbar, wohin gegriffen wurde");
  } finally {
    f.ende();
  }
});

test("ein Serverfehler ohne JSON-Body faellt auf den HTTP-Status zurueck", NUR_POSIX, async () => {
  const { server, host } = await starteServer((req) => {
    if (req.method === "GET" && req.url === "/api/kanban/items") return { status: 503, text: "<html>kaputt</html>" };
    return undefined;
  });
  const f = await importFixture("migrate-503-", {
    issueTracker: "github", github: { projectNumber: 14 }, toolbox: { host },
  });
  try {
    const res = await runMigrate(f.dir, ["import", "--file", f.datei, "--yes"], { TBX_TOKEN: "t" });

    assert.equal(res.status, 1, "import haette mit Exit 1 enden muessen");
    assert.match(res.stderr, /HTTP 503/,
      "ohne JSON-Body muss der Status selbst die Auskunft sein");
  } finally {
    server.close();
    f.ende();
  }
});
