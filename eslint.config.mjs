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
    files: ["kit/**/*.mjs", "tools/**/*.mjs", "test/**/*.mjs", "install.mjs"],
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
      // S6594 (RegExp.exec statt String.match) und S6582 (Optional Chaining) haben
      // hier KEIN Pendant: Beide entsprechen Regeln aus typescript-eslint
      // (prefer-regexp-exec, prefer-optional-chain), die Typinformationen brauchen —
      // die es fuer reine .mjs-Dateien ohne TS-Projekt nicht gibt. eslint-plugin-sonarjs
      // fuehrt sie nicht. Ihre fuenf Fundstellen sind von Hand behoben (Issue #399).
    },
  },
];
