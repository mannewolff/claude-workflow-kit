// Der Prueflauf beansprucht seine Wurzel und setzt einen Laufstand (Plan #1113, Baustein D,
// E8; Issue #1189).
//
// Bis hierher setzte der Prueflauf keinen Laufstand: Eine Kette sah einen laufenden
// Prueflauf nicht, und zwei Prueflaeufe sahen einander nicht. Jetzt beansprucht er nach der
// Auswahl wie die Kette und vermerkt am Ende jeder Karte ihren Ausgang. Geprueft am echten
// kit/night.mjs gegen ein Wegwerf-Repo mit lokalem Tracker (Fixture der Kette).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import {
  pruefLaufStand, pruefLaufFassung, beanspruchtGrund, kommentareVon, waehleKettenKandidaten,
  REVIEW_FERTIG_LABEL,
} from "../kit/night.mjs";
import {
  NIGHT, run, board, mitProjekt, fachplan, sessions, stand, pruefUmgebung,
  PRUEFUNG_GEPRUEFT, PRUEFUNG_HALT, PRUEFUNG_BEFUNDE,
} from "./helpers/kette-fixture.mjs";

const PRUEF_LABEL = "kit:pruefen";
const BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };

function mitPruefProjekt(fn, budget = BUDGET) {
  mitProjekt(fn, {}, "night-pruefen-laufstand-", { pruefLauf: budget });
}

/** Der juengste Laufstand-Kommentar einer Karte, leer ohne ihn. */
const laufstandVon = (dir, id) => kommentareVon(board(dir, "issue", "get", id)).findLast((k) => k.startsWith("## Laufstand")) ?? "";
const laufLabels = (dir, id) => board(dir, "issue", "get", id).labels.filter((l) => l.startsWith("lauf:"));

/** Schreibt einen Laufstand `laeuft`, den dieser Testprozess haelt — er lebt, solange der Test laeuft. */
function lebenderHalter(dir, id) {
  const halter = `${hostname().split(".")[0]}/${process.pid}/2026-10-05-000000`;
  const datei = join(dir, "helfer", `halter-${id}.md`);
  mkdirSync(join(dir, "helfer"), { recursive: true });
  writeFileSync(datei, `Lauf angenommen\n\nLauf-ID: ${halter}\nStand: ${new Date().toISOString()}\n`, "utf-8");
  board(dir, "issue", "stand", id, "--zustand", "laeuft", "--text-file", datei);
  rmSync(datei);
  return halter;
}

// --- Die Zuordnung der Ausgaenge (E8) ---

test("[night-1189] geprueft wird fertig, klaeren wartet, unvollstaendig und uebersprungen brechen mit Grund ab", () => {
  assert.equal(pruefLaufStand({ ausgang: "geprueft" }).zustand, "fertig");
  const klaeren = pruefLaufStand({ ausgang: "klaeren", frage: "Welche Zielgruppe gilt?\nmehr" });
  assert.equal(klaeren.zustand, "wartet");
  assert.match(klaeren.text, /Welche Zielgruppe gilt\?/);
  const rest = pruefLaufStand({ ausgang: "unvollstaendig", schritt: "befunde", grund: "Zeitbudget erschoepft" });
  assert.equal(rest.zustand, "abgebrochen");
  assert.match(rest.text, /Zeitbudget erschoepft/);
  assert.match(rest.text, /befunde/);
  const deckel = pruefLaufStand({ ausgang: "uebersprungen", grund: "Kostenbudget: 3.00 $ von 2 $ nach Pruefung 2" });
  assert.equal(deckel.zustand, "abgebrochen");
  assert.match(deckel.text, /Kostenbudget: 3\.00 \$ von 2 \$/);
});

test("[night-1189] der eigene Laufstand aendert die Fassung einer Karte nicht", () => {
  const body = "## Ziel\n\nEin Ziel.\n";
  const mitStand = `${body}\n\n---\n**Kommentar** (2026-10-05T10:00:00Z)\n\n## Laufstand\n\nLauf angenommen\n\nLauf-ID: a/1/x\n`;
  assert.equal(pruefLaufFassung(mitStand), pruefLaufFassung(body));
  const mitBefund = `${body}\n\n---\n**Kommentar** (2026-10-05T10:00:00Z)\n\n## Fachplan-Review, Runde 1\n\n- Fund\n`;
  assert.notEqual(pruefLaufFassung(mitBefund), pruefLaufFassung(body), "andere Kommentare bleiben Teil der Fassung");
});

// --- Der Laufstand am Board, je Ausgang ---

test("[night-1189] die Ausgaenge einer Session setzen den Laufstand der Karte", () => {
  mitPruefProjekt((dir) => {
    const geprueft = fachplan(dir, "[Fachlich] Vollstaendig geprueft", PRUEF_LABEL, false);
    const halt = fachplan(dir, "[Fachlich] Mit wartender Entscheidung", PRUEF_LABEL, false);
    const rest = fachplan(dir, "[Fachlich] Nur Befunde", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir, { jeKarte: { [geprueft]: PRUEFUNG_GEPRUEFT, [halt]: PRUEFUNG_HALT, [rest]: PRUEFUNG_BEFUNDE } });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(laufLabels(dir, geprueft), [], "fertig traegt kein Laufstand-Label");
    assert.match(laufstandVon(dir, geprueft), /geprueft/);
    assert.deepEqual(laufLabels(dir, halt), ["lauf:wartet"]);
    assert.match(laufstandVon(dir, halt), /Welche der beiden Zielgruppen/);
    assert.deepEqual(laufLabels(dir, rest), ["lauf:abgebrochen"]);
    assert.match(laufstandVon(dir, rest), /unvollstaendig/);
    assert.match(laufstandVon(dir, rest), /Fachplan-Review-Marker/, "der Grund steht im Laufstand");
    for (const id of [geprueft, halt, rest]) {
      assert.match(laufstandVon(dir, id), /^Lauf-ID: /m, `#${id}: der Laufstand nennt den Runner`);
    }
  });
});

test("[night-1189] am Kostendeckel uebersprungene Karten brechen mit Grund ab", () => {
  mitPruefProjekt((dir) => {
    const erste = fachplan(dir, "[Fachlich] Erste", PRUEF_LABEL, false);
    const zweite = fachplan(dir, "[Fachlich] Zweite", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir, { jeKarte: { [erste]: PRUEFUNG_GEPRUEFT }, kosten: 3 });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(sessions(env.logPfad).length, 1);
    assert.deepEqual(laufLabels(dir, zweite), ["lauf:abgebrochen"]);
    assert.match(laufstandVon(dir, zweite), /Kostenbudget: 3\.00 \$ von 2 \$/);
    assert.ok(board(dir, "issue", "get", zweite).labels.includes(PRUEF_LABEL), "das Kennzeichen bleibt");
  }, { ...BUDGET, kostenUsd: 2 });
});

// --- Gegenseitiger Ausschluss (Kriterium 2 aus #1014) ---

test("[night-1189] ein Prueflauf laesst eine Wurzel aus, die ein laufender Runner haelt, und schreibt nichts an sie", () => {
  mitPruefProjekt((dir) => {
    const belegt = fachplan(dir, "[Fachlich] Belegt", PRUEF_LABEL, false);
    const frei = fachplan(dir, "[Fachlich] Frei", PRUEF_LABEL, false);
    // Der Halter kann eine Kette oder ein zweiter Prueflauf sein — der Laufstand nennt die
    // Laufart nicht, und beide schreiben ihn auf demselben Weg.
    const halter = lebenderHalter(dir, belegt);
    const env = pruefUmgebung(dir, { jeKarte: { [frei]: PRUEFUNG_GEPRUEFT } });
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(res.stdout.includes(beanspruchtGrund(halter)), res.stdout);
    assert.equal(sessions(env.logPfad).length, 1, "nur die freie Karte wird geprueft");
    assert.equal(stand(dir).einheiten.find((e) => e.id === frei).ausgang, "geprueft");
    const karte = board(dir, "issue", "get", belegt);
    assert.ok(karte.labels.includes(PRUEF_LABEL), "das Kennzeichen der belegten Karte bleibt");
    assert.deepEqual(laufLabels(dir, belegt), ["lauf:laeuft"]);
    assert.match(laufstandVon(dir, belegt), new RegExp(halter), "der Laufstand des Halters bleibt stehen");
    assert.equal(stand(dir).einheiten.find((e) => e.id === belegt).ausgang, "uebersprungen");
  });
});

/**
 * Die Fake-Zeile einer Pruefung, die waehrend ihrer Session fragt, was eine Kette jetzt
 * saehe: Sie liest ihre Karte und laesst die Kettenauswahl darueber laufen — mit der Belegung,
 * wie `wurzelBelegt` sie aus dem Laufstand am Board liest. Das Ergebnis geht in eine Datei.
 */
const KETTE_SIEHT = String.raw`node .claude/kit/board.mjs issue get "$NIGHT_ISSUE_ID" > "$KETTE_LOG.karte.json"; node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
const night = await import(process.env.KETTE_NIGHT);
const karte = JSON.parse(readFileSync(process.env.KETTE_LOG + ".karte.json", "utf-8"));
const text = night.kommentareVon(karte).filter((k) => k.startsWith("## Laufstand")).at(-1) ?? "";
const zustand = karte.labels.includes("lauf:laeuft") ? "laeuft" : null;
const belegt = (F) => night.wurzelBelegt(F, [karte], { [String(karte.id)]: { zustand, text } }, new Date(), hostname().split(".")[0]);
const kette = { ...karte, labels: [...karte.labels, "kit:night", night.REVIEW_FERTIG_LABEL] };
const r = night.waehleKettenKandidaten([kette], "kit:night", 5, { belegt });
writeFileSync(process.env.KETTE_LOG + ".kette.json", JSON.stringify({ kandidaten: r.kandidaten.length, uebersprungen: r.uebersprungen }));
'`;

test("[night-1189] waehrend ein Prueflauf eine Karte prueft, laesst eine Kette ihre Wurzel aus", () => {
  mitPruefProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] In Pruefung", PRUEF_LABEL, false);
    const env = { ...pruefUmgebung(dir, { jeKarte: { [F]: `${KETTE_SIEHT}; ${PRUEFUNG_GEPRUEFT}` } }), KETTE_NIGHT: NIGHT };
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const gesehen = JSON.parse(readFileSync(`${env.logPfad}.kette.json`, "utf-8"));
    assert.equal(gesehen.kandidaten, 0, "die Kette darf die Wurzel nicht waehlen, solange der Prueflauf laeuft");
    assert.equal(gesehen.uebersprungen.length, 1);
    assert.match(gesehen.uebersprungen[0].grund, /^bereits von einem laufenden Runner beansprucht \(.+\/\d+\/.+\)$/);
    // Nach dem Lauf ist die Wurzel wieder frei.
    const danach = { ...board(dir, "issue", "get", F) };
    danach.labels = [...danach.labels, "kit:night", REVIEW_FERTIG_LABEL];
    assert.equal(waehleKettenKandidaten([danach], "kit:night", 5).kandidaten.length, 1);
    assert.deepEqual(laufLabels(dir, F), []);
  });
});

test("[night-1189] ohne gekennzeichnete Karte setzt der Prueflauf keinen Laufstand", () => {
  mitPruefProjekt((dir) => {
    const ohne = fachplan(dir, "[Fachlich] Ohne Kennzeichen", "kit:anderes", false);
    const res = run(dir, ["--pruefen"], pruefUmgebung(dir, { jeKarte: {} }));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(laufstandVon(dir, ohne), "");
  });
});

