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
      const verdict = (await response.json()) as {
        verdict?: string;
        detectedMime?: string;
        scannerVersion?: string;
      };
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
