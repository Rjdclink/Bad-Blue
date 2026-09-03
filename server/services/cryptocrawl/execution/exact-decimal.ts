export interface ExactDecimal {
  units: bigint;
  scale: number;
}

const MAX_SCALE = 36;

export function parseExactDecimal(value: string, label = 'decimal'): ExactDecimal {
  const raw = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label} must be a plain decimal string`);
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
  if (fractionRaw.length > MAX_SCALE) throw new Error(`${label} exceeds ${MAX_SCALE} decimal places`);
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const digits = `${whole}${fractionRaw}`.replace(/^0+(?=\d)/, '') || '0';
  let units = BigInt(digits);
  if (negative && units !== 0n) units = -units;
  return { units, scale: fractionRaw.length };
}

export function exactDecimalToString(value: ExactDecimal): string {
  let units = value.units;
  const negative = units < 0n;
  if (negative) units = -units;
  const digits = units.toString().padStart(value.scale + 1, '0');
  if (value.scale === 0) return `${negative ? '-' : ''}${digits}`;
  const split = digits.length - value.scale;
  const whole = digits.slice(0, split) || '0';
  const fraction = digits.slice(split).replace(/0+$/, '');
  return fraction
    ? `${negative ? '-' : ''}${whole}.${fraction}`
    : `${negative ? '-' : ''}${whole}`;
}

function align(value: ExactDecimal, scale: number): bigint {
  if (scale < value.scale) throw new Error('Cannot reduce exact decimal scale');
  return value.units * (10n ** BigInt(scale - value.scale));
}

export function addExactDecimals(a: string, b: string): string {
  const left = parseExactDecimal(a, 'left decimal');
  const right = parseExactDecimal(b, 'right decimal');
  const scale = Math.max(left.scale, right.scale);
  return exactDecimalToString({ units: align(left, scale) + align(right, scale), scale });
}

export function subtractExactDecimals(a: string, b: string): string {
  const right = parseExactDecimal(b, 'right decimal');
  return addExactDecimals(a, exactDecimalToString({ units: -right.units, scale: right.scale }));
}

export function multiplyExactDecimals(a: string, b: string): string {
  const left = parseExactDecimal(a, 'left decimal');
  const right = parseExactDecimal(b, 'right decimal');
  const scale = left.scale + right.scale;
  if (scale > MAX_SCALE) throw new Error(`Exact decimal multiplication exceeds ${MAX_SCALE} decimal places`);
  return exactDecimalToString({ units: left.units * right.units, scale });
}

export function negateExactDecimal(value: string): string {
  const parsed = parseExactDecimal(value);
  return exactDecimalToString({ units: -parsed.units, scale: parsed.scale });
}

export function compareExactDecimals(a: string, b: string): number {
  const left = parseExactDecimal(a, 'left decimal');
  const right = parseExactDecimal(b, 'right decimal');
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = align(left, scale);
  const rightUnits = align(right, scale);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

export function requirePositiveExactDecimal(value: string, label = 'decimal'): string {
  const parsed = parseExactDecimal(value, label);
  if (parsed.units <= 0n) throw new Error(`${label} must be positive`);
  return exactDecimalToString(parsed);
}

export function requireNonNegativeExactDecimal(value: string, label = 'decimal'): string {
  const parsed = parseExactDecimal(value, label);
  if (parsed.units < 0n) throw new Error(`${label} must be non-negative`);
  return exactDecimalToString(parsed);
}
