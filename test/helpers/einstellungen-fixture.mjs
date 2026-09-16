// Fixtures fuer die Tests des Einstellungs-Servers (Issues #677, #678).
//
// Ein Wurzelordner mit Projekten im Temp-Verzeichnis und ein Home-Ordner fuer den
// Rueckfall ~/.claude/kit. Der Server laeuft im Testprozess auf Port 0.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { starteServer } from "../../kit/einstellungen.mjs";

export const TEAM = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5", buildChecks: ["node --test"], mainBranch: "main" };

/** Legt ein Projekt mit Team-Config und optional Kit-Stand und persoenlicher Datei an. */
export function projekt(wurzel, name, { team = TEAM, teamText, lokal, stand } = {}) {
  const dir = name === "." ? wurzel : join(wurzel, name);
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), teamText ?? JSON.stringify(team, null, 2) + "\n");
  if (lokal !== undefined) writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify(lokal, null, 2) + "\n");
  if (stand) writeFileSync(join(dir, ".claude", "kit", "board.mjs"), `const KIT_VERSION = "${stand}";\n`);
  return dir;
}

/** Startet den Server ueber einem frischen Wurzelordner und raeumt danach alles ab. */
export async function mitServer(aufbau, fn, { eigenerStand = "5.0.0" } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-home-"));
  try {
    aufbau(wurzel, home);
    const s = await starteServer({ ordner: wurzel, port: 0, home, eigenerStand });
    try {
      const basis = `http://127.0.0.1:${s.port}`;
      const anfrage = (pfad, { method = "GET", body, token = s.token, headers = {} } = {}) =>
        fetch(`${basis}${pfad}`, {
          method,
          headers: { ...(token ? { "X-Einstellungen-Token": token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
      return await fn({ ...s, wurzel, home, basis, anfrage });
    } finally {
      await new Promise((fertig) => s.server.close(fertig));
    }
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}
