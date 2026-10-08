import Ajv2020 from 'ajv/dist/2020';
import v5Schema from '../../schemas/circuit-document.v5.schema.json';
import { diagnostic, validateDocument, type DocumentValidation } from '../domain';

// Frozen schema from e125d50. Conversion is explicit; normal parsing stays v6-only.
const isV5 = new Ajv2020({ strict: false }).compile(v5Schema);
export function migrateDocument(text: string): DocumentValidation {
  try {
    const input = JSON.parse(text);
    if (isV5(input)) return validateDocument({ ...input, version: 6 });
  } catch { /* Keep the original bytes available to the caller. */ }
  return { ok: false, diagnostics: [diagnostic('DOCUMENT_RECOVERY_FAILED')] };
}
