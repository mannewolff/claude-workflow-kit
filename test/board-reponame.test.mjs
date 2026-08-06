// Einheitliche Rueckgabeform von getRepoName (Issue #214).
//
// `code repo-name` versprach in Doku und /document-Skill die Form owner/repo, lieferte
// aber drei verschiedene: GitHub gab bei erreichbarem gh owner/repo und sonst die volle
// Remote-URL zurueck, GitLab immer owner/repo, der lokale Host nur repo. Sichtbar wurde
// das genau dann, wenn gh nicht durchkommt — unter der Projekt-Sandbox scheitert es an
// der TLS-Pruefung, und dann steht die URL als Projektname im Vault-Pfad.
//
// Der Fallback-Zweig war beim Windows-Umbau (Issue #196) der einzige der drei, in dem
// die Normalisierung nicht mitgewandert ist.

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRepoName } from "../kit/board.mjs";

test("normalizeRepoName: HTTPS-URL mit und ohne .git", () => {
  assert.equal(
    normalizeRepoName("https://github.com/mannewolff/claude-workflow-kit.git"),
    "mannewolff/claude-workflow-kit"
  );
  assert.equal(
    normalizeRepoName("https://github.com/mannewolff/claude-workflow-kit"),
    "mannewolff/claude-workflow-kit"
  );
});

test("normalizeRepoName: SSH-Form", () => {
  assert.equal(normalizeRepoName("git@github.com:owner/repo.git"), "owner/repo");
  assert.equal(normalizeRepoName("git@gitlab.example.com:owner/repo"), "owner/repo");
});

test("normalizeRepoName: bereits normalisiertes owner/repo bleibt unveraendert", () => {
  // gh repo view --json nameWithOwner liefert diese Form direkt.
  assert.equal(normalizeRepoName("owner/repo"), "owner/repo");
});

test("normalizeRepoName: GitLab-Untergruppen werden auf die letzten zwei Segmente gekuerzt", () => {
  // Bisherige GitLab-Semantik (.slice(-2)) — hier bewusst beibehalten.
  assert.equal(normalizeRepoName("https://gitlab.com/gruppe/unter/repo.git"), "unter/repo");
});

test("normalizeRepoName: leere Eingabe ergibt null", () => {
  assert.equal(normalizeRepoName(null), null);
  assert.equal(normalizeRepoName(undefined), null);
  assert.equal(normalizeRepoName(""), null);
});

test("normalizeRepoName: ein einzelnes Segment bleibt es", () => {
  // Kein Owner vorhanden — nichts hinzuerfinden.
  assert.equal(normalizeRepoName("repo"), "repo");
});

test("normalizeRepoName: Leerraum am Rand wird abgeschnitten", () => {
  assert.equal(normalizeRepoName("  owner/repo\n"), "owner/repo");
});
