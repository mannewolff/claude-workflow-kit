// Die Wiederverwendung eines Ergebnisses auf unveraendertem Stand (Issue #863).
//
// Lauf #118 zeigte Sessions, die `checks.mjs run` drei- bis neunmal je Paket
// starten — meist gruen, meist ohne Aenderung dazwischen, nur um die Ausgabe
// anders zu filtern. Die Regel aus #835 steht im Skilltext und wirkt nicht; nach
// dem Massstab aus #769 gehoert eine Bedienregel ins Werkzeug.
//
// Geprueft wird an der WIRKUNG, nicht an der Ausgabe: Ein Zaehlerkommando haengt
// je Ausfuehrung eine Zeile an. Es liegt unter `.claude/` und damit hinter der
// Ignore-Regel — sonst veraenderte der erste Lauf genau den Stand, dessen
// Unveraendertheit der zweite feststellen soll.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  mitRepo, checks, run, zusammenfassung, datei, git, ausfuehrungen,
} from "./helpers/checks-repo.mjs";

const ZAEHLER = "node .claude/zaehler.mjs";

/** Legt das Zaehlerkommando an und gibt die Config dazu. */
function mitZaehler(cmd = ZAEHLER) {
  return {
    buildChecks: [{ cmd, always: true }],
    checkAreas: { kern: ["src/**"] },
  };
}

function zaehlerAnlegen(dir, exitCode = 0) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "zaehler.mjs"),
    [
      "import { appendFileSync } from 'node:fs';",
      String.raw`appendFileSync('.claude/zaehler.txt', 'x\n');`,
      `process.exit(${exitCode});`,
      "",
    ].join("\n"),
    "utf-8",
  );
}

/** Wie oft das Zaehlerkommando gelaufen ist. */
function laeufe(dir) {
  try {
    return readFileSync(join(dir, ".claude", "zaehler.txt"), "utf-8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

test("[checks-11] ein zweiter run auf unveraendertem Stand startet kein Kommando und liefert denselben Exitcode", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    const erster = await run(dir);
    const zeitpunkt = zusammenfassung(dir).zeitpunkt;
    const zweiter = await run(dir);

    assert.equal(erster.status, 0, erster.stderr);
    assert.equal(laeufe(dir), 1, "der zweite Lauf darf das Kommando nicht erneut starten");
    assert.equal(zweiter.status, erster.status, "der Exitcode bleibt derselbe");
    assert.match(zweiter.stdout, /Ergebnis uebernommen \(gruen\)/);
    assert.match(zweiter.stdout, /--frisch/, "die Meldung nennt den Weg zum echten Lauf");

    const summary = zusammenfassung(dir);
    assert.equal(summary.uebernommen, zeitpunkt, "uebernommen traegt den Zeitpunkt des Originals");
    assert.notEqual(summary.zeitpunkt, zeitpunkt, "der Nachweis traegt einen frischen Zeitpunkt");
    assert.equal(summary.abgeschlossen, true);
    assert.equal(summary.laufen[0].ergebnis, "gruen");
  });
});

test("[checks-11] ein rotes Ergebnis wird ebenso uebernommen — mit Exitcode und rotem Kommando in der Meldung", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir, 1);
    datei(dir, "src/a.txt");

    const erster = await run(dir);
    const zweiter = await run(dir);

    assert.notEqual(erster.status, 0, "Vorbedingung: der erste Lauf ist rot");
    assert.equal(laeufe(dir), 1, "derselbe Stand liefert dasselbe Rot, ein zweiter Lauf ist verschwendet");
    assert.equal(zweiter.status, erster.status);
    assert.match(zweiter.stdout, /Ergebnis uebernommen \(rot: node \.claude\/zaehler\.mjs\)/);
  });
});

test("[checks-11] eine geaenderte Datei erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    datei(dir, "src/a.txt", "anders\n");
    await run(dir);

    assert.equal(laeufe(dir), 2);
  });
});

test("[checks-11] eine neue unversionierte Datei erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    datei(dir, "src/b.txt");
    await run(dir);

    assert.equal(laeufe(dir), 2);
  });
});

test("[checks-11] eine andere Stufe erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    await run(dir, "--stufe", "push");

    assert.equal(laeufe(dir), 2);
  });
});

test("[checks-11] ein anderer Anker erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");
    git(dir, "add", "src/a.txt");
    git(dir, "commit", "-q", "-m", "paket");
    datei(dir, "src/b.txt");

    await run(dir);
    await run(dir, "--since", "HEAD~1");

    assert.equal(laeufe(dir), 2);
  });
});

test("[checks-11] eine geaenderte Config erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    // Nur der Config-Hash unterscheidet sich: Der Stand der Dateien, der Anker und
    // die Stufe bleiben, wie sie waren.
    const summary = zusammenfassung(dir);
    summary.configHash = "0".repeat(64);
    writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf-8");
    await run(dir);

    assert.equal(laeufe(dir), 2, "eine andere Config ist ein anderer Stand");
  });
});

test("[checks-11] die Zusammenfassung traegt den Config-Hash als Feld", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);

    assert.match(zusammenfassung(dir).configHash, /^[0-9a-f]{64}$/);
  });
});

test("[checks-11] --frisch erzwingt einen echten Lauf", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    const res = await run(dir, "--frisch");

    assert.equal(laeufe(dir), 2);
    assert.doesNotMatch(res.stdout, /uebernommen/);
    assert.equal(zusammenfassung(dir).uebernommen, undefined);
  });
});

test("[checks-11] eine nicht abgeschlossene Zusammenfassung wird nie uebernommen", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    const summary = zusammenfassung(dir);
    summary.abgeschlossen = false;
    writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf-8");
    await run(dir);

    assert.equal(laeufe(dir), 2, "ein abgebrochener Lauf bezeugt keinen Stand");
  });
});

test("[checks-11] eine fehlende oder unlesbare Zusammenfassung laesst alles wie bisher laufen", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    writeFileSync(join(dir, ".claude", "checks-summary.json"), "{kein json", "utf-8");
    await run(dir);

    assert.equal(laeufe(dir), 2);
  });
});

test("[checks-11] ein uebernommener Lauf schreibt keine Zeile ins Ausfuehrungsprotokoll", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    zaehlerAnlegen(dir);
    datei(dir, "src/a.txt");

    await run(dir);
    const nachErstem = ausfuehrungen(dir).length;
    await run(dir);

    assert.equal(nachErstem, 1, "Vorbedingung: der echte Lauf buchte seine Ausfuehrung");
    assert.equal(ausfuehrungen(dir).length, 1, "ein uebernommenes Ergebnis ist keine Ausfuehrung");
  });
});

test("[checks-11] die Uebersicht nennt die Wiederverwendung und den Schalter", async () => {
  await mitRepo({ config: mitZaehler() }, async (dir) => {
    const res = checks(dir, "--help");

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /--frisch/);
    assert.match(res.stdout, /uebernommen|uebernimmt/);
  });
});
