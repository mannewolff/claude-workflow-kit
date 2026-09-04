// Blob-Hashes in der Pruef-Zusammenfassung (Issue #469).
//
// Das Commit-Gate aus Plan #467 vergleicht die gestagten Dateien gegen die
// Hashes, die der Prueflauf hinterlassen hat. Damit dieser Vergleich etwas
// aussagt, muss der Hash den Stand bezeugen, der IN DIE PRUEFUNG ging — nicht
// den danach. Deshalb laeuft `git hash-object` vor dem ersten Kommando.
//
// Echtes Repo statt Fixture, wie in den uebrigen checks-Tests: Die Frage, ob
// eine Loeschung oder eine Umbenennung richtig gezaehlt wird, ist genau die,
// die ein Mock offenliesse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { mitRepo, git, run, plan, zusammenfassung, datei } from "./helpers/checks-repo.mjs";

const LEISE = { buildChecks: ["node -e \"process.exit(0)\""] };

test("[checks-1] run schreibt je Pfad aus geaendert einen Eintrag in hashes", () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "a.txt", "A\n");
    datei(dir, "b.txt", "B\n");
    const res = run(dir);
    assert.equal(res.status, 0, res.stderr);
    const z = zusammenfassung(dir);
    assert.deepEqual(Object.keys(z.hashes).sort(), z.geaendert.slice().sort());
  });
});

test("[checks-1] der Hash entspricht git hash-object desselben Pfads", () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "a.txt", "Inhalt mit Umlaut: Aenderung\n");
    run(dir);
    const z = zusammenfassung(dir);
    assert.equal(z.hashes["a.txt"], git(dir, "hash-object", "a.txt"));
  });
});

test("[checks-1] ein geloeschter Pfad traegt null und der Lauf bleibt gruen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    git(dir, "rm", "-q", "README.md");
    const res = run(dir);
    assert.equal(res.status, 0, res.stderr);
    const z = zusammenfassung(dir);
    assert.equal(z.hashes["README.md"], null);
  });
});

test("[checks-1] eine Umbenennung traegt null auf der alten und einen Hash auf der neuen Seite", () => {
  mitRepo({ config: LEISE }, (dir) => {
    git(dir, "mv", "README.md", "LIESMICH.md");
    run(dir);
    const z = zusammenfassung(dir);
    assert.equal(z.hashes["README.md"], null, "die alte Seite muss den Tombstone tragen");
    assert.equal(z.hashes["LIESMICH.md"], git(dir, "hash-object", "LIESMICH.md"));
  });
});

test("[checks-1] eine ungetrackte neue Datei bekommt einen Hash", () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "neu/tief.txt", "tief\n");
    run(dir);
    const z = zusammenfassung(dir);
    assert.equal(z.hashes["neu/tief.txt"], git(dir, "hash-object", "neu/tief.txt"));
  });
});

test("[checks-1] der Hash stammt von VOR dem Lauf, auch wenn ein Check die Datei veraendert", () => {
  // Der tragende Fall: Ein Formatter mit --fix schreibt waehrend des Laufs. Der
  // Hash danach bescheinigte einen Stand, den kein Check gesehen hat.
  const FORMATTER = String.raw`node -e "require('fs').writeFileSync('a.txt','NACHHER\n')"`;
  mitRepo({ config: { buildChecks: [FORMATTER] } }, (dir) => {
    datei(dir, "a.txt", "VORHER\n");
    const vorher = git(dir, "hash-object", "a.txt");
    const res = run(dir);
    assert.equal(res.status, 0, res.stderr);
    const z = zusammenfassung(dir);
    assert.equal(z.hashes["a.txt"], vorher, "der Hash muss den Stand vor dem Check tragen");
    assert.notEqual(git(dir, "hash-object", "a.txt"), vorher, "der Check haette die Datei aendern muessen");
  });
});

test("[checks-1] ein leeres Paket schreibt hashes als leeres Objekt, nicht als fehlendes Feld", () => {
  mitRepo({ config: LEISE }, (dir) => {
    run(dir);
    const z = zusammenfassung(dir);
    assert.equal(z.leeresPaket, true);
    assert.deepEqual(z.hashes, {});
  });
});

test("[checks-1] bei nicht aufloesbarem Anker bleibt hashes leer und der Lauf gruen", () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "a.txt", "A\n");
    const res = run(dir, "--since", "");
    assert.equal(res.status, 0, res.stderr);
    const z = zusammenfassung(dir);
    assert.equal(z.vollerUmfang, true);
    assert.deepEqual(z.hashes, {});
  });
});

test("[checks-1] plan gibt kein Feld hashes aus", () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "a.txt", "A\n");
    const p = plan(dir);
    assert.equal("hashes" in p, false, "hashes gehoert nur in die Zusammenfassung von run");
  });
});

test("[checks-1] ein vorhandener, aber unlesbarer Pfad beendet den Lauf rot", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  mitRepo({ config: LEISE }, (dir) => {
    datei(dir, "geheim.txt", "x\n");
    chmodSync(join(dir, "geheim.txt"), 0o000);
    try {
      const res = run(dir);
      assert.notEqual(res.status, 0, "ein unlesbarer Pfad ist kein Tombstone");
      assert.match(res.stderr, /geheim\.txt/);
      assert.equal(existsSync(join(dir, ".claude", "checks-summary.json")), false);
    } finally {
      chmodSync(join(dir, "geheim.txt"), 0o644);
    }
  });
});
