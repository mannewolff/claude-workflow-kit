// Team- und persönliche Ebene in kit/einstellungen.mjs (Issue #676, Plan #674 E6).
//
// Dazu die einfachen Gruppen aus Issue #731 (Plan #721 E8): Eine persönliche Abweichung an
// einem einzelnen Feld legt das vollständige geltende Objekt ab, weil `mergeWorkflowConfig`
// ein Allowlist-Feld vollständig ersetzt. Die Folge davon steht mit im Test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  ebenen, aenderungAnwenden, mergeWorkflowConfig, projektZustand, speichere,
  gruppenZeilen, gruppeSetzen, GRUPPEN_AUSNAHMEN, SCHEMA,
} from "../kit/einstellungen.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const TRIGGER_SCHEMA = SCHEMA.properties.triggers;

/** Die Zeilen der Gruppe `triggers` zu einem Stand aus Team- und persönlicher Datei. */
function triggerZeilen(team, lokal) {
  return gruppenZeilen("triggers", TRIGGER_SCHEMA, ebenen(team, lokal).triggers, GRUPPEN_AUSNAHMEN.triggers);
}

const abweichende = (zeilen) => zeilen.filter((z) => z.abweichend).map((z) => z.feld);

/**
 * Ein Projekt mit der echten `.claude/workflow.config.json` dieses Repositories als Kopie.
 * Selbstgebaute Trigger prüften die eigene Annahme; hier läuft die Datei durch, die gilt.
 */
function mitEchterConfig(fn, lokal) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-gruppe-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-gruppe-home-"));
  try {
    const teamText = readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8");
    const pfad = projekt(wurzel, "echt", { teamText, stand: "5.0.0" });
    if (lokal !== undefined) writeFileSync(join(pfad, ".claude", "workflow.config.local.json"), lokal, "utf-8");
    return fn({ projekt: { name: "echt", pfad }, optionen: { home, eigenerStand: "5.0.0" }, pfad });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

const lokaleDatei = (pfad) => readFileSync(join(pfad, ".claude", "workflow.config.local.json"), "utf-8");

const TEAM = { codeHost: "github", reviewModel: "claude-opus-5", reviewScope: "diff", buildChecks: ["node --test"], toolbox: { host: "https://x" } };

test("[einstellungen-3] die drei Werte stehen, wo eine persönliche Abweichung erlaubt ist; sonst trägt der Team-Wert allein", () => {
  const e = ebenen(TEAM, { reviewScope: "full", toolbox: { tokenFile: ".tok" } });
  assert.deepEqual(e.reviewScope, { team: "diff", persoenlich: "full", gilt: "full", persoenlichErlaubt: true });
  assert.deepEqual(e["toolbox.tokenFile"], { team: undefined, persoenlich: ".tok", gilt: ".tok", persoenlichErlaubt: true });
  // Wo keine Abweichung erlaubt ist, gibt es nichts zu unterscheiden: Was gilt, ist der
  // Team-Wert — er steht unmittelbar in der Eingabe, nicht neben zwei weiteren Kästen
  // (Kriterium 4b der fachlichen Quelle #705).
  for (const pfad of ["codeHost", "buildChecks", "mainBranch"]) {
    assert.equal(e[pfad].persoenlichErlaubt, false, pfad);
    assert.equal(e[pfad].persoenlich, undefined, pfad);
    assert.deepEqual(e[pfad].gilt, e[pfad].team, `${pfad}: der geltende Wert ist der Team-Wert`);
  }
});

test("[einstellungen-3] persönlich speichern geht nur für Felder der Allowlist", () => {
  const r = aenderungAnwenden(TEAM, {}, { ebene: "persoenlich", aenderungen: [{ pfad: "buildChecks", wert: [] }] });
  assert.equal(r.ok, false);
  assert.match(r.grund, /buildChecks/);
  const gut = aenderungAnwenden(TEAM, {}, { ebene: "persoenlich", aenderungen: [{ pfad: "toolbox.tokenFile", wert: ".t" }] });
  assert.equal(gut.ok, true);
  assert.deepEqual(gut.lokal, { toolbox: { tokenFile: ".t" } });
  assert.deepEqual(gut.team, TEAM, "die Team-Datei bleibt unberührt");
});

test("[einstellungen-3] eine Team-Änderung lässt die persönliche Datei unberührt", () => {
  const lokal = { reviewScope: "full" };
  const r = aenderungAnwenden(TEAM, lokal, { ebene: "team", aenderungen: [{ pfad: "codeHost", wert: "gitlab" }] });
  assert.equal(r.ok, true);
  assert.equal(r.team.codeHost, "gitlab");
  assert.deepEqual(r.lokal, lokal);
});

test("[einstellungen-3] nach dem Entfernen einer Abweichung gilt wieder der Teamwert, auch beim Reviewer-Paar", () => {
  const lokal = { reviewScope: "full", reviewCommand: "codex exec" };
  assert.equal(ebenen(TEAM, lokal).reviewModel.gilt, undefined, "lokales reviewCommand verdrängt reviewModel");
  const r = aenderungAnwenden(TEAM, lokal, { ebene: "persoenlich", entfernt: ["reviewScope", "reviewCommand"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lokal, {});
  const e = ebenen(r.team, r.lokal);
  assert.equal(e.reviewScope.gilt, "diff");
  assert.equal(e.reviewModel.gilt, "claude-opus-5");
  const blatt = aenderungAnwenden(TEAM, { toolbox: { tokenFile: ".t" } }, { ebene: "persoenlich", entfernt: ["toolbox.tokenFile"] });
  assert.deepEqual(blatt.lokal, {}, "ein leerer Kopf fällt mit weg");
});

// ------------------------------------------------------------
// M7 Einfache Gruppen (Issue #731, Plan #721 E8)
// ------------------------------------------------------------

test("[einstellungen-3] eine Gruppe führt ein Feld je Eigenschaft, aber keins mit eigenem Teil", () => {
  const team = { triggers: { go: "GO", push: "push main", merge: "merge production" }, toolbox: { host: "https://x", tokenFile: ".tok" } };
  assert.deepEqual(triggerZeilen(team, null).map((z) => z.feld), ["go", "push", "merge"]);
  // `toolbox.tokenFile` steht in der Allowlist und hat eine eigene Eingabe — zweimal
  // bearbeitbar wäre es zweimal wahr, und in der Gruppe ohne persönliche Abweichung.
  assert.deepEqual(GRUPPEN_AUSNAHMEN.toolbox, ["tokenFile"]);
  assert.deepEqual(GRUPPEN_AUSNAHMEN.triggers, []);
  const felder = gruppenZeilen("toolbox", SCHEMA.properties.toolbox, ebenen(team, null).toolbox, GRUPPEN_AUSNAHMEN.toolbox).map((z) => z.feld);
  assert.ok(!felder.includes("tokenFile"), felder.join(", "));
  assert.ok(felder.includes("host"), felder.join(", "));
});

test("[einstellungen-3] eine Abweichung an einem Feld legt das vollständige geltende Objekt persönlich ab", () => {
  const team = { triggers: { go: "GO", push: "push main", merge: "merge production" } };
  const gesetzt = gruppeSetzen(team.triggers, ebenen(team, null).triggers.gilt, "push", "pushen");
  // Nicht `{push: "pushen"}`: mergeWorkflowConfig ersetzt ein Allowlist-Feld vollständig,
  // `go` und `merge` blieben sonst ungesetzt (Plan #721 E8).
  assert.deepEqual(gesetzt.wert, { go: "GO", push: "pushen", merge: "merge production" });
  const angewandt = aenderungAnwenden(team, null, { ebene: "persoenlich", aenderungen: [{ pfad: "triggers", wert: gesetzt.wert }] });
  assert.equal(angewandt.ok, true);
  assert.deepEqual(mergeWorkflowConfig(angewandt.team, angewandt.lokal).config.triggers, gesetzt.wert);
  // Als persönlich markiert und mit „zurücksetzen" versehen ist nur die abweichende Zeile.
  assert.deepEqual(abweichende(triggerZeilen(angewandt.team, angewandt.lokal)), ["push"]);
});

test("[einstellungen-3] das Zurücksetzen der letzten Abweichung nimmt den Eintrag ganz weg", () => {
  const team = { triggers: { go: "GO", push: "push main", merge: "merge production" } };
  const persoenlich = { go: "GO", push: "pushen", merge: "merge production" };
  assert.deepEqual(gruppeSetzen(team.triggers, persoenlich, "push", undefined), { entfernen: true });
  // Ein leeres Feld heißt „wie Team" — derselbe Weg wie der Knopf.
  assert.deepEqual(gruppeSetzen(team.triggers, persoenlich, "push", ""), { entfernen: true });
  // Solange eine zweite Zeile abweicht, bleibt der Eintrag stehen.
  const zwei = { go: "LOS", push: "pushen", merge: "merge production" };
  assert.deepEqual(gruppeSetzen(team.triggers, zwei, "push", undefined), { wert: { go: "LOS", push: "push main", merge: "merge production" } });
});

test("[einstellungen-3] die Folge aus Plan E8 an der echten Einstellungsdatei dieses Projekts", () => {
  mitEchterConfig(({ projekt: p, optionen, pfad }) => {
    const stand = () => projektZustand(p, optionen);
    const dateien = () => {
      const team = JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8"));
      const lokal = JSON.parse(lokaleDatei(pfad));
      return { team, lokal };
    };

    // 1. Persönliche Abweichung an triggers.push.
    const team0 = JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8"));
    const gesetzt = gruppeSetzen(team0.triggers, ebenen(team0, null).triggers.gilt, "push", "pushen");
    const r1 = speichere(p, { ebene: "persoenlich", teil: "m7", aenderungen: [{ pfad: "triggers", wert: gesetzt.wert }], hashes: stand().hashes }, optionen);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.deepEqual(dateien().lokal.triggers, { go: "GO", push: "pushen", merge: "merge production" });

    // 2. Das Team ändert danach triggers.go — ein Feld, von dem niemand abweichen wollte.
    const nachGo = { ...team0.triggers, go: "LOS" };
    const r2 = speichere(p, { ebene: "team", teil: "m7", aenderungen: [{ pfad: "triggers", wert: nachGo }], hashes: stand().hashes }, optionen);
    assert.equal(r2.status, 200, JSON.stringify(r2.body));

    // 3. Die Zeile `go` weicht jetzt ab und trägt „zurücksetzen" — sichtbar, nicht still.
    const { team, lokal } = dateien();
    assert.deepEqual(abweichende(triggerZeilen(team, lokal)), ["go", "push"]);
    // Und kein Feld bleibt ungesetzt: Genau dafür steht das vollständige Objekt dort.
    assert.deepEqual(mergeWorkflowConfig(team, lokal).config.triggers, { go: "GO", push: "pushen", merge: "merge production" });
  });
});

test("[einstellungen-3] das Zurücksetzen entfernt triggers aus der persönlichen Datei und lässt sie sonst unverändert", () => {
  const lokalText = `{
  "reviewScope": "full",
  "triggers": {
    "go": "GO",
    "push": "pushen",
    "merge": "merge production"
  }
}
`;
  mitEchterConfig(({ projekt: p, optionen, pfad }) => {
    const team = JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8"));
    assert.deepEqual(abweichende(triggerZeilen(team, JSON.parse(lokalText))), ["push"], "die Ausgangslage weicht in genau einer Zeile ab");
    assert.deepEqual(gruppeSetzen(team.triggers, JSON.parse(lokalText).triggers, "push", undefined), { entfernen: true });

    const r = speichere(p, { ebene: "persoenlich", teil: "m7", entfernt: ["triggers"], hashes: projektZustand(p, optionen).hashes }, optionen);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(lokaleDatei(pfad), `{
  "reviewScope": "full"
}
`, "der Rest der persönlichen Datei hat sich geändert");
    assert.equal(ebenen(JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8")), JSON.parse(lokaleDatei(pfad))).triggers.gilt.push, "push main");
  }, lokalText);
});
