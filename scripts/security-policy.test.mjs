import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./security-policy.mjs', import.meta.url));
function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}
test('blocks a new high production advisory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  const audit = join(dir, 'audit.json');
  writeFileSync(
    audit,
    JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: 'high',
          isDirect: true,
          via: [{ url: 'https://advisories.example/1' }],
        },
      },
    }),
  );
  assert.notEqual(run('audit', audit, join(dir, 'baseline.json')).status, 0);
});
test('allows only a complete unexpired reviewed fingerprint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  const audit = join(dir, 'audit.json');
  const baseline = join(dir, 'baseline.json');
  writeFileSync(
    audit,
    JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: 'high',
          isDirect: true,
          via: [{ url: 'https://advisories.example/1' }],
        },
      },
    }),
  );
  writeFileSync(
    baseline,
    JSON.stringify({
      exceptions: [
        {
          fingerprint: 'lodash:https://advisories.example/1',
          owner: 'security@example.test',
          reason: 'upstream fix pending',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      ],
    }),
  );
  const result = run('audit', audit, baseline);
  assert.equal(result.status, 0, result.stderr);
});
test('blocks an expired exception', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  const audit = join(dir, 'audit.json');
  const baseline = join(dir, 'baseline.json');
  writeFileSync(audit, JSON.stringify({ vulnerabilities: {} }));
  writeFileSync(
    baseline,
    JSON.stringify({
      exceptions: [
        {
          fingerprint: 'x',
          owner: 'security@example.test',
          reason: 'x',
          expiresAt: '2000-01-01T00:00:00Z',
        },
      ],
    }),
  );
  assert.notEqual(run('audit', audit, baseline).status, 0);
});
