import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleAdminCallback, handleCustomerCallback } from '../src/telegramHandlers';
import { handleCheckoutCallback, handleCheckoutState, startCheckout } from '../src/checkoutFlow';
import { generateUniqueOrderNumber, normalizeOrderNumber, resolveUniqueOrderNumber } from '../src/utils/orderNumber';
import { normalizeOrderSearchValue } from '../src/components/OrderManager';
import { getTicketImageSource } from '../src/components/SupportManager';
import { resolveTelegramImageSource } from '../src/utils/telegramImage';
import { CUSTOM_ORDER_STATUS_LABELS, formatCustomOrderTrackingMessage } from '../src/utils/customOrderTracking';
import { buildCustomOrderInvoice, buildOrderInvoice, calculateInvoiceAmounts, getCustomPrepaymentStatus, resolveManualInvoiceStatus } from '../src/utils/invoices';
import { compactSearchValue, matchesSearchValues, normalizeSearchValue } from '../src/utils/search';
import {
  formatIranianDeliveryDate,
  getIranianPersianDate,
  normalizeIranianDeliveryDate,
  normalizeIranianDeliveryTime,
} from '../src/utils/iranianDate';
import { DEFAULT_PANEL_PASSWORD, DEFAULT_PANEL_USERNAME, getPanelCredentials, omitPanelPassword } from '../src/utils/panelAuth';
import { dedupeCustomers, findBotCustomer, isRealName, upsertBotCustomer } from '../src/utils/customers';

const sentMessages: string[] = [];
(globalThis as any).fetch = async (_url: string, init?: { body?: string }) => {
  sentMessages.push(init?.body || '');
  return { ok: true, json: async () => ({ ok: true }) };
};

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    token: 'test-token',
    chatId: '731245',
    products: [],
    orders: [],
    discounts: [],
    customers: [],
    supportTickets: [],
    customOrders: [],
    botSettings: {},
    userCarts: new Map(),
    userStates: new Map(),
    ...overrides,
  } as any;
}

function testTelegramImageResolver() {
  const telegramFileId = 'AgAC+/=_test-reply-photo';
  const expectedProxy = '/api/telegram/file/AgAC%2B%2F%3D_test-reply-photo';

  assert.equal(resolveTelegramImageSource(telegramFileId), expectedProxy);
  assert.equal(getTicketImageSource(telegramFileId), expectedProxy);
  assert.equal(resolveTelegramImageSource(' https://example.test/legacy-photo.jpg '), 'https://example.test/legacy-photo.jpg');
  assert.equal(resolveTelegramImageSource('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  assert.equal(resolveTelegramImageSource('blob:https://panel.example/receipt'), 'blob:https://panel.example/receipt');
  assert.equal(resolveTelegramImageSource('/uploads/receipt.png'), '/uploads/receipt.png');
  assert.equal(resolveTelegramImageSource('./uploads/receipt.png'), './uploads/receipt.png');
  assert.equal(resolveTelegramImageSource('uploads/legacy-receipt.webp?version=4'), 'uploads/legacy-receipt.webp?version=4');
  assert.equal(resolveTelegramImageSource('   '), null);
  assert.equal(resolveTelegramImageSource(), null);
}

async function testTicketUsesTelegramAccountAndKnownPhone() {
  const userStates = new Map<string, any>();
  const customers = [{
    id: 'usr-1',
    telegramId: '731245',
    name: 'نام ثبت‌شده سفارش',
    phone: '09121234567',
    username: 'previous_username',
    address: 'تهران',
    walletBalance: 0,
    rewardPoints: 0,
    totalOrdersCount: 1,
    totalSpentTomans: 0,
    tier: 'bronze',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }];
  const ctx = makeContext({
    customers,
    userStates,
    telegramUser: {
      id: 731245,
      first_name: 'نگار',
      last_name: 'رضایی',
      username: 'negar_live',
    },
  });
  userStates.set(ctx.chatId, {
    mode: 'support_finalize',
    category: 'general',
    subject: 'پیگیری سفارش',
    message: 'لطفاً وضعیت سفارش را بفرمایید.',
    photo: 'AgACAgQAAxkBAAIB-test-initial-photo',
  });

  assert.equal(await handleCustomerCallback(ctx, 'support_finalize'), true);
  assert.equal(ctx.supportTickets.length, 1);

  const ticket = ctx.supportTickets[0];
  assert.equal(ticket.customerName, 'نگار رضایی');
  assert.equal(ticket.customerUsername, 'negar_live');
  assert.equal(ticket.customerTelegramId, ctx.chatId);
  assert.equal(ticket.customerPhone, '09121234567');
  assert.equal(ticket.cakePhoto, 'AgACAgQAAxkBAAIB-test-initial-photo');
  assert.equal(ticket.replies[0].senderName, 'نگار رضایی');
  assert.equal(customers[0].username, 'negar_live');
  assert.equal(userStates.has(ctx.chatId), false);
}

async function testTicketDoesNotInventPhoneAndPhotoReplyKeepsFileIdContract() {
  const userStates = new Map<string, any>();
  const ctx = makeContext({
    chatId: '910001',
    userStates,
    telegramUser: { id: 910001, first_name: 'سارا', username: 'sara_test' },
  });
  userStates.set(ctx.chatId, {
    mode: 'support_finalize',
    category: 'feedback',
    subject: 'نظر',
    message: 'سپاسگزارم',
  });

  assert.equal(await handleCustomerCallback(ctx, 'support_finalize'), true);
  const ticket = ctx.supportTickets[0];
  assert.equal(ticket.customerName, 'سارا');
  assert.equal(ticket.customerUsername, 'sara_test');
  assert.equal(ticket.customerPhone, '');

  // The live-update portion is deliberately kept at the server boundary (it
  // receives Telegram's msg.photo). Verify its persisted reply contract and
  // its UI consumer so a file_id cannot regress to an unrendered Markdown URL.
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const supportManagerSource = fs.readFileSync(new URL('../src/components/SupportManager.tsx', import.meta.url), 'utf8');
  const resolverSource = fs.readFileSync(new URL('../src/utils/telegramImage.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /telegramUser:\s*cb\.from/);
  assert.match(serverSource, /replyPhotoState[\s\S]{0,1200}photo:\s*photoFileId/);
  assert.doesNotMatch(serverSource, /savedPhotoUrl/);
  assert.match(supportManagerSource, /reply\.photo \|\| getLegacyReplyImage\(reply\.text\)/);
  assert.match(resolverSource, /api\/telegram\/file\/\$\{encodeURIComponent\(normalizedReference\)\}/);
}

function testProductImagesStayReachableForTelegram() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const persistenceSource = fs.readFileSync(new URL('../src/persistData.ts', import.meta.url), 'utf8');

  // A Telegram Bot API photo URL is fetched outside the browser and therefore
  // cannot send the authenticated panel cookie. New catalog photos have a
  // narrow public route, while arbitrary /data files remain protected.
  assert.match(serverSource, /app\.get\('\/product-images\/:filename', servePublicProductImage\('product-images', false\)\)/);
  assert.match(serverSource, /app\.get\('\/data\/:filename', servePublicProductImage\('data', true\)\)/);
  assert.match(serverSource, /isReferencedProductImage/);
  assert.match(serverSource, /\/product-images\/\$\{encodeURIComponent\(filename\)\}/);
  assert.match(serverSource, /app\.use\('\/data', requirePanelAuth\)/);
  assert.match(serverSource, /PRODUCT_IMAGE_DIR/);
  assert.match(persistenceSource, /export const DATA_DIR/);
}

function testCustomOrdersAppearInCustomerTrackingWithDetails() {
  const customOrder = {
    id: 'custom-tracking-1',
    orderNumber: 'CO-123456',
    customerName: 'نگار رضایی',
    customerPhone: '09121234567',
    customerTelegramId: '731245',
    pastryType: 'کیک تولد و مناسبتی',
    shapeAndDesign: 'کیک دو طبقه با طرح <خامه‌ای>',
    spongeFlavor: 'شکلاتی، بدون گلوتن',
    fillingFlavor: 'موز و گردو',
    weightKg: 2.5,
    servingCount: 18,
    tierCount: 2,
    dietaryType: 'بدون گلوتن',
    writingOnCake: 'تولدت مبارک',
    deliveryType: 'delivery',
    deliveryAddress: 'تهران، خیابان نمونه، پلاک ۱۰',
    deliveryDate: '1405/06/15',
    deliveryTimeSlot: '17:30 تا 20:00',
    finalPrice: 1250000,
    prepaymentAmount: 500000,
    isPrepaymentPaid: false,
    status: 'price_quoted',
    adminNotes: 'This private workshop note must not be sent to the customer.',
    chatMessages: [],
    createdAt: '2026-08-27T12:00:00.000Z',
    updatedAt: '2026-08-27T12:00:00.000Z',
  } as any;
  const message = formatCustomOrderTrackingMessage(customOrder);

  assert.equal(CUSTOM_ORDER_STATUS_LABELS.price_quoted, '💬 قیمت اعلام شده؛ در انتظار تأیید شما');
  assert.match(message, /CO-123456/);
  assert.match(message, /کیک تولد و مناسبتی/);
  assert.match(message, /طرح &lt;خامه‌ای&gt;/);
  // Sponge/filling flavor fields were removed from custom orders entirely;
  // legacy records may still carry them but they must never be displayed.
  assert.doesNotMatch(message, /موز و گردو/);
  assert.doesNotMatch(message, /فیلینگ/);
  assert.match(message, /۲.۵ کیلوگرم/);
  // موعد تحویل is no longer collected in the bot; the tracking message now
  // states timing is coordinated after confirmation.
  assert.match(message, /زمان تحویل/);
  assert.doesNotMatch(message, /تاریخ درخواستی/);
  assert.doesNotMatch(message, /زمان درخواستی/);
  assert.match(message, /مبلغ نهایی/);
  assert.match(message, /در انتظار پرداخت/);
  assert.doesNotMatch(message, /This private workshop note/);

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /const userCustomOrders = customOrders\.filter\(\(order\) => String\(order\.customerTelegramId\) === chatId\)/);
  assert.match(serverSource, /totalTrackedOrders = userOrders\.length \+ userCustomOrders\.length/);
  assert.match(serverSource, /formatCustomOrderTrackingMessage\(customOrder\)/);
}

function testCustomPrepaymentReviewAndInvoiceAggregation() {
  const awaitingReviewOrder = {
    id: 'custom-review-1',
    orderNumber: 'CP-REVIEW-1',
    customerName: 'مینا',
    customerPhone: '09120000000',
    customerTelegramId: '700001',
    pastryType: 'کیک تولد و مناسبتی',
    shapeAndDesign: 'طرح ساده',
    deliveryType: 'pickup',
    finalPrice: 500000,
    prepaymentAmount: 200000,
    paymentMethod: 'card_to_card',
    paymentReceiptImage: 'AgACAg-test-receipt',
    prepaymentStatus: 'pending_confirmation',
    isPrepaymentPaid: false,
    status: 'price_quoted',
    chatMessages: [],
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-08-28T09:00:00.000Z',
  } as any;

  assert.equal(getCustomPrepaymentStatus(awaitingReviewOrder), 'pending_confirmation');
  const pendingInvoice = buildCustomOrderInvoice(awaitingReviewOrder);
  assert.equal(pendingInvoice.status, 'payment_review');
  assert.equal(pendingInvoice.paidAmount, 0);
  assert.equal(pendingInvoice.remainingAmount, 500000);
  assert.equal(pendingInvoice.payments[0].status, 'submitted');
  assert.match(formatCustomOrderTrackingMessage(awaitingReviewOrder), /فیش بیعانه در انتظار تأیید ادمین/);
  assert.match(formatCustomOrderTrackingMessage(awaitingReviewOrder), /هماهنگ خواهد شد/);

  const approvedInvoice = buildCustomOrderInvoice({
    ...awaitingReviewOrder,
    isPrepaymentPaid: true,
    prepaymentStatus: 'approved',
    status: 'approved_by_customer',
  });
  assert.equal(approvedInvoice.status, 'partially_paid');
  assert.equal(approvedInvoice.paidAmount, 200000);
  assert.equal(approvedInvoice.remainingAmount, 300000);
  assert.equal(approvedInvoice.payments[0].status, 'confirmed');

  const manualAmounts = calculateInvoiceAmounts({
    items: [{ totalAmount: 190000 }],
    shippingFee: 20000,
    discountAmount: 0,
    taxAmount: 21000,
    payments: [{ amount: 100000, status: 'confirmed' }],
  } as any);
  assert.deepEqual(manualAmounts, {
    subtotal: 190000,
    shippingFee: 20000,
    discountAmount: 0,
    taxAmount: 21000,
    totalAmount: 231000,
    paidAmount: 100000,
    remainingAmount: 131000,
  });

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const telegramHandlersSource = fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.match(serverSource, /prepayment-decision/);
  assert.match(serverSource, /custom_order_skip_delivery_date_/);
  assert.match(serverSource, /custom_order_skip_delivery_time_/);
  assert.match(serverSource, /custom_order_reupload_receipt_/);
  assert.match(serverSource, /prepaymentStatus = 'pending_confirmation'/);
  assert.match(serverSource, /buildAllInvoices\(orders, customOrders, invoices\)/);
  assert.match(telegramHandlersSource, /canStartCustomProduction/);
  assert.match(telegramHandlersSource, /prepaymentStatus = 'awaiting_receipt'/);
  assert.match(appSource, /<InvoiceManager/);
  assert.match(sidebarSource, /فاکتورها و پرداخت‌ها/);
  assert.match(sidebarSource, /مدیران ربات/);
}

function testProductsAndOrdersUseNarrowViewportSafeLayouts() {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const productManagerSource = fs.readFileSync(new URL('../src/components/ProductManager.tsx', import.meta.url), 'utf8');
  const orderManagerSource = fs.readFileSync(new URL('../src/components/OrderManager.tsx', import.meta.url), 'utf8');
  const addProductModalSource = fs.readFileSync(new URL('../src/components/AddProductModal.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  const mobileHeaderSource = fs.readFileSync(new URL('../src/components/MobileHeader.tsx', import.meta.url), 'utf8');

  assert.ok(appSource.includes('window.innerWidth < 1024'));
  assert.ok(appSource.includes('min-w-0 flex flex-col'));
  assert.ok(appSource.includes('pt-14 lg:pt-0'));
  assert.ok(sidebarSource.includes('hidden lg:flex'));
  assert.ok(mobileHeaderSource.includes('lg:hidden'));
  assert.ok(productManagerSource.includes('grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]'));
  assert.ok(productManagerSource.includes('xl:flex-row'));
  assert.ok(addProductModalSource.includes('max-h-[90dvh]'));
  assert.ok(addProductModalSource.includes('flex flex-wrap items-center justify-end'));
  assert.ok(orderManagerSource.includes('grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]'));
  assert.ok(orderManagerSource.includes('basis-full sm:basis-auto'));
  assert.ok(orderManagerSource.includes('xl:grid-cols-3'));
}

function testCustomerImagePanelsUseSharedZoomViewer() {
  const supportManagerSource = fs.readFileSync(new URL('../src/components/SupportManager.tsx', import.meta.url), 'utf8');
  const initialBubbleIndex = supportManagerSource.indexOf('Initial customer message');
  const initialPhotoIndex = supportManagerSource.indexOf('selectedTicket.cakePhoto');
  assert.ok(initialBubbleIndex >= 0, 'The initial customer message bubble should exist.');
  assert.ok(initialPhotoIndex > initialBubbleIndex, 'The first ticket image must stay inside the initial customer message bubble.');
  assert.match(supportManagerSource, /<TicketImageAttachment/);
  assert.match(supportManagerSource, /<ZoomableImageModal/);
  assert.doesNotMatch(supportManagerSource, /تصویر طرح کیک/);

  for (const componentPath of [
    '../src/components/SupportManager.tsx',
    '../src/components/OrderManager.tsx',
    '../src/components/CustomPastryManager.tsx',
    '../src/components/TelegramSimulator.tsx',
  ]) {
    const componentSource = fs.readFileSync(new URL(componentPath, import.meta.url), 'utf8');
    assert.match(componentSource, /resolveTelegramImageSource/, `${componentPath} should resolve Telegram file IDs through the current host.`);
    assert.match(componentSource, /<ZoomableImageModal/, `${componentPath} should expose the shared zoom viewer.`);
  }

  const zoomViewerSource = fs.readFileSync(new URL('../src/components/ZoomableImageModal.tsx', import.meta.url), 'utf8');
  assert.match(zoomViewerSource, /ZoomIn/);
  assert.match(zoomViewerSource, /ZoomOut/);
  assert.match(zoomViewerSource, /onWheel=\{handleWheel\}/);
  assert.match(zoomViewerSource, /activePointers/);
  assert.match(zoomViewerSource, /distanceBetween/);
  assert.match(zoomViewerSource, /touchAction: 'none'/);

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  // Custom design inquiries now accept up to 10 reference photos.
  assert.match(serverSource, /referenceImages: Array\.isArray\(state\.photos\)/);
  assert.match(serverSource, /custom_product_photos_more/);
}

async function testCheckoutPersistsTelegramProfileOnOrder() {
  const userStates = new Map<string, any>();
  const userCarts = new Map<string, any[]>();
  const orders: any[] = [];
  const customers: any[] = [];
  const ctx = makeContext({
    chatId: '994411',
    orders,
    customers,
    userStates,
    userCarts,
    products: [{ id: 'p1', name: 'کیک', productCode: 'P-1', price: 250000, unit: 'عدد' }],
    botSettings: { shippingFee: 0, freeShippingThreshold: 0 },
    msg: { from: { id: 994411, first_name: 'لیلا', last_name: 'مرادی', username: 'leila_cake' } },
  });
  userCarts.set(ctx.chatId, [{ productId: 'p1', quantity: 1 }]);

  // Flow (new order): name is the FIRST step -> phone -> delivery method
  // (inline) -> address (courier) -> payment.
  await startCheckout(ctx);
  assert.equal(await handleCheckoutState(ctx, 'لیلا مرادی'), true);
  assert.equal(await handleCheckoutState(ctx, '09120000000'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'delivery_delivery'), true);
  assert.equal(await handleCheckoutState(ctx, 'تهران، نمونه آدرس'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'payment_cash_on_delivery'), true);

  assert.equal(orders.length, 1);
  assert.equal(orders[0].customerTelegramId, '994411');
  assert.equal(orders[0].customerUsername, 'leila_cake');
  assert.equal(orders[0].customerTelegramName, 'لیلا مرادی');
  assert.equal(orders[0].customerName, 'لیلا مرادی');
  assert.equal(orders[0].customerPhone, '09120000000');
  assert.equal(orders[0].customerAddress, 'تهران، نمونه آدرس');
  assert.equal(customers[0].username, 'leila_cake');
}

function testTolerantPanelSearch() {
  assert.equal(compactSearchValue('  @Sara_‌Cake  '), 'saracake');
  assert.equal(normalizeSearchValue('علي ياسر'), 'علی یاسر');
  assert.equal(compactSearchValue('SH-۲۶۰۸۲۷ / ٤٨٣٩٢١'), 'sh260827483921');
  assert.equal(matchesSearchValues('@sara_cake', ['Sara_Cake']), true);
  assert.equal(matchesSearchValues('۱۲۳٤٥٦', ['123456']), true);
  assert.equal(matchesSearchValues('sh260827483921', ['SH-260827-483921']), true);
  assert.equal(matchesSearchValues('کیک يزدی', ['کیک یزدی']), true);
  assert.equal(matchesSearchValues('کد محصول', ['کیک هویج', 'PRD-123']), false);

  const orderManagerSource = fs.readFileSync(new URL('../src/components/OrderManager.tsx', import.meta.url), 'utf8');
  const customerManagerSource = fs.readFileSync(new URL('../src/components/CustomerManager.tsx', import.meta.url), 'utf8');
  const customManagerSource = fs.readFileSync(new URL('../src/components/CustomPastryManager.tsx', import.meta.url), 'utf8');
  const productManagerSource = fs.readFileSync(new URL('../src/components/ProductManager.tsx', import.meta.url), 'utf8');
  assert.match(orderManagerSource, /customerTelegramName/);
  assert.match(orderManagerSource, /item\.productCode/);
  assert.match(customerManagerSource, /customerCustomOrders/);
  assert.match(customManagerSource, /customerUsername/);
  assert.match(productManagerSource, /product\.productCode/);
}

function testIranianDeliveryInput() {
  // 28 August 2026 is 1405/06/06 in Tehran's Solar Hijri calendar.
  assert.equal(getIranianPersianDate(new Date('2026-08-28T12:00:00Z')), '1405/06/06');
  assert.deepEqual(normalizeIranianDeliveryDate('۱۴۰۵/۰۶/۱۵', '1405/06/06'), { value: '1405/06/15' });
  assert.deepEqual(normalizeIranianDeliveryDate('1405-6-15', '1405/06/06'), { value: '1405/06/15' });
  assert.match(normalizeIranianDeliveryDate('1405/06/05', '1405/06/06').error || '', /نمی‌تواند پیش از امروز/);
  assert.deepEqual(normalizeIranianDeliveryDate('۱۳۹۹/۱۲/۳۰', '1399/01/01'), { value: '1399/12/30' });
  assert.match(normalizeIranianDeliveryDate('۱۴۰۰/۱۲/۳۰', '1400/01/01').error || '', /معتبر نیست/);
  assert.deepEqual(normalizeIranianDeliveryTime('۱۷:۳۰ الی ۲۰'), { value: '17:30 تا 20:00' });
  assert.match(normalizeIranianDeliveryTime('20 تا 17').error || '', /پایان بازه/);
  assert.equal(formatIranianDeliveryDate('1405/06/15'), '۱۴۰۵/۰۶/۱۵');

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  // موعد تحویل (date/time registration steps) has been removed from the bot.
  assert.doesNotMatch(serverSource, /custom_order_register_delivery_date/);
  assert.doesNotMatch(serverSource, /custom_order_register_delivery_time/);
  assert.match(serverSource, /customerTelegramName/);
  assert.doesNotMatch(serverSource, /deliveryDate:\s*new Date\(/);
  assert.match(serverSource, /موعد تحویل/);
}

function testServerPanelAuthenticationContract() {
  assert.deepEqual(getPanelCredentials({}), {
    username: DEFAULT_PANEL_USERNAME,
    password: DEFAULT_PANEL_PASSWORD,
  });
  assert.deepEqual(getPanelCredentials({ webAdminUsername: '  manager ', webAdminPassword: 'a-safe-password' }), {
    username: 'manager',
    password: 'a-safe-password',
  });
  assert.deepEqual(omitPanelPassword({
    storeName: 'قنادی',
    webAdminPassword: 'secret',
    webAdminPasswordHash: 'scrypt$private',
    telegramBotToken: 'private-bot-token',
    webAdminUsername: 'admin',
  }), {
    storeName: 'قنادی',
    webAdminUsername: 'admin',
  });

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const loginSource = fs.readFileSync(new URL('../src/components/LoginPage.tsx', import.meta.url), 'utf8');
  assert.match(serverSource, /app\.post\('\/api\/auth\/login'/);
  assert.match(serverSource, /app\.use\('\/api', requirePanelAuth\)/);
  assert.match(serverSource, /httpOnly:\s*true/);
  assert.match(serverSource, /scryptSync/);
  assert.match(serverSource, /if \(!botSettings\.webAdminPasswordHash\)/);
  assert.match(serverSource, /delete updates\.webAdminPasswordHash/);
  assert.match(serverSource, /getPublicPanelSettings\(\)/);
  assert.match(serverSource, /hasTelegramBotToken/);
  assert.match(serverSource, /data\.startsWith\('admin_'\) && !isTelegramAdmin\(callbackActorId\)/);
  assert.match(serverSource, /String\(cb\.from\?\.id \?\? chatId\)/);
  assert.match(serverSource, /hasCompleteCustomOrderDelivery/);
  assert.match(serverSource, /app\.post\('\/api\/custom-orders\/:id\/chat'[\s\S]{0,1800}saveAllData\(\)/);
  assert.match(serverSource, /app\.delete\('\/api\/custom-orders\/:id'[\s\S]{0,700}saveAllData\(\)/);
  assert.doesNotMatch(appSource, /localStorage/);
  assert.match(appSource, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(appSource, /delete safeDraft\.telegramBotToken/);
  assert.match(loginSource, /onLogin\(username, password\)/);

  const initialDataSource = fs.readFileSync(new URL('../src/data/initialData.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(initialDataSource, /webAdminPassword\s*:/);

  const settingsSource = fs.readFileSync(new URL('../src/components/BotSettings.tsx', import.meta.url), 'utf8');
  assert.match(settingsSource, /id="telegram-bot-token"/);
  assert.match(settingsSource, /type="password"/);
  assert.match(settingsSource, /hasTelegramBotToken/);
}

async function testReceiptConfirmationWorkflowAndFastReceiptViewer() {
  const order = {
    id: 'receipt-stage-1',
    orderNumber: 'SH-260828-100001',
    customerName: 'مهسا',
    customerPhone: '09120000000',
    customerAddress: 'تهران',
    customerTelegramId: '701100',
    items: [],
    subtotal: 450000,
    shippingFee: 0,
    discountAmount: 0,
    totalAmount: 450000,
    paymentMethod: 'card_to_card',
    deliveryMethod: 'delivery',
    paymentReceiptImage: 'AgACAg-test-verified-receipt',
    status: 'paid_checking',
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-08-28T09:00:00.000Z',
  } as any;
  const ctx = makeContext({ orders: [order] });

  // A receipt attached to an order-derived invoice remains an actual payment
  // image in the finance feed before the admin makes a decision.
  const pendingOrderInvoice = buildOrderInvoice(order);
  assert.equal(pendingOrderInvoice.status, 'payment_review');
  assert.equal(pendingOrderInvoice.payments[0].status, 'submitted');
  assert.equal(pendingOrderInvoice.payments[0].receiptImage, order.paymentReceiptImage);

  // The Telegram admin approval must stop at the explicit receipt stage. A
  // second, intentional admin command is the only way to start production.
  assert.equal(await handleAdminCallback(ctx, `admin_rapprove_${order.id}`), true);
  assert.equal(order.status, 'receipt_confirmed');
  assert.equal(order.receiptReviewStatus, 'confirmed');
  assert.equal(await handleAdminCallback(ctx, `admin_status_${order.id}_baking`), true);
  assert.equal(order.status, 'baking');

  const confirmedInvoice = buildOrderInvoice({ ...order, status: 'receipt_confirmed' });
  assert.equal(confirmedInvoice.payments[0].status, 'confirmed');
  assert.equal(confirmedInvoice.paidAmount, 450000);
  assert.equal(confirmedInvoice.status, 'paid');

  // Rejection keeps the receipt image visible for audit, but blocks stale
  // approval buttons until the customer submits a replacement image.
  const rejectedOrder = {
    ...order,
    id: 'receipt-stage-rejected',
    orderNumber: 'SH-260828-100002',
    status: 'paid_checking',
    receiptReviewStatus: 'submitted',
  };
  const rejectedCtx = makeContext({ orders: [rejectedOrder] });
  assert.equal(await handleAdminCallback(rejectedCtx, `admin_rreject_${rejectedOrder.id}`), true);
  assert.equal(rejectedOrder.status, 'pending_payment');
  assert.equal(rejectedOrder.receiptReviewStatus, 'rejected');
  assert.deepEqual(rejectedCtx.userStates.get(rejectedOrder.customerTelegramId), {
    mode: 'waiting_for_receipt', orderId: rejectedOrder.id,
  });
  assert.equal(await handleAdminCallback(rejectedCtx, `admin_rapprove_${rejectedOrder.id}`), true);
  assert.equal(rejectedOrder.status, 'pending_payment');
  const rejectedInvoice = buildOrderInvoice(rejectedOrder);
  assert.equal(rejectedInvoice.payments[0].status, 'rejected');
  assert.equal(rejectedInvoice.status, 'pending_payment');

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const orderManagerSource = fs.readFileSync(new URL('../src/components/OrderManager.tsx', import.meta.url), 'utf8');
  const invoiceManagerSource = fs.readFileSync(new URL('../src/components/InvoiceManager.tsx', import.meta.url), 'utf8');
  const zoomViewerSource = fs.readFileSync(new URL('../src/components/ZoomableImageModal.tsx', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  const telegramHandlerSource = fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8');
  const customManagerSource = fs.readFileSync(new URL('../src/components/CustomPastryManager.tsx', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(typesSource, /\| 'receipt_confirmed'/);
  assert.match(serverSource, /const newStatus: OrderStatus = approved \? 'receipt_confirmed' : 'pending_payment';/);
  assert.match(serverSource, /receiptReviewStatus = approved \? 'confirmed' : 'rejected';/);
  assert.match(serverSource, /receiptReviewStatus = 'submitted';/);
  assert.match(serverSource, /mode: 'waiting_for_receipt', orderId: order.id/);
  assert.match(serverSource, /TELEGRAM_FILE_CACHE_DIR/);
  assert.match(serverSource, /readCachedTelegramFile\(fileId\)/);
  assert.match(serverSource, /cacheTelegramFile\(fileId, buffer, contentType\)/);
  assert.match(serverSource, /function getTelegramImageFileId/);
  assert.match(serverSource, /message\?\.document/);
  assert.match(serverSource, /incomingImageFileId/);
  assert.match(orderManagerSource, /approved \? 'receipt_confirmed' : 'pending_payment'/);
  assert.match(orderManagerSource, /شروع پخت و تزیین/);
  assert.match(telegramHandlerSource, /order\.status = 'receipt_confirmed'/);
  assert.match(telegramHandlerSource, /receiptReviewStatus = 'confirmed'/);
  assert.match(telegramHandlerSource, /receiptReviewStatus = 'rejected'/);
  assert.match(telegramHandlerSource, /nextStatus === 'baking' && !canStartProduction/);
  assert.match(serverSource, /order\.prepaymentStatus = 'approved';[\s\S]{0,280}order\.status = 'receipt_confirmed';/);
  assert.match(customManagerSource, /case 'receipt_confirmed'/);
  assert.match(customManagerSource, /onUpdateStatus\(order\.id, 'baking'\)/);
  assert.equal(CUSTOM_ORDER_STATUS_LABELS.receipt_confirmed, '✅ فیش بیعانه تأیید شد؛ در انتظار شروع پخت');

  // The finance list now finds the newest receipt anywhere in its payment
  // history, provides a visible thumbnail, and passes the real prop contract
  // into the common full-screen viewer.
  assert.match(invoiceManagerSource, /\[\.\.\.invoice\.payments\]\.reverse\(\)\.find/);
  assert.match(invoiceManagerSource, /پیش‌نمایش فیش پرداخت مشتری/);
  assert.match(invoiceManagerSource, /<ZoomableImageModal imageSrc=\{previewImage\}/);
  assert.doesNotMatch(invoiceManagerSource, /<ZoomableImageModal imageSource=/);
  assert.match(invoiceManagerSource, /payment\.status === 'submitted' && Boolean\(payment\.receiptImage\)/);
  assert.doesNotMatch(invoiceManagerSource, /selectedInvoice\.source === 'manual' && payment\.status === 'submitted'/);
  assert.match(invoiceManagerSource, /invoices\.find\(\(invoice\) => invoice\.id === current\.id\)/);
  assert.match(appSource, /invoice\.source === 'regular_order'/);
  assert.match(appSource, /api\/orders\/\$\{encodeURIComponent\(invoice\.sourceId\)\}\/receipt-decision/);
  assert.match(appSource, /invoice\.source === 'custom_order'/);

  // No fixed transition is left on each pointer movement. Pans are GPU-backed,
  // coalesced and animation-frame batched with a more responsive multiplier.
  assert.match(zoomViewerSource, /const PAN_SENSITIVITY = 1\.55/);
  assert.match(zoomViewerSource, /requestAnimationFrame/);
  assert.match(zoomViewerSource, /getCoalescedEvents/);
  assert.match(zoomViewerSource, /translate3d/);
  assert.match(zoomViewerSource, /transform-gpu/);
  assert.doesNotMatch(zoomViewerSource, /transition-transform duration-150/);
}

function testManualInvoiceReceiptReviewLifecycle() {
  const baseInvoice = {
    source: 'manual',
    status: 'pending_payment',
    items: [{ totalAmount: 300000 }],
    shippingFee: 0,
    discountAmount: 0,
    taxAmount: 0,
    payments: [{
      id: 'payment-customer-receipt',
      amount: 300000,
      method: 'card_to_card',
      status: 'submitted',
      receiptImage: 'AgACAg-test-invoice-receipt',
      createdAt: '2026-08-28T10:00:00.000Z',
    }],
  } as any;

  const awaitingReview = calculateInvoiceAmounts(baseInvoice);
  assert.equal(awaitingReview.paidAmount, 0);
  assert.equal(awaitingReview.remainingAmount, 300000);
  assert.equal(resolveManualInvoiceStatus(baseInvoice.status, { ...awaitingReview, payments: baseInvoice.payments }), 'payment_review');

  const approvedPayments = [{ ...baseInvoice.payments[0], status: 'confirmed' }];
  const approvedAmounts = calculateInvoiceAmounts({ ...baseInvoice, payments: approvedPayments });
  assert.equal(approvedAmounts.paidAmount, 300000);
  assert.equal(approvedAmounts.remainingAmount, 0);
  assert.equal(resolveManualInvoiceStatus('payment_review', { ...approvedAmounts, payments: approvedPayments }), 'paid');

  const rejectedPayments = [{ ...baseInvoice.payments[0], status: 'rejected' }];
  const rejectedAmounts = calculateInvoiceAmounts({ ...baseInvoice, payments: rejectedPayments });
  assert.equal(rejectedAmounts.paidAmount, 0);
  assert.equal(resolveManualInvoiceStatus('payment_review', { ...rejectedAmounts, payments: rejectedPayments }), 'pending_payment');
}

function testDashboardAndTelegramInvoiceReceiptContract() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  const dashboardSource = fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  const invoiceManagerSource = fs.readFileSync(new URL('../src/components/InvoiceManager.tsx', import.meta.url), 'utf8');
  const persistStatesSource = fs.readFileSync(new URL('../src/persistStates.ts', import.meta.url), 'utf8');

  assert.match(appSource, /import \{ Dashboard \} from '.\/components\/Dashboard'/);
  assert.match(appSource, /activeTab.*'dashboard'/);
  assert.ok(sidebarSource.indexOf("id: 'dashboard'") < sidebarSource.indexOf("id: 'customers'"));
  assert.ok(appSource.indexOf("{ id: 'dashboard'") < appSource.indexOf("{ id: 'customers'"));
  assert.match(appSource, /<Dashboard[\s\S]{0,800}invoices=\{invoices\}[\s\S]{0,800}onNavigate=/);
  assert.match(dashboardSource, /رسیدهای در انتظار تأیید/);
  assert.match(dashboardSource, /دریافت‌های ۷ روز اخیر/);
  assert.match(dashboardSource, /صف رسیدگی امروز/);
  assert.match(dashboardSource, /فاکتورهای اخیر/);
  // The dashboard is deliberately single-column on narrow phones. This keeps
  // long Persian labels and monetary values from colliding at mobile widths.
  assert.match(dashboardSource, /grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(dashboardSource, /overflow-x-hidden/);

  // Customer invoices expose payment + main-menu choices. The follow-up
  // callback/photo flow validates the actual Telegram identity again, stores a
  // submitted receipt, and leaves the decision to authenticated panel review.
  assert.match(serverSource, /buildCustomerInvoiceKeyboard/);
  assert.match(serverSource, /💳 پرداخت فاکتور/);
  assert.match(serverSource, /🏠 بازگشت به منوی اصلی/);
  assert.match(serverSource, /data\.startsWith\('invoice_payment_'\)/);
  assert.match(serverSource, /mode: 'invoice_payment_receipt'/);
  assert.match(serverSource, /شماره کارت:/);
  assert.match(serverSource, /botSettings\.cardNumber/);
  assert.match(serverSource, /receiptImage: photoFileId/);
  assert.match(serverSource, /status: 'submitted'/);
  assert.match(serverSource, /app\.post\('\/api\/invoices\/:id\/payments\/:paymentId\/review'/);
  assert.match(serverSource, /payment\.status = approved \? 'confirmed' : 'rejected'/);
  assert.match(serverSource, /notifyCustomerAboutManualInvoicePaymentReview/);
  assert.match(invoiceManagerSource, /تأیید فیش/);
  assert.match(invoiceManagerSource, /رد فیش و اطلاع‌رسانی/);
  assert.match(invoiceManagerSource, /onReviewPayment/);
  // Multi-step Telegram receipt state is placed on Railway's volume, not the
  // ephemeral app directory used during deploys.
  assert.match(persistStatesSource, /path\.join\(DATA_DIR, filePath\)/);
}

function testInvoiceCustomerTelegramDeliveryContract() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  const invoiceManagerSource = fs.readFileSync(new URL('../src/components/InvoiceManager.tsx', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

  // The user directory is restored in both navigations, before finance and
  // catalog paths, and keeps its original data/ledger props.
  assert.match(appSource, /import \{ CustomerManager \} from '.\/components\/CustomerManager'/);
  assert.match(appSource, /<CustomerManager[\s\S]{0,500}walletTransactions=\{walletTransactions\}[\s\S]{0,500}onAdjustWallet=\{handleAdjustWallet\}/);
  assert.ok(sidebarSource.indexOf("id: 'customers'") < sidebarSource.indexOf("id: 'invoices'"));
  assert.ok(appSource.indexOf("{ id: 'customers'") < appSource.indexOf("{ id: 'invoices'"));

  // A manual invoice send is protected by the existing /api session boundary,
  // uses the canonical bot-linked customer chat, and is persisted only after
  // Telegram reports success so the audit data survives Railway restarts.
  assert.match(serverSource, /app\.post\('\/api\/invoices\/:id\/send-to-customer'/);
  assert.match(serverSource, /sendManualInvoiceToCustomer/);
  assert.match(serverSource, /const linkedCustomer = getBotLinkedCustomerForInvoice\(invoice\)/);
  assert.match(serverSource, /if \(!linkedCustomer\)/);
  assert.match(serverSource, /const customerChatId = linkedCustomer\.telegramId/);
  assert.match(serverSource, /chat_id:\s*customerChatId/);
  assert.match(serverSource, /parse_mode:\s*'HTML'/);
  assert.match(serverSource, /customerNotificationSentAt = now/);
  assert.match(serverSource, /const previousNotificationCount = Number\(invoice\.customerNotificationCount\)/);
  assert.match(serverSource, /Math\.floor\(previousNotificationCount\) \+ 1/);
  assert.match(serverSource, /escapeTelegramHtml/);
  assert.match(typesSource, /customerNotificationSentAt\?: string/);
  assert.match(typesSource, /customerNotificationCount\?: number/);

  // The form intentionally offers only customers with bot-linked Telegram IDs,
  // provides an opt-in automatic send, and leaves a resend route in invoice
  // details when Telegram is temporarily unavailable at issuance time.
  assert.match(invoiceManagerSource, /const telegramCustomers = useMemo/);
  assert.match(invoiceManagerSource, /customers\.filter\(\(customer\) => isBotLinkedTelegramId\(customer\.telegramId\)\)/);
  assert.match(invoiceManagerSource, /ارسال خودکار فاکتور در تلگرام/);
  assert.match(invoiceManagerSource, /onSendInvoiceToCustomer\(createdInvoice\.id\)/);
  assert.match(invoiceManagerSource, /ارسال مجدد تلگرامی/);
  assert.match(appSource, /\/api\/invoices\/\$\{invoiceId\}\/send-to-customer/);
}

function testRegularOrderReceiptReuploadContract() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // The tracking view offers a receipt button for card-transfer orders that
  // still owe a receipt (or whose receipt was rejected), and hides it while a
  // receipt is under review or already confirmed.
  assert.match(serverSource, /data\.startsWith\('order_reupload_receipt_'\)/);
  assert.match(serverSource, /order_reupload_receipt_\$\{ord\.id\}/);
  assert.match(serverSource, /canSendReceipt[\s\S]{0,400}paymentMethod !== 'cash_on_delivery'/);
  assert.match(serverSource, /receiptUnderReview/);
  // Opening the flow arms the same photo state the checkout uses.
  assert.match(serverSource, /mode: 'waiting_for_receipt', orderId: order\.id/);
  // The photo handler refuses forged/stale states and announces replacements.
  assert.match(serverSource, /String\(order\.customerTelegramId\) === chatId/);
  assert.match(serverSource, /order\.receiptReviewStatus !== 'confirmed'/);
  assert.match(serverSource, /این فیش جایگزین فیش قبلی شده است/);
  // The rejection notification carries a direct re-upload button.
  assert.match(serverSource, /order_reupload_receipt_\$\{order\.id\}/);
}

function testCustomizableBotTextsAndMultiPhotoContract() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const messagesModule = fs.readFileSync(new URL('../src/data/botMessages.ts', import.meta.url), 'utf8');
  const textsComponent = fs.readFileSync(new URL('../src/components/BotTextsCustomizer.tsx', import.meta.url), 'utf8');

  // Central message registry with Persian defaults.
  assert.match(messagesModule, /export const BOT_MESSAGES/);
  assert.match(messagesModule, /welcomeMessage/);
  assert.match(messagesModule, /receiptApprovedMessage/);
  assert.match(messagesModule, /customPrepaymentRejectedMessage/);

  // Server resolves messages through the registry and persists overrides.
  assert.ok(serverSource.includes("from './src/data/botMessages'"));
  assert.ok(serverSource.includes('function tmsg'));
  assert.ok(serverSource.includes("tmsg('welcomeMessage'"));
  assert.ok(serverSource.includes('allowedKeys'));
  assert.ok(serverSource.includes('botTexts'));

  // Panel lists every message, edits overrides and resets to default.
  assert.ok(textsComponent.includes('BOT_MESSAGE_LIST'));
  assert.ok(textsComponent.includes('getDefaultBotText'));
  assert.ok(textsComponent.includes('onUpdateSettings({ botTexts: cleaned })'));

  // Custom-order reference photos: up to 10 images collected one-by-one.
  assert.ok(serverSource.includes('custom_product_photos_more'));
  assert.ok(serverSource.includes('custom_product_done_photos'));
  assert.ok(serverSource.includes('collected.slice(0, 10)'));
  assert.ok(serverSource.includes('referenceImages: Array.isArray(state.photos)'));

  // Delivery date/time is gone from the customer bot flow.
  assert.doesNotMatch(serverSource, /مرحله ۴ از ۵/);
  assert.doesNotMatch(serverSource, /مرحله ۵ از ۵/);
}

function testUniqueOrderTrackingNumbers() {
  assert.equal(normalizeOrderNumber(' sh - 260827 - 483921 '), 'SH-260827-483921');
  assert.equal(normalizeOrderSearchValue('کد SH-۲۶۰۸۲۷-٤٨٣٩٢١'), 'کد sh-260827-483921');
  assert.equal(normalizeOrderSearchValue('۰۹۱۲-٣٤٥-۶۷۸۹'), '0912-345-6789');

  // Force one random collision and make sure the next available six-digit
  // candidate is allocated instead of duplicating a tracking number.
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const collidingCode = generateUniqueOrderNumber([]);
    let attempts = 0;
    Math.random = () => (attempts++ === 0 ? 0 : 1 / 900_000);
    const replacementCode = generateUniqueOrderNumber([{ orderNumber: collidingCode }]);
    assert.notEqual(replacementCode, collidingCode);
    assert.match(replacementCode, /^SH-\d{6}-\d{6}$/);
    assert.notEqual(resolveUniqueOrderNumber(collidingCode, [{ orderNumber: collidingCode }]), collidingCode);
    assert.match(resolveUniqueOrderNumber('SH-1234', []), /^SH-\d{6}-\d{6}$/);
  } finally {
    Math.random = originalRandom;
  }

  const allocated: Array<{ orderNumber: string }> = [];
  for (let index = 0; index < 100; index += 1) {
    const code = generateUniqueOrderNumber(allocated);
    assert.match(code, /^SH-\d{6}-\d{6}$/);
    assert.equal(allocated.some((order) => order.orderNumber === code), false);
    allocated.push({ orderNumber: code });
  }
  assert.equal(new Set(allocated.map((order) => order.orderNumber)).size, allocated.length);

  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /resolveUniqueOrderNumber\(req\.body\.orderNumber, orders\)/);
}

function testSingleProfilePerTelegramAccountAndAddressBook() {
  const customers: any[] = [];

  // First contact with a Telegram display name (NOT typed by the customer).
  const first = upsertBotCustomer(customers, {
    telegramId: '555001',
    name: 'سارا',
    username: 'sara_tg',
    address: 'تهران، آدرس اول',
    source: 'bot',
  });
  assert.equal(customers.length, 1);
  assert.equal(first.name, 'سارا');
  assert.equal(first.nameConfirmed, false, 'Telegram account name is never auto-confirmed');

  // The Telegram display name changing later must NOT overwrite... it is kept
  // while unconfirmed, but checkout is expected to re-ask. Here it simply stays
  // unconfirmed.
  upsertBotCustomer(customers, { telegramId: '555001', name: 'سارا جدید', username: 'sara_tg2' });
  assert.equal(findBotCustomer(customers, '555001')!.name, 'سارا جدید');
  assert.equal(findBotCustomer(customers, '555001')!.nameConfirmed, false);

  // Same account later types a real name via checkout (nameConfirmed: true) —
  // must NOT create a duplicate; the typed name becomes the confirmed profile
  // name and can never be overwritten by a Telegram profile name afterwards.
  const second = upsertBotCustomer(customers, {
    telegramId: '555001',
    name: 'سارا احمدی',
    phone: '09120000000',
    address: 'کرج، آدرس دوم',
    nameConfirmed: true,
  });
  assert.equal(customers.length, 1, 'one Telegram account must map to exactly one profile');
  assert.equal(second, first);
  assert.equal(second.name, 'سارا احمدی');
  assert.equal(second.nameConfirmed, true);
  assert.equal(second.phone, '09120000000');
  assert.deepEqual(second.addresses, ['تهران، آدرس اول', 'کرج، آدرس دوم']);
  assert.equal(second.address, 'کرج، آدرس دوم', 'legacy address field holds the most recently used address');

  // A later Telegram profile-name sync must not clobber the confirmed name.
  upsertBotCustomer(customers, { telegramId: '555001', name: 'اسم اکانت تلگرام', username: 'sara_tg3' });
  assert.equal(findBotCustomer(customers, '555001')!.name, 'سارا احمدی', 'confirmed name survives Telegram profile sync');
  assert.equal(findBotCustomer(customers, '555001')!.nameConfirmed, true);

  assert.equal(findBotCustomer(customers, '555001'), first);
  assert.equal(findBotCustomer(customers, '999999'), undefined);

  // Re-adding the same address does not duplicate it.
  upsertBotCustomer(customers, { telegramId: '555001', address: 'تهران، آدرس اول' });
  assert.deepEqual(customers[0].addresses, ['تهران، آدرس اول', 'کرج، آدرس دوم']);

  assert.equal(isRealName('مشتری'), false);
  assert.equal(isRealName('مشتری ربات'), false);
  assert.equal(isRealName('علی رضایی'), true);

  // Startup migration merges legacy duplicates (same telegramId, two records).
  const legacy: any[] = [
    { id: 'a', telegramId: '777', name: 'مشتری', phone: '0912', address: 'آدرس الف', walletBalance: 100, rewardPoints: 10, totalOrdersCount: 1, totalSpentTomans: 500, tier: 'bronze', source: 'bot', createdAt: '2026-01-01T00:00:00Z', lastActiveAt: '2026-01-02T00:00:00Z' },
    { id: 'b', telegramId: '777', name: 'نگار کریمی', phone: '', address: 'آدرس ب', walletBalance: 200, rewardPoints: 40, totalOrdersCount: 2, totalSpentTomans: 1500, tier: 'bronze', source: 'bot', createdAt: '2026-02-01T00:00:00Z', lastActiveAt: '2026-03-01T00:00:00Z' },
    { id: 'm1', telegramId: 'manual_123', name: 'مشتری تلفنی', phone: '021', tier: 'bronze', source: 'manual' as const, walletBalance: 0, rewardPoints: 0, totalOrdersCount: 0, totalSpentTomans: 0 },
  ];
  const merged = dedupeCustomers(legacy);
  assert.equal(merged.length, 2, 'duplicate bot profiles merged; manual users kept separate');
  const botProfile = merged.find((c) => c.telegramId === '777')!;
  assert.equal(botProfile.name, 'نگار کریمی');
  assert.equal(botProfile.phone, '0912');
  assert.equal(botProfile.walletBalance, 300);
  assert.equal(botProfile.totalOrdersCount, 3);
  assert.equal(botProfile.totalSpentTomans, 2000);
  assert.deepEqual(botProfile.addresses, ['آدرس الف', 'آدرس ب']);
  assert.equal(merged.some((c) => String(c.telegramId).startsWith('manual_')), true);
}

async function main() {
  testTelegramImageResolver();
  testSingleProfilePerTelegramAccountAndAddressBook();
  await testTicketUsesTelegramAccountAndKnownPhone();
  await testTicketDoesNotInventPhoneAndPhotoReplyKeepsFileIdContract();
  await testCheckoutPersistsTelegramProfileOnOrder();
  testProductImagesStayReachableForTelegram();
  testCustomOrdersAppearInCustomerTrackingWithDetails();
  testCustomPrepaymentReviewAndInvoiceAggregation();
  testProductsAndOrdersUseNarrowViewportSafeLayouts();
  testCustomerImagePanelsUseSharedZoomViewer();
  testTolerantPanelSearch();
  testIranianDeliveryInput();
  testServerPanelAuthenticationContract();
  await testReceiptConfirmationWorkflowAndFastReceiptViewer();
  testManualInvoiceReceiptReviewLifecycle();
  testDashboardAndTelegramInvoiceReceiptContract();
  testInvoiceCustomerTelegramDeliveryContract();
  testRegularOrderReceiptReuploadContract();
  testCustomizableBotTextsAndMultiPhotoContract();
  testUniqueOrderTrackingNumbers();
  assert.ok(sentMessages.length >= 2, 'The mocked bot should send ticket confirmations.');
  console.log('PASS: search, Iranian delivery, panel authentication, support profile, images, and order tracking flows.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
