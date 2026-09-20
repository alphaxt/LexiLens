import { execFileSync } from 'node:child_process';

const patterns = [
  { name: 'private key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  {
    name: 'generic assigned secret',
    expression:
      /(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'](?!local-|replace-|REPLACE|change-me)[^"']{12,}["']/i,
  },
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !file.endsWith('.lock') && !file.includes('/fixtures/'));
const findings = [];
for (const file of files) {
  const content = await BunOrNodeRead(file);
  for (const { name, expression } of patterns)
    if (expression.test(content)) findings.push(`${file}: potential ${name}`);
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}

async function BunOrNodeRead(file) {
  const { readFile } = await import('node:fs/promises');
  return readFile(file, 'utf8').catch(() => '');
}
