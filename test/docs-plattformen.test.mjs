// Issue #1139: README, Dokumentation und Docs-Startseite sagen Windows mit Git Bash zu;
// Vorlage und Skills fangen ein leeres TMPDIR unter Git Bash ab (Plan #1128, E11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = (p) => readFileSync(join(ROOT, p), 'utf8');

const ZUSAGEN = ['README.md', 'docs/dokumentation.md', 'docs/index.md'];
const EINSCHRAENKUNG = /nicht unterst(ü|ue)tzt|eingeschr(ä|ae)nkt|experimentell/i;

for (const datei of ZUSAGEN) {
  test(`${datei} nennt macOS, Linux, Windows und Git Bash`, () => {
    const text = lies(datei);
    assert.match(text, /\b(macOS|Mac)\b/);
    assert.match(text, /\bLinux\b/);
    assert.match(text, /\bWindows\b/);
    assert.match(text, /Git Bash/);
  });

  test(`${datei} schränkt Windows nicht ein`, () => {
    for (const absatz of lies(datei).split(/\n\s*\n/)) {
      if (/\bWindows\b/.test(absatz)) assert.doesNotMatch(absatz, EINSCHRAENKUNG, absatz);
    }
  });
}

test('README nennt Git Bash vor dem Installationskommando', () => {
  const text = lies('README.md');
  assert.ok(text.indexOf('Git Bash') > -1 && text.indexOf('Git Bash') < text.indexOf('node install.mjs'));
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
  test(`${datei} nennt neben printenv TMPDIR den Rückfall cygpath`, () => {
    const text = lies(datei);
    assert.ok(text.includes('printenv TMPDIR'));
    assert.ok(text.includes('cygpath -m "$TEMP"'));
  });
}
