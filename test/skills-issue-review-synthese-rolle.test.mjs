// Die Rolle `synthese` und ihre drei Ausgaenge im issue-review-Skill (Issue #598,
// Plan #595, fachliche Quelle #587).
//
// Die Auswahl aus Issue #597 und der Beleg-Abgleich aus Issue #593 wirken erst,
// wenn der Skill den Pruefer auch startet. Der Zeitpunkt ist die Sache: Der
// Synthese-Pruefer haengt in Schritt 6, unmittelbar hinter dem Beleg-Abgleich —
// interaktiv vor der Zustimmungsfrage, nachts vor Schreibbefehl 1. Steht er
// dahinter, ist der Body geschrieben, bevor irgendjemand die Synthese gelesen hat.
//
// Geprueft wird Text, nicht Verhalten — wie in den uebrigen Skill-Tests des Repos.
// Was im Skill nicht steht, tut die Session nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");
const SKILL = lies("skills", "issue-review", "SKILL.md");
const DOKU = lies("docs", "dokumentation.md");

const UEBERSCHRIFT = "#### Rolle `synthese`";

/** Der Unterabschnitt der Rolle — bis zur naechsten Marke gleicher oder hoeherer Ebene. */
function syntheseAbschnitt() {
  const idx = SKILL.indexOf(UEBERSCHRIFT);
  assert.ok(idx >= 0, `Unterabschnitt '${UEBERSCHRIFT}' fehlt`);
  const rest = SKILL.slice(idx + UEBERSCHRIFT.length);
  const marken = ["\n#### ", "\n### ", "\n## ", "\n**Zuordnung und Fehlerpfad:**"]
    .map((m) => rest.indexOf(m))
    .filter((x) => x >= 0);
  const grenze = marken.length ? Math.min(...marken) : -1;
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}

/** Der Promptblock der Rolle: der erste ```-Block ihres Unterabschnitts. */
function promptBlock() {
  const treffer = /```\n([\s\S]*?)```/.exec(syntheseAbschnitt());
  assert.ok(treffer, "kein Promptblock im Unterabschnitt der Rolle `synthese`");
  return treffer[1];
}

/** Schritt 6 allein — von seiner Ueberschrift bis zum Nachtbetriebs-Abschnitt. */
const schritt6 = SKILL.slice(
  SKILL.indexOf("### 6. Body schärfen"),
  SKILL.indexOf("## Im Nachtbetrieb")
);

test("[skills-12] der Unterabschnitt steht hinter dem Legacy-Fallback und vor der Zuordnung", () => {
  const legacy = SKILL.indexOf("#### Legacy-Fallback ohne `reviewStufen`");
  const rolle = SKILL.indexOf(UEBERSCHRIFT);
  const zuordnung = SKILL.indexOf("**Zuordnung und Fehlerpfad:**");

  assert.notEqual(legacy, -1, "der Legacy-Fallback fehlt");
  assert.notEqual(rolle, -1, `'${UEBERSCHRIFT}' fehlt`);
  assert.notEqual(zuordnung, -1, "der Abschnitt 'Zuordnung und Fehlerpfad' fehlt");

  // Zwei Bestandstests begrenzen die Stufen-Abschnitte an genau diesen Marken.
  // Stuende die Rolle dazwischen, zaehlten sie ihren Promptblock mit.
  assert.ok(legacy < rolle, "die Rolle `synthese` steht vor dem Legacy-Fallback");
  assert.ok(rolle < zuordnung, "die Rolle `synthese` steht hinter der Zuordnung");
});

test("[skills-12] der Prompt stellt beide Fragen und zieht die Grenze zur Sachpruefung", () => {
  const p = promptBlock();
  assert.match(p, /Widerspruch/i,
    "Frage (1) nach dem unbenannten Widerspruch zwischen den Befundlisten fehlt");
  assert.match(p, /(verworfen|Verwerfung)/i,
    "Frage (2) nach der Begruendung des verworfenen Funds fehlt");
  assert.match(p, /nachvollziehbar/i,
    "das Kriterium der nachvollziehbaren Begruendung fehlt");
  // Ohne diese Grenze prueft der Pruefer den Bestand nach und wird zum zweiten
  // Reviewer — genau das schliesst Issue #587 als Nicht-Ziel aus.
  assert.match(p, /nicht[\s\S]{0,40}sachlich zutrifft/i,
    "die Grenze 'nicht, ob sie sachlich zutrifft' fehlt");
  assert.match(p, /Dokument[\s\S]{0,40}nicht erneut|nicht[\s\S]{0,40}erneut/i,
    "der Satz, dass das Dokument nicht erneut geprueft wird, fehlt");
});

test("[skills-12] der Prompt traegt die drei Platzhalter und keinen Issue-Body", () => {
  const p = promptBlock();
  for (const platzhalter of ["{{BEFUNDE}}", "{{SYNTHESE}}", "{{VORSCHLAG}}"]) {
    assert.ok(p.includes(platzhalter), `Platzhalter fehlt im Prompt: ${platzhalter}`);
  }
  // Der Pruefer liest die Synthese, nicht das Dokument. Mit dem Body im Prompt
  // faellt er zuverlaessig in die Dokumentkritik zurueck.
  assert.ok(!p.includes("{{ISSUE_BODY}}"),
    "der Prompt traegt {{ISSUE_BODY}} — dann prueft er das Dokument statt der Synthese");
});

test("[skills-12] der Prompt traegt keine Streich-Frage", () => {
  assert.doesNotMatch(promptBlock(), /Was kann RAUS/i,
    "die Streich-Frage laedt zur Dokumentkritik ein — Issue #587 schliesst sie als Nicht-Ziel aus");
});

test("[skills-12] der Prompt nennt Ausgabeform und den befundfreien Fall", () => {
  const p = promptBlock();
  assert.match(p, /Synthese-Zeile/i, "die Synthese-Zeile als Fundstelle fehlt");
  assert.match(p, /Reviewer/i, "der Reviewer als Teil der Ausgabe fehlt");
  assert.match(p, /Grund/i, "der Grund als Teil der Ausgabe fehlt");
  assert.match(p, /Wenn du nichts findest/i,
    "ohne den ausdruecklichen Satz ist eine leere Antwort vom Ausfall nicht zu unterscheiden");
});

test("[skills-12] auf der Stufe issue entfaellt die Widerspruchsfrage", () => {
  const a = syntheseAbschnitt();
  const satz = a.split("\n").find((z) => /Stufe `issue`/.test(z) && /entfäll|entfall/i.test(z));
  assert.ok(satz, "es steht nicht, dass Frage (1) auf der Stufe `issue` entfaellt");
});

test("[skills-12] der Pruefer weist den Bestandszugriff aus wie jede Rolle", () => {
  const a = syntheseAbschnitt();
  assert.match(a, /Bestand: gelesen/, "die Zeile `Bestand: gelesen` fehlt");
  assert.match(a, /Bestand: nein/, "die Zeile `Bestand: nein` fehlt");
});

test("[skills-12] die Ausnahme von der Streich-Frage-Pflicht steht im Skill", () => {
  const satz = SKILL.split(/\n\n/).find(
    (a) => /Streich-Frage ist Pflicht in jeder Rolle/.test(a)
  );
  assert.ok(satz, "der Satz zur Streich-Frage-Pflicht fehlt");
  assert.match(satz, /synthese/,
    "ohne die Ausnahme widerspricht der Skill sich selbst — der synthese-Prompt traegt keine Streich-Frage");
});

test("[skills-12] die Ausnahme von {{ISSUE_BODY}} steht in Zuordnung und Fehlerpfad", () => {
  const idx = SKILL.indexOf("**Zuordnung und Fehlerpfad:**");
  assert.notEqual(idx, -1, "der Abschnitt 'Zuordnung und Fehlerpfad' fehlt");
  const absatz = SKILL.slice(idx).split(/\n\n/)[0];
  assert.match(absatz, /synthese/,
    "die Zuordnung nennt die Rolle `synthese` nicht — dann bricht der Review an ihrem Rollennamen ab");
  assert.match(absatz, /\{\{ISSUE_BODY\}\}/, "der Satz zum Body-Platzhalter fehlt");
  assert.match(absatz, /(Ausnahme|außer|ausser|außgenommen|ausgenommen|nicht)/i,
    "die Ausnahme fuer `synthese` fehlt — der Satz behauptet sonst einen Body-Platzhalter, den es dort nicht gibt");
});

test("[skills-12] der roles-Aufruf steht als bash-Block in Schritt 6", () => {
  const bloecke = [...schritt6.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rollen = bloecke.filter((b) => /issue-review roles/.test(b));
  assert.equal(rollen.length, 1,
    `genau ein roles-Aufruf in Schritt 6 erwartet, gefunden ${rollen.length}`);
  const aufruf = rollen[0];
  for (const flag of ["--stufe", "--rolle synthese", "--author", "--ausschluss", "--issue"]) {
    assert.ok(aufruf.includes(flag), `dem roles-Aufruf fehlt ${flag}`);
  }
});

test("[skills-12] die Ausschlussliste nennt gewaehlt und das Modell der Synthese-Session", () => {
  assert.match(schritt6, /gewaehlt/,
    "die bereits gelaufenen Reviewer fehlen in der Ausschlussliste");
  assert.match(schritt6, /KIT_AGENT_MODEL/,
    "nachts liefert KIT_AGENT_MODEL das Modell der Synthese-Session");
  assert.match(schritt6, /Selbstauskunft/i,
    "interaktiv ist KIT_AGENT_MODEL leer — ohne die Selbstauskunft prueft die Session ihre eigene Synthese");
});

test("[skills-12] Schritt 6 sagt, wann der Pruefer ueberhaupt laeuft", () => {
  assert.match(schritt6, /verworfene[nr]? Fund/i,
    "der erste Anlass (mindestens ein verworfener Fund) fehlt");
  assert.match(schritt6, /zwei Befundlisten/i,
    "der zweite Anlass (zwei gefuellte Befundlisten) fehlt");
  // Ein befundfreier Lauf ueberspringt die Schreibbefehle 1 bis 3 — dort gibt es
  // weder Synthese noch Vorschlag, also nichts zu pruefen.
  assert.match(schritt6, /befundfrei/i,
    "der befundfreie Lauf ist als Entfall nicht benannt");
});

test("[skills-12] die drei Ausgaenge stehen woertlich im Skill", () => {
  assert.ok(SKILL.includes("Synthese-Pruefung entfallen:"),
    "die Entfall-Zeile fehlt woertlich");
  assert.ok(SKILL.includes("Synthese-Pruefung ausgefallen:"),
    "die Ausfall-Zeile fehlt woertlich");
  assert.ok(SKILL.includes(", ohne Synthese-Pruefung)"),
    "der Marker-Zusatz fehlt woertlich");
});

test("[skills-12] der Entfall kennt beide Gruende und traegt den Marker-Zusatz", () => {
  assert.match(schritt6, /entfall: true/,
    "der Entfall mangels unbeteiligtem Modell (`entfall: true`) fehlt");
  const form = SKILL.split("\n").find((z) => z.includes(", ohne Synthese-Pruefung)"));
  assert.ok(form, "keine Zeile nennt den Marker-Zusatz");
  assert.match(SKILL, /\(JJJJ-MM-TT\[, Nachtlauf\]\[, ohne Synthese-Pruefung\]\)/,
    "die vollstaendige Klammer-Form des Markers fehlt");
});

test("[skills-12] Befund und Ausfall wirken in beiden Betriebsarten wie ok: false", () => {
  const idx = schritt6.indexOf("Synthese-Pruefung");
  assert.notEqual(idx, -1, "die Synthese-Pruefung kommt in Schritt 6 nicht vor");
  const abschnitt = schritt6.slice(idx);
  assert.match(abschnitt, /Schreibbefehle 1 bis 5/,
    "unbeaufsichtigt laufen dieselben Schreibbefehle wie bei `ok: false` — das fehlt");
  assert.match(abschnitt, /kit:klaeren/, "das Zeichnen mit kit:klaeren fehlt");
  assert.match(abschnitt, /ohne Rückfrage/i,
    "interaktiv wird das Label ohne Rueckfrage gesetzt — das fehlt");
  assert.match(abschnitt, /kein zweiter Versuch/i,
    "dass ein Ausfall nicht wiederholt wird, fehlt");
  assert.match(abschnitt, /kein Ersatz-Pruefer/i,
    "dass kein Ersatz-Pruefer einspringt, fehlt");
});

test("[skills-12] bei rotem Beleg-Abgleich laeuft der Pruefer nicht", () => {
  const absatz = schritt6.split(/\n\n/).find(
    (a) => /Beleg-Abgleich rot|Abgleich rot/i.test(a)
  );
  assert.ok(absatz, "der Fall des roten Beleg-Abgleichs ist nicht geregelt");
  assert.match(absatz, /keine[\s\S]{0,40}zusätzliche Zeile|keine zusätzliche Zeile/i,
    "es steht nicht, dass dabei keine zusaetzliche Zeile entsteht");
});

test("[skills-12] die Marker-Regel nennt den Entfall als weder Ausfall noch Unterbesetzung", () => {
  const idx = SKILL.indexOf("**Der Marker wird gesetzt, wenn nichts zu ändern ist.**");
  assert.notEqual(idx, -1, "die Marker-Regel wurde nicht gefunden");
  const regel = SKILL.slice(idx, SKILL.indexOf("## Abschluss"));
  const satz = regel.split("\n").find(
    (z) => /Entfall/i.test(z) && /Ausfall/i.test(z) && /unterbesetz/i.test(z)
  );
  assert.ok(satz,
    "ohne diesen Satz haelt Bedingung 2 der Marker-Regel den Marker beim Entfall zurueck");
});

test("[skills-12] die Stop-Punkte tragen den Eintrag zur Synthese-Pruefung", () => {
  const stop = SKILL.slice(SKILL.indexOf("## Stop-Punkte"));
  const zeile = stop.split("\n").find(
    (z) => /Synthese-Prüfung|Synthese-Pruefung/.test(z) && /Marker/i.test(z)
  );
  assert.ok(zeile, "der Stop-Punkt zur Synthese-Pruefung fehlt");
  assert.match(zeile, /Entfall/i,
    "dass ein Entfall den Marker nicht zurueckhaelt, gehoert in denselben Eintrag");
});

test("[skills-12] die Doku nennt die Rolle, die drei Ausgaenge und die Ausnahme", () => {
  assert.match(DOKU, /`synthese`/, "die Rolle `synthese` fehlt in der Doku");
  for (const [was, muster] of [
    ["den Befund", /Befund/],
    ["den Entfall", /Entfall/i],
    ["den Ausfall", /Ausfall/i],
    ["den Marker-Zusatz", /ohne Synthese-Prüfung|ohne Synthese-Pruefung/],
  ]) {
    assert.match(DOKU, muster, `die Doku nennt ${was} nicht`);
  }
  const streich = DOKU.split(/\n\n/).find((a) => /Streich-Frage/.test(a) && /Jede Rolle/i.test(a));
  assert.ok(streich, "der Satz 'Jede Rolle trägt die Streich-Frage' fehlt in der Doku");
  assert.match(streich, /synthese/,
    "die Doku behauptet die Streich-Frage weiterhin fuer jede Rolle — `synthese` traegt sie nicht");
});
