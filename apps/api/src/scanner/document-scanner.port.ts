export const DOCUMENT_SCANNER_PORT = Symbol('DOCUMENT_SCANNER_PORT');
export type ScanResult =
  | { outcome: 'CLEAN'; detectedMime: 'text/plain' }
  | { outcome: 'REJECTED'; code: string }
  | { outcome: 'ERROR'; code: string };
/** A scanner returns a versioned clean/rejected/error verdict; callers must fail closed on ERROR. */
export interface DocumentScannerPort {
  scan(input: { declaredMime: string; bytes: Buffer; maxBytes: number }): Promise<ScanResult>;
}
