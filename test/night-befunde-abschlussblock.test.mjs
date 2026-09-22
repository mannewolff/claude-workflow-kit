// Der Befunde-Block im Abschlussblock des Laufprotokolls (Issue #806, Plan #797,
// Fachliche Quelle #768).
//
// Die dritte Auswertung des Lauf-Abschlusses: `laufAbschliessen()` ruft hinter Aufwand
// und Wirksamkeit die Befunde-Auswertung als Kindprozess, legt ihr Ergebnis am Lauf-Kopf
// ab und schreibt ihren Befundblock als eigenen Block hinter den der Wirksamkeit. Die
// zweite Ausgabestelle — der Kopf von `/push-main` — steht in test/push-main-aufwand.test.mjs.
//
// DIE REIHENFOLGE IST DER KERN: Aufwand, Wirksamkeit, Befunde, dann der ZWEITE
// `schreibeErgebnisstand()`. Nur so traegt der geschriebene Stand alle drei Auswertungen.
// Nachgewiesen wird sie zweifach — an der Folge der mitgeschriebenen Aufrufe und daran,
// dass die Befunde-Auswertung auf der Platte noch keinen `aufwand`-Block vorfindet.
//
// KEIN GATE: Ein Fehlschlag der Befunde-Auswertung ist genau eine Protokollzeile, laesst
// den Ausgang des Laufs unveraendert und haelt die beiden anderen nicht auf. Es ist
// dieselbe Linie wie bei Aufwand (E15 des Plans #745) und Wirksamkeit (E9 des Plans
// #782) — ein Lauf, der an seiner eigenen Buchhaltung scheitert, verloere den Bericht
// ueber die Arbeit.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture). Alle drei Auswertungen sind Stellvertreter
// unter `.claude/kit/`: Gemessen wird, was der Runner mit ihrem Ergebnis macht, nicht wie
// es entsteht — das steht in den befunde-*-Tests. Die Textform der Befundbloecke kommt
// dagegen aus den ECHTEN Modulen neben night.mjs, wie im Betrieb.

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
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// --- Die Stellvertreter der drei Auswertungen ---------------------------------
//
// Alle drei schreiben in DIESELBE Capture-Datei, jeder mit seinem Namen: Nur so ist ihre
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
    '  return { datei: n, abschluss: s.abschluss, complete: s.complete, hatAufwand: "aufwand" in s, hatWirksamkeit: "wirksamkeit" in s, hatBefunde: "befunde" in s };',
    "});",
    `appendFileSync(process.env.AUSWERTUNG_CAPTURE, JSON.stringify({ wer: ${JSON.stringify(wer)}, argv: process.argv.slice(2), gesehen }) + "\\n");`,
    "",
  ].join("\n");
}

// Die drei Befundtexte sind absichtlich unverwechselbar: Im Protokoll wird nach genau
// ihnen gesucht, und kein anderer Lauf-Text kann sie zufaellig tragen.
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

const BEFUNDE_TEXT = "`luecke`: 7 Vorkommen (plan 7) — kein Vorschlag vermerkt (Probefall).";
const BEFUNDE_MIT_BEFUND = {
  ok: true,
  erzeugtAm: "2026-09-21T07:08:09.012Z",
  schwelle: 3,
  arten: [],
  code: { gruen: 0, nichtVergleichbar: 0 },
  befund: [{ art: "luecke", vorkommen: 7, text: BEFUNDE_TEXT }],
};
const BEFUNDE_OHNE_BEFUND = { ...BEFUNDE_MIT_BEFUND, befund: [] };

// Die Kopfzeile, die `befundText` in kit/befunde.mjs baut — an ihr haengt der Nachweis,
// dass ohne Befund nichts im Protokoll steht.
const BEFUNDE_KOPF = `Befunde der Modell-Pruefungen — Auswertung vom ${BEFUNDE_MIT_BEFUND.erzeugtAm}`;

/** Gibt ein vollstaendiges Ergebnis aus — der Regelfall. */
function stubMitErgebnis(wer, ergebnis) {
  return `${captureKopf(wer)}process.stdout.write(${JSON.stringify(JSON.stringify(ergebnis, null, 2))});\n`;
}

// Der Fehlerfall des echten Werkzeugs: JSON auf stdout, Exit 1 (kit/befunde.mjs, alsJson).
const BEFUNDE_STUB_EXIT_UNGLEICH_NULL = `${captureKopf("befunde")}`
  + `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: false, fehler: "Probefehler beim Auswerten der Befunde" }))});\n`
  + "process.exit(1);\n";

function setupProjekt(praefix, {
  aufwandStub = stubMitErgebnis("aufwand", AUFWAND_MIT_BEFUND),
  wirksamkeitStub = stubMitErgebnis("wirksamkeit", WIRK_MIT_BEFUND),
  befundeStub = stubMitErgebnis("befunde", BEFUNDE_MIT_BEFUND),
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  if (aufwandStub !== null) writeFileSync(join(dir, ".claude", "kit", "aufwand.mjs"), aufwandStub);
  if (wirksamkeitStub !== null) writeFileSync(join(dir, ".claude", "kit", "wirksamkeit.mjs"), wirksamkeitStub);
  if (befundeStub !== null) writeFileSync(join(dir, ".claude", "kit", "befunde.mjs"), befundeStub);
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

/** Die mitgeschriebenen Aufrufe der Auswertungen, einer je Zeile, in ihrer Folge. */
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

test("[night-64] laufAbschliessen ruft die Befunde als dritte, hinter Aufwand und Wirksamkeit", NUR_POSIX, () => {
  mitProjekt("night-befunde-reihenfolge-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const gerufen = aufrufe(capture);
    assert.deepEqual(gerufen.map((a) => a.wer), ["aufwand", "wirksamkeit", "befunde"],
      `Aufwand, Wirksamkeit, Befunde — je genau einmal: ${JSON.stringify(gerufen.map((a) => a.wer))}`);
    assert.deepEqual(gerufen[2].argv, ["auswerten"], "die Befunde-Auswertung wird mit 'auswerten' gerufen");

    const gesehen = gerufen[2].gesehen;
    assert.equal(gesehen.length, 1, `genau ein Ergebnisstand zum Zeitpunkt des Aufrufs: ${JSON.stringify(gesehen)}`);
    assert.equal(gesehen[0].abschluss, "regulaer",
      "die Befunde-Auswertung las den eigenen Lauf ohne Abschlussart — dann ginge der frischeste Lauf als unvollstaendig ein");
    assert.equal(gesehen[0].complete, true, "die Befunde-Auswertung las den eigenen Lauf als unvollstaendig");
    // Der Nachweis fuer „vor dem zweiten schreibeErgebnisstand()": Stuenden die beiden
    // anderen Bloecke auf der Platte, waere dazwischen schon geschrieben worden.
    assert.equal(gesehen[0].hatAufwand, false,
      "zwischen den Auswertungen darf der Stand nicht geschrieben werden — erst alle drei, dann schreiben");
    assert.equal(gesehen[0].hatWirksamkeit, false, "dasselbe fuer den Wirksamkeits-Block");
  });
});

test("[night-64] der Ergebnisstand traegt nach dem Lauf alle drei Auswertungen am Lauf-Kopf", NUR_POSIX, () => {
  mitProjekt("night-befunde-standfeld-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const s = stand(dir);
    assert.ok(s.befunde, "der Ergebnisstand traegt kein Feld 'befunde' am Lauf-Kopf");
    assert.equal(s.befunde.befund[0].text, BEFUNDE_TEXT, "das Feld traegt nicht das Ergebnis der Befunde-Auswertung");
    assert.equal(s.aufwand.befund[0].text, AUFWAND_TEXT, "das Feld der Aufwands-Auswertung darf dabei nicht verlorengehen");
    assert.equal(s.wirksamkeit.befund[0].text, WIRK_TEXT, "das Feld der Wirksamkeits-Auswertung darf dabei nicht verlorengehen");
    // Der zweite Schreibvorgang ist der Beweis: Ohne ihn stuenden die Felder nur im Speicher.
    assert.equal(s.abschluss, "regulaer", "die Abschlussart darf der zweite Schreibvorgang nicht verlieren");
    assert.equal(s.complete, true, "die Vollstaendigkeit darf der zweite Schreibvorgang nicht verlieren");
  });
});

test("[night-64] die drei Befundbloecke stehen im Protokoll in der Reihenfolge ihrer Aufrufe", NUR_POSIX, () => {
  mitProjekt("night-befunde-block-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const log = protokoll(dir);
    assert.ok(log.includes(BEFUNDE_KOPF), `die Kopfzeile des Befunde-Blocks fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.includes(BEFUNDE_TEXT), `der Befunde-Befund fehlt im Laufprotokoll:\n${log}`);
    assert.ok(log.indexOf(AUFWAND_TEXT) < log.indexOf(WIRK_TEXT),
      `der Wirksamkeits-Block gehoert hinter den Aufwands-Block:\n${log}`);
    assert.ok(log.indexOf(WIRK_TEXT) < log.indexOf(BEFUNDE_KOPF),
      `der Befunde-Block gehoert hinter den Wirksamkeits-Block:\n${log}`);
  });
});

test("[night-64] ohne Befund steht nichts im Protokoll, und die beiden anderen Bloecke bleiben unberuehrt", NUR_POSIX, () => {
  mitProjekt("night-befunde-stumm-", { befundeStub: stubMitErgebnis("befunde", BEFUNDE_OHNE_BEFUND) }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.equal(aufrufe(capture).filter((a) => a.wer === "befunde").length, 1, "die Befunde-Auswertung lief auch ohne Befund");
    const s = stand(dir);
    assert.deepEqual(s.befunde.befund, [], "der Lauf-Kopf traegt den leeren Befund — er ist gemessen, nicht ausgelassen");

    const log = protokoll(dir);
    assert.ok(!log.includes("Befunde der Modell-Pruefungen"), `ohne Befund darf keine Kopfzeile der Befunde im Protokoll stehen:\n${log}`);
    assert.ok(!log.includes(BEFUNDE_TEXT), `ohne Befund darf kein Befunde-Befund im Protokoll stehen:\n${log}`);
    assert.ok(log.includes(AUFWAND_TEXT), `der Aufwands-Block bleibt unberuehrt:\n${log}`);
    assert.ok(log.includes(WIRK_TEXT), `der Wirksamkeits-Block bleibt unberuehrt:\n${log}`);
  });
});

// --- Kein Gate ----------------------------------------------------------------

/** Die Protokollzeilen, die den Fehlschlag der Befunde-Auswertung melden. */
function fehlerzeilen(dir) {
  return protokoll(dir).split("\n").filter((z) => z.includes("Befunde-Auswertung"));
}

test("[night-64] ein Kindprozess mit Exit ungleich 0 ist eine Protokollzeile und laesst den Lauf unveraendert", NUR_POSIX, () => {
  mitProjekt("night-befunde-exit-", { befundeStub: BEFUNDE_STUB_EXIT_UNGLEICH_NULL }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    assert.match(zeilen[0], /Probefehler beim Auswerten der Befunde/, "die Zeile nennt den Grund des Werkzeugs nicht");

    const s = stand(dir);
    assert.equal(s.abschluss, "regulaer", "die Auswertung ist Beiwerk, kein Gate");
    assert.equal(s.complete, true);
    assert.equal(s.aufwand.befund[0].text, AUFWAND_TEXT, "der Aufwands-Teil darf vom Fehlschlag nicht betroffen sein");
    assert.equal(s.wirksamkeit.befund[0].text, WIRK_TEXT, "der Wirksamkeits-Teil darf vom Fehlschlag nicht betroffen sein");
  });
});

test("[night-64] fehlt befunde.mjs ganz, endet der Lauf mit unveraendertem Exit-Code und einer Zeile", NUR_POSIX, () => {
  mitProjekt("night-befunde-fehlt-", { befundeStub: null }, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture);
    assert.equal(res.status, 0, `der Lauf haette unveraendert enden muessen: ${res.stderr}\n${res.stdout}`);

    const zeilen = fehlerzeilen(dir);
    assert.equal(zeilen.length, 1, `genau eine Zeile zum Fehlschlag erwartet: ${zeilen.join(" / ")}`);
    // Der Ergebnisstand entsteht trotzdem und ist vollstaendig — er ist der Bericht des
    // Laufs, und der haengt nicht an seiner Auswertung.
    assert.equal(stand(dir).complete, true);
  });
});

test("[night-64] im Dry-Run entfaellt der Aufruf ganz", NUR_POSIX, () => {
  mitProjekt("night-befunde-dryrun-", {}, (dir, capture) => {
    const res = laufMitEinemPaket(dir, capture, ["--dry-run"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(aufrufe(capture), [], "der Dry-Run hat eine Auswertung gerufen — er wertet nichts aus und schreibt nichts");
  });
});
