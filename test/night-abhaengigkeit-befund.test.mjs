// Der Abhaengigkeitsbefund des Nachtlaufs (Issue #1062, Plan #1057 E6, E10, E11).
//
// Stellt der Lauf ein Paket wegen einer Abhaengigkeit zurueck, haengt unter der
// unveraenderten ersten Zeile ein Block an der Karte: je Abhaengigkeit Nummer,
// erfuellt oder unerfuellt, Herkunft, Textstelle und bei einem Dokument der Hinweis
// darauf. Der einzeilige `kommentar` bleibt, wie er war — der `grund` der Einheit und
// der Kettenbericht lesen ihn.
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo
// mit lokalem Tracker (das Fake-Board), die Sessions sind Shell-Fakes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, umgebung, stand,
  PAKETE_MIT_ABHAENGIGKEIT, UMSETZUNG_ERFOLG, UMSETZUNG_HALT, jePaket,
} from "./helpers/kette-fixture.mjs";
import { ERZEUGEN, fachplanB, umsetzung } from "./helpers/kette-umsetzung-fixture.mjs";

const BLOCK_KOPF = "Abhaengigkeiten, wie der Nachtlauf sie liest:";
const SESSION_ERFOLG = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;

function karte(dir, titel, body, status = null) {
  const id = String(board(dir, "issue", "create", "--title", titel, "--body", body).id);
  if (status) board(dir, "issue", "move", id, status);
  return id;
}

function kartenText(dir, id) {
  return readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
}

/** Der Kommentar des Nachtlaufs an einer Karte, von seiner ersten Zeile bis zum Dateiende. */
function nachtlaufKommentar(dir, id) {
  const text = kartenText(dir, id);
  const start = text.indexOf("Nachtlauf: Abhaengigkeit");
  assert.ok(start >= 0, `kein Rueckstell-Kommentar an #${id}:\n${text}`);
  return text.slice(start);
}

test("[night-1062] ein zurueckgestelltes Paket traegt unter der unveraenderten ersten Zeile den Befund", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const fertig = karte(dir, "Schon fertig", "## Abhaengigkeiten\nKeine.", "in_review");
    const plan = karte(dir, "[Plan] Ein Plandokument", "## Kontext\nx");
    const paket = karte(dir, "Wartet auf den Plan",
      `## Abhaengigkeiten\nIssue #${fertig} muss vorher fertig sein.\nDer Rahmen steht in #${plan}.`, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const erwartet = `Nachtlauf: Abhaengigkeit #${Number(plan)} nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.`;
    const kommentar = nachtlaufKommentar(dir, paket);
    const zeilen = kommentar.split("\n");
    assert.equal(zeilen[0], erwartet, "die erste Zeile des Kommentars hat sich geaendert");
    assert.equal(zeilen[1], "", "zwischen Kommentar und Block fehlt die Leerzeile");
    assert.equal(zeilen[2], BLOCK_KOPF);

    const zeileFertig = zeilen.find((z) => z.startsWith(`- #${Number(fertig)} `));
    assert.ok(zeileFertig, `keine Zeile fuer #${Number(fertig)}:\n${kommentar}`);
    assert.match(zeileFertig, /Schon fertig/);
    assert.match(zeileFertig, /: erfuellt, aus einer Verweiszeile/);
    assert.ok(zeileFertig.includes(`Issue #${fertig} muss vorher fertig sein.`), zeileFertig);
    assert.doesNotMatch(zeileFertig, /Dokument/);

    const zeilePlan = zeilen.find((z) => z.startsWith(`- #${Number(plan)} `));
    assert.ok(zeilePlan, `keine Zeile fuer #${Number(plan)}:\n${kommentar}`);
    assert.match(zeilePlan, /: unerfuellt, aus erlaeuterndem Text/);
    assert.ok(zeilePlan.includes(`Der Rahmen steht in #${plan}.`), zeilePlan);
    assert.match(zeilePlan, /Dokument \(\[Plan\]\), kein Arbeitspaket/);
    assert.match(zeilePlan, /Plandokument wird nie durch Umsetzung erledigt/);

    // Die Logzeile bleibt einzeilig und zeichengleich.
    assert.match(res.stdout, new RegExp(`#${paket} zurueckgestellt: Abhaengigkeit #${Number(plan)} nicht erfuellt\\.\\n`));
    assert.doesNotMatch(res.stdout, new RegExp(BLOCK_KOPF));

    // Einzeilig bleibt: der `grund` der Einheit ist genau die erste Zeile, ohne Block.
    const einheit = stand(dir).einheiten.find((e) => e.id === paket);
    assert.ok(einheit, "keine Einheit fuer das zurueckgestellte Paket");
    assert.equal(einheit.ausgang, "zurueckgestellt");
    assert.equal(einheit.grund, erwartet);
  });
});

test("[night-1062] eine unbekannte Nummer wird wie bisher zurueckgestellt, und der Lauf laeuft weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const paket = karte(dir, "Wartet auf Unbekanntes", "## Abhaengigkeiten\nIssue #9999 muss vorher fertig sein.", "ready");
    const danach = karte(dir, "Laeuft danach", "## Abhaengigkeiten\nKeine.", "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", paket).status, "backlog");
    assert.equal(board(dir, "issue", "get", danach).status, "in_review", "der Lauf lief nach der unbekannten Nummer nicht weiter");
    const zeilen = nachtlaufKommentar(dir, paket).split("\n");
    assert.equal(zeilen[0], "Nachtlauf: Abhaengigkeit #9999 nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.");
    assert.equal(zeilen[2], BLOCK_KOPF);
    const zeile = zeilen.find((z) => z.startsWith("- #9999"));
    assert.ok(zeile, zeilen.join("\n"));
    assert.match(zeile, /^- #9999: unerfuellt, aus einer Verweiszeile/, "eine unbekannte Nummer traegt weder Titel noch Dokument-Hinweis");
    assert.doesNotMatch(zeile, /Dokument/);
  });
});

test("[night-1062] ein startendes Paket mit Dokument-Verweis erzeugt eine Logzeile und keinen Kommentar", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const plan = karte(dir, "[Plan] Liegt in Review", "## Kontext\nx", "in_review");
    const paket = karte(dir, "Startet trotz Dokument-Verweis", `## Abhaengigkeiten\nIssue #${plan}`, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", paket).status, "in_review", "das Paket lief nicht");
    const logZeile = res.stdout.split("\n").find((z) => z.includes(`#${paket} startet mit Dokument-Verweis`));
    assert.ok(logZeile, `keine Logzeile zum Dokument-Verweis:\n${res.stdout}`);
    assert.match(logZeile, new RegExp(`#${Number(plan)} \\(\\[Plan\\]\\)`));
    // Der Fake faehrt keine Pruefung, deshalb haengt der Nachweis-Vermerk der Runde an der
    // Karte — gemeint ist hier allein ein Kommentar des Abhaengigkeits-Gates.
    assert.doesNotMatch(kartenText(dir, paket), /Nachtlauf: Abhaengigkeit|Abhaengigkeiten, wie|kein Arbeitspaket/,
      "das startende Paket bekam einen Kommentar zu seinen Abhaengigkeiten");
  });
});

test("[night-1062] in der Umsetzungsstufe der Kette bleibt der Eintrag unter nichtBegonnen einzeilig", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const stufen = {
      ...ERZEUGEN,
      pakete: PAKETE_MIT_ABHAENGIGKEIT,
      umsetzung: jePaket({ "0003": UMSETZUNG_HALT }, UMSETZUNG_ERFOLG),
    };
    const res = run(dir, ["--kette"], umgebung(dir, { stufen }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { stufe } = umsetzung(dir, F);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), ["0004"]);
    const { grund } = stufe.nichtBegonnen[0];
    assert.equal(grund, "Abhaengigkeit #3 nicht erfuellt (nicht in In review/Done) — Issue zurueckgestellt.");
    assert.doesNotMatch(grund, /\n/);
  });
});

// --- Kreise (Issue #1063, Plan #1057 E7, E8, E9, E10) ---

/** Die Zeilen `Kreis: …` des Rueckstell-Kommentars an einer Karte. */
function kreisZeilen(dir, id) {
  return nachtlaufKommentar(dir, id).split("\n").filter((z) => z.startsWith("Kreis: "));
}

const n = (id) => `#${Number(id)}`;

test("[night-1063] zwei Ready-Pakete, die sich festhalten, tragen denselben Kreis, beginnend bei der kleineren Nummer", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = karte(dir, "Erstes", "## Abhaengigkeiten\nKeine.");
    const b = karte(dir, "Zweites", `## Abhaengigkeiten\nIssue #${a}`, "ready");
    board(dir, "issue", "update", a, "--body", `## Abhaengigkeiten\nIssue #${b}`);
    board(dir, "issue", "move", a, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const kreis = `Kreis: ${n(a)} -> ${n(b)} -> ${n(a)}`;
    assert.deepEqual(kreisZeilen(dir, a), [kreis]);
    assert.deepEqual(kreisZeilen(dir, b), [kreis]);
    // Die erste Zeile bleibt, und der Kreis steht nach den Abhaengigkeitszeilen.
    const zeilen = nachtlaufKommentar(dir, b).split("\n");
    assert.match(zeilen[0], /^Nachtlauf: Abhaengigkeit #\d+ nicht erfuellt/);
    assert.equal(zeilen.indexOf(kreis), zeilen.findLastIndex((z) => z.startsWith("- #")) + 1);
    // Die zweite Logzeile nennt den Kreis.
    assert.match(res.stdout, new RegExp(`#${a} steht in einem Kreis: ${kreis.slice(7)}\\n`));
    assert.match(res.stdout, new RegExp(`#${b} steht in einem Kreis: ${kreis.slice(7)}\\n`));
  });
});

test("[night-1063] ein Kreis durch das Backlog wird erkannt, und das Backlog-Paket bekommt keinen Kommentar", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = karte(dir, "Anfang", "## Abhaengigkeiten\nKeine.");
    const b = karte(dir, "Im Backlog", "## Abhaengigkeiten\nKeine.");
    const c = karte(dir, "Ende", `## Abhaengigkeiten\nIssue #${a}`, "ready");
    board(dir, "issue", "update", a, "--body", `## Abhaengigkeiten\nIssue #${b}`);
    board(dir, "issue", "update", b, "--body", `## Abhaengigkeiten\nIssue #${c}`);
    board(dir, "issue", "move", a, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const kreis = `Kreis: ${n(a)} -> ${n(b)} -> ${n(c)} -> ${n(a)}`;
    assert.deepEqual(kreisZeilen(dir, a), [kreis]);
    assert.deepEqual(kreisZeilen(dir, c), [kreis]);
    assert.doesNotMatch(kartenText(dir, b), /Nachtlauf/, "das Backlog-Paket bekam einen Kommentar");
    assert.equal(board(dir, "issue", "get", b).status, "backlog");
  });
});

test("[night-1063] ein Paket, das an einem Kreis haengt, wartet auf einen Kreis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const x = karte(dir, "Kreis eins", "## Abhaengigkeiten\nKeine.");
    const y = karte(dir, "Kreis zwei", `## Abhaengigkeiten\nIssue #${x}`);
    board(dir, "issue", "update", x, "--body", `## Abhaengigkeiten\nIssue #${y}`);
    const r = karte(dir, "Haengt dran", `## Abhaengigkeiten\nIssue #${y}`, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const kreis = `${n(x)} -> ${n(y)} -> ${n(x)}`;
    assert.deepEqual(kreisZeilen(dir, r), [`Kreis: ${kreis} — dieses Paket wartet auf einen Kreis.`]);
    assert.match(res.stdout, new RegExp(`#${r} wartet auf einen Kreis: ${kreis}\\n`));
    assert.doesNotMatch(res.stdout, new RegExp(`#${r} steht in einem Kreis`));
    for (const id of [x, y]) assert.doesNotMatch(kartenText(dir, id), /Nachtlauf/);
  });
});

test("[night-1063] ein Paket, das von sich selbst abhaengt, ist ein Kreis aus einem Paket", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const s = karte(dir, "Selbstbezug", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "update", s, "--body", `## Abhaengigkeiten\nIssue #${s}`);
    board(dir, "issue", "move", s, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(kreisZeilen(dir, s), [`Kreis: ${n(s)} -> ${n(s)}`]);
  });
});

test("[night-1063] kein Kreis-Befund ohne Erreichbarkeit ueber unerfuellte Abhaengigkeiten, auch nicht durch In review", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Ein Kreis im Backlog, den kein Ready-Paket erreicht.
    const x = karte(dir, "Abseits eins", "## Abhaengigkeiten\nKeine.");
    const y = karte(dir, "Abseits zwei", `## Abhaengigkeiten\nIssue #${x}`);
    board(dir, "issue", "update", x, "--body", `## Abhaengigkeiten\nIssue #${y}`);
    const z = karte(dir, "Liegt nur im Backlog", "## Abhaengigkeiten\nKeine.");
    const r = karte(dir, "Wartet ohne Kreis", `## Abhaengigkeiten\nIssue #${z}`, "ready");
    // Ein Kreis durch eine Karte in In review haelt niemanden fest.
    const p = karte(dir, "Durch Review", "## Abhaengigkeiten\nKeine.");
    const q = karte(dir, "In Review", `## Abhaengigkeiten\nIssue #${p}`, "in_review");
    board(dir, "issue", "update", p, "--body", `## Abhaengigkeiten\nIssue #${q}\nIssue #${z}`);
    board(dir, "issue", "move", p, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(kreisZeilen(dir, r), []);
    assert.deepEqual(kreisZeilen(dir, p), []);
    assert.doesNotMatch(res.stdout, /in einem Kreis|wartet auf einen Kreis/);
  });
});

test("[night-1063] ein scheiternder Abruf beendet den Pfad, und der Lauf laeuft weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const r = karte(dir, "Anfang", "## Abhaengigkeiten\nKeine.");
    const b = karte(dir, "Mitte", `## Abhaengigkeiten\nIssue #9999\nIssue #${r}`);
    board(dir, "issue", "update", r, "--body", `## Abhaengigkeiten\nIssue #${b}`);
    board(dir, "issue", "move", r, "ready");
    const danach = karte(dir, "Laeuft danach", "## Abhaengigkeiten\nKeine.", "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", r).status, "backlog");
    assert.deepEqual(kreisZeilen(dir, r), [`Kreis: ${n(r)} -> ${n(b)} -> ${n(r)}`]);
    assert.equal(board(dir, "issue", "get", danach).status, "in_review", "der Lauf lief nach dem gescheiterten Abruf nicht weiter");
  });
});

/**
 * Legt vor board.mjs der Kit-Kopie einen Zaehler: Jeder Aufruf schreibt seine Argumente
 * nach helfer/board-aufrufe.log und reicht an die echte Datei weiter. Committet, damit der
 * Vorflug den Arbeitsbaum sauber sieht.
 */
function boardMitZaehler(dir) {
  const kit = join(dir, ".claude", "kit");
  renameSync(join(kit, "board.mjs"), join(kit, "board-echt.mjs"));
  mkdirSync(join(dir, "helfer"), { recursive: true });
  const logPfad = join(dir, "helfer", "board-aufrufe.log");
  writeFileSync(join(kit, "board.mjs"), [
    'import { appendFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    `appendFileSync(${JSON.stringify(logPfad)}, process.argv.slice(2).join(" ") + "\\n");`,
    `const res = spawnSync(process.execPath, [${JSON.stringify(join(kit, "board-echt.mjs"))}, ...process.argv.slice(2)], { stdio: "inherit" });`,
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"));
  for (const a of [["add", "-A"], ["commit", "-q", "-m", "zaehler"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
  return logPfad;
}

test("[night-1063] jede Karte wird je Lauf hoechstens einmal abgerufen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = karte(dir, "Anfang", "## Abhaengigkeiten\nKeine.");
    const b = karte(dir, "Im Backlog", "## Abhaengigkeiten\nKeine.");
    const c = karte(dir, "Ende", `## Abhaengigkeiten\nIssue #${a}\nIssue #9999`, "ready");
    board(dir, "issue", "update", a, "--body", `## Abhaengigkeiten\nIssue #${b}`);
    board(dir, "issue", "update", b, "--body", `## Abhaengigkeiten\nIssue #${c}\nIssue #9999`);
    board(dir, "issue", "move", a, "ready");
    const logPfad = boardMitZaehler(dir);

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(kreisZeilen(dir, a).length, 1, "der Kreis wurde nicht erkannt");

    const abrufe = new Map();
    for (const zeile of readFileSync(logPfad, "utf-8").split("\n")) {
      const treffer = /^issue get (\S+)$/.exec(zeile);
      if (treffer) abrufe.set(Number(treffer[1]), (abrufe.get(Number(treffer[1])) ?? 0) + 1);
    }
    assert.ok(abrufe.size > 0, "der Zaehler sah keinen Abruf");
    for (const [id, anzahl] of abrufe) assert.equal(anzahl, 1, `#${id} wurde ${anzahl}-mal abgerufen`);
  });
});
