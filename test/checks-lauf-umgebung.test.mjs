// Pruefkommandos erben die Umgebung des Nachtlaufs nicht (Issue #1282).
//
// Der Runner gibt seinen Sessions Variablen mit (`sessionUmgebung`, `runSession`, die Kette),
// und die Session startet ihre Pruefungen mit `checks.mjs`. Ohne Abschottung erbten die
// Kommandos aus `buildChecks` diese Variablen, und Tests, die selbst einen Lauf nachstellen,
// liefen nachts rot — etwa mit `stufe=vorbereitung` statt `stufe=unset`. Entfernt werden genau
// die Namen aus `LAUF_VARIABLEN`; eigene `KIT_*`-Variablen wie `KIT_ROOT` bleiben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUF_VARIABLEN, sessionUmgebung } from "../kit/night/session.mjs";
import { checksMit, mitRepo, datei } from "./helpers/checks-repo.mjs";

/** Ein Pruefkommando, das seine Umgebung als JSON nach `umgebung.json` schreibt. */
const UMGEBUNG_SCHREIBEN = `node -e "require('fs').writeFileSync('umgebung.json', JSON.stringify(process.env))"`;

const umgebungImKind = (dir) => JSON.parse(readFileSync(join(dir, "umgebung.json"), "utf-8"));

test("[1282] ein Pruefkommando erbt die Variablen des Nachtlaufs nicht, KIT_ROOT bleibt", async () => {
  const config = { buildChecks: [UMGEBUNG_SCHREIBEN] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await checksMit(dir, {
      env: { NIGHT_KETTE_STUFE: "vorbereitung", KIT_NIGHT_RUN: "1", NIGHT_ISSUE_ID: "1", KIT_ROOT: dir },
    }, "run", "--frisch");

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const kind = umgebungImKind(dir);
    assert.equal(kind.NIGHT_KETTE_STUFE, undefined, "NIGHT_KETTE_STUFE wurde vererbt");
    assert.equal(kind.KIT_NIGHT_RUN, undefined, "KIT_NIGHT_RUN wurde vererbt");
    assert.equal(kind.NIGHT_ISSUE_ID, undefined, "NIGHT_ISSUE_ID wurde vererbt");
    assert.equal(kind.KIT_ROOT, dir, "KIT_ROOT fehlt im Kind");
  });
});

test("[1282] eine im Eintrag ausdruecklich gesetzte Variable bleibt", async () => {
  const config = { buildChecks: [`NIGHT_ISSUE_ID=7 ${UMGEBUNG_SCHREIBEN}`] };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "src/x.txt");

    const res = await checksMit(dir, { env: { NIGHT_ISSUE_ID: "1" } }, "run", "--frisch");

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    assert.equal(umgebungImKind(dir).NIGHT_ISSUE_ID, "7");
  });
});

test("[1282] Waechter: jeder Name, den der Runner einer Session setzt, steht in LAUF_VARIABLEN", () => {
  // Das Beispiel nennt jeden Namen, den ein Aufrufer als `extraEnv` mitgibt: `runSession`
  // (session.mjs), die Kette (kette.mjs), die Salvage-Session (wartend.mjs) und der Vorflug.
  const extraEnv = {
    NIGHT_PROMPT: "/implement-next #1", KIT_AGENT_MODEL: "m", NIGHT_KETTE_STUFE: "umsetzung",
    KIT_STAND: "abc", KIT_STAND_PFAD: "kitstand", KIT_NIGHT_RUN: "2026-01-01T00:00:00.000Z",
    BASH_MAX_TIMEOUT_MS: "1", BASH_DEFAULT_TIMEOUT_MS: "1",
    KIT_PLAN_REVIEWER: "1", NIGHT_SALVAGE: "1", NIGHT_VORFLUG: "1",
  };
  const fehlend = Object.keys(sessionUmgebung(1, extraEnv, {})).filter((name) => !LAUF_VARIABLEN.includes(name));
  assert.deepEqual(fehlend, [], `ohne Eintrag in LAUF_VARIABLEN: ${fehlend.join(", ")}`);
  assert.ok(Object.isFrozen(LAUF_VARIABLEN), "LAUF_VARIABLEN ist nicht eingefroren");
});
