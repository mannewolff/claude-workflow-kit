// `spec.mjs vorhaben` — die Notiz zum Code-Lesen (Issue #446).
//
// Die Notiz ist ein Nachweis, kein Vermerk: Sie sagt, ob fuer das Bestandsverhalten
// eines Vorhabens Produktionscode gelesen wurde. Deshalb messen die Tests vor allem
// zwei Dinge.
//
// Erstens: **Welche Einheit gilt, steht in der Datei selbst.** Ein Rueckfall auf ein
// Plandokument (A9) muss sich spaeter von einem echten Vorhaben unterscheiden lassen —
// sonst ist nicht mehr erkennbar, worauf sich die Angabe bezieht. Die Tests pruefen
// deshalb nicht nur, dass die richtige Zeile dasteht, sondern auch, dass die falsche
// fehlt.
//
// Zweitens: **Ein Feld, das man leer lassen kann, ist kein Nachweis.** Fehlt
// `--code-gelesen` oder traegt es einen anderen Wert als ja/nein, endet der Lauf rot
// und ohne Datei. Eine halb geschriebene Notiz waere schlimmer als keine.
//
// Seit Issue #548 ist der Ablageort ein anderer: Die Notiz entsteht als **wartende**
// Datei `.claude/vorhaben-wartend-<kuerzel>.md` und kommt erst beim naechsten
// `push main` unter `specs/vorhaben/` an. Deshalb messen auch alle Negativ-Zusagen
// dort — eine Zusage, die noch `specs/vorhaben/` prueft, waere eine leere Pruefung:
// gruen, auch wenn ein abgebrochener Lauf eine wartende Datei hinterliesse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitFixture, spec, configSchreiben, SPEC } from "./helpers/spec-fixture.mjs";

const SPEC_BLOCK = { seit: "2026-09-02", bereiche: { alpha: ["kit/**"] } };

const HINWEIS = "- Hinweis: Plandokument statt Vorhaben, weil der Tracker keine Vorhaben kennt (A9).";

/**
 * Legt ein Wegwerf-Verzeichnis ohne specs/ an und schreibt die Config.
 * `specBlock: null` laesst den Block weg, `config: null` die ganze Datei.
 */
function mitProjekt(fn, { specBlock = SPEC_BLOCK, config = {} } = {}) {
  mitFixture(null, (dir) => {
    if (config !== null) configSchreiben(dir, specBlock === null ? config : { ...config, spec: specBlock });
    fn(dir);
  });
}

/** Ruft `vorhaben` auf und verlangt einen gruenen Lauf. */
function vorhaben(dir, ...args) {
  const res = spec(dir, "vorhaben", ...args);
  assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
  return res;
}

function notizPfad(dir, kuerzel) {
  return join(dir, ".claude", `vorhaben-wartend-${kuerzel}.md`);
}

function notiz(dir, kuerzel) {
  return readFileSync(notizPfad(dir, kuerzel), "utf-8");
}

/**
 * Die Namen der wartenden Notizen im Verzeichnis — leer, wenn keine wartet.
 * Ohne `.claude/` wartet nichts: Der Fall gehoert zu den Tests ohne Config-Datei.
 */
function wartende(dir) {
  if (!existsSync(join(dir, ".claude"))) return [];
  return readdirSync(join(dir, ".claude"))
    .filter((name) => name.startsWith("vorhaben-wartend-") && name.endsWith(".md"))
    .sort();
}

/** Das lokale Tagesdatum in der genannten Zone, als JJJJ-MM-TT. */
function tagIn(zone) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date());
}

// --- Der Ablageort ------------------------------------------------------------

test("[spec-2] die Notiz entsteht als wartende Datei, `specs/vorhaben/` bleibt unberuehrt", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "nein");

    assert.equal(existsSync(notizPfad(dir, "VER")), true,
      "die wartende Datei `.claude/vorhaben-wartend-VER.md` fehlt");
    assert.equal(existsSync(join(dir, "specs", "vorhaben")), false,
      "`vorhaben` hat unter `specs/vorhaben/` geschrieben — dorthin hebt erst `vorhaben-sichern` auf");
  });
});

test("[spec-2] ein zweiter Lauf zum selben Kuerzel ueberschreibt die wartende Datei", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "ja", "--grund", "X");
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "nein");

    assert.deepEqual(wartende(dir), ["vorhaben-wartend-VER.md"],
      "es darf genau eine wartende Notiz je Kuerzel geben, keine zweite daneben");
    assert.match(notiz(dir, "VER"), /^- Code gelesen: nein$/m,
      "der zweite Lauf hat die wartende Datei nicht ueberschrieben");
  });
});

// --- Die Einheit steht in der Datei -----------------------------------------

test("ein Vorhaben: die Notiz nennt die Einheit 'Vorhaben' und nicht 'Plandokument'", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "nein");

    const text = notiz(dir, "VER");
    assert.match(text, /^- Einheit: Vorhaben$/m, "die Einheit fehlt");
    assert.doesNotMatch(text, /^- Einheit: Plandokument$/m,
      "eine Vorhaben-Notiz darf sich nicht auch als Plandokument ausgeben");
    assert.match(text, /^- Kuerzel: VER$/m, "das Kuerzel fehlt");
  });
});

test("die Notiz eines Vorhabens hat genau die Form aus A15", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "ja", "--grund", "Bestandsverhalten geprueft");

    assert.equal(notiz(dir, "VER"), [
      "# Vorhaben-Notiz VER",
      "- Einheit: Vorhaben",
      "- Kuerzel: VER",
      "- Code gelesen: ja",
      "- Grund: Bestandsverhalten geprueft",
      `- Stand: ${tagIn(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      "",
    ].join("\n"));
  });
});

test("der Rueckfall (A9): Plandokument statt Vorhaben, mit Plannummer und festem Hinweis", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "plan-437", "--code-gelesen", "ja");

    const text = notiz(dir, "plan-437");
    assert.match(text, /^- Einheit: Plandokument$/m, "die Einheit fehlt");
    assert.doesNotMatch(text, /^- Einheit: Vorhaben$/m,
      "ein Rueckfall darf nicht als Vorhaben durchgehen");
    assert.match(text, /^- Plan: 437$/m, "die Plannummer fehlt");
    assert.doesNotMatch(text, /^- Kuerzel:/m, "im Rueckfall steht die Plannummer, kein Kuerzel");
    assert.ok(text.includes(HINWEIS), `der feste Hinweis fehlt:\n${text}`);
  });
});

test("ein Kuerzel wie 'PLAN' ist ein Vorhaben — Rueckfall ist genau 'plan-<N>'", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "PLAN", "--code-gelesen", "nein");

    const text = notiz(dir, "PLAN");
    assert.match(text, /^- Einheit: Vorhaben$/m,
      "ein Toolbox-Shortcode 'PLAN' ist ein Vorhaben, kein Rueckfall");
    assert.ok(!text.includes(HINWEIS), "der Rueckfall-Hinweis gehoert nicht in eine Vorhaben-Notiz");
  });
});

// --- Der Grund haengt allein am Aufruf ---------------------------------------

test("ohne --grund entfaellt die Grund-Zeile, auch wenn ein frueherer Aufruf eine hatte", () => {
  mitProjekt((dir) => {
    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "ja", "--grund", "X");
    assert.match(notiz(dir, "VER"), /^- Grund: X$/m, "die Grund-Zeile fehlt");

    vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "nein");

    const text = notiz(dir, "VER");
    assert.match(text, /^- Code gelesen: nein$/m, "der neue Wert steht nicht in der Datei");
    assert.doesNotMatch(text, /^- Grund:/m,
      "die Datei wird vollstaendig neu geschrieben — ein alter Grund darf nicht stehenbleiben");
  });
});

// --- Zwei gleiche Aufrufe, eine Datei ----------------------------------------

test("zwei Aufrufe mit denselben Argumenten am selben Tag erzeugen byte-gleiche Dateien", () => {
  mitProjekt((dir) => {
    const args = ["--kuerzel", "VER", "--code-gelesen", "ja", "--grund", "Bestand gelesen"];
    vorhaben(dir, ...args);
    const erster = notiz(dir, "VER");

    vorhaben(dir, ...args);

    assert.equal(notiz(dir, "VER"), erster, "der zweite Lauf hat die Datei veraendert");
    assert.deepEqual(wartende(dir), ["vorhaben-wartend-VER.md"],
      "es darf genau eine Notiz je Kuerzel geben, keine Dopplung");
  });
});

// --- Das Datum ist das lokale --------------------------------------------------

test("'- Stand:' traegt das lokale Tagesdatum, nicht das UTC-Datum", () => {
  // Zu jedem Zeitpunkt weicht mindestens eine der beiden Zonen vom UTC-Tag ab:
  // Kiritimati liegt 14 Stunden davor, Etc/GMT+12 zwoelf dahinter. Ein Test, der
  // eine feste Zone nimmt, waere die meiste Zeit des Tages blind.
  const utc = new Date().toISOString().slice(0, 10);
  const zone = ["Pacific/Kiritimati", "Etc/GMT+12"].find((z) => tagIn(z) !== utc);
  assert.ok(zone, "keine Zone gefunden, deren Tagesdatum vom UTC-Tag abweicht");

  mitProjekt((dir) => {
    const res = spawnSync(process.execPath, [SPEC, "vorhaben", "--kuerzel", "VER", "--code-gelesen", "ja"],
      { cwd: dir, encoding: "utf-8", env: { ...process.env, TZ: zone } });
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);

    const text = notiz(dir, "VER");
    assert.match(text, new RegExp(`^- Stand: ${tagIn(zone)}$`, "m"),
      `der Stand traegt nicht den lokalen Tag in ${zone}`);
    assert.doesNotMatch(text, new RegExp(`^- Stand: ${utc}$`, "m"),
      "der Stand traegt das UTC-Datum — eine Notiz um 23:30 gehoerte damit in den falschen Tag");
  });
});

// --- Fehlerpfade: rot und ohne Datei -----------------------------------------

for (const [name, args] of [
  ["fehlendes --kuerzel", ["--code-gelesen", "ja"]],
  ["ein Kuerzel mit Pfadanteil", ["--kuerzel", "../x", "--code-gelesen", "ja"]],
  ["fehlendes --code-gelesen", ["--kuerzel", "VER"]],
  ["ein anderer Wert als ja/nein", ["--kuerzel", "VER", "--code-gelesen", "vielleicht"]],
]) {
  test(`[spec-2] ${name}: Exit ungleich 0 und keine wartende Datei`, () => {
    mitProjekt((dir) => {
      const res = spec(dir, "vorhaben", ...args);

      assert.notEqual(res.status, 0, `der Lauf haette rot enden muessen, stdout: ${res.stdout}`);
      assert.notEqual(res.stderr.trim(), "", "der Fehler muss auf stderr stehen");
      assert.deepEqual(wartende(dir), [],
        "ein abgebrochener Lauf darf keine wartende Notiz hinterlassen");
    });
  });
}

test("[spec-2] ein Kuerzel mit Pfadanteil schreibt auch nicht neben die wartenden Notizen", () => {
  mitProjekt((dir) => {
    spec(dir, "vorhaben", "--kuerzel", "../../x", "--code-gelesen", "ja");

    // '.claude/vorhaben-wartend-../../x.md' faellt auf '.claude/x.md' zusammen —
    // das Praefix klebt am ersten '..' und macht es zu einem Verzeichnisnamen.
    assert.equal(existsSync(join(dir, ".claude", "x.md")), false,
      "das Kuerzel wurde zum Pfad und hat neben den wartenden Notizen geschrieben");
    assert.deepEqual(wartende(dir), [], "ein abgewiesenes Kuerzel darf keine Notiz hinterlassen");
  });
});

// --- Ohne Schalter passiert nichts -------------------------------------------

test("[spec-2] ohne 'spec'-Block: Hinweis auf stderr, Exit 0, keine wartende Notiz", () => {
  mitProjekt((dir) => {
    const res = spec(dir, "vorhaben", "--kuerzel", "VER", "--code-gelesen", "ja");

    assert.equal(res.status, 0, `ohne Block ist das kein Fehler: ${res.stderr}`);
    assert.match(res.stderr, /spec/, "der Hinweis nennt den fehlenden Block nicht");
    assert.deepEqual(wartende(dir), [], "ohne Block darf keine wartende Notiz entstehen");
    assert.equal(existsSync(join(dir, "specs")), false,
      "ohne Block darf kein Verzeichnis entstehen");
  }, { specBlock: null });
});

test("ohne Config-Datei: dasselbe, Exit 0 und keine Datei", () => {
  mitProjekt((dir) => {
    const res = spec(dir, "vorhaben", "--kuerzel", "VER", "--code-gelesen", "ja");

    assert.equal(res.status, 0, `ohne Config ist das kein Fehler: ${res.stderr}`);
    assert.deepEqual(wartende(dir), [], "ohne Config darf keine wartende Notiz entstehen");
    assert.equal(existsSync(join(dir, "specs")), false, "ohne Config darf kein Verzeichnis entstehen");
  }, { config: null });
});

test("ungueltiges JSON in der Config ist ein Fehler", () => {
  mitFixture(null, (dir) => {
    configSchreiben(dir, {});
    // configSchreiben legt .claude/ an; die Datei wird danach absichtlich zerbrochen.
    writeFileSync(join(dir, ".claude", "workflow.config.json"), "{ kaputt", "utf-8");

    const res = spec(dir, "vorhaben", "--kuerzel", "VER", "--code-gelesen", "ja");

    assert.equal(res.status, 1, "ungueltiges JSON haette rot enden muessen");
    assert.deepEqual(wartende(dir), [], "bei kaputter Config darf keine Notiz entstehen");
  });
});

// --- Die Erfolgsmeldung -------------------------------------------------------

test("[spec-2] stdout nennt den wartenden Pfad und das Aufheben, der zweite Lauf 'aktualisiert'", () => {
  // Zeichengleich: Der Satz ist die einzige Stelle, an der ein Mensch erfaehrt, dass
  // die Notiz noch nicht am Ziel liegt. Wer nur den Pfad sieht, haelt sie fuer abgelegt.
  mitProjekt((dir) => {
    const erst = vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "ja");
    assert.equal(erst.stdout,
      "Vorhaben-Notiz geschrieben: .claude/vorhaben-wartend-VER.md"
      + " — wird beim naechsten 'push main' nach specs/vorhaben/ aufgehoben.\n");

    const zweit = vorhaben(dir, "--kuerzel", "VER", "--code-gelesen", "ja");
    assert.equal(zweit.stdout,
      "Vorhaben-Notiz aktualisiert: .claude/vorhaben-wartend-VER.md"
      + " — wird beim naechsten 'push main' nach specs/vorhaben/ aufgehoben.\n");
  });
});
