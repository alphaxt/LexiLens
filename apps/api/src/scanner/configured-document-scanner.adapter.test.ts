import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfiguredDocumentScannerAdapter } from './configured-document-scanner.adapter';

const environment = {
  SCANNER_MODE: 'configured',
  SCANNER_ENDPOINT: 'https://scanner.example.invalid/scan',
  SCANNER_VERSION: '2026.03',
  SCANNER_TIMEOUT_MS: '1000',
};

afterEach(() => vi.unstubAllGlobals());

function scannerWith(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return { scanner: new ConfiguredDocumentScannerAdapter(), fetchMock };
}

describe('ConfiguredDocumentScannerAdapter', () => {
  it('sends bounded raw content with the versioned protocol headers', async () => {
    vi.stubEnv('SCANNER_MODE', environment.SCANNER_MODE);
    vi.stubEnv('SCANNER_ENDPOINT', environment.SCANNER_ENDPOINT);
    vi.stubEnv('SCANNER_VERSION', environment.SCANNER_VERSION);
    vi.stubEnv('SCANNER_TIMEOUT_MS', environment.SCANNER_TIMEOUT_MS);
    const { scanner, fetchMock } = scannerWith(
      new Response(
        JSON.stringify({ verdict: 'clean', detectedMime: 'text/plain', scannerVersion: '2026.03' }),
        { status: 200 },
      ),
    );

    await expect(
      scanner.scan({ declaredMime: 'text/plain', bytes: Buffer.from('safe'), maxBytes: 4 }),
    ).resolves.toEqual({ outcome: 'CLEAN', detectedMime: 'text/plain' });
    expect(fetchMock).toHaveBeenCalledWith(
      environment.SCANNER_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        body: Buffer.from('safe'),
        headers: expect.objectContaining({
          'content-type': 'application/octet-stream',
          'x-lexilens-declared-mime': 'text/plain',
          'x-lexilens-scanner-version': environment.SCANNER_VERSION,
        }),
      }),
    );
  });

  it('fails closed for malformed, unavailable, or version-mismatched scanner responses', async () => {
    vi.stubEnv('SCANNER_MODE', environment.SCANNER_MODE);
    vi.stubEnv('SCANNER_ENDPOINT', environment.SCANNER_ENDPOINT);
    vi.stubEnv('SCANNER_VERSION', environment.SCANNER_VERSION);
    vi.stubEnv('SCANNER_TIMEOUT_MS', environment.SCANNER_TIMEOUT_MS);
    const input = { declaredMime: 'text/plain', bytes: Buffer.from('safe'), maxBytes: 4 };
    const cases: Array<[unknown, unknown]> = [
      [
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
        { outcome: 'ERROR', code: 'SCANNER_PROTOCOL_ERROR' },
      ],
      [
        new Response(
          JSON.stringify({ verdict: 'clean', detectedMime: 'text/plain', scannerVersion: 'old' }),
          { status: 200 },
        ),
        { outcome: 'ERROR', code: 'SCANNER_VERSION_MISMATCH' },
      ],
      [new Response('down', { status: 503 }), { outcome: 'ERROR', code: 'SCANNER_UNAVAILABLE' }],
    ];
    for (const [response, expected] of cases) {
      const { scanner } = scannerWith(response);
      await expect(scanner.scan(input)).resolves.toEqual(expected);
    }
  });

  it('rejects oversized input without invoking the scanner', async () => {
    vi.stubEnv('SCANNER_MODE', environment.SCANNER_MODE);
    vi.stubEnv('SCANNER_ENDPOINT', environment.SCANNER_ENDPOINT);
    vi.stubEnv('SCANNER_VERSION', environment.SCANNER_VERSION);
    const { scanner, fetchMock } = scannerWith(new Response('{}'));
    await expect(
      scanner.scan({ declaredMime: 'text/plain', bytes: Buffer.from('oversized'), maxBytes: 1 }),
    ).resolves.toEqual({ outcome: 'REJECTED', code: 'PAYLOAD_TOO_LARGE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
