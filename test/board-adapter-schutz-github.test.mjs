// Die Schutz-Operationen des Code-Host-Adapters (Issue #1406, Plan #1405).
//
// Der Schutz von Haupt- und Veroeffentlichungszweig laeuft ueber GitHub-Rulesets (A1).
// Alle Host-Details liegen im Adapter; die Schutz-Logik ruft nur seine Operationen. Hier
// steht, welche `gh`- und `git`-Aufrufe sie absetzen, und dass `getCiStatus` mit Zweig nur
// die Laeufe dieses Zweigs zaehlt (A3): Am Kopf von `origin/main` haengen Laeufe anderer
// Ausloeser, die die Probe sonst zur Pflichtpruefung machte.
//
// gh und git laufen als Fake-Binary im PATH, dieselbe Faelschung wie in
// `board-adapter-ci-status-github.test.mjs` (E12): kein Netz, kein Token.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { BoardError } from "../kit/board/grundlagen.mjs";
import { resolveCodeHost } from "../kit/board/adapter.mjs";
import { setupProjekt, fakeCli, imProjekt, aufrufZeilen, aufrufEingaben } from "./helpers/adapter-fixture.mjs";
import { SHA } from "./helpers/board-ci-fixture.mjs";

const GITHUB = { codeHost: "github", issueTracker: "github" };
const REPO = "o/r";
const REPO_REGEL = { match: "^repo view", stdout: `${REPO}\n` };

/** Fuehrt `fn(host)` gegen gefaelschte CLIs aus und liefert Ergebnis und Mitschrift. */
async function mitHost(config, clis, fn) {
  const dir = setupProjekt(config, "board-schutz-");
  for (const [name, regeln] of Object.entries(clis)) fakeCli(dir, name, regeln);
  try {
    const ergebnis = await imProjekt(dir, () => fn(resolveCodeHost(config)));
    const zeilen = Object.fromEntries(Object.keys(clis).map((n) => [n, aufrufZeilen(dir, n)]));
    const eingaben = Object.fromEntries(Object.keys(clis).map((n) => [n, aufrufEingaben(dir, n)]));
    return { ergebnis, zeilen, eingaben };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- getCiStatus mit Zweig (A3) ---

test("[schutz-adapter] getCiStatus mit Zweig filtert per --branch und zaehlt nur Laeufe dieses Zweigs", async () => {
  const { ergebnis, zeilen } = await mitHost(GITHUB, {
    gh: [
      { match: "^run list", stdout: [
        { databaseId: 1, workflowName: "CI", headBranch: "kit-pruefung", conclusion: "success", status: "completed" },
        { databaseId: 2, workflowName: "SonarQube", headBranch: "main", conclusion: "success", status: "completed" },
      ] },
      { match: "^run view 1 ", stdout: { jobs: [{ name: "check", conclusion: "success", status: "completed" }] } },
      { match: "^run view 2 ", stdout: { jobs: [{ name: "sonar", conclusion: "failure", status: "completed" }] } },
    ],
  }, (host) => host.getCiStatus(SHA, "kit-pruefung"));

  assert.deepEqual(ergebnis, { status: "gruen", jobs: [{ name: "check", ergebnis: "gruen", gestartet: null }] });
  assert.match(zeilen.gh[0], new RegExp(`^run list .*--branch kit-pruefung .*--commit ${SHA}`));
  assert.match(zeilen.gh[0], /--json \S*headBranch/);
  // Der fremde Lauf wird nicht einmal im Detail abgefragt.
  assert.equal(zeilen.gh.some((z) => z.startsWith("run view 2")), false);
});

test("[schutz-adapter] getCiStatus mit Zweig: nur fremde Laeufe am Commit ergeben laeuft ohne Jobs", async () => {
  const { ergebnis } = await mitHost(GITHUB, {
    gh: [{ match: "^run list", stdout: [
      { databaseId: 2, workflowName: "SonarQube", headBranch: "main", conclusion: "success", status: "completed" },
    ] }],
  }, (host) => host.getCiStatus(SHA, "kit-pruefung"));
  assert.deepEqual(ergebnis, { status: "laeuft", jobs: [] });
});

test("[schutz-adapter] getCiStatus ohne Zweig setzt kein --branch ab", async () => {
  const { zeilen } = await mitHost(GITHUB, {
    gh: [{ match: "^run list", stdout: [] }],
  }, (host) => host.getCiStatus(SHA));
  assert.equal(zeilen.gh[0], `run list --commit ${SHA} --json databaseId,workflowName,conclusion,status`);
});

// --- getRulesets (A1) ---

const LISTE = [
  { id: 11, name: "claude-workflow-kit: main", enforcement: "active" },
  { id: 12, name: "Team-Regel", enforcement: "active" },
  { id: 13, name: "claude-workflow-kit: production", enforcement: "disabled" },
];

function detail(id, name, zweig, enforcement, rules) {
  return {
    id, name, enforcement, target: "branch", bypass_actors: [],
    conditions: { ref_name: { include: [`refs/heads/${zweig}`], exclude: [] } },
    rules,
  };
}

const PRUEFREGEL = {
  type: "required_status_checks",
  parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "check" }] },
};

test("[schutz-adapter] getRulesets liefert nur die Rulesets des Kits, samt Zweig, Regeln und Pflichtpruefungen", async () => {
  const { ergebnis, zeilen } = await mitHost(GITHUB, {
    gh: [
      REPO_REGEL,
      { match: `^api repos/${REPO}/rulesets/11`, stdout: detail(11, "claude-workflow-kit: main", "main", "active",
        [PRUEFREGEL, { type: "non_fast_forward" }, { type: "deletion" }]) },
      { match: `^api repos/${REPO}/rulesets/13`, stdout: detail(13, "claude-workflow-kit: production", "production",
        "disabled", [{ type: "pull_request", parameters: { required_approving_review_count: 0 } }]) },
      { match: `^api repos/${REPO}/rulesets`, stdout: LISTE },
    ],
  }, (host) => host.getRulesets());

  assert.deepEqual(ergebnis.map((r) => r.name), ["claude-workflow-kit: main", "claude-workflow-kit: production"]);
  assert.deepEqual(ergebnis[0], {
    id: 11,
    name: "claude-workflow-kit: main",
    zweig: "main",
    enforcement: "active",
    regeln: [PRUEFREGEL, { type: "non_fast_forward" }, { type: "deletion" }],
    requiredStatusChecks: ["check"],
    bypassActors: [],
  });
  assert.equal(ergebnis[1].enforcement, "disabled");
  assert.deepEqual(ergebnis[1].requiredStatusChecks, []);
  // Das fremde Ruleset wird nicht einmal im Detail gelesen.
  assert.equal(zeilen.gh.some((z) => z.startsWith(`api repos/${REPO}/rulesets/12`)), false);
});

// --- upsertRuleset (A1, A6) ---

const SOLL = { zweig: "main", regeln: [PRUEFREGEL, { type: "non_fast_forward" }, { type: "deletion" }] };

test("[schutz-adapter] upsertRuleset legt ein fehlendes Ruleset per POST an, ohne Bypass", async () => {
  const { ergebnis, zeilen, eingaben } = await mitHost(GITHUB, {
    gh: [
      REPO_REGEL,
      { match: `^api repos/${REPO}/rulesets --method POST`, stdout: { id: 21 } },
      { match: `^api repos/${REPO}/rulesets`, stdout: [LISTE[1]] },
    ],
  }, (host) => host.upsertRuleset({ ...SOLL, bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }] }));

  assert.deepEqual(ergebnis, { id: 21, name: "claude-workflow-kit: main", angelegt: true });
  const i = zeilen.gh.findIndex((z) => z.includes("--method POST"));
  assert.match(zeilen.gh[i], /--input -$/);
  const koerper = JSON.parse(eingaben.gh[i]);
  assert.deepEqual(koerper, {
    name: "claude-workflow-kit: main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: SOLL.regeln,
    bypass_actors: [],
  });
  assert.equal(zeilen.gh.some((z) => z.includes("--method PUT")), false);
});

test("[schutz-adapter] upsertRuleset aendert das gleichnamige Ruleset per PUT", async () => {
  const { ergebnis, zeilen, eingaben } = await mitHost(GITHUB, {
    gh: [
      REPO_REGEL,
      { match: `^api repos/${REPO}/rulesets/11 --method PUT`, stdout: { id: 11 } },
      { match: `^api repos/${REPO}/rulesets`, stdout: LISTE },
    ],
  }, (host) => host.upsertRuleset(SOLL));

  assert.deepEqual(ergebnis, { id: 11, name: "claude-workflow-kit: main", angelegt: false });
  const i = zeilen.gh.findIndex((z) => z.includes("--method PUT"));
  assert.ok(i >= 0, zeilen.gh.join("\n"));
  const koerper = JSON.parse(eingaben.gh[i]);
  assert.deepEqual(koerper.bypass_actors, []);
  assert.equal(zeilen.gh.some((z) => z.includes("--method POST")), false);
});

// --- setRulesetEnforcement (A6) ---

test("[schutz-adapter] setRulesetEnforcement sendet enforcement disabled an das Ruleset des Kits", async () => {
  const { zeilen, eingaben } = await mitHost(GITHUB, {
    gh: [
      REPO_REGEL,
      { match: `^api repos/${REPO}/rulesets/11 --method PUT`, stdout: { id: 11 } },
      { match: `^api repos/${REPO}/rulesets`, stdout: LISTE },
    ],
  }, (host) => host.setRulesetEnforcement("claude-workflow-kit: main", "disabled"));

  const i = zeilen.gh.findIndex((z) => z.includes("--method PUT"));
  assert.deepEqual(JSON.parse(eingaben.gh[i]), { enforcement: "disabled" });
});

test("[schutz-adapter] setRulesetEnforcement weist einen anderen Wert und ein fremdes Ruleset ab", async () => {
  await assert.rejects(
    mitHost(GITHUB, { gh: [REPO_REGEL] }, (host) => host.setRulesetEnforcement("claude-workflow-kit: main", "evaluate")),
    (e) => e instanceof BoardError && /active.*disabled/.test(e.message),
  );
  await assert.rejects(
    mitHost(GITHUB, { gh: [REPO_REGEL] }, (host) => host.setRulesetEnforcement("Team-Regel", "disabled")),
    (e) => e instanceof BoardError && /claude-workflow-kit: /.test(e.message),
  );
});

test("[schutz-adapter] setRulesetEnforcement ohne passendes Ruleset endet mit BoardError", async () => {
  await assert.rejects(
    mitHost(GITHUB, {
      gh: [REPO_REGEL, { match: `^api repos/${REPO}/rulesets`, stdout: [LISTE[1]] }],
    }, (host) => host.setRulesetEnforcement("claude-workflow-kit: main", "active")),
    (e) => e instanceof BoardError && /nicht gefunden/.test(e.message),
  );
});

// --- hatAdminRecht (A9) ---

for (const [admin, erwartet] of [[true, true], [false, false]]) {
  test(`[schutz-adapter] hatAdminRecht liest permissions.admin (${admin})`, async () => {
    const { ergebnis, zeilen } = await mitHost(GITHUB, {
      gh: [REPO_REGEL, { match: `^api repos/${REPO}$`, stdout: { permissions: { admin, push: true } } }],
    }, (host) => host.hatAdminRecht());
    assert.equal(ergebnis, erwartet);
    assert.ok(zeilen.gh.includes(`api repos/${REPO}`));
  });
}

test("[schutz-adapter] hatAdminRecht ohne permissions ist false", async () => {
  const { ergebnis } = await mitHost(GITHUB, {
    gh: [REPO_REGEL, { match: `^api repos/${REPO}$`, stdout: { name: "r" } }],
  }, (host) => host.hatAdminRecht());
  assert.equal(ergebnis, false);
});

// --- Fehler (A9) ---

test("[schutz-adapter] eine 403-Antwort wird zum BoardError und bleibt als 403 erkennbar", async () => {
  await assert.rejects(
    mitHost(GITHUB, {
      gh: [REPO_REGEL, {
        match: `^api repos/${REPO}/rulesets`, exit: 1,
        stderr: "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)\n",
      }],
    }, (host) => host.getRulesets()),
    (e) => e instanceof BoardError && e.httpStatus === 403 && /HTTP 403/.test(e.message),
  );
});

test("[schutz-adapter] ungueltiges JSON der API wird zum BoardError", async () => {
  await assert.rejects(
    mitHost(GITHUB, { gh: [REPO_REGEL, { match: `^api repos/${REPO}$`, stdout: "kein json" }] },
      (host) => host.hatAdminRecht()),
    (e) => e instanceof BoardError && /kein gueltiges JSON/.test(e.message),
  );
});

// --- pushRef und deleteRef ---

test("[schutz-adapter] pushRef pusht den SHA ohne --force auf den Zweig", async () => {
  const { zeilen } = await mitHost(GITHUB, { git: [{ match: "^push ", stdout: "" }] },
    (host) => host.pushRef(SHA, "kit-pruefung"));
  assert.deepEqual(zeilen.git, [`push origin ${SHA}:refs/heads/kit-pruefung`]);
});

test("[schutz-adapter] deleteRef loescht den Zweig auf origin", async () => {
  const { zeilen } = await mitHost(GITHUB, { git: [{ match: "^push ", stdout: "" }] },
    (host) => host.deleteRef("kit-pruefung"));
  assert.deepEqual(zeilen.git, ["push origin --delete kit-pruefung"]);
});

test("[schutz-adapter] ein abgewiesener Push wird zum BoardError", async () => {
  await assert.rejects(
    mitHost(GITHUB, { git: [{ match: "^push ", exit: 1, stderr: "! [remote rejected] (push declined due to repository rule violations)\n" }] },
      (host) => host.pushRef(SHA, "main")),
    (e) => e instanceof BoardError && /repository rule violations/.test(e.message),
  );
});

// --- schutzUnterstuetzt (A5) ---

test("[schutz-adapter] github unterstuetzt den Schutz", async () => {
  const { ergebnis } = await mitHost(GITHUB, {}, (host) => host.schutzUnterstuetzt());
  assert.deepEqual(ergebnis, { ja: true });
});

for (const codeHost of ["gitlab", "local"]) {
  test(`[schutz-adapter] ${codeHost} unterstuetzt den Schutz nicht und sagt, was ungeschuetzt bleibt`, async () => {
    const { ergebnis } = await mitHost({ codeHost, issueTracker: "local" }, {}, (host) => host.schutzUnterstuetzt());
    assert.equal(ergebnis.ja, false);
    assert.equal(typeof ergebnis.grund, "string");
    assert.ok(ergebnis.grund.trim().length > 0);
    assert.match(ergebnis.grund, /ungeschuetzt/);
  });
}
