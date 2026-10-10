// `issue-review start` im selben Prozess (Issue #1381, Plan #1375, A4, A5, A6): Das Kit startet
// den fremden Pruefer selbst und haengt seine Lesegrenze an. `spawn` und die PATH-Suche sind
// injiziert; ein Aufruf, der nicht sein darf, scheitert am Wurf. Auftrag und Ausgabe liegen in
// einem eigenen Verzeichnis unter dem tmpdir des Systems.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { issueReviewStart, lesegrenzeVon } from "../kit/board/issue-review.mjs";

const PFAD = "/fake/bin/codex";
const IM_PATH = (kommando) => ({ datei: kommando.split(" ")[0], ok: true, pfad: PFAD });
const NICHT_IM_PATH = (kommando) => ({ datei: kommando.split(" ")[0], ok: false, pfad: null });
const KEIN_AUFRUF = () => { throw new Error("darf nicht aufgerufen werden"); };

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const CODEX = { name: "gpt-astra", kind: "command", command: "codex exec --model gpt-5" };
const FREMD = { name: "fremd", kind: "command", command: "fremdtool run", lesegrenze: "--nur-lesen --kein-netz" };
const OHNE = { name: "ohne", kind: "command", command: "fremdtool run" };

const config = (reviewers, extra = {}) => ({ issueReview: { reviewers }, ...extra });

/** Ein spawn, das seine Aufrufe mitschreibt und `ergebnis` liefert. */
function spawnMit(ergebnis) {
  const aufrufe = [];
  const spawn = (befehl, args, optionen) => { aufrufe.push({ befehl, args, optionen }); return ergebnis; };
  return { spawn, aufrufe };
}

/** Legt Auftrag und Ausgabepfad in einem frischen Verzeichnis an und raeumt danach. */
function mitDateien(fn) {
  const dir = mkdtempSync(join(tmpdir(), "ireview-start-"));
  try {
    const auftrag = join(dir, "auftrag.md");
    writeFileSync(auftrag, "PRUEFAUFTRAG\n");
    return fn({ auftrag, ausgabe: join(dir, "antwort.md") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Lesegrenze (A5) ---

test("lesegrenzeVon: codex bekommt --sandbox read-only aus der Tabelle", () => {
  assert.deepEqual(lesegrenzeVon({ command: "codex exec --model gpt-5" }), ["--sandbox", "read-only"]);
  // Auch mit Pfad vor dem Werkzeug: Entscheidend ist der Dateiname.
  assert.deepEqual(lesegrenzeVon({ command: "/usr/local/bin/codex exec" }), ["--sandbox", "read-only"]);
});

test("lesegrenzeVon: das Feld schlaegt die Tabelle", () => {
  assert.deepEqual(lesegrenzeVon({ command: "codex exec", lesegrenze: "--sandbox read-only -c x=1" }), ["--sandbox", "read-only", "-c", "x=1"]);
  assert.deepEqual(lesegrenzeVon({ command: "fremdtool run", lesegrenze: "--nur-lesen" }), ["--nur-lesen"]);
});

test("lesegrenzeVon: ein unbekanntes Werkzeug ohne Feld hat keine Lesegrenze", () => {
  assert.equal(lesegrenzeVon({ command: "fremdtool run" }), null);
  // Ein leeres Feld ist keine Grenze.
  assert.equal(lesegrenzeVon({ command: "fremdtool run", lesegrenze: "   " }), null);
});

// --- Start ---

test("start: der Auftrag geht ueber stdin, die Lesegrenze steht als letztes Argument", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn, aufrufe } = spawnMit({ status: 0, stdout: "BEFUNDE\n", stderr: "" });
    const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([OPUS, CODEX]), spawn, verfuegbar: IM_PATH });
    assert.deepEqual(antwort, { ok: true, reviewer: "gpt-astra", lesegrenze: "--sandbox read-only", ausgabe, zeichen: 8 });
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].befehl, PFAD);
    assert.deepEqual(aufrufe[0].args, ["exec", "--model", "gpt-5", "--sandbox", "read-only"]);
    assert.equal(aufrufe[0].optionen.input, "PRUEFAUFTRAG\n");
    assert.equal(aufrufe[0].optionen.shell, undefined, "gestartet wird ohne Shell");
    assert.equal(readFileSync(ausgabe, "utf-8"), "BEFUNDE\n");
  });
});

test("start: die Lesegrenze aus dem Feld wird angehaengt", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn, aufrufe } = spawnMit({ status: 0, stdout: "x", stderr: "" });
    const antwort = issueReviewStart({ reviewer: "fremd", auftrag, ausgabe }, { config: config([FREMD]), spawn, verfuegbar: IM_PATH });
    assert.equal(antwort.ok, true);
    assert.deepEqual(aufrufe[0].args, ["run", "--nur-lesen", "--kein-netz"]);
  });
});

test("start: ohne bekannte Lesegrenze startet kein Pruefer", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const antwort = issueReviewStart({ reviewer: "ohne", auftrag, ausgabe }, { config: config([OHNE]), spawn: KEIN_AUFRUF, verfuegbar: IM_PATH });
    assert.equal(antwort.ok, false);
    assert.equal(antwort.fehler, "keine-lesegrenze");
    assert.equal(antwort.reviewer, "ohne");
    assert.match(antwort.grund, /keine Lesegrenze/);
    assert.equal(existsSync(ausgabe), false);
  });
});

for (const [was, command] of [
  ["--full-auto", "codex exec --full-auto"],
  ["--dangerously-bypass-approvals-and-sandbox", "codex exec --dangerously-bypass-approvals-and-sandbox"],
  ["--sandbox mit anderem Wert", "codex exec --sandbox workspace-write"],
  ["--sandbox= mit anderem Wert", "codex exec --sandbox=danger-full-access"],
  ["-s mit anderem Wert", "codex exec -s danger-full-access"],
  ["-c sandbox_mode=…", "codex exec -c sandbox_mode=\"danger-full-access\""],
  ["-c sandbox_mode …", "codex exec -c sandbox_mode danger-full-access"],
  ["--config sandbox_mode=…", "codex exec --config sandbox_mode=workspace-write"],
  ["--profile", "codex exec --profile frei"],
  ["--profile=", "codex exec --profile=frei"],
  ["-p", "codex exec -p frei"],
]) {
  test(`start: ${was} wird abgewiesen, ohne zu starten`, () => {
    mitDateien(({ auftrag, ausgabe }) => {
      const reviewer = { name: "gpt-astra", kind: "command", command };
      const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([reviewer]), spawn: KEIN_AUFRUF, verfuegbar: IM_PATH });
      assert.equal(antwort.ok, false);
      assert.equal(antwort.fehler, "lesegrenze-aufgehoben");
      assert.ok(antwort.schalter, "der Schalter wird genannt");
      assert.equal(existsSync(ausgabe), false);
    });
  });
}

test("start: ein aufhebender Schalter im Feld lesegrenze wird ebenso abgewiesen", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const reviewer = { name: "fremd", kind: "command", command: "fremdtool run", lesegrenze: "--full-auto" };
    const antwort = issueReviewStart({ reviewer: "fremd", auftrag, ausgabe }, { config: config([reviewer]), spawn: KEIN_AUFRUF, verfuegbar: IM_PATH });
    assert.equal(antwort.fehler, "lesegrenze-aufgehoben");
    assert.equal(antwort.schalter, "--full-auto");
  });
});

test("start: --sandbox read-only in der Kommandozeile ist erlaubt", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const reviewer = { name: "gpt-astra", kind: "command", command: "codex exec -s read-only" };
    const { spawn } = spawnMit({ status: 0, stdout: "x", stderr: "" });
    assert.equal(issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([reviewer]), spawn, verfuegbar: IM_PATH }).ok, true);
  });
});

test("start: Exit ungleich 0 ist ein Ausfall mit stderr-Ausschnitt, ohne Ausgabedatei", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn } = spawnMit({ status: 2, stdout: "halb", stderr: "Warnung\nmodel is not supported\n" });
    const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([CODEX]), spawn, verfuegbar: IM_PATH });
    assert.equal(antwort.ok, false);
    assert.equal(antwort.fehler, "ausfall");
    assert.equal(antwort.exit, 2);
    assert.match(antwort.stderr, /model is not supported/);
    assert.equal(existsSync(ausgabe), false);
  });
});

test("start: der stderr-Ausschnitt ist auf das Ende gekuerzt", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn } = spawnMit({ status: 1, stdout: "", stderr: `${"a".repeat(5000)}ENDE` });
    const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([CODEX]), spawn, verfuegbar: IM_PATH });
    assert.ok(antwort.stderr.length <= 1000);
    assert.ok(antwort.stderr.endsWith("ENDE"));
  });
});

test("start: ein per Signal beendeter oder nicht startbarer Pruefer ist ein Ausfall", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const signal = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([CODEX]), spawn: () => ({ status: null, signal: "SIGKILL" }), verfuegbar: IM_PATH });
    assert.equal(signal.fehler, "ausfall");
    assert.match(signal.stderr, /SIGKILL/);
    const fehler = Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" });
    const start = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([CODEX]), spawn: () => ({ status: null, signal: null, error: fehler }), verfuegbar: IM_PATH });
    assert.equal(start.fehler, "ausfall");
    assert.match(start.stderr, /ENOENT/);
  });
});

test("start: ein Werkzeug ausserhalb des PATH ist ein Ausfall ohne Start", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag, ausgabe }, { config: config([CODEX]), spawn: KEIN_AUFRUF, verfuegbar: NICHT_IM_PATH });
    assert.equal(antwort.ok, false);
    assert.equal(antwort.fehler, "nicht-im-path");
    assert.match(antwort.grund, /codex nicht im PATH/);
  });
});

test("start --code-review liest reviewCommand und reviewLesegrenze", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn, aufrufe } = spawnMit({ status: 0, stdout: "CODE-BEFUNDE", stderr: "" });
    const cfg = { reviewCommand: "fremdtool review", reviewLesegrenze: "--nur-lesen" };
    const antwort = issueReviewStart({ "code-review": true, auftrag, ausgabe }, { config: cfg, spawn, verfuegbar: IM_PATH });
    assert.equal(antwort.ok, true);
    assert.equal(antwort.reviewer, "reviewCommand");
    assert.deepEqual(aufrufe[0].args, ["review", "--nur-lesen"]);
    assert.equal(readFileSync(ausgabe, "utf-8"), "CODE-BEFUNDE");
  });
});

test("start --code-review: codex ohne reviewLesegrenze nimmt die Tabelle, ein fremdes Werkzeug startet nicht", () => {
  mitDateien(({ auftrag, ausgabe }) => {
    const { spawn, aufrufe } = spawnMit({ status: 0, stdout: "", stderr: "" });
    issueReviewStart({ "code-review": true, auftrag, ausgabe }, { config: { reviewCommand: "codex exec" }, spawn, verfuegbar: IM_PATH });
    assert.deepEqual(aufrufe[0].args, ["exec", "--sandbox", "read-only"]);
    const ohne = issueReviewStart({ "code-review": true, auftrag, ausgabe }, { config: { reviewCommand: "fremdtool review" }, spawn: KEIN_AUFRUF, verfuegbar: IM_PATH });
    assert.equal(ohne.fehler, "keine-lesegrenze");
  });
});

// --- Aufruffehler werfen; der Befehl macht daraus fail ---

for (const [was, args, cfg, muster] of [
  ["weder --reviewer noch --code-review", { auftrag: "a", ausgabe: "b" }, config([CODEX]), /--reviewer <name> oder --code-review/],
  ["--reviewer und --code-review", { reviewer: "gpt-astra", "code-review": true, auftrag: "a", ausgabe: "b" }, config([CODEX]), /--reviewer <name> oder --code-review/],
  ["fehlendes --auftrag", { reviewer: "gpt-astra", ausgabe: "b" }, config([CODEX]), /--auftrag fehlt/],
  ["fehlendes --ausgabe", { reviewer: "gpt-astra", auftrag: "a" }, config([CODEX]), /--ausgabe fehlt/],
  ["unbekannter Reviewer", { reviewer: "gibtsnicht", auftrag: "a", ausgabe: "b" }, config([CODEX]), /'gibtsnicht' steht nicht in issueReview.reviewers/],
  ["claude-Reviewer", { reviewer: "opus", auftrag: "a", ausgabe: "b" }, config([OPUS]), /kind 'claude'.*kit-pruefer/],
  ["--code-review ohne reviewCommand", { "code-review": true, auftrag: "a", ausgabe: "b" }, {}, /reviewCommand/],
]) {
  test(`start: ${was} ist ein Aufruffehler`, () => {
    assert.throws(() => issueReviewStart(args, { config: cfg, spawn: KEIN_AUFRUF, verfuegbar: IM_PATH }), muster);
  });
}

test("start: ein fehlender Auftrag ist ein Fehler ohne Start", () => {
  mitDateien(({ ausgabe }) => {
    const antwort = issueReviewStart({ reviewer: "gpt-astra", auftrag: "/gibt/es/nicht.md", ausgabe }, { config: config([CODEX]), spawn: KEIN_AUFRUF, verfuegbar: IM_PATH });
    assert.equal(antwort.ok, false);
    assert.equal(antwort.fehler, "auftrag-fehlt");
  });
});
