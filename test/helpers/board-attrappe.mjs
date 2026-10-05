// In-Process-Attrappe des Board-Adapters (Issue #1211, Plan #1199, E6).
//
// Der Plan stellt Kindprozess-Tests auf injizierte Abhaengigkeiten um:
// `{ spawn, jetzt, schlaf, board, git }`. Fuer `board` ist das hier die Attrappe: eine
// Funktion mit der Aufrufform des Nacht-Runners (`board("issue", "move", "7", "ready")`),
// die das Ergebnis der Kommandozeile als Objekt liefert — ohne den Einstieg des
// Board-Werkzeugs zu starten und ohne Tracker auf der Platte.
//
// Bewusst eigener Helfer und nicht im Rumpf von `board-fixture.mjs`: Die Fixture startet
// den Einstieg als Kindprozess, und wer sie laedt, gilt beim Waechter
// (`test/checks-leichtigkeit.test.mjs`, Regel 1) als Ablauf-Pruefung. Ein leichter Test
// laedt die Attrappe deshalb von hier; `board-fixture.mjs` reicht sie weiter.
//
// Und bewusst ohne Import aus kit/: `board-fixture.mjs` reicht die Attrappe weiter, und
// jeder Import hier koppelte alle Tests, die die Fixture laden, an diesen Teil. Statuswerte
// und Meldungen stehen darum hier selbst; `test/board-grundlagen-attrappe.test.mjs` haelt
// sie gegen die Grundlagen.

const VALID_STATUSES = ["backlog", "ready", "in_progress", "in_review", "done"];

/** Ein Fehler wie BoardError der Grundlagen: abfangbar, mit der Meldung des Adapters. */
class BoardError extends Error {}

/** Eine Karte in der Form, die `issue get` liefert. */
function karteAus(roh) {
  return {
    id: String(roh.id),
    title: roh.title ?? `Karte ${roh.id}`,
    body: roh.body ?? "",
    status: roh.status ?? "backlog",
    labels: [...(roh.labels ?? [])],
    comments: [...(roh.comments ?? [])],
  };
}

/** Der Wert einer Option `--name <wert>` in einer Argumentliste, sonst undefined. */
function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

/**
 * Die Attrappe ueber einer Kartenliste. Liefert `{ board, aufrufe, karten }`:
 * `board(...cliArgs)` beantwortet `issue list [--status]`, `issue get`, `issue move`,
 * `issue comment --text` und `issue label add|remove`; `aufrufe` haelt jede Argumentliste
 * fest, `karten` den Stand danach. Alles andere wirft einen BoardError — eine Attrappe,
 * die Unbekanntes still beantwortet, liesse einen Test gruen, der gar nicht prueft.
 *
 * @param {object[]} anfang Karten mit mindestens `id`; Reihenfolge = Board-Reihenfolge
 * @param {{ jetzt?: () => Date }} [abhaengigkeiten] die Uhr fuer Kommentare
 */
export function boardAttrappe(anfang = [], { jetzt = () => new Date() } = {}) {
  const karten = anfang.map(karteAus);
  const aufrufe = [];

  const karte = (id) => {
    const treffer = karten.find((k) => k.id === String(id));
    if (!treffer) throw new BoardError(`Issue #${id} nicht gefunden`);
    return treffer;
  };

  const befehle = {
    list: (args) => {
      const status = option(args, "status");
      return karten
        .filter((k) => !status || k.status === status)
        .map(({ id, title, status: s, labels }) => ({ id, title, status: s, labels: [...labels] }));
    },
    get: ([id]) => structuredClone(karte(id)),
    move: ([id, status]) => {
      if (!VALID_STATUSES.includes(status)) {
        throw new BoardError(`Ungueltiger Status '${status}'. Gueltig: ${VALID_STATUSES.join(", ")}`);
      }
      karte(id).status = status;
      return { ok: true, id: String(id), status };
    },
    comment: (args) => {
      const [id] = args;
      const text = option(args, "text");
      if (typeof text !== "string") throw new BoardError("Die Attrappe kennt nur 'issue comment <id> --text <text>'");
      const ziel = karte(id);
      ziel.comments.push({ author: "attrappe", body: text, createdAt: jetzt().toISOString(), id: String(ziel.comments.length + 1) });
      return { ok: true, id: String(id) };
    },
    label: ([aktion, id, name]) => {
      const ziel = karte(id);
      if (aktion === "add" && !ziel.labels.includes(name)) ziel.labels.push(name);
      else if (aktion === "remove") ziel.labels = ziel.labels.filter((l) => l !== name);
      else if (aktion !== "add") throw new BoardError(`Unbekannter label-Befehl: '${aktion}'`);
      return { ok: true, id: String(id), label: name, aktion };
    },
  };

  const board = (...cliArgs) => {
    aufrufe.push(cliArgs);
    const [achse, befehl, ...args] = cliArgs;
    if (achse !== "issue" || !Object.hasOwn(befehle, befehl)) {
      throw new BoardError(`Die Attrappe kennt '${cliArgs.slice(0, 2).join(" ")}' nicht`);
    }
    return befehle[befehl](args);
  };

  return { board, aufrufe, karten };
}
