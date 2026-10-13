// Der Skill `/triage` (Issue #1630, Plan #1623 A1, A4, A6, A7, A9, A10, A11, A13, A15, E3, E4;
// Fachplan #1620).
//
// `/triage #N` spricht eine `[Idea]` mit dem Menschen durch und bringt sie auf ihre Bahn. Das
// Mechanische — Einstieg, Ablage, geklaerter Stand, Pruefung eines neuen Bodys, Abschluss der
// Ablage — liegt im Kommando `issue triage` (A2); geprueft wird hier, dass der Skill-Text es
// benutzt und die Urteilsregeln traegt, die im Werkzeug nicht stehen koennen: Gespraech,
// Empfehlung, Bahnvorschlag, Entscheidung des Menschen, Reihenfolge des Abschlusses.
//
// Geprueft wird der Skill-TEXT, nicht die Laufzeit, und ausschliesslich die Quelle unter
// `skills/`, nicht die Kopie unter `.claude/skills/` — dass beide zusammenpassen, prueft
// `tools/sync-blobs.mjs --check`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "triage", "SKILL.md"), "utf-8");
// Fliesstext ohne Zeilenumbrueche, damit ein Satz ueber zwei Zeilen gefunden wird.
const FLACH = SKILL.replaceAll(/\s+/g, " ");

/** Der Abschnitt ab der Ueberschrift `ueberschrift` bis zur naechsten gleich tiefen. */
function abschnitt(ueberschrift) {
  const start = SKILL.indexOf(`${ueberschrift}`);
  assert.ok(start >= 0, `'${ueberschrift}' fehlt im Skill`);
  const ebene = ueberschrift.match(/^#+/)[0];
  const rest = SKILL.slice(start + ueberschrift.length);
  const ende = rest.search(new RegExp(`\\n${ebene} `));
  return rest.slice(0, ende >= 0 ? ende : rest.length);
}

/** Der Abschnitt `### <n>. <titel>` per Titelanfang. */
function schritt(titel) {
  const kopf = new RegExp(`^### \\d+\\. ${titel}`, "m").exec(SKILL);
  assert.ok(kopf, `Schritt '${titel}' fehlt im Skill`);
  return abschnitt(kopf[0]);
}

/** Der Inhalt aller bash-Bloecke — dort stehen die Aufrufe. */
const BASH = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((treffer) => treffer[1]).join("\n");

// --- Frontmatter -------------------------------------------------------------

test("[triage] Frontmatter mit name: triage, user-invocable: true und englischer description", () => {
  const kopf = /^---\n([\s\S]*?)\n---\n/.exec(SKILL);
  assert.ok(kopf, "der Frontmatter-Block fehlt");
  assert.match(kopf[1], /^name: triage$/m, "name: triage fehlt");
  assert.match(kopf[1], /^user-invocable: true$/m, "user-invocable: true fehlt");
  const d = /^description: (.+)$/m.exec(kopf[1])?.[1] ?? "";
  assert.match(d, /Use this skill when the user invokes \/triage/, "die description nennt den Aufruf nicht englisch");
  assert.doesNotMatch(d, /[äöüÄÖÜß]/, "Umlaut in der description");
});

// --- Schritt 0: unbeaufsichtigt nicht beginnen ------------------------------

test("[triage] Schritt 0 bricht bei gesetztem KIT_AGENT_MODEL ab und aendert nichts", () => {
  const s0 = schritt("Unbeaufsichtigt");
  assert.match(SKILL, /^### 0\. /m, "der Abbruch ist nicht Schritt 0");
  assert.match(s0, /KIT_AGENT_MODEL/, "Schritt 0 nennt KIT_AGENT_MODEL nicht");
  assert.match(s0.replaceAll(/\s+/g, " "), /beginnt (?:der Skill )?nicht/, "Schritt 0 sagt nicht, dass der Skill nicht beginnt");
  assert.match(s0.replaceAll(/\s+/g, " "), /ändert sich nichts|ändert nichts/, "Schritt 0 sagt nicht, dass sich nichts ändert");
  const vorEinstieg = SKILL.slice(0, SKILL.indexOf("issue triage <N>"));
  assert.match(vorEinstieg, /KIT_AGENT_MODEL/, "der Abbruch steht nicht vor dem ersten Aufruf von issue triage");
});

// --- Einstieg und Ablage (A2, A11) -------------------------------------------

test("[triage] der Einstieg laeuft ueber issue triage <N> und endet bei start: false ohne Aenderung", () => {
  assert.match(BASH, /^node \.claude\/kit\/board\.mjs issue triage <N>$/m, "der Aufruf issue triage <N> fehlt");
  assert.match(FLACH, /start: false[^.]*ohne Änderung/, "bei start: false endet der Skill nicht ohne Änderung");
  assert.match(FLACH, /keine-idee/, "der Grund keine-idee fehlt");
});

test("[triage] gelesene und nicht gelesene Anhaenge werden genannt", () => {
  const s = schritt("Anhänge");
  const flach = s.replaceAll(/\s+/g, " ");
  assert.match(flach, /gelesen: true/, "die gelesenen Anhänge (gelesen: true) fehlen");
  assert.match(flach, /gelesen: false/, "die nicht gelesenen Anhänge (gelesen: false) fehlen");
  assert.match(flach, /nennt[^.]*gelesen[^.]*nicht gelesen/, "der Skill nennt nicht, welche gelesen sind und welche nicht");
  assert.match(flach, /ohne sie umzuwandeln|wandelt nichts um/, "die Regel, nichts umzuwandeln, fehlt");
});

test("[triage] bei fehlender oder leerer Ablage: Pfad .claude/ideas/<N>/ und die Frage, ob ohne Anhaenge weitergeht", () => {
  const flach = schritt("Anhänge").replaceAll(/\s+/g, " ");
  assert.match(flach, /fehlt die Ablage oder ist sie leer/i, "der Fall fehlende/leere Ablage fehlt");
  assert.match(flach, /`\.claude\/ideas\/<N>\/`/, "der Pfad .claude/ideas/<N>/ fehlt");
  assert.match(flach, /fragt, ob (?:es|er|der Skill) ohne Anhänge weitergeht/, "die Frage, ob ohne Anhänge weitergeht, fehlt");
  assert.match(flach, /legt (?:die Ablage|das Verzeichnis) nicht an|nie an/, "der Skill sagt nicht, dass er die Ablage nicht anlegt");
});

// --- Fortsetzung (A4, A10) ---------------------------------------------------

test("[triage] ein vorhandener Stand wird vorgelegt und bei den offenen Punkten fortgesetzt", () => {
  const flach = schritt("Vorhandener Stand").replaceAll(/\s+/g, " ");
  assert.match(flach, /legt[^.]*Stand[^.]*vor/, "der vorhandene Stand wird nicht vorgelegt");
  assert.match(flach, /offenen Punkten fort/, "die Fortsetzung bei den offenen Punkten fehlt");
  assert.match(flach, /stand\.offen|`offen`/, "das Feld offen des Kommandos fehlt");
});

test("[triage] bei vorhandenem Ergebnis legt der Skill nichts ein zweites Mal an (A10)", () => {
  const flach = schritt("Vorhandener Stand").replaceAll(/\s+/g, " ");
  assert.match(flach, /stand\.ergebnis/, "stand.ergebnis fehlt");
  assert.match(flach, /legt[^.]*nichts neu an|kein zweites Mal an|nicht ein zweites Mal an/, "das Verbot des zweiten Anlegens fehlt");
  assert.match(flach, /offenen Abschlussschritten/, "die Fortsetzung bei den offenen Abschlussschritten fehlt");
});

// --- Punktliste und einzelnes Vorlegen (A4, A15) -----------------------------

test("[triage] die Punktliste entsteht zuerst ohne Antwortzeilen, jede Bestaetigung schreibt sofort (A4)", () => {
  const flach = FLACH;
  assert.match(flach, /## Geklärter Stand/, "die Überschrift ## Geklärter Stand fehlt");
  assert.match(flach, /vollständige Punktliste ohne Antwortzeilen/, "die Punktliste ohne Antwortzeilen fehlt");
  assert.match(flach, /\*\*Antwort \(<Urheber>, <JJJJ-MM-TT>\):\*\*/, "das Format der Antwortzeile fehlt");
  assert.match(flach, /sofort/, "das sofortige Schreiben fehlt");
  const liste = flach.indexOf("vollständige Punktliste ohne Antwortzeilen");
  const einzeln = flach.search(/einzeln, mit Empfehlung/);
  assert.ok(einzeln > liste, "die Punktliste steht nicht vor dem einzelnen Vorlegen");
});

test("[triage] vor jedem Schreiben prueft issue triage --body-file, geschrieben wird mit issue update --body-file", () => {
  assert.match(BASH, /board\.mjs issue triage <N> --body-file <tmpdir>\/<N>-triage-body\.md/, "die Prüfung mit --body-file fehlt");
  assert.match(BASH, /board\.mjs issue update <N> --body-file <tmpdir>\/<N>-triage-body\.md/, "issue update --body-file fehlt");
  assert.ok(BASH.indexOf("issue triage <N> --body-file") < BASH.indexOf("issue update <N> --body-file"),
    "die Prüfung steht nicht vor dem Schreiben");
});

test("[triage] fuer das einzelne Vorlegen verweist der Skill auf /groom statt dessen Absaetze zu kopieren (A15)", () => {
  assert.match(FLACH, /Muster (?:von|aus) `\/groom`/, "der Verweis auf das Muster von /groom fehlt");
  assert.doesNotMatch(SKILL, /\*\*Sammelantwort:\*\*/, "der Absatz zur Sammelantwort ist aus /groom kopiert");
  assert.doesNotMatch(SKILL, /\*\*Zurückstellen:\*\*/, "der Absatz zum Zurückstellen ist aus /groom kopiert");
});

// --- Zusammenfassung, Bahnvorschlag, Entscheidung (A6) -----------------------

test("[triage] die Zusammenfassung steht vor dem Bahnvorschlag", () => {
  const zusammen = SKILL.search(/^### \d+\. Zusammenfassung/m);
  const vorschlag = SKILL.search(/^### \d+\. Bahn vorschlagen/m);
  assert.ok(zusammen >= 0, "der Schritt Zusammenfassung fehlt");
  assert.ok(vorschlag > zusammen, "der Bahnvorschlag steht nicht nach der Zusammenfassung");
  assert.match(schritt("Zusammenfassung").replaceAll(/\s+/g, " "), /Liste/, "die Zusammenfassung ist keine Liste");
});

test("[triage] Bahnvorschlag mit Begruendung und Massstab fachlicher Bezug", () => {
  const flach = schritt("Bahn vorschlagen").replaceAll(/\s+/g, " ");
  assert.match(flach, /fachlicher Bezug|fachlichen Bezug/, "der Maßstab fachlicher Bezug fehlt");
  assert.match(flach, /was ein Mensch im Umgang mit dem Werkzeug erlebt/, "die Bestimmung des fachlichen Bezugs fehlt");
  assert.match(flach, /begründet|Begründung/, "die Begründung des Vorschlags fehlt");
  for (const bahn of ["`1`", "`2, fachlich`", "`2, technisch`", "`3`"]) {
    assert.ok(flach.includes(bahn), `die Bahn ${bahn} fehlt im Vorschlag`);
  }
  assert.match(flach, /Der Mensch entscheidet/, "die Entscheidung des Menschen fehlt");
});

test("[triage] die Bahn-Zeile nach A6 entsteht erst nach der Entscheidung", () => {
  assert.match(SKILL, /Bahn: <1 \| 2, fachlich \| 2, technisch \| 3> — vorgeschlagen: <Wert>; gewählt \(<Urheber>, <JJJJ-MM-TT>\)/,
    "die Form der Bahn-Zeile nach A6 fehlt");
  assert.match(FLACH, /[Ee]rst nach der Entscheidung/, "die Bahn-Zeile entsteht nicht erst nach der Entscheidung");
});

// --- Vorlage (A13) -----------------------------------------------------------

test("[triage] Vorlage mit verbindlich oder Anregung und Pfad aus vorlageZiel (A13)", () => {
  const flach = schritt("Vorlage").replaceAll(/\s+/g, " ");
  assert.match(flach, /`verbindlich`/, "verbindlich fehlt");
  assert.match(flach, /`Anregung`/, "Anregung fehlt");
  assert.match(flach, /vorlageZiel/, "der Pfad aus vorlageZiel fehlt");
  assert.match(SKILL, /Vorlage: <vorlageZiel> — verbindlich \| Anregung/, "die Form der Vorlage-Zeile fehlt");
});

// --- Der gewaehlte Weg (A7, A10) ---------------------------------------------

test("[triage] der gewaehlte Weg ruft /requirement #N, /techplan #N bzw. /task #N", () => {
  const flach = schritt("Den gewählten Weg gehen").replaceAll(/\s+/g, " ");
  assert.match(flach, /`2, fachlich`[^|]*`\/requirement #N`/, "Bahn 2 fachlich → /requirement #N fehlt");
  assert.match(flach, /`2, technisch`[^|]*`\/techplan #N`/, "Bahn 2 technisch → /techplan #N fehlt");
  assert.match(flach, /`3`[^|]*`\/task #N`/, "Bahn 3 → /task #N fehlt");
  assert.match(flach, /gewählten? (?:Bahn|Weg)[^.]*nicht (?:den|die) vorgeschlagene/, "der Satz, dass der gewählte Weg gilt, fehlt");
});

test("[triage] Ergebnis-Zeile nach A10 unmittelbar nach dem Anlegen", () => {
  const flach = FLACH;
  for (const wert of ["Ergebnis: Issue #M", "Ergebnis: Idee <ideaId>", "Ergebnis: Commit <sha>"]) {
    assert.ok(flach.includes(`\`${wert}\``), `die Ergebnis-Zeile ${wert} fehlt`);
  }
  assert.match(flach, /unmittelbar, nachdem/, "die Ergebnis-Zeile steht nicht unmittelbar nach dem Anlegen");
});

test("[triage] Reihenfolge Dokument → --finish → Commit der Vorlage (E3)", () => {
  const s = schritt("Abschluss");
  const anlegen = s.search(/Ergebnis-Zeile/);
  const finish = s.search(/issue triage <N> --finish/);
  const commit = s.search(/git commit/);
  assert.ok(anlegen >= 0 && finish > anlegen, "--finish steht nicht nach der Ergebnis-Zeile");
  assert.ok(commit > finish, "der Commit der Vorlage steht nicht nach --finish");
  assert.match(BASH, /board\.mjs issue triage <N> --finish --template <datei>/, "--finish --template fehlt");
  assert.match(BASH, /^node \.claude\/kit\/board\.mjs issue triage <N> --finish$/m, "--finish ohne Vorlage fehlt");
  assert.match(s.replaceAll(/\s+/g, " "), /nur (?:mit )?der Vorlage|allein/, "der Commit trägt nicht nur die Vorlage");
});

// --- Bahn 1 (A9, E4) ---------------------------------------------------------

test("[triage] Bahn 1: Commit mit Issue #N, Ergebnis-Zeile, --finish, der Zug nach Done nennt der Skill dem Menschen (A9, E4)", () => {
  const s = schritt("Bahn 1");
  const flach = s.replaceAll(/\s+/g, " ");
  assert.match(flach, /`Issue #N`/, "der Commit nennt Issue #N nicht");
  assert.match(flach, /checks\.mjs run/, "das Commit-Gate fehlt");
  assert.match(flach, /`Ergebnis: Commit <sha>`/, "die Ergebnis-Zeile für Bahn 1 fehlt");
  assert.match(flach, /--finish/, "--finish fehlt bei Bahn 1");
  assert.match(flach, /`node \.claude\/kit\/board\.mjs issue move <N> done`/, "der Zug nach Done fehlt");
  assert.match(flach, /nennt[^.]*dem Menschen|nennt ihn dem Menschen/, "der Skill nennt den Zug nicht dem Menschen");
  assert.match(flach, /führt ihn nicht selbst aus|nie selbst/, "der Skill führt den Zug nach Done nicht ausdrücklich nicht selbst aus");
  assert.doesNotMatch(BASH, /issue move <N> done/, "der Zug nach Done steht als eigener Aufruf im Skill");
});

// --- Feste Zeilen und Transportregel ----------------------------------------

test("[triage] Absatz Feste Zeilen mit board.mjs names", () => {
  assert.match(SKILL, /^\*\*Feste Zeilen\.\*\* /m, "der Absatz Feste Zeilen fehlt");
  assert.match(SKILL, /node \.claude\/kit\/board\.mjs names/, "der Aufruf board.mjs names fehlt");
});

test("[triage] Transportregel: Body stueckweise per Shell, eigener Werkzeugaufruf, kein $TMPDIR", () => {
  assert.match(FLACH, /Lange Texte ans Board/, "der Verweis auf die Transportregel fehlt");
  assert.match(FLACH, /printenv TMPDIR/, "printenv TMPDIR fehlt");
  assert.match(FLACH, /\*\*eigener\*\* Werkzeugaufruf/, "der eigene Werkzeugaufruf fehlt");
  assert.doesNotMatch(SKILL, /\$TMPDIR|\$\{TMPDIR\}/, "der Skill nennt $TMPDIR");
});

// --- Szenarien aus dem Paket -------------------------------------------------

test("Szenario: Eine Idee mit Bild wird zur fachlichen Anforderung", () => {
  // Die Skizze wird als gelesen genannt (Anhänge), bei Bahn `2, fachlich` ruft der Skill
  // `/requirement #N`, schreibt die Ergebnis-Zeile und ruft danach `--finish`.
  assert.match(schritt("Anhänge").replaceAll(/\s+/g, " "), /Bilder/, "Bilder als gelesene Anhänge fehlen");
  const weg = schritt("Den gewählten Weg gehen").replaceAll(/\s+/g, " ");
  assert.match(weg, /`2, fachlich`[^|]*`\/requirement #N`/, "Bahn 2 fachlich ruft nicht /requirement #N");
  const ende = schritt("Abschluss");
  const ergebnis = ende.search(/Ergebnis-Zeile/);
  const finish = ende.search(/issue triage <N> --finish/);
  assert.ok(ergebnis >= 0 && finish > ergebnis, "die Ergebnis-Zeile steht nicht vor --finish");
  assert.match(ende.replaceAll(/\s+/g, " "), /Ablage[^.]*gelöscht/, "die gelöschte Ablage fehlt");
});

test("Szenario: Der Mensch entscheidet anders als vorgeschlagen", () => {
  // Vorgeschlagen 2, gewählt 3: Der Skill geht den gewählten Weg `/task #N`.
  const flach = FLACH;
  assert.match(flach, /vorgeschlagen: 2, fachlich; gewählt \([^)]*\)/, "das Beispiel vorgeschlagen 2, gewählt anders fehlt");
  assert.match(flach, /Bahn: 3 — vorgeschlagen: 2, fachlich/, "das Beispiel Bahn 3 gegen den Vorschlag 2 fehlt");
  const weg = schritt("Den gewählten Weg gehen").replaceAll(/\s+/g, " ");
  assert.match(weg, /`3`[^|]*`\/task #N`/, "Bahn 3 ruft nicht /task #N");
  assert.match(weg, /gewählten? (?:Bahn|Weg)[^.]*nicht (?:den|die) vorgeschlagene/, "der gewählte Weg gilt nicht vor dem vorgeschlagenen");
});

// --- Stop-Punkte -------------------------------------------------------------

test("[triage] Stop-Punkte: kein Zug nach Done, kein Label abnehmen, nichts ohne Zustimmung", () => {
  const s = abschnitt("## Stop-Punkte").replaceAll(/\s+/g, " ");
  assert.match(s, /Done/, "der Stop-Punkt Done fehlt");
  assert.match(s, /Zustimmung/, "der Stop-Punkt Zustimmung fehlt");
  assert.match(s, /KIT_AGENT_MODEL/, "der Stop-Punkt unbeaufsichtigt fehlt");
  assert.match(s, /nicht gewählt/, "der Stop-Punkt 'kein Weg, den der Mensch nicht gewählt hat' fehlt");
});
