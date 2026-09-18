// Der Sitzungs-Melder an den Hooks von Claude Code (Issue #735, Plan-Entscheidung E22).
//
// Der Melder aus Issue #734 existiert, aber niemand ruft ihn. Gerufen wird er von
// Claude Code selbst — ueber einen `hooks`-Block in `.claude/settings.json` des
// Projekts, den der Installer mitbringt. Eine nutzerweite Einstellung unter
// `~/.claude` war verworfen: Die Erfassung ist projektgebunden (E3), eine nutzerweite
// meldete aus jedem Verzeichnis.
//
// Der Installer ERGAENZT die Datei. Sie ist die geteilte Projektdatei von Claude Code
// und traegt env, sandbox und permissions; sie zu ersetzen naehme dem Projekt seine
// Einstellungen. Die vier Faelle, die daran haengen — leere Datei, Datei ohne hooks,
// Datei mit fremdem hooks-Eintrag, zweiter Lauf — stehen unten je einzeln.
//
// Sicherheitsvorkehrungen wie in test/install-preise-blob.test.mjs: cwd UND
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

// Kein Git-Repo im Wegwerf-Verzeichnis: Die Gate-Frage entfaellt damit und verbraucht
// keine Antwortzeile. Neun Antworten — Scope, codeHost, issueTracker, mainBranch,
// productionBranch, reviewScope, reviewModel, reviewCommand, Spec-Frage.
const PROJEKT = ["projekt", "github", "toolbox", "", "", "", "", "", "n"];
const GLOBAL = ["global", "github", "toolbox", "", "", "", "", "", ""];

function installiere(dir, antworten = PROJEKT) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

function fixture(praefix, settings) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  if (settings !== undefined) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"),
      typeof settings === "string" ? settings : JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
  return dir;
}

function mitFixture(praefix, settings, fn) {
  const dir = fixture(praefix, settings);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const settingsPfad = (dir) => join(dir, ".claude", "settings.json");
const liesSettings = (dir) => JSON.parse(readFileSync(settingsPfad(dir), "utf-8"));

/** Die Kommandos eines Ereignisses, flach — die Form der hooks ist zwei Ebenen tief. */
function kommandos(settings, event) {
  return (settings.hooks?.[event] ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
}

/** Das eine Kommando des Melders an einem Ereignis. */
function melderKommando(settings, event) {
  const treffer = kommandos(settings, event).filter((c) => c.includes("sitzung melden"));
  assert.equal(treffer.length, 1, `${event}: genau ein Eintrag des Melders erwartet, gefunden ${treffer.length}`);
  return treffer[0];
}

// --- Was der Installer eintraegt -------------------------------------------

test("[installer-9] in eine settings.json ohne hooks-Block kommen beide Eintraege, die uebrigen Schluessel bleiben", () => {
  const bestand = {
    env: { DOCKER_HOST: "unix:///var/run/docker.sock" },
    permissions: { allow: ["Bash(node .claude/kit/board.mjs:*)"] },
    sandbox: { enabled: true },
  };
  mitFixture("install-hooks-ohne-", bestand, (dir) => {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const settings = liesSettings(dir);
    // SessionEnd meldet abschliessend, Stop fortschreibend (E16). Ohne `--complete`
    // am Ende bliebe die Wegmarken-Datei stehen und die Sitzung offen.
    assert.match(melderKommando(settings, "SessionEnd"), /--complete/);
    assert.doesNotMatch(melderKommando(settings, "Stop"), /--complete/);

    // Der eigentliche Punkt: Der Installer ERGAENZT, er ersetzt nicht. Ginge hier
    // etwas verloren, naehme er dem Projekt seine Sandbox-Freigaben.
    assert.deepEqual(settings.env, bestand.env);
    assert.deepEqual(settings.permissions, bestand.permissions);
    assert.deepEqual(settings.sandbox, bestand.sandbox);
  });
});

test("[installer-9] ohne vorhandene settings.json legt der Installer sie an", () => {
  mitFixture("install-hooks-neu-", undefined, (dir) => {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(settingsPfad(dir)), "settings.json wurde nicht angelegt");
    const settings = liesSettings(dir);
    assert.ok(melderKommando(settings, "SessionEnd"));
    assert.ok(melderKommando(settings, "Stop"));
  });
});

test("[installer-9] ein fremder hooks-Eintrag bleibt stehen, unserer kommt daneben", () => {
  const fremd = "node .husky/zaehle-zuege.mjs";
  mitFixture("install-hooks-fremd-", {
    hooks: { Stop: [{ hooks: [{ type: "command", command: fremd }] }] },
  }, (dir) => {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const settings = liesSettings(dir);
    assert.ok(kommandos(settings, "Stop").includes(fremd), "der fremde Eintrag darf nicht verschwinden");
    assert.ok(melderKommando(settings, "Stop"), "unserer gehoert daneben");
    assert.ok(melderKommando(settings, "SessionEnd"));
  });
});

test("[installer-9] zweimal installieren ergibt dieselbe Datei wie einmal", () => {
  mitFixture("install-hooks-zweimal-", { env: { A: "1" } }, (dir) => {
    assert.equal(installiere(dir).status, 0);
    const nachErstem = readFileSync(settingsPfad(dir), "utf-8");
    const zweiter = installiere(dir);
    assert.equal(zweiter.status, 0, `${zweiter.stderr}\n${zweiter.stdout}`);

    // Byteweise: Ein zweiter Eintrag faellt ueber einen Vergleich der Kommandoliste
    // auch auf, eine stille Umformatierung der Datei aber nicht.
    assert.equal(readFileSync(settingsPfad(dir), "utf-8"), nachErstem,
      "der zweite Lauf hat die Datei veraendert");
    const settings = liesSettings(dir);
    assert.equal(kommandos(settings, "Stop").length, 1);
    assert.equal(kommandos(settings, "SessionEnd").length, 1);
  });
});

test("[installer-9] eine settings.json, die kein Objekt ist, wird nicht angefasst", () => {
  const kaputt = "{ das ist kein JSON\n";
  mitFixture("install-hooks-kaputt-", kaputt, (dir) => {
    const res = installiere(dir);
    assert.equal(res.status, 0, "eine fremde Datei ist kein Abbruchgrund");
    assert.equal(readFileSync(settingsPfad(dir), "utf-8"), kaputt,
      "was wir nicht lesen koennen, koennen wir auch nicht erhalten — also nicht schreiben");
    assert.match(res.stdout, /settings\.json/, "der Installer sagt, dass er es gelassen hat");
    assert.match(res.stdout, /sitzung melden/, "und nennt die Eintraege zum Nachtragen von Hand");
  });
});

test("[installer-9] bei globalem Install entsteht keine settings.json im Projekt", () => {
  mitFixture("install-hooks-global-", undefined, (dir) => {
    const res = installiere(dir, GLOBAL);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    // E22: Die Erfassung ist projektgebunden. Eine nutzerweite Einstellung meldete
    // aus jedem Verzeichnis, auch aus jedem fremden.
    assert.equal(existsSync(settingsPfad(dir)), false, "projektlokal darf nichts entstehen");
    assert.equal(existsSync(join(dir, "home", ".claude", "settings.json")), false,
      "und in den Nutzer-Einstellungen erst recht nicht");
  });
});

// --- Der hinterlegte Aufruf ist der Melder und laeuft ----------------------

test("[installer-9] der hinterlegte Aufruf ist der Melder aus #734 und liefert im Wegwerf-Verzeichnis ein", async () => {
  const { server, requests, host } = await starteServer((req) =>
    req.url === "/api/kanban/night-runs" && req.method === "POST" ? { status: 200, json: { outcome: "REPLACED" } } : null);
  const dir = fixture("install-hooks-lauf-", undefined);
  try {
    assert.equal(installiere(dir).status, 0);
    // Nur Kit, Config und Token — kein git, kein package.json, kein node_modules.
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ codeHost: "local", issueTracker: "toolbox", toolbox: { host, tokenFile: ".claude/kanban-token" } }, null, 2), "utf-8");
    writeFileSync(join(dir, ".claude", "kanban-token"), "projekt-token\n", "utf-8");
    const protokoll = join(dir, "protokoll.jsonl");
    writeFileSync(protokoll, JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-18T08:00:00.000Z",
      message: { id: "msg_a", model: "claude-sonnet-5", usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }) + "\n", "utf-8");

    // Genau das Kommando aus der Datei, nicht eines, das der Test danebenschreibt:
    // Ein Tippfehler im Eintrag faellt sonst nie auf.
    const befehl = melderKommando(liesSettings(dir), "SessionEnd").split(" ");
    assert.equal(befehl[0], "node", "der Eintrag ruft node auf");
    // Asynchron und NICHT mit spawnSync: Der Mock-Server laeuft im selben Prozess,
    // und ein blockierter Event-Loop koennte die Anfrage nie beantworten.
    const res = await new Promise((fertig) => {
      const kind = execFile(process.execPath, befehl.slice(1), {
        cwd: dir,
        env: {
          ...process.env,
          HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
          TBX_TOKEN: "", KIT_AGENT_MODEL: "", TBX_CONFIG_DIR: join(dir, "leer"),
        },
      }, (err, stdout, stderr) => fertig({ status: err ? (err.code ?? 1) : 0, stdout, stderr }));
      // Der Rumpf, den Claude Code einem Hook auf stdin hereinreicht. `transcript_path`
      // ist das Feld, aus dem der Melder den Protokollpfad nimmt (#734, E6).
      kind.stdin.end(JSON.stringify({
        session_id: "s-1",
        transcript_path: protokoll,
        cwd: dir,
        hook_event_name: "SessionEnd",
      }));
    });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).gemeldet, true, `der Hook-Aufruf hat nichts gemeldet: ${res.stdout}`);
    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0].body);
    assert.equal(body.kind, "INTERACTIVE");
    assert.equal(body.complete, true, "SessionEnd meldet abschliessend");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
});

// --- Was die Doku sagen muss ----------------------------------------------

test("[installer-10] die Kit-Dokumentation nennt den Hook, das Abschalten und die Worktree-Luecke", () => {
  const doku = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");
  // Beide Ereignisse beim Namen — wer den Hook sucht, sucht danach. In Backticks,
  // damit die Zusage nicht schon durch die "menschlichen Stop-Punkte" weiter oben
  // erfuellt waere: Die Aussage ist der Hook, nicht das Wort.
  assert.match(doku, /`SessionEnd`/, "das Ereignis am Sitzungsende gehoert genannt");
  assert.match(doku, /`Stop`/, "das Ereignis je Zug gehoert genannt");
  assert.match(doku, /`hooks`-Block in `\.claude\/settings\.json`/, "der Ort des Eintrags gehoert genannt");
  // Ein Hook, den man nicht abschalten kann, ist ein Zwang. Der Weg gehoert in die Doku.
  assert.match(doku, /\*\*Abschalten\.\*\*/, "wie man ihn abschaltet, gehoert in die Doku");
  // Die gemessene Luecke: Ein frischer Worktree traegt nur die versionierten Dateien,
  // also weder settings.json noch .claude/kit/ — dort meldet niemand.
  assert.match(doku, /Die bekannte Lücke: Worktrees/, "die Worktree-Luecke gehoert benannt");
});
