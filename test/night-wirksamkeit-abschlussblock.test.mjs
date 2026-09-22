// Der Wirksamkeits-Befundblock im Abschlussblock des Laufprotokolls
// (Issue #790, Plan #782, Fachliche Quelle #767).
//
// Die erste der zwei Ausgabestellen des Wirksamkeits-Befunds: Am Ende jedes
// unbeaufsichtigten Laufs ruft `laufAbschliessen()` hinter der Aufwands-Auswertung die
// Wirksamkeits-Auswertung als Kindprozess, legt ihr Ergebnis am Lauf-Kopf ab und
// schreibt ihren Befundblock als eigenen Block hinter den Aufwands-Block. Die zweite
// Stelle — der Kopf von `/push-main` — steht mit Paket #783.
//
// DIE REIHENFOLGE IST DER KERN: Aufwand, dann Wirksamkeit, dann der ZWEITE
// `schreibeErgebnisstand()`. Nur so traegt der geschriebene Stand beide Auswertungen.
// Nachgewiesen wird sie zweifach — an der Folge der mitgeschriebenen Aufrufe und daran,
// dass die Wirksamkeits-Auswertung auf der Platte noch keinen `aufwand`-Block vorfindet.
//
// KEIN GATE (E9): Ein Fehlschlag der Wirksamkeits-Auswertung ist genau eine
// Protokollzeile, laesst den Ausgang des Laufs unveraendert und haelt den Aufwands-Teil
// nicht auf. Es ist dieselbe Linie, die der Aufwands-Plan gezogen hat — ein Lauf, der an
// seiner eigenen Buchhaltung scheitert, verloere den Bericht ueber die Arbeit.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture). Beide Auswertungen sind Stellvertreter unter
// `.claude/kit/`: Gemessen wird, was der Runner mit ihrem Ergebnis macht, nicht wie es
// entsteht — das steht in den aufwand-*- und wirksamkeit-*-Tests. Die Textform der
// Befundbloecke kommt dagegen aus den ECHTEN Modulen neben night.mjs, wie im Betrieb.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// --- Die Stellvertreter der beiden Auswertungen -------------------------------
//
// Beide schreiben in DIESELBE Capture-Datei, jeder mit seinem Namen: Nur so ist ihre
// Reihenfolge nachweisbar. Jeder haelt ausserdem fest, was er beim Aufruf auf der Platte
// vorfindet — daran haengt der Nachweis, dass der zweite Schreibvorgang noch aussteht.

function captureKopf(wer) {
  return [
    'import { readdirSync, readFileSync, appendFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "",
    'const dir = join(process.cwd(), ".claude");',
    String.raw`const staende = readdirSync(dir).filter((n) => /^night-run-.*\.json$/.test(n)).sort();`,
    "const gesehen = staende.map((n) => {",
    '  const s = JSON.parse(readFileSync(join(dir, n), "utf-8"));',
    '  return { datei: n, abschluss: s.abschluss, complete: s.complete, hatAufwand: "aufwand" in s, hatWirksamkeit: "wirksamkeit" in s };',
    "});",
    `appendFileSync(process.env.AUSWERTUNG_CAPTURE, JSON.stringify({ wer: ${JSON.stringify(wer)}, argv: process.argv.slice(2), gesehen }) + "\\n");`,
    "",
  ].join("\n");
}

// Beide Befundtexte sind absichtlich unverwechselbar: Im Protokoll wird nach genau ihnen
// gesucht, und kein anderer Lauf-Text kann sie zufaellig tragen.
const AUFWAND_TEXT = "Werkzeugarbeit macht 61,0 Prozent der gemessenen Gesamtzeit aus (Probefall).";
const AUFWAND_MIT_BEFUND = {
  erzeugtAm: "2026-09-19T01:02:03.456Z",
  juengsterLauf: "2026-09-19-010203",
  laeufe: { gefunden: 2, einbezogen: 2, grenze: 10 },
  befund: [{ schwelle: "werkzeugAnteil", wert: 0.61, grenze: 0.5, laeufe: 2, text: AUFWAND_TEXT }],
};

const WIRK_TEXT = "Die Pruefung 'npx eslint' hat in 42 Ausfuehrungen nie beanstandet (Probefall).";
const WIRK_MIT_BEFUND = {
  erzeugtAm: "2026-09-20T04:05:06.789Z",
  fenster: { tage: 30, von: "2026-08-21", bis: "2026-09-20" },
  befund: [{ art: "nieBeanstandet", kommando: "npx eslint", text: WIRK_TEXT }],
};
const WIRK_OHNE_BEFUND = { ...WIRK_MIT_BEFUND, befund: [] };

// Die Kopfzeile, die `befundText` in kit/wirksamkeit.mjs baut — an ihr haengt der
// Nachweis, dass ohne Befund nichts im Protokoll steht.
const WIRK_KOPF = `Auswertung vom ${WIRK_MIT_BEFUND.erzeugtAm}, Fenster 30 Tage seit 2026-08-21.`;

/** Gibt ein vollstaendiges Ergebnis aus — der Regelfall. */
function stubMitErgebnis(wer, ergebnis) {
  return `${captureKopf(wer)}process.stdout.write(${JSON.stringify(JSON.stringify(ergebnis, null, 2))});\n`;
}

// Der Fehlerfall des echten Werkzeugs: JSON auf stdout, Exit 1 (kit/wirksamkeit.mjs, main()).
const WIRK_STUB_EXIT_UNGLEICH_NULL = `${captureKopf("wirksamkeit")}`
  + `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: false, fehler: "Probefehler beim Auswerten der Wirksamkeit" }))});\n`
  + "process.exit(1);\n";

function setupProjekt(praefix, {
  aufwandStub = stubMitErgebnis("aufwand", AUFWAND_MIT_BEFUND),
  wirksamkeitStub = stubMitErgebnis("wirksamkeit", WIRK_MIT_BEFUND),
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  if (aufwandStub !== null) writeFileSync(join(dir, ".claude", "kit", "aufwand.mjs"), aufwandStub);
  if (wirksamkeitStub !== null) writeFileSync(join(dir, ".claude", "kit", "wirksamkeit.mjs"), wirksamkeitStub);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nsessions.log\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

/** Fixture, Capture-Datei ausserhalb des Repos, und beides wird hinterher geraeumt. */
function mitProjekt(praefix, optionen, fn) {
  const dir = setupProjekt(praefix, optionen);
  const aussen = mkdtempSync(join(tmpdir(), `${praefix}capture-`));
  const capture = join(aussen, "auswertungs-aufrufe.jsonl");
  try {
    fn(dir, capture);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(aussen, { recursive: true, force: true });
  }
}

/** Die mitgeschriebenen Aufrufe beider Auswertungen, einer je Zeile, in ihrer Folge. */
function aufrufe(capture) {
  if (!existsSync(capture)) return [];
  return readFileSync(capture, "utf-8").split("\n").filter((z) => z.trim() !== "").map((z) => JSON.parse(z));
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n));
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Das Laufprotokoll des Tages — die Datei, in die der Abschlussblock geht. */
function protokoll(dir) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}\.log$/.test(n));
  assert.equal(dateien.length, 1, `genau ein Laufprotokoll erwartet, gefunden: ${dateien.join(", ")}`);
  return readFileSync(join(dir, ".claude", dateien[0]), "utf-8");
}

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// Ein Session-Fake, der die Karte nach In review bringt und nichts liegen laesst.
const FAKE_ERFOLG = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

/** Ein regulaerer Lauf ueber genau ein Ready-Paket. */
function laufMitEinemPaket(dir, capture, cliArgs = []) {
  readyIssue(dir, "Erstes Issue");
  return run(dir, process.execPath, [NIGHT, "--label", "none", ...cliArgs], { NIGHT_CLAUDE_CMD: FAKE_ERFOLG, AUSWERTUNG_CAPTURE: capture });
}

// --- Die Reihenfolge ----------------------------------------------------------

test("[night-60] laufAbschliessen ruft erst den Aufwand, dann die Wirksamkeit, und schreibt den Stand erst danach erneut", NUR_POSIX, () => {
  mitProjekt("night-wirk-reihenfolge-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const gerufen = aufrufe(capture);
    assert.deepEqual(gerufen.map((a) => a.wer), ["aufwand", "wirksamkeit"],
      `erst der Aufwand, dann die Wirksamkeit — je genau einmal: ${JSON.stringify(gerufen)}`);
    assert.deepEqual(gerufen[1].argv, ["auswerten"], "die Wirksamkeits-Auswertung wird mit 'auswerten' gerufen");

    const wirk = gerufen[1].gesehen;
    assert.equal(wirk.length, 1, `genau ein Ergebnisstand zum Zeitpunkt des Aufrufs: ${JSON.stringify(wirk)}`);
    assert.equal(wirk[0].abschluss, "regulaer",
      "die Wirksamkeits-Auswertung las den eigenen Lauf ohne Abschlussart — dann ginge der frischeste Lauf als unvollstaendig ein");
    assert.equal(wirk[0].complete, true, "die Wirksamkeits-Auswertung las den eigenen Lauf als unvollstaendig");
    // Der Nachweis fuer „vor dem zweiten schreibeErgebnisstand()": Stuende der
    // Aufwands-Block auf der Platte, waere dazwischen schon geschrieben worden.
    assert.equal(wirk[0].hatAufwand, false,
      "zwischen beiden Auswertungen darf der Stand nicht geschrieben werden — erst beide, dann schreiben");
  });
});

test("[night-60] der Ergebnisstand traegt nach dem Lauf beide Auswertungen am Lauf-Kopf", NUR_POSIX, () => {
  mitProjekt("night-wirk-standfeld-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.ok(s.wirksamkeit, "der Ergebnisstand traegt kein Feld 'wirksamkeit' am Lauf-Kopf");
    assert.equal(s.wirksamkeit.befund[0].text, WIRK_TEXT, "das Feld traegt nicht das Ergebnis der Wirksamkeits-Auswertung");
    assert.equal(s.aufwand.befund[0].text, AUFWAND_TEXT, "das Feld der Aufwands-Auswertung darf dabei nicht verlorengehen");
    // Der zweite Schreibvorgang ist der Beweis: Ohne ihn stuenden beide Felder nur im Speicher.
    assert.equal(s.abschluss, "regulaer", "die Abschlussart darf der zweite Schreibvorgang nicht verlieren");
    assert.equal(s.complete, true, "die Vollstaendigkeit darf der zweite Schreibvorgang nicht verlieren");
  });
});

test("[night-60] der Wirksamkeits-Befundblock steht im Laufprotokoll hinter dem Aufwands-Block", NUR_POSIX, () => {
  mitProjekt("night-wirk-block-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = protokoll(dir);
    assert.ok(log.includes(WIRK_KOPF), `die Kopfzeile des Wirksamkeits-Befundblocks fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.includes(WIRK_TEXT), `der Wirksamkeits-Befund fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.includes(AUFWAND_TEXT), `der Aufwands-Befund fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.indexOf(AUFWAND_TEXT) < log.indexOf(WIRK_KOPF),
      `der Wirksamkeits-Block gehoert hinter den Aufwands-Block:\n${log}`);
  });
});

test("[night-60] ohne Wirksamkeits-Befund steht nichts im Protokoll, und der Aufwands-Block bleibt unberuehrt", NUR_POSIX, () => {
  mitProjekt("night-wirk-stumm-", { wirksamkeitStub: stubMitErgebnis("wirksamkeit", WIRK_OHNE_BEFUND) }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(aufrufe(capture).filter((a) => a.wer === "wirksamkeit").length, 1, "die Wirksamkeits-Auswertung lief auch ohne Befund");
    const s = stand(dir);
    assert.deepEqual(s.wirksamkeit.befund, [], "der Lauf-Kopf traegt den leeren Befund — er ist gemessen, nicht ausgelassen");

    const log = protokoll(dir);
    assert.ok(!log.includes("Fenster 30 Tage"), `ohne Befund darf keine Kopfzeile der Wirksamkeit im Protokoll stehen:\n${log}`);
    assert.ok(!log.includes(WIRK_TEXT), `ohne Befund darf kein Wirksamkeits-Befund im Protokoll stehen:\n${log}`);
    assert.ok(log.includes(AUFWAND_TEXT), `der Aufwands-Block bleibt unberuehrt:\n${log}`);
  });
});

// --- Kein Gate ----------------------------------------------------------------

/** Die Protokollzeilen, die den Fehlschlag der Wirksamkeits-Auswertung melden. */
function fehlerzeilen(dir) {
  return protokoll(dir).split("\n").filter((z) => z.includes("Wirksamkeits-Auswertung"));
}

test("[night-60] ein Kindprozess mit Exit ungleich 0 ist eine Protokollzeile, kein Abbruch und haelt den Aufwands-Teil nicht auf", NUR_POSIX, () => {
  mitProjekt("night-wirk-exit-", { wirksamkeitStub: WIRK_STUB_EXIT_UNGLEICH_NULL }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    assert.match(zeilen[0], /Probefehler beim Auswerten der Wirksamkeit/, "die Zeile nennt den Grund des Werkzeugs nicht");

    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer", "die Auswertung ist Beiwerk, kein Gate");
    assert.equal(s.complete, true);
    assert.equal(s.aufwand.befund[0].text, AUFWAND_TEXT, "der Aufwands-Teil darf vom Fehlschlag nicht betroffen sein");
    assert.ok(protokoll(dir).includes(AUFWAND_TEXT), "der Aufwands-Block fehlt trotz gelungener Aufwands-Auswertung");
  });
});

test("[night-60] fehlt wirksamkeit.mjs ganz, endet der Lauf mit unveraendertem Exit-Code und einer Zeile", NUR_POSIX, () => {
  mitProjekt("night-wirk-fehlt-", { wirksamkeitStub: null }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    // Der Ergebnisstand entsteht trotzdem und ist vollstaendig — er ist der Bericht des
    // Laufs, und der haengt nicht an seiner Auswertung.
    assert.equal(stand(dir).complete, true);
  });
});

test("[night-60] im Dry-Run entfaellt der Aufruf ganz", NUR_POSIX, () => {
  mitProjekt("night-wirk-dryrun-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture, ["--dry-run"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(aufrufe(capture), [], "der Dry-Run hat eine Auswertung gerufen — er wertet nichts aus und schreibt nichts");
  });
});
