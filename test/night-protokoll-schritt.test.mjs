// Protokoll je Schritt, Vorab-Stand und Halt-Stand (Issue #1090, Plan #1079 E1, E16, E17).
//
// Belegfall 5 aus Fachplan #1075: Laufen Kette und Prueflauf gleichzeitig, standen ihre
// Zeilen verschraenkt im selben Tagesprotokoll. Jeder Schritt schreibt deshalb zusaetzlich
// eine eigene Datei `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, und jede Zeile des
// Tagesprotokolls traegt die Lauf-Kennung in der Klammer des Zeitstempels.
//
// Belegfall 1: Ein Lauf, der in der Vorabpruefung stirbt, blieb spurlos. Die Kette setzt
// darum vor dem Vorflug jede Kandidatenkarte auf `laeuft`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { KETTE_HALT_ANKER, KLAEREN_LABEL } from "../kit/night.mjs";
import {
  NIGHT, VORFLUG_OK, VORFLUG_KAPUTT, run, board, mitProjekt, setupProjekt, fachplan, umgebung,
  sessions, stand, jePaket, fachplanBody, FACHPLAN_MARKER,
  PLAN_ANLEGEN, REVIEW_MARKER, REVIEW_HALT, PAKETE_ANLEGEN, PRUEFUNG_GEPRUEFT,
} from "./helpers/kette-fixture.mjs";

const PRUEF_LABEL = "kit:pruefen";
const PRUEF_BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };
const VORAB = /^Lauf angenommen um \d{4}-\d{2}-\d{2}T\S+Z, Vorabprüfung läuft$/;

const kartenText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");

/** Alle Zeilen aller Journale des Fixtures, als Objekte. */
function journal(dir) {
  const ordner = join(dir, ".claude", "lauf");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner).filter((n) => n.endsWith(".jsonl"))
    .flatMap((n) => readFileSync(join(ordner, n), "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z)));
}

/** Startet night.mjs nebenlaeufig; das Versprechen loest mit Exit und Ausgabe auf. */
function starte(cwd, cliArgs, env) {
  const kind = spawn(process.execPath, [NIGHT, ...cliArgs], {
    cwd, env: { ...process.env, KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, NIGHT_KILL_GRACE_MS: "200", ...env },
  });
  let out = "";
  kind.stdout.on("data", (d) => { out += d; });
  kind.stderr.on("data", (d) => { out += d; });
  return new Promise((resolve) => kind.on("close", (status) => resolve({ status, out })));
}

// Grosszuegig, weil die Abfrage sofort zurueckkehrt, sobald die Bedingung erfuellt ist: Im
// gruenen Fall kostet die Grenze nichts, unter Last riss die fruehere von 20 s (Issue #1197).
async function warteAuf(pruefung, ms = 120_000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (pruefung()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Zeitueberschreitung beim Warten");
}

test("[protokoll-schritt] Belegfall 5: Kette und Prueflauf gleichzeitig schreiben getrennte Schrittprotokolle", async () => {
  const dir = setupProjekt({}, "night-protokoll-", { pruefLauf: PRUEF_BUDGET });
  try {
    const F = fachplan(dir);
    const G = fachplan(dir, "[Fachlich] Zu pruefen", PRUEF_LABEL, false);
    const marke = join(dir, "helfer", "pruefung-fertig");
    const env = {
      ...umgebung(dir, {
        stufen: {
          // Die Plan-Session der Kette wartet, bis die Pruef-Session gelaufen ist: So liegt
          // die ganze Pruefung mitten in diesem einen Schritt der Kette. Bleibt die Marke aus,
          // endet die Stufe rot: Sonst entstuende der Plan vor der Pruefung, und der Belegfall
          // pruefte still etwas anderes (Issue #1197).
          plan: `n=0; while [ ! -f "$PRUEF_MARKE" ] && [ $n -lt 1200 ]; do sleep 0.1; n=$((n+1)); done; [ -f "$PRUEF_MARKE" ] || exit 1; ${PLAN_ANLEGEN}`,
          review: REVIEW_MARKER,
          pakete: PAKETE_ANLEGEN,
          pruefung: jePaket({ [G]: `${PRUEFUNG_GEPRUEFT}; touch "$PRUEF_MARKE"` }),
        },
      }),
      PRUEFUNG_BODY: fachplanBody({ marker: FACHPLAN_MARKER }),
      PRUEF_MARKE: marke,
      KIT_NIGHT_WAECHTER: "0",
    };
    const kette = starte(dir, ["--kette"], env);
    await warteAuf(() => sessions(env.logPfad).some((s) => s.stufe === "plan"));
    // Der Stempel hat Sekundenaufloesung: Erst danach startet der zweite Lauf.
    await new Promise((r) => setTimeout(r, 1100));
    const pruefung = await starte(dir, ["--pruefen"], env);
    assert.equal(pruefung.status, 0, pruefung.out);
    const k = await kette;
    assert.equal(k.status, 0, k.out);

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

test("[protokoll-schritt] Vorab-Stand: vor dem Vorflug steht jede Kandidatenkarte auf laeuft", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const staende = journal(dir).filter((z) => z.art === "stand" && z.karte === F);
    assert.equal(staende[0].zustand, "laeuft");
    assert.match(staende[0].text, VORAB);
    assert.ok(staende[1].text.includes("plan begonnen"), "danach folgt der Stand der ersten Stufe");
  });
});

test("[protokoll-schritt] scheitert der Vorflug, steht jede Karte auf abgebrochen mit Befund, kit:night bleibt", () => {
  mitProjekt((dir) => {
    const a = fachplan(dir);
    const b = fachplan(dir, "[Fachlich] Ein zweites Anliegen");
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN } });
    const res = run(dir, ["--kette"], { ...env, NIGHT_VORFLUG_CMD: VORFLUG_KAPUTT });
    assert.equal(res.status, 1, "der Lauf endet mit hartem Stopp");
    for (const F of [a, b]) {
      const karte = board(dir, "issue", "get", F);
      assert.ok(karte.labels.includes("kit:night"), `kit:night an #${F} bleibt`);
      assert.ok(karte.labels.includes("lauf:abgebrochen"), `Labels: ${karte.labels}`);
      const text = kartenText(dir, F);
      assert.equal(text.split("## Laufstand").length - 1, 1, "genau ein Laufstand-Kommentar");
      assert.match(text, /Kette nicht gestartet um \S+: Die Vorflug-Session lieferte kein Ergebnis/);
      assert.equal(text.split("Kette nicht gestartet").length - 1, 1, "der Befund steht nur im Laufstand, kein eigener Kommentar");
      const staende = journal(dir).filter((z) => z.art === "stand" && z.karte === F);
      assert.deepEqual(staende.map((s) => s.zustand), ["laeuft", "abgebrochen"]);
    }
    assert.ok(!existsSync(join(dir, "helfer", "kette-sessions.log")), "keine Ketten-Session gestartet");
  });
});

test("[protokoll-schritt] mit --dry-run entsteht kein Vorab-Stand", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {} });
    const res = run(dir, ["--kette", "--dry-run"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(!board(dir, "issue", "get", F).labels.some((l) => l.startsWith("lauf:")));
    assert.ok(!kartenText(dir, F).includes("## Laufstand"));
    assert.deepEqual(journal(dir).filter((z) => z.art === "stand"), []);
  });
});

test("[protokoll-schritt] im Prueflauf entsteht kein Vorab-Stand", () => {
  mitProjekt((dir) => {
    const G = fachplan(dir, "[Fachlich] Zu pruefen", PRUEF_LABEL, false);
    const env = {
      ...umgebung(dir, { stufen: { pruefung: jePaket({ [G]: PRUEFUNG_GEPRUEFT }) } }),
      PRUEFUNG_BODY: fachplanBody({ marker: FACHPLAN_MARKER }),
    };
    const res = run(dir, ["--pruefen"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(!board(dir, "issue", "get", G).labels.some((l) => l.startsWith("lauf:")));
    assert.ok(!kartenText(dir, G).includes("## Laufstand"));
    assert.deepEqual(journal(dir).filter((z) => z.art === "stand"), []);
  }, {}, "night-protokoll-", { pruefLauf: PRUEF_BUDGET });
});

test("[protokoll-schritt] eine angehaltene Kette setzt wartet mit dem Wortlaut aus E1, kit:klaeren wie heute", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: { plan: PLAN_ANLEGEN, review: REVIEW_HALT } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(stand(dir).einheiten.find((e) => e.id === F).ausgang, "angehalten");
    const karte = board(dir, "issue", "get", F);
    assert.ok(karte.labels.includes("lauf:wartet"), `Labels: ${karte.labels}`);
    assert.ok(karte.labels.includes(KLAEREN_LABEL));
    const text = kartenText(dir, F);
    assert.ok(text.includes(`Halt: Frage wartet auf den Menschen — siehe \`${KETTE_HALT_ANKER}\``), text);
    assert.match(text, new RegExp(KETTE_HALT_ANKER));
    const letzter = journal(dir).findLast((z) => z.art === "stand" && z.karte === F);
    assert.equal(letzter.zustand, "wartet");
  });
});
