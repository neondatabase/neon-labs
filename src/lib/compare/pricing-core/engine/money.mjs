// Exact money math: rates and quantities are decimals, so we compute in exact
// BigInt fractions and only round to cents at the very end (half-up). Pure and
// dependency-free; safe to import anywhere (server, browser bundle, CLI).

const ZERO = { n: 0n, d: 1n };
// 1 GiB = 2^30 bytes, 1 GB = 10^9 bytes ⇒ GiB per GB (to convert a decimal-GB
// input into the binary GiB some vendors bill in).
const GIB_PER_GB = { n: 1_000_000_000n, d: 1_073_741_824n };

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Reduce a fraction and normalize the sign onto the numerator. */
function frac(n, d) {
  if (d === 0n) throw new Error("division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

/** Parse a signed decimal string like "0.106" into an exact fraction. */
function parseDecimal(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) throw new Error(`not a decimal number: ${value}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const fractionDigits = match[3] ?? "";
  return frac(sign * BigInt(match[2] + fractionDigits), 10n ** BigInt(fractionDigits.length));
}

function toFraction(value) {
  return typeof value === "object" && value !== null ? value : parseDecimal(value);
}

/** A predicted usage quantity: a fraction that must not be negative. */
function predictedQuantity(label, value) {
  const fraction = toFraction(value);
  if (compare(fraction, ZERO) < 0) {
    throw new Error(`predicted ${label} cannot be negative`);
  }
  return fraction;
}

function add(a, b) {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

function subtract(a, b) {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

function multiply(a, b) {
  return frac(a.n * b.n, a.d * b.d);
}

function compare(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function clampToZero(a) {
  return compare(a, ZERO) < 0 ? ZERO : a;
}

/** Round a fraction of dollars to a "123.45" cents string, half-up. */
function toMoney(fraction) {
  const negative = fraction.n < 0n;
  const numerator = negative ? -fraction.n : fraction.n;
  const scaled = numerator * 100n;
  let cents = scaled / fraction.d;
  if ((scaled % fraction.d) * 2n >= fraction.d) cents += 1n;
  const digits = cents.toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Approximate decimal for display of non-money quantities (CU-hours, GB). */
function toApproxNumber(fraction) {
  return Number(fraction.n) / Number(fraction.d);
}

/**
 * A money value the whole system passes around: a cents-rounded number for
 * arithmetic/UI (animate this), an integer cents form, the formatted display
 * string, and the exact rational (as strings, JSON-safe) for lossless work.
 * Downstream code sorts/sums on `.amount` and renders `.display` — nothing has
 * to re-parse a formatted string.
 */
function money(fraction) {
  const reduced = frac(fraction.n, fraction.d);
  const display = toMoney(reduced);
  return {
    amount: Number(display),
    amountCents: Math.round(Number(display) * 100),
    display,
    exact: { numerator: reduced.n.toString(), denominator: reduced.d.toString() },
  };
}

export {
  add,
  clampToZero,
  compare,
  GIB_PER_GB,
  money,
  multiply,
  parseDecimal,
  predictedQuantity,
  subtract,
  toApproxNumber,
  toFraction,
  toMoney,
  ZERO,
};
