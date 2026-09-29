// Die pruefungsfreie Zuordnung `ohnePruefung` (Issue #934, Plan #930, Fachplan #914).
//
// Eine dritte Antwort auf die Frage, was eine geaenderte Datei ausloest. Bisher
// gab es zwei: Sie trifft ein `checkAreas`-Muster und beruehrt einen Bereich,
// oder sie trifft keines und zieht den vollen Umfang nach sich. Die dritte ist
// die ausdrueckliche: Zu dieser Datei gibt es nichts zu pruefen, und warum,
// steht daneben.
//
// Drei Dinge haelt diese Datei fest:
//   - die Wirkung: weder beruehrt noch `ohneZuordnung`, also kein voller Umfang,
//   - den Vorrang (E3): trifft eine Datei beide Musterarten, gewinnt `checkAreas`,
//   - die Kopplung ans Commit-Gate (E2): `geaendert` und `hashes` bleiben, wie
//     sie waren. Faellt die Datei dort heraus, weist das Gate jeden Commit ab,
//     der sie mitbringt — die Beschleunigung haette das Gate zugemauert.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mitRepo, plan, run, datei, kommandos, eintrag, zusammenfassung,
  git, gate, gateEinbauen,
} from "./helpers/checks-repo.mjs";

const GRUND = "Release-Protokoll; keine Pruefung liest seinen Inhalt";

// Leise und gruen, damit der Exit-Code von `run` etwas ueber die Auswahl sagt und
// nicht ueber ein Werkzeug, das im Wegwerf-Repo gar nicht installiert ist.
const BAU = "node -e \"console.log('frontend')\"";
const VERIFY = "node -e \"console.log('backend')\"";

const CONFIG = {
  buildChecks: [
    { cmd: BAU, areas: ["frontend"] },
    { cmd: VERIFY, areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
  ohnePruefung: [{ muster: "CHANGELOG.md", grund: GRUND }],
};

test("eine Datei mit ohnePruefung-Treffer zaehlt weder als beruehrt noch als ohneZuordnung", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, false, "die Datei zieht keinen vollen Umfang nach sich");
    assert.deepEqual(ergebnis.ohneZuordnung, [], "sie ist zugeordnet — nur eben zu keiner Pruefung");
    assert.deepEqual(ergebnis.bereiche, [], "sie beruehrt keinen Bereich");
    assert.deepEqual(ergebnis.ohnePruefung, [{ pfad: "CHANGELOG.md", grund: GRUND }]);
    assert.deepEqual(kommandos(ergebnis.laufen), [], "keine Bereichspruefung laeuft");
  });
});

test("ohne konfiguriertes ohnePruefung bleibt die Liste leer und die Datei zieht den vollen Umfang", () => {
  const { ohnePruefung, ...ohneFeld } = CONFIG;
  assert.ok(ohnePruefung, "die Vorlage traegt das Feld, das hier fehlen soll");
  mitRepo({ config: ohneFeld }, (dir) => {
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true, "ohne das Feld bleibt es beim bisherigen Verhalten");
    assert.deepEqual(ergebnis.ohneZuordnung, ["CHANGELOG.md"]);
    assert.deepEqual(ergebnis.ohnePruefung, []);
  });
});

test("die Datei bleibt in geaendert und in hashes — das Commit-Gate laesst sie durch (E2)", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    // Erst committen, dann aendern: Sonst zaehlten Hook und Gate selbst als
    // Aenderung dieses Pakets und die Zusammenfassung spraeche ueber sie mit.
    gateEinbauen(dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "gate");
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");

    const res = run(dir);
    assert.equal(res.status, 0, res.stderr);

    const z = zusammenfassung(dir);
    assert.deepEqual(z.geaendert, ["CHANGELOG.md"], "die Datei bleibt im Nachweis");
    assert.deepEqual(Object.keys(z.hashes), ["CHANGELOG.md"], "und traegt weiter ihren Blob-Hash");
    assert.deepEqual(z.ohnePruefung, [{ pfad: "CHANGELOG.md", grund: GRUND }]);

    git(dir, "add", "CHANGELOG.md");
    const tor = gate(dir, "pre-commit");
    assert.equal(tor.status, 0, `das Gate weist den Commit ab: ${tor.stdout}${tor.stderr}`);
  });
});

test("trifft eine Datei beide Musterarten, gewinnt checkAreas (E3)", () => {
  const config = {
    ...CONFIG,
    ohnePruefung: [{ muster: "frontend/**", grund: "zu weit geratenes Muster" }],
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["frontend"], "die Datei gilt als beruehrt");
    assert.deepEqual(kommandos(ergebnis.laufen), [BAU], "ihre Bereichspruefung laeuft");
    assert.deepEqual(ergebnis.ohnePruefung, [], "und sie steht nicht in der Liste");
    assert.equal(ergebnis.vollerUmfang, false);
  });
});

test("eine Datei ohne jedes Muster zieht weiter den vollen Umfang, auch neben einer pruefungsfreien", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");
    datei(dir, "notizen.txt");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.vollerUmfang, true);
    assert.deepEqual(ergebnis.ohneZuordnung, ["notizen.txt"], "nur die wirklich unzugeordnete steht dort");
    assert.deepEqual(ergebnis.ohnePruefung, [{ pfad: "CHANGELOG.md", grund: GRUND }]);
    assert.equal(
      eintrag(ergebnis.laufen, BAU).grund,
      "voller Umfang: 'notizen.txt' trifft kein Muster",
    );
  });
});

test("run nennt jede pruefungsfreie Datei mit ihrem Grund, vor den Auslassungen", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "CHANGELOG.md", "## 1.0.1\n");

    const res = run(dir);
    assert.equal(res.status, 0, res.stderr);

    const zeile = `ohne Pruefung: CHANGELOG.md — ${GRUND}`;
    assert.ok(res.stdout.includes(zeile), `die Zeile fehlt im Bericht:\n${res.stdout}`);
    assert.ok(
      res.stdout.indexOf(zeile) < res.stdout.indexOf("ausgelassen:"),
      "die Ausnahme steht vor den Auslassungen",
    );
  });
});

test("die pruefungsfreien Muster stehen im Config-Fingerabdruck", () => {
  // Sonst uebernaehme der naechste Lauf auf unveraendertem Stand das Ergebnis des
  // vorigen (Issue #863) — und zwar eines, das unter einer anderen Auswahl entstand.
  // Gehasht wird, woraus die Auswahl entsteht; seit diesem Paket gehoert `ohnePruefung`
  // dazu.
  const hashVon = (config) => {
    let wert = null;
    mitRepo({ config }, (dir) => {
      datei(dir, "CHANGELOG.md", "## 1.0.1\n");
      const res = run(dir);
      assert.equal(res.status, 0, res.stderr);
      wert = zusammenfassung(dir).configHash;
    });
    return wert;
  };

  const anders = { ...CONFIG, ohnePruefung: [{ muster: "CHANGELOG.md", grund: "ein anderer Grund" }] };
  assert.notEqual(hashVon(CONFIG), hashVon(anders), "ein anderer Grund ist eine andere Config");
});
