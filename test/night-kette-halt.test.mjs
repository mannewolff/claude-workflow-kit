// Der Halt der Nacht-Kette und die Karten, die sie ueberspringt (Plan #638, A2, A8, E4; Issue #643).
//
// Eine Stopp-Frage im Plan oder kit:klaeren nach dem Review beenden die Kette mit
// `angehalten`: die Frage als Kommentar `## Kette angehalten` am Fachplan, kit:klaeren
// dort, der Plan bleibt im Backlog. Eine gekennzeichnete Karte mit kit:klaeren oder
// ausserhalb von Backlog laeuft nicht und behaelt ihr Label.
//
// Seit Issue #1233 laufen die Ketten im selben Prozess (`ketteImProzess`, Plan #1199, E6);
// keiner dieser Faelle braucht den Einstieg, darum gibt es zu dieser Datei keine Ablauf-Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_FERTIG_LABEL } from "../kit/night/kette.mjs";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, planBody, reviewHalt, reviewMarker, KETTE_LABEL,
} from "./helpers/kette-fixture.mjs";

/** Die Kommentare einer Karte nach dem Lauf, als ein Text. */
const kommentare = (r, id) => r.karte(id).comments.map((c) => c.body).join("\n");

test("[night-19] eine Stopp-Frage im Plan haelt die Kette an: Kommentar und kit:klaeren am Fachplan, Plan bleibt", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1")],
    sitzung: jeStufe({
      plan: planAnlegen(planBody({ offeneFragen: "- Ist der neue Endpunkt eine Schnittstelle, die jemand anderes nutzt?" })),
      review: reviewMarker,
    }),
  });
  assert.equal(r.code, 0, r.ausgabe);

  const fach = r.karte("1");
  assert.ok(fach.labels.includes("kit:klaeren"), "kit:klaeren fehlt am Fachplan");
  assert.ok(!fach.labels.includes("kit:night"), "das Label ist verbraucht");
  const text = kommentare(r, "1");
  assert.match(text, /## Kette angehalten/);
  assert.match(text, /Ist der neue Endpunkt eine Schnittstelle/);
  assert.match(text, /Stufe plan, Dokument #2\b/);
  // Der Weg nach vorn fuehrt ueber den Plan, nicht ueber den Fachplan (Issue #896);
  // der Wortlaut selbst steht in night-kette-halt-planauftrag.test.mjs auf der Probe.
  assert.match(text, /kit:klaeren an Plan #2 abnehmen/);
  assert.match(text, /das Label kit:night an Plan #2 setzen/);

  const plan = r.karte("2");
  assert.equal(plan.status, "backlog", "der Plan bleibt als Entwurf stehen");
  assert.doesNotMatch(plan.body, /Plan-Review:/, "die Review-Stufe darf nicht mehr laufen");

  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "angehalten");
  assert.match(einheit.grund, /Stopp-Frage im Plan #2\b/);
  assert.equal("review" in einheit.stufen, false);
  assert.match(r.ausgabe, /1 angehalten/);
});

test("[night-19] kit:klaeren nach dem Review haelt die Kette an, die Frage ist der letzte Kommentar am Plan", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: jeStufe({ plan: planAnlegen(), review: reviewHalt }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(r.karte("1").labels.includes("kit:klaeren"));
  const text = kommentare(r, "1");
  assert.match(text, /## Kette angehalten/);
  assert.match(text, /Stufe review, Dokument #2\b/);
  assert.match(text, /ist das eine Schnittstelle nach aussen\?/, "die Frage aus dem Review fehlt im Halt-Kommentar");
  const einheit = r.lauf.einheiten.find((e) => e.id === "1");
  assert.equal(einheit.ausgang, "angehalten");
  assert.match(einheit.grund, /Stopp-Frage aus dem Review von #2\b/);
});

test("[night-19] ein Fachplan mit kit:klaeren und einer in Ready werden uebersprungen, ihr Label bleibt", async () => {
  const offen = fachplanKarte("1", { titel: "[Fachlich] Mit offener Frage", labels: [KETTE_LABEL, REVIEW_FERTIG_LABEL, "kit:klaeren"] });
  const falsch = fachplanKarte("2", { titel: "[Fachlich] In der falschen Spalte", status: "ready" });
  const fremd = {
    id: "3", title: "[Plan] Kein Fachplan", status: "backlog", labels: [KETTE_LABEL],
    body: "## Ziel\n\nx\n\n## Betroffene Bereiche\n\n- y\n\n## Architektonische Entscheidungen\n\n- Keine.\n\n## Geplante Änderungen\n\n- z\n\n## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- w\n",
  };
  const r = await ketteImProzess({ karten: [offen, falsch, fremd], sitzung: jeStufe({ plan: planAnlegen() }) });
  assert.equal(r.code, 0, r.ausgabe);

  for (const id of ["1", "2", "3"]) {
    assert.ok(r.karte(id).labels.includes("kit:night"), `#${id} muss sein Label behalten`);
  }
  const grund = (id) => r.lauf.einheiten.find((e) => e.id === id).grund;
  assert.equal(r.lauf.einheiten.find((e) => e.id === "1").ausgang, "uebersprungen");
  assert.match(grund("1"), /traegt kit:klaeren/);
  assert.match(grund("2"), /steht in ready, nicht in Backlog/);
  // Der Plan traegt keine Herkunftszeile: Seit Issue #895 lehnt ihn `planAusschluss`
  // als Plan-Auftrag ab, nicht mehr die Praefix-Probe des Fachplan-Auftrags.
  assert.match(grund("3"), /die fachliche Herkunft ist nicht erkennbar/);
  assert.match(r.ausgabe, /Keine Kette zu fahren/);
  assert.equal(r.karten.filter((i) => /^\[Plan\] Ein Weg/.test(i.title)).length, 0, "keine Session darf gelaufen sein");
  assert.deepEqual(r.sitzungen, [], "keine Session darf gelaufen sein");
});
