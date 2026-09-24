// Der Prueflauf am Tag: `node .claude/kit/night.mjs --pruefen` (Fachplan #899, Plan #904;
// Issue #909).
//
// Ein Durchlauf gegen ein Wegwerf-Repo mit lokalem Tracker, OHNE `--max` — der Lauf kennt
// keinen Zahlendeckel, begrenzt wird er ueber seine Budgets (E9). Fuenf gekennzeichnete
// fachliche Anforderungen gehen hinein, eine gekennzeichnete Plan-Karte wird uebersprungen.
// Geprueft werden Labels, Vermerk, Ergebnisstand, Liste auf stdout, Worktree und die
// Hauptkopie, die der Lauf nicht anfassen darf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  KLAEREN_LABEL, REVIEW_FERTIG_LABEL, PRUEFLAUF_REST_ANKER, PRUEFLAUF_BEFUNDE_ANKER,
  pruefLaufFassung,
} from "../kit/night.mjs";
import {
  NIGHT, NUR_POSIX, run, board, mitProjekt, fachplan, fachplanBody, sessions, stand,
  pruefUmgebung, FACHPLAN_MARKER, PRUEFUNG_GEPRUEFT, PRUEFUNG_HALT, PRUEFUNG_BEFUNDE, PRUEFUNG_FRAGE,
} from "./helpers/kette-fixture.mjs";

const PRUEF_LABEL = "kit:pruefen";
const BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };

/** Ein Repo mit dem Wurzelblock `pruefLauf` — er steht nicht unter `night` (Plan #904, E12). */
function mitPruefProjekt(fn, budget = BUDGET) {
  mitProjekt(fn, {}, "night-pruefen-", { pruefLauf: budget });
}

/**
 * Die sechs Karten des Durchlaufs, in der Reihenfolge des lokalen Trackers.
 *
 * Vier fachliche Anforderungen decken die vier Ausgaenge ab, die eine Session haben kann;
 * die fuenfte traegt Marker, `review:fertig` und einen Befunde-Kommentar schon aus einem
 * Vorlauf (E16). Die Plan-Karte gehoert nicht in den Prueflauf und wird uebersprungen.
 */
function karten(dir) {
  const geprueft = fachplan(dir, "[Fachlich] Vollstaendig geprueft", PRUEF_LABEL, false);
  const halt = fachplan(dir, "[Fachlich] Mit wartender Entscheidung", PRUEF_LABEL, false);
  const ohneSpur = fachplan(dir, "[Fachlich] Ohne jede Spur", PRUEF_LABEL, false);
  const vorlauf = fachplan(dir, "[Fachlich] Schon geprueft", PRUEF_LABEL, true, fachplanBody({ marker: FACHPLAN_MARKER }));
  board(dir, "issue", "comment", vorlauf, "--text", `${PRUEFLAUF_BEFUNDE_ANKER}\n\n- Fund 1 (opus, HINWEIS): aus dem Vorlauf.`);
  const nurBefunde = fachplan(dir, "[Fachlich] Nur Befunde", PRUEF_LABEL, false);
  const plan = board(dir, "issue", "create", "--title", "[Plan] Ein fertiger Weg", "--body", "## Ziel\n\nEin Weg.\n");
  board(dir, "issue", "label", "add", String(plan.id), PRUEF_LABEL);
  return { geprueft, halt, ohneSpur, vorlauf, nurBefunde, plan: String(plan.id) };
}

/** Der Fake-Zweig je Karte: drei Karten tun etwas, zwei tun nichts. */
function jeKarte(k) {
  return { [k.geprueft]: PRUEFUNG_GEPRUEFT, [k.halt]: PRUEFUNG_HALT, [k.nurBefunde]: PRUEFUNG_BEFUNDE };
}

/**
 * Der Arbeitsstand der Hauptkopie ausserhalb des `issuesDir`.
 *
 * Das Board liegt beim lokalen Tracker IM Repo, und `trackerImWorktreeUmleiten` laesst die
 * Sessions des Worktrees dorthin schreiben — die Karten sind also erwartbar in Bewegung.
 * Alles andere darf der Prueflauf nicht anfassen.
 */
function arbeitsstand(dir) {
  const res = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.split("\n").filter((z) => z.trim() !== "" && !z.includes("issues/")).sort();
}

test("[night-909] ein Prueflauf ohne --max prueft alle gekennzeichneten Karten und laesst die Hauptkopie in Ruhe", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const k = karten(dir);
    const fassungen = Object.fromEntries(
      Object.values(k).map((id) => [id, pruefLaufFassung(board(dir, "issue", "get", id).body)]),
    );
    // Ein Worktree der Nacht-Kette, der gerade nebenher laeuft: Der Prueflauf raeumt nur
    // seinen eigenen Praefix ab (Issue #908).
    const fremd = join(tmpdir(), `kette-${basename(dir)}-0001-fremd`);
    mkdirSync(fremd, { recursive: true });
    const vorher = arbeitsstand(dir);

    const env = pruefUmgebung(dir, { jeKarte: jeKarte(k) });
    const res = run(dir, ["--pruefen"], env);
    try {
      assert.equal(res.status, 0, `der Prueflauf haette durchlaufen muessen:\n${res.stdout}\n${res.stderr}`);

      // --- Die Karten am Board ---
      for (const id of [k.geprueft, k.halt, k.ohneSpur, k.vorlauf, k.nurBefunde]) {
        assert.ok(!board(dir, "issue", "get", id).labels.includes(PRUEF_LABEL),
          `#${id}: das Kennzeichen muss mit dem Start verbraucht sein`);
      }
      assert.ok(board(dir, "issue", "get", k.plan).labels.includes(PRUEF_LABEL),
        "die uebersprungene Karte behaelt ihr Kennzeichen");

      const fertig = board(dir, "issue", "get", k.geprueft);
      assert.ok(fertig.labels.includes(REVIEW_FERTIG_LABEL), "die gepruefte Karte traegt review:fertig");
      assert.ok(fertig.body.split("\n").includes(FACHPLAN_MARKER),
        "der Fachplan-Review-Marker steht als eigene Zeile im Kopf");

      assert.ok(board(dir, "issue", "get", k.halt).labels.includes(KLAEREN_LABEL),
        "die angehaltene Karte traegt kit:klaeren");

      // E16: die Karte aus dem Vorlauf hat ihr `review:fertig` verloren und keins bekommen —
      // ihre Session hat nichts hinterlassen.
      assert.ok(!board(dir, "issue", "get", k.vorlauf).labels.includes(REVIEW_FERTIG_LABEL),
        "der Lauf nimmt review:fertig vor der Session ab und die Session setzt es nicht neu");

      // --- Der Vermerk-Kommentar ---
      assert.ok(board(dir, "issue", "get", k.nurBefunde).body.includes(PRUEFLAUF_REST_ANKER),
        "eine Pruefung mit Spur, die nicht fertig wurde, bekommt den Vermerk");
      assert.ok(!board(dir, "issue", "get", k.ohneSpur).body.includes(PRUEFLAUF_REST_ANKER),
        "ohne jede neue Spur gibt es nichts zu vermerken");

      // --- Der Ergebnisstand ---
      const lauf = stand(dir);
      assert.equal(lauf.art, "pruefung");
      assert.equal(lauf.label, PRUEF_LABEL);
      assert.equal(lauf.max, null, "ohne --max kennt der Lauf keinen Zahlendeckel");
      assert.deepEqual(lauf.budget, BUDGET);
      assert.equal("budgetAusDefault" in lauf, false, "der Block setzt jedes Feld");
      assert.equal(lauf.abschluss, "regulaer");
      const einheit = (id) => lauf.einheiten.find((e) => e.id === id);
      assert.equal(einheit(k.geprueft).ausgang, "geprueft");
      assert.equal(einheit(k.geprueft).fassung, fassungen[k.geprueft], "die geprueft Fassung steht am Ergebnisstand");
      assert.equal(einheit(k.geprueft).art, "pruefung");
      assert.equal(einheit(k.halt).ausgang, "klaeren");
      assert.match(einheit(k.halt).frage, /Welche der beiden Zielgruppen/);
      assert.equal(einheit(k.ohneSpur).ausgang, "unvollstaendig");
      assert.equal(einheit(k.ohneSpur).schritt, "gestartet");
      assert.equal(einheit(k.vorlauf).ausgang, "unvollstaendig", "E16: alte Spuren sind keine neuen");
      assert.equal(einheit(k.vorlauf).schritt, "gestartet");
      assert.equal(einheit(k.nurBefunde).ausgang, "unvollstaendig");
      assert.equal(einheit(k.nurBefunde).schritt, "befunde");
      assert.equal(einheit(k.plan).ausgang, "uebersprungen");
      assert.match(einheit(k.plan).grund, /\[Plan\]/);
      assert.equal(einheit(k.geprueft).kostenUsd, 1, "eine Session je Karte zu 1 $");
      assert.equal(lauf.kostenSumme, 5, "fuenf Sessions");

      // --- Die Liste auf stdout ---
      assert.match(res.stdout, new RegExp(`#${k.geprueft} .*-> Pruefung 1/5 \\(Fassung ${fassungen[k.geprueft]}\\)`));
      assert.match(res.stdout, /Ergebnisliste des Prueflaufs:/);
      assert.match(res.stdout, new RegExp(`#${k.geprueft} .*: geprueft, Fassung ${fassungen[k.geprueft]}`));
      assert.match(res.stdout, new RegExp(`#${k.halt} .*: wartende Entscheidung, .*Frage: ${PRUEFUNG_FRAGE}`));
      assert.match(res.stdout, new RegExp(`#${k.ohneSpur} .*: unvollstaendig, .*erreichter Schritt: gestartet`));
      assert.match(res.stdout, new RegExp(`#${k.plan} .*: uebersprungen — `));
      assert.match(res.stdout, /Prueflauf beendet: 1 geprueft, 1 mit wartender Entscheidung, 3 unvollstaendig, 1 uebersprungen, 0 liegengeblieben\./);

      // --- Sessions, Worktree, Hauptkopie ---
      const gelaufen = sessions(env.logPfad);
      assert.deepEqual(gelaufen.map((s) => s.stufe), ["pruefung", "pruefung", "pruefung", "pruefung", "pruefung"]);
      const wt = new Set(gelaufen.map((s) => s.cwd));
      assert.equal(wt.size, 1, "ein Worktree je LAUF, nicht je Karte (E11)");
      assert.match(basename([...wt][0]), new RegExp(`^pruefung-${basename(dir)}-\\d{4}-\\d{2}-\\d{2}-\\d{6}$`));
      assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(`pruefung-${basename(dir)}-`)),
        "der Worktree des Prueflaufs liegt noch");
      assert.ok(readdirSync(tmpdir()).includes(basename(fremd)),
        "der Prueflauf hat den Worktree der Nacht-Kette abgeraeumt");
      assert.deepEqual(arbeitsstand(dir), vorher, "der Prueflauf hat die Hauptkopie veraendert");
    } finally {
      rmSync(fremd, { recursive: true, force: true });
    }
  });
});

test("[night-909] ist das Kostenbudget erschoepft, gelten die restlichen Karten als uebersprungen und behalten ihr Kennzeichen", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const k = karten(dir);
    // 1,50 $ je Session: Nach der ersten ist der Deckel von 2 $ noch nicht gerissen, nach
    // der zweiten schon — geprueft wird NACH jeder Session, nie mittendrin.
    const env = pruefUmgebung(dir, { jeKarte: jeKarte(k), kosten: 1.5 });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const lauf = stand(dir);
    const einheit = (id) => lauf.einheiten.find((e) => e.id === id);
    assert.equal(einheit(k.geprueft).ausgang, "geprueft", "die erste Karte lief noch");
    assert.equal(einheit(k.halt).ausgang, "klaeren", "die zweite Karte lief noch");
    for (const id of [k.ohneSpur, k.vorlauf, k.nurBefunde]) {
      assert.equal(einheit(id).ausgang, "uebersprungen");
      assert.match(einheit(id).grund, /Kostenbudget: 3\.00 \$ von 2 \$/);
      assert.ok(board(dir, "issue", "get", id).labels.includes(PRUEF_LABEL),
        `#${id}: eine wegen der Kosten uebersprungene Karte behaelt ihr Kennzeichen`);
    }
    assert.equal(sessions(env.logPfad).length, 2, "nach dem Deckel startet keine Session mehr");
    assert.match(res.stdout, /Kostenbudget: 3\.00 \$ von 2 \$/);
  }, { ...BUDGET, kostenUsd: 2 });
});

test("[night-909] der Prueflauf liefert seinen Ergebnisstand nicht ein und hinterlaesst keine Fehlzeile", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const k = karten(dir);
    const env = { ...pruefUmgebung(dir, { jeKarte: jeKarte(k) }), NIGHT_MELDEN_ERZWINGEN: "1" };
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /Einlieferung fehlgeschlagen/,
      "die Art 'pruefung' kennt kit/board.mjs nicht — sie darf nicht gemeldet werden (E15)");
    assert.doesNotMatch(res.stdout, /Nachtlauf eingeliefert/);
    assert.equal(stand(dir).abschluss, "regulaer");
  });
});

// --- Aufruf (Akzeptanzkriterien 4 bis 7) ---

test("[night-909] --help nennt --pruefen", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--pruefen\s+Prueflauf/);
});

test("[night-909] --kette --pruefen wird abgewiesen und nennt den Grund", () => {
  mitPruefProjekt((dir) => {
    const res = run(dir, ["--kette", "--pruefen"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--kette und --pruefen sind zwei Laeufe/);
  });
});

test("[night-909] --pruefen --dry-run wird abgewiesen und verweist auf /issue-review --dry-run", () => {
  mitPruefProjekt((dir) => {
    const res = run(dir, ["--pruefen", "--dry-run"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\/issue-review --dry-run/);
  });
});

test("[night-909] --pruefen --label wird abgewiesen: das Kennzeichen steht in der Config", () => {
  mitPruefProjekt((dir) => {
    const res = run(dir, ["--pruefen", "--label", "kit:x"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /pruefLauf\.label/);
  });
});

test("[night-909] ein kaputtes Budget bricht vor dem Ergebnisstand mit dem Feldnamen ab", () => {
  mitPruefProjekt((dir) => {
    const res = run(dir, ["--pruefen"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /pruefLauf\.pruefungMin muss eine Zahl groesser 0 sein/);
    assert.deepEqual(readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("night-run-")), []);
  }, { ...BUDGET, pruefungMin: 0 });
});
