/**
 * Builds a short, human-readable, collision-safe order tracking code.
 *
 * Example: SH-260827-483921
 * The date makes support lookups easier; the random suffix is checked against
 * all known orders before it is returned.
 */
export interface OrderNumberRecord {
  orderNumber?: string | null;
}

export function normalizeOrderNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export const ORDER_TRACKING_CODE_PATTERN = /^SH-\d{6}-\d{6}$/;

/**
 * Keeps a client-side optimistic code only when it uses the current format and
 * no persisted order already owns it. The server calls this as the final gate.
 */
export function resolveUniqueOrderNumber(
  requestedOrderNumber: unknown,
  existingOrders: readonly OrderNumberRecord[]
): string {
  const normalizedRequestedCode = normalizeOrderNumber(requestedOrderNumber);
  const isAvailable =
    ORDER_TRACKING_CODE_PATTERN.test(normalizedRequestedCode) &&
    !existingOrders.some(
      (order) => normalizeOrderNumber(order.orderNumber) === normalizedRequestedCode
    );

  return isAvailable ? normalizedRequestedCode : generateUniqueOrderNumber(existingOrders);
}

export function generateUniqueOrderNumber(
  existingOrders: readonly OrderNumberRecord[],
  prefix = 'SH'
): string {
  const normalizedPrefix = normalizeOrderNumber(prefix) || 'SH';
  const knownCodes = new Set(
    existingOrders
      .map((order) => normalizeOrderNumber(order.orderNumber))
      .filter(Boolean)
  );

  const now = new Date();
  const datePart = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');

  // Six digits give a large daily code space. The explicit membership check
  // keeps the result unique even if a random collision occurs.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = Math.floor(100000 + Math.random() * 900000).toString();
    const candidate = `${normalizedPrefix}-${datePart}-${suffix}`;
    if (!knownCodes.has(candidate)) return candidate;
  }

  // Extremely unlikely fallback: still retain six digits and walk a timestamp
  // based sequence until a free candidate is found.
  const fallbackSeed = Date.now() % 1_000_000;
  for (let attempt = 0; attempt < 1_000_000; attempt += 1) {
    const suffix = String((fallbackSeed + attempt) % 1_000_000).padStart(6, '0');
    const candidate = `${normalizedPrefix}-${datePart}-${suffix}`;
    if (!knownCodes.has(candidate)) return candidate;
  }

  throw new Error('Unable to allocate a unique order tracking code');
}
