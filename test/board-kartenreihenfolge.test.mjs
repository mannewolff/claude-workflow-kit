// Schutztest der Kartenreihenfolge des lokalen Datei-Trackers (Issue #956).
//
// `LocalIssueTracker._allFiles` sortierte die Issue-Dateien mit einem blossen
// `.sort()` und trug dazu die Zusage "aufsteigend nach Dateiname = aufsteigend
// nach id". Die Leitplanke gegen S2871 (eslint.config.mjs) verlangt dort jetzt
// eine Vergleichsfunktion — und eine falsch gewaehlte aenderte genau diese
// Zusage, ohne dass ein Test es merkte. Die Kartenreihenfolge ist die Reihenfolge,
// in der `/implement-ready` und der Nacht-Runner Arbeitspakete abarbeiten; sie
// still zu verdrehen waere der teuerste Fehler dieser Umstellung.
//
// Geprueft wird deshalb der Wert, nicht der Weg: Die Liste kommt aufsteigend nach
// Zahl heraus, auch ueber die Padding-Grenze hinweg (0009 -> 0010 -> 0100).

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, board } from "./helpers/board-fixture.mjs";

const CONFIG = { issueTracker: "local", codeHost: "local", local: { issuesDir: "issues" } };

/** Legt die Issue-Datei direkt an — so, wie `padId` sie benennt. */
function karte(dir, id, titel) {
  writeFileSync(
    join(dir, "issues", `${String(id).padStart(4, "0")}.md`),
    `---\nid: ${id}\ntitle: ${titel}\nstatus: backlog\ntype: task\n---\n\nBody ${id}\n`,
  );
}

test("[956] die Kartenliste kommt aufsteigend nach id — auch ueber die Padding-Grenze", () => {
  const dir = setupProjekt(CONFIG, "board-reihenfolge-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  // Bewusst in verwuerfelter Anlagereihenfolge und ueber die Stellenzahlen hinweg:
  // 9 -> 10 waere bei einer Sortierung ohne Padding die Stelle, an der es kippt.
  for (const id of [100, 9, 1, 1000, 10, 99]) karte(dir, id, `Karte ${id}`);

  const liste = board(dir, "issue", "list");
  assert.deepEqual(liste.map((i) => i.id), ["1", "9", "10", "99", "100", "1000"]);
});
