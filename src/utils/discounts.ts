import type { DiscountCode, Product } from '../types';

export interface DiscountCartItem {
  productId: string;
  quantity: number;
}

export type DiscountRejectionReason =
  | 'not_found'
  | 'inactive'
  | 'usage_limit'
  | 'expired'
  | 'min_purchase'
  | 'not_applicable';

export interface DiscountValidationResult {
  valid: boolean;
  message: string;
  /** Present only when `valid` is false. */
  reason?: DiscountRejectionReason;
  /** Present only when `valid` is true. */
  discount?: DiscountCode;
  /** Present only when `valid` is true. */
  discountAmount?: number;
}

/**
 * Single source of truth for coupon rules.
 *
 * The web panel lets an administrator attach rich constraints to a code
 * (active flag, usage cap, expiry, minimum basket, per-product scope, and a
 * maximum discount for percentage codes). Those rules previously lived only in
 * the `/api/discounts/validate` endpoint, so the Telegram bot had no way to
 * honour them. Keeping the logic here lets the HTTP API and the bot checkout
 * apply exactly the same rules.
 */
export function validateDiscountCode(
  rawCode: unknown,
  options: {
    discounts: DiscountCode[];
    products: Product[];
    subtotal: number;
    items?: DiscountCartItem[];
  },
): DiscountValidationResult {
  const cleanCode = String(rawCode ?? '').trim().toUpperCase();
  if (!cleanCode) {
    return { valid: false, reason: 'not_found', message: 'لطفاً کد تخفیف را وارد کنید.' };
  }

  const discount = options.discounts.find((item) => item.code.trim().toUpperCase() === cleanCode);
  if (!discount) {
    return { valid: false, reason: 'not_found', message: 'کد تخفیف وارد شده معتبر نمی‌باشد.' };
  }
  if (!discount.isActive) {
    return { valid: false, reason: 'inactive', message: 'این کد تخفیف در حال حاضر غیرفعال است.' };
  }
  if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
    return { valid: false, reason: 'usage_limit', message: 'سقف استفاده از این کد تخفیف به پایان رسیده است.' };
  }
  if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
    return { valid: false, reason: 'expired', message: 'مهلت استفاده از این کد تخفیف منقضی شده است.' };
  }

  const orderSubtotal = Number(options.subtotal) || 0;
  if (discount.minPurchaseAmount && orderSubtotal < discount.minPurchaseAmount) {
    return {
      valid: false,
      reason: 'min_purchase',
      message: `این کد تخفیف برای خریدهای بالای ${discount.minPurchaseAmount.toLocaleString('fa-IR')} تومان قابل استفاده است.`,
    };
  }

  // A scoped code may only discount the value of the products it covers.
  const applicable = discount.applicableProductIds || [];
  let baseAmount = orderSubtotal;
  if (applicable.length > 0) {
    const cartItems = Array.isArray(options.items) ? options.items : [];
    baseAmount = cartItems.reduce((sum, item) => {
      if (!applicable.includes(item.productId)) return sum;
      const product = options.products.find((candidate) => candidate.id === item.productId);
      if (!product) return sum;
      const effectivePrice = product.discountPercent
        ? product.price * (100 - product.discountPercent) / 100
        : product.price;
      return sum + effectivePrice * (item.quantity || 1);
    }, 0);
    if (baseAmount <= 0) {
      return {
        valid: false,
        reason: 'not_applicable',
        message: 'این کد تخفیف فقط برای محصولات خاصی قابل استفاده است که در سبد شما وجود ندارد.',
      };
    }
  }

  let discountAmount: number;
  if (discount.type === 'percentage') {
    discountAmount = Math.round((baseAmount * discount.value) / 100);
    if (discount.maxDiscountAmount && discountAmount > discount.maxDiscountAmount) {
      discountAmount = discount.maxDiscountAmount;
    }
  } else {
    discountAmount = Math.min(discount.value, baseAmount);
  }

  return {
    valid: true,
    discount,
    discountAmount,
    message: discount.type === 'percentage'
      ? `کد تخفیف ${discount.value}٪ با موفقیت اعمال شد!`
      : `تخفیف ${discount.value.toLocaleString('fa-IR')} تومانی با موفقیت اعمال شد!`,
  };
}
