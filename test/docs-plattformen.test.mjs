// Issue #1139: Vorlage und Skills fangen ein leeres TMPDIR unter Git Bash ab (Plan #1128, E11).
// Issue #1267: Der Rückfall für ein leeres TMPDIR ist /tmp, nicht cygpath (Plan #1265, E8).
// Issue #1266: Die Plattformzusage lautet macOS, Linux und Windows über WSL2 (Plan #1265, E9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = (p) => readFileSync(join(ROOT, p), 'utf8');

const ZUSAGEN = ['README.md', 'docs/dokumentation.md', 'docs/index.md', 'docs/quickstart.md'];
// Die übrigen Windows-Stellen im Handbuch räumen die Modulpakete ab; bis dahin gilt
// die Freiheit von Git Bash und cygpath dort nur für den Abschnitt Voraussetzungen.
const OHNE_GIT_BASH = ['README.md', 'docs/index.md', 'docs/quickstart.md'];

const abschnitt = (text, ueberschrift) => {
  const start = text.indexOf(`\n## ${ueberschrift}\n`);
  assert.ok(start > -1, `Abschnitt ${ueberschrift} fehlt`);
  const ende = text.indexOf('\n## ', start + 1);
  return text.slice(start, ende === -1 ? undefined : ende);
};

for (const datei of ZUSAGEN) {
  test(`${datei} nennt macOS, Linux und WSL2`, () => {
    const text = lies(datei);
    assert.match(text, /\bmacOS\b/);
    assert.match(text, /\bLinux\b/);
    assert.match(text, /\bWSL2\b/);
  });
}

for (const datei of OHNE_GIT_BASH) {
  test(`${datei} nennt weder Git Bash noch cygpath`, () => {
    assert.doesNotMatch(lies(datei), /Git Bash|cygpath/);
  });
}

test('docs/dokumentation.md nennt in den Voraussetzungen weder Git Bash noch cygpath', () => {
  const teil = abschnitt(lies('docs/dokumentation.md'), 'Voraussetzungen');
  assert.doesNotMatch(teil, /Git Bash|cygpath/);
  assert.match(teil, /\(\/wsl2\)/);
});

test('docs/wsl2.md existiert mit Projektort und Windows-Werkzeugen', () => {
  assert.ok(existsSync(join(ROOT, 'docs/wsl2.md')));
  const text = lies('docs/wsl2.md');
  for (const ueberschrift of [
    'Voraussetzungen',
    'Schritte',
    'Wo das Projekt liegt',
    'Mit Windows-Werkzeugen arbeiten',
    'Umzug von nativem Windows',
  ]) {
    assert.ok(text.includes(`\n## ${ueberschrift}\n`), ueberschrift);
  }
  assert.ok((text.match(/Gelungen, wenn/g) ?? []).length >= 6);
  assert.ok(text.includes('Natives Windows und Git Bash werden ab 4.0.0 nicht mehr unterstützt.'));
});

test('README, Quickstart und Handbuch verweisen auf die WSL2-Anleitung', () => {
  for (const datei of ['README.md', 'docs/quickstart.md', 'docs/dokumentation.md']) {
    assert.match(lies(datei), /wsl2\.md|\(\/wsl2\)/, datei);
  }
});

test('Sidebar führt die WSL2-Anleitung in Einstieg direkt nach dem Quickstart', () => {
  const config = lies('docs-site/.vitepress/config.ts');
  assert.equal(config.split('"/wsl2"').length - 1, 1);
  const start = config.indexOf('text: "Einstieg"');
  const einstieg = config.slice(start, config.indexOf('\n      },', start));
  assert.match(einstieg, /link: "\/quickstart" \},\n\s*\{ text: "Windows über WSL2", link: "\/wsl2" \}/);
});

const TRANSPORT = [
  'templates/CLAUDE-workflow.md',
  'skills/fachplan/SKILL.md',
  'skills/issue-review/SKILL.md',
  'skills/issues/SKILL.md',
  'skills/review/SKILL.md',
  'skills/task/SKILL.md',
  'skills/techplan/SKILL.md',
];

for (const datei of TRANSPORT) {
  test(`${datei} nennt neben printenv TMPDIR den Rückfall /tmp und kein cygpath`, () => {
    const text = lies(datei);
    assert.ok(text.includes('printenv TMPDIR'));
    assert.ok(text.includes('(Linux und WSL2 ohne Sandbox)'));
    assert.ok(text.includes('`/tmp`'));
    assert.doesNotMatch(text, /cygpath/);
  });
}
