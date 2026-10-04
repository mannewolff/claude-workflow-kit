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
  run, board, mitProjekt, umgebung, stand,
  PAKETE_MIT_ABHAENGIGKEIT, UMSETZUNG_ERFOLG, UMSETZUNG_HALT, jePaket,
} from "./helpers/kette-fixture.mjs";
import { ERZEUGEN, fachplanB, umsetzung } from "./helpers/kette-umsetzung-fixture.mjs";

const BLOCK_KOPF = "Abhaengigkeiten, wie der Nachtlauf sie liest:";
const NEU = "nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.";
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

test("[night-1062] ein zurueckgestelltes Paket traegt unter der unveraenderten ersten Zeile den Befund", () => {
  mitProjekt((dir) => {
    const fertig = karte(dir, "Schon fertig", "## Abhaengigkeiten\nKeine.", "in_review");
    const plan = karte(dir, "[Plan] Ein Plandokument", "## Kontext\nx");
    const paket = karte(dir, "Wartet auf den Plan",
      `## Abhaengigkeiten\nIssue #${fertig} muss vorher fertig sein.\nDer Rahmen steht in #${plan}.`, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const erwartet = `Nachtlauf: Abhaengigkeit #${Number(plan)} nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.`;
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

test("[night-1149] eine Nummer, die das Board nicht kennt, gilt als erfuellt, und das Paket laeuft", () => {
  mitProjekt((dir) => {
    const paket = karte(dir, "Wartet auf Unbekanntes", "## Abhaengigkeiten\nIssue #9999 muss vorher fertig sein.", "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", paket).status, "in_review", "das Paket haette laufen muessen");
    assert.doesNotMatch(kartenText(dir, paket), /Nachtlauf: Abhaengigkeit/);
  });
});

test("[night-1149] unerfuellt ist nur, was in Backlog, Ready oder In progress liegt", () => {
  mitProjekt((dir) => {
    const imBacklog = karte(dir, "Im Backlog", "## Abhaengigkeiten\nKeine.");
    // Der Vorflug laesst keinen Lauf mit einer Karte in In progress an: Sie geht erst
    // waehrend der ersten Session aus Done zurueck in die Arbeit.
    const inArbeit = karte(dir, "Wieder in Arbeit", "## Abhaengigkeiten\nKeine.", "done");
    const zuerst = karte(dir, "Zuerst", "## Abhaengigkeiten\nKeine.", "ready");
    const imReview = karte(dir, "Im Review", "## Abhaengigkeiten\nKeine.", "in_review");
    const fertig = karte(dir, "Fertig", "## Abhaengigkeiten\nKeine.", "done");
    const wartetBacklog = karte(dir, "Wartet auf Backlog", `## Abhaengigkeiten\nIssue #${imBacklog}`, "ready");
    const wartetArbeit = karte(dir, "Wartet auf In progress", `## Abhaengigkeiten\nIssue #${inArbeit}`, "ready");
    // Vor seiner Voraussetzung angelegt: Sie liegt noch in Ready, wenn das Paket dran ist.
    const wartetReady = karte(dir, "Wartet auf Ready", "## Abhaengigkeiten\nKeine.", "ready");
    const imReady = karte(dir, "In Ready", "## Abhaengigkeiten\nKeine.", "ready");
    board(dir, "issue", "update", wartetReady, "--body", `## Abhaengigkeiten\nIssue #${imReady}`);
    const nachReview = karte(dir, "Nach Review", `## Abhaengigkeiten\nIssue #${imReview}`, "ready");
    const nachDone = karte(dir, "Nach Done", `## Abhaengigkeiten\nIssue #${fertig}`, "ready");

    const session = `if [ "$NIGHT_ISSUE_ID" = "${zuerst}" ]; then node .claude/kit/board.mjs issue move ${inArbeit} in_progress > /dev/null; fi\n${SESSION_ERFOLG}`;
    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: session });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const spalte = (id) => board(dir, "issue", "get", id).status;
    assert.equal(spalte(inArbeit), "in_progress", "die Voraussetzung ging nicht zurueck in die Arbeit");
    for (const id of [wartetBacklog, wartetArbeit, wartetReady]) {
      assert.equal(spalte(id), "backlog", `#${id} haette zurueckgestellt werden muessen`);
      assert.ok(kartenText(dir, id).includes(` ${NEU}`), `#${id} ohne Rueckstell-Kommentar`);
    }
    for (const id of [zuerst, nachReview, nachDone, imReady]) assert.equal(spalte(id), "in_review", `#${id} haette laufen muessen`);
  });
});

test("[night-1149] scheitert der Abruf der Sperrspalten, beginnt das Paket nicht", () => {
  mitProjekt((dir) => {
    const fertig = karte(dir, "Fertig", "## Abhaengigkeiten\nKeine.", "done");
    const paket = karte(dir, "Wartet auf Fertiges", `## Abhaengigkeiten\nIssue #${fertig}`, "ready");
    boardOhneBacklogListe(dir);

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });

    assert.match(`${res.stdout}\n${res.stderr}`, /Backlog-Liste kaputt/, "der Board-Fehler steht nicht in der Ausgabe");
    assert.notEqual(board(dir, "issue", "get", paket).status, "in_review", "das Paket lief trotz Board-Ausfall");
  }, undefined, undefined, { night: { stand: { pauseMin: 0.0001 } } });
});

/**
 * Legt vor board.mjs der Kit-Kopie eine Huelle, die `issue list --status backlog` scheitern
 * laesst und alles andere an die echte Datei reicht. Committet wie `boardMitZaehler`.
 */
function boardOhneBacklogListe(dir) {
  const kit = join(dir, ".claude", "kit");
  renameSync(join(kit, "board.mjs"), join(kit, "board-echt.mjs"));
  writeFileSync(join(kit, "board.mjs"), [
    'import { spawnSync } from "node:child_process";',
    'if (process.argv.slice(2).join(" ") === "issue list --status backlog") {',
    String.raw`  process.stderr.write("Backlog-Liste kaputt\n");`,
    "  process.exit(1);",
    "}",
    `const res = spawnSync(process.execPath, [${JSON.stringify(join(kit, "board-echt.mjs"))}, ...process.argv.slice(2)], { stdio: "inherit" });`,
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"));
  for (const a of [["add", "-A"], ["commit", "-q", "-m", "huelle"]]) {
    const r = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  }
}

test("[night-1062] ein startendes Paket mit Dokument-Verweis erzeugt eine Logzeile und keinen Kommentar", () => {
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

test("[night-1062] in der Umsetzungsstufe der Kette bleibt der Eintrag unter nichtBegonnen einzeilig", () => {
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
    assert.equal(grund, "Abhaengigkeit #3 nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.");
    assert.doesNotMatch(grund, /\n/);
  });
});

// --- Kreise (Issue #1063, Plan #1057 E7, E8, E9, E10) ---

/** Die Zeilen `Kreis: …` des Rueckstell-Kommentars an einer Karte. */
function kreisZeilen(dir, id) {
  return nachtlaufKommentar(dir, id).split("\n").filter((z) => z.startsWith("Kreis: "));
}

const n = (id) => `#${Number(id)}`;

test("[night-1063] zwei Ready-Pakete, die sich festhalten, tragen denselben Kreis, beginnend bei der kleineren Nummer", () => {
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

test("[night-1063] ein Kreis durch das Backlog wird erkannt, und das Backlog-Paket bekommt keinen Kommentar", () => {
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

test("[night-1063] ein Paket, das an einem Kreis haengt, wartet auf einen Kreis", () => {
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

test("[night-1063] ein Paket, das von sich selbst abhaengt, ist ein Kreis aus einem Paket", () => {
  mitProjekt((dir) => {
    const s = karte(dir, "Selbstbezug", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "update", s, "--body", `## Abhaengigkeiten\nIssue #${s}`);
    board(dir, "issue", "move", s, "ready");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: SESSION_ERFOLG });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(kreisZeilen(dir, s), [`Kreis: ${n(s)} -> ${n(s)}`]);
  });
});

test("[night-1063] kein Kreis-Befund ohne Erreichbarkeit ueber unerfuellte Abhaengigkeiten, auch nicht durch In review", () => {
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

test("[night-1063] ein scheiternder Abruf beendet den Pfad, und der Lauf laeuft weiter", () => {
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

test("[night-1063] jede Karte wird je Lauf hoechstens einmal abgerufen", () => {
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

// --- Der Probelauf zeigt denselben Befund (Issue #1064, Plan #1057 E12) ---

function probelauf(dir) {
  const res = run(dir, ["--dry-run", "--label", "none"]);
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  return res.stdout.split("\n").map((z) => z.replace(/^\[[^\]]*\]\s?/, ""));
}

/** Die erste Zeile des Pakets im Probelauf und die eingerueckten Zeilen darunter. */
function paketZeilen(zeilen, id, titel) {
  const kopf = zeilen.findIndex((z) => z.startsWith(`  #${id} ${titel} -> `));
  assert.ok(kopf >= 0, `keine Zeile fuer #${id}:\n${zeilen.join("\n")}`);
  const darunter = [];
  for (const z of zeilen.slice(kopf + 1)) {
    if (!z.startsWith("    ")) break;
    darunter.push(z);
  }
  return { kopf: zeilen[kopf], darunter };
}

test("[night-1064] der Probelauf nennt Herkunft und Dokument-Hinweis auch bei einem Paket, das eine Session bekaeme", () => {
  mitProjekt((dir) => {
    const fertig = karte(dir, "Schon fertig", "## Abhaengigkeiten\nKeine.", "in_review");
    const plan = karte(dir, "[Plan] Ein Plandokument", "## Kontext\nx", "in_review");
    const paket = karte(dir, "Startet trotzdem",
      `## Abhaengigkeiten\nIssue #${fertig} muss vorher fertig sein.\nDer Rahmen steht in #${plan}.`, "ready");

    const { kopf, darunter } = paketZeilen(probelauf(dir), paket, "Startet trotzdem");
    assert.match(kopf, new RegExp(`^  #${paket} Startet trotzdem -> Session 1, Modell [^\\n]*$`));
    assert.equal(darunter.length, 2, darunter.join("\n"));
    assert.ok(darunter[0].startsWith(`    - ${n(fertig)} (Schon fertig): erfuellt, aus einer Verweiszeile: „Issue #${fertig} muss vorher fertig sein.“`), darunter[0]);
    assert.ok(darunter[1].startsWith(`    - ${n(plan)} ([Plan] Ein Plandokument): erfuellt, aus erlaeuterndem Text: „Der Rahmen steht in #${plan}.“`), darunter[1]);
    assert.match(darunter[1], /Dokument \(\[Plan\]\), kein Arbeitspaket: ein Plandokument wird nie durch Umsetzung erledigt\./);
  });
});

test("[night-1064] die erste Zeile eines zurueckgestellten Pakets bleibt zeichengleich, der Befund steht darunter", () => {
  mitProjekt((dir) => {
    const offen = karte(dir, "Noch offen", "## Abhaengigkeiten\nKeine.");
    const paket = karte(dir, "Wartet", `## Abhaengigkeiten\nIssue #${offen}`, "ready");

    const { kopf, darunter } = paketZeilen(probelauf(dir), paket, "Wartet");
    assert.equal(kopf, `  #${paket} Wartet -> wuerde ins Backlog (Abhaengigkeit ${n(offen)} nicht erfuellt)`);
    assert.deepEqual(darunter, [`    - ${n(offen)} (Noch offen): unerfuellt, aus einer Verweiszeile: „Issue #${offen}“`]);
  });
});

test("[night-1064] ein Kreis erscheint im Probelauf als eigene Zeile", () => {
  mitProjekt((dir) => {
    const a = karte(dir, "Erstes", "## Abhaengigkeiten\nKeine.");
    const b = karte(dir, "Zweites", `## Abhaengigkeiten\nIssue #${a}`, "ready");
    board(dir, "issue", "update", a, "--body", `## Abhaengigkeiten\nIssue #${b}`);
    board(dir, "issue", "move", a, "ready");

    const zeilen = probelauf(dir);
    const kreis = `    Kreis: ${n(a)} -> ${n(b)} -> ${n(a)}`;
    for (const [id, titel] of [[a, "Erstes"], [b, "Zweites"]]) {
      const { darunter } = paketZeilen(zeilen, id, titel);
      assert.equal(darunter.at(-1), kreis, darunter.join("\n"));
      assert.equal(darunter.filter((z) => z.startsWith("    Kreis: ")).length, 1);
    }
  });
});

test("[night-1064] ein Paket ohne Abhaengigkeit bekommt im Probelauf keine eingerueckte Zeile", () => {
  mitProjekt((dir) => {
    const ohne = karte(dir, "Ohne", "## Abhaengigkeiten\nKeine.", "ready");
    const keinAbschnitt = karte(dir, "Ganz ohne", "## Kontext\nx", "ready");

    const zeilen = probelauf(dir);
    assert.deepEqual(paketZeilen(zeilen, ohne, "Ohne").darunter, []);
    assert.deepEqual(paketZeilen(zeilen, keinAbschnitt, "Ganz ohne").darunter, []);
  });
});
