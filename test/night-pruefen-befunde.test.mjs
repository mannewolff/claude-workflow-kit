// Der Rueckweg der Befunde im Prueflauf am Tag (Issue #1028).
//
// Der Prueflauf baut seinen Worktree ab wie die Kette. Bisher tat er das, ohne die dort
// gebuchten Funde zurueckzuholen — sie gingen mit dem Worktree verloren. Jetzt holt er sie
// vor dem Abbau in die Hauptkopie und schlaegt je Art an der Schwelle vor, nach dem Muster
// der Kette (night-69, night-70).
//
// Gemessen am ECHTEN kit/night.mjs ueber das Ketten-Fixture mit dem lokalen Tracker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NUR_POSIX, run, mitProjekt, fachplan, pruefUmgebung, PRUEFUNG_BEFUNDE } from "./helpers/kette-fixture.mjs";

const PRUEF_LABEL = "kit:pruefen";
const BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };

function zeile(art) {
  return `2026-09-29T00:00:00.000Z\tfachlich\t1\treviewer\t${art}\tWICHTIG\t-`;
}

/** Die Buchung, die eine Pruef-Session im Worktree hinterlaesst — wie `befunde buchen` es taete. */
const BUCHUNG_IM_WORKTREE = String.raw`printf "2026-09-29T00:00:00.000Z\tfachlich\t1\treviewer\tkonvention\tWICHTIG\t-\n" >> .claude/befunde.tsv`;

function mitPruefProjekt(fn) {
  mitProjekt(fn, {}, "night-pruefen-befunde-", { pruefLauf: BUDGET });
}

function protokoll(dir) {
  const pfad = join(dir, ".claude", "befunde.tsv");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").split("\n").filter(Boolean) : [];
}

function ideenTitel(dir) {
  const issues = join(dir, "issues");
  if (!existsSync(issues)) return [];
  return readdirSync(issues)
    .filter((n) => n.endsWith(".md"))
    .map((n) => (readFileSync(join(issues, n), "utf-8").match(/^title:(.*)$/m) || [null, ""])[1].trim())
    .filter((t) => t.startsWith("[Idee]"));
}

test("[night-1028] die im Worktree des Prueflaufs gebuchten Befunde landen in der Hauptkopie", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const id = fachplan(dir, "[Fachlich] Mit Befunden", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir, { jeKarte: { [id]: `${PRUEFUNG_BEFUNDE}; ${BUCHUNG_IM_WORKTREE}` } });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.deepEqual(protokoll(dir), [zeile("konvention")], "die Zeile aus dem Worktree steht in der Hauptkopie");
    assert.equal(ideenTitel(dir).length, 0, "unter der Schwelle entsteht keine Idee");
  });
});

test("[night-1028] erreicht eine Art die Schwelle, schlaegt der Prueflauf in der Hauptkopie vor", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [zeile("konvention"), zeile("konvention")].map((z) => `${z}\n`).join(""), "utf-8");
    const id = fachplan(dir, "[Fachlich] Mit Befunden", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir, { jeKarte: { [id]: `${PRUEFUNG_BEFUNDE}; ${BUCHUNG_IM_WORKTREE}` } });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(protokoll(dir).length, 3);
    assert.match(res.stdout, /Befunde aus dem Worktree zurueckgeholt — Schwelle erreicht: konvention/);
    assert.match(res.stdout, /Vorschlag fuer 'konvention' angelegt/);
    assert.deepEqual(ideenTitel(dir), ["[Idee] Maschinelle Pruefung fuer Mangel-Art konvention?"]);
  });
});
