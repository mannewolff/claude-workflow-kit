// Der Skill `/groom` (Issue #1514, Plan #1510 A1, A3, A4, E5, E6, E7, E9, E10, E13; Fachplan #1475).
//
// `/groom` fuehrt das Grooming eines geprueften Fachplans mit dem PO. Das Mechanische — welche
// Fragen offen sind, ob der Ablauf beginnen darf, ob ein neuer Body etwas verliert — liegt im
// Kommando `issue questions` (A1); geprueft wird hier, dass der Skill-Text es benutzt und die
// Urteilsregeln traegt, die im Werkzeug nicht stehen koennen.
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
const SKILL = readFileSync(join(repoRoot, "skills", "groom", "SKILL.md"), "utf-8");

/** Der Abschnitt ab der Ueberschrift `ueberschrift` bis zur naechsten gleich tiefen. */
function abschnitt(ueberschrift) {
  const start = SKILL.indexOf(`${ueberschrift}\n`);
  assert.ok(start >= 0, `'${ueberschrift}' fehlt im Skill`);
  const ebene = ueberschrift.match(/^#+/)[0];
  const rest = SKILL.slice(start + ueberschrift.length);
  const ende = rest.search(new RegExp(`\\n${ebene} `));
  return rest.slice(0, ende >= 0 ? ende : rest.length);
}

/** Der Inhalt aller bash-Bloecke — dort stehen die Aufrufe. */
const BASH = [...SKILL.matchAll(/```bash\n([\s\S]*?)```/g)].map((treffer) => treffer[1]).join("\n");

// --- Frontmatter -------------------------------------------------------------

test("[groom] der Skill traegt Frontmatter mit name: groom und user-invocable: true", () => {
  const kopf = /^---\n([\s\S]*?)\n---\n/.exec(SKILL);
  assert.ok(kopf, "der Frontmatter-Block fehlt");
  assert.match(kopf[1], /^name: groom$/m, "name: groom fehlt");
  assert.match(kopf[1], /^user-invocable: true$/m, "user-invocable: true fehlt");
  assert.match(kopf[1], /^description: \S/m, "die Beschreibung fehlt");
});

// --- Werkzeug statt Text (A1, A3) ---------------------------------------------

test("[groom] der Einstieg laeuft ueber issue questions und endet bei start: false ohne Aenderung", () => {
  assert.match(BASH, /node \.claude\/kit\/board\.mjs issue questions <N>$/m, "der Aufruf issue questions <N> fehlt");
  assert.match(SKILL, /start: false/, "das Ende bei start: false fehlt");
  assert.match(SKILL, /start: false[^\n]*ohne (?:jede )?(?:Ä|Ae)nderung/, "bei start: false endet der Skill nicht ohne Änderung");
});

test("[groom] vor jedem Schreiben prueft issue questions --body-file, geschrieben wird mit issue update --body-file", () => {
  assert.match(BASH, /board\.mjs issue questions <N> --body-file <tmpdir>\/<N>-groom-body\.md/, "die Prüfung mit --body-file fehlt");
  assert.match(BASH, /board\.mjs issue update <N> --body-file <tmpdir>\/<N>-groom-body\.md/, "issue update --body-file fehlt");
  const pruefen = BASH.indexOf("issue questions <N> --body-file");
  const schreiben = BASH.indexOf("issue update <N> --body-file");
  assert.ok(pruefen < schreiben, "die Prüfung steht nicht vor dem Schreiben");
});

test("[groom] der Start-Body liegt unter <tmpdir>/<N>-groom-start.md, am Ende vergleicht --compare", () => {
  assert.match(SKILL, /<tmpdir>\/<N>-groom-start\.md/, "der Start-Body-Pfad fehlt");
  assert.match(BASH, /board\.mjs issue questions <N> --compare <tmpdir>\/<N>-groom-start\.md/, "der Vergleich fehlt");
  assert.match(SKILL, /Lange Texte ans Board/, "der Verweis auf die Transportregel fehlt");
  assert.match(SKILL, /eigene[rnm]?\*{0,2} Werkzeugaufruf/, "der eigene Werkzeugaufruf je Stück fehlt");
  assert.match(SKILL, /unvollst(ä|ae)ndige Datei wird nicht/, "der Satz zur unvollständigen Datei fehlt");
  assert.doesNotMatch(SKILL, /\$TMPDIR|\$\{TMPDIR\}/, "der Pfad steht als Variable statt wörtlich");
});

// --- Urteilsregeln im Text -----------------------------------------------------

test("[groom] die Antwortzeile hat die Form **Antwort (<Urheber>, <JJJJ-MM-TT>):**", () => {
  assert.ok(SKILL.includes("**Antwort (<Urheber>, <JJJJ-MM-TT>):**"), "die Antwortzeilen-Form fehlt");
});

test("[groom] geschrieben wird erst nach Zustimmung, dann sofort", () => {
  assert.match(SKILL, /[Ee]rst nach (?:der )?Zustimmung/, "das Schreiben erst nach Zustimmung fehlt");
  assert.match(SKILL, /sofort/, "das sofortige Schreiben fehlt");
});

test("[groom] je Frage Empfehlung und Begruendung, genau eine Antwort, Sammelantwort nur fuer die aktuelle", () => {
  assert.match(SKILL, /Empfehlung/, "die Empfehlung fehlt");
  assert.match(SKILL, /Begr(ü|ue)ndung/, "die Begründung fehlt");
  assert.match(SKILL, /genau eine Antwort/, "genau eine Antwort je Frage fehlt");
  assert.match(SKILL, /aktuelle(?:n)? Frage/, "die Sammelantwort für die aktuelle Frage fehlt");
  assert.match(SKILL, /zur(ü|ue)ckstellen/, "das Zurückstellen fehlt");
});

test("[groom] die Stopp-Frage kommt zuerst, als naechste freie Nummer mit Zusatz (E5)", () => {
  assert.match(SKILL, /n(ä|ae)chste(?:n)? freie(?:n)? Nummer/, "die nächste freie Nummer fehlt");
  assert.ok(SKILL.includes("(Stopp-Frage der Prüfung vom <Datum>)"), "der Zusatz zur Stopp-Frage fehlt");
});

test("[groom] der Vermerk kommt aus vermerkVorschlag", () => {
  assert.match(SKILL, /vermerkVorschlag/, "vermerkVorschlag fehlt");
});

test("[groom] der Abschluss nennt Label-Abnahme, den Weg im Halt-Kommentar und den Pruefvorschlag (E6, E9)", () => {
  assert.match(SKILL, /stoppKommentar/, "stoppKommentar fehlt");
  assert.match(SKILL, /`kit:clarify` ab/, "der Satz zum Abnehmen von kit:clarify fehlt");
  assert.match(SKILL, /Halt-Kommentar/, "der Verweis auf den Weg im Halt-Kommentar fehlt");
  assert.match(SKILL, /\/issue-review #<N>/, "der Prüfvorschlag mit /issue-review fehlt");
});

// --- Szenarien ergaenzen (Issue #1592, Plan #1588 A8, E8) ------------------------------

test("[groom] der Schritt Szenarien ergänzen steht vor den offenen Fragen", () => {
  const schritt = /^### \d+\. Szenarien ergänzen$/m.exec(SKILL);
  assert.ok(schritt, "der Schritt „Szenarien ergänzen“ fehlt");
  const fragen = /^### \d+\. Je offene Frage$/m.exec(SKILL);
  const stopp = /^### \d+\. Stopp-Frage zuerst$/m.exec(SKILL);
  assert.ok(schritt.index < fragen.index, "Szenarien ergänzen steht nicht vor den offenen Fragen");
  assert.ok(schritt.index < stopp.index, "Szenarien ergänzen steht nicht vor der Stopp-Frage");
});

test("[groom] Szenarien ergänzen: aus den Kriterien, technikfrei, Projektsprache, Zustimmung vor dem Schreiben", () => {
  const text = abschnitt(SKILL.match(/^### \d+\. Szenarien ergänzen$/m)[0]);
  assert.match(text, /`szenarien`/, "der Schritt liest das Feld szenarien nicht");
  assert.match(text, /szenarien-fehlen/, "der Grund szenarien-fehlen fehlt");
  assert.match(text, /aus den (?:fachlichen )?(?:Akzeptanz)?[Kk]riterien/, "die Herkunft aus den Kriterien fehlt");
  assert.match(text, /technikfrei/, "technikfrei fehlt");
  assert.match(text, /Projektsprache/, "die Schlüsselwörter der Projektsprache fehlen");
  assert.match(text, /[Ee]rst nach (?:der )?Zustimmung/, "die Zustimmung vor dem Schreiben fehlt");
  assert.match(text, /Vermerk „Keine“[^\n]*erst danach|erst danach[^\n]*Vermerk/, "der Vermerk „Keine“ entsteht nicht erst danach");
});

test("[groom] der Abschluss uebernimmt den Pruefvorschlag aus aenderungen.vorschlag, auch fuer Szenarien (E8)", () => {
  const abschluss = abschnitt(SKILL.match(/^### \d+\. Abschluss$/m)[0]);
  assert.match(abschluss, /`vorschlag`/, "der Vorschlag aus dem Vergleich fehlt");
  assert.match(abschluss, /Szenari/, "die Szenarien im Vergleich fehlen");
});

// --- Stop-Punkte und unbeaufsichtigt ------------------------------------------

test("[groom] die Stop-Punkte: kein Label, keine Pruefung, keine eigenen Prueffunde, kein [Plan], keine Bewegung", () => {
  const stop = abschnitt("## Stop-Punkte");
  assert.match(stop, /Label[^\n]*setzen oder abnehmen|setzen oder abnehmen[^\n]*Label/, "kein Label setzen oder abnehmen fehlt");
  assert.match(stop, /Pr(ü|ue)fung starten/, "keine Prüfung starten fehlt");
  assert.match(stop, /eigene(?:n)? Pr(ü|ue)ffunde/, "keine eigenen Prüffunde fehlt");
  assert.match(stop, /`\[Plan\]`/, "kein [Plan] fehlt");
  assert.match(stop, /[Bb]ewegung|bewegen/, "keine Bewegung fehlt");
  assert.doesNotMatch(BASH, /issue label (?:add|remove)|issue move/, "ein bash-Block setzt ein Label oder bewegt die Karte");
});

test("[groom] unbeaufsichtigt (KIT_AGENT_MODEL) beginnt der Skill nicht", () => {
  assert.match(SKILL, /KIT_AGENT_MODEL/, "KIT_AGENT_MODEL fehlt");
  assert.match(SKILL, /unbeaufsichtigt/, "der Grund unbeaufsichtigt fehlt");
});
