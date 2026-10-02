// Kriterium 7 der fachlichen Quelle #1094, nachgestellt (Issue #1102, Plan #1101 E8).
//
// Fall 1: Eine Umsetzungsnacht mit zwei Paketen. Das erste aendert das Pruefwerkzeug
// (`kit/checks.mjs`) und das Gate, frischt die Kopie mit `sync-blobs` auf und committet.
// Das zweite muss trotzdem mit dem unveraenderten Werkzeug arbeiten und vom Gate des
// Pushs geprueft werden. Ohne festen Stand saehe es beides neu: `sync-blobs` schriebe die
// Kopie, und der Hook der Hauptkopie startete ihr geaendertes Gate.
//
// Fall 2: Ein Prueflauf. Waehrend seiner Sitzung aendert der Mensch in der Hauptkopie den
// Skill `/issue-review` und frischt seine Kopie auf. Die Sitzung im Worktree liest weiter
// den Skill des Pushs — auch den Tagstand davor sieht sie nicht.
//
// Beide Faelle laufen mit dem echten Runner im Fixture aus helpers/kitstand-fixture.mjs,
// Sitzungen ueber NIGHT_CLAUDE_CMD. Was die Sitzungen sehen, schreiben sie in eine Spur.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Der Runner faehrt ueber die Sitzungen `checks.mjs run`: ein eigener Sperrpfad je Testprozess (Issue #958).
import "./helpers/checks-sperre.mjs";

import { KIT_STAND_MARKIERUNG } from "../kit/night.mjs";
import {
  NUR_POSIX, VORFLUG_OK, RESULT, GATE_MARKE, kitFixture, git, sha256, syncBlobs, runner, board, laufStand,
  standWorktrees, aufraeumen,
} from "./helpers/kitstand-fixture.mjs";

function spurZeilen(pfad) {
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n").filter(Boolean) : [];
}

/**
 * Schreibt den sha256 einer Datei als `<name> <hash>` in die Spur. `pfad` ist ein
 * JavaScript-Ausdruck, relativ zum cwd der Sitzung oder ueber `process.env` gebildet.
 */
function hashInSpur(name, pfad) {
  return `node -e 'const c=require("crypto"),f=require("fs");f.appendFileSync(process.env.BELEG_SPUR,"${name} "+c.createHash("sha256").update(f.readFileSync(${pfad})).digest("hex")+"\\n")'`;
}

/** Ein Abschluss wie in /implement-next: pruefen, gezielt stagen, committen, melden. */
function abschluss(dateien) {
  return [
    'node .claude/kit/checks.mjs run --abschluss "$NIGHT_ISSUE_ID" >/dev/null',
    `git add ${dateien}`,
    'git commit -q -m "Paket $NIGHT_ISSUE_ID (Issue #$NIGHT_ISSUE_ID)"',
    'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review >/dev/null',
  ].join(" && ");
}

test("[kitstand-7] Fall 1: das zweite Paket einer Nacht arbeitet mit Werkzeug und Gate des Pushs, nicht mit dem des ersten", NUR_POSIX, () => {
  const fx = kitFixture({ praefix: "kitbeleg1-" });
  const { dir } = fx;
  try {
    const spur = join(dir, "helfer", "spur");
    const erstes = board(dir, "issue", "create", "--title", "Pruefwerkzeug aendern", "--body", "## Abhaengigkeiten\nKeine.").id;
    const zweites = board(dir, "issue", "create", "--title", "Etwas anderes bauen", "--body", "## Abhaengigkeiten\nKeine.").id;
    for (const id of [erstes, zweites]) board(dir, "issue", "move", String(id), "ready");

    const paket1 = [
      // Das Pruefwerkzeug und das Gate werden geaendert und die Kopie aufgefrischt —
      // genau der Weg, auf dem heute ein neues Werkzeug das naechste Paket erreicht.
      `printf '\\n// geaendert von Paket 1\\n' >> kit/checks.mjs`,
      `node -e 'const f=require("fs");const p=".githooks/gate.mjs";f.writeFileSync(p,f.readFileSync(p,"utf8").replace("${GATE_MARKE}","gate-neu"))'`,
      "node tools/sync-blobs.mjs >/dev/null",
      abschluss("kit/checks.mjs .githooks/gate.mjs install.mjs"),
    ].join(" && ");
    const paket2 = [
      hashInSpur("checks", '".claude/kit/checks.mjs"'),
      'echo arbeit > "arbeit-$NIGHT_ISSUE_ID.txt"',
      abschluss('"arbeit-$NIGHT_ISSUE_ID.txt"'),
    ].join(" && ");
    const fake = [
      'case "$NIGHT_ISSUE_ID" in',
      `  ${erstes}) ${paket1} ;;`,
      `  ${zweites}) ${paket2} ;;`,
      "esac",
      RESULT,
    ].join("\n");

    const ausOrigin = sha256(readFileSync(join(dir, "kit", "checks.mjs")));
    const res = runner(dir, ["--label", "none", "--max", "2"], { NIGHT_CLAUDE_CMD: fake, BELEG_SPUR: spur });
    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen:\n${res.stdout}\n${res.stderr}`);
    for (const id of [erstes, zweites]) {
      assert.equal(board(dir, "issue", "get", String(id)).status, "in_review", `#${id} steht nicht in In review`);
    }

    // Das erste Paket hat das Werkzeug wirklich geaendert und committet.
    const geaendert = sha256(readFileSync(join(dir, "kit", "checks.mjs")));
    assert.notEqual(geaendert, ausOrigin, "Paket 1 hat kit/checks.mjs nicht geaendert");
    assert.match(git(dir, "log", "--format=%s"), /Paket/);

    const zeilen = spurZeilen(spur);
    const checks = zeilen.filter((z) => z.startsWith("checks "));
    assert.deepEqual(checks, [`checks ${ausOrigin}`], "das zweite Paket sah das Pruefwerkzeug des Pushs");

    const gates = zeilen.filter((z) => z.startsWith("gate "));
    assert.equal(gates.length, 2, `je Commit genau ein Gate-Lauf erwartet: ${zeilen.join(" | ")}`);
    const [stand] = standWorktrees(dir);
    for (const zeile of gates) {
      assert.match(zeile, new RegExp(`^gate ${GATE_MARKE} `), `ein anderes als das Gate des Pushs lief: ${zeile}`);
      assert.ok(zeile.includes("/kitstand-implementierung-"), `das Gate lief nicht aus dem Stand: ${zeile}`);
    }
    assert.ok(stand, "kein Stand-Worktree");

    // Nach dem Lauf: Markierung weg, die Kopie bleibt auf dem Stand (E5), der Baum sauber.
    assert.equal(existsSync(join(dir, KIT_STAND_MARKIERUNG)), false);
    assert.equal(sha256(readFileSync(join(dir, ".claude", "kit", "checks.mjs"))), ausOrigin);
    assert.equal(git(dir, "status", "--porcelain", "--", ".", ":!issues"), "", "der Arbeitsbaum ist sauber");
    assert.equal(laufStand(dir).kitStand.commit, git(dir, "rev-parse", "refs/remotes/origin/main"));
  } finally {
    aufraeumen(fx);
  }
});

test("[kitstand-7] Fall 2: ein Prueflauf liest den Skill des Pushs, auch wenn der Mensch ihn waehrenddessen aendert", NUR_POSIX, () => {
  const fx = kitFixture({ praefix: "kitbeleg2-", config: {
    pruefLauf: { label: "kit:pruefen", pruefungMin: 5, kostenUsd: 25 },
    issueReview: { reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }] },
  } });
  const { dir } = fx;
  try {
    const spur = join(dir, "helfer", "spur");
    const skill = join(dir, "skills", "issue-review", "SKILL.md");
    const ausOrigin = sha256(readFileSync(skill));

    // Der Tagstand vor dem Lauf: geaendert und installiert, nicht gepusht.
    writeFileSync(skill, `${readFileSync(skill, "utf-8")}\nTagstand 1\n`);
    syncBlobs(dir);

    const karte = board(dir, "issue", "create", "--title", "[Fachlich] Ein Anliegen", "--body",
      "## Ziel\n\nEin Anliegen.\n\n## Fachliche Akzeptanzkriterien\n\n- Eines.\n").id;
    board(dir, "issue", "label", "add", String(karte), "kit:pruefen");

    // Die Sitzung laeuft im Worktree. Waehrend sie laeuft, aendert der Mensch in der
    // Hauptkopie den Skill erneut und frischt seine Kopie auf; dann liest die Sitzung.
    const fake = [
      `node -e 'const f=require("fs");const p=process.env.BELEG_HAUPT+"/skills/issue-review/SKILL.md";f.appendFileSync(p,"Tagstand 2\\n")'`,
      '(cd "$BELEG_HAUPT" && node tools/sync-blobs.mjs >/dev/null)',
      hashInSpur("worktree", '".claude/skills/issue-review/SKILL.md"'),
      hashInSpur("haupt", 'process.env.BELEG_HAUPT+"/.claude/skills/issue-review/SKILL.md"'),
      'pwd -P >> "$BELEG_SPUR"',
      RESULT,
    ].join("\n");

    const res = runner(dir, ["--pruefen"], {
      NIGHT_CLAUDE_CMD: fake, NIGHT_VORFLUG_CMD: VORFLUG_OK, BELEG_SPUR: spur, BELEG_HAUPT: dir,
    });
    assert.equal(res.status, 0, `der Prueflauf haette durchlaufen muessen:\n${res.stdout}\n${res.stderr}`);

    const zeilen = spurZeilen(spur);
    const haupt = zeilen.find((z) => z.startsWith("haupt "));
    const worktree = zeilen.find((z) => z.startsWith("worktree "));
    assert.ok(haupt && worktree, `die Sitzung lief nicht: ${zeilen.join(" | ")}`);
    assert.equal(haupt, `haupt ${sha256(readFileSync(skill))}`, "die Kopie der Hauptkopie traegt den neuen Tagstand");
    assert.equal(worktree, `worktree ${ausOrigin}`, "die Sitzung im Worktree las den Skill des Pushs");
    assert.ok(zeilen.some((z) => z.includes("/pruefung-")), `die Sitzung lief nicht im Worktree: ${zeilen.join(" | ")}`);
    assert.equal(laufStand(dir).kitStand.commit, git(dir, "rev-parse", "refs/remotes/origin/main"));
    assert.ok(standWorktrees(dir).some((p) => p.includes("/kitstand-pruefung-")), "kein Stand des Prueflaufs");
  } finally {
    aufraeumen(fx);
  }
});
