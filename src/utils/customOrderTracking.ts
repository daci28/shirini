import type { CustomPastryOrder, CustomPastryStatus } from '../types';
import { formatPrice, toPersianDigits } from './formatters';
import { formatIranianDateTime, formatIranianDeliveryDate, formatIranianDeliveryTime } from './iranianDate';
import { customPrepaymentStatusLabels, getCustomPrepaymentStatus } from './invoices';

/** Escape customer-entered values before putting them into Telegram HTML messages. */
export const escapeTelegramHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const compactCustomerText = (value: unknown, fallback = 'ثبت نشده', limit = 260): string => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return escapeTelegramHtml(fallback);

  const escaped = escapeTelegramHtml(normalized);
  if (escaped.length <= limit) return escaped;

  // The Telegram Bot API accepts at most 4096 characters per message. Limit
  // each user-entered field *after* HTML escaping, so a long run of < or &
  // cannot unexpectedly expand one tracking response past that limit.
  let lower = 0;
  let upper = normalized.length;
  const available = Math.max(1, limit - 1); // reserve one character for …
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (escapeTelegramHtml(normalized.slice(0, middle)).length <= available) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }
  return `${escapeTelegramHtml(normalized.slice(0, lower))}…`;
};

export const CUSTOM_ORDER_STATUS_LABELS: Record<CustomPastryStatus, string> = {
  pending_review: '🕐 در انتظار بررسی و قیمت‌گذاری',
  price_quoted: '💬 قیمت اعلام شده؛ در انتظار تأیید شما',
  approved_by_customer: '✅ تأیید شده؛ در صف آماده‌سازی',
  receipt_confirmed: '✅ فیش بیعانه تأیید شد؛ در انتظار شروع پخت',
  baking: '👩‍🍳 در حال پخت و تزیین',
  ready: '🎂 آماده تحویل / ارسال',
  delivered: '✅ تحویل داده شد',
  rejected: '❌ رد شده / لغو شده',
};

/**
 * Customer-facing, Telegram-safe details for a custom pastry order. Internal
 * workshop notes are deliberately omitted.
 */
export const formatCustomOrderTrackingMessage = (order: CustomPastryOrder): string => {
  const prepaymentStatus = getCustomPrepaymentStatus(order);
  const customerStatus = prepaymentStatus === 'pending_confirmation'
    ? '⏳ فیش بیعانه در انتظار تأیید ادمین'
    : CUSTOM_ORDER_STATUS_LABELS[order.status] || compactCustomerText(order.status, 'در حال بررسی', 80);
  const lines = [
    '🎂 <b>سفارش محصول سفارشی</b>',
    `🔖 <b>کد سفارش:</b> <code>${compactCustomerText(order.orderNumber, '---', 80)}</code>`,
    `📊 <b>وضعیت:</b> <b>${customerStatus}</b>`,
    `🗓 <b>ثبت شده در:</b> ${formatIranianDateTime(order.createdAt)}`,
    '',
    '📌 <b>مشخصات سفارش:</b>',
    `🧁 <b>نوع محصول:</b> ${compactCustomerText(order.pastryType)}`,
    `🎨 <b>طرح و توضیحات:</b> ${compactCustomerText(order.shapeAndDesign)}`,
  ];

  if (typeof order.weightKg === 'number' && order.weightKg > 0) lines.push(`⚖️ <b>وزن تقریبی:</b> ${toPersianDigits(order.weightKg)} کیلوگرم`);
  if (typeof order.servingCount === 'number' && order.servingCount > 0) lines.push(`👥 <b>تعداد نفرات:</b> ${toPersianDigits(order.servingCount)} نفر`);
  if (typeof order.tierCount === 'number' && order.tierCount > 0) lines.push(`🍰 <b>تعداد طبقات:</b> ${toPersianDigits(order.tierCount)} طبقه`);
  if (order.dietaryType) lines.push(`🌿 <b>نوع رژیم:</b> ${compactCustomerText(order.dietaryType, 'عادی')}`);
  if (order.writingOnCake) lines.push(`✍️ <b>متن روی کیک:</b> «${compactCustomerText(order.writingOnCake)}»`);
  if (Array.isArray(order.referenceImages) && order.referenceImages.length > 0) {
    lines.push(`📸 <b>تصویر نمونه:</b> ${toPersianDigits(order.referenceImages.length)} تصویر ثبت شده`);
  }

  lines.push(
    '',
    '📦 <b>تحویل:</b>',
    `🚚 <b>روش دریافت:</b> ${order.deliveryType === 'pickup' ? '🏪 حضوری' : '🛵 ارسال با پیک'}`,
    '📅 <b>زمان تحویل:</b> پس از تأیید سفارش با شما هماهنگ خواهد شد.',
  );

  if (order.deliveryType === 'delivery' && order.deliveryAddress) {
    lines.push(`📍 <b>آدرس:</b> ${compactCustomerText(order.deliveryAddress, 'هنوز ثبت نشده', 360)}`);
  }

  lines.push('', '💳 <b>هزینه و پرداخت:</b>');
  if (typeof order.finalPrice === 'number' && order.finalPrice > 0) {
    lines.push(`💰 <b>مبلغ نهایی:</b> ${formatPrice(order.finalPrice)}`);
  } else if (typeof order.estimatedPrice === 'number' && order.estimatedPrice > 0) {
    lines.push(`💡 <b>برآورد اولیه:</b> ${formatPrice(order.estimatedPrice)}`);
  } else {
    lines.push('💰 <b>قیمت:</b> پس از بررسی قناد اعلام می‌شود.');
  }

  if (typeof order.prepaymentAmount === 'number' && order.prepaymentAmount > 0) {
    const statusPrefix = prepaymentStatus === 'approved'
      ? '✅'
      : prepaymentStatus === 'pending_confirmation'
        ? '⏳'
        : prepaymentStatus === 'rejected'
          ? '❌'
          : '💳';
    lines.push(`💳 <b>بیعانه:</b> ${formatPrice(order.prepaymentAmount)} — ${statusPrefix} ${customPrepaymentStatusLabels[prepaymentStatus]}`);
    if (prepaymentStatus === 'rejected' && order.prepaymentRejectReason) {
      lines.push(`ℹ️ <b>دلیل رد فیش:</b> ${compactCustomerText(order.prepaymentRejectReason)}`);
    }
  }

  if (order.status === 'rejected' && order.rejectReason) {
    lines.push(`\nℹ️ <b>دلیل لغو / رد:</b> ${compactCustomerText(order.rejectReason)}`);
  }

  return lines.join('\n');
};
