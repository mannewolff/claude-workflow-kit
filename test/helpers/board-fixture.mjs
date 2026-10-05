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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fakePath, GIT_BASH_ENV, TEST_TOOLBOX_BUDGET_MS } from "./adapter-fixture.mjs";

// Die In-Process-Attrappe des Board-Adapters (Issue #1211, Plan #1199, E6). Sie liegt in
// einem eigenen Helfer: Ein leichter Test laedt sie von dort, ohne mit dieser Fixture als
// Ablauf-Pruefung zu gelten.
export { boardAttrappe } from "./board-attrappe.mjs";

// Ebenso die leichten Fixtures der Adapter-Tests (Issue #1217): Sie stehen in
// adapter-fixture.mjs, die Ablauf-Tests laden sie unveraendert von hier.
export {
  TEST_TOOLBOX_BUDGET_MS, fakePath, GIT_BASH_ENV, cmdAttrappe, MIT_DATEIRECHTEN, setupProjekt, schreibeConfig,
  imProjekt, starteServer, fakeCli, aufrufe, aufrufZeilen, toolboxMitKommentaren,
} from "./adapter-fixture.mjs";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BOARD = join(repoRoot, "kit", "board.mjs");

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
 * in board-adapter-agent-model.test.mjs). Liefert immer {status, stdout, stderr} — auch bei
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
