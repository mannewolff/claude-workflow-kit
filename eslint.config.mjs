// Leitplanke gegen die Stilfunde, die SonarCloud in kit/, tools/ und install.mjs
// meldet (Issue #399). Bewusst NICHT die `recommended`-Sets: Ein Linter, der beim
// ersten Lauf hunderte fremder Funde meldet, wird abgeschaltet statt befolgt. Die
// Ausweitung ist ein eigener Schritt.
import unicorn from "eslint-plugin-unicorn";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  {
    // kit/board-ui.mjs ist ausgenommen wie in sonar-project.properties (Issue #181):
    // Die Datei stammt aus dem eigenstaendigen Repo mannewolff/board-ui und wird von dort
    // hierher gesynct. Sie hier zu linten erzeugt Drift zur Quelle — genau dieser
    // Mechanismus hat am 2026-07-09 die CI gekippt.
    ignores: [
      "node_modules/**",
      "docs-site/**",
      "docs/**",
      "coverage/**",
      ".claude/**",
      "kit/board-ui.mjs",
    ],
  },
  {
    files: ["kit/**/*.mjs", "tools/**/*.mjs", "test/**/*.mjs", "install.mjs", ".githooks/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: { unicorn, sonarjs },
    rules: {
      // Zuordnung Sonar-Regel -> ESLint-Regel, je Fundklasse aus Issue #399:
      "unicorn/prefer-string-raw": "error",            // S7780
      "sonarjs/no-nested-template-literals": "error",  // S4624
      "unicorn/no-useless-fallback-in-spread": "error",// S7744
      "sonarjs/no-nested-conditional": "error",        // S3358
      "unicorn/prefer-set-has": "error",               // S7776
      "unicorn/prefer-at": "error",                    // S7755
      "unicorn/prefer-string-replace-all": "error",    // S7781
      "unicorn/prefer-default-parameters": "error",    // S7760
      "unicorn/prefer-array-find": ["error", { checkFromLast: true }], // S7750
      // S3776 (kognitive Komplexitaet, Issue #404). Dieselbe Metrik wie SonarCloud:
      // die Regel ist SonarSources eigene S3776-Implementierung, die Schwelle 15 ist
      // die dort eingestellte. Ohne sie waere das Kernziel erst beim naechsten
      // SonarCloud-Lauf messbar — eine Session koennte "fertig" melden, waehrend eine
      // Funktion noch bei 16 liegt.
      "sonarjs/cognitive-complexity": ["error", 15],
      // S6959 (reduce ohne Startwert, Issue #493). Die Leitplanke faengt weniger
      // als SonarCloud: Ohne Parser-Services prueft der typfreie Zweig der Regel
      // (cjs/S6959/rule.js:35), ob der Empfaenger ein Array-Literal ist oder eine
      // Variable, die genau einmal aus einem Array-Literal zugewiesen wurde.
      // Ergebnisse von `filter`/`map` bleiben unbewacht — genau der Fund in
      // kit/spec.mjs kam aus einem `filter()` und waere hier nie gemeldet worden.
      // Die Regel steht trotzdem: Sie faengt die haeufigere, direkte Form.
      "sonarjs/reduce-initial-value": "error",           // S6959
      // S6594 (RegExp.exec statt String.match) und S6582 (Optional Chaining) haben
      // hier KEIN Pendant: Beide entsprechen Regeln aus typescript-eslint
      // (prefer-regexp-exec, prefer-optional-chain), die Typinformationen brauchen —
      // die es fuer reine .mjs-Dateien ohne TS-Projekt nicht gibt. eslint-plugin-sonarjs
      // fuehrt sie nicht. Ihre fuenf Fundstellen sind von Hand behoben (Issue #399).
      //
      // S2871 (.sort() ohne Vergleichsfunktion) und S4043 (sort im Rueckgabe-
      // ausdruck) haben hier aus demselben Grund KEIN Pendant: Beide Regeln aus
      // eslint-plugin-sonarjs geben ohne Parser-Services ein leeres Regelobjekt
      // zurueck (cjs/S2871/rule.js:52, cjs/S4043/rule.js:41) und melden fuer
      // reine .mjs-Dateien nichts. Die benannte Vergleichsfunktion
      // `vergleicheText` in kit/spec.mjs und kit/checks.mjs ist deshalb
      // Konvention, keine Leitplanke — ein neuer `.sort()`-Aufruf faellt erst
      // beim naechsten SonarCloud-Lauf auf (Issue #493).
    },
  },
];
