// Reviewer-Auswahl und Verfuegbarkeits-Check der issue-review-Achse (Issue #220).
//
// Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist; was er
// nicht hingeschrieben hat, faellt ihm beim Lesen nicht auf. Deshalb prueft nie das
// Modell, das geschrieben hat — darauf beruht das ganze Verfahren, und `pickReviewers`
// ist die Stelle, an der es durchgesetzt wird.
//
// Reviewer koennen Claude-Subagenten oder fremde CLIs sein. Der Verfuegbarkeits-Check
// unterscheidet beides: Ein Claude-Reviewer laeuft immer, ein Kommando nur, wenn sein
// erstes Wort im PATH liegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { pickReviewers, findeImPath } from "../kit/board.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

const BASIS = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

// --- pickReviewers ---

test("pickReviewers: der Autor wird nie ausgewaehlt", () => {
  const { gewaehlt } = pickReviewers(ALLE, "opus");
  assert.equal(gewaehlt.length, 2);
  assert.ok(!gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: die Reihenfolge der Config bestimmt die Paarung", () => {
  // So laesst sich eine feste Paarung erzwingen, ohne eine Matrix zu pflegen.
  const umsortiert = [CODEX, FABLE, SONNET, OPUS];
  assert.deepEqual(pickReviewers(umsortiert, "sonnet").gewaehlt.map((r) => r.name), ["codex", "fable"]);
});

test("pickReviewers: unbekannter Autor nimmt die ersten zwei", () => {
  // Aeltere Issues ohne Autor-Modell-Zeile, oder ein Mensch als Autor.
  const { gewaehlt, unterbesetzt, autorAufgeloest } = pickReviewers(ALLE, "unbekannt");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(unterbesetzt, false);
  // Die Auswahl ist unveraendert, aber nicht mehr stumm: Ein Aufrufer ohne Menschen
  // davor soll erkennen, dass sie nicht auf einem erkannten Autor beruht (Issue #241).
  assert.equal(autorAufgeloest, false);
});

// --- Autor-Aufloesung: Modell-ID -> Reviewer-Kurzname (Issue #241) ---
//
// `/issues` schreibt die volle Modell-ID in den Kontext-Abschnitt
// (`Autor-Modell: claude-opus-5`), `pairs` ist mit Kurznamen geschluesselt (`opus`).
// Ohne Uebersetzung greift pairs nicht — und schlimmer: der Regel-Zweig filtert ueber
// `r.name !== autor`, und "opus" !== "claude-opus-5" ist wahr. Der Autor bleibt also
// im Kandidatenfeld und **prueft sein eigenes Issue**. Genau das, was pairs aus #225
// verhindern sollte, nur eine Ebene tiefer.

test("pickReviewers: die Modell-ID waehlt dieselben Reviewer wie der Kurzname", () => {
  const pairs = { opus: ["sonnet", "fable"] };
  const perId = pickReviewers(ALLE, "claude-opus-5", 2, pairs);
  const perName = pickReviewers(ALLE, "opus", 2, pairs);
  assert.deepEqual(perId.gewaehlt.map((r) => r.name), perName.gewaehlt.map((r) => r.name));
  assert.equal(perId.quelle, "pairs");
  assert.equal(perId.autorAufgeloest, true);
});

test("pickReviewers: ohne pairs prueft der Autor sein eigenes Issue nicht mehr", () => {
  // Der Kern des Bugs: Vorher stand 'opus' hier im Ergebnis.
  const { gewaehlt, autorAufgeloest } = pickReviewers(ALLE, "claude-opus-5");
  assert.ok(!gewaehlt.some((r) => r.name === "opus"),
    "der Autor darf nicht sein eigener Reviewer sein");
  assert.equal(autorAufgeloest, true);
});

test("pickReviewers: ein Kurzname loest weiterhin auf sich selbst auf", () => {
  const { autorAufgeloest, quelle } = pickReviewers(ALLE, "sonnet", 2, { sonnet: ["opus"] });
  assert.equal(autorAufgeloest, true);
  assert.equal(quelle, "pairs");
});

test("pickReviewers: ein Reviewer ohne model-Feld stoert die Aufloesung nicht", () => {
  // kind:'command'-Reviewer haben kein `model` — undefined darf nicht gegen einen
  // fehlenden Autor matchen.
  const { gewaehlt, autorAufgeloest } = pickReviewers(ALLE, undefined);
  assert.equal(autorAufgeloest, false);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
});

test("pickReviewers: zu wenige Kandidaten melden unterbesetzt", () => {
  // Kein Fehler: Der Skill entscheidet, ob er damit faehrt — muss es aber sichtbar machen.
  const { gewaehlt, unterbesetzt } = pickReviewers([OPUS, SONNET], "opus");
  assert.deepEqual(gewaehlt.map((r) => r.name), ["sonnet"]);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: leere Liste ergibt keine Reviewer", () => {
  const { gewaehlt, unterbesetzt } = pickReviewers([], "opus");
  assert.deepEqual(gewaehlt, []);
  assert.equal(unterbesetzt, true);
});

test("pickReviewers: die Anzahl ist einstellbar", () => {
  assert.equal(pickReviewers(ALLE, "opus", 3).gewaehlt.length, 3);
  assert.equal(pickReviewers(ALLE, "opus", 1).gewaehlt.length, 1);
});

// --- CLI: reviewers ---

/** Fixture mit issueReview-Block; `reviewers` darf auch Rohtext sein. */
function mitReview(issueReview, fn) {
  const dir = setupProjekt(issueReview === null ? BASIS : { ...BASIS, issueReview }, "board-ireview-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("issue-review reviewers gibt zwei Reviewer ohne den Autor", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.autor, "opus");
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
    assert.equal(out.unterbesetzt, false);
    assert.equal(out.rounds, 1, "Default ist eine Runde");
  });
});

test("issue-review reviewers: konfigurierte rounds gewinnen", () => {
  mitReview({ rounds: 2, reviewers: ALLE }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.equal(out.rounds, 2);
  });
});

test("issue-review reviewers: fehlender issueReview-Block ist kein Fehler", () => {
  mitReview(null, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.gewaehlt, []);
    assert.equal(out.unterbesetzt, true);
  });
});

test("issue-review reviewers: --author ohne Wert bricht mit Meldung ab", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--author/);
  });
});

// --- CLI: check ---

// --- findeImPath (Issue #231) ---
//
// Plattform und Dateisystem werden injiziert, damit die Windows-Semantik ohne Windows
// pruefbar ist. Genau das war die Luecke: Der alte Verfuegbarkeits-Check startete einen
// Prozess, und ob der unter Windows startet, laesst sich unter POSIX nicht nachstellen.

// Baut eine `existiert`-Funktion aus einer Liste vorhandener Pfade.
//
// Bewusst case-insensitiv: PATHEXT liefert die Endungen in Grossschreibung (.CMD),
// die installierte Datei heisst `codex.cmd`. Auf einem echten Windows-Dateisystem
// trifft `existsSync` sie trotzdem — ein case-sensitiver Fake wuerde einen Fehler
// behaupten, den es dort nicht gibt. Fuer die POSIX-Faelle aendert es nichts, dort
// stimmen die Namen exakt ueberein.
function fs_mit(...pfade) {
  const vorhanden = new Set(pfade.map((p) => p.toLowerCase()));
  return (p) => vorhanden.has(p.toLowerCase());
}

const WIN = {
  platform: "win32",
  pathext: ".COM;.EXE;.BAT;.CMD",
  path: "C:\\bin;C:\\npm",
};
// `ausfuehrbar` gehoert zur Grundausstattung: Unter POSIX prueft findeImPath das
// X-Bit, und die Fixture-Pfade existieren real nicht — ohne Injektion wuerde der
// echte accessSync jeden Treffer wieder verwerfen.
const POSIX = { platform: "linux", path: "/usr/bin:/usr/local/bin", ausfuehrbar: () => true };

test("findeImPath: win32 findet 'codex' als codex.cmd", () => {
  // Der Kernfall, an dem die fruehere Implementierung scheiterte.
  // Verglichen wird case-insensitiv: Zurueck kommt der aus PATHEXT gebildete Pfad
  // (.CMD), die Datei heisst .cmd — auf einem Windows-Dateisystem derselbe Pfad.
  const treffer = findeImPath("codex", { ...WIN, existiert: fs_mit("C:\\npm\\codex.cmd") });
  assert.equal(treffer?.toLowerCase(), "c:\\npm\\codex.cmd");
});

test("findeImPath: win32 haelt die PATHEXT-Reihenfolge ein", () => {
  // .EXE steht in PATHEXT vor .CMD — liegen beide da, gewinnt .EXE.
  const treffer = findeImPath("codex", {
    ...WIN,
    existiert: fs_mit("C:\\bin\\codex.CMD", "C:\\bin\\codex.EXE"),
  });
  assert.equal(treffer, "C:\\bin\\codex.EXE");
});

test("findeImPath: win32 durchsucht die PATH-Eintraege in ihrer Reihenfolge", () => {
  const treffer = findeImPath("codex", {
    ...WIN,
    existiert: fs_mit("C:\\bin\\codex.CMD", "C:\\npm\\codex.CMD"),
  });
  assert.equal(treffer, "C:\\bin\\codex.CMD");
});

test("findeImPath: win32 ergaenzt einen Namen mit Endung nicht noch einmal", () => {
  // 'codex.exe' darf nicht zu 'codex.exe.CMD' werden.
  const treffer = findeImPath("codex.exe", { ...WIN, existiert: fs_mit("C:\\bin\\codex.exe") });
  assert.equal(treffer, "C:\\bin\\codex.exe");
  const daneben = findeImPath("codex.exe", { ...WIN, existiert: fs_mit("C:\\bin\\codex.exe.CMD") });
  assert.equal(daneben, null);
});

test("findeImPath: win32 ohne PATHEXT nutzt die Windows-Default-Liste", () => {
  const treffer = findeImPath("codex", {
    platform: "win32",
    path: "C:\\bin",
    pathext: undefined,
    existiert: fs_mit("C:\\bin\\codex.CMD"),
  });
  assert.equal(treffer, "C:\\bin\\codex.CMD");
});

test("findeImPath: posix probiert keine Endungen", () => {
  const nackt = findeImPath("codex", { ...POSIX, existiert: fs_mit("/usr/bin/codex") });
  assert.equal(nackt, "/usr/bin/codex");
  const mitEndung = findeImPath("codex", { ...POSIX, existiert: fs_mit("/usr/bin/codex.cmd") });
  assert.equal(mitEndung, null);
});

test("findeImPath: der PATH-Trenner haengt an der Plattform", () => {
  // Unter win32 trennt ';' — ein ':' im Pfad ist dort Teil des Laufwerksbuchstabens.
  assert.equal(
    findeImPath("codex", { ...WIN, path: "C:\\a;C:\\b", existiert: fs_mit("C:\\b\\codex.CMD") }),
    "C:\\b\\codex.CMD",
  );
  assert.equal(
    findeImPath("codex", { ...POSIX, path: "/a:/b", existiert: fs_mit("/b/codex") }),
    "/b/codex",
  );
});

test("findeImPath: der Trenner im Ergebnis folgt der uebergebenen Plattform, nicht dem Host", () => {
  // Die Invariante, an der der Windows-Job gescheitert ist: join() aus node:path ist
  // immer die Variante des LAUFENDEN Hosts. Dieser Test faellt auf, egal auf welcher
  // Seite jemand sie wieder einbaut — er laeuft unter POSIX und Windows gleich.
  const win = findeImPath("codex", { ...WIN, path: "C:\\bin", existiert: () => true });
  assert.ok(win.includes("\\"), `win32-Ergebnis ohne Backslash: ${win}`);
  assert.ok(!win.includes("/"), `win32-Ergebnis mit Slash: ${win}`);

  const posix = findeImPath("codex", { ...POSIX, path: "/usr/bin", existiert: () => true });
  assert.equal(posix, "/usr/bin/codex");
});

test("findeImPath: nicht gefunden liefert null", () => {
  assert.equal(findeImPath("gibtsnicht", { ...POSIX, existiert: () => false }), null);
  assert.equal(findeImPath("gibtsnicht", { ...WIN, existiert: () => false }), null);
});

test("findeImPath: ein Pfad in der Eingabe wird direkt geprueft, ohne PATH-Suche", () => {
  // Ein Reviewer-Kommando darf auf ein Werkzeug ausserhalb des PATH zeigen.
  assert.equal(
    findeImPath("/opt/tools/x", { ...POSIX, existiert: fs_mit("/opt/tools/x") }),
    "/opt/tools/x",
  );
  assert.equal(
    findeImPath("./meintool", { ...POSIX, existiert: fs_mit("./meintool") }),
    "./meintool",
  );
  // Kein Fallback auf die PATH-Suche: Wer einen Pfad angibt, meint diesen Pfad.
  assert.equal(
    findeImPath("./meintool", { ...POSIX, existiert: fs_mit("/usr/bin/meintool") }),
    null,
  );
});

test("findeImPath: posix verlangt zusaetzlich das Ausfuehrbar-Bit", () => {
  // Eine lesbare, aber nicht ausfuehrbare Datei ist kein Kommando. Der alte
  // Prozessstart fing das implizit ab; die Dateisystem-Pruefung darf nicht
  // dahinter zurueckfallen.
  const treffer = findeImPath("codex", {
    ...POSIX,
    existiert: fs_mit("/usr/bin/codex"),
    ausfuehrbar: () => false,
  });
  assert.equal(treffer, null);
});

test("findeImPath: win32 prueft kein Ausfuehrbar-Bit", () => {
  // Unter Windows entscheidet die Endung, nicht ein Modus-Bit.
  const treffer = findeImPath("codex", {
    ...WIN,
    existiert: fs_mit("C:\\bin\\codex.CMD"),
    ausfuehrbar: () => false,
  });
  assert.equal(treffer, "C:\\bin\\codex.CMD");
});

test("findeImPath: leerer PATH liefert null statt zu werfen", () => {
  assert.equal(findeImPath("codex", { ...POSIX, path: "", existiert: () => true }), null);
  assert.equal(findeImPath("codex", { ...POSIX, path: undefined, existiert: () => true }), null);
});

// POSIX-only (Issue #230): Die Datei hat keine Endung und traegt ihre Ausfuehrbarkeit
// im Shebang und im Modus. Unter Windows ist beides wirkungslos — dort entscheidet die
// Endung (.cmd/.bat/.exe), ob etwas startbar ist. Wer diesen Helfer in einen neuen Test
// einbaut, muss ihn dort ueberspringen (NUR_POSIX), sonst sucht er denselben Fehler
// noch einmal.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

/**
 * Legt ein Fake-Binary ohne Grammatik-Bindung im Fixture-PATH an.
 *
 * `rumpf` ersetzt den Standard-Rumpf (`exit 0`) — der Probelauf aus Issue #262
 * braucht Kommandos, die scheitern, haengen oder stdin mitschreiben.
 */
function fakeBinary(dir, name, modus = 0o755, rumpf = "exit 0") {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const pfad = join(binDir, name);
  writeFileSync(pfad, `#!/bin/sh\n${rumpf}\n`);
  chmodSync(pfad, modus);
}

test("issue-review check: claude-Reviewer gelten immer als verfuegbar", () => {
  mitReview({ reviewers: [OPUS, SONNET] }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "check"]).stdout);
    assert.equal(out.alleVerfuegbar, true);
    assert.ok(out.reviewers.every((r) => r.verfuegbar));
  });
});

test("issue-review check: ohne konfigurierte Reviewer ist alleVerfuegbar false", () => {
  // Frueher lieferte `every()` auf dem leeren Array true — der Nacht-Vorflug haette
  // einen Lauf durchgelassen, in dem jede Session ergebnislos endet. Vorhersehbare
  // Lage gehoert ins Gate, nicht in einen Prompt (dieselbe Klasse wie Issue #192).
  mitReview({}, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.reviewers, []);
    assert.equal(out.alleVerfuegbar, false);
    assert.match(out.grund, /workflow\.config\.example\.json/);
  });
  // Auch wenn der Block ganz fehlt, nicht nur wenn er leer ist.
  mitReview(null, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "check"]).stdout);
    assert.equal(out.alleVerfuegbar, false);
  });
});

test("issue-review check: fehlendes Kommando wird mit Grund gemeldet, Exit bleibt 0", () => {
  // check ist eine Auskunft, kein Gate — wer daraus ein Gate macht, ist der Skill.
  //
  // Bewusst ein Fantasiename statt 'codex': Auf einem Rechner, auf dem das echte CLI
  // installiert ist, wuerde der Test sonst gruen behaupten, was er nicht geprueft hat
  // (genau so ist er beim Bauen einmal umgekippt).
  const fehlt = { name: "gibtsnicht", kind: "command", command: "gibtsnicht-xyz --flag" };
  mitReview({ reviewers: [OPUS, fehlt] }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, false);
    const eintrag = out.reviewers.find((r) => r.name === "gibtsnicht");
    assert.equal(eintrag.verfuegbar, false);
    assert.match(eintrag.grund, /gibtsnicht-xyz/);
  });
});

test("issue-review check: vorhandenes Kommando gilt als verfuegbar", NUR_POSIX, () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "meinfake --flag" }] }, (dir) => {
    fakeBinary(dir, "meinfake");
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, true);
  });
});

test("issue-review check: eine nicht ausfuehrbare Datei gilt nicht als Kommando", NUR_POSIX, () => {
  // Deckt den echten accessSync-Pfad ab (Issue #231): Die Datei liegt im PATH, ist
  // aber nur lesbar. Der fruehere Prozessstart fing das implizit ab.
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "nurlesbar --flag" }] }, (dir) => {
    fakeBinary(dir, "nurlesbar", 0o644);
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, false);
    assert.match(out.reviewers[0].grund, /nurlesbar/);
    // Ein Kommando, das gar nicht startbar ist, bekommt keinen Probelauf.
    assert.equal(out.reviewers[0].geprueft, "pfad");
  });
});

// --- Probelauf statt reiner PATH-Suche (Issue #262) ---
//
// Belegt am 2026-08-08: Der Vorflug meldete `codex` verfuegbar, weil das Binary im
// PATH lag; jeder Aufruf scheiterte dann an einem HTTP 400, weil das konfigurierte
// Modell fuer den Account nicht freigegeben war. Interaktiv faellt das auf, nachts
// nicht — dort wird aus `alleVerfuegbar: false` ein harter Stopp, und genau der
// blieb aus, weil der Befund `true` lautete.

test("issue-review check: ein startbares Kommando wird durch einen Probelauf bestaetigt", NUR_POSIX, () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "laeuft --flag" }] }, (dir) => {
    fakeBinary(dir, "laeuft");
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, true);
    assert.equal(out.reviewers[0].verfuegbar, true);
    assert.equal(out.reviewers[0].geprueft, "probelauf");
  });
});

test("issue-review check: ein Kommando im PATH, das scheitert, gilt als nicht verfuegbar", NUR_POSIX, () => {
  // Der Fall aus dem Befund: startbar, aber nicht benutzbar.
  const rumpf = 'echo "model is not supported for this account" >&2\nexit 1';
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "kaputt --flag" }] }, (dir) => {
    fakeBinary(dir, "kaputt", 0o755, rumpf);
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr, "check bleibt eine Auskunft, kein Gate");
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, false);
    assert.equal(out.reviewers[0].verfuegbar, false);
    assert.equal(out.reviewers[0].geprueft, "probelauf");
    // Die Fehlermeldung des Werkzeugs ist die eigentliche Auskunft.
    assert.match(out.reviewers[0].grund, /model is not supported/);
  });
});

test("issue-review check: der Probeprompt erreicht das Kommando ueber stdin", NUR_POSIX, () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "liest --flag" }] }, (dir) => {
    const mitschrift = join(dir, "stdin.txt");
    fakeBinary(dir, "liest", 0o755, `cat > ${mitschrift}\nexit 0`);
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(mitschrift), "das Kommando hat nichts auf stdin bekommen");
    // Exakt, nicht nur nicht-leer: Seit es mit KIT_PROBE_PROMPT einen Weg gibt, den
    // Prompt zu ersetzen, muss belegt sein, dass er ohne die Variable unveraendert
    // bleibt. `length > 0` haette auch ein versehentlich ueberschriebener Prompt
    // erfuellt (Issue #393).
    assert.equal(readFileSync(mitschrift, "utf-8"), "Antworte nur mit dem Wort OK.\n");
  });
});

// Ein Prompt oberhalb des Pipe-Puffers (64 KiB unter Linux) und unterhalb der
// Grenze, die Linux ueber MAX_ARG_STRLEN fuer eine einzelne Umgebungsvariable
// setzt (128 KiB). Er erzwingt EPIPE deterministisch, sobald das Kommando endet,
// ohne stdin zu lesen — 1 MiB liesse dagegen schon den Spawn mit E2BIG scheitern.
const GROSSER_PROBE_PROMPT = "x".repeat(100 * 1024);

test("issue-review check: bei EPIPE gewinnt die Fehlermeldung des Werkzeugs", NUR_POSIX, () => {
  // Der Fall aus dem roten CI-Lauf (Issue #393): Das Kommando ist weg, bevor der
  // Prompt geschrieben ist. spawnSync meldet dann EPIPE *zusaetzlich* zum
  // Exit-Status — und der Grund, den der Vorflug ausgeben soll, steht in stderr.
  const rumpf = 'echo "model is not supported for this account" >&2\nexit 1';
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "kaputt --flag" }] }, (dir) => {
    fakeBinary(dir, "kaputt", 0o755, rumpf);
    const res = runBoard(dir, ["issue-review", "check"], { KIT_PROBE_PROMPT: GROSSER_PROBE_PROMPT });
    assert.equal(res.status, 0, res.stderr, "check bleibt eine Auskunft, kein Gate");
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewers[0].verfuegbar, false);
    assert.equal(out.reviewers[0].geprueft, "probelauf");
    assert.match(out.reviewers[0].grund, /model is not supported/);
    assert.doesNotMatch(out.reviewers[0].grund, /EPIPE/, "EPIPE ist der Nebeneffekt, nicht der Grund");
  });
});

test("issue-review check: ein Kommando, das stdin nicht liest, bleibt verfuegbar", NUR_POSIX, () => {
  // Die Gegenrichtung desselben Fehlers: exit 0 mit EPIPE ist ein Erfolg. Wer den
  // error-Zweig zuerst prueft, meldet ein funktionierendes Werkzeug als Ausfall.
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "still --flag" }] }, (dir) => {
    fakeBinary(dir, "still", 0o755, "exit 0");
    const res = runBoard(dir, ["issue-review", "check"], { KIT_PROBE_PROMPT: GROSSER_PROBE_PROMPT });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewers[0].verfuegbar, true);
    assert.equal(out.alleVerfuegbar, true);
  });
});

test("issue-review check: ein per Signal gestorbenes Kommando gilt als Ausfall", NUR_POSIX, () => {
  // Der dritte Zustand neben "gelaufen" und "nie gestartet": kein Exit-Status, kein
  // error — nur ein Signal. Ohne eigenen Zweig faellt er auf ok: true durch, und ein
  // abgestuerzter Reviewer gilt als verfuegbar (Issue #393).
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "stirbt --flag" }] }, (dir) => {
    fakeBinary(dir, "stirbt", 0o755, "kill -SEGV $$");
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewers[0].verfuegbar, false);
    assert.match(out.reviewers[0].grund, /SIGSEGV/);
  });
});

test("issue-review check: ein haengendes Kommando laeuft ins Zeitlimit", NUR_POSIX, () => {
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "haengt --flag" }] }, (dir) => {
    fakeBinary(dir, "haengt", 0o755, "sleep 30");
    // Test-Hook statt 60 s Default — sonst dauert dieser Test eine Minute.
    const res = runBoard(dir, ["issue-review", "check"], { KIT_PROBE_TIMEOUT_MS: "300" });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reviewers[0].verfuegbar, false);
    assert.match(out.reviewers[0].grund, /Zeitlimit/i);
  });
});

test("issue-review check: --nur-pfad ueberspringt den Probelauf", NUR_POSIX, () => {
  // Dasselbe kaputte Kommando wie oben: Ohne Probelauf gilt es als verfuegbar.
  const rumpf = 'echo "kaputt" >&2\nexit 1';
  mitReview({ reviewers: [{ name: "fake", kind: "command", command: "kaputt2 --flag" }] }, (dir) => {
    fakeBinary(dir, "kaputt2", 0o755, rumpf);
    const res = runBoard(dir, ["issue-review", "check", "--nur-pfad"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.alleVerfuegbar, true);
    assert.equal(out.reviewers[0].geprueft, "pfad");
    assert.equal(out.reviewers[0].umgebung, "runner");
  });
});

test("issue-review check: claude-Reviewer bekommen keinen Probelauf", () => {
  mitReview({ reviewers: [OPUS] }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "check"]).stdout);
    assert.equal(out.reviewers[0].verfuegbar, true);
    assert.equal(out.reviewers[0].geprueft, undefined);
  });
});

test("issue-review check: jeder Befund nennt die Umgebung 'runner'", NUR_POSIX, () => {
  // Der Befund von hier stammt immer aus dem aufrufenden Prozess (Issue #269). Wer ihn
  // ohne diesen Stempel liest, koennte ein `verfuegbar: true` auf eine Umgebung beziehen,
  // in der gar nicht geprueft wurde — genau der Fehlschluss aus der Nacht vom 2026-08-08.
  // Der Nacht-Runner erkennt seinen Session-Vorflug am Gegenwert "review-session".
  mitReview({ reviewers: [OPUS, { name: "fake", kind: "command", command: "laeuft --flag" }] }, (dir) => {
    fakeBinary(dir, "laeuft", 0o755, "cat > /dev/null\nexit 0");
    const out = JSON.parse(runBoard(dir, ["issue-review", "check"]).stdout);
    assert.equal(out.reviewers.length, 2);
    for (const r of out.reviewers) assert.equal(r.umgebung, "runner", `${r.name} traegt die falsche Umgebung`);
  });
});

// --- Validierung ---
//
// Eine halb ausgefuellte Reviewer-Definition still zu ueberspringen wuerde einen
// Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf verwandeln.

for (const [was, reviewer] of [
  ["fehlendem name", { kind: "claude", model: "x" }],
  ["unbekanntem kind", { name: "x", kind: "zauberei" }],
  ["command ohne command-Feld", { name: "x", kind: "command" }],
  ["claude ohne model", { name: "x", kind: "claude" }],
]) {
  test(`issue-review: Reviewer mit ${was} bricht mit Meldung ab`, () => {
    mitReview({ reviewers: [reviewer] }, (dir) => {
      const res = runBoard(dir, ["issue-review", "check"]);
      assert.notEqual(res.status, 0, "eine kaputte Definition darf nicht still durchgehen");
      assert.match(res.stderr, /issueReview/);
    });
  });
}

test("Die Hilfe nennt die issue-review-Achse", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /issue-review reviewers/);
    assert.match(res.stdout, /issue-review check/);
  });
});

test("Unbekannte Achse nennt issue | code | kontext | issue-review", () => {
  mitReview(null, (dir) => {
    const res = runBoard(dir, ["quatsch", "irgendwas"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /issue-review/);
  });
});

test("Unbekannter issue-review-Befehl: Hilfe plus Fehlermeldung", () => {
  mitReview({ reviewers: ALLE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "quatsch"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /quatsch/);
  });
});

// --- pairs: explizite Zuordnung (Issue #225) ---
//
// Die Regel allein waehlt immer die vordersten Eintraege: Bei vier Reviewern kam der
// vierte nie zum Zug — ausgerechnet das Modell aus dem fremden Haus, dessen Wert darin
// liegt, die blinden Flecken der Familie NICHT zu teilen. pairs macht die Zuordnung
// ablesbar statt errechenbar.

const PAARE = { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] };

test("pickReviewers: ein pairs-Eintrag gewinnt ueber die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "opus", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
  assert.equal(quelle, "pairs");
});

test("pickReviewers: die Reihenfolge im pairs-Eintrag wird eingehalten", () => {
  assert.deepEqual(
    pickReviewers(ALLE, "sonnet", 2, PAARE).gewaehlt.map((r) => r.name),
    ["opus", "codex"]
  );
});

test("pickReviewers: fehlt der Autor in pairs, greift die Regel", () => {
  const { gewaehlt, quelle } = pickReviewers(ALLE, "fable", 2, PAARE);
  assert.deepEqual(gewaehlt.map((r) => r.name), ["opus", "sonnet"]);
  assert.equal(quelle, "regel");
});

test("pickReviewers: ohne pairs bleibt das Verhalten wie vorher", () => {
  // Regressionsschutz — die Regel darf sich durch das neue Feld nicht aendern.
  const ohne = pickReviewers(ALLE, "opus");
  assert.deepEqual(ohne.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
  assert.equal(ohne.quelle, "regel");
  assert.deepEqual(pickReviewers(ALLE, "opus", 2, {}).gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
});

test("pickReviewers: ein leerer pairs-Eintrag faellt auf die Regel zurueck", () => {
  assert.equal(pickReviewers(ALLE, "opus", 2, { opus: [] }).quelle, "regel");
});

// --- CLI: pairs und Validierung ---

test("issue-review reviewers nennt die Quelle der Auswahl", () => {
  mitReview({ reviewers: ALLE, pairs: PAARE }, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
    assert.equal(out.quelle, "pairs");
  });
});

test("issue-review: ein pairs-Eintrag mit unbekanntem Namen bricht ab", () => {
  // Ein Tippfehler wuerde sonst zu einem unsichtbaren Ein-Reviewer-Lauf.
  mitReview({ reviewers: ALLE, pairs: { opus: ["sonett", "fable"] } }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /sonett/);
  });
});

test("issue-review: ein Autor, der sich selbst nennt, bricht ab", () => {
  // Das hebelt den Zweck des Verfahrens aus und gehoert beim Schreiben bemerkt.
  mitReview({ reviewers: ALLE, pairs: { opus: ["opus", "sonnet"] } }, (dir) => {
    const res = runBoard(dir, ["issue-review", "check"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /opus/);
  });
});

// --- CLI: matrix ---

test("issue-review matrix listet jeden bekannten Autor mit Quelle", () => {
  mitReview({ reviewers: ALLE, pairs: PAARE }, (dir) => {
    const res = runBoard(dir, ["issue-review", "matrix"]);
    assert.equal(res.status, 0, res.stderr);
    const { matrix } = JSON.parse(res.stdout);
    const zeile = (name) => matrix.find((m) => m.autor === name);

    assert.deepEqual(zeile("opus").reviewer, ["codex", "sonnet"]);
    assert.equal(zeile("opus").quelle, "pairs");
    // Die Modell-ID steht dabei (Issue #241) — es ist der Wert, den /issues in die
    // Issues schreibt, und ohne ihn ist die Tabelle nicht mit ihnen abgleichbar.
    assert.equal(zeile("opus").modell, "claude-opus-5");
    // Ein kind:'command'-Reviewer hat keine Modell-ID; null statt undefined, damit
    // das Feld im JSON ueberhaupt erscheint.
    assert.equal(zeile("codex").modell, null);
    assert.deepEqual(zeile("fable").reviewer, ["opus", "sonnet"]);
    assert.equal(zeile("fable").quelle, "regel");
    assert.deepEqual(matrix.map((m) => m.autor).sort(), ["codex", "fable", "opus", "sonnet"]);
  });
});

test("issue-review matrix nimmt auch Autoren auf, die nur in pairs stehen", () => {
  // haiku ist kein Reviewer, kann aber Issues schreiben.
  mitReview({ reviewers: ALLE, pairs: { haiku: ["sonnet", "opus"] } }, (dir) => {
    const { matrix } = JSON.parse(runBoard(dir, ["issue-review", "matrix"]).stdout);
    const haiku = matrix.find((m) => m.autor === "haiku");
    assert.deepEqual(haiku.reviewer, ["sonnet", "opus"]);
    assert.equal(haiku.quelle, "pairs");
  });
});
