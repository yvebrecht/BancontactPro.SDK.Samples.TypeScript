/**
 * Describes what a callback's Signature header looks like, so a rejected callback can be understood without a debugger: how
 * many dots it has, what the JOSE header says, how big the body is. It verifies nothing.
 */
export function analyseSignature(signatureHeader: string, body: Uint8Array): string {
  if (!signatureHeader.trim()) return 'No Signature header was sent.';

  const parts = signatureHeader.split('.');
  const form =
    parts.length === 2
      ? 'header.signature (one dot)'
      : parts.length === 3 && parts[1] === ''
        ? 'header..signature (two dots, empty payload segment)'
        : parts.length === 3
          ? 'header.payload.signature (a non-empty middle segment)'
          : `${parts.length - 1} dots`;
  const lines = [`Signature header: ${signatureHeader.length} characters, form ${form}.`, `Body: ${body.length} bytes.`];

  try {
    const json = Buffer.from(parts[0] ?? '', 'base64url').toString('utf8');
    lines.push('JOSE header:', JSON.stringify(JSON.parse(json), null, 2));
  } catch {
    lines.push('The first segment is not a base64url JSON header.');
  }

  const signature = parts[parts.length - 1] ?? '';
  lines.push(`Signature segment: ${Buffer.from(signature, 'base64url').length} bytes (ES256 expects 64).`);
  return lines.join('\n');
}