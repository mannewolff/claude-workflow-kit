// Wegwerf-Repository fuer `spec.mjs apply` (Issue #450).
//
// `apply` liest aus zwei Quellen, die sich nicht sinnvoll nachbilden lassen: der
// Git-Historie zwischen Anker und HEAD und den Paket-Bodies ueber den Adapter
// (A11). Deshalb bekommt jeder Test ein echtes Repo im Temp-Verzeichnis und einen
// echten Adapter — kit/board.mjs wird nach .claude/kit/ kopiert und mit
// `issueTracker: local` gegen Dateien unter issues/ betrieben.
//
// Kein Mock des Adapters, ausdruecklich: Ein Mock wuerde genau die Frage
// offenlassen, um die es geht — ob `apply` die Bodies auf dem Weg bekommt, den es
// im Ernstfall geht. Der unlesbare Body entsteht deshalb auch nicht durch einen
// praeparierten Fehler, sondern durch eine Paketnummer, zu der unter issues/
// keine Datei liegt: genau das, was ein geloeschtes oder fremdes Issue erzeugt.
//
// Diese Datei enthaelt selbst keine Tests. Der node:test-Runner laedt trotzdem
// alles unter test/ und meldet sie als testlose Datei — das ist erwartet.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SPEC = join(repoRoot, "kit", "spec.mjs");
const BOARD = join(repoRoot, "kit", "board.mjs");
const FIXTURES = join(repoRoot, "test", "fixtures", "specs");

/** Der Stichtag der Fixtures. Pakete ab diesem Tag wertet `apply` (A18). */
export const SEIT = "2026-09-01";

export const BEREICHE = { alpha: ["kit/**"], beta: ["tools/**"], gamma: ["docs/**"] };

export const SPEC_BLOCK = { seit: SEIT, bereiche: BEREICHE };

export function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  return res.stdout.trim();
}

/** Roher Aufruf von spec.mjs — bei `apply` ist der Exit-Code selbst ein Ergebnis. */
export function spec(dir, ...cliArgs) {
  return spawnSync(process.execPath, [SPEC, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

/**
 * Legt das Wegwerf-Repo an: git, Config, Adapter unter .claude/kit/ und
 * optional eine Spec-Fixture unter specs/.
 *
 * `specBlock: null` laesst den Block weg (Projekt ohne beschriebenes Verhalten),
 * `fixture: null` laesst specs/ ganz fehlen (Projekt vor der ersten Aussage).
 */
export function repoAnlegen({ fixture = "zwei-bereiche", specBlock = SPEC_BLOCK } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "spec-apply-"));

  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  cpSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));

  const config = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
  if (specBlock !== null) config.spec = specBlock;
  writeFileSync(join(dir, ".claude", "workflow.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");

  if (fixture !== null) {
    mkdirSync(join(dir, "specs"), { recursive: true });
    cpSync(join(FIXTURES, fixture), join(dir, "specs"), { recursive: true });
  }

  writeFileSync(join(dir, "README.md"), "# Wegwerf\n", "utf-8");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

export function mitRepo(optionen, fn) {
  const dir = repoAnlegen(optionen);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Legt eine Paketdatei unter issues/ an, wie der lokale Tracker sie schreibt.
 * `created: null` laesst das Anlagedatum weg — der Zustand eines Trackers, der
 * keins liefert (Issue #457).
 */
export function paketAnlegen(dir, nummer, { wirkung = null, created = SEIT, titel = "Ein Paket" } = {}) {
  const issues = join(dir, "issues");
  mkdirSync(issues, { recursive: true });

  const meta = [`id: "${String(nummer).padStart(4, "0")}"`, "type: task", "status: ready", `title: ${titel}`];
  if (created !== null) meta.push(`created: ${created}`);

  const abschnitte = ["## Kontext", "", "Autor-Modell: claude-opus-5", "", "## Aufgabe", "", "Etwas tun.", ""];
  if (wirkung !== null) abschnitte.push("## Spec-Wirkung", "", ...(Array.isArray(wirkung) ? wirkung : [wirkung]), "");
  abschnitte.push("## Abhängigkeiten", "", "keine", "");

  writeFileSync(
    join(issues, `${String(nummer).padStart(4, "0")}.md`),
    `---\n${meta.join("\n")}\n---\n\n${abschnitte.join("\n")}`,
    "utf-8"
  );
}

/** Ein leerer Commit mit dieser Betreffzeile — die Marke ist der ganze Zweck. */
export function commit(dir, betreff, body = "") {
  const args = ["commit", "-q", "--allow-empty", "-m", betreff];
  if (body) args.push("-m", body);
  git(dir, ...args);
}

export function kopf(dir) {
  return git(dir, "rev-parse", "HEAD");
}

export function specText(dir, name) {
  return readFileSync(join(dir, "specs", name), "utf-8");
}

/**
 * Der Stand von specs/ als Text: jede Datei mit ihrem Inhalt, alphabetisch.
 * Fehlt das Verzeichnis, ist der Stand die leere Zeichenkette — so ist "es gibt
 * specs/ nicht" von "specs/ ist leer" unterscheidbar und beides vergleichbar.
 */
export function specStand(dir) {
  const verzeichnis = join(dir, "specs");
  if (!existsSync(verzeichnis)) return "";
  return readdirSync(verzeichnis, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort()
    .map((name) => `=== ${name}\n${readFileSync(join(verzeichnis, name), "utf-8")}`)
    .join("");
}

/** Das Verzeichnislisting des Projekts, rekursiv — ohne .git und ohne node_modules. */
export function listing(dir) {
  const gefunden = [];
  const offen = [""];
  while (offen.length > 0) {
    const rel = offen.pop();
    for (const eintrag of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (eintrag.name === ".git") continue;
      const pfad = rel === "" ? eintrag.name : `${rel}/${eintrag.name}`;
      gefunden.push(pfad);
      if (eintrag.isDirectory()) offen.push(pfad);
    }
  }
  return gefunden.sort();
}
