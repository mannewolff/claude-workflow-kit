/**
 * night/laufvariablen.mjs — jeder Name, den der Runner einer Session in die Umgebung setzt
 * (Issue #1282): `sessionUmgebung` und `runSession` in kit/night/session.mjs, die Kette
 * (`KIT_PLAN_REVIEWER`), die Salvage-Session (`NIGHT_SALVAGE`) und der Vorflug
 * (`NIGHT_VORFLUG`). kit/checks.mjs nimmt sie seinen Pruefkommandos weg: Was eine Pruefung
 * misst, haengt nicht davon ab, ob sie im Nachtlauf laeuft.
 *
 * Bewusst kein Praefixfilter: Tests und Projekte setzen eigene `KIT_*`-Variablen wie
 * `KIT_ROOT` ausdruecklich fuer ihre Aufrufe. Ein neuer Name ohne Eintrag faellt im
 * Waechtertest `test/checks-lauf-umgebung.test.mjs` auf.
 *
 * Ein Blatt ohne Importe: session.mjs exportiert die Liste weiter und laedt selbst
 * checks.mjs — laege sie dort, schloesse der Import aus checks.mjs einen Kreis, in dem
 * beide Module aufeinander warten.
 */
export const LAUF_VARIABLEN = Object.freeze([
  "NIGHT_ISSUE_ID", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "NODE_USE_ENV_PROXY",
  "NIGHT_PROMPT", "KIT_AGENT_MODEL", "NIGHT_KETTE_STUFE", "KIT_STAND", "KIT_STAND_PFAD",
  "KIT_NIGHT_RUN", "BASH_MAX_TIMEOUT_MS", "BASH_DEFAULT_TIMEOUT_MS",
  "KIT_PLAN_REVIEWER", "NIGHT_SALVAGE", "NIGHT_VORFLUG",
]);

/** Die Umgebung ohne die Namen aus `LAUF_VARIABLEN`. */
export function ohneLaufVariablen(env) {
  const rest = { ...env };
  for (const name of LAUF_VARIABLEN) delete rest[name];
  return rest;
}
