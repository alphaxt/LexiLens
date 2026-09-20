export const DOCUMENT_SCANNER_PORT = Symbol('DOCUMENT_SCANNER_PORT');
export type ScanResult =
  | {
      outcome: 'CLEAN';
      detectedMime: 'text/plain' | 'application/pdf' | 'image/png' | 'image/jpeg';
    }
  | { outcome: 'REJECTED'; code: string }
  | { outcome: 'ERROR'; code: string };
export interface DocumentScannerPort {
  scan(input: { declaredMime: string; bytes: Buffer; maxBytes: number }): Promise<ScanResult>;
}
