// Der Befund als Text (Issue #750, Plan #745, E9, E10, E15).
//
// `befund` ist die Lesekante fuer die zwei Ausgabestellen: den Abschlussblock des
// Nachtlaufs und `/push-main`. Zwei Eigenschaften machen sie tauglich:
//
//   Exit 0 IN JEDEM FALL — auch ohne Datei und mit kaputter Datei. Der Befund ist kein
//   Gate (Kriterium 10). Ein Kommando, das mit ungleich 0 endet, haelt in einer
//   Skill-Kette alles auf, was danach kommt; genau das darf eine Auswertung nie.
//
//   Byteweise LEERE Ausgabe ohne Befund (Kriterium 11) — keine Ueberschrift, keine
//   leere Tabelle, kein beruhigender Satz, keine Zeitzeile. Wer die Ausgabe in ein
//   Protokoll schreibt, soll dort nichts finden, wenn es nichts zu finden gibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { mitProjekt, lauf, einheit, pruefstand, aufwand, auswerten, standPfad, hatStand } from "./helpers/aufwand-fixture.mjs";

/** Ein Lauf, in dem genau der Werkzeuganteil auffaellt. */
function mitWerkzeugBefund(stempel = "2026-09-01-100000") {
  return lauf(stempel, {
    einheiten: [einheit(1, {
      zeiten: { dauerMs: 1000, nachdenkenMs: 300, werkzeugMs: 600, werkzeugSchuebe: 9, nebenlaeufigeSchuebe: 0 },
      eingabeTokens: 5_000_000,
      ausgabeTokens: 1_000_000,
      cacheErzeugtTokens: 0,
      cacheGelesenTokens: 0,
      pruefung: pruefstand({
        laufen: [
          { cmd: "a", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 400 },
          { cmd: "b", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
          { cmd: "c", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 300 },
        ],
        vollerUmfang: false,
        ausgelassen: [{ cmd: "d", grund: "Bereich kern unberuehrt" }],
      }),
    })],
  });
}

/** Derselbe Lauf, aber unauffaellig: 40 statt 60 Prozent Werkzeugarbeit. */
function ohneBefund(stempel = "2026-09-01-100000") {
  const l = mitWerkzeugBefund(stempel);
  l.daten.einheiten[0].zeiten.werkzeugMs = 400;
  return l;
}

test("[aufwand-2] mit Befund nennt die erste Zeile Auswertungszeitpunkt und juengsten Lauf", () => {
  mitProjekt({ laeufe: [mitWerkzeugBefund(), mitWerkzeugBefund("2026-09-02-100000")] }, (dir) => {
    auswerten(dir);

    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    const [kopf, ...rest] = res.stdout.split("\n");
    assert.match(kopf, /^Auswertung vom \d{4}-\d{2}-\d{2}T[\d:.]+Z? ueber 2 Laeufe bis 2026-09-02-100000\.$/,
      `die Kopfzeile passt nicht: ${kopf}`);
    assert.match(rest.join("\n"), /Werkzeugarbeit/, "der Befundblock selbst fehlt");
  });
});

test("[aufwand-2] ohne Befund bleibt die Ausgabe byteweise leer — auch die Zeitzeile", () => {
  mitProjekt({ laeufe: [ohneBefund()] }, (dir) => {
    auswerten(dir);

    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", `erwartet war eine leere Ausgabe, kam: ${JSON.stringify(res.stdout)}`);
    assert.equal(res.stderr, "", "auch stderr bleibt stumm");
  });
});

test("[aufwand-2] ohne aufwand.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({ laeufe: [mitWerkzeugBefund()] }, (dir) => {
    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, `ohne Datei darf der Befund nichts aufhalten: ${res.stderr}`);
    assert.equal(res.stdout, "");
    assert.equal(hatStand(dir), false, "befund legt nichts an — es liest nur");
  });
});

test("[aufwand-2] mit kaputter aufwand.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({ laeufe: [mitWerkzeugBefund()] }, (dir) => {
    auswerten(dir);
    writeFileSync(standPfad(dir), "{ das ist kein JSON", "utf-8");

    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
  });
});

test("[aufwand-2] eine aufwand.json ohne Befundfeld bleibt stumm", () => {
  // Eine Datei aus einer aelteren Fassung oder von fremder Hand: kein `befund`-Feld.
  // Ein Absturz waere hier derselbe Fehler wie ein Exit ungleich 0.
  mitProjekt({ laeufe: [mitWerkzeugBefund()] }, (dir) => {
    writeFileSync(standPfad(dir), JSON.stringify({ erzeugtAm: "2026-09-01T00:00:00.000Z" }), "utf-8");

    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
  });
});

test("[aufwand-2] eine neuere Auswertung ohne Befund loescht den alten Stand", () => {
  // Kriterium 9: Ein Befund von gestern darf nicht ueber einen unauffaelligen Lauf von
  // heute stehen bleiben — er saehe aus wie der Befund von heute.
  mitProjekt({ laeufe: [mitWerkzeugBefund()] }, (dir) => {
    auswerten(dir);
    assert.notEqual(aufwand(dir, "befund").stdout, "", "der erste Lauf haette einen Befund haben muessen");

    // Der auffaellige Stand verschwindet, ein unauffaelliger tritt an seine Stelle.
    rmSync(`${dir}/.claude/night-run-2026-09-01-100000.json`);
    writeFileSync(`${dir}/.claude/night-run-2026-09-02-100000.json`,
      JSON.stringify(ohneBefund("2026-09-02-100000").daten, null, 2) + "\n", "utf-8");
    auswerten(dir);

    const res = aufwand(dir, "befund");
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "", "der alte Befund steht noch in aufwand.json");
  });
});

test("[aufwand-2] der Befundblock nennt jede ueberschrittene Schwelle in Worten, ohne Empfehlung", () => {
  const l = mitWerkzeugBefund();
  l.daten.einheiten[0].pruefung.vollerUmfang = true;
  l.daten.einheiten[0].pruefung.ausgelassen = [];
  mitProjekt({ laeufe: [l] }, (dir) => {
    auswerten(dir);

    const { stdout } = aufwand(dir, "befund");

    assert.match(stdout, /Werkzeugarbeit/);
    assert.match(stdout, /Eingrenzung/);
    // Nicht-Ziel: keine Handlungsempfehlung. Kein "sollte", "empfiehlt", "besser".
    assert.doesNotMatch(stdout, /sollte|empfehl|besser w(ae|ä)re|ratsam/i,
      "der Befund gibt eine Handlungsempfehlung");
  });
});

test("[aufwand-2] befund liest allein aufwand.json — ohne Config und ohne Ergebnisstaende", () => {
  // Der Skill `/push-main` ruft es vor dem ersten nummerierten Schritt, also bevor die
  // Config gelesen wurde. Es darf davon nichts brauchen.
  mitProjekt({ laeufe: [mitWerkzeugBefund()] }, (dir) => {
    auswerten(dir);
    rmSync(`${dir}/.claude/night-run-2026-09-01-100000.json`);

    const res = aufwand(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^Auswertung vom /);
  });
});

test("[aufwand-2] befund weist ein ueberzaehliges Argument ab, ohne etwas auszugeben", () => {
  mitProjekt({ laeufe: [] }, (dir) => {
    const res = aufwand(dir, "befund", "--laeufe", "3");

    assert.notEqual(res.status, 0, "ein unbekanntes Argument gehoert abgewiesen");
    assert.equal(res.stdout, "", "auf stdout gehoert hier kein Text, den ein Skill weiterreicht");
    assert.match(res.stderr, /--laeufe/);
  });
});
