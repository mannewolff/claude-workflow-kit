// Die Verursachersuche im roten Prueflauf vor dem Push (Issue #947, Plan #944).
//
// Haelt der Lauf vor dem Veroeffentlichen an, wusste der Mensch bisher nur, WELCHES
// Kommando rot war. Welche der seit dem letzten Push abgeschlossenen Karten die Ursache
// beruehrt, musste er selbst suchen — genau diese Suche nimmt ihm die Meldung ab (AK 4
// des Fachplans #938).
//
// Vier Stellen sind leicht falsch, und jede irrt in die stille Richtung:
//   - Eine Karte, die verschwindet: ein Commit ohne erkennbare Nummer, eine Pruefung ohne
//     `areas`, eine Datei ohne Muster. In allen drei Faellen ist der Verdaechtigenkreis
//     grosszuegig zu ziehen — wie im Prueflauf selbst (E7).
//   - Eine leere Liste, die wie "kein Verdaechtiger" aussieht, obwohl sie "nicht gemessen"
//     bedeutet. Deshalb steht dort ein ausdruecklicher Satz.
//   - Ein nicht aufloesbarer Anker: `<basis>..HEAD` hat dann keinen linken Rand, und eine
//     Kartenliste waere erfunden.
//   - Ein gescheiterter git-Aufruf, der den Prueflauf mitnimmt. Die Suche ist Buchhaltung
//     ueber einen bereits gefallenen Befund und darf seinen Ausgang nicht aendern.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitRepo, run, zusammenfassung, datei, git, fakeGitOhne, checksMitFakeGit,
} from "./helpers/checks-repo.mjs";

const BEREICHE = { frontend: ["frontend/**"], backend: ["backend/**"] };

/** Eine rote Pruefung, an `backend` gebunden — an der Push-Stufe laeuft sie in jedem Fall. */
const ROT_BACKEND = {
  buildChecks: [{ cmd: "exit 1", areas: ["backend"] }],
  checkAreas: BEREICHE,
};

/** Dieselbe rote Pruefung ohne jede Bereichszuordnung (String-Form). */
const ROT_OHNE_AREAS = {
  buildChecks: ["exit 1"],
  checkAreas: BEREICHE,
};

/** Der Stand, gegen den die Commits des Fensters gemessen werden. */
function anker(dir) {
  return git(dir, "rev-parse", "--short", "HEAD");
}

/** Committet den Working Tree und gibt die Kurz-SHA zurueck. Weitere Argumente sind Rumpfabsaetze. */
function commit(dir, betreff, ...rumpf) {
  git(dir, "add", "-A");
  const args = ["commit", "-q", "-m", betreff];
  for (const absatz of rumpf) args.push("-m", absatz);
  git(dir, ...args);
  return git(dir, "rev-parse", "--short", "HEAD");
}

/** Der rote Push-Lauf ueber das Fenster ab `basis`. */
async function pushLauf(dir, basis) {
  const res = await run(dir, "--since", basis, "--stufe", "push");
  assert.equal(res.status, 1, `der Lauf haette rot sein muessen: ${res.stdout}${res.stderr}`);
  return res;
}

test("genau eine beruehrte Karte steht als Verursacher da", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    const sha = commit(dir, "Der Dienst kennt den Fall (Issue #910)");

    const res = await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "910", shas: [sha] }] },
    ]);
    assert.match(res.stdout, new RegExp(`Verursacher \\(exit 1\\): Issue #910 \\(${sha}\\)`));
  });
});

test("die Kartennummer steht ergaenzend im Rumpf als Refs", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    const sha = commit(dir, "Ein Betreff ohne Nummer", "Beschreibung.\n\nRefs #911");

    await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "911", shas: [sha] }] },
    ]);
  });
});

test("mehrere beruehrte Karten werden alle genannt, die juengste zuerst", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Eins.java");
    const alt = commit(dir, "Eins (Issue #901)");
    datei(dir, "backend/src/Zwei.java");
    const neu = commit(dir, "Zwei (Issue #902)");

    const res = await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      {
        cmd: "exit 1",
        karten: [
          { karte: "902", shas: [neu] },
          { karte: "901", shas: [alt] },
        ],
      },
    ]);
    assert.match(res.stdout, /Verursacher \(exit 1\): Issue #902 .*, Issue #901 /);
  });
});

test("zwei Commits derselben Karte sind eine Karte mit zwei Staenden", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Eins.java");
    const erst = commit(dir, "Erster Stand (Issue #903)");
    datei(dir, "backend/src/Zwei.java");
    const zweit = commit(dir, "Zweiter Stand (Issue #903)");

    await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "903", shas: [zweit, erst] }] },
    ]);
  });
});

test("beruehrt keine Karte die rote Pruefung, steht dort der ausdrueckliche Satz", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "frontend/src/App.tsx");
    commit(dir, "Nur im anderen Bereich (Issue #904)");

    const res = await pushLauf(dir, basis);

    const satz = `Keine abgeschlossene Karte seit ${basis} beruehrt diese Pruefung.`;
    assert.deepEqual(zusammenfassung(dir).verursacher, [{ cmd: "exit 1", hinweis: satz }]);
    assert.ok(res.stdout.includes(`Verursacher (exit 1): ${satz}`), res.stdout);
  });
});

test("ein Commit ohne erkennbare Nummer erscheint als Commit ohne Karte", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    const sha = commit(dir, "Schnell dazwischen, ohne Karte");

    const res = await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: null, shas: [sha] }] },
    ]);
    assert.ok(res.stdout.includes(`Verursacher (exit 1): Commit ohne Karte ${sha}`), res.stdout);
  });
});

test("eine Pruefung ohne areas gilt als von jeder Karte des Fensters beruehrt", async () => {
  await mitRepo({ config: ROT_OHNE_AREAS }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "frontend/src/App.tsx");
    const sha = commit(dir, "Weit weg von der Pruefung (Issue #905)");

    await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "905", shas: [sha] }] },
    ]);
  });
});

test("eine Karte mit einer Datei ohne Muster gilt fuer jede rote Pruefung als beruehrt", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "irgendwo/notiz.txt");
    const sha = commit(dir, "Eine Datei, die kein Muster trifft (Issue #906)");

    await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "906", shas: [sha] }] },
    ]);
  });
});

test("eine freigestellte Datei macht ihre Karte nicht zur Verdaechtigen", async () => {
  const config = { ...ROT_BACKEND, ohnePruefung: [{ muster: "notizen/**", grund: "reine Notizen" }] };
  await mitRepo({ config }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "notizen/gedanke.md");
    commit(dir, "Nur eine Notiz (Issue #907)");

    await pushLauf(dir, basis);

    const satz = `Keine abgeschlossene Karte seit ${basis} beruehrt diese Pruefung.`;
    assert.deepEqual(zusammenfassung(dir).verursacher, [{ cmd: "exit 1", hinweis: satz }]);
  });
});

test("ein nicht aufloesbarer Anker nennt seinen eigenen Satz statt einer Kartenliste", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    datei(dir, "backend/src/Dienst.java");
    commit(dir, "Ein Stand (Issue #908)");

    const res = await run(dir, "--since", "gibtsnicht", "--stufe", "push");

    assert.equal(res.status, 1, `der Lauf haette rot sein muessen: ${res.stdout}${res.stderr}`);
    const satz = "Verursacher nicht bestimmbar: Anker 'gibtsnicht' laesst sich nicht aufloesen";
    assert.deepEqual(zusammenfassung(dir).verursacher, [{ cmd: "exit 1", hinweis: satz }]);
    assert.ok(res.stdout.includes(`Verursacher (exit 1): ${satz}`), res.stdout);
  });
});

test("die Freigabestufe sucht nicht — dort ist die Basis HEAD selbst", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    commit(dir, "Ein Stand (Issue #909)");

    const res = await run(dir, "--since", basis, "--stufe", "merge");

    assert.equal(res.status, 1, `der Lauf haette rot sein muessen: ${res.stdout}${res.stderr}`);
    assert.equal(zusammenfassung(dir).verursacher, undefined);
    assert.doesNotMatch(res.stdout, /Verursacher/);
  });
});

test("die Paketstufe sucht nicht", async () => {
  await mitRepo({ config: ROT_OHNE_AREAS }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    commit(dir, "Ein Stand (Issue #912)");

    const res = await run(dir, "--since", basis);

    assert.equal(res.status, 1, `der Lauf haette rot sein muessen: ${res.stdout}${res.stderr}`);
    assert.equal(zusammenfassung(dir).verursacher, undefined);
    assert.doesNotMatch(res.stdout, /Verursacher/);
  });
});

test("ein gruener Push-Lauf nennt keine Verursacher", async () => {
  const config = { buildChecks: [{ cmd: "echo gruen", areas: ["backend"] }], checkAreas: BEREICHE };
  await mitRepo({ config }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    commit(dir, "Ein Stand (Issue #913)");

    const res = await run(dir, "--since", basis, "--stufe", "push");

    assert.equal(res.status, 0, `der Lauf haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    assert.equal(zusammenfassung(dir).verursacher, undefined);
    assert.doesNotMatch(res.stdout, /Verursacher/);
  });
});

test("ein gescheiterter git-Aufruf haelt den Lauf nicht an und nennt seinen Grund", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    commit(dir, "Ein Stand (Issue #914)");
    fakeGitOhne(dir, "log", "fake: git log verweigert");

    const res = await checksMitFakeGit(dir, "run", "--since", basis, "--stufe", "push");

    assert.equal(res.status, 1, `der rote Befund bleibt der Ausgang: ${res.stdout}${res.stderr}`);
    const verursacher = zusammenfassung(dir).verursacher;
    assert.equal(verursacher.length, 1);
    assert.equal(verursacher[0].cmd, "exit 1");
    assert.match(verursacher[0].hinweis, /^Verursacher nicht bestimmbar: git log/);
    assert.match(verursacher[0].hinweis, /verweigert/);
    assert.match(res.stdout, /Verursacher \(exit 1\): Verursacher nicht bestimmbar: git log/);
  });
});

test("ein uebernommenes rotes Ergebnis nennt die Verursacher weiter", async () => {
  await mitRepo({ config: ROT_BACKEND }, async (dir) => {
    const basis = anker(dir);
    datei(dir, "backend/src/Dienst.java");
    const sha = commit(dir, "Ein Stand (Issue #915)");

    await pushLauf(dir, basis);
    const zweiter = await run(dir, "--since", basis, "--stufe", "push");

    assert.equal(zweiter.status, 1, `das rote Ergebnis wird uebernommen: ${zweiter.stdout}`);
    assert.match(zweiter.stdout, /Ergebnis uebernommen/);
    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "915", shas: [sha] }] },
    ]);
  });
});

// Die Verursachersuche wertet die abhaengigen Bereiche mit aus (Issue #1208, Plan #1199,
// E15): Ohne sie nennte sie nach der Zerlegung in Teile zu wenige Karten.
test("eine Karte, die Teil A aendert, ist Verursacherin des roten Teils B, der A importiert", async () => {
  const config = {
    buildChecks: [{ cmd: "exit 1", areas: ["teilB"] }],
    checkAreas: { teilA: ["kit/a.mjs"], teilB: ["kit/b.mjs"] },
  };
  await mitRepo({ config }, async (dir) => {
    datei(dir, "kit/a.mjs", "export const a = 1;\n");
    datei(dir, "kit/b.mjs", 'import { a } from "./a.mjs";\nexport const b = a;\n');
    commit(dir, "Die Teile");
    const basis = anker(dir);
    datei(dir, "kit/a.mjs", "export const a = 2;\n");
    const sha = commit(dir, "Teil A rechnet anders (Issue #920)");

    await pushLauf(dir, basis);

    assert.deepEqual(zusammenfassung(dir).verursacher, [
      { cmd: "exit 1", karten: [{ karte: "920", shas: [sha] }] },
    ]);
  });
});
