import Ajv2020 from 'ajv/dist/2020';
import v5Schema from '../../schemas/circuit-document.v5.schema.json';
import v6Schema from '../../schemas/circuit-document.v6.schema.json';
import { diagnostic, validateDocument, type DocumentValidation } from '../domain';

// Frozen legacy schemas. Conversion is explicit; normal parsing stays v7-only.
const isV5 = new Ajv2020({ strict: false }).compile(v5Schema);
const isV6 = new Ajv2020({ strict: false }).compile(v6Schema);
export function migrateDocument(text: string): DocumentValidation {
  try {
    const input = JSON.parse(text);
    const intermediate = isV5(input) ? { ...input, version: 6 } : input;
    if (isV6(intermediate)) return validateDocument({ ...intermediate, version: 7 });
  } catch { /* Keep the original bytes available to the caller. */ }
  return { ok: false, diagnostics: [diagnostic('DOCUMENT_RECOVERY_FAILED')] };
}
