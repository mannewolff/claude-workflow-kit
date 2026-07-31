// Test-Infrastruktur fuer die board.mjs-Tests (Issue #188).
//
// Zwei Entscheidungen, die alle board-*-Tests teilen:
//
// 1. Es laeuft immer das ECHTE Script aus dem Repo (kit/board.mjs), nur mit cwd in
//    einem Fixture-Verzeichnis. Eine Kopie im Temp-Ordner waere genauso isoliert,
//    ihre Coverage laege aber unter einem Temp-Pfad, den SonarCloud nicht auf die
//    Repo-Datei abbilden kann — dieselbe Begruendung wie beim KIT_ROOT-Hook der
//    tools/-Scripts (Issue #186). Da board.mjs Config, Issues-Verzeichnis und
//    Meta-Cache alle relativ zum cwd aufloest, genuegt cwd fuer die Isolation;
//    KIT_ROOT deckt den einen verbleibenden Pfad ab (den Config-Fallback am
//    Script-Ort), damit nie versehentlich die Dogfooding-Config des Kit-Repos
//    einspringt.
//
// 2. gh und glab werden als Fake-Binaries im PATH ersetzt (Weg 1 aus Issue #188).
//    Der Adapter bleibt unangetastet, und die tatsaechlich abgesetzte Kommandozeile
//    wird mitgeprueft — inklusive des Quotings aus shellQuote(). Dasselbe Prinzip wie
//    der NIGHT_CLAUDE_CMD-Hook der night-Tests.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem alles
// unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { spawnSync, execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BOARD = join(repoRoot, "kit", "board.mjs");

/**
 * Legt ein Fixture-Projekt im Temp-Verzeichnis an. `config === null` laesst die
 * workflow.config.json bewusst weg (Fall "Installer noch nicht gelaufen").
 */
export function setupProjekt(config, praefix = "board-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (config !== null) {
    schreibeConfig(dir, config);
  }
  return dir;
}

/** Schreibt die workflow.config.json — als Objekt (serialisiert) oder als Rohtext. */
export function schreibeConfig(dir, config) {
  const inhalt = typeof config === "string" ? config : JSON.stringify(config, null, 2);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), inhalt);
}

/**
 * Startet kit/board.mjs aus dem Repo mit cwd im Fixture.
 *
 * Die Umgebung wird bewusst von allem befreit, was aus der Entwicklermaschine
 * durchschlagen koennte: TBX_CONFIG_DIR zeigt in einen leeren Fixture-Ordner (statt
 * auf ~/.config/toolbox-cli), TBX_TOKEN und KIT_AGENT_MODEL werden entfernt. Sonst
 * haengt das Testergebnis am Zustand des Rechners.
 */
export function runBoard(dir, cliArgs, extraEnv = {}) {
  const env = { ...process.env };
  delete env.TBX_TOKEN;
  delete env.KIT_AGENT_MODEL;
  Object.assign(env, {
    PATH: `${join(dir, "fakebin")}:${process.env.PATH}`,
    KIT_ROOT: dir,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
  }, extraEnv);
  return spawnSync(process.execPath, [BOARD, ...cliArgs], { cwd: dir, encoding: "utf-8", env });
}

/** Wie runBoard, erwartet aber Exit 0 und liefert die geparste JSON-Ausgabe. */
export function board(dir, ...cliArgs) {
  const res = runBoard(dir, cliArgs);
  if (res.status !== 0) {
    throw new Error(`board.mjs ${cliArgs.join(" ")} schlug fehl (Exit ${res.status}): ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

/**
 * Asynchrone Variante von runBoard fuer Tests mit lokalem Mock-Server.
 *
 * Der Server laeuft im selben Prozess wie der Test: Ein spawnSync wuerde dessen
 * Event-Loop blockieren und der Request nie bedient werden (dieselbe Begruendung wie
 * in board-agent-model.test.mjs). Liefert immer {status, stdout, stderr} — auch bei
 * Exit ungleich 0, damit Fehlerpfade wie Erfolgspfade geprueft werden koennen.
 */
export function runBoardAsync(dir, cliArgs, extraEnv = {}) {
  const env = { ...process.env };
  delete env.TBX_TOKEN;
  delete env.KIT_AGENT_MODEL;
  Object.assign(env, {
    PATH: `${join(dir, "fakebin")}:${process.env.PATH}`,
    KIT_ROOT: dir,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
  }, extraEnv);
  return new Promise((fertig) => {
    execFile(process.execPath, [BOARD, ...cliArgs], { cwd: dir, env }, (err, stdout, stderr) => {
      fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/**
 * Startet einen lokalen HTTP-Mock auf 127.0.0.1 mit zufaelligem Port.
 *
 * `antwort(req, koerper)` liefert { status, json } oder { status, text }; gibt sie
 * nichts zurueck, antwortet der Server mit 404. Alle Requests werden mitgeschrieben,
 * damit Pfad, Methode und Rumpf pruefbar sind.
 */
export function starteServer(antwort) {
  const requests = [];
  const server = createServer((req, res) => {
    const teile = [];
    req.on("data", (chunk) => teile.push(chunk));
    req.on("end", () => {
      const koerper = Buffer.concat(teile).toString("utf-8");
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: koerper });
      const ergebnis = antwort(req, koerper) || { status: 404, json: { message: `keine Route fuer ${req.method} ${req.url}` } };
      const rumpf = ergebnis.text ?? JSON.stringify(ergebnis.json ?? {});
      res.writeHead(ergebnis.status ?? 200, { "Content-Type": ergebnis.text ? "text/plain" : "application/json" });
      res.end(rumpf);
    });
  });
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => {
      fertig({ server, requests, host: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/**
 * Legt ein Fake-Binary (gh, glab, git ...) im PATH des Fixtures an.
 *
 * `regeln` ist eine Liste aus { match, stdout, stderr, exit, times, schreibt }: Die
 * erste Regel, deren `match`-Regex auf die zusammengesetzte Kommandozeile passt und
 * deren Aufruf-Kontingent (`times`) noch nicht erschoepft ist, bestimmt die Antwort.
 * Das `times`-Feld macht Retry-Pfade testbar (erster Aufruf scheitert, zweiter
 * gelingt). `schreibt: { pfad, inhalt }` legt vor der Antwort eine Datei relativ zum
 * cwd an — damit laesst sich nachstellen, dass ein fremder Prozess dem Adapter
 * mitten im Ablauf die Cache-Datei unter den Fuessen wegzieht.
 * Passt keine Regel, endet der Aufruf mit Exit 127 und einer sprechenden Meldung —
 * ein unerwartetes Kommando faellt so im Test auf, statt still zu gelingen.
 */
export function fakeCli(dir, name, regeln) {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const specPfad = join(binDir, `${name}.spec.json`);
  const logPfad = join(binDir, `${name}.log.jsonl`);
  writeFileSync(specPfad, JSON.stringify(regeln, null, 2));

  const implPfad = join(binDir, `${name}-impl.mjs`);
  writeFileSync(implPfad, FAKE_IMPL);

  // sh-Wrapper statt Shebang auf die .mjs-Datei: So ist die Dateiendung eindeutig
  // (Node wuerde eine endungslose Datei mit import-Syntax als CommonJS lesen).
  const wrapper = [
    "#!/bin/sh",
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(implPfad)} ` +
      `${JSON.stringify(specPfad)} ${JSON.stringify(logPfad)} "$@"`,
    "",
  ].join("\n");
  const cliPfad = join(binDir, name);
  writeFileSync(cliPfad, wrapper);
  chmodSync(cliPfad, 0o755);
}

/** Die Argumentlisten aller Aufrufe eines Fake-Binaries, in Aufrufreihenfolge. */
export function aufrufe(dir, name) {
  const logPfad = join(dir, "fakebin", `${name}.log.jsonl`);
  if (!existsSync(logPfad)) return [];
  return readFileSync(logPfad, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((z) => JSON.parse(z).argv);
}

/** Die Aufrufe als eine Zeile pro Aufruf — bequem fuer Regex-Assertions. */
export function aufrufZeilen(dir, name) {
  return aufrufe(dir, name).map((argv) => argv.join(" "));
}

const FAKE_IMPL = `// Generiert von test/helpers/board-fixture.mjs (Issue #188) — kein Produktivcode.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [specPfad, logPfad, ...argv] = process.argv.slice(2);
const zeile = argv.join(" ");
const regeln = JSON.parse(readFileSync(specPfad, "utf-8"));
const bisher = existsSync(logPfad)
  ? readFileSync(logPfad, "utf-8").split("\\n").filter(Boolean).map((z) => JSON.parse(z))
  : [];

let index = -1;
for (let i = 0; i < regeln.length; i++) {
  const r = regeln[i];
  if (!new RegExp(r.match).test(zeile)) continue;
  if (r.times != null && bisher.filter((e) => e.regel === i).length >= r.times) continue;
  index = i;
  break;
}

appendFileSync(logPfad, JSON.stringify({ argv, regel: index }) + "\\n");

if (index === -1) {
  process.stderr.write(\`fake-cli: keine Regel fuer: \${zeile}\\n\`);
  process.exit(127);
}
const regel = regeln[index];
if (regel.schreibt) writeFileSync(resolve(regel.schreibt.pfad), regel.schreibt.inhalt, "utf-8");
if (regel.stdout != null) {
  process.stdout.write(typeof regel.stdout === "string" ? regel.stdout : JSON.stringify(regel.stdout));
}
if (regel.stderr != null) process.stderr.write(regel.stderr);
process.exit(regel.exit ?? 0);
`;
