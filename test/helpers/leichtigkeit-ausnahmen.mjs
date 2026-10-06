// Die Dateien, die heute noch gegen eine Regel des Waechters verstossen (Issue #1210,
// Plan #1199, E7 und E18). Die Regeln stehen in `leichtigkeit.mjs`.
//
// Die Liste schrumpft nur: Jedes Paket der Umstellung streicht die Dateien, die es
// leicht gemacht oder gekennzeichnet hat, und `test/checks-leichtigkeit.test.mjs`
// meldet jeden Eintrag, der nicht mehr verstoesst. Das letzte Paket der Umstellung
// leert die Liste und entfernt die Datei. Ein neuer Eintrag ist kein Ausweg fuer eine
// neue Testdatei — die wird von Anfang an leicht oder gekennzeichnet geschrieben.

export const AUSNAHMEN = {
  "ablauf-kennzeichnen": [
  ],
  "keine-pausen": [
    "test/ablauf-checks-sperre.test.mjs",
  ],
  "haenger-kennzeichnen": [
  ],
  "import-aus-teil": [
  ],
};
