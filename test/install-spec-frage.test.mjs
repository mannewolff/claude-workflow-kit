// Die Installer-Frage nach dem beschriebenen Verhalten (Issue #439).
//
// Sie ist die einzige Frage des Installers, deren Antwort sich nicht zurueckholen
// laesst: Das Vorhandensein des spec-Blocks IST der Schalter (#438), es gibt kein
// 'enabled' und keinen Aus-Zustand. Deshalb steht vor dem Prompt ein Hinweis, den
// es sonst nirgends gibt, und deshalb wird die Frage im Update-Modus NICHT gestellt,
// wenn der Block schon da ist — ein 'Nein' duerfte ihn sonst entfernen und boete
// genau den Weg zurueck an, den es nicht geben soll.
//
// Gefahren wird das ECHTE install.mjs im Piped-Modus, mit cwd UND HOME/USERPROFILE
// im Wegwerf-Verzeichnis (dieselbe Vorkehrung wie in install-flow.test.mjs): Ohne
// die Umlenkung wuerde ein Testlauf die echte Konfiguration ueberschreiben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { pruefe } from "./helpers/mini-validator.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");
const QUELLE = readFileSync(INSTALLER, "utf-8");

const schema = JSON.parse(
  readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8")
);

// Woertlich so, wie sie im Installer steht — der Test sucht sie im stdout und belegt
// mit ihrer Abwesenheit, dass die Frage NICHT gestellt wurde.
const FRAGE = "Soll dieses Projekt ein beschriebenes Verhalten fuehren?";
const HINWEIS = "nicht zurueckzunehmen";

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function installiere(dir, antworten, extraEnv = {}) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), ...extraEnv },
  });
}

function config(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
}

function schreibeConfig(dir, werte) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(werte, null, 2) + "\n", "utf-8");
}

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand — und an neunter Stelle die Antwort auf die Spec-Frage.
// Der Tracker ist 'toolbox', nicht 'github': Seit Issue #461 entfaellt die Frage bei
// github und gitlab ersatzlos (A19) — mit ihnen waere kein Ja-Pfad mehr erreichbar.
// 'toolbox' ist in validationRules erlaubt, auch wenn der Prompt-Text nur github,
// gitlab und local nennt.
const bisSpec = (antwort) => ["projekt", "github", "toolbox", "", "", "", "", "", antwort];

// --- Ja und Nein ---

test("Antwort 'j' schreibt einen spec-Block mit Datum und einem Bereich", () => {
  const dir = fixture("install-spec-ja-");
  try {
    const res = installiere(dir, bisSpec("j"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const c = config(dir);
    assert.ok(c.spec, "der spec-Block fehlt");
    assert.match(c.spec.seit, /^\d{4}-\d{2}-\d{2}$/, "seit muss JJJJ-MM-TT sein");
    assert.equal(Object.keys(c.spec.bereiche).length, 1,
      "der Platzhalter muss genau einen Bereich tragen — ein leeres bereiche waere schemawidrig (#438)");

    // Der Installer raet keine Bereiche (Plan A8). Was er setzt, ist ein erkennbarer
    // Platzhalter — ohne diese Zeile merkt niemand, dass er ihn ersetzen muss.
    assert.match(res.stdout, /spec\.bereiche bitte von Hand pflegen\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[installer-1] Bei github wird die Frage gar nicht erst gestellt", () => {
  // A19 (Issue #461): 'github' und 'gitlab' tragen das beschriebene Verhalten nicht.
  // Der Installer bietet die Entscheidung dann nicht an, statt eine zu erfragen, die
  // er anschliessend nicht einloest — spec.mjs wuerde jeden Lauf abweisen.
  //
  // Eine Antwortzeile weniger als bei bisSpec: Die Frage entfaellt, also verbraucht
  // niemand die Zeile. Stuende sie hier, verschoebe sie alles Nachfolgende.
  const dir = fixture("install-spec-github-");
  try {
    const res = installiere(dir, ["projekt", "github", "github", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal("spec" in config(dir), false, "bei github darf kein spec-Block entstehen");
    assert.doesNotMatch(res.stdout, /beschriebenes Verhalten fuehren\?/,
      "die Frage wurde trotz github gestellt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[installer-1] Bei toolbox wird die Frage gestellt und 'j' erzeugt den Block", () => {
  // Der Ja-Pfad muss erreichbar bleiben — sonst schuetzt die Regel aus A19 nicht,
  // sondern schaltet das Vorhaben ganz ab.
  const dir = fixture("install-spec-toolbox-");
  try {
    const res = installiere(dir, bisSpec("j"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /beschriebenes Verhalten fuehren\?/, "die Frage fehlte");
    assert.ok(config(dir).spec, "bei toolbox muss 'j' den Block erzeugen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Eine leere Antwort erzeugt keinen spec-Schluessel", () => {
  const dir = fixture("install-spec-nein-");
  try {
    const res = installiere(dir, bisSpec(""));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal("spec" in config(dir), false,
      "der Default ist Nein — ein Block darf nur auf ausdrueckliches Ja entstehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("'nein' und 'n' sind Nein, 'ja' ist Ja", () => {
  for (const [antwort, erwartet] of [["n", false], ["nein", false], ["ja", true], ["J", true]]) {
    const dir = fixture("install-spec-token-");
    try {
      const res = installiere(dir, bisSpec(antwort));
      assert.equal(res.status, 0, `${antwort}: ${res.stderr}\n${res.stdout}`);
      assert.equal("spec" in config(dir), erwartet, `'${antwort}' wurde falsch verstanden`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("Eine unverstaendliche Antwort bricht den Piped-Modus ab", () => {
  // Wie bei askWithDefault: Interaktiv wird nachgefragt, im Pipe-Modus antwortet
  // niemand nach. Sie still als Nein zu werten hiesse, eine Entscheidung zu
  // erfinden, die nicht getroffen wurde.
  const dir = fixture("install-spec-quatsch-");
  try {
    const res = installiere(dir, bisSpec("vielleicht"));
    assert.equal(res.status, 1, "eine unverstaendliche Antwort darf nicht stillschweigend durchgehen");
    assert.match(res.stdout + res.stderr, /'j' oder 'n'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Das Datum: lokal, nicht UTC ---

/** Das Kalenderdatum in einer Zeitzone, unabhaengig von der Zeitzone des Testprozesses. */
function tagIn(zeitzone) {
  return new Date().toLocaleDateString("sv-SE", { timeZone: zeitzone });
}

test("spec.seit ist das LOKALE Tagesdatum, nicht das UTC-Datum", () => {
  // Gegenprobe ueber zwei feste Zeitzonen, die 26 Stunden auseinanderliegen: Ihr
  // Kalendertag ist damit zu JEDEM Zeitpunkt verschieden. Mit toISOString() waeren
  // beide Werte gleich — genau der Fehler, den dieser Test ausschliesst. An `seit`
  // haengt spaeter das Gate; um 00:30 MESZ traege es sonst den Vortag.
  const faelle = [
    { tz: "Pacific/Kiritimati", dir: fixture("install-spec-tz-plus-") },   // UTC+14
    { tz: "Etc/GMT+12", dir: fixture("install-spec-tz-minus-") },          // UTC-12
  ];
  try {
    const gemessen = faelle.map(({ tz, dir }) => {
      const vorher = tagIn(tz);
      const res = installiere(dir, bisSpec("j"), { TZ: tz });
      assert.equal(res.status, 0, `${tz}: ${res.stderr}\n${res.stdout}`);
      const nachher = tagIn(tz);
      const seit = config(dir).spec.seit;
      // Zwei erlaubte Werte, falls der Lauf ueber Mitternacht faellt.
      assert.ok([vorher, nachher].includes(seit),
        `unter ${tz} steht '${seit}' statt '${vorher}' (lokales Datum)`);
      return seit;
    });

    assert.notEqual(gemessen[0], gemessen[1],
      "beide Zeitzonen liefern denselben Tag — das ist das UTC-Datum, nicht das lokale");
  } finally {
    for (const { dir } of faelle) rmSync(dir, { recursive: true, force: true });
  }
});

// --- Update-Modus: ein vorhandener Block wird nicht angetastet ---

test("Ist ein spec-Block vorhanden, entfaellt die Frage und der Block bleibt unveraendert", () => {
  const dir = fixture("install-spec-update-");
  try {
    const vorher = {
      codeHost: "github",
      issueTracker: "github",
      reviewModel: "claude-opus-4-8",
      spec: {
        seit: "2026-01-15",
        bereiche: { kit: ["kit/**"], skills: ["skills/**"] },
        testPattern: String.raw`\[<ID>\]`,
      },
    };
    schreibeConfig(dir, vorher);

    // Acht Antworten: Die Spec-Frage wird nicht gestellt, also verbraucht sie auch
    // keine Zeile.
    const res = installiere(dir, ["projekt", "github", "github", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.ok(!res.stdout.includes(FRAGE),
      "die Frage wurde gestellt — ein 'Nein' koennte den Block entfernen, und den Weg zurueck gibt es nicht");
    assert.deepEqual(config(dir).spec, vorher.spec, "der bestehende Block wurde veraendert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Eine bestehende Config OHNE Block bekommt die Frage", () => {
  // Der Gegenpol zum Test darueber: Faellt die Frage im Update-Modus pauschal weg,
  // koennte ein laufendes Projekt nie einsteigen.
  const dir = fixture("install-spec-update-ohne-");
  try {
    schreibeConfig(dir, { codeHost: "github", issueTracker: "github", buildChecks: ["npm test"] });

    const res = installiere(dir, bisSpec("j"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(res.stdout.includes(FRAGE), "die Frage fehlt");
    assert.ok(config(dir).spec, "das Ja hat keinen Block erzeugt");
    assert.deepEqual(config(dir).buildChecks, ["npm test"], "nicht abgefragte Felder bleiben erhalten (#125)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Scope: nur projektlokal ---

test("Beim globalen Install entfaellt die Frage und es entsteht kein Block", () => {
  // spec.bereiche sind Code-Globs EINES Projekts. Ein Block in
  // ~/.claude/workflow.config.json haette jedes Projekt eingeschaltet, ohne dass es
  // dort entschieden wurde.
  const dir = fixture("install-spec-global-");
  try {
    const res = installiere(dir, ["global", "github", "github", "", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.ok(!res.stdout.includes(FRAGE), "die Frage darf beim globalen Install nicht erscheinen");
    const global = JSON.parse(readFileSync(join(dir, "home", ".claude", "workflow.config.json"), "utf-8"));
    assert.equal("spec" in global, false, "die globale Config traegt einen spec-Block");
    assert.ok(!existsSync(join(dir, ".claude")), "der globale Install fasst das Projektverzeichnis nicht an");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der erzeugte Block haelt gegen das Schema ---

test("Der erzeugte spec-Block validiert gegen das Schema aus Issue #438", () => {
  const dir = fixture("install-spec-schema-");
  try {
    assert.equal(installiere(dir, bisSpec("j")).status, 0);

    const c = config(dir);
    // Erst der Block allein — die scharfe Aussage: seit-Muster, minProperties und
    // die geschlossene Feldliste.
    assert.deepEqual(pruefe(schema.properties.spec, c.spec, "$.spec"), []);
    // Dann die ganze Datei: Der Block darf die Config nicht insgesamt schemawidrig
    // machen (die Wurzel ist geschlossen).
    assert.deepEqual(pruefe(schema, c), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der Hinweis und die Fragenzahl im Quelltext ---

test("Der Hinweis auf die Unumkehrbarkeit steht im Installer und VOR dem Prompt", () => {
  assert.ok(QUELLE.includes(HINWEIS), `install.mjs enthaelt '${HINWEIS}' nicht`);

  const dir = fixture("install-spec-hinweis-");
  try {
    const res = installiere(dir, bisSpec(""));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const hinweis = res.stdout.indexOf(HINWEIS);
    const frage = res.stdout.indexOf(FRAGE);
    assert.ok(hinweis !== -1, "der Hinweis erscheint nicht in der Ausgabe");
    assert.ok(frage !== -1, "die Frage erscheint nicht in der Ausgabe");
    assert.ok(hinweis < frage,
      "der Hinweis steht hinter dem Prompt — gelesen wird er dann erst nach der Antwort");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Der Installer zaehlt zehn Fragen und nennt den Vault-Pfad als Frage 11", () => {
  // Das Zahlwort stand hier schon zweimal falsch, weil es von Hand gepflegt wird.
  // Seit Issue #473 kommt die Hook-Frage als zehnte dazu.
  assert.ok(QUELLE.includes("Zehn Fragen"), "der Intro-Text zaehlt nicht zehn Fragen");
  assert.ok(QUELLE.includes("Frage 11 (nur bei globalem Install)"),
    "der Kommentar der Vault-Frage wurde nicht nachgezogen");
  assert.ok(!QUELLE.includes("Neun Fragen"), "der alte Intro-Text steht noch da");
});
