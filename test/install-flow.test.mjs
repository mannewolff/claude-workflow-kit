// Der Frage-Antwort-Weg von install.mjs (Issue #187).
//
// install.mjs ist das Aushaengeschild des Kits — die Datei, die Nutzer per
// `node <(curl -s https://docs.mwolff.org/install.mjs)` ausfuehren. Ihre
// Fehlerpfade waren bis hierher ungetestet, und der Re-Install-Pfad hat schon
// zweimal Nutzer getroffen (#124: toolbox-Roundtrip, #125: nicht abgefragte
// Config-Felder gingen verloren).
//
// Zwei Sicherheitsvorkehrungen, ohne die diese Tests Schaden anrichten wuerden:
//
// 1. **cwd** ist immer ein Wegwerf-Verzeichnis — der projektlokale Install schreibt
//    nach ./.claude/ und fasst die .gitignore an.
// 2. **HOME und USERPROFILE** zeigen ebenfalls dorthin. Der globale Install schreibt
//    nach ~/.claude/, und os.homedir() liest unter POSIX HOME, unter Windows aber
//    USERPROFILE. Beide muessen gesetzt sein: Mit nur HOME liefen die Tests des
//    globalen Installs unter Windows gegen das echte Benutzerverzeichnis und
//    schlugen fehl (gefunden vom Windows-Job, Issue #197). Ohne die Umlenkung wuerde
//    ein Testlauf die echte Konfiguration ueberschreiben — ein Schaden, kein Test.
//
// Gefahren wird das ECHTE install.mjs aus dem Repo im Piped-Modus (stdin ist keine
// TTY, der Installer liest die Antworten dann zeilenweise).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

/**
 * Startet den echten Installer mit cwd UND HOME im Fixture.
 * `antworten` ist die Liste der Eingaben in der Reihenfolge der Fragen.
 */
function installiere(dir, antworten, extraEnv = {}) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), ...extraEnv },
  });
}

// Antworten fuer den kuerzesten Weg: projektlokal, GitHub, alle Defaults.
const PROJEKT_GITHUB = ["projekt", "github", "github", "", "", "", ""];

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

// --- Version ---

test("install.mjs --version gibt die Version aus und installiert nichts", () => {
  const dir = fixture("install-version-");
  try {
    const res = spawnSync(process.execPath, [INSTALLER, "--version"], {
      cwd: dir, encoding: "utf-8", env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /claude-workflow-kit install\.mjs v\d+\.\d+\.\d+/);
    assert.ok(!existsSync(join(dir, ".claude")), "--version darf nichts anlegen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Projektlokaler Install ---

test("Projektlokaler Install legt Config, Skills und CLAUDE-workflow.md an", () => {
  const dir = fixture("install-projekt-");
  try {
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.deepEqual(
      { codeHost: config(dir).codeHost, issueTracker: config(dir).issueTracker },
      { codeHost: "github", issueTracker: "github" }
    );
    assert.ok(existsSync(join(dir, ".claude", "CLAUDE-workflow.md")));
    // Die beiden Gate-Register liegen neben der Prozessdatei: `/kontext` laedt sie ueber
    // projectDocs, `/issue-review` klassifiziert damit einen Fund als `gate`.
    assert.ok(existsSync(join(dir, ".claude", "CLAUDE-Fachplan.md")));
    assert.ok(existsSync(join(dir, ".claude", "CLAUDE-Plan.md")));
    assert.ok(existsSync(join(dir, ".claude", "skills", "plan", "SKILL.md")),
      "die Skills muessen aus dem eingebetteten Blob entpackt werden");
    assert.ok(existsSync(join(dir, ".claude", "kit", "board.mjs")));
    // Der GitHub-Zweig am Ende weist auf gh auth login hin und fragt nichts nach.
    assert.match(res.stdout, /GitHub: Stelle sicher dass 'gh auth login'/);
    // Nichts davon darf im umgelenkten HOME gelandet sein.
    assert.ok(!existsSync(join(dir, "home", ".claude")),
      "der projektlokale Install darf HOME nicht anfassen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- .gitignore (Issue #208) ---
//
// workflow.config.json gehoert ins Repository: buildChecks, columns und Branch-Namen
// muessen fuer alle gleich sein. Der Installer schreibt deshalb einen Block statt der
// frueheren Zeile `.claude/`.
//
// Entscheidend ist die erste Zeile: `.claude/*`, nicht `.claude/`. Git wertet ein
// !-Negationsmuster nicht aus, wenn das VERZEICHNIS ausgeschlossen ist — es betritt
// es gar nicht erst. Deshalb pruefen die Tests unten mit `git check-ignore` gegen ein
// echtes Repo statt den Dateiinhalt zu vergleichen: Ein Textvergleich wuerde genau
// diesen Fallstrick nicht bemerken.

/** Legt ein echtes git-Repo im Fixture an, damit git check-ignore etwas zu pruefen hat. */
function gitInit(dir) {
  spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf-8" });
}

/** true, wenn git den Pfad ignoriert. */
function wirdIgnoriert(dir, pfad) {
  return spawnSync("git", ["check-ignore", pfad], { cwd: dir, encoding: "utf-8" }).status === 0;
}

test("Projektlokaler Install: workflow.config.json bleibt versionierbar, der Rest von .claude/ nicht", () => {
  const dir = fixture("install-gitignore-");
  try {
    gitInit(dir);
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);

    // Der eigentliche Test: die Wirkung, nicht der Text.
    assert.equal(wirdIgnoriert(dir, ".claude/workflow.config.json"), false,
      "die geteilte Config muss versionierbar sein — sonst hat jeder eigene buildChecks");
    assert.equal(wirdIgnoriert(dir, ".claude/workflow.config.local.json"), true,
      "die persoenliche Config gehoert nicht ins Repo");
    assert.equal(wirdIgnoriert(dir, ".claude/board-meta-cache.json"), true);
    assert.equal(wirdIgnoriert(dir, ".claude/settings.local.json"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projektlokaler Install: bestehende '.claude/'-Zeile wird migriert, fremde Eintraege bleiben", () => {
  const dir = fixture("install-gitignore-mig-");
  try {
    gitInit(dir);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n.claude/\ndist/\n", "utf-8");
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);

    const inhalt = readFileSync(join(dir, ".gitignore"), "utf-8");
    assert.ok(inhalt.includes("node_modules"), "fremde Eintraege muessen erhalten bleiben");
    assert.ok(inhalt.includes("dist/"), "fremde Eintraege muessen erhalten bleiben");
    assert.doesNotMatch(inhalt, /^\.claude\/$/m,
      "die alte Zeile muss ersetzt werden — bliebe sie stehen, liefe die Negation ins Leere");
    assert.equal(wirdIgnoriert(dir, ".claude/workflow.config.json"), false);
    assert.match(res.stdout, /\.gitignore/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projektlokaler Install: zweiter Lauf laesst die .gitignore unveraendert", () => {
  const dir = fixture("install-gitignore-idem-");
  try {
    gitInit(dir);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n", "utf-8");
    installiere(dir, PROJEKT_GITHUB);
    const nachErstem = readFileSync(join(dir, ".gitignore"), "utf-8");

    const zweiter = installiere(dir, PROJEKT_GITHUB);
    assert.equal(zweiter.status, 0, zweiter.stderr);
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf-8"), nachErstem,
      "der Block darf sich nicht bei jedem Lauf verdoppeln");
    assert.match(zweiter.stdout, /bereits vorhanden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projektlokaler Install: eigene .claude-Regeln werden nicht ueberschrieben", () => {
  // Eine handgepflegte Ignore-Datei still umzuschreiben waere ein Uebergriff.
  const dir = fixture("install-gitignore-eigen-");
  try {
    gitInit(dir);
    const eigen = "node_modules\n.claude/*\n!.claude/skills/\n";
    writeFileSync(join(dir, ".gitignore"), eigen, "utf-8");
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf-8"), eigen,
      "eine eigene .claude-Konfiguration bleibt unangetastet");
    assert.match(res.stdout, /eigene \.claude-Regeln/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projektlokaler Install: ohne .gitignore wird eine angelegt", () => {
  const dir = fixture("install-gitignore-neu-");
  try {
    gitInit(dir);
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(join(dir, ".gitignore")));
    assert.equal(wirdIgnoriert(dir, ".claude/workflow.config.json"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Projektlokaler Install weist darauf hin, dass workflow.config.json committet gehoert", () => {
  const dir = fixture("install-hinweis-");
  try {
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /workflow\.config\.json/);
    assert.match(res.stdout, /workflow\.config\.local\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Globaler Install ---

test("Globaler Install schreibt nach HOME und legt kontext.config.json mit Vault an", () => {
  const dir = fixture("install-global-");
  try {
    const vault = join(dir, "mein-vault");
    const res = installiere(dir, ["global", "github", "github", "", "", "", "", vault]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const home = join(dir, "home", ".claude");
    assert.ok(existsSync(join(home, "workflow.config.json")));
    assert.ok(existsSync(join(home, "skills", "plan", "SKILL.md")));
    assert.ok(existsSync(join(home, "CLAUDE-workflow.md")));
    assert.ok(existsSync(join(home, "CLAUDE-Fachplan.md")));
    assert.ok(existsSync(join(home, "CLAUDE-Plan.md")));

    const kontext = JSON.parse(readFileSync(join(home, "kontext.config.json"), "utf-8"));
    assert.equal(kontext.vault, vault);
    assert.deepEqual(kontext.always, ["Index.md", "Profil.md"]);
    assert.deepEqual(kontext.projectDocs, ["CLAUDE-*", ".claude/CLAUDE-*"]);
    // Der globale Install fasst das Projektverzeichnis nicht an.
    assert.ok(!existsSync(join(dir, ".claude")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Globaler Install ohne Vault-Pfad legt keine kontext.config.json an", () => {
  const dir = fixture("install-global-novault-");
  try {
    const res = installiere(dir, ["global", "github", "github", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(!existsSync(join(dir, "home", ".claude", "kontext.config.json")),
      "ohne Vault-Pfad darf keine kontext.config.json entstehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Eingabe-Validierung ---

test("Eine leere Antwort auf die Scope-Frage bedeutet global", () => {
  const dir = fixture("install-scope-default-");
  try {
    const res = installiere(dir, ["", "github", "github", "", "", "", "", ""]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(join(dir, "home", ".claude", "workflow.config.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Eine unverstaendliche Scope-Antwort wird zurueckgewiesen und neu gefragt", () => {
  const dir = fixture("install-scope-ungueltig-");
  try {
    const res = installiere(dir, ["vielleicht", "projekt", "github", "github", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout + res.stderr, /Bitte 'global' oder 'projekt' eingeben/);
    assert.ok(existsSync(join(dir, ".claude", "workflow.config.json")),
      "nach der Korrektur muss der projektlokale Install laufen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ein ungueltiger codeHost bricht den Piped-Modus mit Fehlermeldung ab", () => {
  const dir = fixture("install-codehost-ungueltig-");
  try {
    const res = installiere(dir, ["projekt", "bitbucket", "github", "", "", "", ""]);
    assert.equal(res.status, 1, "eine ungueltige Auswahl darf nicht stillschweigend durchgehen");
    assert.match(res.stdout + res.stderr, /Fehler/);
    assert.ok(!existsSync(join(dir, ".claude", "workflow.config.json")),
      "bei ungueltiger Eingabe darf keine Config entstehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ein reviewModel ohne claude-Praefix wird von der pattern-Regel abgelehnt", () => {
  const dir = fixture("install-reviewmodel-");
  try {
    const res = installiere(dir, ["projekt", "github", "github", "", "", "", "gpt-4"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /reviewModel muss eine Claude-Modell-ID sein/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Skills-Blob: Fallback und Totalausfall ---
//
// Diese drei Pfade haengen an der eingebetteten Konstante SKILLS_B64, die im echten
// install.mjs immer vollstaendig und gueltig ist. Um sie zu erreichen, laeuft hier
// ausnahmsweise eine KOPIE mit manipulierter Konstante. Folge, bewusst in Kauf
// genommen: Ihre Coverage laeuft unter dem Temp-Pfad und erscheint nicht unter
// install.mjs. Die Alternative waere ein Override-Hook im Produktivcode gewesen —
// ausgerechnet in der Datei, deren Portabilitaet zugesagt ist und die Nutzer per
// `node <(curl ...)` starten. Verhalten pruefen ist das wert, drei Zeilen
// Messwert nicht.

function installerMitBlob(dir, blobWert) {
  const quelle = readFileSync(INSTALLER, "utf-8");
  const ersetzt = quelle.replace(/const SKILLS_B64 = "[^"]*";/, `const SKILLS_B64 = ${JSON.stringify(blobWert)};`);
  assert.notEqual(ersetzt, quelle, "SKILLS_B64 wurde in der Kopie nicht ersetzt");
  const pfad = join(dir, "install-kopie.mjs");
  writeFileSync(pfad, ersetzt, "utf-8");
  return pfad;
}

function installiereKopie(dir, pfad, antworten) {
  return spawnSync(process.execPath, [pfad], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

test("Ein korrupter Skills-Blob wird gemeldet und der Dateisystem-Fallback greift", () => {
  const dir = fixture("install-blob-korrupt-");
  try {
    // Die Kopie liegt im Repo-Root, damit ihr __dirname/skills auf die echten Skills
    // zeigt — genau der Fallback, der bei der Kit-Entwicklung im Klon greift.
    const quelle = readFileSync(INSTALLER, "utf-8").replace(/const SKILLS_B64 = "[^"]*";/, 'const SKILLS_B64 = "kein-base64-json";');
    const pfad = join(repoRoot, ".install-kopie-test.mjs");
    writeFileSync(pfad, quelle, "utf-8");
    try {
      const res = installiereKopie(dir, pfad, PROJEKT_GITHUB);
      assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
      assert.match(res.stdout + res.stderr, /Skills-Blob ist kein gueltiges JSON/);
      assert.match(res.stdout, /aus Dateisystem/, "der Fallback muss greifen");
      assert.ok(existsSync(join(dir, ".claude", "skills", "plan", "SKILL.md")));
    } finally {
      rmSync(pfad, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ohne Blob und ohne Dateisystem-Quelle bricht die Installation ab", () => {
  const dir = fixture("install-blob-leer-");
  try {
    // Kopie im Fixture: __dirname/skills existiert dort nicht, der Fallback laeuft
    // also ebenfalls ins Leere — kein einziger Skill ist kopierbar.
    const pfad = installerMitBlob(dir, "kein-base64-json");
    const res = installiereKopie(dir, pfad, PROJEKT_GITHUB);
    assert.equal(res.status, 1, "ohne jeden Skill darf die Installation nicht als Erfolg enden");
    assert.match(res.stdout + res.stderr, /Kein einziger Skill konnte kopiert werden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Re-Install ---

// Der Pfad mit der schlechtesten Bilanz: #124 (toolbox wurde nicht akzeptiert) und
// #125 (nicht abgefragte Felder gingen verloren) haben beide echte Nutzer getroffen.
test("Re-Install erhaelt Felder, die gar nicht abgefragt werden", () => {
  const dir = fixture("install-reinstall-");
  try {
    installiere(dir, PROJEKT_GITHUB);
    const vorher = config(dir);

    // Felder ergaenzen, die keine Frage des Installers beruehrt.
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      ...vorher,
      buildChecks: ["mvn verify"],
      mutationCommand: "mvn pitest:mutationCoverage",
      github: { projectNumber: 42 },
      columns: { backlog: "Ideen" },
    }, null, 2), "utf-8");

    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Bestehende workflow\.config\.json gefunden/);

    const nachher = config(dir);
    assert.deepEqual(nachher.buildChecks, ["mvn verify"], "buildChecks gingen verloren (#125)");
    assert.equal(nachher.mutationCommand, "mvn pitest:mutationCoverage");
    assert.deepEqual(nachher.github, { projectNumber: 42 });
    assert.deepEqual(nachher.columns, { backlog: "Ideen" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Re-Install akzeptiert ein bestehendes issueTracker: toolbox (#124)", () => {
  const dir = fixture("install-toolbox-");
  try {
    installiere(dir, PROJEKT_GITHUB);
    const vorher = config(dir);
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ ...vorher, issueTracker: "toolbox", toolbox: { host: "https://beispiel.invalid" } }, null, 2), "utf-8");

    // Leere Antwort auf die issueTracker-Frage = bestehenden Wert uebernehmen.
    const res = installiere(dir, ["projekt", "github", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(config(dir).issueTracker, "toolbox",
      "toolbox muss als bestehender Wert durch die Validierung kommen");
    assert.deepEqual(config(dir).toolbox, { host: "https://beispiel.invalid" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Eine defekte bestehende Config blockiert die Installation nicht", () => {
  const dir = fixture("install-kaputte-config-");
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"), "{ kaputt", "utf-8");

    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout + res.stderr, /konnte nicht gelesen werden/);
    assert.equal(config(dir).codeHost, "github", "die Config muss neu geschrieben worden sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ein altes provider-Feld wird auf codeHost und issueTracker migriert", () => {
  const dir = fixture("install-provider-migration-");
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ provider: "gitlab", mainBranch: "trunk" }, null, 2), "utf-8");

    // Leere Antworten uebernehmen die migrierten Werte als Defaults.
    const res = installiere(dir, ["projekt", "", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = config(dir);
    assert.equal(c.codeHost, "gitlab");
    assert.equal(c.issueTracker, "gitlab");
    assert.equal(c.mainBranch, "trunk", "bestehende Werte bleiben Defaults");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitLab-Abschluss ---

test("GitLab-Install ohne Label-Anlage zeigt die manuelle Anleitung", () => {
  const dir = fixture("install-gitlab-nein-");
  try {
    const res = installiere(dir, ["projekt", "gitlab", "gitlab", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Labels manuell anlegen: Backlog, Ready/);
    assert.match(res.stdout, /Leerzeichen in den Namen verwenden, kein Bindestrich/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Beispiel-Config (Ad-hoc-Fix nach Issue #237/#233) ---
//
// Der Installer fragt den issueReview-Block nicht ab: `reviewers` haengt davon ab,
// welche CLIs auf der Maschine liegen, `pairs` ist eine Entscheidung. Stattdessen legt
// er eine Datei zum Abschreiben daneben. Sie ist der einzige Ort, an dem ein Nutzer den
// Block zu sehen bekommt, ohne die Doku zu lesen.

test("Installer legt eine gueltige workflow.config.example.json ab", () => {
  const dir = fixture("install-example-");
  try {
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const pfad = join(dir, ".claude", "workflow.config.example.json");
    assert.ok(existsSync(pfad), "Beispiel-Config fehlt");
    const bsp = JSON.parse(readFileSync(pfad, "utf-8"));

    // Der Grund, aus dem die Datei existiert.
    assert.ok(Array.isArray(bsp.issueReview?.reviewers) && bsp.issueReview.reviewers.length > 0,
      "issueReview.reviewers fehlt oder ist leer");
    assert.ok(bsp.issueReview?.pairs && Object.keys(bsp.issueReview.pairs).length > 0,
      "issueReview.pairs fehlt oder ist leer");

    // Jeder pairs-Eintrag muss auf existierende Reviewer zeigen und darf den Autor
    // nicht sich selbst nennen — sonst bricht board.mjs beim ersten Aufruf ab, und
    // zwar an einer Vorlage, die zum Abschreiben gedacht ist.
    const namen = new Set(bsp.issueReview.reviewers.map((r) => r.name));
    for (const [autor, genannt] of Object.entries(bsp.issueReview.pairs)) {
      for (const n of genannt) {
        assert.notEqual(n, autor, `pairs['${autor}'] nennt sich selbst`);
        assert.ok(namen.has(n), `pairs['${autor}'] nennt unbekannten Reviewer '${n}'`);
      }
    }

    // Anthropic-Familie als Default: Ein fremdes CLI in der Vorlage wuerde bei jedem,
    // der es nicht installiert hat, den Vorflug rot melden.
    assert.ok(bsp.issueReview.reviewers.every((r) => r.kind === "claude"),
      "die Vorlage darf keinen kind:command-Reviewer enthalten");

    // Abgeschafftes Feld (RELEASING.md: install.mjs ist alleinige Versionsquelle).
    assert.ok(!("version" in bsp), "die Vorlage traegt noch ein version-Feld");

    // Die echte Config bleibt davon unberuehrt — sie bekommt den Block NICHT.
    assert.equal("issueReview" in config(dir), false,
      "der Installer darf issueReview nicht in die echte Config schreiben");

    assert.match(res.stdout, /workflow\.config\.example\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Beispiel-Config wird beim Re-Install aufgefrischt", () => {
  // Sie enthaelt keine Nutzerdaten; eine veraltete Vorlage zeigt Felder, die es nicht
  // mehr gibt. Das ist der Unterschied zur echten Config, die erhalten bleiben muss (#125).
  const dir = fixture("install-example-reinstall-");
  try {
    assert.equal(installiere(dir, PROJEKT_GITHUB).status, 0);
    const pfad = join(dir, ".claude", "workflow.config.example.json");
    const original = readFileSync(pfad, "utf-8");

    writeFileSync(pfad, '{"veraltet": true}\n', "utf-8");
    assert.equal(installiere(dir, PROJEKT_GITHUB).status, 0);

    assert.equal(readFileSync(pfad, "utf-8"), original, "Beispiel-Config wurde nicht aufgefrischt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Vollstaendigkeit der Skills (Ad-hoc-Fix) ---
//
// Der Test, der gefehlt hat: copySkills() lief frueher ueber eine handgepflegte
// Namensliste, und /issue-review stand nicht darin. Der Skill lag im Blob, wurde aber
// in KEINEM per Installer eingerichteten Projekt jemals angelegt — lautlos, weil kein
// Test die Vollstaendigkeit prueft, sondern nur einzelne Skills stichprobenartig.

test("Installer legt JEDEN Skill aus dem Blob an", () => {
  const dir = fixture("install-alle-skills-");
  try {
    const res = installiere(dir, PROJEKT_GITHUB);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    // Erwartung ist die Quelle im Repo — nicht der Blob, den derselbe Installer
    // mitbringt. Sonst pruefte der Test seine eigene Eingabe.
    const erwartet = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const installiert = readdirSync(join(dir, ".claude", "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    assert.deepEqual(installiert, erwartet,
      "Es fehlen Skills — genau so ist /issue-review durchgefallen");
    // Namentlich, damit ein Regress sofort lesbar ist.
    assert.ok(existsSync(join(dir, ".claude", "skills", "issue-review", "SKILL.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Die Abschlussmeldung nennt die tatsaechliche Zahl der Skills", () => {
  // Das Zahlwort war zweimal falsch, weil es von Hand gepflegt wurde.
  const dir = fixture("install-skillzahl-");
  try {
    const res = installiere(dir, PROJEKT_GITHUB);
    const anzahl = readdirSync(join(dir, ".claude", "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
    assert.match(res.stdout, new RegExp(`Die ${anzahl} Skills erscheinen`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
