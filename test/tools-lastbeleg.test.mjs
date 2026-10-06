// Belegverfahren fuer parallele Prueflaeufe (Issue #1237, Plan #1199, E6, E9, E11).
//
// `tools/lastbeleg.mjs` legt Worktrees an, startet in allen gleichzeitig den Abschlusslauf
// und misst. Ein echter Lauf dauert Minuten je Worktree; diese Datei prueft das Werkzeug
// deshalb im selben Prozess, gegen einen injizierten Starter, eine injizierte Uhr und
// injizierte Worktrees (E6). Kein Kindprozess, keine feste Wartezeit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HILFE, argumenteLesen, lastbeleg, roteTestdateien } from "../tools/lastbeleg.mjs";

// Ein neutraler Pfad: Die Attrappen-Worktrees brauchen nur irgendeine Referenzdatei, und ein
// echter Quellpfad hier zaehlte in der Verflechtung als Kopplung an dessen Teil.
const REFERENZ = "src/referenz.mjs";

/**
 * Ein Wegwerf-Aufbau: Ablage, Attrappen-Worktrees mit der Referenzdatei, eine Uhr und ein
 * Starter, der je Kommando-Art das Ergebnis aus `antwort` liefert.
 */
function aufbau({ antwort = () => ({ code: 0, ausgabe: "" }), lasten = [1.5], schlafRunden = 0 } = {}) {
  const basis = mkdtempSync(join(tmpdir(), "lastbeleg-test-"));
  const ablage = join(basis, "ablage");
  mkdirSync(ablage);
  const uhr = { t: 1_000_000 };
  const aufrufe = [];
  const angelegt = [];
  const entfernt = [];
  let probe = 0;
  let geschlafen = 0;
  let abgetastet;
  const abtastenFertig = new Promise((r) => { abgetastet = r; });

  const worktree = {
    anlegen: (nr) => {
      const pfad = join(basis, `wt-${nr}`);
      mkdirSync(dirname(join(pfad, REFERENZ)), { recursive: true });
      writeFileSync(join(pfad, REFERENZ), "export const x = 1;\n");
      mkdirSync(join(pfad, ".claude"));
      writeFileSync(join(pfad, ".claude", "workflow.config.json"), JSON.stringify({ installCommand: "npm ci" }));
      angelegt.push(pfad);
      return pfad;
    },
    entfernen: (pfad) => {
      entfernt.push(pfad);
      rmSync(pfad, { recursive: true, force: true });
    },
  };

  const abh = {
    starter: async (aufruf) => {
      aufrufe.push(aufruf);
      // Ein Lauf endet erst, wenn der Abtaster seine Proben genommen hat: So haengt ihre
      // Zahl nicht an der Reihenfolge der Microtasks.
      if (aufruf.art === "lauf") await abtastenFertig;
      return antwort(aufruf, uhr);
    },
    jetzt: () => uhr.t,
    // Die ersten `schlafRunden` Pausen enden sofort, jede weitere nie: So nimmt der
    // Abtaster genau `schlafRunden + 1` Proben, und das Ende der Laeufe beendet ihn.
    schlaf: () => {
      if (geschlafen++ < schlafRunden) return Promise.resolve();
      abgetastet();
      return new Promise(() => {});
    },
    last: () => lasten[Math.min(probe++, lasten.length - 1)],
    worktree,
    stand: () => "abc1234",
    ablage,
    ausgabe: () => {},
  };
  return { basis, ablage, abh, aufrufe, angelegt, entfernt, uhr, aufraeumen: () => rmSync(basis, { recursive: true, force: true }) };
}

const OPT = { anzahl: 2, runden: 1, grenzeS: 600, referenz: REFERENZ, repoRoot: "/repo" };

function protokollVon(ablage) {
  const [verzeichnis] = readdirSync(ablage);
  const pfad = join(ablage, verzeichnis);
  return {
    verzeichnis,
    json: JSON.parse(readFileSync(join(pfad, "protokoll.json"), "utf-8")),
    md: readFileSync(join(pfad, "protokoll.md"), "utf-8"),
  };
}

test("die Hilfe nennt --anzahl, --runden, --grenze-s und --referenz", () => {
  for (const option of ["--anzahl", "--runden", "--grenze-s", "--referenz"]) {
    assert.match(HILFE, new RegExp(option));
  }
});

test("die Argumente tragen die Vorgaben aus E9 und lehnen Unsinn ab", () => {
  const vorgabe = argumenteLesen([]);
  assert.deepEqual({ ...vorgabe, referenz: undefined }, { anzahl: 10, runden: 1, grenzeS: 600, referenz: undefined, hilfe: false });
  assert.match(vorgabe.referenz, /^kit\/night\/kette\.mjs$/);
  assert.deepEqual(
    argumenteLesen(["--anzahl", "3", "--runden", "2", "--grenze-s", "120", "--referenz", "kit/checks.mjs"]),
    { anzahl: 3, runden: 2, grenzeS: 120, referenz: "kit/checks.mjs", hilfe: false },
  );
  assert.equal(argumenteLesen(["--help"]).hilfe, true);
  assert.throws(() => argumenteLesen(["--anzahl", "0"]), /--anzahl/);
  assert.throws(() => argumenteLesen(["--runden", "zwei"]), /--runden/);
  assert.throws(() => argumenteLesen(["--unbekannt"]), /--unbekannt/);
});

test("ein gruener Lauf: Einrichtung, Referenzaenderung, gleichzeitiger Start und Protokollform", async () => {
  // Die Referenzaenderung wird beim Start des Laufs gelesen: Danach ist der Worktree abgebaut.
  const beimStart = new Map();
  const a = aufbau({
    lasten: [2, 4, 6],
    schlafRunden: 2,
    antwort: (aufruf) => {
      if (aufruf.art === "lauf") beimStart.set(aufruf.cwd, readFileSync(join(aufruf.cwd, REFERENZ), "utf-8"));
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    const ergebnis = await lastbeleg(OPT, a.abh);
    assert.equal(ergebnis.exitCode, 0);

    // Jeder Worktree wird wie im frischen Checkout eingerichtet, dann laeuft der Abschlusslauf
    // der eben installierten Pruefsteuerung.
    for (const wt of a.angelegt) {
      const eigene = a.aufrufe.filter((x) => x.cwd === wt).map((x) => x.cmd);
      // sync-blobs zweimal: nach dem Einrichten und nach der Referenzaenderung (Issue #1257).
      assert.deepEqual(eigene, ["npm ci", "node tools/sync-blobs.mjs", "node tools/sync-blobs.mjs", "node .claude/kit/checks.mjs run --abschluss --frisch"]);
      assert.match(beimStart.get(wt), /^export const x = 1;\n\n\/\/ lastbeleg: Referenzaenderung/);
    }
    // Jeder Lauf hat seine eigene Sperre: Gemessen wird das Nebeneinander, nicht das Anstellen.
    const sperren = a.aufrufe.filter((x) => x.art === "lauf").map((x) => x.env.KIT_CHECKS_LOCK);
    assert.equal(new Set(sperren).size, 2);

    const { verzeichnis, json, md } = protokollVon(a.ablage);
    assert.match(verzeichnis, /^lastbeleg-\d{14}-\d+$/);
    assert.equal(json.ergebnis, "gruen");
    assert.equal(json.stand, "abc1234");
    assert.deepEqual(
      { anzahl: json.anzahl, runden: json.runden.length, grenzeS: json.grenzeS, referenz: json.referenz },
      { anzahl: 2, runden: 1, grenzeS: 600, referenz: REFERENZ },
    );
    const [runde] = json.runden;
    assert.deepEqual(runde.last, { hoechst: 6, mittel: 4, proben: 3 });
    assert.deepEqual(runde.laeufe.map((l) => [l.lauf, l.ergebnis, typeof l.dauerS]), [[1, "gruen", "number"], [2, "gruen", "number"]]);
    assert.deepEqual(json.wackelpruefungen, []);

    assert.match(md, /^# Lastbeleg/m);
    assert.match(md, /^## Runde 1$/m);
    assert.match(md, /Hoechstwert 6\.00, Mittelwert 4\.00/);
    assert.match(md, /^\| Lauf \| Dauer \| Ergebnis \|$/m);
    assert.match(md, /^\| 1 \| \d+\.\d s \| gruen \|$/m);
    assert.match(md, /^## Wackelpruefungen\n\nkeine$/m);
    assert.match(md, /^Ergebnis: gruen$/m);

    // Aufgeraeumt ist jeder angelegte Worktree.
    assert.deepEqual([...a.entfernt].sort(), [...a.angelegt].sort());
  } finally {
    a.aufraeumen();
  }
});

test("ein roter Lauf endet mit Exit ungleich 0, und eine rote Datei, die allein gruen ist, heisst Wackelpruefung", async () => {
  const ROT = [
    "✖ test/night-kette-a.test.mjs (12ms)",
    "✖ failing tests:",
    "test at test/night-kette-a.test.mjs:7:1",
    "✖ test/night-kette-b.test.mjs (3ms)",
    "-> rot",
  ].join("\n");
  const a = aufbau({
    antwort: (aufruf) => {
      if (aufruf.art === "lauf" && aufruf.cwd.endsWith("wt-2")) return { code: 1, ausgabe: ROT };
      // Allein ist a gruen, b bleibt rot.
      if (aufruf.art === "allein") return { code: aufruf.cmd.includes("night-kette-a") ? 0 : 1, ausgabe: "" };
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    const ergebnis = await lastbeleg(OPT, a.abh);
    assert.notEqual(ergebnis.exitCode, 0);

    const allein = a.aufrufe.filter((x) => x.art === "allein");
    assert.deepEqual(allein.map((x) => [x.cwd.endsWith("wt-2"), x.cmd]), [
      [true, "node --test test/night-kette-a.test.mjs"],
      [true, "node --test test/night-kette-b.test.mjs"],
    ]);

    const { json, md } = protokollVon(a.ablage);
    assert.equal(json.ergebnis, "rot");
    assert.deepEqual(json.runden[0].laeufe.map((l) => l.ergebnis), ["gruen", "rot"]);
    assert.deepEqual(json.wackelpruefungen, [{ runde: 1, lauf: 2, datei: "test/night-kette-a.test.mjs" }]);
    assert.match(md, /^- Runde 1, Lauf 2: test\/night-kette-a\.test\.mjs$/m);
    assert.doesNotMatch(md, /night-kette-b\.test\.mjs$/m);
    assert.match(md, /^Ergebnis: rot/m);
    // Die Ausgabe des roten Laufs liegt neben dem Protokoll.
    assert.ok(existsSync(join(a.ablage, protokollVon(a.ablage).verzeichnis, "runde-1-lauf-2.log")));
  } finally {
    a.aufraeumen();
  }
});

test("ein gruener Lauf ueber der Grenze endet mit Exit ungleich 0", async () => {
  const a = aufbau({
    antwort: (aufruf, uhr) => {
      if (aufruf.art === "lauf") uhr.t += 601_000;
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    const ergebnis = await lastbeleg({ ...OPT, anzahl: 1 }, a.abh);
    assert.notEqual(ergebnis.exitCode, 0);
    const { json, md } = protokollVon(a.ablage);
    assert.equal(json.ergebnis, "rot");
    assert.deepEqual(json.runden[0].laeufe.map((l) => [l.ergebnis, l.dauerS, l.ueberGrenze]), [["gruen", 601, true]]);
    assert.match(md, /^\| 1 \| 601\.0 s \| gruen, ueber der Grenze von 600 s \|$/m);
  } finally {
    a.aufraeumen();
  }
});

test("--runden wiederholt die Laeufe in denselben Worktrees", async () => {
  const a = aufbau();
  try {
    const ergebnis = await lastbeleg({ ...OPT, runden: 3 }, a.abh);
    assert.equal(ergebnis.exitCode, 0);
    assert.equal(a.angelegt.length, 2);
    assert.equal(a.aufrufe.filter((x) => x.art === "lauf").length, 6);
    assert.equal(protokollVon(a.ablage).json.runden.length, 3);
  } finally {
    a.aufraeumen();
  }
});

test("scheitert die Einrichtung, werden alle angelegten Worktrees trotzdem abgebaut", async () => {
  const a = aufbau({
    antwort: (aufruf) => ({ code: aufruf.cwd.endsWith("wt-2") && aufruf.cmd === "npm ci" ? 1 : 0, ausgabe: "kaputt" }),
  });
  try {
    const ergebnis = await lastbeleg(OPT, a.abh);
    assert.notEqual(ergebnis.exitCode, 0);
    assert.match(ergebnis.fehler, /npm ci/);
    assert.equal(a.angelegt.length, 2);
    assert.deepEqual([...a.entfernt].sort(), [...a.angelegt].sort());
    assert.equal(a.aufrufe.filter((x) => x.art === "lauf").length, 0);
  } finally {
    a.aufraeumen();
  }
});

test("wirft der Starter mitten im Lauf, werden alle Worktrees abgebaut", async () => {
  const a = aufbau({
    antwort: (aufruf) => {
      if (aufruf.art === "lauf") throw new Error("Starter weg");
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    const ergebnis = await lastbeleg(OPT, a.abh);
    assert.notEqual(ergebnis.exitCode, 0);
    assert.match(ergebnis.fehler, /Starter weg/);
    assert.deepEqual([...a.entfernt].sort(), [...a.angelegt].sort());
  } finally {
    a.aufraeumen();
  }
});

test("roteTestdateien liest die roten Dateien aus der Ausgabe, jede einmal", () => {
  const ausgabe = [
    "✔ test/gruen.test.mjs (4ms)",
    "✖ test/rot.test.mjs (12ms)",
    "test at test/rot.test.mjs:3:1",
    "not ok 2 - /tmp/wt-1/test/tap.test.mjs",
  ].join("\n");
  assert.deepEqual(roteTestdateien(ausgabe), ["test/rot.test.mjs", "test/tap.test.mjs"]);
});

test("vor sync-blobs stehen die Kopie-Verzeichnisse, die es im frischen Worktree sonst still auslaesst", async () => {
  // sync-blobs schreibt .claude/kit/ und .claude/skills/ nur, wenn sie schon da sind (Issue #1239).
  const vorhanden = [];
  const a = aufbau({
    antwort: (aufruf) => {
      if (aufruf.cmd === "node tools/sync-blobs.mjs") {
        vorhanden.push(["kit", "skills"].every((d) => existsSync(join(aufruf.cwd, ".claude", d))));
      }
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    await lastbeleg(OPT, a.abh);
    // Je Worktree zwei sync-blobs-Laeufe, vor und nach der Referenzaenderung (Issue #1257).
    assert.deepEqual(vorhanden, [true, true, true, true]);
  } finally {
    a.aufraeumen();
  }
});

test("[1257] nach der Referenzaenderung laeuft sync-blobs noch einmal, wie bei einem echten Kernpaket", async () => {
  // Ohne den zweiten Lauf stuende die installierte Kopie auf dem Stand vor der Aenderung, und
  // `sync-blobs --check` im Worktree waere in jedem Beleg rot (Issue #1257).
  const gesehen = [];
  const a = aufbau({
    antwort: (aufruf) => {
      if (aufruf.cmd === "node tools/sync-blobs.mjs") {
        gesehen.push({ wt: aufruf.cwd, mitMarke: readFileSync(join(aufruf.cwd, REFERENZ), "utf-8").includes("lastbeleg:") });
      }
      return { code: 0, ausgabe: "" };
    },
  });
  try {
    await lastbeleg(OPT, a.abh);
    for (const wt of new Set(gesehen.map((g) => g.wt))) {
      assert.deepEqual(gesehen.filter((g) => g.wt === wt).map((g) => g.mitMarke), [false, true], wt);
    }
  } finally {
    a.aufraeumen();
  }
});
