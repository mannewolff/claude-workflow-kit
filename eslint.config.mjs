// Leitplanke gegen die Stilfunde, die SonarCloud in kit/, tools/ und install.mjs
// meldet (Issue #399), plus die Basisregeln von ESLint selbst (Issue #400).
//
// ---------------------------------------------------------------------------
// 1. Wann eine Fundklasse hierher gehoert
// ---------------------------------------------------------------------------
// Dieselbe Fundklasse hat das Quality Gate mindestens zweimal rot gestellt, oder
// sie ist nach einer Handbehebung erneut aufgetreten. Ist das erreicht, loest es
// eine Aufnahmepruefung aus — nicht die Aufnahme: Ob eine Regel den Fund
// ueberhaupt faengt, was sie sonst noch meldet und was der Bestand kostet, steht
// erst nach der Pruefung fest. Andere Anlaesse entscheidet der Mensch im
// Einzelfall.
//
// ---------------------------------------------------------------------------
// 2. Welchen Weg die Aufnahme nimmt
// ---------------------------------------------------------------------------
// Sie wird als Arbeitspaket vorgeschlagen und ist erst nach der Freigabe des
// Menschen wirksam. Eine Regel ist eine Leitplanke und aendert das Gate, an dem
// jede Sitzung gemessen wird — wer sie im Vorbeigehen einschaltet, aendert den
// Massstab fuer alle folgenden Laeufe.
//
// ---------------------------------------------------------------------------
// 3. Was mit den Bestandsfunden geschieht
// ---------------------------------------------------------------------------
// Drei Wege, je Aufnahme genau einer und begruendet: die Funde beheben, sie
// ausnehmen, oder den Geltungsbereich der Regel enger ziehen — wie bei S2871,
// dessen Block unten genau `sonar.sources` abdeckt statt des ganzen Lint-Bereichs.
//
// ---------------------------------------------------------------------------
// 4. Warum kein weiteres `recommended`-Set
// ---------------------------------------------------------------------------
// Die Ausweitung ging in gemessenen Schritten, nicht auf einmal: Ein Linter, der
// beim ersten Lauf hunderte fremder Funde meldet, wird abgeschaltet statt
// befolgt. Schritt 1 ist `js.configs.recommended` — gemessen 38 Funde in zwei
// Regeln (Issue #400). Schritt 2 ist `sonarjs/recommended` (Issue #965): gemessen
// 134 Funde in 16 Regeln, nachdem Schritt 1 die unbenutzten Bindungen und toten
// Zuweisungen bereits abgeraeumt hatte. Sein Gewinn ist der Zeitpunkt — das Set
// deckt sich weithin mit dem, was SonarCloud ohnehin meldet, und meldet es vor
// dem Push statt danach.
//
// Ein drittes Set kommt nicht dazu. Gemessen am 2026-09-28 fuer
// `unicorn/recommended`: 8082 Funde in 31 Regeln, davon 1547 automatisch
// behebbar. 4805 stammen aus `prevent-abbreviations`, 1507 aus `no-null`, 976 aus
// `text-encoding-identifier-case`, 794 aus den uebrigen 28 Regeln zusammen. Drei
// Regeln tragen damit 90 Prozent der Funde, und alle drei befinden ueber das
// Aussehen des Bestands statt ueber einen Fehler — bei der Kodierung fuehrt der
// Bestand die von der Regel verworfene Schreibweise mit 997 zu 5, die Regel
// wuerde also die Mehrheit umbenennen. Einzelne Regeln aus `unicorn` stehen
// weiterhin unten, jede mit ihrer Fundklasse und ihrem Anlass.
import js from "@eslint/js";
import globals from "globals";
import unicorn from "eslint-plugin-unicorn";
import sonarjs from "eslint-plugin-sonarjs";

// Zwei der 328 Regeln des `sonarjs/recommended`-Sets laden in dieser
// Versionskombination ueberhaupt nicht: `sonarjs/no-empty-function` und
// `sonarjs/no-unused-expressions` werfen beim Laden `TypeError: Cannot read
// properties of undefined` (`reading 'allow'` bzw. `reading 'allowShortCircuit'`).
// Beide sind Wrapper um typescript-eslint-Regeln, die ihrerseits ESLint-Kernregeln
// umhuellen; eslint 9.39.5 reicht `context.options[0]` anders durch als
// eslint-plugin-sonarjs 2.0.4 es erwartet. Ohne diese Ausnahme bricht jeder Lauf ab
// — das Set waere hier nicht einschaltbar.
//
// Die Alternative waere, eslint oder eslint-plugin-sonarjs anzuheben. Das geschieht
// bewusst NICHT in diesem Schritt: Ein Versionssprung aendert die Fundmenge aller
// Regeln gleichzeitig, und danach waere nicht mehr trennbar, was das Einschalten des
// Sets und was das Update gekostet hat. Faellt die Ausnahme beim naechsten Update weg,
// gehoeren beide Zeilen hier geloescht.
const sonarjsRecommendedOhneDefekte = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).filter(
    ([regel]) =>
      regel !== "sonarjs/no-empty-function" &&
      regel !== "sonarjs/no-unused-expressions",
  ),
);

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
    // Die Node-Globals gehoeren zum `recommended`-Set und nicht daneben: Ohne sie
    // meldet `no-undef` jedes `process`, `console` und `Buffer` als Fund (gemessen
    // 1167 Stellen) — das Set waere so nicht benutzbar.
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { unicorn, sonarjs },
    rules: {
      ...js.configs.recommended.rules,
      ...sonarjsRecommendedOhneDefekte,
      // S4036 / S4721: Sonar-**Hotspots**, keine Fehlerbefunde — „Make sure the PATH
      // used to find this command includes only what you intend" bzw. „Make sure that
      // executing this OS command is safe here". Sie treffen die Bauart des Werkzeugs:
      // Das Kit ruft `git`, `node` und `npx` bewusst ueber den PATH auf, weil es in
      // fremden Repositorys mit fremden Node-Installationen laeuft — ein absoluter Pfad
      // waere hier der Fehler, nicht die Loesung. 76 gleichlautende Ausnahmen an den
      // Fundstellen sagen nichts, was dieser eine Satz nicht besser sagt.
      "sonarjs/no-os-command-from-path": "off",       // S4036
      "sonarjs/os-command": "off",                    // S4721
      // Dieselbe Fundklasse wie das `no-unused-vars` des ESLint-Kerns, das unten
      // mit den Konventionen dieses Projekts konfiguriert ist (fuehrender
      // Unterstrich, `ignoreRestSiblings`). Die Sonar-Variante kennt diese Optionen
      // nicht und meldete deshalb genau die Stellen, die der Kern bewusst durchlaesst
      // — zwei Regeln auf eine Fundklasse mit gegenlaeufigen Einstellungen. Es bleibt
      // bei der konfigurierten.
      "sonarjs/sonar-no-unused-vars": "off",          // S1481, Doppel zu no-unused-vars
      // Eine unbenutzte Bindung, die Absicht ist, wird gekennzeichnet statt die Regel
      // abgeschaltet: fuehrender Unterstrich. Das gilt fuer Parameter, fuer
      // Destrukturierungs-Reste und fuer gefangene Fehler, die nicht gelesen werden.
      // S1481 — dieselbe Fundklasse wie die abgeschaltete Sonar-Variante darueber, Issue #400.
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        // `const { feld, ...ohneFeld } = vorlage` laesst ein Feld absichtlich weg —
        // das Weglassen IST der Zweck, und `feld` wird dabei nie gelesen. Die Regel
        // hat dafuer eine eigene Option; sie steht im Default des Sets auf `true` und
        // bleibt es hier. Unterstriche waeren an diesen Stellen der falsche Weg: Sie
        // benennen ein Feld um, das aus der Vorlage kommt und so heissen muss.
        ignoreRestSiblings: true,
      }],
      // Zuordnung Sonar-Regel -> ESLint-Regel, je Fundklasse aus Issue #399:
      "unicorn/prefer-string-raw": "error",            // S7780, Issue #399
      "sonarjs/no-nested-template-literals": "error",  // S4624, Issue #399
      "unicorn/no-useless-fallback-in-spread": "error",// S7744, Issue #399
      "sonarjs/no-nested-conditional": "error",        // S3358, Issue #399
      "unicorn/prefer-set-has": "error",               // S7776, Issue #399
      "unicorn/prefer-at": "error",                    // S7755, Issue #399
      "unicorn/prefer-string-replace-all": "error",    // S7781, Issue #399
      "unicorn/prefer-default-parameters": "error",    // S7760, Issue #399
      "unicorn/prefer-array-find": ["error", { checkFromLast: true }], // S7750, Issue #399
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
      // Ergebnisse von `filter`/`map` bleiben unbewacht — der historische Fund
      // (Issue #493) kam aus einem `filter()` und waere hier nie gemeldet worden.
      // Die Regel steht trotzdem: Sie faengt die haeufigere, direkte Form.
      "sonarjs/reduce-initial-value": "error",           // S6959
      // S6594 (RegExp.exec statt String.match) und S6582 (Optional Chaining) haben
      // hier KEIN Pendant: Beide entsprechen Regeln aus typescript-eslint
      // (prefer-regexp-exec, prefer-optional-chain), die Typinformationen brauchen —
      // die es fuer reine .mjs-Dateien ohne TS-Projekt nicht gibt. eslint-plugin-sonarjs
      // fuehrt sie nicht. Ihre fuenf Fundstellen sind von Hand behoben (Issue #399).
      //
      // S4043 (sort im Rueckgabeausdruck) hat hier aus demselben Grund KEIN
      // Pendant: Die Regel aus eslint-plugin-sonarjs gibt ohne Parser-Services ein
      // leeres Regelobjekt zurueck (cjs/S4043/rule.js:41) und meldet fuer reine
      // .mjs-Dateien nichts.
      //
      // Fuer S2871 (.sort() ohne Vergleichsfunktion) galt dasselbe, und die Folge
      // stand hier frueher als hingenommener blinder Fleck: `vergleicheText` sei
      // Konvention, keine Leitplanke. Das hat nicht gehalten — `main` stand am
      // 2026-09-24 an S2871 rot (Issue #872/#873), die Stellen wurden von Hand
      // behoben, und im September stand das Gate mit sechs neuen Stellen wieder
      // rot (Issue #956). Eine Fundklasse, die zweimal wiederkehrt, gehoert in den
      // Linter. Die Leitplanke steht deshalb unten als syntaktische Regel — nicht
      // als `sonarjs/no-alphabetical-sort`, die auch aktiviert stumm bleibt.
    },
  },
  {
    // S2871: `.sort()` / `.toSorted()` ohne Vergleichsfunktion (Issue #956).
    //
    // Eigener Block, weil sein Geltungsbereich ein anderer ist: genau
    // `sonar.sources` (kit, tools, install.mjs) — die Menge, fuer die das Quality
    // Gate rot wird. test/ und .githooks/ bleiben aussen vor. Die Testsuite traegt
    // Dutzende `.sort()`-Aufrufe ueber Schluesselnamen und Dateilisten, an denen
    // kein Gate haengt; sie mitzufangen hiesse, beim ersten Lauf hunderte Funde zu
    // melden — und ein solcher Linter wird abgeschaltet statt befolgt (dieselbe
    // Begruendung, mit der dieser Config die `recommended`-Sets meidet).
    //
    // Syntaktisch statt typbasiert: Ohne Typinformationen laesst sich nicht
    // entscheiden, ob der Empfaenger ein Array ist. Die Regel nimmt deshalb in
    // Kauf, ein `.sort()` an einem Nicht-Array zu melden — das gibt es hier nicht,
    // und der falsche Alarm waere billig, das uebersehene Gate teuer.
    files: ["kit/**/*.mjs", "tools/**/*.mjs", "install.mjs"],
    rules: {
      // S2871, Issue #956
      "no-restricted-syntax": ["error", {
        selector:
          'CallExpression[arguments.length=0][callee.type="MemberExpression"][callee.computed=false]'
          + ':matches([callee.property.name="sort"], [callee.property.name="toSorted"])',
        message:
          "S2871: sort()/toSorted() ohne Vergleichsfunktion sortiert nach der "
          + "String-Darstellung. Vergleich angeben — fuer Text `vergleicheText`.",
      }],
    },
  },
];
