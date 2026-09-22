// Ruecklaeuferquote (Issue #788, Plan #782, E5, E6, E7, E9, E13, E14, E15).
//
// Die Paarung (E5): Der Kandidatenfilter kommt aus `.claude/bewegungen.tsv`, die
// Wahrheit ueber den Ruecklauf aus dem Aktivitaetsverlauf der Karten — geholt ueber
// genau EINEN Kindprozess `board.mjs issue activity --ids` (E13). Das Fake-Board im
// Fixture ist ein echter Kindprozess und zaehlt seine Aufrufe selbst.
//
// Zaehlweise (Fund 8): Der Nenner zaehlt Karten, der Zaehler Bewegungen — die Quote
// kann ueber 100 % liegen und wird nicht gekappt.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitProjekt, zeile, auswerten, wirksamkeit, bewegung, moved, boardAufrufe, bericht, hatStand, stand,
} from "./helpers/wirksamkeit-fixture.mjs";

const CONFIG = { issueTracker: "toolbox", buildChecks: ["node --test"] };

test("[wirksamkeit-5] zwei Eintritte und zwei Ruecklaeufe derselben Karte: einmal im Nenner, Quote 200 % ungekappt", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: {
      verlaeufe: {
        12: [moved(6, "In review"), moved(5, "Backlog"), moved(4, "In review"), moved(3, "In progress")],
      },
    },
  }, (dir) => {
    const r = auswerten(dir).ruecklauf;
    assert.equal(r.status, "berechnet");
    assert.equal(r.nenner, 1, "die Karte steht mit zwei Eintritten nur einmal im Nenner");
    assert.equal(r.zaehler, 2, "beide Ruecklaufbewegungen zaehlen");
    assert.equal(r.quote, 2, "die Quote wird nicht gekappt");
    assert.match(bericht(dir), /200\s?%/);
  });
});

test("[wirksamkeit-5] Abgang nach Done ist kein Ruecklaeufer, ein nicht zuordenbares Ziel ist einer", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" }), bewegung({ tage: 5, id: "13" })],
    board: {
      verlaeufe: {
        12: [moved(6, "In review"), moved(5, "Done")],
        13: [moved(6, "In review"), moved(5, "Irgendwo")],
      },
    },
  }, (dir) => {
    const r = auswerten(dir).ruecklauf;
    assert.equal(r.nenner, 2);
    assert.equal(r.zaehler, 1, "nur das nicht zuordenbare Ziel ist ein Ruecklaeufer");
    assert.equal(r.nichtZuordenbareBewegungen, 1);
  });
});

test("[wirksamkeit-5] die Anzeigenamen 'In Review' und 'Anstehend' werden ohne Ruecksicht auf Gross-/Kleinschreibung zugeordnet", () => {
  // Der Verlauf traegt den Anzeigenamen des Boards, nicht den Statusschluessel (E6) —
  // und der weicht hier fuer Backlog ab ("Anstehend") und schreibt Review gross.
  mitProjekt({
    config: {
      ...CONFIG,
      columns: { backlog: "Anstehend", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" },
    },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { verlaeufe: { 12: [moved(6, "In Review"), moved(5, "Anstehend")] } },
  }, (dir) => {
    const r = auswerten(dir).ruecklauf;
    assert.equal(r.nenner, 1, "'In Review' mit grossem R wurde nicht als Eintritt erkannt");
    assert.equal(r.zaehler, 1, "'Anstehend' wurde nicht als Ruecklauf-Ziel erkannt");
    assert.equal(r.nichtZuordenbareBewegungen, 0, "die beiden Anzeigenamen gelten als zugeordnet");
  });
});

test("[wirksamkeit-5] ohne zuordenbaren Eintritt ist die Quote nicht berechenbar — nicht null — und die nicht zuordenbaren Bewegungen stehen im Bericht", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { verlaeufe: { 12: [moved(6, "Nirgendwo"), moved(5, "Ready")] } },
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.ruecklauf.status, "nichtBerechenbar");
    assert.equal(e.ruecklauf.quote, null, "nicht berechenbar heisst null im JSON, nicht 0");
    assert.equal(e.ruecklauf.nichtZuordenbareBewegungen, 1);
    assert.match(bericht(dir), /nicht berechenbar/);
    assert.match(bericht(dir), /1 Bewegung(en)? .*nicht zuordenbar|nicht zuordenbar.*: 1/i);
  });
});

test("[wirksamkeit-5] der Deckel wertet die juengsten Kandidaten und nennt die weggefallenen im Bericht", () => {
  mitProjekt({
    config: { ...CONFIG, wirksamkeit: { kandidatenMax: 2 } },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [
      bewegung({ tage: 6, id: "10" }),
      bewegung({ tage: 4, id: "11" }),
      bewegung({ tage: 2, id: "12" }),
    ],
    board: {
      verlaeufe: {
        11: [moved(5, "In review")],
        12: [moved(3, "In review")],
      },
    },
  }, (dir) => {
    const r = auswerten(dir).ruecklauf;
    assert.equal(r.kandidaten.imFenster, 3);
    assert.equal(r.kandidaten.gewertet, 2);
    assert.equal(r.kandidaten.weggefallen, 1);
    const aufruf = boardAufrufe(dir)[0];
    assert.ok(aufruf.includes("11") && aufruf.includes("12") && !aufruf.includes("10"),
      `die juengsten zwei Karten werden angefragt, nicht die aelteste: ${aufruf}`);
    assert.match(bericht(dir), /1 Karte.*(weggefallen|fielen? weg)/i, "der Wegfall steht nicht im Bericht");
  });
});

test("[wirksamkeit-5] n Kandidaten kosten genau einen Board-Kindprozess", () => {
  const ids = ["10", "11", "12", "13", "14"];
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: ids.map((id) => bewegung({ tage: 3, id })),
    board: { verlaeufe: Object.fromEntries(ids.map((id) => [id, [moved(3, "In review")]])) },
  }, (dir) => {
    auswerten(dir);
    const aufrufe = boardAufrufe(dir);
    assert.equal(aufrufe.length, 1, `fuenf Kandidaten kosten genau einen Kindprozess, nicht ${aufrufe.length}`);
    assert.match(aufrufe[0], /^issue activity --ids /);
    for (const id of ids) assert.ok(aufrufe[0].includes(id), `Karte ${id} fehlt im Sammelaufruf`);
  });
});

test("[wirksamkeit-5] Befund ab zwanzig Prozent bei mindestens zehn Karten; die Config sticht beide Vorgaben", () => {
  const verlaeufeFuer = (n, ruecklaeufe) => Object.fromEntries(
    Array.from({ length: n }, (_, i) => {
      const id = String(20 + i);
      const eintraege = [moved(5, "In review")];
      if (i < ruecklaeufe) eintraege.push(moved(4, "Backlog"));
      return [id, eintraege];
    })
  );
  const bewegungenFuer = (n) => Array.from({ length: n }, (_, i) => bewegung({ tage: 5, id: String(20 + i) }));

  // 10 Karten, 2 Ruecklaeufe: genau 20 % an der Vorgabe-Schwelle -> Befund.
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: bewegungenFuer(10),
    board: { verlaeufe: verlaeufeFuer(10, 2) },
  }, (dir) => {
    const e = auswerten(dir);
    assert.ok(e.befund.some((b) => b.schwelle === "ruecklaufquote"), "20 % bei 10 Karten ist ein Befund");
  });

  // 9 Karten, 2 Ruecklaeufe: ueber der Schwelle, aber unter quoteAbPaketen -> kein Befund.
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: bewegungenFuer(9),
    board: { verlaeufe: verlaeufeFuer(9, 2) },
  }, (dir) => {
    const e = auswerten(dir);
    assert.ok(!e.befund.some((b) => b.schwelle === "ruecklaufquote"), "unter zehn Karten gibt es keinen Befund");
  });

  // Config sticht: quoteAbPaketen 3 und quoteSchwelle 0.5 aus dem Block `wirksamkeit`.
  mitProjekt({
    config: { ...CONFIG, wirksamkeit: { quoteAbPaketen: 3, quoteSchwelle: 0.5 } },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: bewegungenFuer(4),
    board: { verlaeufe: verlaeufeFuer(4, 2) },
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.schwellen.quoteAbPaketen, 3);
    assert.equal(e.schwellen.quoteSchwelle, 0.5);
    assert.ok(e.befund.some((b) => b.schwelle === "ruecklaufquote"), "50 % bei 4 Karten liegt ueber den Config-Schwellen");
  });
});

test("[wirksamkeit-5] der Bericht nennt die Restluecke der Karten ohne Kit-Bewegung", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { verlaeufe: { 12: [moved(6, "In review")] } },
  }, (dir) => {
    auswerten(dir);
    assert.match(bericht(dir), /nie bewegt hat.*nicht im Nenner|nicht im Nenner.*nie bewegt/s,
      "die Restluecke aus Fund 6 fehlt im Bericht");
  });
});

test("[wirksamkeit-5] der Erhebungsbeginn der Bewegungsdatei steht als Traglast im Bericht, wenn er im Fenster liegt", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { verlaeufe: { 12: [moved(5, "In review")] } },
  }, (dir) => {
    const r = auswerten(dir).ruecklauf;
    assert.equal(r.abgeschnitten, true, "der Erhebungsbeginn liegt nach dem Fensteranfang");
    assert.ok(r.erhebungsbeginn, "der Erhebungsbeginn der Bewegungsdatei fehlt");
    assert.match(bericht(dir), /Bewegungsprotokoll beginnt erst/);
  });
});

test("[wirksamkeit-6] beim Tracker local entfaellt die Quote mit Vermerk und ohne Kindprozess, die Pruefungs-Kennzahlen bleiben", () => {
  mitProjekt({
    config: { issueTracker: "local", buildChecks: ["node --test"] },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { verlaeufe: {} },
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.ruecklauf.status, "entfallen");
    assert.match(e.ruecklauf.grund, /local/, "der Vermerk nennt den Tracker nicht");
    assert.equal(boardAufrufe(dir).length, 0, "local darf keinen Kindprozess kosten");
    assert.equal(e.pruefungen.length, 1, "die Pruefungs-Kennzahlen fehlen");
    assert.match(bericht(dir), /entfaellt/);
  });
});

test("[wirksamkeit-6] ein scheiternder issue-activity-Aufruf ist ein Vermerk, kein Abbruch: Exit 0, beide Dateien, Kennzahlen vollstaendig", () => {
  mitProjekt({
    config: { issueTracker: "github", buildChecks: ["node --test"] },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ tage: 5, id: "12" })],
    board: { exit: 1, stderr: "activity wird von diesem Tracker nicht unterstuetzt" },
  }, (dir) => {
    const res = wirksamkeit(dir, "auswerten");
    assert.equal(res.status, 0, "ein Board-Fehlschlag darf die Auswertung nicht abbrechen");
    const e = JSON.parse(res.stdout);
    assert.equal(e.ruecklauf.status, "entfallen");
    assert.match(e.ruecklauf.grund, /nicht unterstuetzt/, "der Vermerk traegt den Grund aus dem Fehlschlag nicht");
    assert.equal(e.pruefungen.length, 1, "die Pruefungs-Kennzahlen fehlen");
    assert.ok(hatStand(dir), "wirksamkeit.json fehlt trotz Exit 0");
    assert.match(bericht(dir), /entfaellt/);
    assert.deepEqual(stand(dir), e, "stdout und wirksamkeit.json sind nicht derselbe Stand");
  });
});
