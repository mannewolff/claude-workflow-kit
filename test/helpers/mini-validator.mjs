// Mini-Validator fuer templates/workflow.config.schema.json (Issue #422, hierher
// gezogen in Issue #439).
//
// Geprueft wird damit statt mit ajv (entschieden am 2026-09-01): Das Repo fuehrt
// heute keinen Schema-Validator, und das Kit liefert seine Werkzeuge bewusst
// abhaengigkeitsfrei aus. Der Validator kennt nur die Schluesselwoerter, die dieses
// Schema braucht — type, oneOf, required, not, pattern, minItems, minProperties,
// additionalProperties, properties, items. Alles andere (enum, minLength, minimum,
// uniqueItems) ignoriert er; er ist damit nachsichtiger als ein echter Validator,
// aber fuer die belegten Aussagen genau scharf genug: Jede negative Aussage haengt
// an einem der unterstuetzten Schluesselwoerter.
//
// Er lag bis Issue #439 in test/config-schema-checks.test.mjs. Der Installer-Test
// fuer den spec-Block (#439) belegt dieselbe Aussage — dass ein erzeugter Block
// gegen das Schema haelt — und braucht dieselbe Funktion. Eine zweite Kopie waere
// ein zweiter Validator mit eigener Nachsicht; sein Selbsttest bleibt deshalb
// dort, wo er war, und misst weiterhin genau dieses eine Exemplar.

export const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

function typPasst(typ, wert) {
  switch (typ) {
    case "object": return istObjekt(wert);
    case "array": return Array.isArray(wert);
    case "string": return typeof wert === "string";
    case "boolean": return typeof wert === "boolean";
    case "integer": return Number.isInteger(wert);
    case "number": return typeof wert === "number";
    default: return true;
  }
}

/** minItems und items. */
function pruefeArray(teilschema, wert, pfad) {
  const fehler = [];
  if (typeof teilschema.minItems === "number" && wert.length < teilschema.minItems) {
    fehler.push(`${pfad}: braucht mindestens ${teilschema.minItems} Eintraege`);
  }
  if (teilschema.items) {
    wert.forEach((el, i) => fehler.push(...pruefe(teilschema.items, el, `${pfad}[${i}]`)));
  }
  return fehler;
}

/** minProperties, required, properties und additionalProperties. */
function pruefeObjekt(teilschema, wert, pfad) {
  const fehler = [];
  if (typeof teilschema.minProperties === "number"
      && Object.keys(wert).length < teilschema.minProperties) {
    fehler.push(`${pfad}: braucht mindestens ${teilschema.minProperties} Eintraege`);
  }
  for (const name of teilschema.required || []) {
    if (!(name in wert)) fehler.push(`${pfad}: Pflichtfeld '${name}' fehlt`);
  }
  for (const [name, teilwert] of Object.entries(wert)) {
    const feldschema = teilschema.properties?.[name] ?? teilschema.additionalProperties;
    if (istObjekt(feldschema)) {
      fehler.push(...pruefe(feldschema, teilwert, `${pfad}.${name}`));
    } else if (feldschema === false) {
      fehler.push(`${pfad}: unbekanntes Feld '${name}'`);
    }
  }
  return fehler;
}

/** Liefert die Liste der Verstoesse; leer heisst gueltig. */
export function pruefe(teilschema, wert, pfad = "$") {
  if (!istObjekt(teilschema)) return [];
  if (teilschema.type && !typPasst(teilschema.type, wert)) {
    // Passt schon der Typ nicht, sagen Folgepruefungen nichts mehr aus.
    return [`${pfad}: erwartet Typ '${teilschema.type}'`];
  }

  const fehler = [];
  if (typeof teilschema.pattern === "string" && typeof wert === "string"
      && !new RegExp(teilschema.pattern).test(wert)) {
    fehler.push(`${pfad}: passt nicht auf '${teilschema.pattern}'`);
  }
  if (Array.isArray(teilschema.oneOf)) {
    const treffer = teilschema.oneOf.filter((zweig) => pruefe(zweig, wert, pfad).length === 0);
    if (treffer.length !== 1) fehler.push(`${pfad}: oneOf traf ${treffer.length} Zweige statt genau einen`);
  }
  if (istObjekt(teilschema.not) && pruefe(teilschema.not, wert, pfad).length === 0) {
    fehler.push(`${pfad}: verbotene Kombination (not) trifft zu`);
  }
  if (Array.isArray(wert)) fehler.push(...pruefeArray(teilschema, wert, pfad));
  if (istObjekt(wert)) fehler.push(...pruefeObjekt(teilschema, wert, pfad));
  return fehler;
}
