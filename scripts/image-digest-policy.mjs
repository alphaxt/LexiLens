import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.env.LEXILENS_IMAGE_POLICY_ROOT ?? resolve(import.meta.dirname, '..');
const files = ['apps/api/Dockerfile', 'apps/web/Dockerfile', 'compose.yaml'];
const immutableReference = /@sha256:[a-f0-9]{64}$/i;
const dockerfileArgument = /^\$\{NODE_IMAGE\}$/;
const composeImageArgument = /^\$\{(?:POSTGRES_IMAGE|MINIO_IMAGE|MINIO_MC_IMAGE):\?[^}]+\}$/;
const from = /^\s*FROM\s+(\S+)/gim;
const image = /^\s*image:\s*([^\s#]+)(?:\s|$)/gim;
const devOverride = process.env.LEXILENS_ALLOW_MUTABLE_DEV_IMAGES === '1';
const errors = [];

for (const file of files) {
  const content = readFileSync(resolve(root, file), 'utf8');
  const matcher = file.endsWith('Dockerfile') ? from : image;
  for (const match of content.matchAll(matcher)) {
    const reference = match[1];
    const allowedArgument = file.endsWith('Dockerfile')
      ? dockerfileArgument.test(reference)
      : composeImageArgument.test(reference);
    if (!immutableReference.test(reference) && !allowedArgument && !devOverride)
      errors.push(
        `${file}: ${reference} must be an immutable digest or an approved required digest variable`,
      );
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(
    'For local-only experimentation, set LEXILENS_ALLOW_MUTABLE_DEV_IMAGES=1; release CI never sets it.',
  );
  process.exit(1);
}
