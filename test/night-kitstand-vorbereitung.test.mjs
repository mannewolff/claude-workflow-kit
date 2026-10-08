// Die vorbereitete Veroeffentlichung (Issue #1246, Plan #1243, A5, A6, E10, E11, E15, E17),
// im selben Prozess gegen den Teil kit/night/kitstand.mjs. Git laeuft echt an einem
// Wegwerf-Repo — Referenzen und Commit-Hashes sind das, was hier belegt wird —, den Weg
// der Push-Stufe (`checks.mjs plan --stufe push`) sagt die eingesetzte Abhaengigkeit
// `pushWeg` (Plan #1199, E6).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lfAttribute } from "./helpers/zeilenenden.mjs";
import { vorbereitungFesthalten, vorbereitungPruefen, kitstandAbhaengigkeiten } from "../kit/night/kitstand.mjs";

const DATEI = join(".claude", "push-vorbereitung.json");
const REFERENZ = "refs/kit/push-vorbereitet";
const JETZT = new Date("2026-10-07T02:30:00.000Z");

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function commit(cwd, datei, inhalt, betreff) {
  writeFileSync(join(cwd, datei), inhalt);
  git(cwd, "add", datei);
  git(cwd, "commit", "-q", "-m", betreff);
  return git(cwd, "rev-parse", "HEAD");
}

/**
 * Ein Repo, dessen `origin/main` zwei Pakete hinter `main` steht, und ein Worktree darauf,
 * der den Release-Commit `chore: v1.2.3` traegt. `releasing: false` laesst `RELEASING.md`
 * und den Release-Commit weg (E15).
 */
function setup({ releasing = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "vorbereitung-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.invalid");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, ".gitignore"), ".claude/*\n");
  if (releasing) writeFileSync(join(repo, "RELEASING.md"), "# Release\n");
  lfAttribute(join(repo, ".gitattributes"));
  git(repo, "add", "-A");
  const origin = commit(repo, "a.txt", "a\n", "Anfang");
  git(repo, "update-ref", "refs/remotes/origin/main", origin);
  commit(repo, "b.txt", "b\n", "Paket eins (Issue #11)");
  commit(repo, "c.txt", "c\n", "Kleinigkeit ohne Karte");
  const basis = commit(repo, "d.txt", "d\n", "Paket zwei (Issue #12)");

  const pfad = join(mkdtempSync(join(tmpdir(), "vorbereitung-wt-")), "wt");
  git(repo, "worktree", "add", "-q", "--detach", pfad, "main");
  const vorbereitet = releasing ? commit(pfad, "CHANGELOG.md", "1.2.3\n", "chore: v1.2.3") : basis;
  return { repo, pfad, origin, basis, vorbereitet };
}

/** Die Zusammenfassung eines Laufs im Worktree. */
function zusammenfassung(pfad, felder = {}) {
  mkdirSync(join(pfad, ".claude"), { recursive: true });
  const daten = {
    stufe: "push",
    abgeschlossen: true,
    laufen: [{ cmd: "npm test", ergebnis: "gruen" }],
    ...felder,
  };
  writeFileSync(join(pfad, ".claude", "checks-summary.json"), JSON.stringify(daten));
}

function rot(pfad, verursacher) {
  zusammenfassung(pfad, { laufen: [{ cmd: "npm test", ergebnis: "rot" }], verursacher });
}

function festhalten(s, optionen = {}) {
  return vorbereitungFesthalten({ repoRoot: s.repo, pfad: s.pfad, ergebnis: "gruen", env: {}, ...optionen });
}

function gelesen(s) {
  return JSON.parse(readFileSync(join(s.repo, DATEI), "utf-8"));
}

kitstandAbhaengigkeiten({ jetzt: () => JETZT, pushWeg: () => "lokal" });
afterEach(() => kitstandAbhaengigkeiten({ jetzt: () => JETZT, pushWeg: () => "lokal" }));

test("festhalten schreibt die Datei, setzt die Referenz und nennt die Pakete aus den Betreffen", () => {
  const s = setup();
  zusammenfassung(s.pfad);
  const ergebnis = festhalten(s);

  const datei = gelesen(s);
  assert.deepEqual(ergebnis, datei);
  assert.equal(datei.ergebnis, "gruen");
  assert.equal(datei.commit, s.vorbereitet);
  assert.equal(datei.basis, s.basis);
  assert.equal(datei.origin, s.origin);
  assert.equal(datei.version, "1.2.3");
  assert.equal(datei.releaseDateien, true);
  assert.deepEqual(datei.offen, []);
  assert.deepEqual(datei.pakete, ["11", "12"]);
  assert.equal(datei.rot, null);
  assert.equal(datei.fetch, "ok");
  assert.equal(datei.zeitpunkt, JETZT.toISOString());
  assert.equal(git(s.repo, "rev-parse", REFERENZ), s.vorbereitet);
});

test("festhalten liest laufId und kitStand aus KIT_NIGHT_RUN und KIT_STAND", () => {
  const s = setup();
  zusammenfassung(s.pfad);
  festhalten(s, { env: { KIT_NIGHT_RUN: "2026-10-07T01:00:00.000Z", KIT_STAND: "abc123" } });
  const datei = gelesen(s);
  assert.equal(datei.laufId, "2026-10-07T01:00:00.000Z");
  assert.equal(datei.kitStand, "abc123");

  festhalten(s);
  assert.equal(gelesen(s).laufId, null);
  assert.equal(gelesen(s).kitStand, null);
});

test("festhalten haelt einen gescheiterten Fetch fest", () => {
  const s = setup();
  zusammenfassung(s.pfad);
  festhalten(s, { fetch: "fehlgeschlagen" });
  assert.equal(gelesen(s).fetch, "fehlgeschlagen");
});

test("festhalten mit offenen Punkten ergibt gruen-offen", () => {
  const s = setup();
  zusammenfassung(s.pfad);
  festhalten(s, { ergebnis: "gruen-offen", offen: ["Sichtpruefung der Oberflaeche"] });
  const datei = gelesen(s);
  assert.equal(datei.ergebnis, "gruen-offen");
  assert.deepEqual(datei.offen, ["Sichtpruefung der Oberflaeche"]);
});

test("ein rotes Ergebnis nennt die rote Pruefung und die Verursacher-Karten", () => {
  const s = setup();
  rot(s.pfad, [{ cmd: "npm test", karten: [{ karte: "12", shas: ["abc"] }] }]);
  festhalten(s, { ergebnis: "rot" });
  const datei = gelesen(s);
  assert.equal(datei.ergebnis, "rot");
  assert.deepEqual(datei.rot, { pruefung: "npm test", karten: ["12"], hinweis: null });
});

test("rot mit hinweis statt karten nennt alle Pakete und den Text (E11)", () => {
  const s = setup();
  const hinweis = "Keine abgeschlossene Karte seit abc beruehrt diese Pruefung.";
  rot(s.pfad, [{ cmd: "npm test", hinweis }]);
  festhalten(s, { ergebnis: "rot" });
  assert.deepEqual(gelesen(s).rot, { pruefung: "npm test", karten: ["11", "12"], hinweis });
});

test("ein abweichendes Ergebnis wird von der Zusammenfassung ueberstimmt und vermerkt", () => {
  const s = setup();
  rot(s.pfad, [{ cmd: "npm test", karten: [{ karte: "11", shas: ["abc"] }] }]);
  festhalten(s, { ergebnis: "gruen" });
  const datei = gelesen(s);
  assert.equal(datei.ergebnis, "rot");
  assert.equal(datei.abweichung, "uebergeben gruen, Zusammenfassung rot — es gilt die Zusammenfassung");

  zusammenfassung(s.pfad);
  festhalten(s, { ergebnis: "rot" });
  assert.equal(gelesen(s).ergebnis, "gruen");
  assert.equal(gelesen(s).abweichung, "uebergeben rot, Zusammenfassung gruen — es gilt die Zusammenfassung");
});

test("ohne Zusammenfassung ist das Ergebnis rot und nennt alle Pakete", () => {
  const s = setup();
  festhalten(s);
  const datei = gelesen(s);
  assert.equal(datei.ergebnis, "rot");
  assert.equal(datei.rot.pruefung, null);
  assert.deepEqual(datei.rot.karten, ["11", "12"]);
  assert.match(datei.rot.hinweis, /keine abgeschlossene Zusammenfassung/);
});

test("ohne RELEASING.md und ohne Commit gilt commit = basis und releaseDateien: false (E15)", () => {
  const s = setup({ releasing: false });
  zusammenfassung(s.pfad);
  festhalten(s);
  const datei = gelesen(s);
  assert.equal(datei.commit, s.basis);
  assert.equal(datei.basis, s.basis);
  assert.equal(datei.releaseDateien, false);
  assert.equal(datei.version, null);
});

test("Build-Dienst mit gruener Paketstufe ergibt gruen-offen, der Build-Dienst-Punkt steht zuerst (E17)", () => {
  const s = setup();
  kitstandAbhaengigkeiten({ pushWeg: () => ({ ort: "buildDienst", zweig: "kit-pruefung" }) });
  zusammenfassung(s.pfad, { stufe: "paket" });
  festhalten(s, { ergebnis: "gruen", offen: ["Sichtpruefung der Oberflaeche"] });
  const datei = gelesen(s);
  assert.equal(datei.ergebnis, "gruen-offen");
  assert.deepEqual(datei.offen, ["voller Lauf im Build-Dienst (Prüfzweig kit-pruefung)", "Sichtpruefung der Oberflaeche"]);
});

test("Build-Dienst mit roter Paketstufe bleibt rot (E17)", () => {
  const s = setup();
  kitstandAbhaengigkeiten({ pushWeg: () => ({ ort: "buildDienst", zweig: "kit-pruefung" }) });
  rot(s.pfad, [{ cmd: "npm test", karten: [{ karte: "11", shas: ["abc"] }] }]);
  festhalten(s, { ergebnis: "rot" });
  assert.equal(gelesen(s).ergebnis, "rot");
});

test("festhalten weist ein unbekanntes Ergebnis und einen unbekannten Fetch-Wert ab", () => {
  const s = setup();
  zusammenfassung(s.pfad);
  assert.throws(() => festhalten(s, { ergebnis: "gelb" }), /--ergebnis/);
  assert.throws(() => festhalten(s, { fetch: "vielleicht" }), /--fetch/);
});

// --- vorbereitungPruefen (E10) ---

function vorbereitet() {
  const s = setup();
  zusammenfassung(s.pfad);
  festhalten(s, { ergebnis: "gruen-offen", offen: ["Sichtpruefung der Oberflaeche"] });
  return s;
}

test("pruefen: ein unveraenderter Stand wird uebernommen", () => {
  const s = vorbereitet();
  assert.deepEqual(vorbereitungPruefen({ repoRoot: s.repo }), {
    uebernehmen: true,
    grund: null,
    commit: s.vorbereitet,
    offen: ["Sichtpruefung der Oberflaeche"],
    zeitpunkt: JETZT.toISOString(),
  });
});

test("pruefen: ein weitergezogenes main wird nicht uebernommen", () => {
  const s = vorbereitet();
  commit(s.repo, "e.txt", "e\n", "Paket drei (Issue #13)");
  const urteil = vorbereitungPruefen({ repoRoot: s.repo });
  assert.equal(urteil.uebernehmen, false);
  assert.match(urteil.grund, /main steht nicht mehr auf/);
});

test("pruefen: ein weitergezogenes origin wird nicht uebernommen", () => {
  const s = vorbereitet();
  git(s.repo, "update-ref", "refs/remotes/origin/main", s.basis);
  const urteil = vorbereitungPruefen({ repoRoot: s.repo });
  assert.equal(urteil.uebernehmen, false);
  assert.match(urteil.grund, /origin\/main steht nicht mehr auf/);
});

test("pruefen: eine fehlende Referenz wird nicht uebernommen", () => {
  const s = vorbereitet();
  git(s.repo, "update-ref", "-d", REFERENZ);
  const urteil = vorbereitungPruefen({ repoRoot: s.repo });
  assert.equal(urteil.uebernehmen, false);
  assert.match(urteil.grund, /refs\/kit\/push-vorbereitet/);
});

test("pruefen: ein rotes Ergebnis wird nicht uebernommen", () => {
  const s = setup();
  rot(s.pfad, [{ cmd: "npm test", karten: [{ karte: "11", shas: ["abc"] }] }]);
  festhalten(s, { ergebnis: "rot" });
  const urteil = vorbereitungPruefen({ repoRoot: s.repo });
  assert.equal(urteil.uebernehmen, false);
  assert.match(urteil.grund, /Ergebnis rot/);
});

test("pruefen: ohne Datei gibt es nichts zu uebernehmen", () => {
  const s = setup();
  const urteil = vorbereitungPruefen({ repoRoot: s.repo });
  assert.equal(urteil.uebernehmen, false);
  assert.match(urteil.grund, /keine vorbereitete Veroeffentlichung/);
  assert.equal(urteil.commit, null);
});

test("pruefen --verwerfen loescht Datei und Referenz", () => {
  const s = vorbereitet();
  assert.deepEqual(vorbereitungPruefen({ repoRoot: s.repo, verwerfen: true }), { verworfen: { datei: true, referenz: true } });
  assert.equal(existsSync(join(s.repo, DATEI)), false);
  assert.equal(spawnSync("git", ["rev-parse", "--verify", "--quiet", REFERENZ], { cwd: s.repo }).status, 1);
  assert.deepEqual(vorbereitungPruefen({ repoRoot: s.repo, verwerfen: true }), { verworfen: { datei: false, referenz: false } });
});
