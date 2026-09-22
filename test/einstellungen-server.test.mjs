// Der lokale Server von kit/einstellungen.mjs (Issue #677, Plan #674 E8, E11, E16).
//
// `buildChecks` sind Kommandos, die Commit-Gate und Nacht-Runner ausfuehren. Jede Webseite
// im Browser kann Anfragen an 127.0.0.1 schicken — ohne Token, Host- und Origin-Pruefung
// waere die Oberflaeche ein Weg zu fremder Codeausfuehrung.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { mitServer, projekt, TEAM } from "./helpers/einstellungen-fixture.mjs";

/** Eine Anfrage mit frei gesetzten Kopfzeilen — fetch erlaubt kein eigenes Host. */
function roh(port, pfad, headers, { method = "GET", body } = {}) {
  return new Promise((fertig, fehler) => {
    const req = http.request({ host: "127.0.0.1", port, path: pfad, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => fertig({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", fehler);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const ALT = (wurzel) => projekt(wurzel, "alpha", { stand: "1.0.0" });

async function laden(anfrage, name = "alpha") {
  const res = await anfrage(`/api/projekt/${name}`);
  assert.equal(res.status, 200);
  return res.json();
}

test("[einstellungen-4] der Server lauscht nur auf 127.0.0.1", async () => {
  await mitServer(ALT, async ({ server }) => {
    assert.equal(server.address().address, "127.0.0.1");
  });
});

test("[einstellungen-4] ohne Token, mit falschem Token, fremdem Host oder fremdem Origin wird abgewiesen", async () => {
  await mitServer(ALT, async ({ port, token, wurzel }) => {
    const host = `127.0.0.1:${port}`;
    const aenderung = { ebene: "team", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }] };
    const faelle = [
      { host },
      { host, "x-einstellungen-token": "falsch" },
      { host: "evil.example", "x-einstellungen-token": token },
      { host, "x-einstellungen-token": token, origin: "https://evil.example" },
    ];
    for (const headers of faelle) {
      const get = await roh(port, "/api/projekte", headers);
      assert.equal(get.status, 403, `GET durchgelassen: ${JSON.stringify(headers)}`);
      const post = await roh(port, "/api/projekt/alpha", { ...headers, "content-type": "application/json" }, { method: "POST", body: aenderung });
      assert.equal(post.status, 403, `POST durchgelassen: ${JSON.stringify(headers)}`);
      assert.equal(post.headers["access-control-allow-origin"], undefined);
    }
    assert.match(readFileSync(join(wurzel, "alpha", ".claude", "workflow.config.json"), "utf-8"), /"mainBranch": "main"/, "es wurde geschrieben");
    const gut = await roh(port, "/api/projekte", { host, "x-einstellungen-token": token });
    assert.equal(gut.status, 200);
    assert.equal(gut.headers["access-control-allow-origin"], undefined);
    const ueberLocalhost = await roh(port, "/api/projekte", { host: `localhost:${port}`, "x-einstellungen-token": token, origin: `http://localhost:${port}` });
    assert.equal(ueberLocalhost.status, 200);
  });
});

test("[einstellungen-4] der Vorschau-Endpunkt liegt hinter derselben Token- und Herkunftspruefung", async () => {
  await mitServer(ALT, async ({ port, token }) => {
    const host = `127.0.0.1:${port}`;
    const auftrag = { ebene: "team", teil: "wert", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }] };
    const faelle = [
      { host },
      { host, "x-einstellungen-token": "falsch" },
      { host: "evil.example", "x-einstellungen-token": token },
      { host, "x-einstellungen-token": token, origin: "https://evil.example" },
    ];
    for (const headers of faelle) {
      const res = await roh(port, "/api/projekt/alpha/vorschau", { ...headers, "content-type": "application/json" }, { method: "POST", body: auftrag });
      assert.equal(res.status, 403, `durchgelassen: ${JSON.stringify(headers)}`);
      assert.equal(res.headers["access-control-allow-origin"], undefined);
    }
  });
});

test("[einstellungen-10] der Vorschau-Endpunkt liefert Befunde, Aenderungen und Abgeleitetes, ohne zu schreiben", async () => {
  await mitServer(ALT, async ({ anfrage, wurzel }) => {
    const stand = await laden(anfrage);
    const datei = join(wurzel, "alpha", ".claude", "workflow.config.json");
    const vorher = readFileSync(datei);
    const res = await anfrage("/api/projekt/alpha/vorschau", {
      method: "POST",
      body: { ebene: "team", teil: "wert", aenderungen: [{ pfad: "codeHost", wert: "svn" }], hashes: stand.hashes },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    const body = await res.json();
    assert.ok(body.befunde.some((b) => b.pfad === "codeHost" && b.art === "fehler"));
    assert.deepEqual(body.aenderungen.map((a) => a.pfad), ["codeHost"]);
    assert.deepEqual(body.bestaetigung, []);
    assert.ok(body.abgeleitet);
    assert.deepEqual(readFileSync(datei), vorher);
  });
});

test("[einstellungen-4] der Vorschau-Endpunkt nimmt nur POST", async () => {
  await mitServer(ALT, async ({ anfrage }) => {
    assert.equal((await anfrage("/api/projekt/alpha/vorschau")).status, 405);
    assert.equal((await anfrage("/api/projekt/unbekannt/vorschau", { method: "POST", body: {} })).status, 404);
  });
});

test("[einstellungen-6] Speichern mit veraltetem Hash liefert 409 und schreibt nichts", async () => {
  await mitServer(ALT, async ({ anfrage, wurzel }) => {
    const stand = await laden(anfrage);
    const datei = join(wurzel, "alpha", ".claude", "workflow.config.json");
    writeFileSync(datei, readFileSync(datei, "utf-8").replace('"main"', '"develop"'));
    const res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "team", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }], hashes: stand.hashes } });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).art, "geaendert");
    assert.match(readFileSync(datei, "utf-8"), /"develop"/);
  });
});

test("[einstellungen-6] Pflichtpruefungen leeren oder Review-Pflicht abschalten verlangt eine Bestaetigung", async () => {
  const aufbau = (wurzel) => projekt(wurzel, "alpha", { stand: "1.0.0", team: { ...TEAM, issueReview: { requiredBeforeReady: true, reviewers: [] } } });
  await mitServer(aufbau, async ({ anfrage, wurzel }) => {
    const datei = join(wurzel, "alpha", ".claude", "workflow.config.json");
    for (const [pfad, wert] of [["buildChecks", []], ["issueReview.requiredBeforeReady", false]]) {
      const stand = await laden(anfrage);
      const body = { ebene: "team", aenderungen: [{ pfad, wert }], hashes: stand.hashes };
      const ohne = await anfrage("/api/projekt/alpha", { method: "POST", body });
      assert.equal(ohne.status, 409, pfad);
      const antwort = await ohne.json();
      assert.equal(antwort.art, "bestaetigung");
      assert.ok(antwort.abgeschaltet.some((a) => a.pfad === pfad), `${pfad} fehlt in der Liste`);
      const vorher = readFileSync(datei, "utf-8");
      const mit = await anfrage("/api/projekt/alpha", { method: "POST", body: { ...body, bestaetigt: [pfad] } });
      assert.equal(mit.status, 200, pfad);
      assert.notEqual(readFileSync(datei, "utf-8"), vorher);
    }
  });
});

test("[einstellungen-6] eine ungueltige Aenderung wird mit Grund abgewiesen und schreibt nichts", async () => {
  await mitServer(ALT, async ({ anfrage, wurzel }) => {
    const stand = await laden(anfrage);
    const datei = join(wurzel, "alpha", ".claude", "workflow.config.json");
    const vorher = readFileSync(datei, "utf-8");
    const res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "team", aenderungen: [{ pfad: "codeHost", wert: "svn" }], hashes: stand.hashes } });
    assert.equal(res.status, 422);
    assert.ok((await res.json()).befunde.some((b) => b.pfad === "codeHost" && b.grund));
    assert.equal(readFileSync(datei, "utf-8"), vorher);
  });
});

test("[einstellungen-6] eine nicht lesbare Team-Datei macht das Projekt nicht bearbeitbar", async () => {
  await mitServer((w) => projekt(w, "alpha", { stand: "1.0.0", teamText: "{ kaputt" }), async ({ anfrage }) => {
    const stand = await laden(anfrage);
    assert.equal(stand.bearbeitbar, false);
    assert.ok(stand.hinweise.some((h) => /nicht lesbar/.test(h)));
    const res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "team", aenderungen: [{ pfad: "mainBranch", wert: "x" }], hashes: stand.hashes } });
    assert.equal(res.status, 409);
  });
});

test("[einstellungen-3] persoenlich landet in der lokalen, Team in der geteilten Datei — die andere bleibt bytegleich", async () => {
  await mitServer((w) => projekt(w, "alpha", { stand: "1.0.0", lokal: { reviewScope: "full" } }), async ({ anfrage, wurzel }) => {
    const team = join(wurzel, "alpha", ".claude", "workflow.config.json");
    const lokal = join(wurzel, "alpha", ".claude", "workflow.config.local.json");
    let stand = await laden(anfrage);
    const teamVorher = readFileSync(team, "utf-8");
    let res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "persoenlich", aenderungen: [{ pfad: "reviewScope", wert: "diff" }], hashes: stand.hashes } });
    assert.equal(res.status, 200);
    assert.equal(readFileSync(team, "utf-8"), teamVorher);
    assert.match(readFileSync(lokal, "utf-8"), /"reviewScope": "diff"/);

    stand = await laden(anfrage);
    const lokalVorher = readFileSync(lokal, "utf-8");
    res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "team", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }], hashes: stand.hashes } });
    assert.equal(res.status, 200);
    assert.equal(readFileSync(lokal, "utf-8"), lokalVorher);
    assert.match(readFileSync(team, "utf-8"), /"mainBranch": "trunk"/);

    stand = await laden(anfrage);
    res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "persoenlich", aenderungen: [{ pfad: "buildChecks", wert: [] }], hashes: stand.hashes } });
    assert.equal(res.status, 422);
  });
});

test("[einstellungen-3] eine persoenliche Aenderung legt die lokale Datei an, wenn sie fehlt", async () => {
  await mitServer(ALT, async ({ anfrage, wurzel }) => {
    const stand = await laden(anfrage);
    const res = await anfrage("/api/projekt/alpha", { method: "POST", body: { ebene: "persoenlich", aenderungen: [{ pfad: "reviewScope", wert: "full" }], hashes: stand.hashes } });
    assert.equal(res.status, 200);
    const lokal = join(wurzel, "alpha", ".claude", "workflow.config.local.json");
    assert.ok(existsSync(lokal));
    assert.deepEqual(JSON.parse(readFileSync(lokal, "utf-8")), { reviewScope: "full" });
  });
});
