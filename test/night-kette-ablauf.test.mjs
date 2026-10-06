// Der glatte Durchlauf einer Nacht-Kette (Plan #638; Issue #643, Stufen Pakete und Abdeckung seit #644).
//
// Ein [Fachlich] mit kit:night geht hinein. Der Fake legt als /techplan den Plan an, die
// Formpruefung ist gruen, der Fake als /issue-review setzt den Marker. Danach: Label
// weg, Ausgang fertig, Sessions liefen im Worktree, der Worktree ist weg, die Notiz
// liegt in der Hauptkopie, KIT_AGENT_MODEL war gesetzt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  run, board, mitProjekt, fachplan, umgebung, sessions, stand, planBody, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";
import { TESTHINWEIS_ANKER } from "../kit/night/kette.mjs";

const PLAN_MIT_NOTIZ = `${PLAN_ANLEGEN}; printf "notiz" > .claude/vorhaben-wartend-plan-1.md`;

test("[night-19] eine Kette laeuft bis zum geprueften Plan: Label weg, fertig, Worktree entfernt, keine Notiz geholt", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_MIT_NOTIZ, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `Kette haette durchlaufen muessen:\n${res.stdout}\n${res.stderr}`);

    // Das Board danach: Label weg, ein Plan mit der Herkunftszeile, im Backlog.
    const fach = board(dir, "issue", "get", F);
    assert.ok(!fach.labels.includes("kit:night"), "das Label muss beim Start verbraucht sein");
    assert.ok(!fach.labels.includes("kit:klaeren"));
    const plaene = board(dir, "issue", "list").filter((i) => /^\[Plan\]/.test(i.title));
    assert.equal(plaene.length, 1, "genau ein Plan entstanden");
    assert.match(plaene[0].body, new RegExp(`^Fachliche Quelle: Issue #${F}$`, "m"));
    assert.match(plaene[0].body, /^Plan-Review: opus/m, "die Review-Stufe hat den Marker gesetzt");
    assert.equal(plaene[0].status, "backlog");

    // Der Ergebnisstand.
    const lauf = stand(dir);
    assert.equal(lauf.art, "kette");
    assert.equal(lauf.schemaFassung, 1);
    assert.equal(lauf.label, "kit:night");
    assert.equal(lauf.budget.kostenUsd, 50);
    assert.equal("kennzahlenHinweis" in lauf, false, "die Kette fordert den Strom immer an");
    assert.equal("noWorkReason" in lauf, false, "eine Kette mit Arbeit traegt keinen Grund ohne Arbeit (Issue #744)");
    assert.equal(lauf.abschluss, "regulaer");
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig");
    assert.equal(einheit.stufen.plan.id, plaene[0].id);
    assert.equal(einheit.stufen.plan.korrekturrunden, 0);
    assert.equal(einheit.stufen.review.marker, true);
    assert.equal(einheit.kostenUsd, 4, "vier Sessions zu je 1 $");
    assert.equal(einheit.kostenUnbekannt, 0);
    assert.equal(lauf.kostenSumme, 4);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"]);

    // Die Sessions liefen im Worktree — nicht in der Hauptkopie — und KIT_AGENT_MODEL war gesetzt.
    const gelaufen = sessions(env.logPfad);
    assert.deepEqual(gelaufen.map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);
    for (const s of gelaufen) {
      assert.notEqual(s.cwd, realpathSync(dir), `${s.stufe} lief in der Hauptkopie`);
      assert.ok(basename(s.cwd).startsWith(`kette-${basename(dir)}-${F}-`), `${s.stufe} lief nicht im Worktree: ${s.cwd}`);
      assert.equal(s.modell, "claude-opus-5", "KIT_AGENT_MODEL fehlt in der Session");
    }
    // Worktree weg. Eine Datei, die eine Stufe im Worktree unter `.claude/vorhaben-wartend-*`
    // hinterlaesst, holt der Runner seit dem Rueckbau von SDD nicht mehr zurueck (Issue #829).
    assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`kette-${basename(dir)}-`)), "der Worktree liegt noch");
    assert.ok(!existsSync(join(dir, ".claude", "vorhaben-wartend-plan-1.md")), "der Runner holte noch eine Vorhaben-Notiz zurueck");
    assert.match(res.stdout, /Nacht-Kette beendet: 1 fertig, 0 unvollstaendig, 0 angehalten, 0 abgebrochen/);
  });
});

test("[night-19] ein Issue in In progress haelt die Kette nicht auf — sie laeuft neben der Umsetzungsnacht", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const paket = board(dir, "issue", "create", "--title", "Ein Paket in Arbeit", "--body", "## Kontext\n\nAutor-Modell: x\n\n## Abhaengigkeiten\n\nKeine.\n");
    board(dir, "issue", "move", String(paket.id), "in_progress");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /Crash-Rest/);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "fertig");
  });
});

test("[night-19] eine unsaubere Hauptkopie haelt die Kette nicht auf (Issue #878)", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    // Der Rest, den eine parallel laufende Umsetzungsnacht in der Hauptkopie liegen hat.
    // Er steht schon vor dem Start da — die Kette misst ihn gar nicht erst.
    writeFileSync(join(dir, "unfertig.md"), "ein Rest aus einem anderen Lauf\n");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "die Kette stoppte wegen des fremden Rests hart");

    const lauf = stand(dir);
    assert.equal(lauf.abschluss, "regulaer");
    assert.equal("fehlerklasse" in lauf, false, "der Lauf traegt eine Fehlerklasse");
    const einheit = lauf.einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004"], "die Pakete entstanden nicht");

    // Unter Variante A fasst die Kette die Hauptkopie nicht an: Der fremde Rest liegt noch.
    assert.equal(existsSync(join(dir, "unfertig.md")), true, "die Kette hat den fremden Rest angefasst");
  });
});

// Die Herkunft der Budgets am Lauf (Issue #659): Defaults sind im Protokoll und im
// Ergebnisstand sichtbar, ein vollstaendiger Block hinterlaesst keine Spur.
const VOLLER_BLOCK = {
  label: "kit:night", varianteBLabel: "kit:durchziehen", planMin: 30, paketeMin: 25, reviewMin: 30,
  abdeckungMin: 10, umsetzungMin: 120, kostenUsd: 50, kostenUsdB: 150, korrekturrunden: 2,
};

test("[night-28] ohne gesetzte Budget-Felder traegt der Lauf-Kopf budgetAusDefault und das Protokoll die Hinweiszeile", () => {
  mitProjekt((dir) => {
    const env = umgebung(dir);
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = stand(dir);
    assert.deepEqual(lauf.budgetAusDefault,
      ["label", "varianteBLabel", "planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB", "korrekturrunden"]);
    assert.deepEqual(Object.keys(lauf).slice(Object.keys(lauf).indexOf("budget"), Object.keys(lauf).indexOf("budget") + 2), ["budget", "budgetAusDefault"],
      "budgetAusDefault steht unmittelbar hinter budget");
    assert.match(res.stdout, /aus den Defaults: .*reviewMin=15.*night\.kette/);
  });
});

test("[night-28] mit vollstaendigem Block fehlen budgetAusDefault und die Hinweiszeile", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal("budgetAusDefault" in stand(dir), false);
    assert.doesNotMatch(res.stdout, /aus den Defaults/);
  }, VOLLER_BLOCK);
});

test("[night-28] fehlt genau ein Feld, nennt der Lauf genau dieses", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(stand(dir).budgetAusDefault, ["reviewMin"]);
    assert.match(res.stdout, /aus den Defaults: reviewMin=15/);
    assert.doesNotMatch(res.stdout, /night\.kette in/);
  }, { ...VOLLER_BLOCK, reviewMin: undefined });
});

// Verbrauch, Lauf-Art, complete und Einlieferung am Lauf (Issue #669).
test("[night-29] [night-30] die Kette traegt Verbrauch je Einheit und Lauf, den Rest, die Art je Einheit und complete", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const lauf = stand(dir);
    const e = lauf.einheiten.find((x) => x.id === F);
    assert.equal(e.art, "kette");
    assert.deepEqual(e.verbrauch, { kostenUsd: 4, eingabeTokens: 40, ausgabeTokens: 80, cacheErzeugtTokens: 120, cacheGelesenTokens: 160 }, "vier Sessions");
    assert.deepEqual(lauf.verbrauch, e.verbrauch, "keine Session ohne Karte");
    assert.deepEqual(lauf.verbrauchOhneEinheit, { kostenUsd: 0, eingabeTokens: 0, ausgabeTokens: 0, cacheErzeugtTokens: 0, cacheGelesenTokens: 0 });
    assert.equal(lauf.complete, true, "[night-31] regulaer beendet");
  });
});

test("[night-31] mit lokalem Tracker entfaellt die Einlieferung und das Protokoll sagt es", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--kette"], umgebung(dir));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Einlieferung entfaellt: issueTracker 'local'/);
  });
});

test("[night-31] eine gescheiterte Einlieferung beendet den Lauf nicht als Fehlschlag, das Protokoll nennt den Grund", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = { ...umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } }), NIGHT_MELDEN_ERZWINGEN: "1" };
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Einlieferung fehlgeschlagen: .*nur mit issueTracker toolbox/);
    assert.equal(stand(dir).einheiten.find((x) => x.id === F).ausgang, "fertig");
    assert.equal(stand(dir).abschluss, "regulaer");
  });
});

// Testhinweise der Formpruefung (Issue #1033, Plan #1029 A10): Was nach der Planungssitzung an
// Hinweisen stehen bleibt, schreibt der Runner als Kommentar an den Plan. Die Formpruefung
// laeuft im Worktree der Kette, also gegen den Stand, gegen den geplant wurde. Hinweise
// aendern `ok` nicht: Die Kette laeuft weiter, ohne Korrekturrunde.

const NAV = "src/app/nav/side-nav.ts";
const NAV_SPEC = "src/app/nav/side-nav.spec.ts";

/** Legt Baustein und eigenen Test versioniert ins Fixture-Repo — der Worktree entsteht aus HEAD. */
function navVersionieren(dir) {
  mkdirSync(join(dir, "src", "app", "nav"), { recursive: true });
  writeFileSync(join(dir, NAV), "export const nav = [];\n");
  writeFileSync(join(dir, NAV_SPEC), "// erwartet nichts oberhalb des Fusses\n");
  for (const a of [["add", NAV, NAV_SPEC], ["commit", "-q", "-m", "Navigation"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
}

/** Wie oft der Anker in der Datei einer Karte steht. */
function testhinweisAnker(dir, id) {
  return readFileSync(join(dir, "issues", `${id}.md`), "utf-8").split(TESTHINWEIS_ANKER).length - 1;
}

const PLAN_MIT_NAV = planBody().replace("- kit/night.mjs: eine Funktion.", `- ${NAV}: der Fuss wandert nach oben.`);

test("[night-19] bleibt ein Testhinweis stehen, laeuft die Kette weiter und der Plan traegt genau einen Kommentar", () => {
  mitProjekt((dir) => {
    navVersionieren(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { plan: PLAN_MIT_NAV, stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.plan.korrekturrunden, 0, "ein Hinweis startet keine Korrekturrunde");
    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["plan", "review", "pakete", "abdeckung"]);

    const planId = einheit.stufen.plan.id;
    assert.equal(testhinweisAnker(dir, planId), 1, "genau ein Kommentar mit dem Anker am Plan");
    const text = readFileSync(join(dir, "issues", `${planId}.md`), "utf-8");
    const block = text.slice(text.indexOf(TESTHINWEIS_ANKER));
    assert.match(block, new RegExp(`^${TESTHINWEIS_ANKER}$`, "m"), "der Anker steht auf einer eigenen Zeile");
    const zeilen = block.split("\n").filter((z) => z.includes(" gehört "));
    assert.equal(zeilen.length, 1, "eine Zeile je Hinweis");
    assert.ok(zeilen[0].includes(NAV) && zeilen[0].includes(NAV_SPEC), zeilen[0]);

    // Die Paket-Formpruefung in stufePakete schreibt nie einen solchen Kommentar.
    for (const id of einheit.stufen.pakete.ids) {
      assert.equal(testhinweisAnker(dir, id), 0, `Paket #${id} traegt einen Testhinweis-Kommentar`);
    }
  });
});

test("[night-19] ohne Testhinweis bekommt der Plan keinen Kommentar mit dem Anker", () => {
  mitProjekt((dir) => {
    navVersionieren(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(testhinweisAnker(dir, einheit.stufen.plan.id), 0);
  });
});

test("[night-19] die Paket-Formpruefung schreibt keinen Testhinweis-Kommentar, auch wenn ein Paket den Baustein fuehrt", () => {
  mitProjekt((dir) => {
    navVersionieren(dir);
    const F = fachplan(dir);
    // Ein Paket, das denselben Baustein in seiner Aufgabe fuehrt: Die Stufe `issue` kennt keine
    // Testhinweise, also auch keinen Kommentar.
    const paketMitNav = PAKETE_ANLEGEN.replaceAll("Paket %s in", `Paket %s: ${NAV}, in`);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: paketMitNav } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.equal(einheit.stufen.pakete.ids.length, 2);
    for (const id of einheit.stufen.pakete.ids) {
      assert.ok(readFileSync(join(dir, "issues", `${id}.md`), "utf-8").includes(NAV), `Paket #${id} fuehrt den Baustein nicht`);
      assert.equal(testhinweisAnker(dir, id), 0, `Paket #${id} traegt einen Testhinweis-Kommentar`);
    }
  });
});

// Abhaengigkeits-Hinweise der Pakete (Issue #1059, Plan #1057 E4): `issue check-form` liefert
// kuenftig auch bei Paketen einen Schluessel `hinweise`, aber mit Eintraegen ohne `baustein`
// und `test`. Die Formstufe vermerkt nur echte Testhinweise. Der Fake legt vor die echte
// board.mjs eine Huelle, die jeder gruenen Formpruefung einen Abhaengigkeits-Hinweis beigibt.

const SCHREIBWEISE_MELDUNG = "Nummer #724 steht ausserhalb einer Verweiszeile und zaehlt als Abhaengigkeit.";

function checkFormMitSchreibweise(dir) {
  const kit = join(dir, ".claude", "kit");
  writeFileSync(join(kit, "board-echt.mjs"), readFileSync(join(kit, "board.mjs")));
  writeFileSync(join(kit, "board.mjs"), `import { spawnSync } from "node:child_process";
import { join } from "node:path";
const args = process.argv.slice(2);
const res = spawnSync(process.execPath, [join(import.meta.dirname, "board-echt.mjs"), ...args], { encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"] });
let out = res.stdout;
if (args[0] === "issue" && args[1] === "check-form") {
  try {
    const json = JSON.parse(out);
    if (json.ok) {
      json.hinweise = [...(json.hinweise || []), { art: "schreibweise", nummer: 724, stelle: "Nicht #724: erlaeutert nur.", meldung: ${JSON.stringify(SCHREIBWEISE_MELDUNG)} }];
      out = JSON.stringify(json, null, 2) + "\\n";
    }
  } catch {}
}
process.stdout.write(out);
process.stderr.write(res.stderr);
process.exit(res.status ?? 1);
`);
}

test("[night-19] ein Abhaengigkeits-Hinweis erzeugt keinen Testhinweis-Kommentar, ein echter Testhinweis am Plan weiterhin", () => {
  mitProjekt((dir) => {
    navVersionieren(dir);
    checkFormMitSchreibweise(dir);
    const F = fachplan(dir);
    const env = umgebung(dir, { plan: PLAN_MIT_NAV, stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);

    for (const id of einheit.stufen.pakete.ids) {
      assert.equal(testhinweisAnker(dir, id), 0, `Paket #${id} traegt einen Testhinweis-Kommentar`);
    }
    const planId = einheit.stufen.plan.id;
    assert.equal(testhinweisAnker(dir, planId), 1, "der echte Testhinweis steht weiterhin am Plan");
    const text = readFileSync(join(dir, "issues", `${planId}.md`), "utf-8");
    const block = text.slice(text.indexOf(TESTHINWEIS_ANKER));
    assert.ok(block.includes(NAV_SPEC), block);
    assert.ok(!text.includes(SCHREIBWEISE_MELDUNG), "der Abhaengigkeits-Hinweis gehoert nicht in den Kommentar");
  });
});
