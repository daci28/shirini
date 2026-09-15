import { BotSettings, Product, Order, DiscountCode, CustomerUser } from './types';
import { generateUniqueOrderNumber } from './utils/orderNumber';
import { t as botText } from './data/botMessages';
import { findBotCustomer, upsertBotCustomer, isRealName } from './utils/customers';

interface SimpleMap<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
  delete(key: string): boolean;
  has?(key: string): boolean;
}

interface TelegramContext {
  token: string;
  chatId: string;
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

async function tgSend(ctx: TelegramContext, text: string, buttons?: any[][], photo?: string) {
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

const CANCEL_ROW = [{ text: '❌ انصراف', callback_data: 'back_to_main' }];

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
    await finishRegistration(ctx);
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
    await tgSend(ctx, '🛒 سبد خرید خالی است!', [[{ text: '🍰 منو', callback_data: 'menu_categories' }]]);
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
      [{ text: '🏪 دریافت حضوری (رایگان)', callback_data: 'delivery_pickup' }],
      [{ text: '🛵 دریافت با پیک', callback_data: 'delivery_delivery' }],
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
    await finishRegistration(ctx);
    return true;
  }

  return false;
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
    [{ text: '➕ ثبت آدرس جدید', callback_data: 'checkout_new_address' }],
    CANCEL_ROW
  ];
  await tgSend(ctx, '🏠 <b>انتخاب آدرس تحویل:</b>\n\nیک آدرس از قبل ثبت‌شده را انتخاب کنید یا آدرس جدید وارد کنید:', buttons);
}

async function offerRestart(ctx: TelegramContext): Promise<boolean> {
  const cart = ctx.userCarts.get(ctx.chatId) || [];
  if (cart.length === 0) {
    await tgSend(ctx, '🛒 سبد خرید شما خالی است یا جریان قبلی به پایان رسیده است.\n\nلطفاً دوباره از منوی محصولات سفارش خود را شروع کنید.', [
      [{ text: '🍰 منوی محصولات', callback_data: 'menu_categories' }]
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
    await finishRegistration(ctx);
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
  const totalAmount = subtotal + shippingFee;

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
  summary += `💎 <b>مبلغ نهایی: ${totalAmount.toLocaleString()} تومان</b>\n\n`;
  summary += `💳 لطفاً <b>نحوهٔ پرداخت</b> را انتخاب کنید:`;

  draft.items = items;
  draft.subtotal = subtotal;
  draft.shippingFee = shippingFee;
  draft.discountAmount = 0;
  draft.totalAmount = totalAmount;
  state.mode = 'checkout_payment_method';
  ctx.userStates.set(ctx.chatId, state);

  await tgSend(ctx, summary, [
    [{ text: '💵 پرداخت در محل', callback_data: 'payment_cash_on_delivery' }],
    [{ text: '💳 پرداخت هم اکنون', callback_data: 'payment_online' }],
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
    totalAmount: draft.totalAmount,
    status: draft.paymentMethod === 'cash_on_delivery' ? 'pending_payment' : 'paid_checking',
    deliveryMethod: draft.deliveryMethod || 'delivery',
    paymentMethod: draft.paymentMethod,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  ctx.orders.unshift(newOrder);
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

  if (newOrder.paymentMethod === 'online_payment') {
    const confirmText = botText(ctx, 'orderSuccessOnlineMessage', {
      orderNumber,
      totalAmount: newOrder.totalAmount.toLocaleString(),
      cardNumber: ctx.botSettings.cardNumber || '---',
      cardHolder: ctx.botSettings.cardHolder || '---',
    });
    ctx.userStates.set(ctx.chatId, { mode: 'waiting_for_receipt', orderId: newOrder.id });
    await tgSend(ctx, confirmText, [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]]);
    return;
  }

  const confirmText = botText(ctx, 'orderSuccessCashMessage', {
    orderNumber,
    totalAmount: newOrder.totalAmount.toLocaleString(),
  });

  await tgSend(ctx, confirmText, [
    [{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }],
    [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
  ]);
}
