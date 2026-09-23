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
import { canReceiveBroadcast, collectCustomerTags, resolveBroadcastAudience } from '../src/utils/broadcastAudience';
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
  // The raw Telegram file_id must be stored (never a generated absolute URL),
  // and every photo of the set is kept rather than only the last one.
  assert.match(serverSource, /replyPhotoState[\s\S]{0,1600}replyPhotoState\.photos\s*=/);
  assert.match(serverSource, /replyPhotoState[\s\S]{0,1600}incomingImageFileId/);
  assert.doesNotMatch(serverSource, /savedPhotoUrl/);
  // The panel still honours replies whose image lived in the text as Markdown.
  assert.match(supportManagerSource, /reply\.photos,\s*\n\s*reply\.photo,\s*\n\s*getLegacyReplyImage\(reply\.text\),/);
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
  // Anchored on the rendered message rather than a comment, so rewording the
  // surrounding code cannot silently disable this check.
  const initialBubbleIndex = supportManagerSource.indexOf('selectedTicket.message &&');
  const initialPhotoIndex = supportManagerSource.indexOf('selectedTicket.cakePhoto');
  assert.ok(initialBubbleIndex >= 0, 'The opening message bubble should exist.');
  assert.ok(initialPhotoIndex > initialBubbleIndex, 'The first ticket image must stay inside the opening message bubble.');
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

async function testCheckoutAlwaysOffersDiscountStepAndAppliesCode() {
  // The coupon question must appear even when the shop has no usable code:
  // silently skipping it made the feature look missing to the customer.
  const emptyStates = new Map<string, any>();
  const emptyCarts = new Map<string, any[]>();
  const noCodeCtx = makeContext({
    chatId: '551100',
    discounts: [],
    userStates: emptyStates,
    userCarts: emptyCarts,
    products: [{ id: 'p1', name: 'باقلوا', productCode: 'P-1', price: 200000, unit: 'کیلوگرم' }],
    botSettings: { shippingFee: 0, freeShippingThreshold: 0 },
  });
  emptyCarts.set(noCodeCtx.chatId, [{ productId: 'p1', quantity: 1 }]);
  await startCheckout(noCodeCtx);
  assert.equal(await handleCheckoutState(noCodeCtx, 'مریم احمدی'), true);
  assert.equal(await handleCheckoutState(noCodeCtx, '09121112233'), true);
  assert.equal(await handleCheckoutCallback(noCodeCtx, 'delivery_pickup'), true);
  assert.equal(emptyStates.get(noCodeCtx.chatId).mode, 'checkout_discount_code');

  // A valid percentage code is capped by maxDiscountAmount and lands on the order.
  const states = new Map<string, any>();
  const carts = new Map<string, any[]>();
  const orders: any[] = [];
  const discounts: any[] = [{
    id: 'd1', code: 'SHIRIN20', type: 'percentage', value: 20,
    maxDiscountAmount: 50000, isActive: true, usedCount: 0,
    createdAt: new Date().toISOString(),
  }];
  const ctx = makeContext({
    chatId: '551101',
    orders,
    discounts,
    userStates: states,
    userCarts: carts,
    products: [{ id: 'p1', name: 'کیک', productCode: 'P-1', price: 300000, unit: 'عدد' }],
    botSettings: { shippingFee: 0, freeShippingThreshold: 0 },
  });
  carts.set(ctx.chatId, [{ productId: 'p1', quantity: 2 }]);
  await startCheckout(ctx);
  assert.equal(await handleCheckoutState(ctx, 'رضا کریمی'), true);
  assert.equal(await handleCheckoutState(ctx, '09124445566'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'delivery_pickup'), true);
  // Lower-case input must still match, and the 20% of 600000 is capped at 50000.
  assert.equal(await handleCheckoutState(ctx, 'shirin20'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'payment_cash_on_delivery'), true);

  assert.equal(orders.length, 1);
  assert.equal(orders[0].couponCode, 'SHIRIN20');
  assert.equal(orders[0].discountAmount, 50000);
  assert.equal(orders[0].totalAmount, 550000);
  // The redemption must be counted so usage limits are enforced.
  assert.equal(discounts[0].usedCount, 1);

  // An invalid code keeps the customer on the discount step instead of failing.
  const badStates = new Map<string, any>();
  const badCarts = new Map<string, any[]>();
  const badCtx = makeContext({
    chatId: '551102',
    discounts: [{
      id: 'd2', code: 'OFFCODE', type: 'percentage', value: 50,
      isActive: false, usedCount: 0, createdAt: new Date().toISOString(),
    }],
    userStates: badStates,
    userCarts: badCarts,
    products: [{ id: 'p1', name: 'کیک', productCode: 'P-1', price: 100000, unit: 'عدد' }],
    botSettings: { shippingFee: 0, freeShippingThreshold: 0 },
  });
  badCarts.set(badCtx.chatId, [{ productId: 'p1', quantity: 1 }]);
  await startCheckout(badCtx);
  assert.equal(await handleCheckoutState(badCtx, 'سارا نوری'), true);
  assert.equal(await handleCheckoutState(badCtx, '09127778899'), true);
  assert.equal(await handleCheckoutCallback(badCtx, 'delivery_pickup'), true);
  assert.equal(await handleCheckoutState(badCtx, 'OFFCODE'), true);
  assert.equal(badStates.get(badCtx.chatId).mode, 'checkout_discount_code');

  // The server must route the skip button, otherwise the button looks dead.
  const routerSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(routerSource, /data === 'checkout_skip_discount'/);
}

async function testBotAdminActionsReportToForumTopics() {
  // Admin actions taken inside the bot used to change data silently: only the
  // customer and the acting admin were messaged, so the topic supergroup never
  // learned about receipt decisions, status changes or catalog edits. Every
  // mutating admin handler must reach notifyForumTopic.
  const handlersSource = fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8');

  function handlerBody(marker: string): string {
    const start = handlersSource.indexOf(marker);
    assert.notEqual(start, -1, `handler not found: ${marker}`);
    // A handler block ends at the next top-level `if (data` / `if (state.mode`.
    const rest = handlersSource.slice(start + marker.length);
    const nextIf = rest.search(/\n  if \((?:data|state\.mode)\b/);
    return nextIf === -1 ? rest : rest.slice(0, nextIf);
  }

  const mustReport: [string, string][] = [
    ["if (data.startsWith('admin_rapprove_'))", 'finance'],
    ["if (data.startsWith('admin_rreject_'))", 'finance'],
    ["if (data.startsWith('admin_cpreapprove_'))", 'finance'],
    ["if (data.startsWith('admin_cprereject_'))", 'finance'],
    ["if (data.startsWith('admin_status_'))", 'orders'],
    ["if (data.startsWith('admin_cstatus_'))", 'custom_orders'],
    ["if (data.startsWith('admin_toggle_avail_'))", 'products'],
    ["if (data.startsWith('admin_delete_prod_'))", 'products'],
    ["if (data.startsWith('admin_toggle_disc_'))", 'discounts'],
    ["if (data.startsWith('admin_del_disc_'))", 'discounts'],
    ["if (state.mode === 'edit_price')", 'products'],
    ["if (state.mode === 'add_discount')", 'discounts'],
    ["if (state.mode === 'quote_price')", 'custom_orders'],
  ];

  for (const [marker, topicKey] of mustReport) {
    const body = handlerBody(marker);
    assert.ok(
      body.includes('notifyForumTopic'),
      `${marker} must report to the forum topic but never calls notifyForumTopic`,
    );
    assert.ok(
      body.includes(`'${topicKey}'`),
      `${marker} must report to the '${topicKey}' topic`,
    );
  }

  // The invoice receipt decisions fixed earlier must keep reporting too.
  for (const marker of ["if (data.startsWith('admin_inva_approve_'))", "if (data.startsWith('admin_inva_reject_'))"]) {
    assert.ok(handlerBody(marker).includes('notifyForumTopic'), `${marker} lost its forum report`);
  }
}

async function testInvoicePaymentLifecycleReportsToFinanceTopic() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  function endpointBody(marker: string): string {
    const start = serverSource.indexOf(marker);
    assert.notEqual(start, -1, `endpoint not found: ${marker}`);
    const rest = serverSource.slice(start + marker.length);
    const nextRoute = rest.search(/\n  app\.(get|post|put|patch|delete)\(/);
    return nextRoute === -1 ? rest : rest.slice(0, nextRoute);
  }

  // Every stage of an invoice's money trail must reach the finance topic.
  const stages: string[] = [
    "app.post('/api/invoices'",
    "app.post('/api/invoices/:id/send-to-customer'",
    "app.post('/api/invoices/:id/payments'",
    "app.post('/api/invoices/:id/payments/:paymentId/review'",
  ];
  for (const marker of stages) {
    const body = endpointBody(marker);
    assert.ok(
      body.includes("sendToTelegramTopic("),
      `${marker} must report to a forum topic`,
    );
    assert.ok(body.includes("'finance'"), `${marker} must report to the finance topic`);
  }

  // A receipt sent by the customer in the bot is reported with its photo.
  assert.match(serverSource, /recordManualInvoiceReceipt[\s\S]{0,1200}فیش فاکتور اختصاصی دریافت شد/);

  // Registering a payment must persist its receipt: reviewing a submitted
  // payment requires one, so dropping it made the payment unreviewable and its
  // approval could never be reported.
  const registerBody = endpointBody("app.post('/api/invoices/:id/payments'");
  assert.ok(
    /receiptImage:/.test(registerBody),
    'a payment registered from the panel must keep its receiptImage',
  );
  const reviewBody = endpointBody("app.post('/api/invoices/:id/payments/:paymentId/review'");
  assert.ok(
    reviewBody.includes('!payment.receiptImage'),
    'review still gates on a receipt being present',
  );
}

async function testMultiPhotoReportsAreSentAsAlbums() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // A report carrying several pictures must go out as an album; sendPhoto can
  // only ever show one, which is why galleries looked truncated in the group.
  assert.match(serverSource, /sendToTelegramTopic\([\s\S]{0,200}photoUrl\?: string \| string\[\]/);
  assert.ok(
    serverSource.includes('sendMediaGroup'),
    'multi-photo topic reports must use sendMediaGroup',
  );
  // Telegram accepts a caption on the first album item only.
  assert.match(serverSource, /index === 0 \? \{ caption: messageText, parse_mode: 'HTML' \} : \{\}/);
  // Telegram rejects an album larger than 10 items.
  assert.match(serverSource, /\.slice\(0, 10\)/);
  // Base64 payloads cannot be referenced inside a JSON media group.
  assert.match(serverSource, /!image\.startsWith\('data:'\)/);

  // The callers must hand over their whole gallery rather than one picture.
  assert.ok(
    serverSource.includes('[newProduct.image, ...(Array.isArray(newProduct.images) ? newProduct.images : [])]'),
    'a new product must report its full gallery',
  );
  assert.ok(
    /sendToTelegramTopic\([\s\S]{0,1400}newOrder\.referenceImages\s*\n/.test(serverSource),
    'a custom order created over HTTP must report every reference photo',
  );
  assert.ok(
    /sendToTelegramTopic\([\s\S]{0,1400}newCustomOrder\.referenceImages\s*\n/.test(serverSource),
    'a custom order created in the bot must report every reference photo',
  );
  // Regression: no caller may go back to sending only the first picture.
  assert.ok(
    !/referenceImages\?\.\[0\]/.test(serverSource),
    'reference photo reports must not fall back to the first image only',
  );
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
  // (inline) -> address (courier) -> discount code -> payment.
  await startCheckout(ctx);
  assert.equal(await handleCheckoutState(ctx, 'لیلا مرادی'), true);
  assert.equal(await handleCheckoutState(ctx, '09120000000'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'delivery_delivery'), true);
  assert.equal(await handleCheckoutState(ctx, 'تهران، نمونه آدرس'), true);
  assert.equal(await handleCheckoutCallback(ctx, 'checkout_skip_discount'), true);
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

/**
 * Request 9: forced channel membership.
 *
 * The gate must hold the customer at /start, survive a stale keyboard button,
 * stay completely inert when the admin switches it off, and never lock anyone
 * out because of a channel the bot cannot read.
 */
async function testRequiredChannelJoinGate() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.ok(
    /function getActiveRequiredChannels\(\)[\s\S]*?if \(!botSettings\.requiredChannelsEnabled\) return \[\];/.test(serverSource),
    'the master switch must short-circuit the gate so it can be turned off from the panel'
  );

  assert.ok(
    /getActiveRequiredChannels\(\)[\s\S]*?filter\([\s\S]*?channel\.enabled !== false/.test(serverSource),
    'a channel disabled in the panel must be skipped'
  );

  const startBlock = serverSource.slice(serverSource.indexOf("if (text === '/start')"));
  const gateAtStart = startBlock.indexOf('blockedByRequiredChannels');
  const menuAtStart = startBlock.indexOf('await sendBotMainMenu');
  assert.ok(gateAtStart > -1, '/start must consult the membership gate');
  assert.ok(
    gateAtStart < menuAtStart,
    'the gate must run BEFORE the main menu, otherwise the customer can keep ordering'
  );

  assert.ok(
    /data === 'check_required_channels'/.test(serverSource),
    'the "I joined" button needs a callback handler that re-checks membership'
  );

  const callbackSection = serverSource.slice(serverSource.indexOf('} else if (update.callback_query) {'));
  const recheck = callbackSection.indexOf("data === 'check_required_channels'");
  const callbackGate = callbackSection.indexOf('blockedByRequiredChannels');
  assert.ok(callbackGate > -1, 'customer callbacks must be gated too, not only /start');
  assert.ok(
    recheck < callbackGate,
    'the re-check callback must be handled before the gate, or the customer could never get past it'
  );

  // Fail-open: an unreadable channel (bot is not an admin there) is skipped
  // instead of blocking every customer.
  assert.ok(
    /if \(!data\?\.ok\) \{[\s\S]*?continue;/.test(serverSource),
    'an unreadable channel must be skipped, never treated as "not joined"'
  );
  assert.ok(
    /catch \(err\) \{[\s\S]*?\[requiredChannels\] getChatMember failed/.test(serverSource),
    'a getChatMember network error must not lock customers out'
  );

  const joinedStatuses = serverSource.match(/const joinedStatuses = new Set\(\[(.*?)\]\)/);
  assert.ok(joinedStatuses, 'membership statuses must be defined explicitly');
  for (const status of ['creator', 'administrator', 'member', 'restricted']) {
    assert.ok(
      joinedStatuses[1].includes(status),
      `"${status}" counts as joined and must not be rejected`
    );
  }
  assert.ok(!joinedStatuses[1].includes('left'), '"left" must not count as joined');
  assert.ok(!joinedStatuses[1].includes('kicked'), '"kicked" must not count as joined');

  // Admins stay exempt so a broken channel id can always be fixed from the bot.
  assert.ok(
    /blockedByRequiredChannels[\s\S]*?if \(isTelegramAdmin\(String\(userId\)\)\) return false;/.test(serverSource),
    'administrators must be exempt from the gate'
  );

  // The panel must be able to store and switch the feature.
  const typesSource = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  assert.ok(/requiredChannelsEnabled\?: boolean;/.test(typesSource), 'BotSettings needs the on/off switch');
  assert.ok(/requiredChannels\?: RequiredChannel\[\];/.test(typesSource), 'BotSettings needs the channel list');

  const uiSource = fs.readFileSync(new URL('../src/components/BotSettings.tsx', import.meta.url), 'utf8');
  assert.ok(
    /handleInputChange\('requiredChannelsEnabled', event\.target\.checked\)/.test(uiSource),
    'the panel must expose a toggle to turn the feature off'
  );
  assert.ok(/addRequiredChannel|removeRequiredChannel/.test(uiSource), 'the panel must manage the channel list');

  console.log('✅ required channel join gate blocks, re-checks, fails open and can be switched off');
}

/**
 * Pressing "I joined" while still not a member must produce a DIFFERENT
 * message, otherwise the customer cannot tell the check actually ran. All
 * three gate messages must also be editable from the panel.
 */
async function testRequiredChannelMessagesAreDistinctAndCustomizable() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const messagesSource = fs.readFileSync(new URL('../src/data/botMessages.ts', import.meta.url), 'utf8');

  for (const key of [
    'requiredChannelsPromptMessage',
    'requiredChannelsStillMissingMessage',
    'requiredChannelsPassedMessage',
  ]) {
    assert.ok(messagesSource.includes(`'${key}'`), `${key} must be a registered, editable bot message`);
    assert.ok(serverSource.includes(key), `${key} must actually be used by the bot`);
  }

  // The retry path must select the "still missing" text, not repeat the first one.
  assert.ok(
    /retry \? 'requiredChannelsStillMissingMessage' : 'requiredChannelsPromptMessage'/.test(serverSource),
    'the retry must switch to a different message than the first prompt'
  );
  assert.ok(
    /sendRequiredChannelsPrompt\(token, chatId, stillMissing, true\)/.test(serverSource),
    'the "I joined" callback must pass retry=true when the customer is still not a member'
  );
  // The very first prompt must NOT be the retry variant.
  assert.ok(
    /await sendRequiredChannelsPrompt\(token, chatId, missing\);/.test(serverSource),
    'the first prompt must be sent without the retry flag'
  );

  // The two texts must genuinely differ, so the customer sees a change.
  const defaults: Record<string, string> = {};
  for (const key of ['requiredChannelsPromptMessage', 'requiredChannelsStillMissingMessage']) {
    const match = messagesSource.match(new RegExp(`${key}:[\\s\\S]*?defaultText:\\s*\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`));
    assert.ok(match, `${key} needs a default text`);
    defaults[key] = match[1];
  }
  assert.notStrictEqual(
    defaults.requiredChannelsPromptMessage,
    defaults.requiredChannelsStillMissingMessage,
    'the retry message must not be identical to the first prompt'
  );

  // Both list the outstanding channels.
  for (const key of ['requiredChannelsPromptMessage', 'requiredChannelsStillMissingMessage']) {
    assert.ok(defaults[key].includes('{channelList}'), `${key} must show which channels are missing`);
  }

  // The panel groups them so an admin can find them.
  assert.ok(
    /key: 'channels',[\s\S]*?requiredChannelsPromptMessage/.test(messagesSource),
    'the gate messages need their own group in the text customizer'
  );

  console.log('✅ join-gate messages are distinct on retry and editable from the panel');
}

/**
 * A shop must never lose its order and customer history.
 *
 * Writing the data file in place truncates it first, so a restart (Railway
 * redeploy, pm2 restart, OOM kill) during a multi-megabyte write used to leave
 * an unparseable file. This exercises the real thing: write a big payload in a
 * child process, SIGKILL it mid-write, then load and verify nothing is lost.
 */
async function testDataFileSurvivesACrashDuringWrite() {
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const { spawn } = await import('node:child_process');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'shirini-persist-'));
  const persistModule = new URL('../src/persistData.ts', import.meta.url).pathname;
  const seedCustomers = [{ id: 'c1', name: 'مشتری قدیمی' }];

  const writerFile = pathMod.join(dir, 'writer.mjs');
  fs.writeFileSync(
    writerFile,
    [
      `import { saveData } from ${JSON.stringify(persistModule)};`,
      // Large enough that a write is always in flight when we kill it.
      "const orders = Array.from({length: 120000}, (_, i) => ({ id: 'ord-' + i, receipt: 'x'.repeat(120) }));",
      `const base = { products: [], customOrders: [], invoices: [], discounts: [], supportTickets: [], customers: ${JSON.stringify(seedCustomers)}, walletTransactions: [], backupSnapshots: [], backupSchedule: {} };`,
      'saveData({ ...base, orders: [{ id: "ord-SEED" }] });',
      'process.send && process.send("seeded");',
      'while (true) { saveData({ ...base, orders }); }',
    ].join('\n'),
  );

  const child = spawn(process.execPath, ['--import', 'tsx', writerFile], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('writer did not seed in time')), 60000);
      child.on('message', (m) => {
        if (m === 'seeded') { clearTimeout(timer); resolve(); }
      });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('writer exited early')); });
    });

    // Let a big write get under way, then kill it the way a host would.
    await new Promise((r) => setTimeout(r, 2500));
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));

    const dataFile = pathMod.join(dir, 'data.json');
    const raw = fs.readFileSync(dataFile, 'utf8');
    let parsed: any;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); },
      'data.json must still be valid JSON after a crash mid-write');
    assert.ok(Array.isArray(parsed.customers), 'the recovered file must keep its shape');
    assert.ok(parsed.customers.length > 0, 'customer records must survive a crash');

    // A restart must come back with real data, never an empty shop.
    const previousDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    try {
      const mod = await import(`${persistModule}?crash=${Date.now()}`);
      const loaded = mod.loadData();
      assert.ok(loaded, 'loadData must recover something after a crash');
      assert.ok(loaded.customers.length > 0, 'loadData must not return an empty customer list');
    } finally {
      if (previousDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDir;
    }
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✅ data file survives a crash mid-write and reloads without data loss');
}

/** The corrupted-file fallback chain must be real, not just documented. */
async function testCorruptedDataFileFallsBackToABackup() {
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'shirini-corrupt-'));
  const persistModule = new URL('../src/persistData.ts', import.meta.url).pathname;

  try {
    // DATA_DIR is resolved once at import time, so this must run in its own
    // process with the environment already pointing at the temp directory.
    const script = pathMod.join(dir, 'check.mjs');
    fs.writeFileSync(
      script,
      [
        `import fs from 'node:fs';`,
        `import path from 'node:path';`,
        `import { saveData, loadData } from ${JSON.stringify(persistModule)};`,
        `saveData({ products: [], orders: [{ id: 'ord-1' }], customOrders: [], invoices: [], discounts: [], supportTickets: [], customers: [{ id: 'c1', name: 'علی' }], walletTransactions: [], backupSnapshots: [], backupSchedule: {} });`,
        `const dataFile = path.join(process.env.DATA_DIR, 'data.json');`,
        // Truncate the live file the way an interrupted write would.
        `fs.writeFileSync(dataFile, fs.readFileSync(dataFile, 'utf8').slice(0, 80));`,
        `const recovered = loadData();`,
        `console.log(JSON.stringify({ name: recovered?.customers?.[0]?.name ?? null, keptEvidence: fs.existsSync(path.join(process.env.DATA_DIR, 'data.corrupt.json')) }));`,
      ].join('\n'),
    );

    const output = execFileSync(process.execPath, ['--import', 'tsx', script], {
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const result = JSON.parse(output.trim().split('\n').pop() as string);

    assert.strictEqual(
      result.name,
      'علی',
      'a corrupted data.json must fall back to a backup holding the real records, not an empty shop'
    );
    assert.ok(
      result.keptEvidence,
      'the damaged file must be preserved as data.corrupt.json instead of being silently overwritten'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✅ a corrupted data file is recovered from a rolling backup');
}

/**
 * Tailwind v4 removed the `cursor: pointer` its v3 preflight applied to
 * buttons, which left every control in the panel showing a plain arrow. The
 * rule must stay in the stylesheet or the whole panel silently feels broken.
 */
async function testClickableControlsShowAHandCursor() {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  const pointerRule = css.match(/([^}]*)\{\s*cursor:\s*pointer;?\s*\}/);
  assert.ok(pointerRule, 'the stylesheet must restore cursor:pointer for clickable controls');
  const selectors = pointerRule[1];
  for (const selector of ['button:not(:disabled)', '[role="button"]', 'summary', 'a[href]']) {
    assert.ok(
      selectors.includes(selector),
      `${selector} must get a hand cursor, otherwise it does not feel clickable`
    );
  }

  assert.ok(
    /cursor:\s*not-allowed/.test(css),
    'disabled controls must keep the not-allowed cursor instead of looking clickable'
  );

  console.log('✅ clickable panel controls show a hand cursor');
}

/**
 * Every discount-step button that server.ts routes into the checkout flow must
 * actually be handled there.
 *
 * `no_discount` was routed but had no branch, so handleCheckoutCallback
 * returned false and the customer was silently dropped out of checkout instead
 * of reaching the payment step that asks for the receipt photo.
 */
async function testEveryRoutedCheckoutCallbackIsHandled() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const flowSource = fs.readFileSync(new URL('../src/checkoutFlow.ts', import.meta.url), 'utf8');

  const routerLine = serverSource
    .split('\n')
    .find((line) => line.includes('handleCheckoutCallback') === false && line.includes("data === 'checkout_skip_discount'"));
  assert.ok(routerLine, 'the checkout callback router must exist in server.ts');

  const routed = [...routerLine.matchAll(/data === '([^']+)'/g)].map((m) => m[1]);
  assert.ok(routed.length > 5, 'the router should list the checkout callbacks');

  for (const payload of routed) {
    // confirm_order / cancel_order are handled by the generic order handlers.
    if (payload === 'confirm_order' || payload === 'cancel_order') continue;
    assert.ok(
      flowSource.includes(`'${payload}'`),
      `server.ts routes "${payload}" into the checkout flow, but checkoutFlow.ts never handles it — ` +
        'the customer would be dropped out of checkout'
    );
  }

  // Both the current and the legacy "no coupon" payloads must finish registration.
  const skipBranch = flowSource.match(/if \(data === 'checkout_skip_discount'[^)]*\)\s*\{[\s\S]*?\}/);
  assert.ok(skipBranch, 'the skip-discount branch must exist');
  assert.ok(
    skipBranch[0].includes('finishRegistration'),
    'skipping the discount must go on to the payment step, not stop'
  );
  assert.ok(
    /data === 'checkout_skip_discount' \|\| data === 'no_discount'/.test(flowSource),
    'the legacy no_discount button must behave exactly like the current skip button'
  );

  console.log('✅ every routed checkout callback is handled, including legacy discount buttons');
}

/**
 * Targeted broadcasts: an admin must be able to message everyone, a custom
 * category (tag), a hand-picked list, or a built-in filter — and never message
 * someone the bot cannot reach.
 */
async function testBroadcastAudienceTargeting() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-20T00:00:00.000Z');
  const make = (over: any) => ({
    id: over.id, telegramId: over.telegramId ?? over.id, name: over.name || over.id,
    phone: '0912', walletBalance: 0, rewardPoints: 0,
    totalOrdersCount: over.totalOrdersCount ?? 0, totalSpentTomans: 0,
    tier: over.tier || 'bronze', tags: over.tags,
    createdAt: new Date(now).toISOString(),
    lastActiveAt: new Date(now - (over.inactiveDays ?? 0) * day).toISOString(),
  }) as any;

  const customers = [
    make({ id: 'c1', tier: 'vip', totalOrdersCount: 5, tags: ['عروسی'], inactiveDays: 2 }),
    make({ id: 'c2', tier: 'gold', totalOrdersCount: 2, tags: ['عروسی'], inactiveDays: 10 }),
    make({ id: 'c3', tier: 'bronze', totalOrdersCount: 0, inactiveDays: 90 }),
    make({ id: 'c4', tier: 'silver', totalOrdersCount: 3, tags: ['عمده'], inactiveDays: 200 }),
    // No Telegram id: added by an admin in the panel, unreachable by the bot.
    make({ id: 'c5', telegramId: '', tier: 'vip', totalOrdersCount: 9, tags: ['عروسی'] }),
    make({ id: 'c6', telegramId: 'guest', tier: 'vip', totalOrdersCount: 1, tags: ['عروسی'] }),
  ];

  const ids = (a: any) => resolveBroadcastAudience(customers, a, now).recipients.map((c) => c.id);

  // Unreachable customers are excluded from every audience, including "all".
  assert.deepEqual(ids({ type: 'all' }), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(canReceiveBroadcast(customers[4]), false, 'a customer without a telegram id is unreachable');
  assert.equal(canReceiveBroadcast(customers[5]), false, '"guest" is not a real chat id');

  // A custom category only reaches its own members — never everyone.
  assert.deepEqual(ids({ type: 'tag', tag: 'عروسی' }), ['c1', 'c2']);
  assert.deepEqual(ids({ type: 'tag', tag: 'عمده' }), ['c4']);
  assert.deepEqual(ids({ type: 'tag', tag: 'دستهٔ خالی' }), [], 'an unknown tag must reach nobody');
  assert.deepEqual(ids({ type: 'tag', tag: '' }), [], 'a blank tag must never fall back to everyone');

  assert.deepEqual(ids({ type: 'tier', tier: 'vip' }), ['c1']);
  assert.deepEqual(ids({ type: 'selected', customerIds: ['c2', 'c4', 'c5'] }), ['c2', 'c4']);
  assert.deepEqual(ids({ type: 'selected', customerIds: [] }), [], 'selecting nobody must reach nobody');
  assert.deepEqual(ids({ type: 'no_orders' }), ['c3']);
  assert.deepEqual(ids({ type: 'recent_buyers', days: 30 }), ['c1', 'c2']);
  assert.deepEqual(ids({ type: 'inactive', days: 30 }), ['c3', 'c4']);

  // Labels are shown to the admin before sending, so they must name the target.
  assert.equal(resolveBroadcastAudience(customers, { type: 'tag', tag: 'عروسی' }, now).label, 'برچسب: عروسی');
  assert.equal(resolveBroadcastAudience(customers, { type: 'all' }, now).label, 'همهٔ مشتریان');

  // The count shown next to a category must be the number of people who will
  // actually receive the message, so unreachable customers are not counted:
  // c1 and c2 are tagged "عروسی" and reachable, c5/c6 are tagged but are not.
  const tags = collectCustomerTags(customers);
  assert.deepEqual(tags[0], { tag: 'عروسی', count: 2 }, 'tag counts must match real reach');
  assert.ok(tags.some((t) => t.tag === 'عمده'), 'every tag in use must be listed');

  console.log('✅ broadcast targeting reaches the chosen audience only');
}

/**
 * A broadcast must be able to start a real conversation: each recipient gets
 * their own ticket carrying a reply button, so the customer's answer lands in
 * a thread the admin can see and answer back.
 */
async function testBroadcastCanStartAReplyableConversation() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // The broadcast route must create a ticket per recipient and attach the same
  // reply callback the ticket flow already understands.
  const routeStart = serverSource.indexOf("app.post('/api/telegram/broadcast'");
  assert.ok(routeStart > -1, 'the broadcast route must exist');
  const route = serverSource.slice(routeStart, routeStart + 6000);

  assert.ok(route.includes('supportTickets.push'), 'a broadcast must create a ticket per recipient');
  assert.ok(
    route.includes('reply_ticket_${ticket.id}'),
    'the broadcast message must carry the reply button the ticket flow handles'
  );
  assert.ok(
    route.includes("supportTickets = supportTickets.filter"),
    'a ticket must not survive when the message failed to reach the customer'
  );

  // The customer's reply has to be reported, otherwise the thread dies unseen.
  assert.ok(
    serverSource.includes('پاسخ جدید مشتری'),
    'a customer reply must be reported to the admin support topic'
  );

  // `reply_ticket_<id>` is what the bot sends; the handler must accept it.
  const handlerSource = fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8');
  assert.ok(
    handlerSource.includes("data.startsWith('reply_ticket_')"),
    'the bot must handle the reply button produced by a broadcast'
  );

  console.log('✅ broadcasts open a two-way conversation');
}

/**
 * The panel renders a ticket's opening message from `message` and the rest of
 * the thread from `replies.slice(1)`. So `replies[0]` must always mirror the
 * opening message, and carry the sender who actually wrote it.
 *
 * A broadcast ticket opened with an empty `replies` list broke both halves:
 * the shop's own message was drawn as if the customer had sent it, and the
 * customer's first answer became `replies[0]` and was sliced away — their
 * reply simply never appeared in the panel.
 */
async function testTicketThreadKeepsEveryMessageAndItsRealSender() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const panelSource = fs.readFileSync(new URL('../src/components/SupportManager.tsx', import.meta.url), 'utf8');

  // The panel still slices, so the invariant below is the thing that matters.
  assert.ok(
    panelSource.includes('replies.slice(1)'),
    'the panel renders the opening message separately from the rest of the thread'
  );

  const routeStart = serverSource.indexOf("app.post('/api/telegram/broadcast'");
  const route = serverSource.slice(routeStart, routeStart + 6000);
  assert.ok(
    /replies:\s*\[\s*\{/.test(route),
    'a broadcast ticket must seed replies[0] instead of starting empty, or the first customer answer is hidden'
  );
  assert.ok(
    /sender:\s*'admin'/.test(route),
    "a message the shop sent must be recorded as the admin's, not the customer's"
  );

  // Older tickets already on disk are repaired at startup.
  assert.ok(
    serverSource.includes('repaired') && serverSource.includes('ticket.replies.unshift'),
    'tickets saved before the fix must be repaired so the hidden reply reappears'
  );

  // The opening bubble must be attributed to whoever actually opened it.
  assert.ok(
    panelSource.includes("opener?.sender === 'admin'"),
    'the opening bubble must not be hard-coded to the customer'
  );

  console.log('✅ ticket threads show every message with its real sender');
}

/**
 * Customers routinely attach several pictures to one support message. Every
 * collection point must keep the whole set instead of letting each new image
 * overwrite the previous one, and the panel must render all of them.
 */
function testSupportMessagesKeepEveryAttachedPhoto() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const handlersSource = fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8');
  const supportManagerSource = fs.readFileSync(
    new URL('../src/components/SupportManager.tsx', import.meta.url),
    'utf8',
  );

  const supportPhotoBlock = serverSource.slice(
    serverSource.indexOf("supportPhotoState.mode === 'support_photo'"),
  ).slice(0, 2000);
  assert.ok(
    supportPhotoBlock.includes('__albumFiles')
      && /supportPhotoState\.photos\s*=\s*collected/.test(supportPhotoBlock),
    'A new ticket must collect every photo, not overwrite the previous one.',
  );

  const replyPhotoBlock = serverSource.slice(
    serverSource.indexOf("replyPhotoState.mode === 'reply_to_ticket_photo'"),
  ).slice(0, 2200);
  assert.ok(
    replyPhotoBlock.includes('__albumFiles')
      && /replyPhotoState\.photos\s*=\s*collected/.test(replyPhotoBlock),
    'A ticket reply must collect every photo the customer sends.',
  );
  assert.ok(
    !replyPhotoBlock.includes('ticket.replies.push('),
    'The reply must be posted once the customer is done, not on the first photo.',
  );
  assert.ok(
    handlersSource.includes("data === 'reply_ticket_photo_done'"),
    'A handler must post the reply once every photo has been attached.',
  );

  // The opening message and its mirrored replies[0] must carry the same set.
  assert.ok(
    handlersSource.includes('cakePhotos: supportPhotos.length ? supportPhotos : undefined'),
    'A bot ticket must store the whole album on the ticket.',
  );
  assert.ok(
    handlersSource.includes('photos: supportPhotos.length ? supportPhotos : undefined'),
    "The mirrored replies[0] must carry the same album as the opening message.",
  );

  // The panel renders a list, so a second image can never be dropped.
  assert.ok(
    supportManagerSource.includes('imageSources: string[]'),
    'The attachment component must accept every image, not a single source.',
  );
  assert.ok(
    supportManagerSource.includes('collectTicketImageSources(\n                            selectedTicket.cakePhotos'),
    'The opening bubble must render every attached image.',
  );
  assert.ok(
    supportManagerSource.includes('reply.photos'),
    'Reply bubbles must render every attached image.',
  );

  // Customers frequently answer "do you want to attach an image?" by sending
  // the photos instead of tapping the button, which used to discard them.
  assert.ok(
    serverSource.includes("supportPhotoState.mode === 'support_photo_ask'"),
    'Photos sent without tapping the button must still be collected on a new ticket.',
  );
  assert.ok(
    serverSource.includes("replyPhotoState.mode === 'reply_to_ticket_photo_ask'"),
    'Photos sent without tapping the button must still be collected on a reply.',
  );

  // "2 photos received", not "photo 2 received".
  assert.ok(
    /\$\{supportPhotoCount\.toLocaleString\('fa-IR'\)\}<\/b> تصویر دریافت شد/.test(serverSource),
    'The acknowledgment must read as a count of photos, not an index.',
  );

  console.log('✅ support messages keep every attached photo');
}

/**
 * The admin side must mirror what a customer can already do: attach several
 * pictures to one reply, and step through an album in the viewer instead of
 * closing and reopening it image by image.
 */
function testAdminCanReplyWithSeveralPhotosAndBrowseThem() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const supportManagerSource = fs.readFileSync(
    new URL('../src/components/SupportManager.tsx', import.meta.url),
    'utf8',
  );
  const viewerSource = fs.readFileSync(
    new URL('../src/components/ZoomableImageModal.tsx', import.meta.url),
    'utf8',
  );

  const replyRouteStart = serverSource.indexOf("app.post('/api/support/tickets/:id/reply'");
  const replyRoute = serverSource.slice(
    replyRouteStart,
    serverSource.indexOf("app.put('/api/support/tickets/:id/status'", replyRouteStart),
  );

  // The reply must persist the whole set and stay valid with images only.
  assert.ok(
    /photos:\s*replyPhotos\.length \? replyPhotos : undefined/.test(replyRoute),
    'An admin reply must persist every attached photo.',
  );
  assert.ok(
    replyRoute.includes('!replyText && replyPhotos.length === 0'),
    'A reply carrying only images must be accepted.',
  );
  // Telegram renders several pictures only as an album.
  assert.ok(
    /sendMediaGroup[\s\S]{0,400}media: albumReady\.map/.test(replyRoute),
    'Several photos must reach the customer as one album.',
  );
  assert.ok(
    (replyRoute.match(/reply_markup: replyKeyboard/g) || []).length >= 3,
    'The reply buttons must still reach the customer on every delivery path.',
  );

  // The panel uploads the bytes first: Telegram cannot fetch a data URL.
  assert.ok(
    supportManagerSource.includes('uploadImagesWithProgress('),
    'Attached images must be uploaded so Telegram can fetch them.',
  );
  assert.ok(
    /onReplyTicket\([\s\S]{0,120}replyPhotos\)/.test(supportManagerSource),
    'The reply handler must forward the attached photos.',
  );
  assert.ok(
    appSource.includes('photos: replyPhotos'),
    'The reply request body must carry the photos.',
  );

  // The viewer steps through the set the opened image belongs to.
  assert.ok(
    viewerSource.includes('gallery?: string[]') && viewerSource.includes('onNavigate'),
    'The viewer must accept the set the opened image belongs to.',
  );
  assert.ok(
    viewerSource.includes("'ArrowLeft'") && viewerSource.includes("'ArrowRight'"),
    'Arrow keys must step through the gallery.',
  );
  assert.ok(
    /const nextIndex = \(galleryIndex \+ offset \+ total\) % total/.test(viewerSource),
    'Stepping past the last image must wrap around.',
  );
  // The stage captures pointers; without this the arrows never receive a click.
  const arrowGuards = viewerSource.match(
    /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]{0,200}?showRelativeImage\(-?1\)/g,
  );
  assert.equal(
    arrowGuards?.length,
    2,
    'Both gallery arrows must stop the pan gesture, or their clicks never land.',
  );
  assert.ok(
    supportManagerSource.includes('gallery={previewGallery}'),
    'Opening an image must hand its own album to the viewer.',
  );

  console.log('✅ admin replies carry several photos and the viewer browses them');
}

/**
 * Images the shop attaches must be reachable by two different consumers: the
 * browser rendering the panel, and Telegram fetching them from its own servers.
 */
function testDeployBuildsTheAppExactlyOnce() {
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const pkg = JSON.parse(read('../package.json'));
  const scripts = pkg.scripts || {};

  // Railway ran `npm run build` four times per deploy (nixpacks build phase +
  // postinstall + Procfile + prestart). Each build peaks around 340MB, so the
  // container hit its memory ceiling and kept serving the previous version —
  // which looks exactly like "my change didn't apply".
  assert.ok(!scripts.postinstall, 'postinstall must not rebuild: the build phase already does.');
  assert.ok(!scripts.prestart, 'prestart must not rebuild: the build phase already does.');

  const procfile = read('../Procfile');
  assert.ok(
    !/npm run build/.test(procfile),
    'The Procfile must not rebuild; it should only start the server.',
  );
  assert.ok(/npm start/.test(procfile), 'The Procfile must start the server.');

  // A deployment that installs without dev dependencies must still be able to
  // build: every tool the build command invokes has to be a real dependency.
  const deps = pkg.dependencies || {};
  for (const tool of ['vite', 'esbuild', 'tailwindcss', 'typescript']) {
    assert.ok(deps[tool], `${tool} must be a dependency so a production install can still build.`);
  }
  assert.ok(pkg.engines?.node, 'The Node version must be pinned so the deploy is reproducible.');

  // Start still has to work on a cold container with no build cache.
  assert.ok(
    /dist\/server\.cjs/.test(scripts.start) && /npm run build/.test(scripts.start),
    'start must fall back to building when dist/ is absent.',
  );

  // The running revision must be visible in the panel, so a stale deployment is
  // identifiable at a glance rather than mistaken for a missing change.
  const header = read('../src/components/Header.tsx');
  assert.ok(
    /\/api\/health/.test(header) && /appRevision/.test(header),
    'The panel must display the running revision from /api/health.',
  );
  console.log('✅ a deploy builds the app exactly once and shows its revision');
}

function testAMessageToCustomersIsSignedByTheShop() {
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const serverSource = read('../server.ts');

  const route = serverSource.split("app.post('/api/telegram/broadcast'")[1] || '';
  assert.ok(route, 'The broadcast route must exist.');
  const body = route.split('app.post(')[0];

  // A bare message gives the customer no idea who wrote it, so the shop signs
  // and dates every message it sends, exactly like a support reply.
  assert.ok(
    /پیام از طرف \$\{escapeTelegramHtml\(shopSenderName\(\)\)\}/.test(body),
    'A message to customers must be signed with the shop name from settings.',
  );
  assert.ok(
    /🕑 \$\{formatIranianDateTime\(/.test(body),
    'A message to customers must carry its exact date.',
  );

  // The signed wrapper is sent with parse_mode HTML, so the admin's own words
  // must be escaped or a stray '<' makes Telegram reject the whole message.
  assert.ok(
    /\$\{escapeTelegramHtml\(text\)\}/.test(body),
    "The admin's text must be escaped before going into the HTML wrapper.",
  );

  // Both plain messages and photo captions must carry the signature.
  assert.ok(
    /caption: announcement/.test(body) && /text: announcement/.test(body),
    'Both the photo caption and the plain message must use the signed text.',
  );

  // The panel thread must keep the admin's raw words, not the wrapper.
  assert.ok(
    /message: text,/.test(body) && /text: text,/.test(body),
    'The stored ticket must keep the raw message, not the decorated one.',
  );
  console.log('✅ a message to customers is signed by the shop and dated');
}

function testGroupReportsNeverFailSilently() {
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const serverSource = read('../server.ts');

  const fn = serverSource.split('async function sendToTelegramTopic(')[1] || '';
  assert.ok(fn, 'The group report helper must exist.');
  const body = fn.split('// Core function to automatically setup forum topics')[0];

  // The bug: every Telegram rejection was swallowed, so a group that received
  // nothing looked perfectly healthy and there was nothing to debug with.
  assert.ok(
    /markFailed\(/.test(body) && /delivery failed/.test(body),
    'A rejected group report must be logged, not swallowed.',
  );
  // Every terminal branch must end in a verdict: the last attempt of the text
  // path and the catch block both have to report the failure.
  assert.ok(
    /if \(plainData\?\.ok\) \{ markDelivered\(\); return; \}\s*\n\s*markFailed\(/.test(body),
    'When the final fallback fails the report must be marked failed.',
  );
  assert.ok(
    /catch \(err\) \{\s*\n\s*markFailed\(/.test(body),
    'A thrown error must mark the report failed, not be swallowed.',
  );

  // lastReportTime was written before the send, so the panel claimed a report
  // had been delivered even when Telegram refused it.
  // It must only ever be written inside markDelivered, never at the top of the
  // function where it used to run before anything was sent.
  const stampWrites = body.match(/lastReportTime = /g) || [];
  assert.strictEqual(
    stampWrites.length, 1,
    'lastReportTime must be written in exactly one place (markDelivered).',
  );
  const markDeliveredBody = (body.split('const markDelivered = () => {')[1] || '').split('};')[0];
  assert.ok(
    /lastReportTime = /.test(markDeliveredBody),
    'A report must not be marked delivered before Telegram accepts it.',
  );
  assert.ok(
    /markDelivered\(\); return;/.test(body),
    'Delivery must be recorded only on an ok response.',
  );

  // Every success path (album, photo, document, text, retries) must record it.
  assert.ok(
    !/\?\.ok\) return;/.test(body),
    'Every successful send path must mark the report as delivered.',
  );

  // The failure has to survive a restart and reach the panel.
  // Both verdicts must be persisted, or the panel loses them on restart.
  const markFailedBody = (body.split('const markFailed = (reason: string) => {')[1] || '').split('};')[0];
  assert.ok(
    /lastReportError = reason/.test(markFailedBody) && /saveSettings\(botSettings\)/.test(markFailedBody),
    'The delivery error must be persisted so the panel can show it.',
  );
  assert.ok(
    /saveSettings\(botSettings\)/.test(markDeliveredBody),
    'A successful report must persist that it cleared the error.',
  );
  const settingsUi = read('../src/components/BotSettings.tsx');
  assert.ok(
    /lastReportError/.test(settingsUi),
    'The panel must show why a group report failed.',
  );
  const types = read('../src/types.ts');
  assert.ok(/lastReportError\?: string/.test(types), 'ForumTopicConfig must carry the error.');
  console.log('✅ a failed group report is logged, stored and shown');
}

function testEveryMessageAndPaymentCarriesItsExactDate() {
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const typesSource = read('../src/types.ts');
  const serverSource = read('../server.ts');
  const supportSource = read('../src/components/SupportManager.tsx');
  const orderSource = read('../src/components/OrderManager.tsx');
  const customSource = read('../src/components/CustomPastryManager.tsx');
  const invoiceSource = read('../src/components/InvoiceManager.tsx');

  // Each moment of a payment is its own fact: when the customer sent the
  // receipt is not the same as when the shop reviewed it.
  assert.ok(
    /receiptSubmittedAt\?: string;/.test(typesSource),
    'An order must record when its receipt was submitted.',
  );
  assert.ok(
    /prepaymentRequestedAt\?: string;/.test(typesSource),
    'A custom order must record when the deposit was requested.',
  );

  // Recording has to actually happen on every path a receipt can arrive by.
  assert.ok(
    (serverSource.match(/receiptSubmittedAt = new Date\(\)\.toISOString\(\)/g) || []).length >= 2,
    'Every receipt upload path must stamp the submission time.',
  );
  assert.ok(
    /newOrder\.receiptSubmittedAt = newOrder\.receiptSubmittedAt \|\| new Date/.test(serverSource),
    'An order created with a receipt must stamp the submission time.',
  );
  assert.ok(
    /receiptSubmittedAt: now/.test(serverSource),
    'An invoice payment receipt must stamp the submission time.',
  );
  assert.ok(
    /order\.prepaymentRequestedAt = new Date\(\)\.toISOString\(\)/.test(serverSource),
    'Quoting a custom order must stamp when the deposit was requested.',
  );

  // The exact stamp has to be on screen, in the Iranian calendar and timezone.
  for (const [name, source] of [
    ['SupportManager', supportSource],
    ['OrderManager', orderSource],
    ['CustomPastryManager', customSource],
    ['InvoiceManager', invoiceSource],
  ] as Array<[string, string]>) {
    assert.ok(
      source.includes('formatIranianDateTime'),
      `${name} must render dates through the Iranian date formatter.`,
    );
  }

  // A bare clock time is ambiguous the moment a thread spans two days, which
  // is exactly what the ticket view used to show.
  assert.ok(
    /formatIranianDateTime\(reply\.createdAt\)/.test(supportSource),
    'Every ticket reply must show its own exact date.',
  );
  assert.ok(
    /formatIranianDateTime\(selectedTicket\.createdAt\)/.test(supportSource),
    'The opening ticket message must show its exact date.',
  );
  assert.ok(
    /formatIranianDateTime\(ticket\.createdAt\)/.test(supportSource),
    'The ticket list must show a date, not only a time.',
  );
  assert.ok(
    /formatIranianDateTime\(msg\.createdAt\)/.test(customSource),
    'Every custom-order chat message must show its exact date.',
  );
  // A bare clock time must not survive anywhere a message is shown.
  assert.ok(
    !/toLocaleTimeString/.test(supportSource) && !/toLocaleTimeString/.test(customSource),
    'Message timestamps must not rely on a bare clock time.',
  );
  // The customer sees dates too: in the bot's ticket list and in the reply.
  const handlersSource = read('../src/telegramHandlers.ts');
  assert.ok(
    /formatIranianDateTime\(ticket\.createdAt\)/.test(handlersSource),
    "The customer's ticket list in the bot must show an exact date.",
  );
  assert.ok(
    !/toLocaleDateString\('fa-IR'\)/.test(handlersSource),
    'The bot must not print a timezone-less date.',
  );
  assert.ok(
    /🕑 \$\{formatIranianDateTime\(newReply\.createdAt\)\}/.test(serverSource),
    'A support reply delivered to Telegram must carry its exact date.',
  );

  // Orders and payments must expose the whole lifecycle, not just creation.
  assert.ok(
    /formatIranianDateTime\(order\.receiptSubmittedAt\)/.test(orderSource)
      && /formatIranianDateTime\(order\.receiptReviewedAt\)/.test(orderSource),
    'An order must show when its receipt arrived and when it was reviewed.',
  );
  assert.ok(
    /formatIranianDateTime\(order\.prepaymentRequestedAt\)/.test(customSource)
      && /formatIranianDateTime\(order\.prepaymentSubmittedAt\)/.test(customSource)
      && /formatIranianDateTime\(order\.prepaymentReviewedAt\)/.test(customSource),
    'A custom order must show the whole deposit timeline.',
  );
  assert.ok(
    /formatIranianDateTime\(payment\.receiptSubmittedAt\)/.test(invoiceSource),
    'An invoice payment must show when its receipt was submitted.',
  );

  // formatDatePersian has no timezone, so it can name the wrong day in Tehran.
  assert.ok(
    !/formatDatePersian/.test(orderSource),
    'Order dates must use the timezone-aware Iranian formatter.',
  );

  console.log('✅ messages, orders, receipts and payments all carry an exact date');
}

function testSingleCustomerMessageIsNotReportedAsABroadcast() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  const routeStart = serverSource.indexOf("app.post('/api/telegram/broadcast'");
  assert.ok(routeStart !== -1, 'The broadcast route must exist.');
  const route = serverSource.slice(routeStart, serverSource.indexOf('app.', routeStart + 40));

  // Messaging one customer from the panel used to be logged in the group as
  // "ارسال پیام گروهی", which read as if every customer had been contacted.
  assert.ok(
    /recipients\.length === 1/.test(route),
    'The report must distinguish a single recipient from a real broadcast.',
  );
  assert.ok(
    route.includes('ارسال پیام به مشتری'),
    'Messaging one customer must be reported as a message to that customer.',
  );
  assert.ok(
    route.includes('ارسال پیام گروهی'),
    'A real broadcast must still be reported as a broadcast.',
  );

  // The single-recipient report should name the customer rather than repeat an
  // audience label, and must not claim success when nothing was delivered.
  const singleBranch = route.slice(route.indexOf('const isSingleRecipient'));
  assert.ok(
    /👤 مشتری: \$\{escapeTelegramHtml\(recipients\[0\]\.name/.test(singleBranch),
    'The single-recipient report must name the customer.',
  );
  assert.ok(
    /sentCount \? '✅ ارسال شد' : '⚠️ ارسال نشد'/.test(singleBranch),
    'A failed single send must not be reported as delivered.',
  );

  console.log('✅ messaging one customer is not logged as a group broadcast');
}

function testJustUploadedPicturePreviewsImmediately() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // The public image route only serves files a product or ticket already
  // points at. A picture the admin just picked is attached to nothing yet, so
  // without an explicit allowance its preview thumbnail 404s and the panel
  // shows a broken image instead of the scaled-down picture.
  assert.ok(
    /rememberUploadedImage\(filename\);/.test(serverSource),
    'A freshly uploaded picture must be recorded so it can be previewed.',
  );

  const routeStart = serverSource.indexOf('const servePublicProductImage =');
  const routeEnd = serverSource.indexOf("app.get('/product-images/:filename'", routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.ok(routeStart !== -1 && routeEnd > routeStart, 'The image route must exist.');
  assert.ok(
    /isRecentlyUploadedImage\(filename\)/.test(route),
    'The image route must serve a picture that was just uploaded.',
  );

  // It must stay private: only the signed-in admin may see an unattached file,
  // otherwise this turns into an open file host.
  assert.ok(
    /isRecentlyUploadedImage\(filename\)\s*&&\s*!!getPanelSession\(req\)/.test(route),
    'An unattached picture must only be served to a signed-in panel session.',
  );

  // The allowance has to expire rather than growing without bound.
  assert.ok(
    /RECENT_UPLOAD_TTL_MS/.test(serverSource)
      && /now - storedAt > RECENT_UPLOAD_TTL_MS/.test(serverSource),
    'The pending-upload allowance must expire.',
  );

  console.log('✅ a just-uploaded picture previews as a thumbnail right away');
}

function testShopAttachedImagesAreReachable() {
  const serverSource = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // The public route served product photos only, so a ticket image 404'd.
  // Checked independently of formatting: both owners must be consulted.
  assert.ok(
    /isReferencedProductImage\(filename, route\)/.test(serverSource)
      && /isReferencedTicketImage\(filename, route\)/.test(serverSource),
    'Images attached to a ticket must be served, not only product photos.',
  );

  // Storing an absolute URL freezes the host the admin happened to be on.
  const uploadRoute = serverSource.slice(serverSource.indexOf("app.post('/api/upload-image'")).slice(0, 2000);
  assert.ok(
    uploadRoute.includes('url: `/product-images/'),
    'An upload must be stored as a relative path, not a host-specific URL.',
  );
  assert.doesNotMatch(
    uploadRoute,
    /\$\{protocol\}:\/\/\$\{host\}/,
    'The stored path must not bake in the request host.',
  );

  // Telegram cannot fetch a relative path or a loopback address.
  assert.ok(
    serverSource.includes('function toPubliclyFetchableUrl'),
    'A relative path must be resolved before it is handed to Telegram.',
  );
  assert.ok(
    /localhost|127\\./.test(serverSource.slice(serverSource.indexOf('function toPubliclyFetchableUrl')).slice(0, 1600)),
    'A loopback host must be rejected instead of sent to Telegram as a dead link.',
  );
  assert.ok(
    serverSource.includes('const sendLocalPhoto ='),
    'Without a public host the bytes must be uploaded to Telegram directly.',
  );

  // The repair must run after the filename constants exist; a `const` is in its
  // temporal dead zone earlier and the helper's catch swallowed the error.
  const repairCallIndex = serverSource.indexOf('relativiseStoredTicketImages();');
  const patternIndex = serverSource.indexOf('const PRODUCT_IMAGE_FILENAME_PATTERN');
  assert.ok(repairCallIndex > patternIndex, 'The image repair must run after its constants are initialised.');

  console.log('✅ shop-attached images are reachable by the panel and Telegram');
}

function testUploadsReportTheirProgress() {
  const helperSource = fs.readFileSync(
    new URL('../src/utils/uploadWithProgress.ts', import.meta.url),
    'utf8',
  );
  const barSource = fs.readFileSync(
    new URL('../src/components/UploadProgressBar.tsx', import.meta.url),
    'utf8',
  );

  // fetch() cannot report upload progress at all; only XHR exposes the bytes
  // that have actually left the browser.
  assert.ok(
    helperSource.includes('new XMLHttpRequest()'),
    'The upload must use XMLHttpRequest so progress can be measured.',
  );
  assert.ok(
    /request\.upload\.onprogress\s*=/.test(helperSource),
    'The upload must subscribe to the progress event.',
  );
  assert.ok(
    /event\.loaded\s*\/\s*event\.total/.test(helperSource),
    'Progress must be computed from the bytes actually sent.',
  );
  assert.ok(
    helperSource.includes('event.lengthComputable'),
    'A progress event without a known total must not be trusted.',
  );
  // A batch must be weighted by size, otherwise the bar jumps around.
  assert.ok(
    /totalBytes\s*=\s*blobs\.reduce/.test(helperSource),
    'A multi-picture upload must weight progress by byte size.',
  );
  assert.ok(
    /finally\s*\{[\s\S]{0,120}onProgress\(null\)/.test(helperSource),
    'The progress must be cleared when the upload finishes or fails.',
  );

  // The measured value has to reach the screen as a real bar.
  assert.ok(
    /role="progressbar"[\s\S]{0,400}aria-valuenow=\{progress\.percent\}/.test(barSource),
    'The progress must be exposed as an accessible progressbar.',
  );
  assert.ok(
    /style=\{\{ width: `\$\{progress\.percent\}%` \}\}/.test(barSource),
    'The bar width must follow the real percentage.',
  );
  assert.ok(
    barSource.includes('باقی مانده است'),
    'The panel must also say how much of the upload is left.',
  );

  // Every place the panel uploads a picture must show the bar; the product
  // pictures are the ones the shop uploads most often.
  const uploadScreens: Array<[string, string]> = [
    [
      'src/components/SupportManager.tsx',
      fs.readFileSync(new URL('../src/components/SupportManager.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/ProductManager.tsx',
      fs.readFileSync(new URL('../src/components/ProductManager.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/AddProductModal.tsx',
      fs.readFileSync(new URL('../src/components/AddProductModal.tsx', import.meta.url), 'utf8'),
    ],
  ];
  for (const [name, source] of uploadScreens) {
    assert.ok(
      source.includes('<UploadProgressBar'),
      `${name} uploads pictures, so it must show the progress bar.`,
    );
    assert.ok(
      /uploadImagesWithProgress\(/.test(source),
      `${name} must upload through the progress-reporting helper.`,
    );
    assert.ok(
      !/fetch\(\s*['"]\/api\/upload-image/.test(source),
      `${name} must not upload through fetch, which cannot report progress.`,
    );
  }

  console.log('✅ every picture upload in the panel shows a real percentage');
}

function testShopNameComesFromSettingsEverywhere() {
  const files: Array<[string, string]> = [
    ['server.ts', fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8')],
    [
      'src/telegramHandlers.ts',
      fs.readFileSync(new URL('../src/telegramHandlers.ts', import.meta.url), 'utf8'),
    ],
    ['src/App.tsx', fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')],
    [
      'src/components/SupportManager.tsx',
      fs.readFileSync(new URL('../src/components/SupportManager.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/BotSettings.tsx',
      fs.readFileSync(new URL('../src/components/BotSettings.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/BackupManager.tsx',
      fs.readFileSync(new URL('../src/components/BackupManager.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/BotTextsCustomizer.tsx',
      fs.readFileSync(new URL('../src/components/BotTextsCustomizer.tsx', import.meta.url), 'utf8'),
    ],
    [
      'src/components/TelegramSimulator.tsx',
      fs.readFileSync(new URL('../src/components/TelegramSimulator.tsx', import.meta.url), 'utf8'),
    ],
  ];

  // No file may ship the old shop name: renaming the shop in the panel has to
  // rename it everywhere, including in messages the customer receives.
  for (const [name, source] of files) {
    assert.ok(
      !source.includes('شیرین‌کام') && !source.includes('شیرین کام'),
      `${name} must not hardcode the shop name; read it from the settings instead.`,
    );
    assert.ok(
      !/['"`]مدیریت قنادی['"`]/.test(source) && !/['"`]سرقناد قنادی['"`]/.test(source),
      `${name} must not hardcode the shop's signature; derive it from the settings.`,
    );
  }

  const serverSource = files[0][1];
  // A single accessor keeps the fallback in one place.
  assert.ok(
    /function storeName\(\): string \{[\s\S]{0,200}botSettings\.storeName/.test(serverSource),
    'The server must read the shop name from the saved settings.',
  );
  assert.ok(
    /function shopSenderName\(\): string \{[\s\S]{0,160}storeName\(\)/.test(serverSource),
    'The signature the shop replies with must be built from the configured name.',
  );
  // An unset name must still produce a sane message rather than "undefined".
  assert.ok(
    /botSettings\.storeName \|\| ''\)\.trim\(\) \|\| '[^']+'/.test(serverSource),
    'A blank shop name must fall back to a readable default.',
  );
  assert.ok(
    !/senderName:\s*'[^']*قناد/.test(serverSource),
    'Ticket and order replies must be signed with the configured name.',
  );
  assert.ok(
    serverSource.includes('senderName: shopSenderName()'),
    'The shop must sign its own messages through the shared helper.',
  );

  const handlersSource = files[1][1];
  assert.ok(
    /function storeNameOf\(ctx: \{ botSettings\?: any \}\): string/.test(handlersSource),
    'The bot handlers must resolve the shop name from their context.',
  );
  assert.ok(
    /storeNameOf\(ctx\)/.test(handlersSource),
    'The bot handlers must use the resolved shop name in their messages.',
  );

  const supportManagerSource = files[3][1];
  assert.ok(
    /shopSenderName\s*=\s*`مدیریت \$\{botSettings\?\.storeName/.test(supportManagerSource),
    'The panel must sign replies with the configured shop name.',
  );
  assert.ok(
    supportManagerSource.includes('onReplyTicket(selectedTicket.id, replyInput.trim(), shopSenderName'),
    'The reply must be sent under the configured shop name.',
  );

  // Regression: keying the settings load off storeName threw away every other
  // setting whenever the shop name was blank.
  const appSource = files[2][1];
  assert.ok(
    !appSource.includes('if (sett && sett.storeName) setBotSettings(sett)'),
    'Saved settings must not be discarded when the shop name is empty.',
  );
  assert.ok(
    /if \(sett && typeof sett === 'object' && !Array\.isArray\(sett\)\) setBotSettings\(sett\)/.test(
      appSource,
    ),
    'Any saved settings object must be applied.',
  );

  console.log('✅ the shop name comes from the panel settings everywhere');
}

async function main() {
  testTelegramImageResolver();
  testSingleProfilePerTelegramAccountAndAddressBook();
  await testTicketUsesTelegramAccountAndKnownPhone();
  await testTicketDoesNotInventPhoneAndPhotoReplyKeepsFileIdContract();
  await testCheckoutPersistsTelegramProfileOnOrder();
  await testCheckoutAlwaysOffersDiscountStepAndAppliesCode();
  await testBotAdminActionsReportToForumTopics();
  await testInvoicePaymentLifecycleReportsToFinanceTopic();
  await testMultiPhotoReportsAreSentAsAlbums();
  await testRequiredChannelJoinGate();
  await testRequiredChannelMessagesAreDistinctAndCustomizable();
  await testDataFileSurvivesACrashDuringWrite();
  await testCorruptedDataFileFallsBackToABackup();
  await testClickableControlsShowAHandCursor();
  await testEveryRoutedCheckoutCallbackIsHandled();
  await testBroadcastAudienceTargeting();
  await testBroadcastCanStartAReplyableConversation();
  await testTicketThreadKeepsEveryMessageAndItsRealSender();
  testSupportMessagesKeepEveryAttachedPhoto();
  testAdminCanReplyWithSeveralPhotosAndBrowseThem();
  testShopAttachedImagesAreReachable();
  testJustUploadedPicturePreviewsImmediately();
  testSingleCustomerMessageIsNotReportedAsABroadcast();
  testEveryMessageAndPaymentCarriesItsExactDate();
  testGroupReportsNeverFailSilently();
  testAMessageToCustomersIsSignedByTheShop();
  testDeployBuildsTheAppExactlyOnce();
  testUploadsReportTheirProgress();
  testShopNameComesFromSettingsEverywhere();
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
