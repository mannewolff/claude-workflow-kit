// Ermittelt aus altem und neuem Pfad die gewaehlte Sprache (Plan #1348, E3).
// Ein Umschalten liegt vor, wenn sich das Locale-Praefix (/en/ gegenueber der
// Wurzel) aendert und der uebrige Pfad gleich bleibt — genau das, was der
// eingebaute Sprachumschalter von VitePress tut. Dann liefert die Funktion die
// Zielsprache ("de" oder "en"), sonst null.

function zerlege(pfad) {
  let p = String(pfad || "/").split(/[?#]/)[0];
  if (!p.startsWith("/")) p = "/" + p;
  let sprache = "de";
  if (p === "/en" || p.startsWith("/en/")) {
    sprache = "en";
    p = p.slice(3) || "/";
  }
  p = p.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return { sprache, rest: p || "/" };
}

export function sprachwahl(alterPfad, neuerPfad) {
  const alt = zerlege(alterPfad);
  const neu = zerlege(neuerPfad);
  if (alt.sprache === neu.sprache || alt.rest !== neu.rest) return null;
  return neu.sprache;
}
