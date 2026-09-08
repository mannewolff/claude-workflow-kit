// Auslieferung und Einhaengen des Commit-Gates (Issue #473, Plan #467 A2/A11).
//
// Der Hook wandert mit dem Clone, die Aktivierung nicht: `core.hooksPath` ist lokale
// git-Config. Die Frage steht deshalb nur dort, wo sie etwas bewirkt — und
// verbraucht sonst KEINE Antwortzeile: Im Pipe-Modus schoebe jede ungefragte Frage
// alle folgenden Antworten.
//
// Die Fixtures setzen GIT_CONFIG_GLOBAL und GIT_CONFIG_NOSYSTEM, sonst laesen die
// Tests die echte globale Config des Entwicklers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, chmodSync,
  rmSync, existsSync, statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows kennt kein x-Bit; die Ausfuehrbarkeit ist dort nicht messbar." }
  : {};

// Ein haengender Symlink braucht unter Windows das Entwicklerprivileg SeCreateSymbolicLink;
// ohne das wirft symlinkSync EPERM, und der Test schluege aus einem Grund fehl, der nichts
// mit dem geprueften Verhalten zu tun hat. Der Grund steht im Skip-Text, damit ein
// ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX_SYMLINK = process.platform === "win32"
  ? { skip: "Windows: symlinkSync braucht dort ein Privileg, das der CI-Runner nicht sicher hat." }
  : {};

// Dasselbe Hindernis wie in test/install-gitlab-labels.test.mjs: Das Fake-CLI ist ein
// sh-Wrapper und laege unter Windows als .cmd im PATH; Node wirft dafuer EINVAL ohne
// shell:true (CVE-2024-27980), und install.mjs startet seit #198 bewusst ohne Shell.
const NUR_POSIX_FAKE = process.platform === "win32"
  ? { skip: "Windows: der sh-Wrapper des Fake-git ist dort nicht startbar. Siehe Issue #197." }
  : {};

// Woertlich so, wie sie im Installer steht.
const FRAGE = "Soll das Commit-Gate eingehaengt werden?";

function fixture(praefix, { mitGit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  if (mitGit) {
    for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"]]) {
      assert.equal(git(dir, ...a).status, 0);
    }
  }
  return dir;
}

function git(dir, ...args) {
  return spawnSync("git", args, {
    cwd: dir, encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" },
  });
}

function installiere(dir, antworten, extraEnv = {}, nodeArgs = []) {
  return spawnSync(process.execPath, [...nodeArgs, INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
      ...extraEnv,
    },
  });
}

/**
 * Ein `git` im PATH, das einzelne Aufrufe abfaengt und alle uebrigen an das echte git
 * durchreicht (Weg 1 aus Issue #188). Gebraucht fuer die zwei Antworten, die kein
 * Dateisystem-Fixture herstellt: ein Fehlschlag OHNE Fehlertext und ein Erfolg OHNE
 * Ausgabe. `sonderfaelle` sind sh-Zeilen, die vor dem Durchreichen laufen.
 *
 * Rueckgabe ist das Verzeichnis, das in den PATH von `installiere` gehoert — der Helper
 * `git()` bleibt aussen vor und prueft weiter mit dem echten git. Das Fake ruft das echte
 * git ueber einen absoluten Pfad, ein PATH aus nur diesem Verzeichnis genuegt ihm also.
 */
function fakeGit(dir, ...sonderfaelle) {
  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const echtesGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
  assert.ok(echtesGit, "ohne echtes git im PATH ist das Fixture nicht baubar");
  // Eigener PATH fuer die Sonderfall-Zeilen: Ein Test darf den PATH des Installers auf
  // dieses Verzeichnis beschraenken, und dann faende der Wrapper sonst nicht einmal `rm`.
  // Auf das echte git wirkt das nicht — es wird mit absolutem Pfad gerufen.
  const wrapper = [
    "#!/bin/sh",
    "PATH=/usr/bin:/bin",
    ...sonderfaelle,
    `exec ${JSON.stringify(echtesGit)} "$@"`,
    "",
  ].join("\n");
  writeFileSync(join(binDir, "git"), wrapper, "utf-8");
  chmodSync(join(binDir, "git"), 0o755);
  return binDir;
}

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand, Spec-Frage — und an zehnter Stelle die Hook-Frage.
const antworten = (spec, hook) => ["projekt", "github", "toolbox", "", "", "", "", "", spec, hook];

function hooksPath(dir) {
  const res = git(dir, "config", "--get", "core.hooksPath");
  return res.status === 0 ? res.stdout.trim() : null;
}

function mitFixture(praefix, fn, optionen = {}) {
  const dir = fixture(praefix, optionen);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("[installer-2] bei Zustimmung liegen Hook und Gate, und core.hooksPath steht auf .githooks", () => {
  mitFixture("install-gate-ja-", (dir) => {
    const res = installiere(dir, antworten("n", "j"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(join(dir, ".githooks", "gate.mjs")), "gate.mjs fehlt");
    assert.ok(existsSync(join(dir, ".githooks", "pre-commit")), "pre-commit fehlt");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] das ausgelieferte gate.mjs ist bytegleich zum Blob", () => {
  mitFixture("install-gate-byte-", (dir) => {
    installiere(dir, antworten("n", "j"));
    assert.equal(
      readFileSync(join(dir, ".githooks", "gate.mjs"), "utf-8"),
      readFileSync(join(repoRoot, ".githooks", "gate.mjs"), "utf-8"),
      "das ausgelieferte Gate weicht von der Quelle ab",
    );
  });
});

test("[installer-2] das ausgelieferte gate.mjs laeuft im Zielprojekt ohne Import-Fehler", () => {
  // Der Nachweis, dass die Pfadaufloesung aus Issue #470 dort greift, wo checks.mjs
  // unter .claude/kit/ liegt — ein statischer Import auf ../kit/ waere hier rot.
  mitFixture("install-gate-import-", (dir) => {
    installiere(dir, antworten("n", "j"));
    const res = spawnSync(process.execPath, [join(dir, ".githooks", "gate.mjs"), "pre-commit"], {
      cwd: dir, encoding: "utf-8",
    });
    assert.doesNotMatch(`${res.stderr}`, /Cannot find module|ERR_MODULE_NOT_FOUND/,
      `das Gate fand sein checks.mjs nicht: ${res.stderr}`);
  });
});

test("[installer-2] pre-commit ist ausfuehrbar", NUR_POSIX, () => {
  mitFixture("install-gate-x-", (dir) => {
    installiere(dir, antworten("n", "j"));
    const mode = statSync(join(dir, ".githooks", "pre-commit")).mode;
    assert.equal((mode & 0o111) !== 0, true, "der Hook muss ausfuehrbar sein");
  });
});

// Der Modus, den der Load-Hook unten einsetzt: Node uebersetzt ihn mit parseInt(…, 8)
// und bekommt NaN, also wirft chmodSync. Genau FUENF Zeichen wie das ersetzte `0o755` —
// siehe die Begruendung zur Laengentreue in mitWerfendemChmod.
const CHMOD_ORIGINAL = "chmodSync(hookTarget, 0o755)";
const CHMOD_WERFEND = 'chmodSync(hookTarget, "xxx")';

/**
 * Legt das Vorschaltmodul an, das dem Installer ein scheiterndes `chmodSync` unterschiebt,
 * und liefert das Node-Argument dafuer.
 *
 * Ein blosses `fs.chmodSync = …` genuegt NICHT: install.mjs holt sich die Funktion als
 * Named Import aus `node:fs`, und diese Bindung geht ein Monkey-Patch am Modulobjekt
 * nicht mit — die erste Fassung dieses Tests war deshalb gruen, ohne den Rueckfall je zu
 * betreten. Ersetzt wird darum der Aufruf selbst, ueber einen Load-Hook auf install.mjs.
 *
 * Die Ersetzung ist ZEICHENGENAU gleich lang. Die Abdeckung wird ueber V8-Byte-Offsets
 * gefuehrt und ueber alle Prozesse unter derselben URL zusammengelegt; eine laengere
 * Quelle verschoebe jeden Offset dahinter, und install.mjs faellt im Bericht von 100 %
 * auf 83 % — gemessen mit einer ersten Fassung, die den Import umbog.
 */
function mitWerfendemChmod(dir) {
  const hook = join(dir, "chmod-umbiegen.mjs");
  const setup = join(dir, "hook-anmelden.mjs");

  writeFileSync(hook, [
    "let ziel;",
    "export function initialize(data) { ziel = data.ziel; }",
    "export async function load(url, context, nextLoad) {",
    "  if (url !== ziel) return nextLoad(url, context);",
    "  const geladen = await nextLoad(url, context);",
    "  const quelle = geladen.source.toString();",
    `  const neu = quelle.replace(${JSON.stringify(CHMOD_ORIGINAL)}, ${JSON.stringify(CHMOD_WERFEND)});`,
    // Lieber laut scheitern als still den normalen Pfad messen: Aendert sich der Aufruf
    // eines Tages, soll der Test rot werden und nicht scheingruen bleiben.
    '  if (neu === quelle) throw new Error("Vorschaltmodul: der chmod-Aufruf steht so nicht mehr in install.mjs");',
    '  return { format: "module", shortCircuit: true, source: neu };',
    "}",
    "",
  ].join("\n"), "utf-8");

  writeFileSync(setup, [
    'import { register } from "node:module";',
    `register(${JSON.stringify(pathToFileURL(hook).href)}, {`,
    "  parentURL: import.meta.url,",
    `  data: { ziel: ${JSON.stringify(pathToFileURL(INSTALLER).href)} },`,
    "});",
    "",
  ].join("\n"), "utf-8");

  return `--import=${pathToFileURL(setup).href}`;
}

// Die Gegenprobe zum Test darueber: Auf Windows gibt es kein x-Bit, und chmod kann dort
// scheitern. Der Hook ist deswegen nicht weniger geschrieben — ein Abbruch an dieser
// Stelle liesse den Installer auf einer ganzen Plattform rot enden. Ein echtes Fixture
// gibt es fuer den Fall nicht: Auf POSIX gelingt chmod im eigenen Temp-Verzeichnis
// immer, also wird der Fehlschlag untergeschoben.
test("ein scheiterndes chmod haelt den Installer nicht auf (Windows-Rueckfall)", NUR_POSIX, () => {
  mitFixture("install-gate-chmod-", (dir) => {
    const res = installiere(dir, antworten("n", "j"), {}, [mitWerfendemChmod(dir)]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /✓ pre-commit geschrieben/, "der Hook gilt trotzdem als geschrieben");

    // Das fehlende x-Bit ist der Beleg, dass der Rueckfall wirklich betreten wurde:
    // Waere der Aufruf durchgelaufen, stuende hier 0o755 wie im Test darueber. Ohne
    // diese Zeile bestuende der Test auch dann, wenn die Ersetzung gar nicht griffe.
    const hookDatei = join(dir, ".githooks", "pre-commit");
    assert.ok(existsSync(hookDatei), "und er liegt auch wirklich da");
    assert.equal(statSync(hookDatei).mode & 0o111, 0, "ohne chmod darf kein x-Bit gesetzt sein");
  });
});

test("[installer-2] bei Ablehnung liegen die Dateien, core.hooksPath bleibt leer", () => {
  mitFixture("install-gate-nein-", (dir) => {
    const res = installiere(dir, antworten("n", "n"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(existsSync(join(dir, ".githooks", "gate.mjs")), "die Dateien gehoeren trotzdem geschrieben");
    assert.equal(hooksPath(dir), null);
  });
});

test("[installer-2] ein belegter core.hooksPath bleibt unveraendert und verbraucht keine Antwortzeile", () => {
  mitFixture("install-gate-belegt-", (dir) => {
    assert.equal(git(dir, "config", "core.hooksPath", ".husky").status, 0);
    // Eine Antwort WENIGER: Wird die Frage doch gestellt, fehlt eine Zeile und der
    // Lauf endet rot — genau das soll der Test fangen.
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(hooksPath(dir), ".husky", "ein fremder hooksPath darf nicht ueberschrieben werden");
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE), "bei belegtem Wert wird nicht gefragt");
    assert.match(res.stdout, /\.husky/, "der gefundene Wert gehoert gemeldet");
  });
});

test("[installer-2] ein frisches Repo mit nur *.sample-Dateien gilt als frei", () => {
  mitFixture("install-gate-sample-", (dir) => {
    const res = installiere(dir, antworten("n", "j"));
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

// --- Was im Hooks-Verzeichnis als "aktive Datei" zaehlt (Issue #503) ---------
//
// `aktiverHookVorhanden` entscheidet, ob der Installer ueberhaupt fragt. Bisher war nur
// der Weg geprueft, auf dem dort ausschliesslich *.sample-Dateien liegen. Die drei
// Faelle darunter sind die uebrigen Ausgaenge derselben Funktion.

const hooksDir = (dir) => join(dir, ".git", "hooks");

test("[installer-2] eine aktive Datei im Hooks-Verzeichnis gilt als belegt", () => {
  mitFixture("install-gate-aktivedatei-", (dir) => {
    // Kein *.sample: ein echter, vom Projekt gepflegter Hook. Der Installer darf dann
    // nicht fragen — ein gesetzter core.hooksPath schaltete diesen Hook stillschweigend ab.
    writeFileSync(join(hooksDir(dir), "pre-push"), "#!/bin/sh\nexit 0\n", "utf-8");
    // Eine Antwort WENIGER: Wird doch gefragt, fehlt eine Zeile und der Lauf endet rot.
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE), "bei aktivem Hook wird nicht gefragt");
    assert.match(res.stdout, /aktive Datei im Hooks-Verzeichnis/, "der Grund gehoert gemeldet");
    assert.equal(hooksPath(dir), null, "core.hooksPath darf ungesetzt bleiben");
  });
});

test("[installer-2] ein Unterverzeichnis im Hooks-Verzeichnis ist keine aktive Datei", () => {
  mitFixture("install-gate-unterordner-", (dir) => {
    // Ein Verzeichnis fuehrt keinen Hook aus. Zaehlte es als belegt, entfiele die Frage
    // in jedem Repo, das dort etwas ablegt.
    mkdirSync(join(hooksDir(dir), "abgelegt"), { recursive: true });
    const res = installiere(dir, antworten("n", "j"));

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] ein haengender Symlink im Hooks-Verzeichnis kippt die Pruefung nicht", NUR_POSIX_SYMLINK, () => {
  mitFixture("install-gate-symlink-", (dir) => {
    // statSync folgt dem Link und wirft. Ohne den abgefangenen Fehler brach der
    // Installer hier ab, statt die Frage zu stellen.
    symlinkSync(join(dir, "gibt-es-nicht"), join(hooksDir(dir), "pre-push"));
    const res = installiere(dir, antworten("n", "j"));

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] ein fehlendes Hooks-Verzeichnis gilt als frei", () => {
  mitFixture("install-gate-ohnehooks-", (dir) => {
    // `git rev-parse --git-path hooks` nennt den Pfad auch dann, wenn dort nichts liegt.
    rmSync(hooksDir(dir), { recursive: true, force: true });
    const res = installiere(dir, antworten("n", "j"));

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

// --- Die Antworten auf die Gate-Frage (Issue #503) ---------------------------

test("[installer-2] eine leere Antwort lehnt ab — der Default ist Nein", () => {
  mitFixture("install-gate-enter-", (dir) => {
    // Die Frage steht als "[j/N]"; Enter muss deshalb ablehnen und nicht setzen.
    const res = installiere(dir, antworten("n", ""));

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(hooksPath(dir), null, "Enter darf core.hooksPath nicht setzen");
    assert.ok(existsSync(join(dir, ".githooks", "pre-commit")), "die Dateien gehoeren trotzdem geschrieben");
  });
});

test("[installer-2] 'nein' lehnt ab, 'ja' stimmt zu — beide Langformen gelten", () => {
  mitFixture("install-gate-nein-lang-", (dir) => {
    const res = installiere(dir, antworten("n", "nein"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(hooksPath(dir), null, "'nein' darf core.hooksPath nicht setzen");
  });
  mitFixture("install-gate-ja-lang-", (dir) => {
    const res = installiere(dir, antworten("n", "ja"));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(hooksPath(dir), ".githooks", "'ja' haette setzen muessen");
  });
});

test("[installer-2] eine ungueltige Antwort bricht im Pipe-Modus ab, statt weiterzuraten", () => {
  mitFixture("install-gate-ungueltig-", (dir) => {
    // Interaktiv wird nachgefragt; gepipt antwortet niemand nach. Weiterlaufen hiesse,
    // die naechste Antwortzeile als Antwort auf diese Frage zu verbrauchen.
    const res = installiere(dir, antworten("n", "x"));

    assert.notEqual(res.status, 0, "eine ungueltige Antwort darf nicht gruen enden");
    assert.match(res.stderr, /Bitte 'j' oder 'n' eingeben\./, "die Meldung nennt die gueltigen Antworten");
    assert.match(res.stderr, /Validation failed in non-interactive mode/, "der Abbruchgrund gehoert genannt");
    assert.equal(hooksPath(dir), null);
  });
});

test("[installer-2] scheitert das Setzen von core.hooksPath, endet der Lauf rot und sagt warum", () => {
  mitFixture("install-gate-setzen-rot-", (dir) => {
    // git schreibt die Config ueber eine Lock-Datei und legt sie mit O_EXCL an. Ist der
    // Name schon belegt, scheitert genau das Schreiben — Lesen bleibt unberuehrt, die
    // Lage gilt also weiter als frei und die Frage wird gestellt. Kein Rechtetrick und
    // kein Fake-git: der Weg greift auch als root und auch unter Windows.
    mkdirSync(join(dir, ".git", "config.lock"), { recursive: true });
    const res = installiere(dir, antworten("n", "j"));

    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.notEqual(res.status, 0, "ein nicht gesetztes Gate darf nicht gruen gemeldet werden");
    assert.match(res.stderr, /core\.hooksPath liess sich nicht setzen/, "die Meldung nennt die Ursache");
    assert.ok(existsSync(join(dir, ".githooks", "pre-commit")),
      "die Dateien gehoeren geschrieben, auch wenn das Einhaengen scheitert");
  });
});

test("[installer-2] scheitert git stumm, meldet der Installer trotzdem einen Grund", NUR_POSIX_FAKE, () => {
  mitFixture("install-gate-stumm-", (dir) => {
    // Ohne Fehlertext bliebe von der Meldung "…liess sich nicht setzen: undefined"
    // uebrig. Der Test haelt fest, dass die Meldung dann leer endet statt zu raten.
    const binDir = fakeGit(dir, 'if [ "$1" = "config" ] && [ "$2" = "core.hooksPath" ]; then exit 1; fi');
    const res = installiere(dir, antworten("n", "j"), { PATH: `${binDir}:${process.env.PATH}` });

    assert.notEqual(res.status, 0, "ein nicht gesetztes Gate darf nicht gruen gemeldet werden");
    assert.match(res.stderr, /core\.hooksPath liess sich nicht setzen/);
    assert.doesNotMatch(res.stderr, /undefined/, "ein fehlender Fehlertext darf nicht als 'undefined' erscheinen");
  });
});

test("[installer-2] laesst git sich gar nicht mehr starten, nennt die Meldung den Startfehler", NUR_POSIX_FAKE, () => {
  mitFixture("install-gate-weg-", (dir) => {
    // Der letzte git-Aufruf des Laufs ist das Setzen von core.hooksPath. Loescht sich das
    // Fake beim vorletzten Aufruf, findet spawnSync fuer diesen einen Aufruf gar kein
    // git mehr und liefert `error` statt `stderr` — ohne den Rueckgriff darauf bliebe von
    // der Meldung nur ein leerer Grund uebrig. Der PATH enthaelt deshalb NUR das Fixture:
    // sonst uebernaehme das echte git aus dem PATH den Aufruf.
    const eigenerPfad = JSON.stringify(join(dir, "fakebin", "git"));
    const binDir = fakeGit(
      dir,
      `if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then rm -f ${eigenerPfad}; fi`,
    );
    const res = installiere(dir, antworten("n", "j"), { PATH: binDir });

    assert.notEqual(res.status, 0, "ein nicht gesetztes Gate darf nicht gruen gemeldet werden");
    assert.match(res.stderr, /core\.hooksPath liess sich nicht setzen/);
    assert.match(res.stderr, /ENOENT|spawnSync/i, "der Startfehler gehoert in die Meldung");
  });
});

test("[installer-2] antwortet git ohne Ausgabe, gilt das Hooks-Verzeichnis als unbekannt", NUR_POSIX_FAKE, () => {
  mitFixture("install-gate-leer-", (dir) => {
    // `git rev-parse --git-path hooks` nennt sonst immer einen Pfad. Bleibt die Antwort
    // leer — etwa hinter einem fremden git-Wrapper —, darf der Installer daraus keinen
    // Pfad basteln: Ohne Pfad ist keine aktive Datei feststellbar, die Lage gilt als frei.
    const binDir = fakeGit(dir, 'if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then exit 0; fi');
    const res = installiere(dir, antworten("n", "j"), { PATH: `${binDir}:${process.env.PATH}` });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(FRAGE), "die Frage haette gestellt werden muessen");
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] ein fremdes .githooks/pre-commit bleibt bytegleich erhalten", () => {
  mitFixture("install-gate-fremd-", (dir) => {
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    const fremd = "#!/bin/sh\n# husky\nexit 0\n";
    writeFileSync(join(dir, ".githooks", "pre-commit"), fremd, "utf-8");
    const res = installiere(dir, antworten("n", "j"));
    assert.equal(readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8"), fremd,
      "ein fremder Hook darf nicht ueberschrieben werden");
    assert.match(res.stdout, /stammt nicht aus diesem Kit/);
  });
});

test("[installer-2] ausserhalb eines Git-Repos entfaellt die Frage, der Lauf endet gruen", () => {
  mitFixture("install-gate-ohnegit-", (dir) => {
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
    assert.match(res.stdout, /kein Git-Repo|git nicht gefunden/);
  }, { mitGit: false });
});

test("[installer-2] im Update-Modus mit gesetztem .githooks entfaellt die Frage", () => {
  mitFixture("install-gate-update-", (dir) => {
    assert.equal(git(dir, "config", "core.hooksPath", ".githooks").status, 0);
    const res = installiere(dir, ["projekt", "github", "toolbox", "", "", "", "", "", "n"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
    assert.equal(hooksPath(dir), ".githooks");
  });
});

test("[installer-2] bei globalem Install wird nichts nach .githooks geschrieben", () => {
  mitFixture("install-gate-global-", (dir) => {
    const res = installiere(dir, ["global", "github", "toolbox", "", "", "", "", "", ""]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(existsSync(join(dir, ".githooks")), false);
    assert.doesNotMatch(res.stdout, new RegExp(FRAGE));
  });
});

test("[installer-2] gate.mjs steht nicht in STAMPED und wird nicht nach .claude/kit/ kopiert", () => {
  const sync = readFileSync(join(repoRoot, "tools", "sync-blobs.mjs"), "utf-8");
  const stamped = sync.slice(sync.indexOf("const STAMPED"), sync.indexOf("\n", sync.indexOf("const STAMPED")));
  assert.doesNotMatch(stamped, /gate\.mjs/, "das Gate gehoert nicht in die Dogfooding-Kopie");
  assert.equal(existsSync(join(repoRoot, ".claude", "kit", "gate.mjs")), false);
});
