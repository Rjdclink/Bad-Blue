/**
 * Serialize an already-validated positive JavaScript number without imposing a
 * second arbitrary decimal-place limit. Number#toString is canonical but may
 * emit exponent notation for small increments, while exchange order APIs expect
 * plain decimal strings.
 */
export function cexDecimalString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('CEX order values must be finite and positive');
  const canonical = value.toString().toLowerCase();
  if (!canonical.includes('e')) return canonical;

  const [coefficient, exponentText] = canonical.split('e');
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) throw new Error('CEX order value has an invalid numeric exponent');

  const sign = coefficient.startsWith('-') ? '-' : '';
  const unsigned = sign ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
