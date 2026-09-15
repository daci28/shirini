/**
 * Central registry of every customer-facing Telegram bot message.
 *
 * Each key has a built-in Persian default. The admin can override any of them
 * from the panel's «شخصی‌سازی متون» section; overrides are persisted on the
 * server inside BotSettings.botTexts. `getBotText(settings, key, vars)` returns
 * the override when present, otherwise the default, with {placeholders}
 * replaced.
 *
 * Placeholders use {camelCase} tokens, e.g. {storeName}, {orderNumber},
 * {totalAmount}. Missing values render as an em dash so a broken template is
 * still readable.
 */

export type BotMessageKey =
  | 'welcomeMessage'
  | 'helpMessage'
  | 'contactInfoMessage'
  | 'emptyMenuMessage'
  | 'orderSuccessOnlineMessage'
  | 'orderSuccessCashMessage'
  | 'receiptAckMessage'
  | 'receiptApprovedMessage'
  | 'receiptRejectedMessage'
  | 'invoiceReceiptAckMessage'
  | 'invoicePaymentApprovedMessage'
  | 'invoicePaymentRejectedMessage'
  | 'customOrderSubmittedMessage'
  | 'customOrderQuoteMessage'
  | 'customOrderPaymentPromptMessage'
  | 'customPrepaymentAckMessage'
  | 'customPrepaymentApprovedMessage'
  | 'customPrepaymentRejectedMessage'
  | 'registrationCompleteMessage'
  | 'cashOnDeliverySelectedMessage'
  | 'noOrdersMessage'
  | 'supportPromptMessage'
  | 'ticketCreatedMessage'
  | 'genericErrorMessage'
  | 'adminOnlyMessage';

export interface BotMessageDefinition {
  key: BotMessageKey;
  title: string;
  description: string;
  defaultText: string;
  variables: { name: string; desc: string }[];
}

const VARIABLE_NOTE = 'متغیرهای داخل { } به‌صورت خودکار با اطلاعات واقعی جایگزین می‌شوند؛ آن‌ها را حذف نکنید.';

export const BOT_MESSAGES: Record<BotMessageKey, BotMessageDefinition> = {
  welcomeMessage: {
    key: 'welcomeMessage',
    title: 'پیام خوش‌آمدگویی (/start)',
    description: 'هنگام ورود مشتری به ربات یا ارسال /start نمایش داده می‌شود.',
    variables: [{ name: '{storeName}', desc: 'نام فروشگاه' }],
    defaultText:
      'به ربات سفارش آنلاین <b>{storeName}</b> خوش آمدید!\n\nاز طریق دکمه‌های زیر می‌توانید:\n🔹 محصولات ما را مشاهده و سفارش دهید\n🔹 سفارشات قبلی خود را پیگیری کنید\n🔹 اطلاعات تماس و آدرس ما را ببینید\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
  },
  helpMessage: {
    key: 'helpMessage',
    title: 'راهنمای ربات',
    description: 'پیام راهنما و دستورالعمل استفاده از ربات.',
    variables: [{ name: '{storeName}', desc: 'نام فروشگاه' }],
    defaultText:
      '<b>راهنمای استفاده از ربات {storeName}</b>\n\n🍰 برای سفارش: منوی محصولات ← انتخاب شیرینی ← افزودن به سبد ← تکمیل سفارش\n🎨 برای کیک سفارشی: گزینه «محصول سفارشی شما»\n📦 برای پیگیری: دکمه «پیگیری سفارشات من»\n💬 برای ارتباط با ما: «ارسال پیام به پشتیبانی»',
  },
  contactInfoMessage: {
    key: 'contactInfoMessage',
    title: 'اطلاعات تماس و آدرس',
    description: 'هنگام انتخاب «آدرس و اطلاعات تماس» ارسال می‌شود.',
    variables: [
      { name: '{storeName}', desc: 'نام فروشگاه' },
      { name: '{storePhone}', desc: 'تلفن فروشگاه' },
      { name: '{storeAddress}', desc: 'آدرس فروشگاه' },
      { name: '{cardNumber}', desc: 'شماره کارت' },
      { name: '{cardHolder}', desc: 'نام صاحب کارت' },
    ],
    defaultText:
      '📍 <b>اطلاعات تماس:</b>\n\n🏢 {storeName}\n📞 {storePhone}\n🏠 {storeAddress}\n💳 <code>{cardNumber}</code>\n👤 {cardHolder}',
  },
  emptyMenuMessage: {
    key: 'emptyMenuMessage',
    title: 'منوی خالی',
    description: 'وقتی محصول فعالی در دسته‌بندی یا کل منو وجود ندارد.',
    variables: [],
    defaultText: 'در حال حاضر محصول فعالی برای نمایش وجود ندارد. لطفاً بعداً دوباره سر بزنید یا با پشتیبانی در تماس باشید.',
  },
  orderSuccessOnlineMessage: {
    key: 'orderSuccessOnlineMessage',
    title: 'ثبت سفارش آنلاین (با فیش)',
    description: 'بلافاصله پس از ثبت سفارش کارت‌به‌کارت، همراه شماره کارت برای ارسال فیش.',
    variables: [
      { name: '{orderNumber}', desc: 'شماره سفارش' },
      { name: '{totalAmount}', desc: 'مبلغ کل' },
      { name: '{cardNumber}', desc: 'شماره کارت' },
      { name: '{cardHolder}', desc: 'نام صاحب کارت' },
    ],
    defaultText:
      '🎉 <b>سفارش شما با موفقیت ثبت شد!</b>\n\n🔖 <b>کد سفارش:</b> <code>{orderNumber}</code>\n💎 <b>مبلغ:</b> <b>{totalAmount} تومان</b>\n\n💳 <b>شماره کارت:</b>\n<code>{cardNumber}</code>\n👤 {cardHolder}\n\n⚠️ لطفاً مبلغ را واریز و عکس فیش را همین‌جا ارسال فرمایید.',
  },
  orderSuccessCashMessage: {
    key: 'orderSuccessCashMessage',
    title: 'ثبت سفارش پرداخت در محل',
    description: 'پیام موفقیت سفارش‌هایی که هنگام تحویل پرداخت می‌شوند.',
    variables: [
      { name: '{orderNumber}', desc: 'شماره سفارش' },
      { name: '{totalAmount}', desc: 'مبلغ کل' },
    ],
    defaultText:
      '🎉 <b>سفارش شما با موفقیت ثبت شد!</b>\n\n🔖 <b>کد سفارش:</b> <code>{orderNumber}</code>\n💎 <b>مبلغ:</b> <b>{totalAmount} تومان</b>\n\n💵 پرداخت هنگام تحویل انجام می‌شود.',
  },
  receiptAckMessage: {
    key: 'receiptAckMessage',
    title: 'تأیید دریافت فیش سفارش',
    description: 'پس از ارسال موفق فیش برای سفارش عادی به مشتری نشان داده می‌شود.',
    variables: [],
    defaultText:
      '✅ عکس فیش واریزی با موفقیت دریافت شد!\n\nسفارش شما در حال بررسی است. پس از تأیید، وضعیت سفارش به‌روزرسانی خواهد شد.',
  },
  receiptApprovedMessage: {
    key: 'receiptApprovedMessage',
    title: 'تأیید فیش توسط ادمین',
    description: 'وقتی ادمین فیش سفارش عادی را تأیید می‌کند.',
    variables: [{ name: '{orderNumber}', desc: 'شماره سفارش' }],
    defaultText:
      '✅ <b>فیش واریزی شما تأیید شد!</b>\n\n🔖 سفارش <code>{orderNumber}</code>\n📌 وضعیت سفارش: <b>فیش تأیید شده</b>\n👩‍🍳 سفارش شما آمادهٔ شروع پخت و تزیین است.',
  },
  receiptRejectedMessage: {
    key: 'receiptRejectedMessage',
    title: 'رد فیش توسط ادمین',
    description: 'وقتی ادمین فیش سفارش عادی را رد می‌کند.',
    variables: [
      { name: '{orderNumber}', desc: 'شماره سفارش' },
      { name: '{reason}', desc: 'دلیل رد (در صورت ثبت)' },
    ],
    defaultText:
      '❌ <b>متأسفانه فیش واریزی قابل تأیید نبود.</b>\n\n🔖 سفارش <code>{orderNumber}</code>{reason}\n📌 وضعیت سفارش: در انتظار پرداخت\n\nلطفاً فیش صحیح را با دکمه زیر ارسال کنید یا با پشتیبانی تماس بگیرید.',
  },
  invoiceReceiptAckMessage: {
    key: 'invoiceReceiptAckMessage',
    title: 'تأیید دریافت فیش فاکتور',
    description: 'پس از ارسال فیش برای فاکتور دستی در ربات.',
    variables: [{ name: '{invoiceNumber}', desc: 'شماره فاکتور' }],
    defaultText:
      '✅ <b>فیش فاکتور دریافت شد.</b>\n\n🔖 شماره فاکتور: <code>{invoiceNumber}</code>\n⏳ وضعیت پرداخت: <b>در انتظار تأیید ادمین</b>\nنتیجهٔ بررسی از همین چت به شما اعلام می‌شود.',
  },
  invoicePaymentApprovedMessage: {
    key: 'invoicePaymentApprovedMessage',
    title: 'تأیید پرداخت فاکتور',
    description: 'اعلام تأیید فیش فاکتور دستی به مشتری.',
    variables: [
      { name: '{invoiceNumber}', desc: 'شماره فاکتور' },
      { name: '{amount}', desc: 'مبلغ تأییدشده' },
      { name: '{remaining}', desc: 'مانده قابل پرداخت' },
    ],
    defaultText:
      '✅ <b>پرداخت فاکتور شما تأیید شد.</b>\n\n🔖 شماره فاکتور: <code>{invoiceNumber}</code>\n💰 مبلغ تأییدشده: <b>{amount} تومان</b>',
  },
  invoicePaymentRejectedMessage: {
    key: 'invoicePaymentRejectedMessage',
    title: 'رد پرداخت فاکتور',
    description: 'اعلام رد فیش فاکتور دستی به مشتری.',
    variables: [
      { name: '{invoiceNumber}', desc: 'شماره فاکتور' },
      { name: '{reason}', desc: 'دلیل رد (در صورت ثبت)' },
    ],
    defaultText:
      '❌ <b>فیش پرداختی فاکتور قابل تأیید نبود.</b>\n\n🔖 شماره فاکتور: <code>{invoiceNumber}</code>{reason}\n\nلطفاً فیش صحیح را دوباره ارسال کنید.',
  },
  customOrderSubmittedMessage: {
    key: 'customOrderSubmittedMessage',
    title: 'ثبت درخواست محصول سفارشی',
    description: 'پس از ارسال فرم محصول سفارشی به مشتری نمایش داده می‌شود.',
    variables: [{ name: '{orderNumber}', desc: 'کد سفارش' }],
    defaultText:
      '🎉 <b>محصول سفارشی شما با موفقیت ثبت شد!</b>\n\n🔖 کد سفارش: <code>{orderNumber}</code>\n\nسفارش شما در حال بررسی است. پس از اعلام قیمت، مشخصات تماس و آدرس تحویل را از شما دریافت می‌کنیم.\n\nاز اعتماد شما متشکریم! 🙏',
  },
  customOrderQuoteMessage: {
    key: 'customOrderQuoteMessage',
    title: 'اعلام قیمت سفارش سفارشی',
    description: 'متن پیشنهادی برای اطلاع‌رسانی قیمت و بیعانه (در پیام قیمت‌گذاری استفاده می‌شود).',
    variables: [
      { name: '{orderNumber}', desc: 'کد سفارش' },
      { name: '{finalPrice}', desc: 'قیمت نهایی' },
      { name: '{prepaymentAmount}', desc: 'مبلغ بیعانه' },
    ],
    defaultText:
      '💰 <b>قیمت نهایی سفارش {orderNumber} اعلام شد:</b>\n\n💵 مبلغ نهایی: <b>{finalPrice} تومان</b>\n💳 بیعانه برای شروع پخت: <b>{prepaymentAmount} تومان</b>\n\nبرای تأیید و شروع فرایند، دستورالعمل پرداخت را دنبال کنید.',
  },
  customOrderPaymentPromptMessage: {
    key: 'customOrderPaymentPromptMessage',
    title: 'راهنمای پرداخت بیعانه سفارش سفارشی',
    description: 'هنگام انتخاب پرداخت آنلاین برای بیعانه، همراه کارت ارسال می‌شود.',
    variables: [
      { name: '{prepaymentAmount}', desc: 'مبلغ بیعانه' },
      { name: '{cardNumber}', desc: 'شماره کارت' },
      { name: '{cardHolder}', desc: 'نام صاحب کارت' },
    ],
    defaultText:
      '💳 <b>پرداخت آنلاین</b>\n\n💰 مبلغ بیعانه: <b>{prepaymentAmount} تومان</b>\n\n💳 <b>شماره کارت:</b>\n<code>{cardNumber}</code>\n\n👤 <b>به نام:</b> {cardHolder}\n\nلطفاً مبلغ بیعانه را واریز و <b>عکس فیش واریزی</b> را ارسال فرمایید.',
  },
  customPrepaymentAckMessage: {
    key: 'customPrepaymentAckMessage',
    title: 'تأیید دریافت فیش بیعانه',
    description: 'پس از ارسال فیش بیعانهٔ سفارش سفارشی.',
    variables: [],
    defaultText:
      '✅ <b>فیش بیعانه دریافت شد.</b>\n\n⏳ وضعیت پرداخت: <b>در انتظار تأیید ادمین</b>\nسفارش شما پس از بررسی و تأیید فیش وارد مرحله آماده‌سازی می‌شود. نتیجهٔ بررسی از همین چت اعلام خواهد شد.',
  },
  customPrepaymentApprovedMessage: {
    key: 'customPrepaymentApprovedMessage',
    title: 'تأیید فیش بیعانه',
    description: 'اعلام تأیید بیعانهٔ سفارش سفارشی.',
    variables: [
      { name: '{orderNumber}', desc: 'کد سفارش' },
      { name: '{prepaymentAmount}', desc: 'مبلغ بیعانه' },
    ],
    defaultText:
      '✅ <b>فیش بیعانهٔ شما تأیید شد!</b>\n\n🔖 سفارش <code>{orderNumber}</code>\n💳 بیعانه: <b>{prepaymentAmount} تومان</b>\n📌 وضعیت سفارش: <b>فیش بیعانه تأیید شده</b>\n👨‍🍳 سفارش شما آمادهٔ شروع پخت و تزیین است.',
  },
  customPrepaymentRejectedMessage: {
    key: 'customPrepaymentRejectedMessage',
    title: 'رد فیش بیعانه',
    description: 'اعلام رد فیش بیعانهٔ سفارش سفارشی.',
    variables: [
      { name: '{orderNumber}', desc: 'کد سفارش' },
      { name: '{reason}', desc: 'دلیل رد (در صورت ثبت)' },
    ],
    defaultText:
      '❌ <b>فیش بیعانهٔ شما قابل تأیید نبود.</b>\n\n🔖 سفارش <code>{orderNumber}</code>{reason}\n\nلطفاً فیش صحیح را مجدداً ارسال کنید یا با پشتیبانی تماس بگیرید.',
  },
  registrationCompleteMessage: {
    key: 'registrationCompleteMessage',
    title: 'تکمیل مشخصات تحویل',
    description: 'پس از ثبت نام، تلفن و آدرس برای سفارش سفارشی، پیش از انتخاب روش پرداخت.',
    variables: [
      { name: '{finalPrice}', desc: 'مبلغ کل' },
      { name: '{prepaymentAmount}', desc: 'مبلغ بیعانه' },
    ],
    defaultText:
      '✅ مشخصات تماس و آدرس ثبت شد.\n\n💰 <b>مبلغ کل:</b> <b>{finalPrice} تومان</b>\n💳 <b>بیعانه:</b> <b>{prepaymentAmount} تومان</b>\n\n📅 زمان تحویل پس از تأیید و پخت، با شما هماهنگ خواهد شد.\n\nلطفاً روش پرداخت را انتخاب کنید:',
  },
  cashOnDeliverySelectedMessage: {
    key: 'cashOnDeliverySelectedMessage',
    title: 'انتخاب پرداخت در محل (سفارش سفارشی)',
    description: 'وقتی مشتری برای سفارش سفارشی پرداخت هنگام تحویل را برمی‌گزیند.',
    variables: [{ name: '{finalPrice}', desc: 'مبلغ قابل پرداخت در محل' }],
    defaultText:
      '✅ <b>پرداخت در محل انتخاب شد!</b>\n\nسفارش شما تایید شد و در حال آماده‌سازی است.\n\n💰 مبلغ قابل پرداخت در محل: <b>{finalPrice} تومان</b>\n\nاز اعتماد شما متشکریم! 🙏',
  },
  noOrdersMessage: {
    key: 'noOrdersMessage',
    title: 'نداشتن سفارش',
    description: 'پیام «شما سفارشی ندارید» در بخش پیگیری.',
    variables: [],
    defaultText: '📦 شما در حال حاضر سفارشی ندارید.',
  },
  supportPromptMessage: {
    key: 'supportPromptMessage',
    title: 'شروع گفتگوی پشتیبانی',
    description: 'هنگام باز کردن بخش ارسال پیام پشتیبانی.',
    variables: [],
    defaultText: '💬 <b>ارسال پیام پشتیبانی</b>\n\nلطفاً دسته‌بندی پیام خود را انتخاب کنید:',
  },
  ticketCreatedMessage: {
    key: 'ticketCreatedMessage',
    title: 'ثبت موفق تیکت',
    description: 'پس از ثبت نهایی تیکت پشتیبانی.',
    variables: [{ name: '{ticketNumber}', desc: 'کد تیکت' }],
    defaultText:
      '✅ <b>تیکت شما با موفقیت ثبت شد!</b>\n\n🔖 کد تیکت: <code>{ticketNumber}</code>\nپشتیبانی به زودی پاسخ می‌دهد.',
  },
  genericErrorMessage: {
    key: 'genericErrorMessage',
    title: 'پیام خطای عمومی',
    description: 'برای مراحل منقضی‌شده یا خطاهای غیرمنتظره.',
    variables: [],
    defaultText: '⚠️ مشکلی پیش آمد یا این مرحله منقضی شده است. لطفاً دوباره تلاش کنید یا از منوی اصلی شروع کنید.',
  },
  adminOnlyMessage: {
    key: 'adminOnlyMessage',
    title: 'دسترسی غیرمجاز',
    description: 'وقتی کاربری غیر از ادمین دکمه مدیریتی بزند.',
    variables: [],
    defaultText: '⛔️ شما اجازه انجام این عملیات را ندارید.',
  },
};

export const BOT_MESSAGE_LIST: BotMessageDefinition[] = Object.values(BOT_MESSAGES);

export function getDefaultBotText(key: BotMessageKey): string {
  return BOT_MESSAGES[key]?.defaultText || '';
}

export type BotTextVariables = Record<string, string | number | undefined | null>;

/**
 * Resolve a message: custom override (from settings) → built-in default.
 * Placeholders are replaced after picking the text, so admins can freely add,
 * reorder or omit variables.
 */
export function renderBotText(template: string | undefined | null, vars: BotTextVariables = {}): string {
  const base = String(template ?? '');
  return base.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null || value === '') {
      // For the optional {reason} line, keep the surrounding space tidy.
      if (name === 'reason') return '';
      return '—';
    }
    return String(value);
  });
}

/**
 * Convenience helper used by the server: pass the whole settings object plus a
 * key and variables. Accepts both legacy top-level fields and the new botTexts
 * map, preferring an explicit botTexts override.
 */
export function getBotText(
  settings: { botTexts?: Record<string, string> } & Record<string, unknown>,
  key: BotMessageKey,
  vars: BotTextVariables = {},
): string {
  const overrides = settings?.botTexts || {};
  const custom = typeof overrides[key] === 'string' ? overrides[key] : '';
  // Legacy top-level overrides (welcome/help/orderSuccess/...) keep working.
  const legacy = typeof settings?.[key] === 'string' ? (settings[key] as string) : '';
  return renderBotText(custom || legacy || getDefaultBotText(key), vars);
}

/**
 * Resolve a message from a handler context: callers pass the bot settings
 * object as `ctx.botSettings`. Works for both server and handler modules.
 */
export function t(ctx: { botSettings?: unknown } | undefined | null, key: BotMessageKey, vars: BotTextVariables = {}): string {
  return getBotText((ctx?.botSettings as { botTexts?: Record<string, string> } | undefined) || {}, key, vars);
}

/** Groups used by the panel to present messages in tidy sections. */
export interface BotMessageGroup {
  key: string;
  title: string;
  icon: string;
  keys: BotMessageKey[];
}

export const BOT_MESSAGE_GROUPS: BotMessageGroup[] = [
  {
    key: 'general',
    title: 'عمومی و منو',
    icon: 'MessageSquare',
    keys: ['welcomeMessage', 'helpMessage', 'contactInfoMessage', 'emptyMenuMessage', 'noOrdersMessage', 'genericErrorMessage', 'adminOnlyMessage'],
  },
  {
    key: 'orders',
    title: 'سفارش و پرداخت',
    icon: 'ShoppingBag',
    keys: ['orderSuccessOnlineMessage', 'orderSuccessCashMessage', 'receiptAckMessage', 'receiptApprovedMessage', 'receiptRejectedMessage'],
  },
  {
    key: 'invoices',
    title: 'فاکتورها',
    icon: 'CreditCard',
    keys: ['invoiceReceiptAckMessage', 'invoicePaymentApprovedMessage', 'invoicePaymentRejectedMessage'],
  },
  {
    key: 'custom',
    title: 'سفارش سفارشی',
    icon: 'Cake',
    keys: ['customOrderSubmittedMessage', 'customOrderQuoteMessage', 'customOrderPaymentPromptMessage', 'customPrepaymentAckMessage', 'customPrepaymentApprovedMessage', 'customPrepaymentRejectedMessage', 'registrationCompleteMessage', 'cashOnDeliverySelectedMessage'],
  },
  {
    key: 'support',
    title: 'پشتیبانی',
    icon: 'Headphones',
    keys: ['supportPromptMessage', 'ticketCreatedMessage'],
  },
];
