// Stufe umsetzung der Nacht-Kette unter Variante B (Plan #691, E4-E8, E14, E16-E18;
// Issue #695).
//
// Die fuenfte Stufe baut die Arbeitspakete des gekennzeichneten Fachplans selbst: Sie
// baut zuvor den Worktree ab und arbeitet in der Hauptkopie, zieht jedes Paket einzeln
// unmittelbar vor seiner Session nach Ready und wertet mit `laufeRunde` unveraendert.
//
// Erste von zwei Dateien zur Stufe (Issue #836): Hier stehen Ablauf, Worktree und die
// Auswahl der Pakete. Die Rueckstellpflicht und die Budgets liegen in
// `night-kette-umsetzung-rueckstellung.test.mjs`, die gemeinsamen Hilfen in
// `helpers/kette-umsetzung-fixture.mjs`.
//
// Wie in den uebrigen Ketten-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo
// mit lokalem Tracker; die Sessions sind Shell-Fakes ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { KETTE_HALT_ANKER, KLAEREN_LABEL } from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, umgebung, sessions, stand,
  PAKETE_MIT_ABHAENGIGKEIT, UMSETZUNG_ERFOLG, UMSETZUNG_HALT, jePaket,
} from "./helpers/kette-fixture.mjs";
import {
  ERZEUGEN, fachplanB, umsetzung, inSpalte, keinRestInArbeit, stehenInBacklog,
} from "./helpers/kette-umsetzung-fixture.mjs";


test("[night-34] Variante B: die Stufe umsetzung laeuft hinter abdeckung und bringt die Pakete nach In review", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe),
      ["plan", "review", "pakete", "abdeckung", "umsetzung", "umsetzung"],
      "die Stufenfolge unter Variante B");

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
    assert.deepEqual(stufe.umgesetzt.map((e) => e.id), einheit.stufen.pakete.ids, "beide Pakete gelten als umgesetzt");
    assert.deepEqual(stufe.angehalten, []);
    assert.deepEqual(stufe.nichtBegonnen, []);
    assert.deepEqual(stufe.zurueckgestellt, []);

    assert.deepEqual(inSpalte(dir, "in_review"), einheit.stufen.pakete.ids, "die Pakete stehen in In review");
    keinRestInArbeit(dir);

    // Je Paket eine eigene Einheit — die, die `laufeRunde` ohnehin anlegt (night-4).
    for (const id of einheit.stufen.pakete.ids) {
      const e = stand(dir).einheiten.find((x) => x.id === id);
      assert.ok(e, `keine Einheit fuer Paket #${id}`);
      assert.equal(e.ausgang, "erfolg", `Paket #${id}: ${e.grund}`);
      assert.ok(e.commit, `Paket #${id} traegt keinen Commit`);
    }
  });
});

test("[night-34] die Stufe umsetzung baut den Worktree vor dem ersten Paket ab und arbeitet in der Hauptkopie", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const hauptkopie = realpathSync(dir);
    const gelaufen = sessions(env.logPfad);
    for (const s of gelaufen.filter((x) => x.stufe !== "umsetzung")) {
      assert.notEqual(s.cwd, hauptkopie, `die Stufe ${s.stufe} lief in der Hauptkopie statt im Worktree`);
      assert.equal(existsSync(s.cwd), false, `der Worktree der Stufe ${s.stufe} liegt noch: ${s.cwd}`);
    }
    for (const s of gelaufen.filter((x) => x.stufe === "umsetzung")) {
      assert.equal(s.cwd, hauptkopie, "eine Umsetzungs-Session lief ausserhalb der Hauptkopie");
    }
    assert.match(res.stdout, /Worktree abgebaut/);

    // Die Commits der Nacht liegen in der Hauptkopie — genau das, wofuer Variante B da ist.
    const log = spawnSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf-8" });
    assert.equal((log.stdout.match(/\(Fake\)/g) || []).length, 2, `die Commits fehlen: ${log.stdout}`);
    const worktrees = spawnSync("git", ["worktree", "list"], { cwd: dir, encoding: "utf-8" });
    assert.equal(worktrees.stdout.trim().split("\n").length, 1, `es blieb ein Worktree stehen: ${worktrees.stdout}`);
  });
});

test("[night-34] eine unsaubere Hauptkopie vor dem ersten Paket: kein Paket wird gezogen, die Kette bricht ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    // Die Abdeckungs-Session laesst einen Rest in der Hauptkopie liegen — sie laeuft im
    // Worktree, der Rest entsteht dort also ueber den ausdruecklichen Pfad dorthin.
    const schmutz = `echo rest > ${JSON.stringify(dir)}/rest.md`;
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, abdeckung: schmutz, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "abgebrochen");
    assert.match(einheit.grund, /nicht sauber/);
    assert.match(einheit.grund, /rest\.md/);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), einheit.stufen.pakete.ids);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0, "es lief eine Umsetzungs-Session");
    stehenInBacklog(dir, einheit.stufen.pakete.ids);
    keinRestInArbeit(dir);
  });
});

test("[night-34] ein nicht selbst gezogenes Paket bleibt unangetastet in Ready", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    // Eine Karte, die der Mensch selbst nach Ready gezogen hat — sie gehoert zu keinem
    // Plan dieser Kette und darf von der Rueckstellpflicht nicht angefasst werden.
    const fremd = String(board(dir, "issue", "create", "--title", "Von Hand gezogen", "--body", "## Abhängigkeiten\n\nKeine.\n").id);
    board(dir, "issue", "move", fremd, "ready");

    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const karte = board(dir, "issue", "get", fremd);
    assert.equal(karte.status, "ready", "die fremde Karte wurde aus Ready geschoben");
    assert.doesNotMatch(karte.body || "", /Nacht-Kette/, "die fremde Karte bekam einen Kommentar der Kette");
    assert.deepEqual(inSpalte(dir, "in_progress"), []);
  });
});

test("[night-34] ein Paket mit unerfuellter Abhaengigkeit wird nicht gezogen und gilt als nicht begonnen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    // Das erste Paket haelt an einer Stopp-Frage an und bleibt damit in Backlog; das
    // zweite haengt von ihm ab und faellt ueber pruefeIssueGates heraus (E6), das dritte
    // ist unabhaengig und laeuft weiter.
    const stufen = {
      ...ERZEUGEN,
      pakete: PAKETE_MIT_ABHAENGIGKEIT,
      umsetzung: jePaket({ "0003": UMSETZUNG_HALT }, UMSETZUNG_ERFOLG),
    };
    const res = run(dir, ["--kette"], umgebung(dir, { stufen }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.deepEqual(einheit.stufen.pakete.ids, ["0003", "0004", "0005"]);
    assert.deepEqual(stufe.angehalten, ["0003"]);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), ["0004"]);
    // Die Nummer steht so im Grund, wie `parseDeps` sie liest — als Zahl, ohne die
    // fuehrenden Nullen des lokalen Trackers.
    assert.match(stufe.nichtBegonnen[0].grund, /Abhaengigkeit #3 nicht erfuellt/);
    assert.deepEqual(stufe.umgesetzt.map((e) => e.id), ["0005"], "das unabhaengige Paket lief nach dem Halt weiter");

    // Das ausgelassene Paket wurde nie bewegt: kein Zug nach Ready, kein Kommentar.
    const ausgelassen = board(dir, "issue", "get", "0004");
    assert.equal(ausgelassen.status, "backlog");
    assert.doesNotMatch(ausgelassen.body || "", /Nachtlauf|Nacht-Kette/, "das ausgelassene Paket bekam einen Kommentar");
    keinRestInArbeit(dir);
  });
});

test("[night-34] ein angehaltenes Paket laesst die Kette angehalten enden, ohne den Fachplan zu zeichnen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const stufen = { ...ERZEUGEN, umsetzung: jePaket({ "0003": UMSETZUNG_HALT }, UMSETZUNG_ERFOLG) };
    const res = run(dir, ["--kette"], umgebung(dir, { stufen }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    assert.equal(einheit.ausgang, "angehalten", einheit.grund);
    assert.deepEqual(stufe.angehalten, ["0003"]);
    assert.deepEqual(stufe.umgesetzt.map((e) => e.id), ["0004"], "das zweite Paket lief nach dem Halt weiter");

    // Das kit:klaeren traegt das Paket; ein zweites am Fachplan schloesse ihn aus der
    // naechsten Kette aus (E17).
    const fach = board(dir, "issue", "get", F);
    assert.equal((fach.labels || []).includes(KLAEREN_LABEL), false, "der Fachplan wurde gezeichnet");
    assert.ok((board(dir, "issue", "get", "0003").labels || []).includes(KLAEREN_LABEL), "das Paket traegt kit:klaeren nicht");
    assert.doesNotMatch(fach.body || "", new RegExp(KETTE_HALT_ANKER), "der Fachplan traegt den Abschnitt 'Kette angehalten'");
    keinRestInArbeit(dir);
  });
});
