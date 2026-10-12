/**
 * board/vorgeschichte.mjs — Vorgeschichte eines neuen Fachplans und Plans (Issue #1537,
 * Plan #1534 A7): frühere Fachpläne des eigenen Boards vor dem Schreiben lesen.
 *
 * Bisher nur der Schalter: `vorgeschichteAktiv` ist die eine Stelle, über die Formprüfung,
 * Kommando und Prüfauftrag lesen, ob ein Projekt die Vorgeschichte sucht. Die Typprüfung
 * übernimmt das Schema; beim Lesen gilt alles außer `true` als aus, ohne Abbruch.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

/** Sucht das Projekt vor einem Fachplan oder Plan die Vorgeschichte? Nur bei `true`. */
export function vorgeschichteAktiv(config) {
  return config?.vorgeschichte === true;
}
