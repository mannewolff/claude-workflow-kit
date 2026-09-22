// Das Modell einer Karte (Issue #665, Plan #663).
//
// Der Nacht-Runner startete jede Session mit demselben Modell — `args.model`, einmal fuer
// den ganzen Lauf. Eine Empfehlung am Arbeitspaket hatte keine Wirkung. Jetzt laeuft die
// Session einer Karte mit dem Modell dieser Karte.
//
// Die Liste erlaubter Namen aus `night.modelle` ist die EINZIGE Pruefung (Plan #663, E3).
// Sie ist kein Komfort, sondern der Sicherheitskern: Ohne sie wanderte ein Wert aus einem
// Issue-Body unbesehen in `argv`, und ein Paket mit
// `Empfohlenes Modell: --dangerously-skip-permissions` waere ein Angriff ueber eine Karte.
// Ein Name ausserhalb der Liste faellt auf das Modell des Laufs zurueck, mit Grund in der
// Einheit. Ein Modell, das trotz gueltigen Namens nicht startet, bleibt ein Fehlschlag wie
// heute — `werteRunde` behandelt jeden Nicht-Timeout-Exit ungleich 0 so, und "nicht
// gestartet" waere von "abgestuerzt" nur durch Deutung von stderr zu unterscheiden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { empfohlenesModell, aufgabenStufe, stufenEinstellung, stufeStartbar, modellFuerStufe, paketWahl, frischeStufenFelder } from "../kit/night.mjs";

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const ERLAUBT = ["claude-opus-5", "claude-sonnet-5"];

// --- Die reine Funktion ---

test("[night-26] ein Name von der Liste wird uebernommen", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nEmpfohlenes Modell: claude-sonnet-5\n", ERLAUBT);
  assert.equal(modell, "claude-sonnet-5");
  assert.equal(grund, null, "ein uebernommener Name braucht keinen Grund");
});

test("[night-26] ein Name ausserhalb der Liste liefert null mit Grund", () => {
  const { modell, grund } = empfohlenesModell("Empfohlenes Modell: gpt-6-astra\n", ERLAUBT);
  assert.equal(modell, null);
  assert.ok(grund && grund.length > 0, "der Rueckfall braucht einen Grund");
  assert.match(grund, /gpt-6-astra/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-26] ein Wert mit fuehrendem Bindestrich gilt gar nicht erst als Treffer", () => {
  // Der Sicherheitskern. Der Wert darf nicht einmal als Kandidat entstehen — er stuende
  // sonst eine Vergleichsoperation davon entfernt, in argv zu landen.
  const { modell } = empfohlenesModell("Empfohlenes Modell: --dangerously-skip-permissions\n", ERLAUBT);
  assert.equal(modell, null, "ein Flag ist kein Modellname");
});

test("[night-26] ein Wert mit Leerzeichen gilt nicht als Treffer", () => {
  // Sonst waere `claude-opus-5 --dangerously-skip-permissions` ein Treffer, sobald der
  // Vergleich nur den Anfang prueft.
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5 --yolo\n", ERLAUBT).modell, null);
});

test("[night-26] eine fehlende Zeile liefert null ohne Grund", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nKein Hinweis hier.\n", ERLAUBT);
  assert.equal(modell, null);
  assert.equal(grund, null, "eine fehlende Empfehlung ist kein abgewiesener Name");
});

test("[night-26] eine fehlende oder leere Liste schaltet die Wirkung ab", () => {
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", []).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", undefined).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", null).modell, null);
});

test("[night-26] die Zeile ist am Zeilenanfang verankert", () => {
  // Sonst traefe eine Erwaehnung im Fliesstext ("... siehe Empfohlenes Modell: X ...").
  assert.equal(empfohlenesModell("siehe Empfohlenes Modell: claude-opus-5\n", ERLAUBT).modell, null);
});

// --- Der Runner: E2E gegen ein Temp-Repo ---

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Die Konfigurationsdatei des Fixtures — dieselbe Form wie die des Runners. */
function schreibeConfig(dir, { modelle = ERLAUBT, buildChecks = ["true"], stufen = null } = {}) {
  const night = { ...(modelle ? { modelle } : {}), ...(stufen ? { stufen } : {}) };
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
    ...(Object.keys(night).length > 0 ? { night } : {}),
  }, null, 2));
}

function setupProjekt(praefix, optionen = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  schreibeConfig(dir, optionen);
  // Die Konfigurationsdatei bleibt untracked (Issue #711): Der E19-Test schreibt sie
  // waehrend des Laufs um, und eine getrackte Datei machte damit den Baum dirty — der
  // Dirty-Guard stoppte den Lauf hart, bevor das zweite Paket ueberhaupt zieht.
  writeFileSync(join(dir, ".gitignore"),
    ".claude/night-run-*.log\n.claude/night-run-*.json\n.claude/workflow.config.json\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "t@example.invalid"]],
    ["git", ["config", "user.name", "T"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-qm", "Fixture"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel, empfehlung, stufe = null) {
  // `Autor-Modell:` ist Pflicht im Body — `issue create` weist ihn sonst ab.
  const zeile = empfehlung ? `Empfohlenes Modell: ${empfehlung}\n` : "";
  const stufenZeile = stufe ? `Aufgabenstufe: ${stufe}\n` : "";
  const body = `## Kontext\n\nAutor-Modell: claude-opus-5\n${zeile}${stufenZeile}\n## Abhaengigkeiten\nKeine.\n`;
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Eine Fake-CLI im PATH, die Argumente und KIT_AGENT_MODEL mitschreibt. */
function fakeCli(extra = "") {
  const binDir = mkdtempSync(join(tmpdir(), "night-modell-bin-"));
  const argLog = join(binDir, "args.txt");
  writeFileSync(join(binDir, "claude"),
    `#!/bin/sh\nprintf 'ARGS %s\\n' "$*" >> ${JSON.stringify(argLog)}\n` +
    `printf 'AGENT %s\\n' "$KIT_AGENT_MODEL" >> ${JSON.stringify(argLog)}\n${extra}exit 0\n`);
  chmodSync(join(binDir, "claude"), 0o755);
  return { binDir, argLog };
}

const staende = (dir) => readdirSync(join(dir, ".claude")).filter((n) => /^night-run-.*\.json$/.test(n)).sort();
const leseStand = (dir) => JSON.parse(readFileSync(join(dir, ".claude", staende(dir)[0]), "utf-8"));

test("[night-26] die Session startet mit dem Modell der Karte, in --model und KIT_AGENT_MODEL", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-karte-");
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.match(log, /--model claude-sonnet-5/, `die Karte setzt das Modell nicht durch:\n${log}`);
    assert.match(log, /AGENT claude-sonnet-5/, `KIT_AGENT_MODEL traegt nicht denselben Wert:\n${log}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-4] die Einheit traegt Modell, Herkunft und Grund", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-einheit-");
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt etwas Fremdes", "gpt-6-astra");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    // Der Rueckfall: ein Name ausserhalb der Liste laeuft mit dem Modell des Laufs.
    assert.match(readFileSync(bin.argLog, "utf-8"), /--model claude-opus-5/, "der Rueckfall greift nicht");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.modell, "claude-opus-5");
    assert.equal(einheit.modellHerkunft, "lauf");
    assert.ok(einheit.modellGrund && einheit.modellGrund.length > 0, "der Grund des Rueckfalls fehlt");
    assert.match(einheit.modellGrund, /gpt-6-astra/, "der Grund nennt den abgewiesenen Namen nicht");

    // Die Feldreihenfolge ist der Vertrag: die drei Felder stehen direkt nach titel.
    const schluessel = Object.keys(einheit);
    assert.deepEqual(schluessel.slice(0, 5), ["id", "titel", "modell", "modellHerkunft", "modellGrund"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] ein Flag als Empfehlung kommt nicht in die Argumente", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-flag-");
  let bin = null;
  try {
    readyIssue(dir, "Versucht ein Flag", "--dangerously-skip-permissions");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.doesNotMatch(log, /--dangerously-skip-permissions/, `der Wert aus der Karte steht in argv:\n${log}`);
    assert.match(log, /--model claude-opus-5/, "der Rueckfall greift nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] eine leere Liste schaltet die Wirkung ab", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-leer-", { modelle: [] });
  let bin = null;
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(readFileSync(bin.argLog, "utf-8"), /--model claude-opus-5/, "ohne Liste gilt das Modell des Laufs");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.modellHerkunft, "lauf");
    assert.equal(einheit.modellGrund, null, "eine leere Liste ist kein abgewiesener Name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] --dry-run nennt je Karte Modell und Herkunft", NUR_POSIX, () => {
  const dir = setupProjekt("night-modell-dry-");
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    readyIssue(dir, "Empfiehlt nichts", null);
    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none", "--model", "claude-opus-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Modell claude-sonnet-5 \(Karte\)/, `die Karte fehlt im Dry-Run:\n${res.stdout}`);
    assert.match(res.stdout, /Modell claude-opus-5 \(Lauf\)/, `der Rueckfall fehlt im Dry-Run:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die Stufenwahl (Issue #709, Plan #707) ---
//
// Vier Funktionen ohne Aufrufer: Die Stufe eines Pakets, die normalisierte Einstellung,
// die Startpruefung einer Stufe und das Ausweichen nach oben. Sie stehen hier unter Test,
// bevor `laufeRunde` sie im Folgepaket benutzt — das Ausweichen ueber zwei Stufen, der
// abgewiesene Stufenwert und die Kommandozeile mit vorangestellter Umgebung sind genau die
// Stellen, an denen ein Fehler still das falsche Modell startet.

test("[night-37] die Zeile Aufgabenstufe wird am Zeilenanfang gelesen", () => {
  for (const wert of ["schwer", "mittel", "leicht"]) {
    const { stufe, grund } = aufgabenStufe(`## Kontext\n\nAufgabenstufe: ${wert}\n`);
    assert.equal(stufe, wert);
    assert.equal(grund, null, "eine gelesene Stufe braucht keinen Grund");
  }
});

test("[night-37] eine eingerueckte Zeile und eine Erwaehnung im Fliesstext treffen nicht", () => {
  // Derselbe enge Anker wie bei EMPFOHLENES_MODELL_ZEILE.
  assert.equal(aufgabenStufe("  Aufgabenstufe: leicht\n").stufe, null, "eingerueckt ist kein Treffer");
  assert.equal(aufgabenStufe("siehe Aufgabenstufe: leicht\n").stufe, null, "Fliesstext ist kein Treffer");
  assert.equal(aufgabenStufe("Aufgabenstufe: leicht und schwer\n").stufe, null, "zwei Woerter sind kein Treffer");
});

test("[night-37] ein unbekannter Stufenwert liefert null mit Grund", () => {
  const { stufe, grund } = aufgabenStufe("Aufgabenstufe: mittelschwer\n");
  assert.equal(stufe, null);
  assert.ok(grund && grund.length > 0, "ein abgewiesener Wert braucht einen Grund");
  assert.match(grund, /mittelschwer/, "der Grund nennt den abgewiesenen Wert");
});

test("[night-37] eine fehlende Zeile liefert null ohne Grund", () => {
  const { stufe, grund } = aufgabenStufe("## Kontext\n\nKein Hinweis hier.\n");
  assert.equal(stufe, null);
  assert.equal(grund, null, "eine fehlende Stufe ist kein abgewiesener Wert");
});

test("[night-37] fehlender Block, leerer Block und leere Stufen ergeben aktiv false", () => {
  for (const config of [
    undefined,
    {},
    { night: {} },
    { night: { stufen: {} } },
    { night: { stufen: { schwer: {}, mittel: {}, leicht: {} } } },
    { night: { stufen: { schwer: { modell: "" }, leicht: { kommando: "  " } } } },
  ]) {
    const { aktiv, stufen } = stufenEinstellung(config);
    assert.equal(aktiv, false, `aktiv bei ${JSON.stringify(config)}`);
    assert.deepEqual(stufen, {}, "eine leere Stufe wird weggeworfen");
  }
});

test("[night-37] eine belegte Stufe genuegt fuer aktiv true", () => {
  // Teilbelegung ist der Normalfall (Plan #707, E4).
  const { aktiv, stufen } = stufenEinstellung({ night: { stufen: { schwer: { modell: "claude-opus-5" }, mittel: {} } } });
  assert.equal(aktiv, true);
  assert.deepEqual(Object.keys(stufen), ["schwer"], "nur die belegte Stufe bleibt stehen");
  assert.equal(stufen.schwer.modell, "claude-opus-5");
  assert.equal(stufen.schwer.kommando, null);
  assert.equal(stufen.schwer.name, null);
});

test("[night-37] eine Kommando-Stufe behaelt ihren Namen", () => {
  const { aktiv, stufen } = stufenEinstellung({ night: { stufen: { leicht: { kommando: "mein-runner --auftrag", name: "lokal" } } } });
  assert.equal(aktiv, true);
  // `effort: null` seit Issue #846: Der normalisierte Eintrag traegt das Feld immer,
  // eine Kommando-Stufe hat dort nie einen Wert.
  assert.deepEqual(stufen.leicht, { modell: null, kommando: "mein-runner --auftrag", name: "lokal", effort: null });
});

test("[night-37] das Ausweichen geht ueber zwei Stufen nach oben", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { schwer: { modell: "claude-opus-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "leicht", ERLAUBT);
  assert.equal(stufeVerwendet, "schwer");
  assert.equal(eintrag.modell, "claude-opus-5");
  assert.match(grund, /leicht/, "der Grund nennt die uebersprungene Stufe leicht");
  assert.match(grund, /mittel/, "der Grund nennt die uebersprungene Stufe mittel");
});

test("[night-37] eine belegte und startbare Stufe wird ohne Grund geliefert", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "leicht", ERLAUBT);
  assert.equal(stufeVerwendet, "leicht");
  assert.equal(eintrag.modell, "claude-sonnet-5");
  assert.equal(grund, null, "ohne uebersprungene Stufe gibt es nichts zu begruenden");
});

test("[night-37] keine hoehere Stufe belegt liefert stufeVerwendet null mit Grund", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "mittel", ERLAUBT);
  assert.equal(stufeVerwendet, null);
  assert.equal(eintrag, null);
  assert.match(grund, /mittel/, "der Grund nennt die unbelegte Stufe");
  assert.match(grund, /schwer/, "der Grund nennt auch die hoehere unbelegte Stufe");
});

test("[night-37] eine belegte, aber nicht startbare Stufe wird uebersprungen", () => {
  // `claude-fremd-5` steht nicht in night.modelle (E18) — die Stufe gilt als nicht startbar
  // und der Lauf weicht nach oben aus, mit dem Grund im Satz.
  const einstellung = stufenEinstellung({ night: { stufen: { mittel: { modell: "claude-fremd-5" }, schwer: { modell: "claude-opus-5" } } } });
  const { stufeVerwendet, grund } = modellFuerStufe(einstellung, "mittel", ERLAUBT);
  assert.equal(stufeVerwendet, "schwer");
  assert.match(grund, /mittel/, "der Grund nennt die uebersprungene Stufe");
  assert.match(grund, /nicht startbar/, "der Grund unterscheidet nicht startbar von nicht belegt");
  assert.match(grund, /claude-fremd-5/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-37] ein Stufen-Modellname ausserhalb night.modelle gilt als nicht startbar", () => {
  assert.equal(stufeStartbar({ modell: "claude-opus-5" }, ERLAUBT).ok, true);
  const { ok, grund } = stufeStartbar({ modell: "claude-fremd-5" }, ERLAUBT);
  assert.equal(ok, false);
  assert.match(grund, /night\.modelle/, "der Grund nennt die Liste, gegen die geprueft wird");
});

/** Ein ausfuehrbares Programm in einem eigenen Temp-Verzeichnis, erreichbar ueber PATH. */
function programmImPfad(name) {
  const binDir = mkdtempSync(join(tmpdir(), "night-stufe-bin-"));
  writeFileSync(join(binDir, name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(binDir, name), 0o755);
  return binDir;
}

function mitPfad(binDir, fn) {
  const alt = process.env.PATH;
  process.env.PATH = `${binDir}:${alt}`;
  try {
    return fn();
  } finally {
    process.env.PATH = alt;
  }
}

test("[night-37] ein auffindbares Programm im PATH gilt als startbar", NUR_POSIX, () => {
  const binDir = programmImPfad("mein-runner-xyz");
  try {
    mitPfad(binDir, () => {
      const { ok, grund } = stufeStartbar({ kommando: "mein-runner-xyz --auftrag" }, []);
      assert.equal(ok, true, `als nicht startbar gemeldet: ${grund}`);
      assert.equal(grund, null);
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("[night-37] eine fuehrende NAME=WERT-Zuweisung gilt nicht als Programmname", NUR_POSIX, () => {
  // Sonst suchte die Startpruefung nach einem Programm namens `KEIN_ECHTER_HOST=1` und
  // wiche still nach oben aus, obwohl das Programm da ist (Plan #707, E8).
  const binDir = programmImPfad("mein-runner-xyz");
  try {
    mitPfad(binDir, () => {
      const { ok } = stufeStartbar({ kommando: "KEIN_ECHTER_HOST=1 PORT=9 mein-runner-xyz --flag" }, []);
      assert.equal(ok, true, "die vorangestellte Umgebung verdeckt das Programm");
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("[night-37] ein nicht auffindbares Programm gilt als nicht startbar", NUR_POSIX, () => {
  const { ok, grund } = stufeStartbar({ kommando: "KEIN_ECHTER_HOST=1 gibt-es-nicht-xyz --flag" }, []);
  assert.equal(ok, false);
  assert.match(grund, /gibt-es-nicht-xyz/, "der Grund nennt das gesuchte Programm");
});

test("[night-37] ein Shell-Builtin gilt als startbar", NUR_POSIX, () => {
  // `command -v` findet Builtins; eine eigene PATH-Suche faende sie nicht (E8).
  assert.equal(stufeStartbar({ kommando: "cd /tmp" }, []).ok, true);
});

// --- Die Wahl je Paket (Issue #711, Plan #707, E5/E6) ---
//
// `paketWahl` ist die eine Stelle, an der Modellname und Stufe aufeinandertreffen. Die
// Reihenfolge ist der Gegenstand: erst der Name der Karte, dann — nur bei aktiver
// Einstellung — die Stufe, sonst das Modell des Laufs. Ein ABGEWIESENER Name faellt auf
// das Modell des Laufs und nicht auf die Stufe (E6): Ein Vertipper darf nicht still ein
// anderes Modell in Gang setzen.

const wahl = (body, stufen, laufModell = "claude-opus-5", erlaubte = ERLAUBT) =>
  paketWahl({ body, einstellung: stufenEinstellung({ night: { stufen } }), erlaubteModelle: erlaubte, laufModell });

test("[night-26] der Modellname der Karte gewinnt gegen die Stufe, mit Vermerk der doppelten Angabe", () => {
  const w = wahl("Empfohlenes Modell: claude-sonnet-5\nAufgabenstufe: leicht\n",
    { leicht: { modell: "claude-opus-5" } });
  assert.equal(w.modell, "claude-sonnet-5");
  assert.equal(w.herkunft, "karte");
  assert.equal(w.stufe, "leicht", "die Stufe der Karte steht trotzdem in der Einheit");
  assert.equal(w.stufeVerwendet, null, "die Stufe hat das Modell nicht gestellt");
  assert.ok(w.grund && w.grund.length > 0, "die doppelte Angabe braucht einen Vermerk");
  assert.match(w.grund, /leicht/, "der Vermerk nennt die uebergangene Stufe");
});

test("[night-26] ein abgewiesener Modellname faellt auf das Modell des Laufs und nicht auf die Stufe", () => {
  // E6: Der Rueckfall der Karte endet beim Lauf. Ginge er weiter zur Stufe, startete ein
  // Vertipper im Modellnamen still ein anderes Modell als das des Laufs.
  const w = wahl("Empfohlenes Modell: claude-gibt-es-nicht\nAufgabenstufe: leicht\n",
    { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufeVerwendet, null, "die Stufe darf den abgewiesenen Namen nicht auffangen");
  assert.match(w.grund, /claude-gibt-es-nicht/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-26] eine fehlende Stufe bei aktiver Einstellung ergibt das Modell des Laufs", () => {
  const w = wahl("## Kontext\n\nKein Hinweis hier.\n", { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufe, null);
  assert.equal(w.stufeVerwendet, null);
  assert.equal(w.grund, null, "eine fehlende Zeile ist kein Befund");
});

test("[night-26] eine Stufe ohne aktive Einstellung ergibt das Modell des Laufs", () => {
  const w = wahl("Aufgabenstufe: leicht\n", {});
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufe, "leicht", "die Stufe der Karte bleibt sichtbar");
  assert.equal(w.stufeVerwendet, null);
});

test("[night-26] die Stufe stellt das Modell und weicht nach oben aus", () => {
  const w = wahl("Aufgabenstufe: leicht\n", { schwer: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-sonnet-5");
  assert.equal(w.herkunft, "stufe");
  assert.equal(w.stufe, "leicht");
  assert.equal(w.stufeVerwendet, "schwer");
  assert.match(w.grund, /leicht/, "der Grund nennt die uebersprungene Stufe leicht");
  assert.match(w.grund, /mittel/, "der Grund nennt die uebersprungene Stufe mittel");
  assert.equal(w.startbar, true);
});

test("[night-26] eine Kommando-Stufe liefert Kommandozeile und Namen statt eines Modellnamens", NUR_POSIX, () => {
  const w = wahl("Aufgabenstufe: leicht\n", { leicht: { kommando: "cd /tmp", name: "lokal" } });
  assert.equal(w.kommando, "cd /tmp");
  assert.equal(w.stufenName, "lokal");
  assert.equal(w.herkunft, "stufe");
  assert.equal(w.modell, "lokal", "die Selbstauskunft der Stufe steht dort, wo sonst der Modellname steht");
  assert.equal(w.startbar, true);
});

test("[night-26] scheitert die Startpruefung auf allen Stufen, ist das Paket nicht startbar", () => {
  const w = wahl("Aufgabenstufe: mittel\n", { mittel: { modell: "claude-fremd-5" } });
  assert.equal(w.startbar, false, "ohne startbare Stufe darf keine Session beginnen");
  assert.equal(w.stufeVerwendet, null);
  assert.match(w.grund, /mittel/, "der Grund nennt die gescheiterte Stufe");
  assert.match(w.grund, /schwer/, "der Grund nennt auch die unbelegte hoehere Stufe");
});

test("[night-26] ein abgewiesener Stufenwert ergibt das Modell des Laufs, mit Grund", () => {
  const w = wahl("Aufgabenstufe: mittelschwer\n", { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.startbar, true, "ein unbrauchbarer Stufenwert haelt das Paket nicht auf");
  assert.match(w.grund, /mittelschwer/, "der Grund nennt den abgewiesenen Wert");
});

// --- Die frisch gelesene Einstellung (Issue #711, Plan #707, E19) ---

test("[night-26] frischeStufenFelder liest stufen und stufenRegel von Platte", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-frisch-"));
  try {
    const pfad = join(dir, "workflow.config.json");
    writeFileSync(pfad, JSON.stringify({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } }, stufenRegel: "eigene Regel" } }));
    const felder = frischeStufenFelder(pfad, { night: { stufen: { schwer: { modell: "claude-opus-5" } } } });
    assert.deepEqual(felder.stufen, { leicht: { modell: "claude-sonnet-5" } }, "der Stand des Laufbeginns wird ueberschrieben");
    assert.equal(felder.stufenRegel, "eigene Regel");
    assert.equal(felder.grund, null, "ein gelungener Lesevorgang braucht keinen Grund");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der Stufenweg im Lauf: E2E gegen ein Temp-Repo (Issue #711) ---

test("[night-26] die Session startet mit dem Modell der Stufe, wenn die Karte keinen Namen nennt", NUR_POSIX, () => {
  const dir = setupProjekt("night-stufe-lauf-", { stufen: { schwer: { modell: "claude-sonnet-5" } } });
  let bin = null;
  try {
    readyIssue(dir, "Leichtes Paket", null, "leicht");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.match(log, /--model claude-sonnet-5/, `die Stufe setzt das Modell nicht durch:\n${log}`);
    assert.match(log, /AGENT claude-sonnet-5/, "KIT_AGENT_MODEL traegt nicht denselben Wert");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.stufe, "leicht", "die Einheit nennt die Stufe des Pakets");
    assert.equal(einheit.stufeVerwendet, "schwer", "die Einheit nennt die Stufe, die das Modell gestellt hat");
    assert.equal(einheit.modellHerkunft, "stufe");
    assert.match(einheit.modellGrund, /leicht/, "der Grund nennt die uebersprungene Stufe leicht");
    assert.match(einheit.modellGrund, /mittel/, "der Grund nennt die uebersprungene Stufe mittel");
    // Die Protokollzeile der Runde nennt Stufe, eingesetztes Modell und den Ausweichgrund.
    assert.match(res.stdout, /Aufgabenstufe leicht/, `die Protokollzeile nennt die Stufe nicht:\n${res.stdout}`);
    assert.match(res.stdout, /claude-sonnet-5/, "die Protokollzeile nennt das eingesetzte Modell nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] ein Paket ohne startbare Stufe wird ohne Session verbucht, das naechste laeuft weiter", NUR_POSIX, () => {
  // Kriterium 10: Eine begonnene Umsetzung wird nie mit einem zweiten Modell wiederholt —
  // darum faellt die Entscheidung VOR der Session, und das Paket kostet keine.
  const dir = setupProjekt("night-stufe-unstartbar-", { stufen: { leicht: { kommando: "gibt-es-nicht-xyz-711 --auftrag" } } });
  let bin = null;
  try {
    const ohneStart = readyIssue(dir, "Leicht und nicht startbar", null, "leicht");
    const danach = readyIssue(dir, "Ohne Stufe", null, null);
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "2", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const einheiten = leseStand(dir).einheiten;
    const gescheitert = einheiten.find((e) => e.id === ohneStart);
    assert.equal(gescheitert.ausgang, "fehlschlag", "ein Paket ohne startbare Stufe ist ein Fehlschlag");
    assert.match(gescheitert.grund, /gibt-es-nicht-xyz-711/, "der Grund nennt das nicht auffindbare Programm");
    assert.equal(gescheitert.stufe, "leicht");
    assert.equal(gescheitert.stufeVerwendet, null, "keine Stufe hat das Modell gestellt");
    assert.ok(!gescheitert.kennzahlen, `ohne Session gibt es keine Kennzahlen: ${JSON.stringify(gescheitert.kennzahlen)}`);

    // Genau eine Session, und zwar die des zweiten Pakets.
    const log = readFileSync(bin.argLog, "utf-8");
    assert.equal((log.match(/^ARGS /gm) || []).length, 1, `genau eine Session erwartet:\n${log}`);
    assert.match(log, new RegExp(`/implement-next #${danach}`), "das naechste Ready-Paket lief nicht");
    assert.ok(einheiten.find((e) => e.id === danach), "das naechste Paket fehlt im Ergebnisstand");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] Modellname und Stufe zugleich: der Name laeuft, der Grund vermerkt beides", NUR_POSIX, () => {
  const dir = setupProjekt("night-stufe-doppelt-", { stufen: { leicht: { modell: "claude-opus-5" } } });
  let bin = null;
  try {
    readyIssue(dir, "Nennt beides", "claude-sonnet-5", "leicht");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(readFileSync(bin.argLog, "utf-8"), /--model claude-sonnet-5/, "der Name der Karte setzt sich nicht durch");

    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.modellHerkunft, "karte");
    assert.equal(einheit.stufe, "leicht");
    assert.equal(einheit.stufeVerwendet, null);
    assert.ok(einheit.modellGrund && einheit.modellGrund.length > 0, "die doppelte Angabe ist nicht vermerkt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] ein abgewiesener Modellname laeuft auf dem Modell des Laufs, nicht auf dem der Stufe", NUR_POSIX, () => {
  const dir = setupProjekt("night-stufe-abgewiesen-", { stufen: { leicht: { modell: "claude-sonnet-5" } } });
  let bin = null;
  try {
    readyIssue(dir, "Nennt einen Unbekannten", "claude-gibt-es-nicht", "leicht");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = readFileSync(bin.argLog, "utf-8");
    assert.match(log, /--model claude-opus-5/, "der Rueckfall endet nicht beim Modell des Laufs");
    assert.doesNotMatch(log, /--model claude-sonnet-5/, "der abgewiesene Name faellt faelschlich auf die Stufe");
    assert.equal(leseStand(dir).einheiten[0].modellHerkunft, "lauf");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] eine Aenderung an night.stufen wirkt schon beim naechsten Paket desselben Laufs", NUR_POSIX, () => {
  // E19: Die Einstellung wird unmittelbar vor jedem Paket frisch gelesen. Ohne das saehe
  // ein laufender Nachtlauf eine Aenderung erst am naechsten Abend.
  const dir = setupProjekt("night-stufe-frisch-", { stufen: { leicht: { modell: "claude-opus-5" } } });
  // Hilfsdateien liegen AUSSERHALB des Fixtures: Im Projektverzeichnis machten sie den
  // Baum dirty, und der Dirty-Guard stoppte den Lauf nach der ersten Runde hart.
  const hilf = mkdtempSync(join(tmpdir(), "night-stufe-frisch-hilf-"));
  let bin = null;
  try {
    readyIssue(dir, "Erstes leichtes Paket", null, "leicht");
    readyIssue(dir, "Zweites leichtes Paket", null, "leicht");
    const neueConfig = join(hilf, "neue-config.json");
    writeFileSync(neueConfig, JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
      night: { modelle: ERLAUBT, stufen: { leicht: { modell: "claude-sonnet-5" } } },
    }, null, 2));
    // Der Fake schreibt die Einstellung nach der ERSTEN Session um — genau die Lage, die
    // E19 beschreibt: Ein Mensch aendert die Datei, waehrend der Lauf laeuft.
    const marker = join(hilf, "erste-session.marker");
    bin = fakeCli(
      `if [ ! -f ${JSON.stringify(marker)} ]; then : > ${JSON.stringify(marker)};`
      + ` cp ${JSON.stringify(neueConfig)} ${JSON.stringify(join(dir, ".claude", "workflow.config.json"))}; fi\n`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "2", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const modelle = (readFileSync(bin.argLog, "utf-8").match(/--model (\S+)/g) || []);
    assert.deepEqual(modelle, ["--model claude-opus-5", "--model claude-sonnet-5"],
      "das zweite Paket laeuft nicht mit der geaenderten Einstellung");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(hilf, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-26] ein unlesbarer Stand liefert den Stand des Laufbeginns mit Grund", () => {
  // E19: Der Lauf darf daran nicht enden — er arbeitet mit dem weiter, was er beim Start
  // gelesen hat, und sagt im Protokoll, dass er es tut.
  const stand = { night: { stufen: { schwer: { modell: "claude-opus-5" } }, stufenRegel: "Regel vom Start" } };
  const felder = frischeStufenFelder(join(tmpdir(), "gibt-es-nicht-711", "workflow.config.json"), stand);
  assert.deepEqual(felder.stufen, { schwer: { modell: "claude-opus-5" } });
  assert.equal(felder.stufenRegel, "Regel vom Start");
  assert.ok(felder.grund && felder.grund.length > 0, "der Rueckfall auf den Startstand braucht einen Grund");
});

// --- Vorschau und Vorflug (Issue #712, Plan #707) ---
//
// Der Stufenweg wirkt (#711), aber vor dem Lauf sah der Mensch nichts davon. `--dry-run`
// nennt jetzt bei aktiver Einstellung je Ready-Paket die Stufe und das Modell, das
// eingesetzt wuerde; ein eigener Vorflug meldet je belegter Stufe ohne Netz, ob sie
// startbar ist — ohne den Lauf aufzuhalten (Kriterium 11).

test("[night-39] --dry-run nennt je Paket Stufe und Modell, samt Ausweichen nach oben", NUR_POSIX, () => {
  const dir = setupProjekt("night-dryrun-stufen-", {
    stufen: { leicht: { modell: "claude-sonnet-5" }, schwer: { modell: "claude-opus-5" } },
  });
  try {
    readyIssue(dir, "Leichtes Paket", null, "leicht");
    readyIssue(dir, "Mittleres Paket", null, "mittel");
    readyIssue(dir, "Paket ohne Stufe", null, null);
    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none", "--max", "3", "--model", "claude-opus-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.match(res.stdout, /Leichtes Paket -> Session \d+, Stufe leicht, Modell claude-sonnet-5 \(Stufe leicht\)$/m,
      `die belegte Stufe fehlt im Dry-Run:\n${res.stdout}`);
    assert.match(res.stdout, /Mittleres Paket -> Session \d+, Stufe mittel nicht belegt, Modell claude-opus-5 \(Stufe schwer\)$/m,
      `das Ausweichen nach oben fehlt im Dry-Run:\n${res.stdout}`);
    assert.match(res.stdout, /Paket ohne Stufe -> Session \d+, Modell claude-opus-5 \(Lauf\)$/m,
      `das Modell des Laufs fehlt im Dry-Run:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-39] Gegenprobe: ohne night.stufen bleibt die Vorschau zeichengleich mit vor der Aenderung", NUR_POSIX, () => {
  const dir = setupProjekt("night-dryrun-gegenprobe-");
  try {
    readyIssue(dir, "Empfiehlt sonnet", "claude-sonnet-5");
    readyIssue(dir, "Empfiehlt nichts", null);
    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none", "--max", "2", "--model", "claude-opus-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    // Fester, woertlicher Text von vor der Aenderung — kein Vergleich gegen den eigenen Code.
    assert.match(res.stdout, /Empfiehlt sonnet -> Session 1, Modell claude-sonnet-5 \(Karte\)$/m);
    assert.match(res.stdout, /Empfiehlt nichts -> Session 2, Modell claude-opus-5 \(Lauf\)$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-40] eine nicht startbare Stufe erzeugt eine Warnzeile im Vorflug, der Lauf beginnt trotzdem", NUR_POSIX, () => {
  const dir = setupProjekt("night-vorflug-stufen-", { stufen: { leicht: { kommando: "gibt-es-nicht-xyz-712 --auftrag" } } });
  let bin = null;
  try {
    readyIssue(dir, "Leichtes Paket", null, "leicht");
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const warnungen = res.stdout.match(/WARNUNG: Stufe leicht nicht startbar: .*gibt-es-nicht-xyz-712.*/g) || [];
    assert.equal(warnungen.length, 1, `genau eine Warnzeile erwartet:\n${res.stdout}`);

    // Der Lauf beginnt trotzdem: Exit-Code und Ergebnisstand sind dieselben wie ohne
    // Vorflug — das Paket selbst scheitert weiterhin ohne Session an derselben Stufe.
    const einheit = leseStand(dir).einheiten[0];
    assert.equal(einheit.ausgang, "fehlschlag");
    assert.equal(einheit.stufe, "leicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});

test("[night-40] ohne aktive Einstellung enthaelt die Ausgabe keine Stufen-Zeile", NUR_POSIX, () => {
  const dir = setupProjekt("night-vorflug-gegenprobe-");
  let bin = null;
  try {
    readyIssue(dir, "Normales Paket", null);
    bin = fakeCli();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--model", "claude-opus-5"],
      { PATH: `${bin.binDir}:${process.env.PATH}` });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /Stufe/, `keine Stufen-Zeile erwartet, aber:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (bin) rmSync(bin.binDir, { recursive: true, force: true });
  }
});
