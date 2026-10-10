// Ablauf-Pruefung: Ob ein englisches Projekt nur englische Meldungen des Installers sieht, belegt nur ein echter Prozess aus einer einzeln abgelegten install.mjs.
//
// Meldungen des Installers zweisprachig (Issue #1455, Plan #1420 E13, E14, E22).
//
// install.mjs traegt seine Texte in einer Tabelle `TEXTE = { de, en }` und gibt sie ueber den
// Texthelfer aus kit/board/namen.mjs aus, den es aus seinem eigenen Board-Blob laedt. Hier
// steht, was das Paket zusaetzlich zu den deutschen Wortlaut-Tests verlangt:
//
//   - Paritaet: je Sprache dieselben Schluessel und Platzhalter.
//   - Englische Stichproben: neues Projekt, bestehendes Projekt, Umstellung, Schutzmodus,
//     GitLab-Labels und das Commit-Gate.
//   - Ein englisches Projekt sieht ab der Sprachantwort keine deutsche Meldung.
//   - Vor der Antwort bleibt die Frage zweisprachig, bei unlesbarer Config spricht der
//     Installer deutsch (E22).
//
// Jeder Lauf startet eine Kopie von install.mjs, die allein in einem Wegwerf-Verzeichnis liegt:
// Der Installer wird allein verteilt und darf keinen weiteren Repo-Kontext brauchen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { TEXTE } from "../install.mjs";
import { pruefeParitaet } from "../kit/board/namen.mjs";

const QUELLE = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs");

/** Ein Wegwerf-Verzeichnis mit `verteilt/install.mjs` allein, einem leeren Projekt und HOME. */
function umgebung(praefix) {
  const wurzel = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  const verteilt = join(wurzel, "verteilt");
  const projekt = join(wurzel, "projekt");
  for (const d of [verteilt, projekt, join(wurzel, "home")]) mkdirSync(d, { recursive: true });
  copyFileSync(QUELLE, join(verteilt, "install.mjs"));
  return { wurzel, projekt, installer: join(verteilt, "install.mjs") };
}

function mitUmgebung(praefix, fn) {
  const u = umgebung(praefix);
  try {
    fn(u);
  } finally {
    rmSync(u.wurzel, { recursive: true, force: true });
  }
}

function installiere(u, argv, antworten = [], env = {}) {
  const res = spawnSync(process.execPath, [u.installer, ...argv], {
    cwd: u.projekt,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, KIT_INSTALL_TTY: "", HOME: join(u.wurzel, "home"), USERPROFILE: join(u.wurzel, "home"), ...env },
  });
  return { ...res, alles: `${res.stdout}\n${res.stderr}` };
}

function schreibeConfig(u, config) {
  mkdirSync(join(u.projekt, ".claude"), { recursive: true });
  writeFileSync(join(u.projekt, ".claude", "workflow.config.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2));
}

const lies = (u, name) => JSON.parse(readFileSync(join(u.projekt, ".claude", name), "utf-8"));

/**
 * Die festen Bruchstuecke der deutschen Texte, die im Englischen nicht vorkommen: Was davon in
 * einer Ausgabe steht, ist eine deutsche Meldung. Kurze Bruchstuecke sagen nichts ueber die
 * Sprache und bleiben aussen vor.
 */
function deutscheBruchstuecke() {
  const englisch = Object.values(TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

function keinDeutsch(ausgabe, wo) {
  const gefunden = deutscheBruchstuecke().filter((s) => ausgabe.includes(s));
  assert.deepEqual(gefunden, [], `deutsche Meldung in einem englischen Projekt (${wo})`);
}

/** Eine glab-Attrappe: Ready gibt es schon, Done scheitert, der Rest wird angelegt. */
function glabFake(u) {
  const skript = join(u.wurzel, "glab-fake.mjs");
  writeFileSync(skript, [
    'const name = process.argv[process.argv.indexOf("--name") + 1];',
    'if (name === "Ready") { console.error("label already exists"); process.exit(1); }',
    'if (name === "Done") { console.error("boom"); process.exit(1); }',
    "",
  ].join("\n"));
  return { INSTALL_GLAB_FAKE: skript };
}

test("[1455] die Texttabelle des Installers hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  assert.ok(Object.keys(TEXTE.de).length > 80, "die Tabelle traegt die Texte des Installers");
});

test("[1455] ein neues englisches Projekt: ab der Antwort spricht der Installer englisch", () => {
  mitUmgebung("install-en-neu-", (u) => {
    const res = installiere(u, [], ["en", "irgendwo", "project", "github", "y", "n", "github", "", "", "", "", "", "kaputt", ""]);
    assert.equal(res.status, 0, res.alles);
    assert.equal(lies(u, "workflow.config.json").language, "en");

    const nachAntwort = res.alles.slice(res.alles.indexOf("Sprache / Language [de/en] (de): en"));
    assert.match(nachAntwort, /This installer sets up the claude-workflow-kit skill library\./);
    assert.match(nachAntwort, /\[global\/project\]: /);
    assert.match(nachAntwort, /Please enter 'global' or 'project'\./);
    assert.match(nachAntwort, /Does the project have a build service \(GitHub Actions\)\? \[Y\/n\]: /);
    assert.match(nachAntwort, /Main and release branches stay unprotected/);
    assert.match(nachAntwort, / {2}Error: Please enter 'Name: pattern, pattern'\./);
    assert.match(nachAntwort, /✓ Config written: /);
    assert.match(nachAntwort, /=== Done ===/);
    assert.match(nachAntwort, /GitHub: make sure 'gh auth login' has been run\./);
    keinDeutsch(nachAntwort, "neues Projekt");
  });
});

test("[1455] vor der Antwort bleibt die Sprachfrage zweisprachig, eine deutsche Antwort spricht deutsch", () => {
  mitUmgebung("install-de-neu-", (u) => {
    const res = installiere(u, [], ["fr", "", "projekt", "local", "local", "", "", "", "", "", ""]);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.stderr, /Bitte 'de' oder 'en' eingeben\. \/ Please enter 'de' or 'en'\./);
    assert.match(res.stdout, /Dieser Installer richtet die claude-workflow-kit-Skill-Bibliothek ein\./);
    assert.match(res.stdout, /✓ Config geschrieben: /);
  });
});

test("[1455] ein bestehendes englisches Projekt: GitLab-Labels, Gate und Hinweise englisch", () => {
  mitUmgebung("install-en-bestand-", (u) => {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: u.projekt }).status, 0, "git init");
    schreibeConfig(u, { language: "en", codeHost: "gitlab", issueTracker: "gitlab", reviewCommand: "x", reviewModel: "claude-opus-5-5", spec: {} });
    writeFileSync(join(u.projekt, ".gitignore"), ".claude/\n");
    const res = installiere(u, [], ["project", "gitlab", "nope", "gitlab", "", "", "", "", "-", "y", "", "y"], glabFake(u));
    assert.notEqual(res.status, 0, "ein falscher Tracker bricht im Pipe-Modus ab");
    assert.match(res.stderr, / {2}Error: issueTracker must be 'github', 'gitlab' or 'local'\./);
    keinDeutsch(res.alles, "Abbruch an der Tracker-Frage");

    const ok = installiere(u, [], ["project", "gitlab", "gitlab", "", "", "", "", "", "y", "", "y"], glabFake(u));
    assert.equal(ok.status, 0, ok.alles);
    assert.match(ok.stdout, /Existing workflow\.config\.json found/);
    assert.match(ok.stdout, /This config carries both reviewers/);
    assert.match(ok.stdout, /GitLab does not set up protection of the main branch yet/);
    assert.match(ok.stdout, /Hook the commit gate in\? \[y\/N\]: y/);
    assert.match(ok.stdout, /✓ core\.hooksPath set to \.githooks — the commit gate is active\./);
    assert.match(ok.stdout, /✓ \.gitignore: '\.claude\/' replaced by the block/);
    assert.match(ok.stdout, /Note: the spec block is no longer evaluated/);
    assert.match(ok.stdout, /~ Ready \(already exists\)/);
    assert.match(ok.stderr, /✗ Done: boom/);
    assert.match(ok.stdout, /Board columns cannot be created via CLI/);
    keinDeutsch(ok.alles, "bestehendes Projekt");
    assert.match(readFileSync(join(u.projekt, ".gitignore"), "utf-8"), /^# claude-workflow-kit \(Issue #208\): workflow\.config\.json belongs in the repo,$/m);
  });
});

test("[1455] Umstellung und Schutzmodus eines englischen Projekts melden englisch", () => {
  mitUmgebung("install-en-umstellung-", (u) => {
    const falsch = installiere(u, ["--language", "fr"]);
    assert.equal(falsch.status, 1);
    assert.match(falsch.stderr, /--language braucht 'de' oder 'en', nicht 'fr'\./, "ohne Config spricht der Installer deutsch");

    schreibeConfig(u, { language: "en", codeHost: "github", issueTracker: "github" });
    const schutz = installiere(u, ["--schutz"]);
    assert.equal(schutz.status, 1);
    assert.match(schutz.stdout, /=== claude-workflow-kit: protection of the main branch ===/);
    assert.match(schutz.stderr, /^Error: The installed board\.mjs does not know `code schutz` yet/m);
    keinDeutsch(schutz.alles, "Schutzmodus");

    const unbekannt = installiere(u, ["--language", "fr"]);
    assert.match(unbekannt.stderr, /--language takes 'de' or 'en', not 'fr'\./);

    const boardFake = join(u.wurzel, "board-fake.mjs");
    writeFileSync(boardFake, 'console.error("gh: not logged in"); process.exit(1);\n');
    const um = installiere(u, ["--language", "de"], [], { INSTALL_BOARD_FAKE: boardFake });
    assert.equal(um.status, 0, um.alles);
    assert.equal(lies(u, "workflow.config.json").sprache, "de");
    assert.match(um.stdout, /=== claude-workflow-kit: switching to de ===/);
    assert.match(um.stdout, /✓ Backup created: /);
    assert.match(um.stdout, /Board not reachable \(gh: not logged in\)/);
    assert.match(um.stdout, /Back: node install\.mjs --language en/);
    keinDeutsch(um.alles, "Umstellung");
  });
});

test("[1455] bei unlesbarer Config spricht der Installer deutsch", () => {
  mitUmgebung("install-kaputt-", (u) => {
    schreibeConfig(u, "{ kaputt");
    const res = installiere(u, [], ["projekt", "local", "local", "", "", "", "", "", ""]);
    assert.equal(res.status, 0, res.alles);
    assert.match(res.stderr, /Hinweis: Bestehende workflow\.config\.json konnte nicht gelesen werden\./);
    assert.match(res.stdout, /=== Fertig ===/);
  });
});
