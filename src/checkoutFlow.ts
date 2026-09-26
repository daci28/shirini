import { BotSettings, Product, Order, DiscountCode, CustomerUser } from './types';
import { generateUniqueOrderNumber } from './utils/orderNumber';
import { t as botText } from './data/botMessages';
import { findBotCustomer, upsertBotCustomer, isRealName } from './utils/customers';
import { validateDiscountCode } from './utils/discounts';

interface SimpleMap<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
  delete(key: string): boolean;
  has?(key: string): boolean;
}

interface TelegramContext {
  token: string;
  chatId: string;
  messageId?: number;
  products: Product[];
  orders: Order[];
  discounts: DiscountCode[];
  customers: CustomerUser[];
  botSettings: BotSettings;
  userCarts: SimpleMap<any[]>;
  userStates: SimpleMap<any>;
  msg?: any;
}

const getTelegramDisplayName = (message?: any): string => {
  const from = message?.from;
  const fullName = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return fullName || from?.username || '';
};

function normalizeGroupId(id: string | number | undefined): string {
  if (!id) return '';
  const str = String(id).trim();
  if (!str) return '';
  if (/^\d+$/.test(str)) return `-100${str}`;
  if (str.startsWith('-') && !str.startsWith('-100') && /^\-\d+$/.test(str)) {
    return `-100${str.slice(1)}`;
  }
  return str;
}

async function notifyForumTopic(ctx: TelegramContext, key: string, messageText: string, photo?: string) {
  const rawId = ctx.botSettings?.forumGroupId;
  const groupId = normalizeGroupId(rawId);
  if (!groupId || !ctx.token) return;
  const topic = (ctx.botSettings.forumTopics || []).find((t: any) => t.key === key);
  if (topic && (topic.enabled === false || topic.autoReport === false)) return;
  const threadId = topic?.threadId ? Number(topic.threadId) : undefined;

  const textPayload: any = {
    chat_id: groupId,
    parse_mode: 'HTML',
    text: messageText,
  };
  if (threadId) textPayload.message_thread_id = threadId;

  try {
    const res = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(textPayload),
    });
    const resData = (await res.json().catch(() => ({}))) as any;
    if (resData?.ok) return;

    if (threadId) {
      delete textPayload.message_thread_id;
      await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textPayload),
      });
    }
  } catch (err) {
    console.error('checkout notifyForumTopic error:', err);
  }
}

async function tgSend(ctx: TelegramContext, text: string, buttons?: any[][], photo?: string) {
  if (ctx.messageId && !photo) {
    try {
      const editPayload: any = {
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        parse_mode: 'HTML',
        text,
      };
      if (buttons && buttons.length > 0) editPayload.reply_markup = { inline_keyboard: buttons };
      const res = await fetch(`https://api.telegram.org/bot${ctx.token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editPayload)
      });
      const body: any = await res.json().catch(() => null);
      if (body?.ok || (typeof body?.description === 'string' && body.description.includes('message is not modified'))) {
        return { ok: true, status: 200, body };
      }
    } catch { /* fallback to normal send below */ }
  }

  const endpoint = photo ? 'sendPhoto' : 'sendMessage';
  const payload: any = photo
    ? { chat_id: ctx.chatId, parse_mode: 'HTML', photo, caption: text }
    : { chat_id: ctx.chatId, parse_mode: 'HTML', text };
  if (buttons && buttons.length > 0) payload.reply_markup = { inline_keyboard: buttons };

  const send = async (): Promise<{ ok: boolean; status: number; body: any }> => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${ctx.token}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let body: any = null;
      try { body = await res.json(); } catch { /* non-JSON */ }
      return { ok: Boolean(body?.ok), status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { error: String(err) } };
    }
  };

  let result = await send();
  for (let attempt = 1; attempt <= 3 && !result.ok; attempt++) {
    const wait = result.body?.parameters?.retry_after
      ? Number(result.body.parameters.retry_after) * 1000
      : Math.min(400 * attempt, 1200);
    console.error(`[checkout] ${endpoint} attempt ${attempt} failed (status ${result.status}):`, JSON.stringify(result.body)?.slice(0, 300));
    await new Promise(r => setTimeout(r, wait));
    result = await send();
  }

  if (!result.ok) {
    console.error(`[checkout] ${endpoint} failed after retries:`, JSON.stringify(result.body)?.slice(0, 500));
    // Resend as PLAIN text (no HTML parse mode) but KEEP the inline buttons, so
    // a parse-entity rejection can never strip the keyboard and leave the
    // customer with a dead text message.
    try {
      const plain: any = { chat_id: ctx.chatId, text: text.replace(/<[^>]+>/g, '') };
      if (buttons && buttons.length > 0) plain.reply_markup = { inline_keyboard: buttons };
      const fallback = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plain)
      });
      const fb = await fallback.json().catch(() => null);
      if (fb?.ok) {
        console.error(`[checkout] ${endpoint}: recovered via plain-text + buttons fallback`);
        return { ok: true, status: 200, body: fb };
      }
      // Last resort: plain text with no buttons at all.
      const last = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ctx.chatId, text: text.replace(/<[^>]+>/g, '') })
      });
      const lb = await last.json().catch(() => null);
      console.error('[checkout] all sends failed. plain fallback:', JSON.stringify(lb));
    } catch (err) {
      console.error('[checkout] fallback send threw:', err);
    }
  }
  return result;
}

const CANCEL_ROW = [{ text: '❌ انصراف', callback_data: 'back_to_main', style: 'danger' as const }];

function knownProfile(ctx: TelegramContext) {
  const known = findBotCustomer(ctx.customers, ctx.chatId);
  // A name is only reused when the customer confirmed it themselves. A name
  // copied from the Telegram account is a display hint, not the recipient
  // name, so checkout must always ask for it in that case.
  const knownName = known && known.nameConfirmed && isRealName(known.name) ? known.name! : '';
  const knownPhone = known?.phone || '';
  const knownAddresses: string[] = known?.addresses?.length
    ? known.addresses
    : (known?.address ? [known.address] : []);
  return { known, knownName, knownPhone, knownAddresses };
}

function makeDraft(ctx: TelegramContext) {
  const { knownName, knownPhone, knownAddresses } = knownProfile(ctx);
  return {
    customerName: knownName || '',
    customerPhone: knownPhone || '',
    addresses: knownAddresses,
    customerAddress: knownAddresses[knownAddresses.length - 1] || '',
  };
}

// Name + phone are already collected before the delivery method is chosen,
// so after the pickup/delivery choice we either ask for an address (courier)
// or move straight to payment (in-store pickup).
async function continueAfterDelivery(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  const draft = state.draftOrder;

  // Defensive: if we somehow reach here without contact details, re-ask them.
  if (!draft.customerName || !isRealName(draft.customerName)) {
    state.mode = 'checkout_name';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `✅ <b>ثبت سفارش</b>\n\nلطفاً <b>نام و نام خانوادگی</b> خود را وارد کنید:`, [CANCEL_ROW]);
    return;
  }
  if (!draft.customerPhone) {
    state.mode = 'checkout_phone';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `📞 لطفاً <b>شماره تلفن</b> خود را وارد کنید:`, [CANCEL_ROW]);
    return;
  }

  if (draft.deliveryMethod === 'delivery') {
    await sendAddressChoice(ctx);
  } else {
    // Pickup needs no address, so the coupon question is the last step here.
    await askForDiscountCode(ctx);
  }
}

/**
 * Entry point after "ثبت سفارش و پرداخت".
 * The FIRST step is always the customer's name (نام و نام خانوادگی). When the
 * name is already known we move straight to the phone, and only after both
 * contact details are known do we ask how they want to receive the order.
 */
export async function startCheckout(ctx: TelegramContext) {
  const cart = ctx.userCarts.get(ctx.chatId) || [];
  if (cart.length === 0) {
    await tgSend(ctx, '🛒 سبد خرید خالی است!', [
      [{ text: '🍰 منو', callback_data: 'menu_categories', style: 'primary' }],
      [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main', style: 'danger' }]
    ]);
    return;
  }

  const draft = makeDraft(ctx);
  ctx.userStates.set(ctx.chatId, { mode: 'checkout_name', draftOrder: draft });

  if (!draft.customerName || !isRealName(draft.customerName)) {
    await tgSend(
      ctx,
      `✅ <b>ثبت سفارش</b>\n\nبرای شروع، لطفاً <b>نام و نام خانوادگی</b> خود را وارد کنید:`,
      [CANCEL_ROW]
    );
    return;
  }

  // Name already known -> continue from the phone step.
  await continueAfterName(ctx);
}

// Called once the customer name is captured: ask for phone, then move on to
// delivery method / address / payment.
async function continueAfterName(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  const draft = state.draftOrder;

  if (!draft.customerPhone) {
    state.mode = 'checkout_phone';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `✅ نام ثبت شد: <b>${draft.customerName}</b>\n\n📞 لطفاً <b>شماره تلفن</b> خود را وارد کنید:`, [CANCEL_ROW]);
    return;
  }

  // Contact already known -> ask delivery method.
  await sendDeliveryMethod(ctx);
}

async function sendDeliveryMethod(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  const draft = state.draftOrder;
  state.mode = 'checkout_delivery_method';
  ctx.userStates.set(ctx.chatId, state);

  const greeting = draft.customerName ? `👤 <b>${draft.customerName}</b> عزیز،\n\n` : '';
  await tgSend(
    ctx,
    `${greeting}🚚 لطفاً <b>نحوهٔ دریافت سفارش</b> را انتخاب کنید:`,
    [
      [{ text: '🏪 دریافت حضوری (رایگان)', callback_data: 'delivery_pickup', style: 'primary' }],
      [{ text: '🛵 دریافت با پیک', callback_data: 'delivery_delivery', style: 'primary' }],
      CANCEL_ROW
    ]
  );
}

export async function handleCheckoutState(ctx: TelegramContext, text: string): Promise<boolean> {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state || !state.draftOrder) return false;
  const draft = state.draftOrder;

  if (state.mode === 'checkout_name') {
    const customerName = text.trim();
    if (customerName.length < 2) {
      await tgSend(ctx, '❌ لطفاً نام و نام خانوادگی معتبر را وارد کنید:');
      return true;
    }
    draft.customerName = customerName;
    ctx.userStates.set(ctx.chatId, state);
    await continueAfterName(ctx);
    return true;
  }

  if (state.mode === 'checkout_phone') {
    const customerPhone = text.trim();
    if (customerPhone.length < 7) {
      await tgSend(ctx, '❌ لطفاً شماره تلفن معتبر را وارد کنید:');
      return true;
    }
    draft.customerPhone = customerPhone;
    ctx.userStates.set(ctx.chatId, state);
    // After phone, ask how the order will be received.
    await sendDeliveryMethod(ctx);
    return true;
  }

  if (state.mode === 'checkout_new_address' || state.mode === 'checkout_address') {
    const deliveryAddress = text.trim();
    if (deliveryAddress.length < 5) {
      await tgSend(ctx, '❌ لطفاً آدرس دقیق‌تری وارد کنید:');
      return true;
    }
    draft.customerAddress = deliveryAddress;
    const book: string[] = Array.isArray(draft.addresses) ? [...draft.addresses] : [];
    if (!book.includes(deliveryAddress)) book.push(deliveryAddress);
    draft.addresses = book;
    ctx.userStates.set(ctx.chatId, state);
    await askForDiscountCode(ctx);
    return true;
  }

  // The customer typed a coupon code at the dedicated discount step.
  if (state.mode === 'checkout_discount_code') {
    const typedCode = text.trim();
    if (!typedCode) {
      await tgSend(ctx, '❌ لطفاً کد تخفیف را وارد کنید یا گزینهٔ «کد تخفیف ندارم» را بزنید:', [
        [{ text: '🚫 کد تخفیف ندارم', callback_data: 'checkout_skip_discount' }],
        CANCEL_ROW,
      ]);
      return true;
    }

    const { subtotal, cartItems } = calculateCartSubtotal(ctx);
    const result = validateDiscountCode(typedCode, {
      discounts: ctx.discounts,
      products: ctx.products,
      subtotal,
      items: cartItems,
    });

    if (!result.valid) {
      await tgSend(ctx, `❌ ${result.message}\n\nمی‌توانید کد دیگری وارد کنید یا بدون تخفیف ادامه دهید:`, [
        [{ text: '🚫 ادامه بدون تخفیف', callback_data: 'checkout_skip_discount' }],
        CANCEL_ROW,
      ]);
      return true;
    }

    draft.couponCode = result.discount!.code;
    draft.discountAmount = result.discountAmount || 0;
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `🎉 <b>${result.message}</b>\n\n💰 مبلغ کسر شده: <b>${(result.discountAmount || 0).toLocaleString()} تومان</b>`);
    await finishRegistration(ctx);
    return true;
  }

  return false;
}

/** Cart subtotal honouring each product's own percentage discount. */
function calculateCartSubtotal(ctx: TelegramContext): {
  subtotal: number;
  cartItems: { productId: string; quantity: number }[];
} {
  const cart = ctx.userCarts.get(ctx.chatId) || [];
  let subtotal = 0;
  const cartItems: { productId: string; quantity: number }[] = [];
  cart.forEach((item: any) => {
    const product = ctx.products.find(candidate => candidate.id === item.productId);
    if (!product) return;
    const effectivePrice = product.discountPercent
      ? product.price * (100 - product.discountPercent) / 100
      : product.price;
    subtotal += effectivePrice * item.quantity;
    cartItems.push({ productId: item.productId, quantity: item.quantity });
  });
  return { subtotal, cartItems };
}

/**
 * Final step before payment: offer to apply a coupon.
 *
 * The panel has a full discount engine, but the bot checkout jumped straight
 * from the address to the payment buttons and hard-coded `discountAmount = 0`,
 * so a customer had no way to redeem any code.
 */
async function askForDiscountCode(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state || !state.draftOrder) { await offerRestart(ctx); return; }

  // The question is always asked, even when the shop currently has no usable
  // code. Skipping it silently made the step look missing to the customer, and
  // a code can be activated in the panel at any moment between these steps.
  state.mode = 'checkout_discount_code';
  ctx.userStates.set(ctx.chatId, state);
  await tgSend(
    ctx,
    '🏷️ <b>کد تخفیف دارید؟</b>\n\nاگر کد تخفیف دارید، آن را همین‌جا تایپ و ارسال کنید تا روی سفارش اعمال شود.\n\nدر غیر این صورت روی «کد تخفیف ندارم» بزنید تا به مرحلهٔ پرداخت بروید.',
    [
      [{ text: '🚫 کد تخفیف ندارم', callback_data: 'checkout_skip_discount' }],
      CANCEL_ROW,
    ],
  );
}

async function sendAddressChoice(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state || !state.draftOrder) return;
  const draft = state.draftOrder;
  const addresses: string[] = Array.isArray(draft.addresses) ? draft.addresses : [];

  // No saved address yet -> ask to type it.
  if (addresses.length === 0) {
    state.mode = 'checkout_new_address';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '🏠 لطفاً <b>آدرس دقیق تحویل</b> را وارد کنید:', [CANCEL_ROW]);
    return;
  }

  state.mode = 'checkout_address';
  ctx.userStates.set(ctx.chatId, state);
  const buttons: any[][] = [
    ...addresses.slice(-5).reverse().map((address, index) => ([{
      text: `📍 ${address.slice(0, 42)}`,
      callback_data: `checkout_saved_address_${addresses.length - 1 - index}`
    }])),
    [{ text: '➕ ثبت آدرس جدید', callback_data: 'checkout_new_address', style: 'primary' }],
    CANCEL_ROW
  ];
  await tgSend(ctx, '🏠 <b>انتخاب آدرس تحویل:</b>\n\nیک آدرس از قبل ثبت‌شده را انتخاب کنید یا آدرس جدید وارد کنید:', buttons);
}

async function offerRestart(ctx: TelegramContext): Promise<boolean> {
  const cart = ctx.userCarts.get(ctx.chatId) || [];
  if (cart.length === 0) {
    await tgSend(ctx, '🛒 سبد خرید شما خالی است یا جریان قبلی به پایان رسیده است.\n\nلطفاً دوباره از منوی محصولات سفارش خود را شروع کنید.', [
      [{ text: '🍰 منوی محصولات', callback_data: 'menu_categories', style: 'primary' }],
      [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main', style: 'danger' }]
    ]);
  } else {
    await tgSend(ctx, '⏳ جریان پرداخت قبلی منقضی شده است. در حال آماده‌سازی دوبارهٔ تسویه‌حساب…');
    await startCheckout(ctx);
  }
  return true;
}

const CHECKOUT_CALLBACKS = new Set([
  'delivery_pickup', 'delivery_delivery',
  'payment_cash_on_delivery', 'payment_online', 'checkout_new_address',
  // `no_discount` / `has_discount` are legacy payloads: a customer whose chat
  // still shows a keyboard from an older build would otherwise press a button
  // that no branch handles, leaving the order stuck at the discount step.
  'checkout_skip_discount', 'no_discount', 'has_discount',
]);

export async function handleCheckoutCallback(ctx: TelegramContext, data: string): Promise<boolean> {
  const state = ctx.userStates.get(ctx.chatId);
  const isCheckoutCallback = CHECKOUT_CALLBACKS.has(data) || data.startsWith('checkout_saved_address_');
  if ((!state || !state.draftOrder) && isCheckoutCallback) {
    return offerRestart(ctx);
  }
  if (!state || !state.draftOrder) return false;
  const draft = state.draftOrder;

  if (data === 'delivery_pickup') {
    draft.deliveryMethod = 'pickup';
    draft.shippingFee = 0;
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '🏪 دریافت حضوری انتخاب شد (هزینه ارسال: <b>رایگان</b>)');
    await continueAfterDelivery(ctx);
    return true;
  }

  if (data === 'delivery_delivery') {
    draft.deliveryMethod = 'delivery';
    const cart = ctx.userCarts.get(ctx.chatId) || [];
    let subtotal = 0;
    cart.forEach(item => {
      const p = ctx.products.find(prod => prod.id === item.productId);
      if (p) {
        const effectivePrice = p.discountPercent ? p.price * (100 - p.discountPercent) / 100 : p.price;
        subtotal += effectivePrice * item.quantity;
      }
    });
    const isFreeShip = subtotal >= ctx.botSettings.freeShippingThreshold;
    draft.shippingFee = isFreeShip ? 0 : ctx.botSettings.shippingFee;
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `🛵 دریافت با پیک انتخاب شد\n🚚 هزینه ارسال: <b>${draft.shippingFee === 0 ? 'رایگان' : draft.shippingFee.toLocaleString() + ' تومان'}</b>`);
    await continueAfterDelivery(ctx);
    return true;
  }

  if (data === 'checkout_new_address') {
    state.mode = 'checkout_new_address';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '🏠 لطفاً <b>آدرس دقیق تحویل</b> را وارد کنید:', [CANCEL_ROW]);
    return true;
  }

  if (data.startsWith('checkout_saved_address_')) {
    const index = Number(data.replace('checkout_saved_address_', ''));
    const addresses: string[] = Array.isArray(draft.addresses) ? draft.addresses : [];
    const chosen = addresses[index];
    if (!chosen) {
      await tgSend(ctx, '❌ آدرس پیدا نشد. لطفاً آدرس جدید را وارد کنید:', [CANCEL_ROW]);
      return true;
    }
    draft.customerAddress = chosen;
    ctx.userStates.set(ctx.chatId, state);
    await askForDiscountCode(ctx);
    return true;
  }

  // `no_discount` is the legacy payload for the same action.
  if (data === 'checkout_skip_discount' || data === 'no_discount') {
    draft.couponCode = undefined;
    draft.discountAmount = 0;
    ctx.userStates.set(ctx.chatId, state);
    await finishRegistration(ctx);
    return true;
  }

  // Legacy "I have a coupon" button: re-open the discount prompt rather than
  // falling through to the main menu.
  if (data === 'has_discount') {
    await askForDiscountCode(ctx);
    return true;
  }

  if (data === 'payment_cash_on_delivery') {
    draft.paymentMethod = 'cash_on_delivery';
    ctx.userStates.set(ctx.chatId, state);
    await createOrder(ctx);
    return true;
  }

  if (data === 'payment_online') {
    draft.paymentMethod = 'online_payment';
    ctx.userStates.set(ctx.chatId, state);
    await createOrder(ctx);
    return true;
  }

  return false;
}

/** Summary + PAYMENT inline buttons (must always render). */
async function finishRegistration(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state || !state.draftOrder) { await offerRestart(ctx); return; }
  const draft = state.draftOrder;

  const cart = ctx.userCarts.get(ctx.chatId) || [];
  let subtotal = 0;
  const items = cart.map(item => {
    const p = ctx.products.find(prod => prod.id === item.productId);
    if (!p) return null;
    const effectivePrice = p.discountPercent ? p.price * (100 - p.discountPercent) / 100 : p.price;
    const itemTotal = effectivePrice * item.quantity;
    subtotal += itemTotal;
    return {
      productCode: p.productCode,
      productName: p.name,
      quantity: item.quantity,
      unit: p.unit,
      price: effectivePrice,
      total: itemTotal
    };
  }).filter(Boolean);

  const shippingFee = draft.deliveryMethod === 'delivery'
    ? (subtotal >= ctx.botSettings.freeShippingThreshold ? 0 : (ctx.botSettings.shippingFee || 0))
    : 0;
  // Re-validate the coupon against the final basket so an edited cart can never
  // carry a stale or now-ineligible discount into the created order.
  let discountAmount = 0;
  if (draft.couponCode) {
    const revalidated = validateDiscountCode(draft.couponCode, {
      discounts: ctx.discounts,
      products: ctx.products,
      subtotal,
      items: cart.map((item: any) => ({ productId: item.productId, quantity: item.quantity })),
    });
    if (revalidated.valid) {
      discountAmount = Math.min(revalidated.discountAmount || 0, subtotal + shippingFee);
    } else {
      draft.couponCode = undefined;
    }
  }
  const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

  let summary = `✅ <b>اطلاعات شما ثبت شد.</b>\n\n`;
  summary += `👤 <b>نام:</b> ${draft.customerName}\n`;
  summary += `📞 <b>تلفن:</b> ${draft.customerPhone}\n`;
  summary += `📦 <b>نحوه دریافت:</b> ${draft.deliveryMethod === 'pickup' ? '🏪 حضوری' : '🛵 پیک'}\n`;
  if (draft.deliveryMethod === 'delivery') {
    summary += `🏠 <b>آدرس:</b> ${draft.customerAddress}\n`;
  }
  summary += `\n🧾 <b>خلاصه سفارش:</b>\n`;
  items.forEach((item, idx) => {
    summary += `${idx + 1}. ${item!.productName} — ${item!.quantity} ${item!.unit} = <b>${item!.total.toLocaleString()}</b>\n`;
  });
  summary += `\n💵 مجموع اقلام: <b>${subtotal.toLocaleString()}</b>\n`;
  summary += `🚚 هزینه ارسال: <b>${shippingFee === 0 ? 'رایگان' : shippingFee.toLocaleString()}</b>\n`;
  if (discountAmount > 0) {
    summary += `🏷️ تخفیف (${draft.couponCode}): <b>-${discountAmount.toLocaleString()}</b>\n`;
  }
  summary += `💎 <b>مبلغ نهایی: ${totalAmount.toLocaleString()} تومان</b>\n\n`;
  summary += `💳 لطفاً <b>نحوهٔ پرداخت</b> را انتخاب کنید:`;

  draft.items = items;
  draft.subtotal = subtotal;
  draft.shippingFee = shippingFee;
  draft.discountAmount = discountAmount;
  draft.totalAmount = totalAmount;
  state.mode = 'checkout_payment_method';
  ctx.userStates.set(ctx.chatId, state);

  await tgSend(ctx, summary, [
    [{ text: '💵 پرداخت در محل', callback_data: 'payment_cash_on_delivery', style: 'success' }],
    [{ text: '💳 پرداخت هم اکنون', callback_data: 'payment_online', style: 'success' }],
    CANCEL_ROW
  ]);
}

async function createOrder(ctx: TelegramContext) {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state || !state.draftOrder) { await offerRestart(ctx); return; }
  const draft = state.draftOrder;
  if (!draft.customerName || !draft.customerPhone) { await offerRestart(ctx); return; }
  if (draft.deliveryMethod === 'delivery' && !draft.customerAddress) {
    await sendAddressChoice(ctx);
    return;
  }

  const orderNumber = generateUniqueOrderNumber(ctx.orders);
  const newOrder: Order = {
    id: `ord-${Date.now()}`,
    orderNumber,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    customerAddress: draft.deliveryMethod === 'delivery' ? draft.customerAddress : '',
    customerTelegramId: ctx.chatId,
    customerUsername: ctx.msg?.from?.username || undefined,
    customerTelegramName: getTelegramDisplayName(ctx.msg) || undefined,
    deliveryRecipientName: draft.customerName,
    items: draft.items,
    subtotal: draft.subtotal,
    shippingFee: draft.shippingFee,
    discountAmount: draft.discountAmount || 0,
    couponCode: draft.couponCode || undefined,
    totalAmount: draft.totalAmount,
    status: draft.paymentMethod === 'cash_on_delivery' ? 'pending_payment' : 'paid_checking',
    deliveryMethod: draft.deliveryMethod || 'delivery',
    paymentMethod: draft.paymentMethod,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  ctx.orders.unshift(newOrder);

  // Count the redemption so a coupon's usage limit is actually enforced for
  // bot orders, exactly as the HTTP order endpoint already does.
  if (newOrder.couponCode) {
    const usedIndex = ctx.discounts.findIndex(
      d => d.code.trim().toUpperCase() === newOrder.couponCode?.trim().toUpperCase()
    );
    if (usedIndex !== -1) {
      ctx.discounts[usedIndex].usedCount = (ctx.discounts[usedIndex].usedCount || 0) + 1;
    }
  }

  ctx.userCarts.delete(ctx.chatId);
  ctx.userStates.delete(ctx.chatId);

  const now = new Date().toISOString();
  const customer = upsertBotCustomer(ctx.customers, {
    telegramId: ctx.chatId,
    name: newOrder.customerName,
    phone: newOrder.customerPhone,
    username: newOrder.customerUsername || '',
    address: newOrder.customerAddress || '',
    source: 'bot',
    // The name was explicitly typed at checkout, so it is the confirmed
    // recipient name and becomes the customer's profile name going forward.
    nameConfirmed: true,
  });
  customer.totalOrdersCount = (customer.totalOrdersCount || 0) + 1;
  customer.totalSpentTomans = (customer.totalSpentTomans || 0) + newOrder.totalAmount;
  customer.lastActiveAt = now;

  // Auto-report new customer order to the forum supergroup 'orders' topic
  const itemsList = newOrder.items
    .map((item) => `▫️ <b>${item.productName}</b>: ${item.quantity.toLocaleString('fa-IR')} ${item.unit || 'عدد'} (مبلغ: ${(item.price * item.quantity).toLocaleString('fa-IR')} تومان)`)
    .join('\n');

  const paymentLabel = newOrder.paymentMethod === 'online_payment' ? '💳 کارت به کارت / آنلاین' : '💵 پرداخت درب منزل / تحویل حضوری';
  const deliveryLabel = newOrder.deliveryMethod === 'delivery' ? '🛵 پیک موتوری' : '🏬 تحویل حضوری در قنادی';

  const orderReport = `🛒📦 <b>سفارش جدید مشتری در ربات تلگرام ثبت شد!</b>\n\n` +
    `🔖 <b>کد رهگیری:</b> <code>${newOrder.orderNumber}</code>\n` +
    `👤 <b>مشتری:</b> ${newOrder.customerName} (${newOrder.customerPhone || 'بدون شماره'})\n` +
    (newOrder.customerUsername ? `📱 <b>آیدی تلگرام:</b> @${newOrder.customerUsername}\n` : '') +
    `🛵 <b>نحوه دریافت:</b> ${deliveryLabel}\n` +
    (newOrder.customerAddress ? `📍 <b>آدرس تحویل:</b> ${newOrder.customerAddress}\n` : '') +
    `💳 <b>روش پرداخت:</b> ${paymentLabel}\n` +
    `────────────────\n` +
    `🛍️ <b>اقلام سفارش:</b>\n${itemsList}\n` +
    `────────────────\n` +
    (newOrder.discountAmount ? `🎟️ <b>تخفیف:</b> ${newOrder.discountAmount.toLocaleString('fa-IR')} تومان\n` : '') +
    (newOrder.shippingFee ? `🛵 <b>هزینه ارسال:</b> ${newOrder.shippingFee.toLocaleString('fa-IR')} تومان\n` : '') +
    `💵 <b>مبلغ نهایی:</b> <b>${newOrder.totalAmount.toLocaleString('fa-IR')} تومان</b>\n` +
    `⏰ <b>زمان ثبت:</b> ${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`;

  void notifyForumTopic(ctx, 'orders', orderReport);

  if (newOrder.couponCode) {
    void notifyForumTopic(
      ctx,
      'discounts',
      `🎟️ <b>استفاده از کد تخفیف در سفارش ${newOrder.orderNumber}</b>\n\n👤 مشتری: ${newOrder.customerName}\n🏷️ کد: <code>${newOrder.couponCode}</code>\n💰 مبلغ تخفیف: <b>${(newOrder.discountAmount || 0).toLocaleString('fa-IR')} تومان</b>`
    );
  }

  if (newOrder.paymentMethod === 'online_payment') {
    const confirmText = botText(ctx, 'orderSuccessOnlineMessage', {
      orderNumber,
      totalAmount: newOrder.totalAmount.toLocaleString(),
      cardNumber: ctx.botSettings.cardNumber || '---',
      cardHolder: ctx.botSettings.cardHolder || '---',
    });
    ctx.userStates.set(ctx.chatId, { mode: 'waiting_for_receipt', orderId: newOrder.id });
    await tgSend(ctx, confirmText, [[{ text: '❌ انصراف', callback_data: 'back_to_main', style: 'danger' }]]);
    return;
  }

  const confirmText = botText(ctx, 'orderSuccessCashMessage', {
    orderNumber,
    totalAmount: newOrder.totalAmount.toLocaleString(),
  });

  await tgSend(ctx, confirmText, [
    [{ text: '📦 پیگیری سفارشات', callback_data: 'track_order', style: 'primary' }],
    [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main', style: 'primary' }]
  ]);
}
