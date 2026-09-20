import { BroadcastAudience, CustomerUser } from '../types';

const TIER_LABELS: Record<string, string> = {
  bronze: 'برنزی',
  silver: 'نقره‌ای',
  gold: 'طلایی',
  vip: 'ویژه (VIP)',
};

const DEFAULT_WINDOW_DAYS = 30;

/**
 * A customer can only receive a broadcast when the bot knows their private
 * chat. Customers added manually in the panel often have no Telegram id yet.
 */
export function canReceiveBroadcast(customer: CustomerUser): boolean {
  const id = String(customer.telegramId || '').trim();
  return id !== '' && id !== 'guest';
}

/**
 * Resolve a broadcast audience to concrete customers.
 *
 * Shared by the API and the panel so the recipient count shown before sending
 * is exactly the set the server will message — the two must never drift.
 */
export function resolveBroadcastAudience(
  customers: CustomerUser[],
  audience: BroadcastAudience,
  now: number = Date.now()
): { recipients: CustomerUser[]; label: string } {
  const reachable = customers.filter(canReceiveBroadcast);
  const days = Number(audience.days) > 0 ? Number(audience.days) : DEFAULT_WINDOW_DAYS;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const activeAt = (c: CustomerUser) => new Date(c.lastActiveAt || 0).getTime();

  switch (audience.type) {
    case 'tag': {
      const tag = String(audience.tag || '').trim();
      if (!tag) return { recipients: [], label: 'برچسب نامشخص' };
      return {
        recipients: reachable.filter((c) => (c.tags || []).includes(tag)),
        label: `برچسب: ${tag}`,
      };
    }
    case 'tier':
      return {
        recipients: reachable.filter((c) => c.tier === audience.tier),
        label: `سطح مشتری: ${TIER_LABELS[String(audience.tier)] || audience.tier}`,
      };
    case 'selected': {
      const ids = new Set((audience.customerIds || []).map(String));
      return {
        recipients: reachable.filter((c) => ids.has(c.id)),
        label: `${ids.size} مشتری انتخاب‌شده`,
      };
    }
    case 'no_orders':
      return {
        recipients: reachable.filter((c) => !c.totalOrdersCount),
        label: 'مشتریانی که هنوز خرید نکرده‌اند',
      };
    case 'recent_buyers':
      return {
        recipients: reachable.filter((c) => (c.totalOrdersCount || 0) > 0 && activeAt(c) >= cutoff),
        label: `خریداران ${days} روز اخیر`,
      };
    case 'inactive':
      return {
        recipients: reachable.filter((c) => activeAt(c) < cutoff),
        label: `مشتریان غیرفعال (بیش از ${days} روز)`,
      };
    case 'all':
    default:
      return { recipients: reachable, label: 'همهٔ مشتریان' };
  }
}

/**
 * Distinct tags in use, most-used first, for the category pickers.
 *
 * Counts only customers the bot can actually message: the count is displayed
 * next to the category as the number of people who will receive the broadcast,
 * so including unreachable customers would overstate the reach.
 */
export function collectCustomerTags(customers: CustomerUser[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const customer of customers.filter(canReceiveBroadcast)) {
    for (const tag of customer.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
