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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { gitBashPfad } from "../../kit/board.mjs";

// Die In-Process-Attrappe des Board-Adapters (Issue #1211, Plan #1199, E6). Sie liegt in
// einem eigenen Helfer: Ein leichter Test laedt sie von dort, ohne mit dieser Fixture als
// Ablauf-Pruefung zu gelten.
export { boardAttrappe } from "./board-attrappe.mjs";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BOARD = join(repoRoot, "kit", "board.mjs");

/**
 * Das Budget der Toolbox-Wiederholschleife fuer jeden Prozess, den die Tests starten
 * (Issue #842). Ohne die Variable wiederholt der Adapter bei `5xx` und `429`, bis das
 * Gesamtbudget erschoepft ist — mit dem KIT_AGENT_MODEL der Fixture waeren das zwei
 * Minuten je Aufruf gegen einen dauerhaft fehlerhaften Mock-Server. Die gestellte Uhr
 * der Unit-Tests greift im Kindprozess nicht, deshalb der kurze Wert hier. Er liegt
 * unter der ersten Wartezeit der Staffel (500 ms): Es bleibt bei einem Versuch.
 */
export const TEST_TOOLBOX_BUDGET_MS = "200";

/**
 * Der PATH eines Fixtures: `fakebin` vor dem PATH des Rechners, getrennt nach der
 * Plattform (`;` unter Windows, `:` sonst — Issue #1135).
 */
export function fakePath(dir) {
  return `${join(dir, "fakebin")}${delimiter}${process.env.PATH}`;
}

/**
 * Die echte Git Bash, festgehalten, bevor ein Fixture ein Fake-`git` in den PATH legt
 * (Issue #1135). Unter Windows startet das Kit ein Fake ueber seine sh-Huelle in der Git
 * Bash und findet die ueber die `git.exe` im PATH (Plan #1128, E8). Ein Fake-`git` im
 * Fixture laege dort vor der echten und fuehrte die Suche ins Leere; mit der Variablen
 * entfaellt sie. Auf POSIX gibt es keine Git Bash zu suchen.
 */
const ECHTE_GIT_BASH = process.platform === "win32" ? gitBashPfad().pfad : null;
export const GIT_BASH_ENV = ECHTE_GIT_BASH ? { CLAUDE_CODE_GIT_BASH_PATH: ECHTE_GIT_BASH } : {};

/**
 * Legt neben ein endungsloses Fake die `.cmd`-Attrappe (Issue #1135). Unter Windows
 * findet die Suche im PATH nur Dateien mit einer Endung aus PATHEXT; das Kit startet dann
 * nicht die `.cmd`, sondern die sh-Huelle daneben ueber die Git Bash (Plan #1128, E8) —
 * genau so, wie npm ein CLI unter Windows ablegt. Auf POSIX bleibt die Attrappe liegen,
 * ohne dass sie jemand liest.
 */
export function cmdAttrappe(pfad) {
  writeFileSync(`${pfad}.cmd`, "@rem Huelle: das Kit startet die sh-Datei daneben.\r\n");
}

/**
 * Skip fuer Tests, die an POSIX-Dateirechten haengen (Issue #1135, Plan #1128, E6).
 *
 * Gemessen wird die Faehigkeit, nicht der Plattformname: Ein Verzeichnis ohne jedes
 * Recht muss sich dem Lesen verweigern. Das tut es nicht, wenn der Lauf als root geht —
 * auch auf Linux —, und nicht unter Windows, wo `chmod` nur das Schreibschutz-Attribut
 * kennt.
 */
function dateirechteGreifen() {
  const probe = mkdtempSync(join(tmpdir(), "rechte-probe-"));
  try {
    chmodSync(probe, 0o000);
    readdirSync(probe);
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(probe, 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}
export const MIT_DATEIRECHTEN = dateirechteGreifen()
  ? {}
  : { skip: "Dateirechte greifen hier nicht (Lauf als root oder ein Dateisystem ohne POSIX-Rechte) — der Test braucht eine Datei, die sich dem Zugriff verweigert." };

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
export function runBoard(dir, cliArgs, extraEnv = {}, spawnOpts = {}) {
  const env = { ...process.env };
  delete env.TBX_TOKEN;
  Object.assign(env, {
    PATH: fakePath(dir),
    ...GIT_BASH_ENV,
    KIT_ROOT: dir,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
    // Fester Wert statt Loeschen (Issue #266): `issue create` verlangt seit der
    // Autor-Modell-Leitplanke eine Angabe. Der Wert stammt aus dem Fixture und
    // nicht von der Entwicklermaschine — die urspruengliche Absicht des Loeschens
    // (kein Durchschlagen des Rechnerzustands) bleibt damit gewahrt. Tests, die
    // gerade das Fehlen pruefen, uebergeben KIT_AGENT_MODEL: "" in extraEnv.
    KIT_AGENT_MODEL: "fixture-modell",
    KIT_TOOLBOX_BUDGET_MS: TEST_TOOLBOX_BUDGET_MS, // siehe oben (Issue #842)
  }, extraEnv);
  // `spawnOpts` reicht einzelne spawnSync-Optionen durch (Issue #502): Nur ueber
  // `stdio` laesst sich eine stdin herstellen, aus der nicht gelesen werden kann —
  // der Fehlerweg von `--text -`. Alles andere bleibt wie gehabt.
  return spawnSync(process.execPath, [BOARD, ...cliArgs], { cwd: dir, encoding: "utf-8", env, ...spawnOpts });
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
 *
 * `stdinText` schreibt einen Rumpf in die stdin des Kindes und schliesst sie danach
 * (Issue #734): Der Sitzungs-Melder nimmt den Pfad des Protokolls aus dem Rumpf, den
 * ein Claude-Code-Hook dort hineinschreibt. Ohne den Parameter bleibt stdin leer und
 * wird sofort geschlossen — sonst wartete ein lesender Aufruf endlos.
 */
export function runBoardAsync(dir, cliArgs, extraEnv = {}, stdinText = "") {
  const env = { ...process.env };
  delete env.TBX_TOKEN;
  Object.assign(env, {
    PATH: fakePath(dir),
    ...GIT_BASH_ENV,
    KIT_ROOT: dir,
    TBX_CONFIG_DIR: join(dir, "tbx-config"),
    KIT_AGENT_MODEL: "fixture-modell", // siehe runBoard (Issue #266)
    KIT_TOOLBOX_BUDGET_MS: TEST_TOOLBOX_BUDGET_MS, // siehe runBoard (Issue #842)
  }, extraEnv);
  return new Promise((fertig) => {
    const kind = execFile(process.execPath, [BOARD, ...cliArgs], { cwd: dir, env }, (err, stdout, stderr) => {
      fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
    kind.stdin.end(stdinText);
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
 * mitten im Ablauf die Cache-Datei unter den Fuessen wegzieht. `loescht: pfad` ist
 * die zweite Haelfte davon (Issue #502): Der fremde Prozess kann die Datei auch
 * ganz entfernen, und das ist ein anderer Weg als eine zerschossene Datei.
 * Passt keine Regel, endet der Aufruf mit Exit 127 und einer sprechenden Meldung —
 * ein unerwartetes Kommando faellt so im Test auf, statt still zu gelingen.
 */
// Die Kommando-Grammatik liegt neben den Fixtures und wird an jedes Fake-Binary
// durchgereicht (Issue #217).
const GRAMMATIK_PFAD = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cli-grammar.json");

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
    `FAKE_CLI_NAME=${JSON.stringify(name)} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(implPfad)} ` +
      `${JSON.stringify(specPfad)} ${JSON.stringify(logPfad)} ${JSON.stringify(GRAMMATIK_PFAD)} "$@"`,
    "",
  ].join("\n");
  const cliPfad = join(binDir, name);
  writeFileSync(cliPfad, wrapper);
  chmodSync(cliPfad, 0o755);
  cmdAttrappe(cliPfad);
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
import { appendFileSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const [specPfad, logPfad, grammatikPfad, ...argv] = process.argv.slice(2);
const zeile = argv.join(" ");
const regeln = JSON.parse(readFileSync(specPfad, "utf-8"));

// Grammatik-Pruefung VOR dem Regel-Matching (Issue #217): Ein Fake, das nur die
// Regeln der Tests kennt, akzeptiert auch Kommandos, die es gar nicht gibt — so
// ueberlebte 'glab issue note create' monatelang, abgesichert von einem Test, der
// die kaputte Syntax festhielt (Issue #216). Steht das CLI nicht in der Grammatik
// (Fake-git, Fake-claude), wird nicht geprueft.
if (grammatikPfad && existsSync(grammatikPfad)) {
  const alle = JSON.parse(readFileSync(grammatikPfad, "utf-8"));
  const cliName = process.env.FAKE_CLI_NAME;
  const grammatik = cliName ? alle[cliName] : null;
  if (grammatik) {
    // Positionsargumente sind alles VOR dem ersten Flag. Nicht "alles ohne
    // Minus" — dabei zaehlten Flag-Werte mit (--json nameWithOwner) und jeder
    // Aufruf haette zu viele Argumente. Alle Aufrufe des Adapters halten diese
    // Reihenfolge ein, wie es bei gh und glab ueblich ist.
    const ersterFlag = argv.findIndex((a) => a.startsWith("-"));
    const positional = ersterFlag === -1 ? argv : argv.slice(0, ersterFlag);
    let treffer = null;
    for (const pfad of Object.keys(grammatik)) {
      const teile = pfad.split(" ");
      if (teile.every((t, i) => positional[i] === t)) {
        if (!treffer || pfad.split(" ").length > treffer.split(" ").length) treffer = pfad;
      }
    }
    if (!treffer) {
      const kandidaten = Object.keys(grammatik).filter((p) => p.split(" ")[0] === positional[0]);
      process.stderr.write(
        \`fake-cli: '\${cliName} \${zeile}' ist kein gueltiges Kommando.\n\` +
        \`Bekannte Kommandos\${positional[0] ? \` unter '\${positional[0]}'\` : ""}: \` +
        \`\${(kandidaten.length ? kandidaten : Object.keys(grammatik)).join(", ")}\n\`
      );
      process.exit(2);
    }
    const erwartet = grammatik[treffer].args;
    const gezaehlt = positional.length - treffer.split(" ").length;
    if (gezaehlt !== erwartet) {
      process.stderr.write(
        \`fake-cli: '\${cliName} \${treffer}' erwartet \${erwartet} Argument(e), bekam \${gezaehlt}: \${zeile}\n\`
      );
      process.exit(2);
    }
  }
}
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
if (regel.loescht) rmSync(resolve(regel.loescht), { force: true });
if (regel.stdout != null) {
  process.stdout.write(typeof regel.stdout === "string" ? regel.stdout : JSON.stringify(regel.stdout));
}
if (regel.stderr != null) process.stderr.write(regel.stderr);
process.exit(regel.exit ?? 0);
`;

/**
 * Antwortfunktion fuer `starteServer`: eine Toolbox mit Kommentar-Routen (Issue #1021).
 *
 * Die Kommentare liegen im uebergebenen Objekt `kommentare` (interne Karten-ID ->
 * Liste) und werden von PATCH wirklich veraendert — so laesst sich pruefen, dass genau
 * der gemeinte Kommentar ersetzt wird und die Zahl gleich bleibt. `patchRoute: false`
 * stellt eine aeltere Instanz ohne Bearbeiten-Route nach (405), `leseRoute: false`
 * eine, deren Lese-Route scheitert (500).
 *
 * Fuer `issue melden` (Issue #1022) legt POST einen Kommentar wirklich an und PUT auf
 * `/move` setzt die Spalte der Karte. `zustand.moveRoute = false` laesst den Zug
 * scheitern (500) — ein Objekt statt eines Werts, damit ein Test es zwischen zwei
 * Aufrufen umschalten kann.
 */
export function toolboxMitKommentaren({ karten, kommentare, patchRoute = true, leseRoute = true, zustand = {} }) {
  let naechsteId = 1000;
  return (req, koerper) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") {
      const gruppen = {};
      for (const k of karten) {
        gruppen[k.column] ||= [];
        gruppen[k.column].push(k);
      }
      return { status: 200, json: gruppen };
    }
    const zug = req.url.match(/^\/api\/kanban\/items\/(\d+)\/move$/);
    if (zug && req.method === "PUT") {
      if (zustand.moveRoute === false) return { status: 500, json: { message: "Zug kaputt" } };
      const karte = karten.find((k) => String(k.id) === zug[1]);
      if (!karte) return { status: 404, json: { message: "Karte nicht gefunden" } };
      karte.column = JSON.parse(koerper).column;
      return { status: 200, json: karte };
    }
    const treffer = req.url.match(/^\/api\/kanban\/items\/(\d+)\/comments(?:\/([^/]+))?$/);
    if (!treffer) return null;
    const [, itemId, kommentarId] = treffer;
    kommentare[itemId] ||= [];
    return kommentarRoute(req, koerper, kommentare[itemId], kommentarId);
  };

  function kommentarRoute(req, koerper, liste, kommentarId) {
    if (!kommentarId && req.method === "GET") {
      return leseRoute ? { status: 200, json: liste } : { status: 500, json: { message: "Kommentare kaputt" } };
    }
    if (!kommentarId && req.method === "POST") {
      const eintrag = { id: naechsteId++, author: "kit", body: JSON.parse(koerper).body, createdAt: "2026-09-29T12:00:00Z" };
      liste.push(eintrag);
      return { status: 201, json: eintrag };
    }
    if (kommentarId && req.method === "PATCH") {
      if (!patchRoute) return { status: 405, json: { message: "Method Not Allowed" } };
      const eintrag = liste.find((c) => String(c.id) === kommentarId);
      if (!eintrag) return { status: 404, json: { message: "Kommentar nicht gefunden" } };
      eintrag.body = JSON.parse(koerper).body;
      return { status: 200, json: eintrag };
    }
    return null;
  }
}
