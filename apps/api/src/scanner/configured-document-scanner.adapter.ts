import { Injectable } from '@nestjs/common';
import { loadConfig } from '../config';
import type { DocumentScannerPort, ScanResult } from './document-scanner.port';

/** Approved scanner boundary. A deployment supplies the HTTPS workload; failures fail closed. */
@Injectable()
export class ConfiguredDocumentScannerAdapter implements DocumentScannerPort {
  private readonly config = loadConfig();

  async scan(input: {
    declaredMime: string;
    bytes: Buffer;
    maxBytes: number;
  }): Promise<ScanResult> {
    if (input.bytes.length > input.maxBytes)
      return { outcome: 'REJECTED', code: 'PAYLOAD_TOO_LARGE' };

    try {
      const response = await fetch(this.config.SCANNER_ENDPOINT!, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-lexilens-declared-mime': input.declaredMime,
          'x-lexilens-scanner-version': this.config.SCANNER_VERSION!,
        },
        body: input.bytes,
        signal: AbortSignal.timeout(this.config.SCANNER_TIMEOUT_MS),
      });
      if (!response.ok) return { outcome: 'ERROR', code: 'SCANNER_UNAVAILABLE' };

      const verdict: unknown = await response.json();
      if (!isScannerVerdict(verdict)) return { outcome: 'ERROR', code: 'SCANNER_PROTOCOL_ERROR' };
      if (verdict.scannerVersion !== this.config.SCANNER_VERSION)
        return { outcome: 'ERROR', code: 'SCANNER_VERSION_MISMATCH' };
      if (
        verdict.verdict === 'clean' &&
        verdict.detectedMime === 'text/plain' &&
        input.declaredMime === 'text/plain'
      )
        return { outcome: 'CLEAN', detectedMime: 'text/plain' };
      return {
        outcome: 'REJECTED',
        code: verdict.verdict === 'malicious' ? 'MALWARE_DETECTED' : 'SCANNER_REJECTED',
      };
    } catch {
      return { outcome: 'ERROR', code: 'SCANNER_UNAVAILABLE' };
    }
  }
}

function isScannerVerdict(value: unknown): value is {
  verdict: 'clean' | 'malicious' | 'rejected';
  detectedMime: string;
  scannerVersion: string;
} {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Record<string, unknown>;
  return (
    (verdict.verdict === 'clean' ||
      verdict.verdict === 'malicious' ||
      verdict.verdict === 'rejected') &&
    typeof verdict.detectedMime === 'string' &&
    typeof verdict.scannerVersion === 'string'
  );
}
