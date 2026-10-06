// Aufruf, Dry-Run und Kandidatenwahl der Nacht-Kette (Plan #638, A13, E6; Issue #643).
//
// Seit Issue #1233 laufen die Ketten unten im selben Prozess (`ketteImProzess`, Plan #1199,
// E6). Was nur der Einstieg belegt — Argumente, --help, der Config-Fehler eines kaputten
// Budgets —, steht in `ablauf-night-kette-flags.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { waehleKettenKandidaten, korrekturPrompt, REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import { ketteImProzess, fachplanKarte, jeStufe, planAnlegen, GLATT, KETTE_LABEL } from "./helpers/kette-fixture.mjs";

test("[night-19] --kette --dry-run nennt Kandidaten, Uebersprungene und Budget und legt weder Worktree noch Ergebnisstand an", async () => {
  const offen = fachplanKarte("2", { titel: "[Fachlich] Mit offener Frage", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "kit:klaeren"] });
  const r = await ketteImProzess({ karten: [fachplanKarte("1"), offen], argv: ["--dry-run"], sitzung: jeStufe({ plan: planAnlegen() }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.match(r.ausgabe, /#1 \[Fachlich\] Ein Anliegen -> Kette 1/);
  assert.match(r.ausgabe, /#2 .*-> uebersprungen \(traegt kit:klaeren/);
  assert.match(r.ausgabe, /Budget: Plan 20 min, Pakete 15 min, Review 15 min, Abdeckung 10 min, 50 \$ je Kette, 2 Korrekturrunde\(n\)/);
  assert.match(r.ausgabe, /Dry-Run beendet: 1 Kette\(n\) wuerden laufen/);
  assert.ok(r.karte("1").labels.includes(KETTE_LABEL), "der Dry-Run verbraucht kein Label");
  assert.deepEqual(r.sitzungen, [], "der Dry-Run startet keine Session");
  assert.ok(!r.gitAufrufe.some((a) => a.args[0] === "worktree" && a.args[1] === "add"), "der Dry-Run legt keinen Worktree an");
  assert.ok(!readdirSync(tmpdir()).some((n) => n.startsWith(r.worktreePraefix)), "der Dry-Run legt keinen Worktree an");
});

test("[night-19] alte Routing-Labels loesen eine Hinweiszeile aus, ohne Wirkung", async () => {
  const alt = fachplanKarte("1", { titel: "[Fachlich] Mit altem Label", labels: ["kit:nightplan", REVIEW_FERTIG_LABEL] });
  const r = await ketteImProzess({ karten: [alt], argv: ["--dry-run"] });
  assert.equal(r.code, 0, r.ausgabe);
  assert.match(r.ausgabe, /Hinweis: #1 traegt das Label 'kit:nightplan', das es seit Stufe 2 nicht mehr gibt/);
  assert.match(r.ausgabe, /WARNUNG: keine Karte traegt das Label 'kit:night'/);
  assert.match(r.ausgabe, /Keine Kette zu fahren/);
});

test("[night-19] mehrere Fachplaene laufen nacheinander in Listenreihenfolge, --max laesst den Rest liegen", async () => {
  const karten = [
    fachplanKarte("1", { titel: "[Fachlich] Erstes" }),
    fachplanKarte("2", { titel: "[Fachlich] Zweites" }),
    fachplanKarte("3", { titel: "[Fachlich] Drittes" }),
  ];
  const r = await ketteImProzess({ karten, argv: ["--max", "2"], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const einheit = (id) => r.lauf.einheiten.find((e) => e.id === id);
  assert.equal(einheit("1").ausgang, "fertig");
  assert.equal(einheit("2").ausgang, "fertig");
  assert.equal(einheit("3").ausgang, "liegengeblieben");
  assert.ok(r.karte("3").labels.includes(KETTE_LABEL), "die liegengebliebene Karte behaelt ihr Label");
  // Der Worktree heisst kette-<repo>-<F>-<datum>-<uhrzeit>; F steht vor dem Stempel.
  const reihenfolge = r.sitzungen.filter((s) => s.stufe === "plan")
    .map((s) => /-(\d+)-\d{4}-\d{2}-\d{2}-\d{6}$/.exec(basename(s.cwd))?.[1]);
  assert.deepEqual(reihenfolge, ["1", "2"], "die Ketten liefen nicht in Listenreihenfolge");
  assert.equal(einheit("2").kostenUsd, 4, "jede Kette hat ihr eigenes Budget");
  assert.match(r.ausgabe, /Kette 1\/2: Issue #1\b/);
  assert.match(r.ausgabe, /Kette 2\/2: Issue #2\b/);
});

test("[night-19] waehleKettenKandidaten: nur Karten mit Label, in Reihenfolge, mit Grund je Ausschluss", () => {
  const geprueft = ["kit:night", "review:fertig"];
  const karten = [
    { id: "1", title: "[Fachlich] A", status: "backlog", labels: geprueft },
    { id: "2", title: "[Fachlich] ohne Label", status: "backlog", labels: [] },
    { id: "3", title: "[Plan] P", status: "backlog", labels: geprueft },
    { id: "4", title: "[Fachlich] in Ready", status: "ready", labels: geprueft },
    { id: "5", title: "[Fachlich] geklaert?", status: "backlog", labels: [...geprueft, "kit:klaeren"] },
    { id: "6", title: "[Fachlich] B", status: "backlog", labels: geprueft },
    { id: "7", title: "[Fachlich] C", status: "backlog", labels: geprueft },
    { id: "8", title: "[Fachlich] ungeprueft", status: "backlog", labels: ["kit:night"] },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 2);
  // Kandidaten sind seit Issue #895 Auftragsobjekte; ein Fachplan-Auftrag traegt die
  // eigene Nummer als Wurzel und keine Plannummer.
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["1", "6"]);
  assert.deepEqual(r.kandidaten.map((a) => [a.art, a.F, a.planId]), [["fachplan", "1", null], ["fachplan", "6", null]]);
  assert.deepEqual(r.liegengeblieben.map((k) => k.id), ["7"]);
  assert.deepEqual(r.uebersprungen.map((u) => [u.id, u.grund.split(" — ")[0].split(",")[0]]), [
    // #3 ist ein [Plan] ohne Herkunftszeile: seit #895 laeuft an ihm `planAusschluss`.
    ["3", "die fachliche Herkunft ist nicht erkennbar"],
    ["4", "steht in ready"],
    ["5", "traegt kit:klaeren"],
    ["8", "ungeprueft: Label 'review:fertig' fehlt"],
  ]);
  assert.deepEqual(waehleKettenKandidaten(undefined, "kit:night", 3), { kandidaten: [], uebersprungen: [], liegengeblieben: [] });
  assert.equal(waehleKettenKandidaten([{ id: "9", status: "backlog", labels: ["kit:night"] }], "kit:night", 1).uebersprungen[0].grund,
    "weder [Fachlich] noch [Plan] — das Kennzeichen gilt an der fachlichen Anforderung oder am Plandokument",
    "eine Karte ohne Titel traegt keine der beiden Auftragsarten");
});

test("[night-19] der Korrekturprompt nennt Dokument, Verstoesse und den Weg ueber issue update", () => {
  const p = korrekturPrompt("0002", [{ gate: "P1", meldung: "Abschnitt fehlt" }, { meldung: "ohne Gate" }]);
  assert.match(p, /Das Dokument #0002 hat die Formpruefung nicht bestanden/);
  assert.match(p, /^- P1: Abschnitt fehlt$/m);
  assert.match(p, /^- ohne Gate$/m);
  assert.match(p, /issue update 0002 --body-file <pfad>/);
  assert.match(p, /Dieser Lauf ist unbeaufsichtigt/);
});
