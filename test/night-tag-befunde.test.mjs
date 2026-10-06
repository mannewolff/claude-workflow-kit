// Der Rueckweg der Befunde im Prueflauf am Tag (Issue #1028, #1234).
//
// Der Prueflauf baut seinen Worktree ab wie die Kette und holt vorher die dort gebuchten Funde
// in die Hauptkopie; je Art an der Schwelle ruft er `befunde.mjs vorschlag`. Gefahren im selben
// Prozess (Plan #1199, E6): Der Aufruf des Vorschlags geht an eine Attrappe; was
// `befunde.mjs vorschlag` selbst am Board anlegt, belegen dessen eigene Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { jeKarte, pruefKarte, pruefLaufImProzess, pruefungBefunde } from "./helpers/tag-fixture.mjs";
import { psLeer } from "./helpers/session-attrappe.mjs";

function zeile(art) {
  return `2026-09-29T00:00:00.000Z\tfachlich\t1\treviewer\t${art}\tWICHTIG\t-`;
}

/** Die Buchung, die eine Pruef-Session im Worktree hinterlaesst — wie `befunde buchen` es taete. */
function bucheImWorktree(s) {
  pruefungBefunde(s);
  mkdirSync(join(s.cwd, ".claude"), { recursive: true });
  writeFileSync(join(s.cwd, ".claude", "befunde.tsv"), `${zeile("konvention")}\n`, "utf-8");
}

/** Das `spawnSync` des Teils kitstand: merkt sich `befunde.mjs vorschlag` und antwortet wie das Werkzeug. */
function vorschlagAttrappe() {
  const vorschlaege = [];
  const spawnSync = (befehl, argumente, optionen) => {
    if (argumente?.[1] !== "vorschlag") return psLeer(befehl, argumente, optionen);
    const art = argumente[3];
    vorschlaege.push({ art, cwd: realpathSync(optionen.cwd), protokoll: protokoll(optionen.cwd) });
    return { status: 0, stdout: JSON.stringify({ ok: true, angelegt: true, karte: "9", titel: `[Idee] Maschinelle Pruefung fuer Mangel-Art ${art}?` }), stderr: "" };
  };
  return { spawnSync, vorschlaege };
}

function protokoll(dir) {
  const pfad = join(dir, ".claude", "befunde.tsv");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").split("\n").filter(Boolean) : [];
}

test("[night-1028] die im Worktree des Prueflaufs gebuchten Befunde landen in der Hauptkopie", async () => {
  const { spawnSync, vorschlaege } = vorschlagAttrappe();
  const r = await pruefLaufImProzess({
    karten: [pruefKarte(1, { titel: "[Fachlich] Mit Befunden" })],
    sitzung: jeKarte({ 1: bucheImWorktree }),
    spawnSync,
    nachher: ({ dir }) => protokoll(dir),
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(r.nachher, [zeile("konvention")], "die Zeile aus dem Worktree steht in der Hauptkopie");
  assert.deepEqual(vorschlaege, [], "unter der Schwelle entsteht kein Vorschlag");
  assert.doesNotMatch(r.ausgabe, /Schwelle erreicht/);
});

test("[night-1028] erreicht eine Art die Schwelle, schlaegt der Prueflauf in der Hauptkopie vor", async () => {
  const { spawnSync, vorschlaege } = vorschlagAttrappe();
  let hauptkopie = null;
  const r = await pruefLaufImProzess({
    karten: [pruefKarte(1, { titel: "[Fachlich] Mit Befunden" })],
    sitzung: jeKarte({ 1: bucheImWorktree }),
    spawnSync,
    vorher: ({ dir }) => {
      hauptkopie = realpathSync(dir);
      writeFileSync(join(dir, ".claude", "befunde.tsv"), [zeile("konvention"), zeile("konvention")].map((z) => `${z}\n`).join(""), "utf-8");
    },
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.match(r.ausgabe, /Befunde aus dem Worktree zurueckgeholt — Schwelle erreicht: konvention/);
  assert.match(r.ausgabe, /Vorschlag fuer 'konvention' angelegt/);
  assert.equal(vorschlaege.length, 1);
  assert.equal(vorschlaege[0].art, "konvention");
  assert.equal(vorschlaege[0].cwd, hauptkopie, "vorgeschlagen wird in der Hauptkopie, nicht im Worktree");
  assert.equal(vorschlaege[0].protokoll.length, 3, "die Zeile aus dem Worktree steht vor dem Vorschlag in der Hauptkopie");
});
