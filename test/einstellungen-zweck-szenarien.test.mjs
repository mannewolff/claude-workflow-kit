// Ablauf-Pruefung: Ob Update, Prueflauf und Nacht-Kette eine fehlende Einstellung melden, zeigt nur ihre Ausgabe als Prozess.
//
// Szenarien aus Plan #1710 (Fachplan #1705): Einstellungen nach Zweck und mit englischen Namen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { normalisiereConfig, SCHLUESSEL } from "../kit/board/config-namen.mjs";
import { ZUORDNUNG, teilVon } from "../kit/board/config-teile.mjs";
import { run as nachtLauf, umgebung, fachplan, stand, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN } from "./helpers/kette-ablauf.mjs";
import { vorgeschichteAktiv } from "../kit/board/vorgeschichte.mjs";
import { pruefeForm } from "../kit/board/testhinweise.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Das Update eines bestehenden Projekts: der echte Installer im Wegwerf-Verzeichnis, cwd und
// HOME dort, wie in ablauf-install-flow.test.mjs. Dieselbe Antwortfolge wie dort
// PROJEKT_GITHUB_BESTAND; spawnSync schliesst stdin nach der letzten Antwort.
function update(config) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "einstellungen-update-")));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n");
  const fake = join(dir, "szenarien-fake.mjs");
  writeFileSync(fake, "console.log(JSON.stringify({ ab: 1 }));\n");
  const res = spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
    cwd: dir,
    input: ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""].join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), INSTALL_SZENARIEN_FAKE: fake },
  });
  const roh = JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));
  rmSync(dir, { recursive: true, force: true });
  return { res, roh };
}

// Ein Fachplan ohne Abschnitt zur Vorgeschichte, sonst vollstaendig.
const FACHPLAN = `## Ziel
Der Nutzer sieht etwas.

## Fachliche Akzeptanzkriterien
- Der Nutzer sieht es.

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const vorgeschichteHinweise = (config) =>
  (pruefeForm(FACHPLAN, "[Requirement] x", config).hinweise ?? []).filter((h) => h.art === "vorgeschichte");

test("Szenario: Ältere Datei mit deutschen Namen", () => {
  // Angenommen auf einem älteren Zweig steht die Vorgeschichte noch unter ihrem deutschen Namen eingeschaltet
  const { config } = normalisiereConfig({ vorgeschichte: true, mainBranch: "main" });
  // Wenn auf diesem Zweig ein Fachplan entsteht, dann wirkt die Vorgeschichte wie eingeschaltet
  assert.equal(vorgeschichteAktiv(config), true);
});

test("Szenario: Einstellung aus der Doku in der eigenen Datei finden", () => {
  // Angenommen ein deutsches Projekt hat die Vorgeschichte eingeschaltet
  const { res, roh } = update({ sprache: "de", codeHost: "github", issueTracker: "github", vorgeschichte: true });
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  // Wenn der Mensch auf der deutschen Einstellungsseite die Vorgeschichte nachschlaegt
  const seite = readFileSync(join(repoRoot, "docs", "einstellungen.md"), "utf-8");
  assert.match(seite, /^- `history` — /m);
  // Dann findet er den Eintrag in seiner Datei unter genau dem Namen, den die Seite nennt
  assert.equal(roh.history, true);
  assert.equal("vorgeschichte" in roh, false);
});

test("Szenario: Lohnender Schalter ist nach dem Update an", () => {
  // Angenommen ein Projekt hat die Vorgeschichte nie gesetzt
  const { res, roh } = update({ codeHost: "github", issueTracker: "github" });
  // Wenn das Projekt das naechste Update des Kits einspielt
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  assert.equal("history" in roh, false, "das Update schreibt den Schalter nicht");
  // Dann entsteht der naechste Fachplan mit Abschnitt Vorgeschichte
  const { config } = normalisiereConfig(roh);
  assert.equal(vorgeschichteAktiv(config), true);
  assert.equal(vorgeschichteHinweise(config).length, 1);
});

test("Szenario: Bewusst ausgeschaltete Vorgeschichte bleibt aus", () => {
  // Angenommen ein Projekt hat die Vorgeschichte in seiner Einstellungsdatei ausgeschaltet
  const { res, roh } = update({ codeHost: "github", issueTracker: "github", vorgeschichte: false });
  // Wenn das Projekt das naechste Update des Kits einspielt
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  assert.equal(roh.history, false);
  // Dann entsteht der naechste Fachplan ohne Abschnitt Vorgeschichte
  const { config } = normalisiereConfig(roh);
  assert.equal(vorgeschichteAktiv(config), false);
  assert.deepEqual(vorgeschichteHinweise(config), []);
  // und das Update hat nicht nachgefragt: Keine Frage nennt die Vorgeschichte. Die Liste der
  // alten Kommandonamen nennt `issue vorgeschichte → issue history` und ist keine Frage.
  const fragen = res.stdout.split("\n").filter((z) => /vorgeschichte|history/i.test(z) && z.includes("?"));
  assert.deepEqual(fragen, []);
});

// --- Szenario: Neues Projekt einrichten (Issue #1734, Plan #1710 E7) ---

/** Nur die Einstellungen des Teils „Beim Einrichten nötig“, mit lokalem Tracker als Fake-Board. */
const NUR_TEIL_EINS = {
  language: "de",
  codeHost: "local",
  issueTracker: "local",
  local: { issuesDir: "issues" },
  buildChecks: ["true"],
  mainBranch: "main",
  productionBranch: "production",
  issueReview: { reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }] },
};

/** Die Namen, an denen eine Zeile als Meldung zu einer Einstellung erkennbar ist: deutsch, englisch, die Datei. */
const NAMEN = [...new Set([...Object.keys(ZUORDNUNG), ...Object.keys(SCHLUESSEL).filter((k) => !k.includes("."))])];
const FEHLT = /fehlt|fehlen|fehlend|nicht gesetzt|ohne ihn|übernehmen|uebernehmen|missing|not set|copy the/i;

const nenntEinstellung = (z) => z.includes("workflow.config") || NAMEN.some((n) => new RegExp(String.raw`(?<![\w-])${n}(?![\w-])`).test(z));

/**
 * Die Meldungen einer Ausgabe, die eine fehlende Einstellung melden. Eine Meldung reicht über
 * bis zu zwei Zeilen: Der Schlusshinweis des Installers bricht nach dem Dateinamen um.
 */
function fehlendeEinstellungen(text) {
  const zeilen = text.split("\n");
  const meldungen = [];
  zeilen.forEach((z, i) => {
    if (!FEHLT.test(z)) return;
    const davor = i > 0 ? zeilen[i - 1] : "";
    if (nenntEinstellung(z)) meldungen.push(z);
    else if (!FEHLT.test(davor) && nenntEinstellung(davor)) meldungen.push(`${davor}\n${z}`);
  });
  return meldungen;
}

test("Gegenprobe: die Erkennung fehlender Einstellungen greift bei Name oder Datei, nicht bei Git", () => {
  assert.deepEqual(fehlendeEinstellungen([
    "Budget der Kette aus den Defaults: planMin=20 — night.kette in .claude/workflow.config.json fehlt oder setzt kein Feld.",
    "issueReview.reviewers ist leer oder fehlt",
    "! core.hooksPath nicht gesetzt — das Gate ist nicht aktiv.",
    "Keine Kette zu fahren: keine Karte traegt das Label 'kit:night'.",
  ].join("\n")).length, 2);
  // Der frühere Schlusshinweis des Installers, umgebrochen nach dem Dateinamen.
  assert.equal(fehlendeEinstellungen([
    "Fuer /issue-review: den 'issueReview'-Block aus workflow.config.example.jsonc",
    "heruebernehmen und an die eigenen Modelle anpassen. Ohne ihn tut der Skill nichts.",
  ].join("\n")).length, 1);
});

/** Das Wegwerf-Projekt: Git-Repo, nur die Einstellungen des ersten Teils, Kit per Update installiert und committet. */
function neuesProjekt() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "einstellungen-teil-eins-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "einstellungen-teil-eins-home-")));
  const git = (...a) => {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "README.md"), "Projekt\n");
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(NUR_TEIL_EINS, null, 2) + "\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Einstellungen des ersten Teils");
  const fake = join(home, "szenarien-fake.mjs");
  writeFileSync(fake, "console.log(JSON.stringify({ ab: 1 }));\n");
  // Projektlokal, Code und Issues lokal, alle Vorgaben, kein Hook, keine Bereiche.
  const install = spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
    cwd: dir,
    input: ["projekt", "local", "local", "", "", "", "", "", "", "", ""].join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, USERPROFILE: home, INSTALL_SZENARIEN_FAKE: fake },
  });
  // Board-Ablage und Fake-Dateien gehoeren nicht zum Arbeitsstand, wie in helpers/kette-ablauf.mjs.
  appendFileSync(join(dir, ".gitignore"), "issues/\nhelfer/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Kit installiert");
  return { dir, home, install };
}

test("Szenario: Neues Projekt einrichten", () => {
  // Angenommen ein Mensch richtet das Kit zum ersten Mal in einem Projekt ein
  for (const feld of Object.keys(NUR_TEIL_EINS)) assert.equal(teilVon(feld), "einrichten", feld);
  // Wenn er die Einstellungsseite oeffnet und nur die Einstellungen des ersten Teils setzt
  const seite = readFileSync(join(repoRoot, "docs", "einstellungen.md"), "utf-8");
  const block = seite.slice(seite.indexOf("<!-- einstellungen:start -->"), seite.indexOf("<!-- einstellungen:ende -->"));
  const zeilen = block.split("\n");
  const kopf = zeilen.findIndex((z) => z.startsWith("### "));
  assert.equal(zeilen[kopf], "### Beim Einrichten nötig", "der Block beginnt nicht mit dem ersten Teil");
  assert.equal(zeilen.slice(0, kopf).some((z) => z.startsWith("- `")), false, "vor dem ersten Teil steht eine Einstellung");
  const ende = zeilen.findIndex((z, i) => i > kopf && z.startsWith("### "));
  const teilEins = zeilen.slice(kopf, ende);
  // Dann steht jede dieser Einstellungen oben auf der Seite mit dem Satz, wann er sie setzt
  const tabelle = JSON.parse(readFileSync(join(repoRoot, "tools", "config-referenz.vorgaben.json"), "utf-8"));
  const wurzeln = Object.keys(ZUORDNUNG).filter((f) => ZUORDNUNG[f] === "einrichten");
  for (const feld of wurzeln) {
    const deutsch = Object.keys(tabelle).find((p) => (SCHLUESSEL[p] ?? p) === feld && !p.includes("."));
    const zeile = teilEins.find((z) => z.startsWith(`- \`${feld}\` — `));
    assert.ok(zeile, `${feld} fehlt im ersten Teil`);
    assert.ok(zeile.endsWith(" " + tabelle[deutsch].wann.de), `${feld} traegt seinen wann-Satz nicht: ${zeile}`);
  }

  // Und Einrichten, Prueflauf und Nachtlauf laufen ohne Meldung zu einer fehlenden Einstellung
  const { dir, home, install } = neuesProjekt();
  try {
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
    const env = { HOME: home, USERPROFILE: home };
    writeFileSync(join(dir, "README.md"), "Projekt, geaendert\n");
    const pruef = spawnSync(process.execPath, [join(dir, ".claude", "kit", "checks.mjs"), "run"], {
      cwd: dir, encoding: "utf-8", env: { ...process.env, ...env },
    });
    assert.equal(pruef.status, 0, `${pruef.stdout}\n${pruef.stderr}`);
    assert.match(pruef.stdout, /gelaufen: true/);
    spawnSync("git", ["checkout", "--", "README.md"], { cwd: dir });

    const F = fachplan(dir);
    const nacht = nachtLauf(dir, ["--chain"], { ...env, ...umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } }) });
    assert.equal(nacht.status, 0, `${nacht.stdout}\n${nacht.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");

    for (const [name, res] of [["install.mjs", install], ["checks.mjs run", pruef], ["night.mjs --chain", nacht]]) {
      assert.deepEqual(fehlendeEinstellungen(`${res.stdout}\n${res.stderr}`), [], `${name} meldet eine fehlende Einstellung`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// --- Szenario: Einstellung aus der Beispieldatei übernehmen (Issue #1735, Plan #1710 A9, E3) ---

test("Szenario: Einstellung aus der Beispieldatei übernehmen", () => {
  // Angenommen ein Projekt hat die Vorgeschichte nicht gesetzt
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "einstellungen-beispiel-")));
  try {
    mkdirSync(join(dir, "home"), { recursive: true });
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const configPfad = join(dir, ".claude", "workflow.config.json");
    writeFileSync(configPfad, JSON.stringify({ language: "de", codeHost: "github", issueTracker: "github" }, null, 2) + "\n");
    const fake = join(dir, "szenarien-fake.mjs");
    writeFileSync(fake, "console.log(JSON.stringify({ ab: 1 }));\n");
    const res = spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
      cwd: dir,
      input: ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""].join("\n") + "\n",
      encoding: "utf-8",
      env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), INSTALL_SZENARIEN_FAKE: fake },
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const beispielPfad = join(dir, ".claude", "workflow.config.example.jsonc");
    const vorher = readFileSync(beispielPfad);
    const zeilen = vorher.toString("utf-8").split("\n");

    // Wenn der Mensch in der Beispieldatei seines Projekts die Vorgeschichte findet,
    const i = zeilen.findIndex((z) => /^\s*\/\/ "history": /.test(z));
    assert.ok(i > 0, "die Vorgeschichte steht nicht auskommentiert in der Beispieldatei");
    // den Kommentar liest
    assert.match(zeilen[i - 1], /^\s*\/\/ \S/, "über der Zeile steht kein Kommentar");
    const seite = readFileSync(join(repoRoot, "docs", "einstellungen.md"), "utf-8");
    const seitenZeile = seite.split("\n").find((z) => z.startsWith("- `history` — "));
    assert.equal(zeilen[i - 1].trim(), `// ${seitenZeile.slice("- `history` — ".length)}`, "der Kommentar sagt nicht dasselbe wie die Seite");
    // und die Zeile in seine Einstellungsdatei übernimmt
    const uebernommen = zeilen[i].replace(/^\s*\/\/ /, "").replace(/,$/, "").replace("true", "false");
    const config = { ...JSON.parse(readFileSync(configPfad, "utf-8")), ...JSON.parse(`{${uebernommen}}`) };
    writeFileSync(configPfad, JSON.stringify(config, null, 2) + "\n");

    // Dann gilt der übernommene Wert,
    const { config: gelesen } = normalisiereConfig(JSON.parse(readFileSync(configPfad, "utf-8")));
    assert.equal(vorgeschichteAktiv(gelesen), false);
    // und die Beispieldatei ist unverändert
    assert.ok(readFileSync(beispielPfad).equals(vorher), "die Beispieldatei hat sich verändert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
