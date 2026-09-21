// Auslieferung der Preistabelle und der Lauf des Melders ohne Repo-Kontext (Issue #734).
//
// Zwei Zusagen des Arbeitspakets haengen aneinander und werden deshalb in EINEM Lauf
// geprueft, nicht in zweien:
//
// 1. kit/preise.mjs wird ausgeliefert. Ein Werkzeug, das nur im Kit-Repo liegt, ist
//    gebaut, aber nicht verteilt — dieselbe Luecke wie bei checks.mjs (#425) und
//    spec.mjs (#441).
// 2. "Das Tool bleibt ohne weiteren Repo-Kontext lauffaehig: aus einem Wegwerf-
//    Verzeichnis heraus aufrufbar, in dem nur das Kit, eine workflow.config.json und
//    ein Token liegen."
//
// Dass beides zusammengehoert, zeigt der Dollarbetrag: Er entsteht nur, wenn board.mjs
// die Preistabelle NEBEN SICH findet. Ein Lauf, der bloss Exit 0 prueft, saehe eine
// fehlende Preistabelle nicht — der Melder kommt ohne sie aus und meldete stillschweigend
// keinen Betrag mehr.
//
// Sicherheitsvorkehrungen wie in test/install-spec-blob.test.mjs: cwd UND
// HOME/USERPROFILE zeigen ins Wegwerf-Verzeichnis, damit kein Testlauf die echte
// Konfiguration anfasst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { starteServer } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");
// Alle Nachbardateien in einem Lauf: Ein zweiter Installer-Lauf kostete Sekunden und
// belegte dasselbe. aufwand.mjs kam mit Issue #750 dazu, wirksamkeit.mjs mit #787.
const AUSGELIEFERT = ["preise.mjs", "aufwand.mjs", "wirksamkeit.mjs"];

// Der kuerzeste Weg durch die Fragen: projektlokal, GitHub, alle Defaults.
const PROJEKT_GITHUB = ["projekt", "github", "github", "", "", "", "", "", ""];

function installiere(dir) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: PROJEKT_GITHUB.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

/** Ein frisch installiertes Wegwerf-Projekt. */
function installiertesProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  const res = installiere(dir);
  assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
  return { dir, ausgabe: res.stdout };
}

// `[installer-11]` gilt aufwand.mjs (Issue #750), `[installer-13]` wirksamkeit.mjs
// (Issue #787). preise.mjs steht ohne eigene ID daneben: Ihre Auslieferung war
// bestehendes Verhalten, als sie dazukam — der Beleg gehoert trotzdem hierher, sonst
// faellt sie beim naechsten Werkzeug aus dem Blick.
test("[installer-11] [installer-13] der Installer schreibt die Nachbardateien byteweise identisch zur Quelle", () => {
  const { dir, ausgabe } = installiertesProjekt("install-preise-blob-");
  try {
    for (const datei of AUSGELIEFERT) {
      const ziel = join(dir, ".claude", "kit", datei);
      assert.ok(existsSync(ziel), `${datei} wurde nicht ausgeliefert`);
      // Byteweise, nicht als Text: Ein Blob, der beim Kodieren die Kodierung wechselt,
      // faellt ueber einen utf-8-Vergleich nicht auf.
      assert.ok(
        readFileSync(ziel).equals(readFileSync(join(repoRoot, "kit", datei))),
        `die ausgelieferte Datei weicht von kit/${datei} ab — Blob nicht nachgezogen?`
      );
      assert.ok(ausgabe.includes(`${datei} geschrieben:`), `der Installer meldet ${datei} nicht`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[board-11] [board-15] der Melder laeuft im installierten Projekt und rechnet den Betrag", async () => {
  const { server, requests, host } = await starteServer((req) =>
    req.url === "/api/kanban/night-runs" && req.method === "POST" ? { status: 200, json: { outcome: "REPLACED" } } : null);
  const { dir } = installiertesProjekt("install-preise-lauf-");
  try {
    // Genau das, was das Akzeptanzkriterium nennt: Kit, Config, Token — sonst nichts.
    // Kein git, kein package.json, keine Issues, kein node_modules.
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ codeHost: "local", issueTracker: "toolbox", toolbox: { host, tokenFile: ".claude/kanban-token" } }, null, 2), "utf-8");
    writeFileSync(join(dir, ".claude", "kanban-token"), "projekt-token\n", "utf-8");
    const protokoll = join(dir, "protokoll.jsonl");
    writeFileSync(protokoll, JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-18T08:00:00.000Z",
      message: { id: "msg_a", model: "claude-sonnet-5", usage: { input_tokens: 0, output_tokens: 1e6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }) + "\n", "utf-8");

    const res = await new Promise((fertig) => {
      const kind = execFile(process.execPath, [join(dir, ".claude", "kit", "board.mjs"), "sitzung", "melden", "--protokoll", protokoll, "--complete"], {
        cwd: dir,
        // TBX_CONFIG_DIR zeigt ins Wegwerf-Verzeichnis: Ohne das koennte der globale
        // tbx-Login der Entwicklermaschine einspringen und der Test bewiese nichts.
        env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), TBX_TOKEN: "", KIT_AGENT_MODEL: "", TBX_CONFIG_DIR: join(dir, "leer") },
      }, (err, stdout, stderr) => fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr }));
      kind.stdin.end("");
    });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).gemeldet, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-kanban-token"], "projekt-token", "das Zielprojekt kommt aus der Bindung des Tokens (E3)");
    const body = JSON.parse(requests[0].body);
    assert.equal(body.kind, "INTERACTIVE");
    // 1.000.000 Ausgabe-Token zu 15 Dollar je Million — der Beleg, dass die
    // Preistabelle neben board.mjs gefunden wurde.
    assert.equal(body.usage.costUsd, 15);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});
