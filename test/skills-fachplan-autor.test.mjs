// Autor-Modell-Zeile im Story-Format von /fachplan (Issue #273).
//
// Seit Issue #266 lehnt `board.mjs issue create` jeden Body ohne die Zeile
// `Autor-Modell:` ab. Die Leitplanke greift fuer JEDES Issue, auch fuer fachliche
// — beim Bau von #266 stand dort ausdruecklich, /fachplan bleibe unangetastet.
// Am 2026-08-08 lief das Anlegen von Issue #272 deshalb in einen Fehler, den der
// Skill-Text selbst nicht erklaerte.
//
// Geprueft wird der Skill-TEXT, nicht Code: /fachplan ist eine Anweisung an ein
// Modell, und was dort nicht steht, passiert nicht. Die Tests haengen sich
// deshalb an die Stellen, die eine Session tatsaechlich liest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(repoRoot, "skills", "fachplan", "SKILL.md");

function text() {
  return readFileSync(SKILL, "utf-8");
}

/** Der einzige markdown-Block, der das Story-Format zeigt. */
function storyFormatBlock(t) {
  const bloecke = [...t.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);
  const treffer = bloecke.filter((b) => b.includes("## Ziel") && b.includes("## Fachliche Akzeptanzkriterien"));
  assert.equal(treffer.length, 1, `genau ein Story-Formatblock erwartet, gefunden: ${treffer.length}`);
  return treffer[0];
}

test("Story-Format enthaelt genau eine Autor-Modell-Zeile zwischen Ziel und Akzeptanzkriterien", () => {
  const block = storyFormatBlock(text());
  const zeilen = block.split("\n");
  const idxZiel = zeilen.findIndex((z) => z.trim() === "## Ziel");
  const idxKriterien = zeilen.findIndex((z) => z.trim() === "## Fachliche Akzeptanzkriterien");
  assert.ok(idxZiel >= 0 && idxKriterien > idxZiel, "Ziel und Akzeptanzkriterien in dieser Reihenfolge erwartet");

  const treffer = zeilen.filter((z) => /^Autor-Modell:/.test(z.trim()));
  assert.equal(treffer.length, 1, `genau eine Autor-Modell-Zeile erwartet, gefunden: ${treffer.length}`);

  const idxAutor = zeilen.findIndex((z) => /^Autor-Modell:/.test(z.trim()));
  assert.ok(
    idxAutor > idxZiel && idxAutor < idxKriterien,
    "die Zeile muss im Abschnitt ## Ziel stehen, nicht irgendwo im Text"
  );
});

test("alle drei Stufen der Wertermittlung sind genannt, einschliesslich unbekannt", () => {
  const t = text();
  assert.match(t, /KIT_AGENT_MODEL/, "erste Stufe fehlt");
  assert.match(t, /Selbstauskunft der Session/, "zweite Stufe fehlt");
  assert.match(t, /`unbekannt`/, "dritte Stufe fehlt — sie war in der urspruenglichen Fassung ausgelassen");
});

test("die Begruendung steht als zusammenhaengende Aussage, nicht als Stichwort", () => {
  const t = text();
  const satz = t.split(/\n\n/).find((a) => /nicht bestimmbar/.test(a) && /pruefen darf|prüfen darf/.test(a));
  assert.ok(satz, "kein Absatz gefunden, der Unbestimmbarkeit und Pruefberechtigung zusammen nennt");
  assert.match(satz, /eigenes Dokument|eigene Dokument/, "der Selbstpruefungs-Fall muss benannt sein");
});

test("das Anlege-Kommando nutzt stdin mit quotiertem Heredoc, nie --body mit Wert", () => {
  const t = text();
  const bashBloecke = [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const anlegen = bashBloecke.filter((b) => /issue create/.test(b));
  assert.ok(anlegen.length >= 1, "kein Anlege-Kommando gefunden");

  for (const block of anlegen) {
    assert.match(block, /--body\s+-/, "das Anlege-Kommando muss --body - verwenden (Issue #271)");
    assert.match(block, /<<'[A-Z]+'/, "quotierter Heredoc erwartet, damit die Shell Backticks nicht auswertet");
    // Jedes --body, dessen Wert nicht genau "-" ist, faellt durch. Erfasst auch
    // einfache Anfuehrungszeichen und mehrzeilige Varianten, an denen eine
    // Pruefung auf die exakte alte Schreibweise vorbeigelaufen waere.
    const falsch = [...block.matchAll(/--body\s+(?!-\s|-$)(\S+)/g)].map((m) => m[1]);
    assert.deepEqual(falsch, [], `--body mit anderem Wert als '-' gefunden: ${falsch.join(", ")}`);
  }
});

test("die veraltete Werkzeug-Einschraenkung ist vollstaendig entfernt", () => {
  const t = text();
  for (const wendung of ["Werkzeug-Einschränkung", "vollständig im Chat", "der Mensch fügt ihn im Board ein"]) {
    assert.ok(!t.includes(wendung), `veraltete Wendung steht noch im Skill: "${wendung}"`);
  }
  assert.ok(
    !/nur `create`, `get`, `list`, `move`, `comment`/.test(t),
    "die veraltete Befehlsliste steht noch im Skill"
  );
});

test("der Ersatz nennt issue update als Weg, einen gegroomten Body zu schreiben", () => {
  const t = text();
  assert.match(t, /issue update <id> --body-file|issue update <id> --body -/,
    "ohne Ersatz fehlt die einzige Stelle, die sagt, wie ein Body ins Board kommt");
});

// Der schaerfste Fund des Reviews zu diesem Issue: issue update ruft
// autorModellSicherstellen NICHT auf. Eine Grooming-Session kann die Zeile beim
// Body-Rewrite also stillschweigend verlieren — ausgerechnet die Zeile, um die es
// in diesem Issue geht.
test("der Skill warnt, dass die Autor-Modell-Zeile beim Body-Rewrite erhalten bleiben muss", () => {
  const t = text();
  const absatz = t.split(/\n\n/).find((a) => /issue update/.test(a) && /Autor-Modell/.test(a));
  assert.ok(absatz, "kein Absatz verbindet issue update mit dem Erhalt der Autor-Modell-Zeile");
  assert.match(absatz, /erhalten|bleibt|verliert/, "der Absatz muss die Erhaltungspflicht aussprechen");
});

// Kein Abgleich mit .claude/skills/ mehr: die Kopie dort ist Installer-Ausgabe und
// nicht versioniert (install.mjs schreibt sie bei jedem Lauf neu). Dass der Blob in
// install.mjs zur Quelle unter skills/ passt, bewacht tools/sync-blobs.mjs --check.
