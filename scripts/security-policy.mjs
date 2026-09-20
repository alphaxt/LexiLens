#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
const [mode, input, baselinePath = 'security/audit-baseline.json'] = process.argv.slice(2);
const now = new Date();
function fail(message) {
  console.error(`security-policy: ${message}`);
  process.exitCode = 1;
}
if (!mode || !input)
  fail('usage: security-policy.mjs audit <audit.json> [baseline.json] | image <Dockerfile>');
if (mode === 'audit') {
  const audit = JSON.parse(readFileSync(input, 'utf8'));
  const baseline = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : { exceptions: [] };
  const exceptions = new Map(
    (baseline.exceptions ?? []).map((entry) => [entry.fingerprint, entry]),
  );
  for (const entry of exceptions.values())
    if (!entry.owner || !entry.reason || !entry.expiresAt || new Date(entry.expiresAt) < now)
      fail(`expired or incomplete exception ${entry.fingerprint}`);
  const vulnerabilities =
    audit.vulnerabilities ??
    Object.fromEntries(Object.entries(audit.advisories ?? {}).map(([id, value]) => [id, value]));
  for (const [name, finding] of Object.entries(vulnerabilities)) {
    const severity = finding.severity ?? finding?.severity;
    const production = finding.isDirect !== false || finding.dev !== true;
    if (production && ['high', 'critical'].includes(severity)) {
      const fingerprint = `${name}:${finding.via?.[0]?.url ?? finding.url ?? finding.cves?.[0] ?? finding.id ?? severity}`;
      if (!exceptions.has(fingerprint)) fail(`new production ${severity} advisory ${fingerprint}`);
    }
  }
} else if (mode === 'image') {
  const dockerfile = readFileSync(input, 'utf8');
  if (!/^FROM\s+[^\s]+@sha256:[a-f0-9]{64}/m.test(dockerfile))
    fail(`${input} must pin every base image by digest for release builds`);
  if (!/USER\s+[^\s]+/m.test(dockerfile)) fail(`${input} must declare a non-root runtime user`);
} else fail(`unknown mode ${mode}`);
