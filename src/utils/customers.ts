import { CustomerUser } from '../types';

const GENERIC_NAMES = new Set(['', 'مشتری ربات', 'مشتری جدید', 'مشتری', 'guest']);

export const isRealName = (name?: string | null): boolean =>
  Boolean(name && name.trim() && !GENERIC_NAMES.has(name.trim()));

/** Telegram chats that do not represent a real bot-linked customer account. */
export const isBotLinkedTelegramId = (telegramId?: string | null): boolean => {
  const id = String(telegramId || '').trim();
  return Boolean(id && id !== 'guest' && !id.startsWith('manual-') && !id.startsWith('manual_'));
};

/**
 * One Telegram account = exactly one customer. Always find the customer by
 * telegramId before creating a record, so a changed name never spawns a
 * duplicate profile.
 */
export function findBotCustomer(
  customers: CustomerUser[],
  telegramId: string | number | null | undefined,
): CustomerUser | undefined {
  if (telegramId === null || telegramId === undefined || telegramId === '') return undefined;
  return customers.find((customer) => String(customer.telegramId) === String(telegramId));
}

function rememberAddress(customer: CustomerUser, address?: string | null): void {
  const normalized = String(address || '').trim();
  if (!normalized) return;
  const book = Array.isArray(customer.addresses) ? [...customer.addresses] : (customer.address ? [customer.address] : []);
  if (!book.includes(normalized)) {
    book.push(normalized);
    customer.addresses = book.slice(-20);
  }
  // Keep the legacy single-address field as the most recently used address.
  customer.address = normalized;
}

/**
 * Create or update the single customer profile for a Telegram account.
 * Non-generic names/phones fill in missing details; a newly provided address
 * is appended to the customer's address book.
 */
export function upsertBotCustomer(
  customers: CustomerUser[],
  input: {
    telegramId: string | number;
    name?: string | null;
    phone?: string | null;
    username?: string | null;
    address?: string | null;
    source?: 'bot' | 'manual';
    /**
     * Pass true ONLY when `name` was typed by the customer (or set by an
     * admin). A name copied from the Telegram profile must pass false/omit it;
     * such a name is kept as a display hint but is not treated as a confirmed
     * order/recipient name.
     */
    nameConfirmed?: boolean;
  },
): CustomerUser {
  const now = new Date().toISOString();
  const inputHasRealName = isRealName(input.name);
  let customer = findBotCustomer(customers, input.telegramId);

  if (!customer) {
    customer = {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      telegramId: String(input.telegramId),
      name: inputHasRealName ? String(input.name).trim() : 'مشتری',
      // The name only counts as confirmed when the caller explicitly says so
      // (customer typed it / admin set it).
      nameConfirmed: inputHasRealName ? Boolean(input.nameConfirmed) : false,
      phone: String(input.phone || '').trim(),
      username: input.username ? String(input.username) : '',
      address: String(input.address || '').trim() || undefined,
      addresses: [],
      walletBalance: 0,
      rewardPoints: 10,
      totalOrdersCount: 0,
      totalSpentTomans: 0,
      tier: 'bronze',
      source: input.source || 'bot',
      createdAt: now,
      lastActiveAt: now,
    };
    customers.unshift(customer);
  }

  if (inputHasRealName) {
    // A confirmed (typed/admin) name always wins. An unconfirmed profile name
    // is only stored when the record still has no confirmed name of its own,
    // so a previously confirmed name can never be silently overwritten by the
    // Telegram account display name.
    if (input.nameConfirmed || !customer.nameConfirmed) {
      customer.name = String(input.name).trim();
    }
    if (input.nameConfirmed) customer.nameConfirmed = true;
  }
  if (input.phone && String(input.phone).trim()) customer.phone = String(input.phone).trim();
  if (input.username) customer.username = String(input.username);
  rememberAddress(customer, input.address);
  customer.lastActiveAt = now;
  return customer;
}

/**
 * Startup migration: merge legacy duplicate profiles so that every Telegram
 * account maps to exactly one customer. Stats/wallet/order counts are summed,
 * the best-known name/phone/username win, and all addresses are accumulated.
 * Records without a real Telegram id (admin-created manual users) are kept
 * individually and never merged.
 */
export function dedupeCustomers(rawCustomers: CustomerUser[]): CustomerUser[] {
  if (!Array.isArray(rawCustomers)) return rawCustomers || [];
  const merged = new Map<string, CustomerUser>();
  const manual: CustomerUser[] = [];

  for (const record of rawCustomers) {
    if (!record) continue;
    const tgId = String(record.telegramId || '').trim();
    if (!isBotLinkedTelegramId(tgId)) {
      manual.push(record);
      continue;
    }
    const existing = merged.get(tgId);
    if (!existing) {
      merged.set(tgId, { ...record, source: 'bot' });
      continue;
    }
    const book = new Set<string>([
      ...(existing.addresses || []),
      ...(record.addresses || []),
      ...(existing.address ? [existing.address] : []),
      ...(record.address ? [record.address] : []),
    ].filter(Boolean) as string[]);
    merged.set(tgId, {
      ...existing,
      ...record,
      name: isRealName(record.name) ? record.name! : existing.name,
      phone: record.phone?.trim() || existing.phone,
      username: record.username || existing.username,
      address: record.address || existing.address,
      addresses: Array.from(book).slice(-20),
      walletBalance: (existing.walletBalance || 0) + (record.walletBalance || 0),
      rewardPoints: Math.max(existing.rewardPoints || 0, record.rewardPoints || 0),
      totalOrdersCount: (existing.totalOrdersCount || 0) + (record.totalOrdersCount || 0),
      totalSpentTomans: (existing.totalSpentTomans || 0) + (record.totalSpentTomans || 0),
      createdAt: [existing.createdAt, record.createdAt].filter(Boolean).sort()[0] || existing.createdAt,
      lastActiveAt: [existing.lastActiveAt, record.lastActiveAt].filter(Boolean).sort().slice(-1)[0] || existing.lastActiveAt,
    });
  }

  return [...merged.values(), ...manual];
}
