// Labels unter beiden Namen pruefen (Issue #1552, Plan #1548 E2): Das Board schreibt Kit-Labels
// in jedem Projekt englisch, erkennt aber beide Namen. Ein Test, der wissen will, ob eine Karte
// ein Kit-Label traegt, fragt nach der Sache, nicht nach der Schreibweise — sonst haengt er
// daran, welcher Teil des Kits das Label gesetzt hat.
//
// Diese Datei enthaelt selbst keine Tests.

import { erkenneLabel, LABELS, PRAEFIXE } from "../../kit/board/namen.mjs";

/** Traegt die Liste das Label `name`, unter diesem oder dem anderen Namen derselben Sache? */
export function hatLabel(labels, name) {
  const sache = erkenneLabel(name);
  return (labels || []).some((l) => l === name || (sache !== null && erkenneLabel(l) === sache));
}

const PAARE = [...Object.values(LABELS), ...Object.values(PRAEFIXE)].filter(({ de, en }) => de !== en);
const esc = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * Eine Erwartung mit den englischen Label- und Praefixnamen statt der deutschen (Issue #1571):
 * Der Regeltext nennt nur noch die englischen, die Doku bis zu ihrer Umstellung die deutschen.
 * Nimmt einen Text oder einen regulaeren Ausdruck und gibt dasselbe zurueck.
 */
export function englisch(wert) {
  if (wert instanceof RegExp) {
    let quelle = wert.source;
    for (const { de, en } of PAARE) quelle = quelle.replaceAll(esc(de), esc(en)).replaceAll(de, en);
    return new RegExp(quelle, wert.flags);
  }
  let text = String(wert);
  for (const { de, en } of PAARE) text = text.replaceAll(de, en);
  return text;
}
