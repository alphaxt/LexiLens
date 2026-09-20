import type { DocumentRecord } from '@lexilens/contracts';

export const MAX_TEXT_FILE_BYTES = 250_000;

type TextFileMetadata = Pick<File, 'name' | 'size' | 'type'>;

export function validateTextFile(file: TextFileMetadata): string | null {
  const hasTextExtension = file.name.toLowerCase().endsWith('.txt');
  const hasAllowedMime = file.type === '' || file.type === 'text/plain';
  if (!hasTextExtension || !hasAllowedMime) return 'Choose a plain-text .txt file.';
  if (file.size === 0) return 'The selected text file is empty.';
  if (file.size > MAX_TEXT_FILE_BYTES) {
    return `The text file exceeds the ${MAX_TEXT_FILE_BYTES.toLocaleString('en-US')} byte local limit.`;
  }
  return null;
}

export function mergeDocumentHistory(
  current: readonly DocumentRecord[],
  incoming: DocumentRecord,
): DocumentRecord[] {
  return [incoming, ...current.filter((document) => document.id !== incoming.id)]
    .filter((document) => document.status !== 'DELETED')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function removeFromDocumentHistory(
  current: readonly DocumentRecord[],
  documentId: string,
): DocumentRecord[] {
  return current.filter((document) => document.id !== documentId);
}
