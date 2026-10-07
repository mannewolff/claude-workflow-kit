// Der Nachtbericht nennt Ziel und Projektgrenze (Plan #1243, E6; Issue #1251).
//
// `- Ziel:` steht unmittelbar nach `- Variante:` und nur mit gesetztem Ziel; `- Pakete`
// bleibt die vorletzte, die Sitzungsumfang-Zeile die letzte Zeile des Blocks (Issue #980).
// Blieb die Kette an der Projektgrenze vor ihrem Ziel stehen, steht unter `### Ausgang`
// zusaetzlich `an der Projektgrenze stehen geblieben, nicht am Ziel <z>` — ohne fuenften
// Ausgang. Reine Funktion am Teil bericht, im selben Prozess.
//
// Die Vorbereitung der Veroeffentlichung schreibt einen eigenen Bericht `— Vorbereitung`
// (Issue #1254); der Bericht der Kette bleibt davon unberuehrt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BERICHT_ANKER, berichtBauen, vorbereitungsBericht } from "../kit/night/bericht.mjs";

const WARTET = "wartet: Übergang paketeAbdeckung im Projekt nicht freigegeben — weiter mit kit:night";

function stufenBlock(text) {
  return text.split("### Stufen\n\n")[1].split("\n\n")[0].split("\n");
}

function ausgangBlock(text) {
  return text.split("### Ausgang\n\n")[1].split("\n\n")[0].split("\n");
}

function bericht(felder = {}) {
  const einheit = {
    id: "7", ausgang: "fertig", variante: "A",
    stufen: { plan: { id: "12" }, pakete: { ids: ["13"], korrekturrunden: 0 } },
    ...felder,
  };
  const pakete = [{ id: "13", title: "P13", body: "## Kontext\n\nPlan: Issue #12\nSitzungsumfang: passt — klein.\n\n## Aufgabe\n\nx\n" }];
  return berichtBauen(einheit, { plan: { id: "12", title: "[Plan] X", body: "" }, pakete, stempel: "s" });
}

test("E5: - Ziel: steht unmittelbar nach - Variante:, - Pakete vorletzte, Sitzungsumfang letzte Zeile", () => {
  const zeilen = stufenBlock(bericht({ ziel: "pakete" }));
  const variante = zeilen.indexOf("- Variante: A");
  assert.ok(variante >= 0, zeilen.join("\n"));
  assert.equal(zeilen[variante + 1], "- Ziel: pakete");
  assert.match(zeilen.at(-2), /^- Pakete \(1, /);
  assert.equal(zeilen.at(-1), "- Voraussichtlich über der Sitzungszeitgrenze: keine");
});

test("ohne Ziel keine Zeile - Ziel: und der Block wie heute", () => {
  const ohne = bericht();
  assert.doesNotMatch(ohne, /- Ziel:/);
  assert.doesNotMatch(ohne, /Projektgrenze/);
  const zeilen = stufenBlock(ohne);
  assert.equal(zeilen[zeilen.indexOf("- Variante: A") + 1], "- Plan #12 ([Plan] X): Dauer 0.0 min, Kosten der letzten Session unbekannt, Korrekturrunden 0, Pruefer keiner, Marker fehlt.");
});

test("E6: an der Projektgrenze vor dem Ziel steht die Zeile unter ### Ausgang, der Wartetext bleibt", () => {
  const text = bericht({ ausgang: "unvollstaendig", grund: WARTET, ziel: "umsetzung", projektgrenze: true });
  assert.deepEqual(ausgangBlock(text), [
    `unvollstaendig — ${WARTET}`,
    "an der Projektgrenze stehen geblieben, nicht am Ziel umsetzung",
  ]);
});

test("E6: ohne Ziel bleibt der Ausgang beim Wartetext allein", () => {
  const text = bericht({ ausgang: "unvollstaendig", grund: WARTET, projektgrenze: true });
  assert.deepEqual(ausgangBlock(text), [`unvollstaendig — ${WARTET}`]);
});

test("E6: am Ziel steht keine Grenzzeile", () => {
  const text = bericht({ ziel: "pakete" });
  assert.deepEqual(ausgangBlock(text), ["fertig"]);
});

// --- Der eigene Nachtbericht der Vorbereitung (Plan #1243, E12, E17; Issue #1254) ---

const KARTE = { id: "7", title: "[Fachlich] Ein Anliegen" };
const GRUEN = {
  ergebnis: "gruen", commit: "c0ffee1234567890", basis: "ba5e000000000000", origin: "0r1g1n0000000000", version: "3.8.0",
  releaseDateien: true, offen: [], pakete: ["13", "14"], rot: null, fetch: "ok", zeitpunkt: "2026-10-06T03:00:00.000Z",
  laufId: "2026-10-06T02:00:00.000Z", kitStand: null, abweichung: null, karten: ["7"],
};
const vb = (felder) => vorbereitungsBericht(KARTE, { ...GRUEN, ...felder }, { stempel: "s" });

test("E12: der Bericht der Vorbereitung beginnt mit BERICHT_ANKER und der Kennung — Vorbereitung", () => {
  for (const ergebnis of ["gruen", "gruen-offen", "rot", "nicht-vorbereitet"]) {
    const text = vb({ ergebnis });
    assert.ok(text.startsWith(`${BERICHT_ANKER} s — Vorbereitung\n`), text);
  }
});

test("E12: gruen nennt Ergebnis, geprueften Stand, Version, Pakete und keine offene Pruefung", () => {
  const text = vb({});
  assert.match(text, /### Ergebnis\n\ngrün\n/);
  assert.match(text, /- Commit: c0ffee1234567890 \(Basis ba5e000000000000, origin\/main-Stand 0r1g1n0000000000\)/);
  assert.match(text, /- Versionsvermerk und Änderungsnotiz: bereit \(v3\.8\.0\)/);
  assert.match(text, /### Pakete im Stand\n\n#13, #14\n/);
  assert.match(text, /### Offene Prüfungen\n\n- keine\n/);
  assert.doesNotMatch(text, /### Rote Prüfung/);
  assert.match(text, /Gepusht wurde nichts/);
});

test("E17: gruen-offen nennt jeden offenen Punkt unveraendert, den Build-Dienst-Punkt zuerst", () => {
  const offen = ["voller Lauf im Build-Dienst (Prüfzweig kit-pruefung/x)", "Sichtprüfung der Oberfläche"];
  const text = vb({ ergebnis: "gruen-offen", offen });
  assert.match(text, /### Ergebnis\n\ngrün, Prüfung offen\n/);
  assert.ok(text.includes(`### Offene Prüfungen\n\n- ${offen[0]}\n- ${offen[1]}\n`), text);
});

test("E12: rot nennt die rote Pruefung und ihre Verursacher", () => {
  const text = vb({ ergebnis: "rot", rot: { pruefung: "npm test", karten: ["14"], hinweis: null } });
  assert.match(text, /### Ergebnis\n\nrot\n/);
  assert.match(text, /### Rote Prüfung\n\n- Prüfung: npm test\n- Verursacher: #14\n/);
});

test("E12: rot mit Hinweis statt Zuordnung nennt den Hinweis", () => {
  const text = vb({ ergebnis: "rot", rot: { pruefung: null, karten: ["13", "14"], hinweis: "keine abgeschlossene Zusammenfassung im Worktree" } });
  assert.match(text, /- Prüfung: unbekannt\n- Verursacher: #13, #14\n- Hinweis: keine abgeschlossene Zusammenfassung im Worktree\n/);
});

test("E12: nicht-vorbereitet nennt den Grund und keinen Stand", () => {
  const text = vorbereitungsBericht(KARTE, { ergebnis: "nicht-vorbereitet", grund: "es baut noch — Frist 120 min abgelaufen", karten: ["7"] }, { stempel: "s" });
  assert.match(text, /### Ergebnis\n\nnicht vorbereitet — es baut noch — Frist 120 min abgelaufen\n/);
  assert.doesNotMatch(text, /### Geprüfter Stand|### Pakete im Stand/);
});

test("E12: ohne Release-Dateien steht das ausdruecklich da", () => {
  assert.match(vb({ releaseDateien: false, version: null }), /- Versionsvermerk und Änderungsnotiz: nicht erzeugt/);
});

test("E12: der Bericht der Kette bleibt ohne Abschnitt der Vorbereitung, auch mit Ziel push-vorbereitet", () => {
  const text = bericht({ ziel: "push-vorbereitet", variante: "B" });
  assert.doesNotMatch(text, /Vorbereitung/);
});
