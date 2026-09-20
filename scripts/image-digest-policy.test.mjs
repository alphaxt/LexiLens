import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (env = {}) =>
  spawnSync(process.execPath, ['scripts/image-digest-policy.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

test('image digest policy accepts required digest variables with no defaults', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

test('image digest policy rejects mutable references and unapproved variables', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-policy-'));
  mkdirSync(join(root, 'apps', 'api'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'Dockerfile'), 'FROM node:22\n');
  writeFileSync(join(root, 'apps', 'web', 'Dockerfile'), 'FROM ${NODE_IMAGE}\n');
  writeFileSync(join(root, 'compose.yaml'), 'services:\n  db:\n    image: ${UNREVIEWED_IMAGE}\n');
  const result = run({ LEXILENS_IMAGE_POLICY_ROOT: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /node:22/);
  assert.match(result.stderr, /UNREVIEWED_IMAGE/);
});

test('local development override is explicit', () => {
  const result = run({ LEXILENS_ALLOW_MUTABLE_DEV_IMAGES: '1' });
  assert.equal(result.status, 0, result.stderr);
});
