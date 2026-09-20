import type { ExtractionArtifact } from '@lexilens/contracts';

export const NATIVE_DOCUMENT_EXTRACTOR_PORT = Symbol('NATIVE_DOCUMENT_EXTRACTOR_PORT');

/** Narrow, synchronous-by-contract native parser boundary. No parser is bundled for PDFs. */
export interface NativeDocumentExtractorPort {
  extract(input: {
    mime: 'text/plain' | 'application/pdf';
    bytes: Buffer;
    maxCharacters: number;
    maxPages: number;
  }): Promise<ExtractionArtifact>;
}
