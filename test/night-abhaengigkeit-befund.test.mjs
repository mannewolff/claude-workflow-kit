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
import { readFileSync } from "node:fs";
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
