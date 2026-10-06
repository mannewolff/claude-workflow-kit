// Ablauf-Pruefung: Belegfall 5 braucht zwei Laeufe des Einstiegs kit/night.mjs nebeneinander mit getrennten Lauf-Kennungen, Tagesprotokoll und Schrittprotokollen auf der Platte, und der Prueflauf --pruefen hat keinen Lauf im selben Prozess.
//
// Protokoll je Schritt, Vorab-Stand und Halt-Stand (Issue #1090, Plan #1079 E1, E16, E17).
//
// Belegfall 5 aus Fachplan #1075: Laufen Kette und Prueflauf gleichzeitig, standen ihre
// Zeilen verschraenkt im selben Tagesprotokoll. Jeder Schritt schreibt deshalb zusaetzlich
// eine eigene Datei `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, und jede Zeile des
// Tagesprotokolls traegt die Lauf-Kennung in der Klammer des Zeitstempels.
//
// Belegfall 1: Ein Lauf, der in der Vorabpruefung stirbt, blieb spurlos. Die Kette setzt
// darum vor dem Vorflug jede Kandidatenkarte auf `laeuft`.
//
// Was die Kette allein entscheidet — Vorab-Stand, Vorflug-Abbruch, Dry-Run, Halt-Stand —,
// steht seit Issue #1233 im selben Prozess in `night-kette-protokoll-schritt.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  NIGHT, run, board, mitProjekt, setupProjekt, fachplan, umgebung,
  jePaket, fachplanBody, FACHPLAN_MARKER, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, PRUEFUNG_GEPRUEFT,
} from "./helpers/kette-ablauf.mjs";

const PRUEF_LABEL = "kit:pruefen";
const PRUEF_BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };

const kartenText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

/** Alle Zeilen aller Journale des Fixtures, als Objekte. */
function journal(dir) {
  const ordner = join(dir, ".claude", "lauf");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner).filter((n) => n.endsWith(".jsonl"))
    .flatMap((n) => readFileSync(join(ordner, n), "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z)));
}

// Ohne Warten auf den naechsten Sekundenwechsel: Startet der Prueflauf in derselben Sekunde
// wie die Kette, bildet er seinen Stempel selbst neu (`laufStempelReservieren`, Issue #1190).

test("[protokoll-schritt] Belegfall 5: Kette und Prueflauf gleichzeitig schreiben getrennte Schrittprotokolle", () => {
  const dir = setupProjekt({}, "night-protokoll-", { pruefLauf: PRUEF_BUDGET });
  try {
    const F = fachplan(dir);
    const G = fachplan(dir, "[Fachlich] Zu pruefen", PRUEF_LABEL, false);
    const pruefAusgabe = join(dir, "helfer", "pruefung-ausgabe.txt");
    const pruefStatus = join(dir, "helfer", "pruefung-status.txt");
    const env = {
      ...umgebung(dir, {
        stufen: {
          // Die Plan-Session der Kette startet den Prueflauf selbst und wartet sein Ende ab,
          // bevor sie den Plan anlegt: So liegt die ganze Pruefung mitten in diesem einen
          // Schritt der Kette, ohne dass ein Lauf den anderen abfragt (Issue #1197, #1233).
          // Der Prueflauf schreibt in eine eigene Datei — im Output der Plan-Session stuende
          // er sonst im Schrittprotokoll der Kette. KIT_STAND ist geleert: Der Prueflauf ist
          // ein eigener Lauf, kein Kind aus dem Stand der Kette.
          plan: `(cd "$PRUEF_DIR" && KIT_STAND= KIT_STAND_PFAD= node "$PRUEF_NIGHT" --pruefen) > "$PRUEF_AUSGABE" 2>&1; echo $? > "$PRUEF_STATUS"; ${PLAN_ANLEGEN}`,
          review: REVIEW_MARKER,
          pakete: PAKETE_ANLEGEN,
          pruefung: jePaket({ [G]: PRUEFUNG_GEPRUEFT }),
        },
      }),
      PRUEFUNG_BODY: fachplanBody({ marker: FACHPLAN_MARKER }),
      PRUEF_DIR: dir,
      PRUEF_NIGHT: NIGHT,
      PRUEF_AUSGABE: pruefAusgabe,
      PRUEF_STATUS: pruefStatus,
      KIT_NIGHT_WAECHTER: "0",
    };
    const k = run(dir, ["--kette"], env);
    assert.equal(k.status, 0, `${k.stdout}\n${k.stderr}`);
    assert.ok(existsSync(pruefStatus), "die Plan-Session hat den Prueflauf nicht gestartet");
    assert.equal(readFileSync(pruefStatus, "utf-8").trim(), "0", readFileSync(pruefAusgabe, "utf-8"));

    const ordner = join(dir, ".claude", "protokolle");
    const laeufe = readdirSync(ordner).sort();
    assert.equal(laeufe.length, 2, `je Lauf ein Ordner: ${laeufe}`);
    const ketteLauf = laeufe.find((l) => existsSync(join(ordner, l, `${F}-plan.log`)));
    const pruefLauf = laeufe.find((l) => l !== ketteLauf);
    assert.ok(ketteLauf, `kein Planprotokoll der Kette: ${laeufe.map((l) => readdirSync(join(ordner, l)))}`);
    assert.deepEqual(readdirSync(join(ordner, pruefLauf)), [`${G}-pruefung.log`]);
    for (const s of ["plan", "review", "pakete", "abdeckung"]) {
      assert.ok(existsSync(join(ordner, ketteLauf, `${F}-${s}.log`)), `Schrittprotokoll ${s} fehlt`);
    }

    const planLog = readFileSync(join(ordner, ketteLauf, `${F}-plan.log`), "utf-8");
    const pruefLog = readFileSync(join(ordner, pruefLauf, `${G}-pruefung.log`), "utf-8");
    assert.match(planLog, /--- Session-Output Issue #/, "der Session-Output gehoert ins Schrittprotokoll");
    assert.match(pruefLog, /--- Session-Output Issue #/);
    assert.ok(!planLog.includes(`#${G}`), `fremde Zeilen im Planprotokoll:\n${planLog}`);
    assert.ok(!planLog.includes(pruefLauf), "keine Zeile des Prueflaufs im Planprotokoll");
    assert.ok(!pruefLog.includes(ketteLauf), "keine Zeile der Kette im Pruefprotokoll");
    for (const zeile of planLog.split("\n").filter((z) => z.startsWith("[20"))) {
      assert.match(zeile, new RegExp(`^\\[\\S+Z ${ketteLauf}\\] `));
    }

    // Der Laufstand nennt den Pfad des zuletzt gelaufenen Schritts.
    assert.ok(kartenText(dir, F).includes(`Protokoll: .claude/protokolle/${ketteLauf}/${F}-abdeckung.log`), kartenText(dir, F));

    // Das Tagesprotokoll traegt beide Laeufe, jede Zeile mit ihrer Kennung.
    const tag = readdirSync(join(dir, ".claude")).find((n) => /^night-run-.*\.log$/.test(n));
    const zeilen = readFileSync(join(dir, ".claude", tag), "utf-8").split("\n").filter((z) => z.startsWith("[20"));
    const kennungen = new Set(zeilen.map((z) => z.match(/^\[\S+Z (\S+)\] /)?.[1]));
    assert.ok(!kennungen.has(undefined), "eine Zeile ohne Kennung");
    assert.deepEqual([...kennungen].sort(), [ketteLauf, pruefLauf].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Seit Issue #1189 (Plan #1113, E8) beansprucht der Prueflauf seine Karte wie die Kette und
// schliesst ihren Laufstand nach dem Ausgang ab — vorher setzte er keinen.
test("[protokoll-schritt] der Prueflauf beansprucht seine Karte und schliesst den Laufstand ab", () => {
  mitProjekt((dir) => {
    const G = fachplan(dir, "[Fachlich] Zu pruefen", PRUEF_LABEL, false);
    const env = {
      ...umgebung(dir, { stufen: { pruefung: jePaket({ [G]: PRUEFUNG_GEPRUEFT }) } }),
      PRUEFUNG_BODY: fachplanBody({ marker: FACHPLAN_MARKER }),
    };
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(!board(dir, "issue", "get", G).labels.some((l) => l.startsWith("lauf:")), "fertig traegt kein Laufstand-Label");
    assert.ok(kartenText(dir, G).includes("## Laufstand"));
    assert.deepEqual(journal(dir).filter((z) => z.art === "stand").map((z) => z.zustand), ["laeuft", "fertig"]);
  }, {}, "night-protokoll-", { pruefLauf: PRUEF_BUDGET });
});
