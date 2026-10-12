// Labels unter beiden Namen pruefen (Issue #1552, Plan #1548 E2): Das Board schreibt Kit-Labels
// in jedem Projekt englisch, erkennt aber beide Namen. Ein Test, der wissen will, ob eine Karte
// ein Kit-Label traegt, fragt nach der Sache, nicht nach der Schreibweise — sonst haengt er
// daran, welcher Teil des Kits das Label gesetzt hat.
//
// Diese Datei enthaelt selbst keine Tests.

import { erkenneLabel } from "../../kit/board/namen.mjs";

/** Traegt die Liste das Label `name`, unter diesem oder dem anderen Namen derselben Sache? */
export function hatLabel(labels, name) {
  const sache = erkenneLabel(name);
  return (labels || []).some((l) => l === name || (sache !== null && erkenneLabel(l) === sache));
}
