// Eine Pruefstufe pro Lauf im Nacht-Runner (Issue #283, fachliche Quelle #272).
//
// Die drei Stufen muessen unbeaufsichtigt laufen — eine Stufe, die nur interaktiv
// funktioniert, teilt den Prozess in zwei Klassen und faellt nachts still aus.
// Genau EINE Stufe pro Aufruf: Zwischen den Stufen bleibt die menschliche
// Entscheidung stehen (PO, 2026-08-08).
//
// Die reinen Funktionen werden direkt importiert; die Flag-Validierung ueber den
// echten Prozess, weil sie VOR jedem Board-Zugriff greifen muss und genau das
// sonst nicht pruefbar waere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectReviewCandidates, hasStageMarker } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const ISSUES = [
  { id: "1", title: "[Fachlich] Eine Anforderung", body: "", labels: ["kit:nightreview"] },
  { id: "2", title: "[Plan] Ein Plandokument", body: "", labels: ["kit:nightreview"] },
  { id: "3", title: "Ein Arbeitspaket", body: "", labels: ["kit:nightreview"] },
  { id: "4", title: "[Idee] Eine rohe Idee", body: "", labels: ["kit:nightreview"] },
];
const ids = (liste) => liste.map((x) => String(x.id)).sort();

test("--stufe fachlich nimmt genau die [Fachlich]-Issues", () => {
  const { kandidaten } = selectReviewCandidates(ISSUES, { stufe: "fachlich" });
  assert.deepEqual(ids(kandidaten), ["1"]);
});

test("--stufe plan nimmt genau die [Plan]-Issues", () => {
  const { kandidaten } = selectReviewCandidates(ISSUES, { stufe: "plan" });
  assert.deepEqual(ids(kandidaten), ["2"]);
});

test("ohne --stufe bleibt das Verhalten identisch zu heute", () => {
  const ohne = selectReviewCandidates(ISSUES);
  const mitIssue = selectReviewCandidates(ISSUES, { stufe: "issue" });
  assert.deepEqual(ids(ohne.kandidaten), ["3"], "nur das Arbeitspaket");
  assert.deepEqual(ids(ohne.kandidaten), ids(mitIssue.kandidaten), "Default muss 'issue' sein");
});

test("[Idee] wird in allen drei Stufen uebersprungen", () => {
  for (const stufe of ["fachlich", "plan", "issue"]) {
    const { kandidaten } = selectReviewCandidates(ISSUES, { stufe });
    assert.ok(!ids(kandidaten).includes("4"), `[Idee] steht in Stufe ${stufe} in den Kandidaten`);
  }
});

// Die Stufe waehlt INNERHALB der per Label freigegebenen Menge aus. Wuerde sie den
// Filter umgehen, liefe der Runner an der Freigabe des Menschen vorbei (Issue #191).
test("die Stufenauswahl umgeht den Label-Filter nicht", () => {
  const gemischt = [
    { id: "10", title: "[Fachlich] Mit Label", body: "", labels: ["kit:nightreview"] },
    { id: "11", title: "[Fachlich] Ohne Label", body: "", labels: [] },
    { id: "12", title: "[Fachlich] Fremdes Label", body: "", labels: ["anderes"] },
  ];
  const { kandidaten, uebersprungen } = selectReviewCandidates(gemischt, {
    stufe: "fachlich",
    label: "kit:nightreview",
  });
  assert.deepEqual(ids(kandidaten), ["10"]);
  assert.equal(uebersprungen.length, 2);
  for (const u of uebersprungen) assert.match(u.grund, /kein Label/);
});

// --- Marker je Stufe ------------------------------------------------------

const MARKER = { fachlich: "Fachplan-Review:", plan: "Plan-Review:", issue: "Issue-Review:" };

for (const stufe of ["fachlich", "plan", "issue"]) {
  test(`Stufe ${stufe}: nur der eigene Marker zaehlt`, () => {
    const eigener = `## Kontext\n${MARKER[stufe]} opus (2026-08-08)\n`;
    assert.equal(hasStageMarker(eigener, stufe), true, "der eigene Marker muss zaehlen");

    for (const fremd of Object.keys(MARKER).filter((s) => s !== stufe)) {
      const body = `## Kontext\n${MARKER[fremd]} opus (2026-08-08)\n`;
      assert.equal(
        hasStageMarker(body, stufe),
        false,
        `der Marker der Stufe ${fremd} darf in Stufe ${stufe} nicht zaehlen`
      );
    }
  });
}

test("hasStageMarker: leerer Body und unbekannte Stufe sind falsch", () => {
  assert.equal(hasStageMarker("", "issue"), false);
  assert.equal(hasStageMarker(null, "issue"), false);
  assert.equal(hasStageMarker("Issue-Review: opus (2026-08-08)", "quatsch"), false);
});

// hasReviewMarker ist NICHT exportiert und bleibt es: Es dient allein dem
// Implementierungs-Gate. Der Test sichert ueber den Quelltext ab, dass es keinen
// Stufenparameter bekommen hat — genau der naheliegende, aber falsche Weg.
test("hasReviewMarker ist unveraendert und ohne Stufenparameter", () => {
  const quelle = readFileSync(NIGHT, "utf-8");
  assert.match(quelle, /function hasReviewMarker\(body\)\s*\{/,
    "hasReviewMarker hat eine andere Signatur bekommen");
  // Kein Aufruf mit zweitem Argument — der Stufenparameter waere genau der
  // naheliegende, aber falsche Weg (er wuerde das Ready-Gate mitveraendern).
  assert.doesNotMatch(quelle, /hasReviewMarker\([^)]*,/,
    "hasReviewMarker wird mit einem zweiten Argument aufgerufen");
  // Seit Issue #304 fragt das Implementierungs-Gate nicht mehr direkt, sondern ueber
  // reviewFreigabe — der Marker bleibt aber dessen ERSTE Frage. Faellt er dort heraus,
  // haengt das Gate nur noch an der Pruefvorgabe.
  assert.match(quelle, /function reviewFreigabe\(body\)\s*\{\s*\n\s*if \(hasReviewMarker\(body\)\)/,
    "reviewFreigabe prueft den Marker nicht mehr zuerst");
  assert.ok(quelle.split("\n").some((z) => /requiredBeforeReady/.test(z) && /reviewFreigabe/.test(z))
    || /requiredBeforeReady[\s\S]{0,200}reviewFreigabe\(/.test(quelle),
    "das Implementierungs-Gate nutzt reviewFreigabe nicht mehr");
});

// --- Flag-Validierung ueber den echten Prozess ----------------------------

function nightFail(args) {
  try {
    execFileSync(process.execPath, [NIGHT, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, out: "" };
  } catch (e) {
    return { status: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

test("unbekannte Stufe endet vor jedem Board-Zugriff mit Exit ungleich 0", () => {
  const res = nightFail(["--review", "--stufe", "quatsch", "--dry-run"]);
  assert.notEqual(res.status, 0);
  assert.match(res.out, /Unbekannte Stufe 'quatsch'/);
  assert.match(res.out, /fachlich \| plan \| issue/, "die erlaubten Werte fehlen in der Meldung");
});

test("--stufe ohne Wert endet mit Exit ungleich 0", () => {
  const res = nightFail(["--review", "--stufe", "--dry-run"]);
  assert.notEqual(res.status, 0);
  assert.match(res.out, /--stufe braucht einen Wert/);
});

test("--stufe ohne --review endet mit Exit ungleich 0", () => {
  const res = nightFail(["--stufe", "issue", "--dry-run"]);
  assert.notEqual(res.status, 0);
  assert.match(res.out, /nur im Review-Modus/);
});

test("--help und Kopf-Kommentar nennen --stufe samt Default und Bindung", () => {
  const help = execFileSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.match(help, /--stufe/, "--stufe fehlt in der Hilfe");
  assert.match(help, /fachlich \| plan \| issue/, "die Werte fehlen");
  assert.match(help, /Default issue/, "der Default fehlt");
  assert.match(help, /--review/, "die Bindung an den Review-Modus fehlt");

  const kopf = readFileSync(NIGHT, "utf-8").split("*/")[0];
  assert.match(kopf, /--stufe/, "der Kopf-Kommentar nennt --stufe nicht");
  assert.match(kopf, /Default issue/, "der Kopf-Kommentar nennt den Default nicht");
});

test("die Stufenliste ist mit board.mjs synchron gehalten", () => {
  const quelle = readFileSync(NIGHT, "utf-8");
  assert.match(quelle, /SYNC:.*REVIEW_STUFEN/,
    "der SYNC-Kommentar fehlt — beide Listen laufen sonst auseinander");
});
