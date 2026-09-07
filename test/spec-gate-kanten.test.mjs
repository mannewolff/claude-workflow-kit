// Die Raender des Gates `spec.mjs check --anker` (Issue #500, Plan #492).
//
// test/spec-check-anker.test.mjs prueft die beiden Fragen des Gates im Regelfall.
// Hier stehen die Faelle daneben, und sie zerfallen in zwei Gruppen:
//
//   Der Suchraum — 'spec.testPattern' ist konfigurierbar (A5). Ein Muster ohne
//   Platzhalter faende jede ID oder keine, ein syntaktisch kaputtes gar nichts.
//   Beides endet rot: Ein Gate, das mangels brauchbarem Muster nichts findet und
//   deshalb nichts meldet, bescheinigt eine Pruefung, die nicht stattfand.
//
//   Die Abweichung — Eine Aussage kann auf mehr als eine Art nicht zur
//   Wirkungszeile passen: Sie steht auf der falschen Seite von '## Entfallen',
//   oder sie steht richtig, traegt aber die Nummer eines anderen Pakets. Beides
//   muss das Gate sehen, sonst ginge eine Streichung als erledigt durch, die
//   jemand anderes vorgenommen hat.
//
// Gemessen wird am Exit-Code und an der Meldung, gegen ein echtes Repo und den
// echten Adapter (helpers/spec-repo.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, spec, commit, kopf, paketAnlegen, SPEC_BLOCK, SEIT } from "./helpers/spec-repo.mjs";
import { dateiSchreiben } from "./helpers/spec-fixture.mjs";

const MIT_GLOBS = { ...SPEC_BLOCK, testGlobs: ["tests/**"] };

/**
 * Legt die Pakete an, committet je einen Commit mit Marke, schreibt optional die
 * Beschreibung fort, legt optional die Testdatei mit den Verweisen an und ruft
 * dann das Gate.
 */
function gateMit(pakete, fn, { specBlock = MIT_GLOBS, fortschreiben = true, verweise = null } = {}) {
  mitRepo({ specBlock }, (dir) => {
    const anker = kopf(dir);
    for (const [nummer, wirkung] of pakete) {
      paketAnlegen(dir, nummer, { wirkung });
      commit(dir, `Arbeit an ${nummer} (Issue #${nummer})`);
    }

    if (fortschreiben) {
      const vorlauf = spec(dir, "apply", "--anker", anker);
      assert.equal(vorlauf.status, 0, `apply haette gruen enden muessen: ${vorlauf.stderr}`);
    }
    if (verweise !== null) dateiSchreiben(dir, "tests/verweise.test.mjs", verweise);

    fn(spec(dir, "check", "--anker", anker), dir);
  });
}

const EINE_NEUE = [[7, "NEU beta beta-2 — Die Auskunft nennt den Bereich."]];

// --- 'spec.testPattern' -----------------------------------------------------

test("ein eigenes 'spec.testPattern' wird benutzt, nicht der Default", () => {
  // Der Beleg steht hier nicht in eckigen Klammern, sondern hinter 'Spec:'. Ein
  // Gate, das trotzdem den Default suchte, faende ihn nicht — und ein Gate, das
  // den Default zusaetzlich suchte, faende ihn zu oft.
  gateMit(EINE_NEUE, (res) => {
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stdout, /ohne Befund/);
  }, {
    specBlock: { ...MIT_GLOBS, testPattern: "Spec: <ID>" },
    verweise: 'test("Spec: beta-2 — die Zusage wird eingehalten", () => {});\n',
  });
});

test("ein eigenes Muster laesst den Default-Verweis nicht mehr gelten", () => {
  gateMit(EINE_NEUE, (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Paket #7: Auf die Aussage 'beta-2' verweist kein Test \(A5\)\./);
  }, {
    specBlock: { ...MIT_GLOBS, testPattern: "Spec: <ID>" },
    verweise: 'test("[beta-2] die Zusage wird eingehalten", () => {});\n',
  });
});

test("ein leeres 'spec.testPattern' faellt auf den Default zurueck", () => {
  // Ein leeres Feld ist keine Angabe. Es als Muster zu nehmen hiesse, in jeder
  // Datei jede ID zu finden — das Gate oeffnete immer.
  gateMit(EINE_NEUE, (res) => {
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
  }, {
    specBlock: { ...MIT_GLOBS, testPattern: "" },
    verweise: 'test("[beta-2] die Zusage wird eingehalten", () => {});\n',
  });
});

test("ein 'spec.testPattern' ohne Platzhalter endet rot, statt still zu oeffnen", () => {
  gateMit(EINE_NEUE, (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /'spec\.testPattern'.*enthaelt den Platzhalter '<ID>' nicht/);
  }, {
    specBlock: { ...MIT_GLOBS, testPattern: "belegt" },
    verweise: 'test("belegt: beta-2", () => {});\n',
  });
});

test("ein 'spec.testPattern', das kein gueltiger regulaerer Ausdruck ist, endet rot", () => {
  // Der Platzhalter ist da, das Muster ist trotzdem unbrauchbar: Die eckige
  // Klammer bleibt offen. Der Fehler faellt erst beim Suchen auf — und auch dort
  // wird er gemeldet, nicht verschluckt.
  gateMit(EINE_NEUE, (res) => {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /'spec\.testPattern'.*ist kein gueltiger regulaerer Ausdruck: /);
  }, {
    specBlock: { ...MIT_GLOBS, testPattern: "[<ID>" },
    verweise: 'test("[beta-2] die Zusage wird eingehalten", () => {});\n',
  });
});

// --- Die Abweichung ---------------------------------------------------------

test("eine geaenderte Aussage, die unter '## Entfallen' steht: Exit 1 mit Fundort", () => {
  // alpha-4 ist gestrichen. Ein Paket, das sie aendern will, beschreibt einen
  // Stand, den es nicht gibt — und das Gate sagt, wo sie stattdessen steht.
  gateMit(
    [[7, "GEAENDERT alpha-4 — Der Lauf schreibt wieder ein Protokoll."]],
    (res) => {
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Paket #7: Die Aussage 'alpha-4' steht in specs\/alpha\.md unter '## Entfallen'\./);
    },
    { fortschreiben: false },
  );
});

test("eine Streichung mit fremder Paketnummer geht nicht als erledigt durch", () => {
  // alpha-4 steht unter '## Entfallen', aber mit Paket #123. Zaehlte nur die
  // Position, koennte jedes Paket die Streichung eines anderen als seine eigene
  // ausgeben — und die Beschreibung wuesste nicht mehr, wer was gestrichen hat.
  gateMit(
    [[7, "ENTFAELLT alpha-4 — Steht laengst nicht mehr zur Debatte."]],
    (res) => {
      assert.equal(res.status, 1);
      assert.match(res.stderr,
        /Paket #7: Die Aussage 'alpha-4' steht in specs\/alpha\.md unter '## Entfallen', aber mit Paket #123\./);
    },
    { fortschreiben: false },
  );
});

// --- Ein spec-Block ohne 'bereiche' -----------------------------------------

test("ein spec-Block ohne 'bereiche': ein Paket mit 'KEINE' kommt trotzdem durch", () => {
  // 'bereiche' ist im Schema optional. Ohne das Feld ist kein Bereich bekannt —
  // das macht jede NEU-Zeile zum Befund, darf aber ein Paket ohne Wirkung nicht
  // aufhalten.
  gateMit(
    [[7, "KEINE — dieses Paket aendert nichts an der Beschreibung."]],
    (res) => {
      assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
      assert.match(res.stdout, /1 Paket gewertet, ohne Befund/);
    },
    { specBlock: { seit: SEIT, testGlobs: ["tests/**"] } },
  );
});
