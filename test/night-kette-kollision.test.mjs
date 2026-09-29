// Die beiden Kollisionen zwischen den Auftragsarten der Nacht-Kette (Fachplan #883,
// Plan #890; Issue #895).
//
// Ein Mensch kann beides kennzeichnen — die fachliche Anforderung und einen aus ihr
// entstandenen Plan —, und er kann zwei Plaene derselben Wurzel kennzeichnen. Beide
// Faelle loest die Auswahl auf, bevor `--max` greift: Eine weichende Karte verbraucht
// keinen Platz.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  waehleKettenKandidaten, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL,
} from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, planauftrag, umgebung, sessions, stand,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

const STUFEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

/** Die Nummern der Auftragskarten, die `waehleKettenKandidaten` fahren wuerde. */
const laufen = (r) => r.kandidaten.map((a) => String(a.karte.id));

test("[night-895] ist zu einer gekennzeichneten Anforderung ein Plan gekennzeichnet, laeuft der Plan", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel");
    const M = planauftrag(dir, F);
    const env = umgebung(dir, { stufen: STUFEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"],
      "es lief eine zweite Kette an der Anforderung");
    const lauf = stand(dir);
    assert.equal(lauf.einheiten.find((e) => e.id === M).ausgang, "fertig");
    const weicht = lauf.einheiten.find((e) => e.id === F);
    assert.equal(weicht.ausgang, "uebersprungen");
    assert.match(weicht.grund, new RegExp(`#${M}`), "der Grund nennt die Karte, die stattdessen laeuft");
    assert.ok(board(dir, "issue", "get", F).labels.includes("kit:night"), "die Anforderung muss ihr Label behalten");
  });
});

test("[night-895] die Anforderung weicht dem gekennzeichneten Plan auch dann, wenn der Plan selbst uebersprungen wird", () => {
  const anforderung = { id: "1", title: "[Fachlich] Die Wurzel", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL] };
  // Ohne review:fertig: Der Plan laeuft selbst nicht — das Kennzeichen des Menschen
  // steht trotzdem an ihm, und die Anforderung soll nicht ersatzweise neu geplant werden.
  const plan = {
    id: "2", title: "[Plan] Ein Weg", status: "backlog", labels: ["kit:night"],
    body: "Fachliche Quelle: Issue #1\n\n## Offene Fragen\n\n- Keine.\n",
  };
  const r = waehleKettenKandidaten([anforderung, plan], "kit:night", 5);
  assert.deepEqual(laufen(r), [], "keine der beiden Karten laeuft");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["1", "2"], "beide gehen mit Grund nach uebersprungen");
  assert.match(r.uebersprungen[0].grund, /#2/);
  assert.ok(r.uebersprungen[1].grund.startsWith(UNGEPRUEFT_PRAEFIX), r.uebersprungen[1].grund);
});

test("[night-895] von zwei gekennzeichneten Plaenen derselben Wurzel laeuft der mit der hoeheren Nummer", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel", null);
    const alt = planauftrag(dir, F, { titel: "[Plan] Der aeltere Weg" });
    const neu = planauftrag(dir, F, { titel: "[Plan] Der neuere Weg" });
    const env = umgebung(dir, { stufen: STUFEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe), ["pakete", "abdeckung"], "es lief mehr als eine Kette");
    const lauf = stand(dir);
    assert.equal(lauf.einheiten.find((e) => e.id === neu).ausgang, "fertig");
    const weicht = lauf.einheiten.find((e) => e.id === alt);
    assert.equal(weicht.ausgang, "uebersprungen");
    assert.match(weicht.grund, new RegExp(`#${neu}`), "der Grund nennt den Plan, der stattdessen laeuft");
    assert.ok(board(dir, "issue", "get", alt).labels.includes("kit:night"), "der aeltere Plan muss sein Label behalten");
  });
});

test("[night-895] eine weichende Karte verbraucht keinen Platz unter --max", () => {
  const geprueft = ["kit:night", REVIEW_FERTIG_LABEL];
  const karten = [
    { id: "1", title: "[Fachlich] Erste Wurzel", status: "backlog", labels: geprueft },
    { id: "2", title: "[Plan] Zu #1", status: "backlog", labels: geprueft, body: "Fachliche Quelle: Issue #1\n\n## Offene Fragen\n\n- Keine.\n" },
    { id: "3", title: "[Fachlich] Zweite Wurzel", status: "backlog", labels: geprueft },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 2);
  assert.deepEqual(laufen(r), ["2", "3"], "die weichende #1 haette sonst einen der zwei Plaetze belegt");
  assert.deepEqual(r.liegengeblieben, []);
});

test("[night-895] ein Fachplan-Auftrag und ein Plan-Auftrag zu einer anderen Wurzel laufen in derselben Nacht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F1 = fachplan(dir, "[Fachlich] Erste Wurzel");
    const F2 = fachplan(dir, "[Fachlich] Zweite Wurzel", null);
    const M = planauftrag(dir, F2);
    const env = umgebung(dir, { stufen: STUFEN });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(sessions(env.logPfad).map((s) => s.stufe),
      ["plan", "review", "pakete", "abdeckung", "pakete", "abdeckung"],
      "der Fachplan-Auftrag faehrt alle vier Stufen, der Plan-Auftrag nur die beiden hinteren");
    const lauf = stand(dir);
    assert.equal(lauf.einheiten.find((e) => e.id === F1).ausgang, "fertig", "der Fachplan-Auftrag lief nicht");
    assert.equal(lauf.einheiten.find((e) => e.id === F1).auftrag, "fachplan");
    assert.equal("fachplan" in lauf.einheiten.find((e) => e.id === F1), false,
      "ein Fachplan-Auftrag traegt keine zweite Herkunftsangabe");
    const planAuftrag = lauf.einheiten.find((e) => e.id === M);
    assert.equal(planAuftrag.ausgang, "fertig", planAuftrag.grund);
    assert.equal(planAuftrag.auftrag, "plan");
    assert.equal(planAuftrag.fachplan, F2);
    assert.match(res.stdout, /Nacht-Kette beendet: 2 fertig/);
  });
});
