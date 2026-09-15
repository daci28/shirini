import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { 
  INITIAL_PRODUCTS, 
  INITIAL_BOT_SETTINGS, 
  INITIAL_ORDERS, 
  INITIAL_DISCOUNT_CODES, 
  INITIAL_SUPPORT_TICKETS,
  INITIAL_CUSTOMERS,
  INITIAL_WALLET_TRANSACTIONS,
  INITIAL_BACKUP_SCHEDULE,
  INITIAL_BACKUP_SNAPSHOTS,
  INITIAL_CUSTOM_ORDERS,
  INITIAL_FORUM_TOPICS
} from './src/data/initialData';
import { 
  Product, 
  Order, 
  OrderStatus,
  BotSettings, 
  DiscountCode, 
  SupportTicket, 
  CustomerUser, 
  WalletTransaction, 
  BackupScheduleConfig, 
  BackupSnapshot, 
  MasterBackupPayload,
  BackupSnapshotStats,
  CustomPastryOrder,
  CustomPastryStatus,
  Invoice,
  InvoiceItem,
  InvoicePayment,
  InvoicePaymentMethod,
  InvoicePaymentStatus,
  InvoiceStatus,
  ForumTopicKey,
  ForumTopicConfig
} from './src/types';
import { handleCustomerCallback, handleAdminCallback, handleTextMessage, handleAdminCatSelect } from './src/telegramHandlers';
import { loadSettings, saveSettings } from './src/persistSettings';
import { PersistentMap } from './src/persistStates';
import { startCheckout, handleCheckoutState, handleCheckoutCallback } from './src/checkoutFlow';
import { resolveUniqueOrderNumber } from './src/utils/orderNumber';
import { DATA_DIR, loadData, saveData, PersistedData } from './src/persistData';
import { getPanelCredentials, omitPanelPassword } from './src/utils/panelAuth';
import { getIranianPersianDate, normalizeIranianDeliveryDate, normalizeIranianDeliveryTime, formatIranianDeliveryDate, formatIranianDeliveryTime } from './src/utils/iranianDate';
import { escapeTelegramHtml, formatCustomOrderTrackingMessage } from './src/utils/customOrderTracking';
import {
  buildAllInvoices,
  calculateInvoiceAmounts,
  getCustomPrepaymentStatus,
  resolveManualInvoiceStatus,
} from './src/utils/invoices';
import { getBotText, renderBotText, BOT_MESSAGE_LIST } from './src/data/botMessages';
import { upsertBotCustomer, findBotCustomer, isRealName, dedupeCustomers } from './src/utils/customers';

// The admin UI is authenticated by an HttpOnly server session — never by a
// browser-local flag. Settings stay on Railway's mounted data volume, while
// sessions intentionally expire on restart or after twelve hours.
const PANEL_SESSION_COOKIE = 'shirini_panel_session';
const PANEL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

interface PanelSession {
  username: string;
  expiresAt: number;
}

interface LoginAttempt {
  failures: number;
  firstFailureAt: number;
}

const panelSessions = new Map<string, PanelSession>();
const panelLoginAttempts = new Map<string, LoginAttempt>();

const parseCookies = (header?: string): Record<string, string> => {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
    return cookies;
  }, {});
};

const safeCredentialEqual = (received: string, expected: string): boolean => {
  // Compare fixed-length hashes so a malformed or short input does not skip the
  // timing-safe comparison used for panel credentials.
  const receivedHash = crypto.createHash('sha256').update(received).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(receivedHash, expectedHash);
};

interface SecurePanelSettings extends BotSettings {
  /** Scrypt hash persisted instead of a plaintext web-admin password. */
  webAdminPasswordHash?: string;
}

const hashPanelPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const digest = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${digest}`;
};

const matchesStoredPanelPassword = (password: string, settings: SecurePanelSettings): boolean => {
  const storedHash = settings.webAdminPasswordHash;
  if (!storedHash) return safeCredentialEqual(password, getPanelCredentials(settings).password);

  const [algorithm, salt, expectedDigest] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedDigest) return false;
  try {
    const expected = Buffer.from(expectedDigest, 'base64url');
    const received = crypto.scryptSync(password, salt, expected.length);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
};

const getRequestIp = (req: Request): string => req.ip || req.socket.remoteAddress || 'unknown';

const isSecurePanelRequest = (req: Request): boolean => {
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return req.secure || forwardedProtocol === 'https' || process.env.NODE_ENV === 'production';
};

const clearExpiredPanelSessions = () => {
  const now = Date.now();
  for (const [token, session] of panelSessions) {
    if (session.expiresAt <= now) panelSessions.delete(token);
  }
};

const issuePanelSession = (req: Request, res: Response, username: string): void => {
  clearExpiredPanelSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  panelSessions.set(token, { username, expiresAt: Date.now() + PANEL_SESSION_TTL_MS });
  res.cookie(PANEL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecurePanelRequest(req),
    sameSite: 'strict',
    path: '/',
    maxAge: PANEL_SESSION_TTL_MS,
  });
};

const clearPanelSessionCookie = (req: Request, res: Response): void => {
  res.clearCookie(PANEL_SESSION_COOKIE, {
    httpOnly: true,
    secure: isSecurePanelRequest(req),
    sameSite: 'strict',
    path: '/',
  });
};

const getPanelSession = (req: Request): PanelSession | null => {
  clearExpiredPanelSessions();
  const token = parseCookies(req.headers.cookie)[PANEL_SESSION_COOKIE];
  if (!token) return null;
  return panelSessions.get(token) || null;
};

const requirePanelAuth = (req: Request, res: Response, next: NextFunction): void => {
  const session = getPanelSession(req);
  if (!session) {
    res.status(401).json({ error: 'برای دسترسی به پنل ابتدا وارد شوید.' });
    return;
  }
  next();
};

const isLoginRateLimited = (ip: string): boolean => {
  const attempt = panelLoginAttempts.get(ip);
  if (!attempt) return false;
  if (Date.now() - attempt.firstFailureAt > LOGIN_WINDOW_MS) {
    panelLoginAttempts.delete(ip);
    return false;
  }
  return attempt.failures >= MAX_LOGIN_FAILURES;
};

const recordLoginFailure = (ip: string): void => {
  const previous = panelLoginAttempts.get(ip);
  if (!previous || Date.now() - previous.firstFailureAt > LOGIN_WINDOW_MS) {
    panelLoginAttempts.set(ip, { failures: 1, firstFailureAt: Date.now() });
    return;
  }
  panelLoginAttempts.set(ip, { ...previous, failures: previous.failures + 1 });
};

// In-memory data store with complete seed
let products: Product[] = [...INITIAL_PRODUCTS];
let orders: Order[] = [...INITIAL_ORDERS];
let discounts: DiscountCode[] = [...INITIAL_DISCOUNT_CODES];
let botSettings: SecurePanelSettings = { ...INITIAL_BOT_SETTINGS };
// Load persisted settings if available
const persistedSettings = loadSettings();
if (persistedSettings) {
  botSettings = { ...botSettings, ...persistedSettings };
  console.log("Loaded persisted bot settings");
}

// Ensure all 8 forum topics are always populated in botSettings
const existingTopicKeys = new Set((botSettings.forumTopics || []).map((t) => t.key));
const mergedForumTopics: ForumTopicConfig[] = [
  ...(botSettings.forumTopics || []),
  ...INITIAL_FORUM_TOPICS.filter((t) => !existingTopicKeys.has(t.key)),
];
botSettings.forumTopics = mergedForumTopics;

// Migrate installations that stored the configurable panel password in
// plaintext and hash the documented initial admin/admin credential on first
// launch. Future reads/persists use only scrypt material; no plaintext password
// is put in the browser settings seed or returned from the API.
if (!botSettings.webAdminPasswordHash) {
  botSettings.webAdminPasswordHash = hashPanelPassword(getPanelCredentials(botSettings).password);
  delete botSettings.webAdminPassword;
}
saveSettings(botSettings);
let supportTickets: SupportTicket[] = [...INITIAL_SUPPORT_TICKETS];
let customers: CustomerUser[] = [...INITIAL_CUSTOMERS];
let walletTransactions: WalletTransaction[] = [...INITIAL_WALLET_TRANSACTIONS];
let backupSchedule: BackupScheduleConfig = { ...INITIAL_BACKUP_SCHEDULE };
let backupSnapshots: BackupSnapshot[] = [...INITIAL_BACKUP_SNAPSHOTS];
let customOrders: CustomPastryOrder[] = [...INITIAL_CUSTOM_ORDERS];
/** Only standalone/manual invoices live here; order invoices are derived safely on read. */
let invoices: Invoice[] = [];

/**
 * Resolve a customer-facing bot message from the admin's text customizations,
 * falling back to the built-in Persian default.
 */
function tmsg(key: Parameters<typeof getBotText>[1], vars: Parameters<typeof getBotText>[2] = {}): string {
  return getBotText(botSettings as any, key, vars);
}

/** Telegram's callback data is user-controlled; only configured IDs may use admin actions. */
function isTelegramAdmin(chatId: string): boolean {
  const configuredAdminIds = [
    botSettings.adminTelegramId,
    ...(Array.isArray(botSettings.adminTelegramIds) ? botSettings.adminTelegramIds : []),
  ]
    .filter((id): id is string => id !== undefined && id !== null && String(id).trim() !== '')
    .map((id) => String(id).trim());
  return configuredAdminIds.includes(String(chatId).trim());
}

/** Prefer the Railway secret and never copy it into browser-visible settings. */
function getTelegramBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || botSettings.telegramBotToken || '').trim();
}

function getPublicPanelSettings() {
  return {
    ...omitPanelPassword(botSettings),
    hasTelegramBotToken: Boolean(getTelegramBotToken()),
  };
}

/** Backup imports must not be able to replace authentication or bot secrets. */
function omitSettingsSecrets(settings: unknown): Partial<SecurePanelSettings> {
  if (!settings || typeof settings !== 'object') return {};
  const safeSettings = { ...(settings as Record<string, unknown>) };
  delete safeSettings.webAdminPassword;
  delete safeSettings.webAdminPasswordHash;
  delete safeSettings.telegramBotToken;
  delete safeSettings.hasTelegramBotToken;
  return safeSettings as Partial<SecurePanelSettings>;
}

/** Older snapshots may contain secrets; redact them before they ever reach a client. */
function redactBackupSnapshot(snapshot: BackupSnapshot): BackupSnapshot {
  const copied = JSON.parse(JSON.stringify(snapshot)) as BackupSnapshot;
  if (copied.payload?.data?.botSettings) {
    copied.payload.data.botSettings = omitPanelPassword(copied.payload.data.botSettings) as BotSettings;
  }
  return copied;
}

// Load persisted data if available
const persistedData = loadData();
if (persistedData) {
  products = persistedData.products || products;
  orders = persistedData.orders || orders;
  customOrders = persistedData.customOrders || customOrders;
  invoices = Array.isArray(persistedData.invoices)
    ? persistedData.invoices.filter((invoice: Invoice) => invoice?.source === 'manual')
    : invoices;
  discounts = persistedData.discounts || discounts;
  supportTickets = persistedData.supportTickets || supportTickets;
  customers = persistedData.customers || customers;
  customers = dedupeCustomers(customers);
  walletTransactions = persistedData.walletTransactions || walletTransactions;
  backupSnapshots = (persistedData.backupSnapshots || backupSnapshots).map(redactBackupSnapshot);
  backupSchedule = persistedData.backupSchedule || backupSchedule;
  console.log("Loaded persisted data");
}

// Helper to save all data
function saveAllData() {
  saveData({
    products,
    orders,
    customOrders,
    invoices,
    discounts,
    supportTickets,
    customers,
    walletTransactions,
    backupSnapshots,
    backupSchedule
  });
}

// Product photos need a public, stable URL because Telegram fetches a `photo`
// URL from its own servers without the administrator's browser session. Keep
// them separate from protected customer uploads and application data.
const PRODUCT_IMAGE_DIR = path.join(DATA_DIR, 'product-images');
const PRODUCT_IMAGE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|gif|jpe?g|png|webp)$/i;

// Telegram file IDs are opaque and are only useful through the Bot API. Cache
// the downloaded bytes on Railway's persistent volume so opening a receipt (or
// zooming it) does not repeatedly wait for Telegram on every panel visit.
const TELEGRAM_FILE_CACHE_DIR = path.join(DATA_DIR, 'telegram-file-cache');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}
interface CachedTelegramFile {
  buffer: Buffer;
  contentType: string;
}

function telegramFileCachePaths(fileId: string): { filePath: string; metadataPath: string } {
  const cacheKey = crypto.createHash('sha256').update(fileId).digest('hex');
  return {
    filePath: path.join(TELEGRAM_FILE_CACHE_DIR, `${cacheKey}.bin`),
    metadataPath: path.join(TELEGRAM_FILE_CACHE_DIR, `${cacheKey}.json`),
  };
}

const TELEGRAM_SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

function safeTelegramImageContentType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
  return TELEGRAM_SUPPORTED_IMAGE_TYPES.has(normalized) ? normalized : 'image/jpeg';
}

/**
 * Receipts are normally Telegram photos, but mobile customers sometimes send
 * the same JPEG/PNG/WebP as a file. Accept only raster image documents too;
 * PDFs and arbitrary documents are intentionally not fed into an <img> viewer.
 */
function getTelegramImageFileId(message: any): string | null {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const photoFileId = photos.length > 0 ? String(photos[photos.length - 1]?.file_id || '').trim() : '';
  if (photoFileId) return photoFileId;

  const document = message?.document;
  const documentFileId = typeof document?.file_id === 'string' ? document.file_id.trim() : '';
  const documentMimeType = typeof document?.mime_type === 'string' ? document.mime_type.toLowerCase() : '';
  const documentFileName = typeof document?.file_name === 'string' ? document.file_name : '';
  const hasSupportedImageExtension = /\.(?:avif|gif|jpe?g|png|webp)$/i.test(documentFileName);
  return documentFileId && (TELEGRAM_SUPPORTED_IMAGE_TYPES.has(documentMimeType) || hasSupportedImageExtension)
    ? documentFileId
    : null;
}

function readCachedTelegramFile(fileId: string): CachedTelegramFile | null {
  try {
    const { filePath, metadataPath } = telegramFileCachePaths(fileId);
    if (!fs.existsSync(filePath)) return null;
    let contentType = 'image/jpeg';
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { contentType?: unknown };
      contentType = safeTelegramImageContentType(metadata.contentType);
    }
    return { buffer: fs.readFileSync(filePath), contentType };
  } catch (error) {
    // A bad or interrupted cache entry must never prevent an on-demand
    // Telegram retrieval. A fresh response below will repair it.
    console.warn('Unable to read cached Telegram file:', error);
    return null;
  }
}

function cacheTelegramFile(fileId: string, buffer: Buffer, contentType: string): void {
  try {
    fs.mkdirSync(TELEGRAM_FILE_CACHE_DIR, { recursive: true });
    const { filePath, metadataPath } = telegramFileCachePaths(fileId);
    const nonce = crypto.randomBytes(8).toString('hex');
    const temporaryFilePath = `${filePath}.${nonce}.tmp`;
    const temporaryMetadataPath = `${metadataPath}.${nonce}.tmp`;
    fs.writeFileSync(temporaryFilePath, buffer);
    fs.writeFileSync(temporaryMetadataPath, JSON.stringify({ contentType: safeTelegramImageContentType(contentType) }));
    fs.renameSync(temporaryFilePath, filePath);
    fs.renameSync(temporaryMetadataPath, metadataPath);
  } catch (error) {
    // Serving a real Telegram response is more important than caching it; the
    // next request can simply retry the cache write.
    console.warn('Unable to cache Telegram file:', error);
  }
}

type PublicProductImageRoute = 'product-images' | 'data';

function safeProductImageFilename(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const filename = decodeURIComponent(value.trim());
    return PRODUCT_IMAGE_FILENAME_PATTERN.test(filename) ? filename : null;
  } catch {
    return null;
  }
}

function productImageFilename(reference: unknown, expectedRoute: PublicProductImageRoute): string | null {
  if (typeof reference !== 'string' || !reference.trim()) return null;
  try {
    const pathname = new URL(reference.trim(), 'https://local.invalid').pathname;
    const prefix = expectedRoute === 'product-images' ? '/product-images/' : '/data/';
    if (!pathname.startsWith(prefix)) return null;
    return safeProductImageFilename(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function isReferencedProductImage(filename: string, route: PublicProductImageRoute): boolean {
  return products.some((product) => {
    const references = [product.image, ...(Array.isArray(product.images) ? product.images : [])];
    return references.some((reference) => productImageFilename(reference, route) === filename);
  });
}

function getTelegramProfile(telegramUser?: any): { username?: string; displayName?: string } {
  const fullName = [telegramUser?.first_name, telegramUser?.last_name].filter(Boolean).join(' ').trim();
  return {
    username: telegramUser?.username || undefined,
    displayName: fullName || telegramUser?.username || undefined,
  };
}

/**
 * Validates the customer details needed before a custom-order payment step.
 * Delivery date and time are intentionally optional: a customer can arrange
 * them later with the workshop without blocking registration or payment.
 */
function hasCompleteCustomOrderDelivery(order: CustomPastryOrder): boolean {
  const required = [order.customerName, order.customerPhone];
  if (order.deliveryType !== 'pickup') required.push(order.deliveryAddress || '');
  return required.every((value) => typeof value === 'string' && value.trim().length > 0);
}

function isValidCustomPrepaymentDecision(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function canAdvanceCustomOrderToProduction(order: CustomPastryOrder): boolean {
  // Old paid records did not have a review status; `isPrepaymentPaid` is
  // deliberately honoured by the compatibility helper. An unquoted order has
  // no deposit requirement yet, however, so it can never be treated as paid.
  const prepaymentStatus = getCustomPrepaymentStatus(order);
  return prepaymentStatus === 'approved'
    || (prepaymentStatus === 'not_required' && order.paymentMethod === 'cash_on_delivery');
}

/** Keep the customer directory in sync when a custom-order customer finishes contact details. */
function upsertCustomerFromCustomOrder(order: CustomPastryOrder): void {
  if (!order.customerTelegramId) return;
  // Single profile per Telegram account: the central helper enriches the
  // existing record and keeps an address book of all provided addresses.
  upsertBotCustomer(customers, {
    telegramId: order.customerTelegramId,
    name: order.customerName || order.customerTelegramName,
    phone: order.customerPhone || '',
    username: order.customerUsername || '',
    address: order.deliveryAddress || '',
    source: 'bot',
    // customerName is typed by the customer during registration; the Telegram
    // display-name fallback (customerTelegramName) is only a hint.
    nameConfirmed: Boolean(order.customerName && order.customerName.trim()),
  });
}

// Older bot tickets were created before Telegram profile details were passed to
// the callback handler. Enrich only generic/empty fields from an existing
// customer record while leaving manually entered ticket details intact.
function hydrateLegacyTicketCustomers(): boolean {
  let changed = false;
  const genericNames = new Set(['', 'مشتری ربات', 'مشتری جدید', 'مشتری']);

  supportTickets.forEach((ticket) => {
    const customer = customers.find(
      (item) => String(item.telegramId) === String(ticket.customerTelegramId)
    );
    if (!customer) return;

    if (genericNames.has(String(ticket.customerName || '').trim()) && customer.name) {
      ticket.customerName = customer.name;
      changed = true;
    }
    if (!ticket.customerUsername && customer.username) {
      ticket.customerUsername = customer.username;
      changed = true;
    }
    if (!ticket.customerPhone && customer.phone) {
      ticket.customerPhone = customer.phone;
      changed = true;
    }
    ticket.replies?.forEach((reply) => {
      if (reply.sender === 'customer' && genericNames.has(String(reply.senderName || '').trim()) && ticket.customerName) {
        reply.senderName = ticket.customerName;
        changed = true;
      }
    });
  });

  return changed;
}

if (hydrateLegacyTicketCustomers()) {
  saveAllData();
  console.log('Enriched legacy support ticket customer details');
}

// Polling controller for Live Telegram Bot
let isPolling = false;
let pollingOffset = 0;
let pollingInterval: NodeJS.Timeout | null = null;
const registeredTelegramChatIds = new Set<string>();

// Per-user cart sessions (chatId -> cart items)
interface CartItem { productId: string; quantity: number; }
const userCarts = new PersistentMap<CartItem[]>("userCarts.json");
// Per-user state machine (for multi-step flows)
const userStates = new PersistentMap<any>("userStates.json");

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  // Unique id for THIS running process. If logs show two different ids polling
  // the same token, there are two live instances (the 409 cause).
  const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
  console.log(`[instance:${INSTANCE_ID}] starting server pid=${process.pid}`);

  // Railway terminates TLS before forwarding requests to the app. Trust that
  // single proxy so secure cookies work both on Railway and in local development.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // --- Public health and authentication routes ---
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      build: 'admin-manager-v8-topics',
      instanceId: INSTANCE_ID,
      botPolling: isPolling,
      hasBotToken: Boolean(getTelegramBotToken()),
      productsCount: Array.isArray(products) ? products.length : 0,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const session = getPanelSession(req);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.username, expiresAt: session.expiresAt });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const ip = getRequestIp(req);
    if (isLoginRateLimited(ip)) {
      res.status(429).json({ error: 'تعداد تلاش‌های ناموفق زیاد است. چند دقیقه دیگر دوباره تلاش کنید.' });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const configured = getPanelCredentials(botSettings);
    const isValid = Boolean(username && password) &&
      safeCredentialEqual(username, configured.username) &&
      matchesStoredPanelPassword(password, botSettings);

    if (!isValid) {
      recordLoginFailure(ip);
      res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      return;
    }

    panelLoginAttempts.delete(ip);
    issuePanelSession(req, res, configured.username);
    botSettings.webAdminLastLogin = new Date().toISOString();
    saveSettings(botSettings);
    res.json({ authenticated: true, username: configured.username });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = parseCookies(req.headers.cookie)[PANEL_SESSION_COOKIE];
    if (token) panelSessions.delete(token);
    clearPanelSessionCookie(req, res);
    res.status(204).end();
  });

  const servePublicProductImage = (
    route: PublicProductImageRoute,
    allowProtectedFallback: boolean,
  ) => (req: Request, res: Response, next: NextFunction) => {
    const filename = safeProductImageFilename(req.params.filename);
    if (!filename || !isReferencedProductImage(filename, route)) {
      if (allowProtectedFallback) return next();
      res.status(404).end();
      return;
    }

    const imageDirectory = route === 'product-images' ? PRODUCT_IMAGE_DIR : DATA_DIR;
    const imagePath = path.join(imageDirectory, filename);
    if (!fs.existsSync(imagePath)) {
      res.status(404).end();
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(imagePath, (error) => {
      if (!error) return;
      const statusCode = (error as Error & { statusCode?: number }).statusCode || 404;
      if (!res.headersSent) res.status(statusCode).end();
    });
  };

  // Telegram Bot API cannot send the admin's HttpOnly cookie when it fetches a
  // photo URL. New product uploads use this intentionally public, product-only
  // route; customer/private files remain behind /data authentication.
  app.get('/product-images/:filename', servePublicProductImage('product-images', false));
  // Continue serving product images saved by earlier deployments at /data, but
  // only if the exact file is referenced by a catalog product.
  app.get('/data/:filename', servePublicProductImage('data', true));

  // Every remaining API route and uploaded customer/private image requires a
  // valid server-side session. The SPA itself can still load the login screen.
  app.use('/api', requirePanelAuth);
  app.use('/data', requirePanelAuth);

  // Commit successful data mutations at the end of every protected request.
  // The periodic backup remains a safety net, but a Railway restart immediately
  // after an edit must not lose the last product/order/customer update.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.once('finish', () => {
        if (res.statusCode < 400) saveAllData();
      });
    }
    next();
  });

  // --- Protected API Routes ---

  // Get all products
  app.get('/api/products', (req: Request, res: Response) => {
    res.json(products);
  });

  // Add new product
  // Product image upload endpoint. Files go to a catalog-only directory so
  // Telegram can fetch their public URL while customer/private files remain
  // protected under /data.
  app.post('/api/upload-image', express.raw({ type: 'image/*', limit: '10mb' }), (req: Request, res: Response) => {
    try {
      const imageData = req.body as Buffer;
      if (!Buffer.isBuffer(imageData) || imageData.length === 0) {
        res.status(400).json({ error: 'فایل تصویر معتبر نیست.' });
        return;
      }

      const mimeType = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
      const extensionByMimeType: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
      };
      const ext = extensionByMimeType[mimeType];
      if (!ext) {
        res.status(400).json({ error: 'فقط فرمت‌های JPEG، PNG، WebP، GIF و AVIF پشتیبانی می‌شوند.' });
        return;
      }

      const imageId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const filename = `${imageId}.${ext}`;
      fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(PRODUCT_IMAGE_DIR, filename), imageData);

      // Telegram resolves this URL outside the browser, without an admin cookie.
      const protocol = req.protocol || 'https';
      const host = req.get('host') || req.headers.host;
      const imageUrl = `${protocol}://${host}/product-images/${encodeURIComponent(filename)}`;

      res.json({ success: true, url: imageUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve protected non-catalog uploads for authenticated panel users only.
  app.use('/data', express.static(DATA_DIR));
  app.post('/api/products', (req: Request, res: Response) => {
    try {
      const productCode = Math.floor(1000000 + Math.random() * 9000000).toString();
      const newProduct: Product = {
        ...req.body,
        productCode: req.body.productCode || productCode,
        id: req.body.id || `prod-${Date.now()}`,
        createdAt: new Date().toISOString()
      };
      products.unshift(newProduct);

      // Trigger live notification to products topic
      sendToTelegramTopic(
        'products',
        `🧁 <b>محصول جدید به ویترین اضافه شد!</b>\n\n🎂 <b>نام:</b> ${newProduct.name}\n📂 <b>دسته‌بندی:</b> ${newProduct.category}\n💰 <b>قیمت:</b> ${newProduct.price.toLocaleString('fa-IR')} تومان / ${newProduct.unit}\n✨ <b>وضعیت:</b> ${newProduct.isAvailable ? 'موجود و آماده سفارش' : 'ناموجود'}`,
        newProduct.image
      );

      res.status(201).json(newProduct);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update product (price, photo, availability, etc.)
  app.put('/api/products/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = products.findIndex((p) => p.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const oldPrice = products[index].price;
    const oldAvailable = products[index].isAvailable;
    products[index] = { ...products[index], ...req.body };

    if (req.body.price && req.body.price !== oldPrice) {
      sendToTelegramTopic(
        'products',
        `💰 <b>تغییر قیمت محصول:</b>\n\n🧁 <b>${products[index].name}</b>\n🔹 قیمت قبلی: ${oldPrice.toLocaleString('fa-IR')} تومان\n🔸 <b>قیمت جدید:</b> ${products[index].price.toLocaleString('fa-IR')} تومان`
      );
    } else if (req.body.isAvailable !== undefined && req.body.isAvailable !== oldAvailable) {
      sendToTelegramTopic(
        'products',
        `📦 <b>تغییر موجودی انبار:</b>\n\n🧁 <b>${products[index].name}</b>\nوضعیت جدید: <b>${products[index].isAvailable ? '✅ موجود شد' : '❌ ناموجود شد'}</b>`
      );
    }

    res.json(products[index]);
  });

  // Delete product
  app.delete('/api/products/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const deleted = products.find(p => p.id === id);
    products = products.filter((p) => p.id !== id);
    if (deleted) {
      sendToTelegramTopic(
        'products',
        `🗑 <b>حذف محصول از کاتالوگ:</b>\n\nمحصول «${deleted.name}» از سیستم حذف گردید.`
      );
    }
    res.json({ success: true });
  });

  // Get orders
  app.get('/api/orders', (req: Request, res: Response) => {
    res.json(orders);
  });

  // Create new order
  app.post('/api/orders', (req: Request, res: Response) => {
    // The browser may optimistically suggest a tracking code, but only the
    // server can make the final uniqueness decision against persisted orders.
    const orderNumber = resolveUniqueOrderNumber(req.body.orderNumber, orders);

    const newOrder: Order = {
      ...req.body,
      id: req.body.id || `ord-${Date.now()}`,
      orderNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (newOrder.paymentReceiptImage && !newOrder.receiptReviewStatus) {
      newOrder.receiptReviewStatus = 'submitted';
    }
    orders.unshift(newOrder);

    // If order used a coupon code, increment usedCount
    if (newOrder.couponCode) {
      const foundIndex = discounts.findIndex(
        d => d.code.trim().toUpperCase() === newOrder.couponCode?.trim().toUpperCase()
      );
      if (foundIndex !== -1) {
        discounts[foundIndex].usedCount = (discounts[foundIndex].usedCount || 0) + 1;
      }
    }
    saveAllData();

    // Trigger notification to orders topic
    const orderItemsSummary = newOrder.items.map(i => `▫️ ${i.productName} (${i.quantity} ${i.unit})`).join('\n');
    sendToTelegramTopic(
      'orders',
      `🎉 <b>سفارش جدید ثبت شد!</b>\n\n🔖 <b>کد رهگیری:</b> <code>${newOrder.orderNumber}</code>\n👤 <b>خریدار:</b> ${newOrder.customerName}\n📞 <b>تلفن:</b> <code>${newOrder.customerPhone}</code>\n🏠 <b>آدرس:</b> ${newOrder.customerAddress}\n\n📋 <b>اقلام سفارش:</b>\n${orderItemsSummary}\n\n💰 <b>مبلغ کل:</b> ${newOrder.totalAmount.toLocaleString('fa-IR')} تومان\n🛵 <b>وضعیت:</b> در انتظار تایید فیش و آماده‌سازی`
    );

    if (newOrder.discountAmount && newOrder.discountAmount > 0) {
      sendToTelegramTopic(
        'discounts',
        `🎟️ <b>استفاده از کد تخفیف:</b>\n\n🔖 کد تخفیف <code>${newOrder.couponCode || '---'}</code> توسط ${newOrder.customerName} در سفارش <code>${newOrder.orderNumber}</code> استفاده شد.\n💰 مبلغ کسر شده: ${newOrder.discountAmount.toLocaleString('fa-IR')} تومان`
      );
    }

    sendToTelegramTopic(
      'finance',
      `💳 <b>فیش بانکی واریزی جدید:</b>\n\n🔖 سفارش <code>${newOrder.orderNumber}</code> به مبلغ <b>${newOrder.totalAmount.toLocaleString('fa-IR')} تومان</b> توسط ${newOrder.customerName} واریز گردید.`
    );

    res.status(201).json(newOrder);
  });

  // Update order status
  app.put('/api/orders/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = orders.findIndex((o) => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const previousStatus = orders[index].status;
    orders[index] = {
      ...orders[index],
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    saveAllData();

    if (req.body.status && req.body.status !== previousStatus) {
      const statusLabels: Record<string, string> = {
        pending_payment: 'در انتظار پرداخت',
        paid_checking: 'در حال بررسی فیش و پرداخت',
        receipt_confirmed: 'فیش تأیید شده؛ در انتظار شروع پخت',
        baking: 'در حال پخت و آماده‌سازی در قنادی',
        shipped: 'تحویل به پیک و در حال ارسال',
        delivered: 'تحویل داده شده به مشتری',
        cancelled: 'لغو شده'
      };
      sendToTelegramTopic(
        'orders',
        `🔄 <b>تغییر وضعیت سفارش ${orders[index].orderNumber}:</b>\n\nوضعیت به «<b>${statusLabels[req.body.status] || req.body.status}</b>» تغییر یافت.\n👤 مشتری: ${orders[index].customerName}`
      );
    }

    res.json(orders[index]);
  });

  // Approve or reject a customer's payment receipt (admin decision from panel).
  // Approval verifies payment only; production begins only after the separate,
  // explicit admin action changes the status to `baking`.
  app.post('/api/orders/:id/receipt-decision', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { approved, reason } = req.body;
    if (typeof approved !== 'boolean') {
      res.status(400).json({ error: 'تصمیم تأیید فیش معتبر نیست.' });
      return;
    }
    const index = orders.findIndex((o) => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const order = orders[index];
    if (!order.paymentReceiptImage) {
      res.status(409).json({ error: 'فیش قابل بررسی برای این سفارش وجود ندارد.' });
      return;
    }
    if (!['pending_payment', 'paid_checking'].includes(order.status) || ['confirmed', 'rejected'].includes(order.receiptReviewStatus || '')) {
      res.status(409).json({ error: 'این فیش قبلاً بررسی شده است.' });
      return;
    }
    const newStatus: OrderStatus = approved ? 'receipt_confirmed' : 'pending_payment';
    const reviewedAt = new Date().toISOString();
    const reviewReason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
    const safeReviewReason = escapeTelegramHtml(reviewReason);
    order.status = newStatus;
    order.receiptReviewStatus = approved ? 'confirmed' : 'rejected';
    order.receiptReviewedAt = reviewedAt;
    if (approved) delete order.receiptReviewReason;
    else order.receiptReviewReason = reviewReason || undefined;
    order.updatedAt = reviewedAt;
    saveAllData();

    // A rejected receipt remains visible to the admin for audit. Re-arm this
    // customer's persisted photo flow so their next image is treated as the
    // replacement receipt rather than an unrelated message.
    if (!approved && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      userStates.set(String(order.customerTelegramId), { mode: 'waiting_for_receipt', orderId: order.id });
    }

    // Notify the customer directly in Telegram
    if (getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        const text = approved
          ? tmsg('receiptApprovedMessage', { orderNumber: order.orderNumber })
          : tmsg('receiptRejectedMessage', {
              orderNumber: order.orderNumber,
              reason: safeReviewReason ? `\n📌 <b>دلیل:</b> ${safeReviewReason}` : '',
            });
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text,
            parse_mode: 'HTML',
            reply_markup: approved ? undefined : {
              inline_keyboard: [
                [{ text: '📷 ارسال فیش جدید', callback_data: `order_reupload_receipt_${order.id}` }],
                [{ text: '💬 پشتیبانی', callback_data: 'support_send' }],
              ],
            }
          })
        });
      } catch (err) {
        console.error('Failed to notify customer about receipt decision:', err);
      }
    }

    sendToTelegramTopic(
      'finance',
      approved
        ? `✅ <b>فیش واریزی سفارش ${order.orderNumber} تأیید شد:</b>\n\n👤 مشتری: ${order.customerName}\n💰 مبلغ: <b>${order.totalAmount.toLocaleString('fa-IR')} تومان</b>\n📌 وضعیت سفارش: <b>فیش تأیید شده</b>\n👩‍🍳 شروع پخت فقط با انتخاب صریح ادمین انجام می‌شود.`
        : `❌ <b>فیش واریزی سفارش ${order.orderNumber} رد شد:</b>\n\n👤 مشتری: ${order.customerName}\n💰 مبلغ: ${order.totalAmount.toLocaleString('fa-IR')} تومان${safeReviewReason ? `\n📌 دلیل: ${safeReviewReason}` : ''}\n📌 سفارش به «در انتظار پرداخت» بازگشت و از مشتری خواسته شد فیش را مجدد ارسال کند.`
    );

    res.json(order);
  });

  // Proxy a Telegram file (e.g. payment receipt photo) so the web panel can
  // display images that were sent to the bot (Telegram file_ids are not URLs).
  // This endpoint remains panel-authenticated; the cache is never exposed as a
  // public static directory.
  app.get('/api/telegram/file/:fileId', async (req: Request, res: Response) => {
    const fileId = typeof req.params.fileId === 'string' ? req.params.fileId.trim() : '';
    if (!fileId) {
      res.status(400).json({ error: 'Telegram file ID is required' });
      return;
    }

    const cachedFile = readCachedTelegramFile(fileId);
    if (cachedFile) {
      res.setHeader('Content-Type', cachedFile.contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(cachedFile.buffer);
      return;
    }

    const token = getTelegramBotToken();
    if (!token) {
      res.status(404).json({ error: 'Telegram bot token is not configured' });
      return;
    }
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const info = (await infoRes.json()) as any;
      if (!info.ok || !info.result?.file_path) {
        res.status(404).json({ error: info.description || 'File not found on Telegram' });
        return;
      }
      const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
      if (!fileRes.ok) {
        res.status(404).json({ error: 'Failed to download file from Telegram' });
        return;
      }
      const contentType = safeTelegramImageContentType(fileRes.headers.get('content-type'));
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      cacheTelegramFile(fileId, buffer, contentType);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(buffer);
    } catch (err: any) {
      console.error('Telegram file proxy error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Discount Codes API ---

  // Get all discount codes
  app.get('/api/discounts', (req: Request, res: Response) => {
    res.json(discounts);
  });

  // Create new discount code
  app.post('/api/discounts', (req: Request, res: Response) => {
    try {
      const codeUpper = (req.body.code || '').trim().toUpperCase();
      if (!codeUpper) {
        res.status(400).json({ error: 'کد تخفیف الزامی است' });
        return;
      }

      // Check duplicate
      const exists = discounts.some(d => d.code.trim().toUpperCase() === codeUpper);
      if (exists) {
        res.status(400).json({ error: 'این کد تخفیف قبلاً تعریف شده است' });
        return;
      }

      const newDiscount: DiscountCode = {
        id: req.body.id || `disc-${Date.now()}`,
        code: codeUpper,
        type: req.body.type || 'percentage',
        value: Number(req.body.value) || 0,
        minPurchaseAmount: req.body.minPurchaseAmount ? Number(req.body.minPurchaseAmount) : undefined,
        maxDiscountAmount: req.body.maxDiscountAmount ? Number(req.body.maxDiscountAmount) : undefined,
        usageLimit: req.body.usageLimit ? Number(req.body.usageLimit) : undefined,
        usedCount: req.body.usedCount || 0,
        isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
        expiresAt: req.body.expiresAt || undefined,
        applicableProductIds: Array.isArray(req.body.applicableProductIds) ? req.body.applicableProductIds : [],
        description: req.body.description || '',
        createdAt: new Date().toISOString()
      };

      discounts.unshift(newDiscount);
      saveAllData();
      sendToTelegramTopic(
        'discounts',
        `🎟️ <b>کد تخفیف جدید ایجاد شد:</b>\n\n🔖 کد: <code>${newDiscount.code}</code>\n💰 نوع: <b>${newDiscount.type === 'percentage' ? `${newDiscount.value}٪` : `${newDiscount.value.toLocaleString('fa-IR')} تومان`}</b>\n📌 سقف استفاده: ${newDiscount.usageLimit ? `${newDiscount.usageLimit} بار` : 'نامحدود'}\n✨ وضعیت: ${newDiscount.isActive ? '✅ فعال' : '❌ غیرفعال'}`
      );
      res.status(201).json(newDiscount);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update discount code
  app.put('/api/discounts/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = discounts.findIndex(d => d.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'کد تخفیف یافت نشد' });
      return;
    }

    if (req.body.code) {
      req.body.code = req.body.code.trim().toUpperCase();
    }

    discounts[index] = {
      ...discounts[index],
      ...req.body
    };
    res.json(discounts[index]);
  });

  // Delete discount code
  app.delete('/api/discounts/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const deleted = discounts.find(d => d.id === id);
    discounts = discounts.filter(d => d.id !== id);
    saveAllData();
    if (deleted) {
      sendToTelegramTopic(
        'discounts',
        `🗑 <b>کد تخفیف حذف گردید:</b>\n\nکد: <code>${deleted.code}</code>`
      );
    }
    res.json({ success: true });
  });

  // Validate discount code against a subtotal
  app.post('/api/discounts/validate', (req: Request, res: Response) => {
    const { code, subtotal, items } = req.body;
    if (!code) {
      res.status(400).json({ valid: false, message: 'لطفاً کد تخفیف را وارد کنید' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    const discount = discounts.find(d => d.code.trim().toUpperCase() === cleanCode);

    if (!discount) {
      res.status(404).json({ valid: false, message: 'کد تخفیف وارد شده معتبر نمی‌باشد.' });
      return;
    }

    if (!discount.isActive) {
      res.status(400).json({ valid: false, message: 'این کد تخفیف در حال حاضر غیرفعال است.' });
      return;
    }

    if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
      res.status(400).json({ valid: false, message: 'سقف استفاده از این کد تخفیف به پایان رسیده است.' });
      return;
    }

    if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
      res.status(400).json({ valid: false, message: 'مهلت استفاده از این کد تخفیف منقضی شده است.' });
      return;
    }

    const orderSubtotal = Number(subtotal) || 0;
    if (discount.minPurchaseAmount && orderSubtotal < discount.minPurchaseAmount) {
      res.status(400).json({
        valid: false,
        message: `این کد تخفیف برای خریدهای بالای ${discount.minPurchaseAmount.toLocaleString('fa-IR')} تومان قابل استفاده است.`
      });
      return;
    }

    // If the code only applies to specific products, restrict the discount to those items
    const applicable = discount.applicableProductIds || [];
    let baseAmount = orderSubtotal;
    if (applicable.length > 0) {
      const cartItems: Array<{ productId: string; quantity: number }> = Array.isArray(items) ? items : [];
      if (cartItems.length === 0) {
        res.status(400).json({ valid: false, message: 'این کد تخفیف فقط برای محصولات خاصی قابل استفاده است که در سبد شما وجود ندارد.' });
        return;
      }
      baseAmount = cartItems.reduce((sum: number, it: { productId: string; quantity: number }) => {
        if (!applicable.includes(it.productId)) return sum;
        const p = products.find(pr => pr.id === it.productId);
        if (!p) return sum;
        const eff = p.discountPercent ? p.price * (100 - p.discountPercent) / 100 : p.price;
        return sum + eff * (it.quantity || 1);
      }, 0);
      if (baseAmount <= 0) {
        res.status(400).json({ valid: false, message: 'این کد تخفیف فقط برای محصولات خاصی قابل استفاده است که در سبد شما وجود ندارد.' });
        return;
      }
    }

    // Calculate discount amount
    let calculatedDiscount = 0;
    if (discount.type === 'percentage') {
      calculatedDiscount = Math.round((baseAmount * discount.value) / 100);
      if (discount.maxDiscountAmount && calculatedDiscount > discount.maxDiscountAmount) {
        calculatedDiscount = discount.maxDiscountAmount;
      }
    } else {
      // Fixed amount
      calculatedDiscount = Math.min(discount.value, baseAmount);
    }

    res.json({
      valid: true,
      discount,
      discountAmount: calculatedDiscount,
      message: discount.type === 'percentage'
        ? `کد تخفیف ${discount.value}٪ با موفقیت اعمال شد!`
        : `تخفیف ${discount.value.toLocaleString('fa-IR')} تومانی با موفقیت اعمال شد!`
    });
  });

  // Get bot settings. Credential material is intentionally never serialized
  // to the browser, even for an authenticated administrator.
  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(getPublicPanelSettings());
  });

  // Update bot settings
  app.put('/api/settings', async (req: Request, res: Response) => {
    const updates = { ...(req.body || {}) } as Partial<SecurePanelSettings> & {
      clearTelegramBotToken?: unknown;
    };
    const previousCredentials = getPanelCredentials(botSettings);
    const changesPanelPassword = Object.prototype.hasOwnProperty.call(updates, 'webAdminPassword');
    const changesTelegramToken = Object.prototype.hasOwnProperty.call(updates, 'telegramBotToken');
    const clearsTelegramToken = updates.clearTelegramBotToken === true;

    // These are response/status-only or command-only fields, never persisted
    // as part of the store configuration.
    delete updates.hasTelegramBotToken;
    delete updates.clearTelegramBotToken;
    // A client can submit a new password, but can never supply its own hash.
    // Otherwise a crafted settings request could replace the authentication secret.
    delete updates.webAdminPasswordHash;

    if (changesTelegramToken) {
      if (typeof updates.telegramBotToken === 'string' && updates.telegramBotToken.trim()) {
        updates.telegramBotToken = updates.telegramBotToken.trim();
      } else {
        // A blank write must not accidentally erase a write-only configured token.
        delete updates.telegramBotToken;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'webAdminUsername')) {
      if (typeof updates.webAdminUsername !== 'string' || !updates.webAdminUsername.trim()) {
        res.status(400).json({ error: 'نام کاربری پنل نمی‌تواند خالی باشد.' });
        return;
      }
      updates.webAdminUsername = updates.webAdminUsername.trim();
    }

    if (changesPanelPassword) {
      if (typeof updates.webAdminPassword !== 'string' || updates.webAdminPassword.length < 4) {
        res.status(400).json({ error: 'رمز عبور پنل باید حداقل ۴ کاراکتر باشد.' });
        return;
      }
      updates.webAdminPasswordHash = hashPanelPassword(updates.webAdminPassword);
      delete updates.webAdminPassword;
    }

    // Sanitize admin-customized bot texts: only known message keys and
    // reasonably sized strings are persisted.
    if (Object.prototype.hasOwnProperty.call(updates, 'botTexts')) {
      const rawTexts = (updates as any).botTexts;
      if (rawTexts !== null && (typeof rawTexts !== 'object' || Array.isArray(rawTexts))) {
        res.status(400).json({ error: 'متون ربات باید به‌صورت مجموعه‌ای از متن‌ها ارسال شوند.' });
        return;
      }
      const cleanedTexts: Record<string, string> = {};
      const allowedKeys = new Set<string>(BOT_MESSAGE_LIST.map((def) => def.key as string));
      for (const [key, value] of Object.entries(rawTexts || {})) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value !== 'string') continue;
        const trimmed = value.slice(0, 4000);
        if (trimmed.trim()) cleanedTexts[key] = trimmed;
      }
      (updates as any).botTexts = cleanedTexts;
    }

    botSettings = { ...botSettings, ...updates };
    if (clearsTelegramToken) {
      delete botSettings.telegramBotToken;
      botSettings.isLiveBotActive = false;
      stopTelegramPolling();
    } else if (changesTelegramToken && updates.telegramBotToken) {
      botSettings.isLiveBotActive = true;
    }
    const nextCredentials = getPanelCredentials(botSettings);

    // Persist settings on Railway's mounted volume (or the local data directory).
    saveSettings(botSettings);

    // Changing credentials invalidates old browser sessions; keep the current
    // administrator signed in by rotating their HttpOnly session cookie.
    if (
      previousCredentials.username !== nextCredentials.username ||
      changesPanelPassword
    ) {
      panelSessions.clear();
      issuePanelSession(req, res, nextCredentials.username);
    }

    // Start or restart Telegram polling whenever an active token is configured
    const activeToken = getTelegramBotToken();
    if (activeToken) {
      botSettings.isLiveBotActive = true;
      if (changesTelegramToken && updates.telegramBotToken) {
        restartTelegramPolling(updates.telegramBotToken);
      } else if (!isPolling) {
        startTelegramPolling(activeToken);
      }
    }

    res.json(getPublicPanelSettings());
  });

  // --- Support Tickets API ---

  // Get all support tickets
  app.get('/api/support/tickets', (req: Request, res: Response) => {
    res.json(supportTickets);
  });

  // Create new support ticket
  app.post('/api/support/tickets', (req: Request, res: Response) => {
    try {
      const newTicket: SupportTicket = {
        id: req.body.id || `tkt-${Date.now()}`,
        ticketNumber: req.body.ticketNumber || `TK-${Math.floor(1000 + Math.random() * 9000)}`,
        customerName: req.body.customerName || 'مشتری قنادی',
        customerTelegramId: req.body.customerTelegramId || 'guest',
        customerUsername: req.body.customerUsername || '',
        customerPhone: req.body.customerPhone || '',
        category: req.body.category || 'general',
        subject: req.body.subject || 'پیام پشتیبانی',
        message: req.body.message || '',
        status: req.body.status || 'open',
        priority: req.body.priority || 'normal',
        orderNumber: req.body.orderNumber || undefined,
        cakePhoto: req.body.cakePhoto || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replies: req.body.replies || [
          {
            id: `rep-${Date.now()}`,
            sender: 'customer',
            senderName: req.body.customerName || 'مشتری',
            text: req.body.message || '',
            createdAt: new Date().toISOString()
          }
        ]
      };

      supportTickets.unshift(newTicket);
      saveAllData();

      // Trigger live notification to Telegram Support Topic
      const categoryLabels: Record<string, string> = {
        custom_cake: '🎂 سفارش کیک اختصاصی',
        order_inquiry: '📦 پیگیری و سوال سفارش',
        payment_issue: '💳 مشکل در پرداخت و فیش',
        feedback: '⭐ انتقاد و پیشنهاد',
        consultation: '💡 مشاوره خرید و رژیمی',
        general: '💬 پیام عمومی'
      };

      sendToTelegramTopic(
        'support',
        `💬 <b>پیام پشتیبانی جدید (${newTicket.ticketNumber})</b>\n\n👤 <b>مشتری:</b> ${newTicket.customerName} ${newTicket.customerUsername ? `(@${newTicket.customerUsername})` : ''}\n📂 <b>موضوع:</b> ${categoryLabels[newTicket.category] || newTicket.category}\n📌 <b>عنوان:</b> ${newTicket.subject}\n\n📝 <b>متن پیام:</b>\n<i>${newTicket.message}</i>\n${newTicket.orderNumber ? `\n🔖 شماره سفارش مرتبط: <code>${newTicket.orderNumber}</code>` : ''}`,
        newTicket.cakePhoto
      );

      res.status(201).json(newTicket);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Reply to support ticket
  app.post('/api/support/tickets/:id/reply', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { text, sender, senderName } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'متن پاسخ نمی‌تواند خالی باشد' });
      return;
    }

    const ticketIndex = supportTickets.findIndex(t => t.id === id);
    if (ticketIndex === -1) {
      res.status(404).json({ error: 'تیکت یافت نشد' });
      return;
    }

    const isFromAdmin = sender === 'admin';
    const newReply = {
      id: `rep-${Date.now()}`,
      sender: (sender || 'admin') as 'admin' | 'customer',
      senderName: senderName || (isFromAdmin ? 'مدیریت قنادی' : supportTickets[ticketIndex].customerName),
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    supportTickets[ticketIndex].replies.push(newReply);
    supportTickets[ticketIndex].updatedAt = new Date().toISOString();
    if (isFromAdmin) {
      supportTickets[ticketIndex].status = 'answered';
    } else {
      supportTickets[ticketIndex].status = 'in_progress';
    }
    saveAllData();

    // If admin replied and user has telegram ID and live bot is active, send telegram message
    if (isFromAdmin && getTelegramBotToken() && supportTickets[ticketIndex].customerTelegramId && supportTickets[ticketIndex].customerTelegramId !== 'guest') {
      try {
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: supportTickets[ticketIndex].customerTelegramId,
            text: `👩‍🍳 <b>پاسخ پشتیبانی قنادی شیرین‌کام (تیکت ${supportTickets[ticketIndex].ticketNumber}):</b>\n\n${text.trim()}\n\n<i>در صورت نیاز به توضیحات بیشتر می‌توانید پاسخ دهید یا بیخیال شوید.</i>`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💬 پاسخ به این تیکت', callback_data: `reply_ticket_${supportTickets[ticketIndex].id}` }],
                [{ text: '✅ بیخیال', callback_data: 'back_to_main' }]
              ]
            }
          })
        });
      } catch (err) {
        console.error('Failed to send telegram direct reply:', err);
      }
    }

    // Also notify support topic about the answer
    if (isFromAdmin) {
      sendToTelegramTopic(
        'support',
        `✅ <b>پاسخ به تیکت ${supportTickets[ticketIndex].ticketNumber} ارسال شد:</b>\n\n👤 مشتری: ${supportTickets[ticketIndex].customerName}\n✍️ <b>متن پاسخ ادمین:</b>\n${text.trim()}`
      );
    }

    res.json(supportTickets[ticketIndex]);
  });

  // Update ticket status or priority
  app.put('/api/support/tickets/:id/status', (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, priority } = req.body;

    const ticketIndex = supportTickets.findIndex(t => t.id === id);
    if (ticketIndex === -1) {
      res.status(404).json({ error: 'تیکت یافت نشد' });
      return;
    }

    if (status) supportTickets[ticketIndex].status = status;
    if (priority) supportTickets[ticketIndex].priority = priority;
    supportTickets[ticketIndex].updatedAt = new Date().toISOString();
    saveAllData();

    res.json(supportTickets[ticketIndex]);
  });

  // Delete ticket
  app.delete('/api/support/tickets/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    supportTickets = supportTickets.filter(t => t.id !== id);
    saveAllData();
    res.json({ success: true });
  });

  // ==========================================
  // --- Custom Pastry & Cake Orders API ---
  // ==========================================

  // Get all custom pastry orders
  app.get('/api/custom-orders', (req: Request, res: Response) => {
    res.json(customOrders);
  });

  // Create new custom pastry order (from bot or admin)
  app.post('/api/custom-orders', (req: Request, res: Response) => {
    try {
      const requestedDate = String(req.body?.deliveryDate || '').trim();
      const requestedTime = String(req.body?.deliveryTimeSlot || '').trim();
      // Scheduling is optional. Validate either field when supplied, but never
      // force the customer to pick a date/time before paying for the order.
      const deliveryDate = requestedDate ? normalizeIranianDeliveryDate(requestedDate) : null;
      const deliveryTime = requestedTime ? normalizeIranianDeliveryTime(requestedTime) : null;
      if ((deliveryDate && 'error' in deliveryDate) || (deliveryTime && 'error' in deliveryTime)) {
        res.status(400).json({ error: deliveryDate?.error || deliveryTime?.error || 'زمان تحویل معتبر نیست.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const newOrder: CustomPastryOrder = {
        ...req.body,
        id: req.body.id || `custom-${Date.now()}`,
        orderNumber: req.body.orderNumber || `CP-${Math.floor(1000 + Math.random() * 9000)}`,
        status: req.body.status || 'pending_review',
        chatMessages: req.body.chatMessages || [],
        referenceImages: req.body.referenceImages || [],
        deliveryDate: deliveryDate?.value,
        deliveryTimeSlot: deliveryTime?.value,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      customOrders.unshift(newOrder);
      upsertCustomerFromCustomOrder(newOrder);
      saveAllData();

      // Auto-notify custom_orders supergroup topic in Telegram
      sendToTelegramTopic(
        'custom_orders',
        `✨🎂 <b>سفارش جدید شیرینی/کیک دلخواه ثبت شد!</b>\n\n🔖 <b>کد رهگیری:</b> <code>${newOrder.orderNumber}</code>\n👤 <b>مشتری:</b> ${newOrder.customerName} (${newOrder.customerPhone})\n🧁 <b>نوع شیرینی:</b> ${newOrder.pastryType}\n⚖️ <b>وزن/تعداد:</b> ${newOrder.weightKg ? `${newOrder.weightKg} کیلوگرم` : ''} ${newOrder.servingCount ? `(${newOrder.servingCount} نفر)` : ''}\n🎨 <b>طرح و ویژگی‌های درخواستی:</b>\n<i>${newOrder.shapeAndDesign}</i>\n${newOrder.writingOnCake ? `✍️ <b>متن روی کیک:</b> «${newOrder.writingOnCake}»\n` : ''}📅 <b>زمان تحویل:</b> پس از تأیید سفارش با مشتری هماهنگ می‌شود.\n\n🔍 وضعیت: <b>در انتظار بررسی و قیمت‌گذاری قناد</b>`,
        newOrder.referenceImages?.[0]
      );

      res.status(201).json(newOrder);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update custom order
  app.put('/api/custom-orders/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const index = customOrders.findIndex(o => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }

    const rawUpdates = req.body;
    if (!rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) {
      res.status(400).json({ error: 'اطلاعات ویرایش سفارش معتبر نیست.' });
      return;
    }

    // The generic edit route is intentionally limited to customer/order details.
    // Pricing, payment evidence, receipt review and the production state must go
    // through their dedicated routes so a payload can never mark a receipt paid.
    const editableFields = new Set([
      'customerName', 'customerPhone', 'customerUsername', 'customerTelegramName',
      'pastryType', 'weightKg', 'servingCount',
      'tierCount', 'dietaryType', 'shapeAndDesign', 'writingOnCake',
      'referenceImages', 'deliveryType', 'deliveryAddress', 'deliveryDate',
      'deliveryTimeSlot',
    ]);
    const prohibitedFields = Object.keys(rawUpdates).filter((field) => !editableFields.has(field));
    if (prohibitedFields.length > 0) {
      res.status(400).json({
        error: `ویرایش مستقیم این فیلدها مجاز نیست: ${prohibitedFields.join('، ')}. برای وضعیت، قیمت و پرداخت از عملیات مخصوص استفاده کنید.`,
      });
      return;
    }

    const updates: Partial<CustomPastryOrder> = {};
    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(rawUpdates, field);
    const optionalTextFields: Array<keyof Pick<CustomPastryOrder,
      'customerUsername' | 'customerTelegramName' |
      'writingOnCake' | 'deliveryAddress'>> = [
      'customerUsername', 'customerTelegramName',
      'writingOnCake', 'deliveryAddress',
    ];
    const requiredTextFields: Array<keyof Pick<CustomPastryOrder,
      'customerName' | 'customerPhone' | 'pastryType' | 'shapeAndDesign'>> = [
      'customerName', 'customerPhone', 'pastryType', 'shapeAndDesign',
    ];

    for (const field of [...requiredTextFields, ...optionalTextFields]) {
      if (!hasField(field)) continue;
      if (typeof rawUpdates[field] !== 'string') {
        res.status(400).json({ error: `مقدار «${field}» باید متن باشد.` });
        return;
      }
      const value = rawUpdates[field].trim().slice(0, field === 'shapeAndDesign' ? 2500 : 300);
      if (requiredTextFields.includes(field as keyof Pick<CustomPastryOrder, 'customerName' | 'customerPhone' | 'pastryType' | 'shapeAndDesign'>) && !value) {
        res.status(400).json({ error: `مقدار «${field}» نمی‌تواند خالی باشد.` });
        return;
      }
      (updates as Record<string, unknown>)[field] = value || undefined;
    }

    if (hasField('deliveryType')) {
      if (rawUpdates.deliveryType !== 'pickup' && rawUpdates.deliveryType !== 'delivery') {
        res.status(400).json({ error: 'روش تحویل معتبر نیست.' });
        return;
      }
      updates.deliveryType = rawUpdates.deliveryType;
    }

    const validPastryTypes = new Set([
      'کیک تولد و مناسبتی', 'کیک عصرانه و خانگی', 'شیرینی تر و خامه‌ای مجلسی',
      'شیرینی خشک و سنتی اعلا', 'کوکی و تارت اختصاصی', 'دسر و باقلوا سفارشی',
      'پکیج پذیرایی مراسم و جشن',
    ]);
    if (updates.pastryType && !validPastryTypes.has(updates.pastryType)) {
      res.status(400).json({ error: 'نوع محصول سفارشی معتبر نیست.' });
      return;
    }

    if (hasField('dietaryType')) {
      const validDietaryTypes = new Set(['عادی', 'کم‌شکر', 'بدون قند (دیابتی)', 'بدون گلوتن', 'وگان', 'کتوژنیک']);
      if (typeof rawUpdates.dietaryType !== 'string' || !validDietaryTypes.has(rawUpdates.dietaryType)) {
        res.status(400).json({ error: 'نوع رژیم غذایی معتبر نیست.' });
        return;
      }
      updates.dietaryType = rawUpdates.dietaryType;
    }

    for (const field of ['weightKg', 'servingCount', 'tierCount'] as const) {
      if (!hasField(field)) continue;
      if (rawUpdates[field] === '' || rawUpdates[field] === null) {
        updates[field] = undefined;
        continue;
      }
      const value = Number(rawUpdates[field]);
      if (!Number.isFinite(value) || value <= 0 || value > (field === 'weightKg' ? 1000 : 100000)) {
        res.status(400).json({ error: `مقدار «${field}» معتبر نیست.` });
        return;
      }
      updates[field] = value;
    }

    if (hasField('referenceImages')) {
      if (!Array.isArray(rawUpdates.referenceImages) || rawUpdates.referenceImages.length > 10 || rawUpdates.referenceImages.some((image) => typeof image !== 'string' || image.length > 4096)) {
        res.status(400).json({ error: 'تصاویر نمونه معتبر نیستند.' });
        return;
      }
      updates.referenceImages = rawUpdates.referenceImages.map((image) => image.trim()).filter(Boolean);
    }

    const changesDeliveryDate = hasField('deliveryDate');
    const changesDeliveryTime = hasField('deliveryTimeSlot');
    if (changesDeliveryDate) {
      if (typeof rawUpdates.deliveryDate !== 'string' && rawUpdates.deliveryDate !== null) {
        res.status(400).json({ error: 'تاریخ تحویل باید متن باشد.' });
        return;
      }
      const requestedDate = String(rawUpdates.deliveryDate || '').trim();
      if (!requestedDate) {
        updates.deliveryDate = undefined;
      } else {
        const deliveryDate = normalizeIranianDeliveryDate(requestedDate);
        if ('error' in deliveryDate) {
          res.status(400).json({ error: deliveryDate.error });
          return;
        }
        updates.deliveryDate = deliveryDate.value;
      }
    }
    if (changesDeliveryTime) {
      if (typeof rawUpdates.deliveryTimeSlot !== 'string' && rawUpdates.deliveryTimeSlot !== null) {
        res.status(400).json({ error: 'بازه زمانی تحویل باید متن باشد.' });
        return;
      }
      const requestedTime = String(rawUpdates.deliveryTimeSlot || '').trim();
      if (!requestedTime) {
        updates.deliveryTimeSlot = undefined;
      } else {
        const deliveryTime = normalizeIranianDeliveryTime(requestedTime);
        if ('error' in deliveryTime) {
          res.status(400).json({ error: deliveryTime.error });
          return;
        }
        updates.deliveryTimeSlot = deliveryTime.value;
      }
    }

    const nextOrder = { ...customOrders[index], ...updates } as CustomPastryOrder;
    if (nextOrder.status === 'approved_by_customer' && !hasCompleteCustomOrderDelivery(nextOrder)) {
      res.status(400).json({ error: 'نام، تلفن و آدرس تحویل باید پیش از تأیید ثبت شوند.' });
      return;
    }

    customOrders[index] = {
      ...nextOrder,
      updatedAt: new Date().toISOString()
    };
    upsertCustomerFromCustomOrder(customOrders[index]);
    saveAllData();

    res.json(customOrders[index]);
  });

  // Admin quotes price & prepayment for custom order
  app.post('/api/custom-orders/:id/quote', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { finalPrice, prepaymentAmount, adminNotes, messageToCustomer } = req.body;

    const index = customOrders.findIndex(o => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }

    const order = customOrders[index];
    const hasFinalPrice = finalPrice !== undefined && finalPrice !== null && finalPrice !== '';
    const parsedFinalPrice = Number(finalPrice);
    if (hasFinalPrice && (!Number.isFinite(parsedFinalPrice) || parsedFinalPrice < 0)) {
      res.status(400).json({ error: 'مبلغ نهایی سفارش معتبر نیست.' });
      return;
    }
    const nextFinalPrice = hasFinalPrice ? Math.round(parsedFinalPrice) : Math.max(0, Math.round(Number(order.estimatedPrice) || 0));
    const hasPrepaymentAmount = prepaymentAmount !== undefined && prepaymentAmount !== null && prepaymentAmount !== '';
    const parsedPrepaymentAmount = Number(prepaymentAmount);
    if (hasPrepaymentAmount && (!Number.isFinite(parsedPrepaymentAmount) || parsedPrepaymentAmount < 0)) {
      res.status(400).json({ error: 'مبلغ بیعانه معتبر نیست.' });
      return;
    }
    const nextPrepaymentAmount = hasPrepaymentAmount
      ? Math.round(parsedPrepaymentAmount)
      : Math.round(nextFinalPrice * 0.4);
    if (nextPrepaymentAmount > nextFinalPrice) {
      res.status(400).json({ error: 'مبلغ بیعانه نمی‌تواند از مبلغ نهایی سفارش بیشتر باشد.' });
      return;
    }
    order.finalPrice = nextFinalPrice;
    order.prepaymentAmount = nextPrepaymentAmount;
    order.status = 'price_quoted';
    // A new quote starts a new payment request. It must never inherit a former
    // approval, receipt, or rejection reason.
    order.isPrepaymentPaid = false;
    order.prepaymentStatus = order.prepaymentAmount > 0 ? 'awaiting_receipt' : 'not_required';
    delete order.paymentReceiptImage;
    delete order.prepaymentSubmittedAt;
    delete order.prepaymentReviewedAt;
    delete order.prepaymentRejectReason;
    if (adminNotes) order.adminNotes = adminNotes;
    order.updatedAt = new Date().toISOString();

    if (messageToCustomer) {
      order.chatMessages.push({
        id: `cmsg-${Date.now()}`,
        sender: 'admin',
        senderName: 'سرقناد شیرین‌کام',
        text: messageToCustomer,
        createdAt: new Date().toISOString()
      });
    }

    // Direct Telegram notification to customer if live bot is connected
    if (getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text: `🎂 <b>اعلام قیمت سفارش کیک/شیرینی دلخواه (${order.orderNumber}):</b>\n\nسلام ${order.customerName} عزیز، طرح سفارشی شما توسط سرقناد بررسی و قیمت‌گذاری شد:\n\n💰 <b>مبلغ کل سفارش:</b> <b>${order.finalPrice.toLocaleString('fa-IR')} تومان</b>\n💳 <b>مبلغ بیعانه جهت شروع پخت:</b> <b>${order.prepaymentAmount.toLocaleString('fa-IR')} تومان</b>\n${messageToCustomer ? `\n📝 <b>پیام قناد:</b>\n${messageToCustomer}\n` : ''}\n👇 در صورت تمایل به خرید، روی دکمه زیر کلیک کنید:`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '✅ ثبت سفارش', callback_data: `custom_order_register_${order.id}` }]
            ]}
          })
        });
      } catch (err) {
        console.error('Failed to notify customer about custom order quote:', err);
      }
    }

    // Notify Custom Orders Topic
    sendToTelegramTopic(
      'custom_orders',
      `💰 <b>قیمت‌گذاری سفارش دلخواه (${order.orderNumber}):</b>\n\n👤 مشتری: ${order.customerName}\n💵 مبلغ کل: <b>${order.finalPrice.toLocaleString('fa-IR')} تومان</b>\n💳 بیعانه: <b>${order.prepaymentAmount.toLocaleString('fa-IR')} تومان</b>\nوضعیت: در انتظار تایید مشتری و فیش بیعانه`
    );
    saveAllData();

    res.json(order);
  });

  // Update status (e.g. baking, ready, delivered, rejected)
  app.post('/api/custom-orders/:id/status', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, rejectReason, adminNotes } = req.body;

    const index = customOrders.findIndex(o => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }

    const order = customOrders[index];
    const allowedStatuses: CustomPastryStatus[] = ['pending_review', 'price_quoted', 'approved_by_customer', 'receipt_confirmed', 'baking', 'ready', 'delivered', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'وضعیت سفارش معتبر نیست.' });
      return;
    }
    if (status === 'approved_by_customer' && !hasCompleteCustomOrderDelivery(order)) {
      res.status(400).json({ error: 'مشخصات تماس و آدرس تحویل مشتری هنوز کامل نشده است.' });
      return;
    }
    if (status === 'approved_by_customer' && !canAdvanceCustomOrderToProduction(order)) {
      res.status(400).json({ error: 'تأیید سفارش فقط بعد از تأیید بیعانه توسط ادمین یا انتخاب پرداخت هنگام تحویل ممکن است.' });
      return;
    }
    if (status === 'receipt_confirmed' && getCustomPrepaymentStatus(order) !== 'approved') {
      res.status(400).json({ error: 'فیش بیعانه باید ابتدا توسط ادمین تأیید شده باشد.' });
      return;
    }
    if (['baking', 'ready', 'delivered'].includes(status) && !canAdvanceCustomOrderToProduction(order)) {
      res.status(400).json({ error: 'شروع یا ادامهٔ تولید فقط پس از تأیید بیعانه توسط ادمین یا انتخاب پرداخت هنگام تحویل ممکن است.' });
      return;
    }
    order.status = status;
    if (rejectReason) order.rejectReason = rejectReason;
    if (adminNotes) order.adminNotes = adminNotes;
    order.updatedAt = new Date().toISOString();

    const statusLabels: Record<string, string> = {
      pending_review: 'در انتظار بررسی',
      price_quoted: 'قیمت‌گذاری شده',
      approved_by_customer: 'تایید مشتری و پرداخت بیعانه',
      receipt_confirmed: 'فیش بیعانه تأیید شده؛ در انتظار شروع پخت',
      baking: '👨‍🍳 در حال پخت و تزیین در کارگاه',
      ready: '🎂 آماده تحویل / ارسال',
      delivered: '🎉 تحویل داده شد',
      rejected: '❌ رد شده / لغو'
    };

    // Notify Customer via bot
    if (getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        let msg = `✨ <b>به‌روزرسانی وضعیت سفارش دلخواه (${order.orderNumber}):</b>\n\nوضعیت جدید: <b>${statusLabels[status] || status}</b>`;
        if (status === 'baking') {
          msg += `\n\n👨‍🍳 کیک و شیرینی شما در کارگاه شیرین‌کام در حال پخت و دیزاین با بهترین مواد اولیه است.`;
        } else if (status === 'ready') {
          msg += `\n\n🎂 سفارش شما با نهایت ظرافت آماده شد و در بسته‌بندی مخصوص قرار گرفت!`;
        } else if (status === 'delivered') {
          msg += `\n\n🎉 سفارش با موفقیت به شما تحویل داده شد. نوش جان و لحظاتتان شیرین!`;
        } else if (status === 'rejected' && rejectReason) {
          msg += `\n\nعلت: ${rejectReason}`;
        }

        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text: msg,
            parse_mode: 'HTML'
          })
        });
      } catch (err) {
        console.error('Failed to notify customer status:', err);
      }
    }

    sendToTelegramTopic(
      'custom_orders',
      `🔄 <b>تغییر وضعیت سفارش دلخواه (${order.orderNumber}):</b>\n\n👤 مشتری: ${order.customerName}\n✨ وضعیت جدید: <b>${statusLabels[status] || status}</b>\n${adminNotes ? `📝 یادداشت: ${adminNotes}` : ''}`
    );
    saveAllData();

    res.json(order);
  });

  // Submit a custom-order prepayment receipt. Submission is deliberately
  // separate from approval: production cannot start until an admin decides.
  app.post('/api/custom-orders/:id/prepayment', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { paymentReceiptImage, amount } = req.body;

    const index = customOrders.findIndex(o => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }
    if (typeof paymentReceiptImage !== 'string' || !paymentReceiptImage.trim()) {
      res.status(400).json({ error: 'تصویر یا شناسهٔ فیش بیعانه الزامی است.' });
      return;
    }

    const order = customOrders[index];
    const currentPrepaymentStatus = getCustomPrepaymentStatus(order);
    if (!['awaiting_receipt', 'rejected', 'pending_confirmation'].includes(currentPrepaymentStatus)) {
      res.status(409).json({ error: 'این سفارش اکنون در مرحلهٔ دریافت فیش بیعانه نیست.' });
      return;
    }
    if (!hasCompleteCustomOrderDelivery(order)) {
      res.status(400).json({ error: 'نام، تلفن و آدرس تحویل مشتری باید کامل شوند.' });
      return;
    }
    const submittedAmount = Number(amount);
    if (amount !== undefined && (!Number.isFinite(submittedAmount) || submittedAmount < 0)) {
      res.status(400).json({ error: 'مبلغ بیعانه معتبر نیست.' });
      return;
    }
    if (amount !== undefined) order.prepaymentAmount = Math.round(submittedAmount);
    order.paymentReceiptImage = paymentReceiptImage.trim();
    order.paymentMethod = 'card_to_card';
    order.isPrepaymentPaid = false;
    order.prepaymentStatus = 'pending_confirmation';
    order.prepaymentSubmittedAt = new Date().toISOString();
    delete order.prepaymentReviewedAt;
    delete order.prepaymentRejectReason;
    // Keep the order in the quoted state until the receipt is verified.
    order.status = 'price_quoted';
    order.updatedAt = new Date().toISOString();

    sendToTelegramTopic(
      'finance',
      `💳 <b>فیش بیعانه سفارش دلخواه (${order.orderNumber}) دریافت شد:</b>\n\n👤 مشتری: ${order.customerName}\n💰 مبلغ بیعانه: <b>${(order.prepaymentAmount || 0).toLocaleString('fa-IR')} تومان</b>\nکل فاکتور: ${(order.finalPrice || 0).toLocaleString('fa-IR')} تومان\n⏳ وضعیت: <b>در انتظار تأیید ادمین</b>`,
      order.paymentReceiptImage
    );
    saveAllData();

    if (getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text: tmsg('customPrepaymentAckMessage'),
            parse_mode: 'HTML',
          }),
        });
      } catch (err) {
        console.error('Failed to notify customer about submitted custom prepayment:', err);
      }
    }

    res.json(order);
  });

  // Admin decision for a custom-order prepayment receipt.
  app.post('/api/custom-orders/:id/prepayment-decision', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { approved, reason } = req.body || {};
    if (!isValidCustomPrepaymentDecision(approved)) {
      res.status(400).json({ error: 'تصمیم تأیید فیش معتبر نیست.' });
      return;
    }

    const index = customOrders.findIndex(order => order.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }
    const order = customOrders[index];
    if (getCustomPrepaymentStatus(order) !== 'pending_confirmation' || !order.paymentReceiptImage) {
      res.status(409).json({ error: 'فیش قابل بررسیِ در انتظاری برای این سفارش وجود ندارد.' });
      return;
    }

    const reviewReason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
    const safeReviewReason = escapeTelegramHtml(reviewReason);
    const now = new Date().toISOString();
    order.prepaymentReviewedAt = now;
    order.updatedAt = now;
    if (approved) {
      order.isPrepaymentPaid = true;
      order.prepaymentStatus = 'approved';
      // A verified deposit is deliberately its own stage. The workshop starts
      // only when an administrator explicitly selects «شروع پخت».
      order.status = 'receipt_confirmed';
      delete order.prepaymentRejectReason;
    } else {
      order.isPrepaymentPaid = false;
      order.prepaymentStatus = 'rejected';
      order.status = 'price_quoted';
      order.prepaymentRejectReason = reviewReason || undefined;
    }
    saveAllData();

    if (getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        const text = approved
          ? tmsg('customPrepaymentApprovedMessage', {
              orderNumber: order.orderNumber,
              prepaymentAmount: (order.prepaymentAmount || 0).toLocaleString('fa-IR'),
            })
          : tmsg('customPrepaymentRejectedMessage', {
              orderNumber: order.orderNumber,
              reason: safeReviewReason ? `\n📌 <b>دلیل:</b> ${safeReviewReason}` : '',
            });
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text,
            parse_mode: 'HTML',
            reply_markup: approved ? undefined : {
              inline_keyboard: [[{ text: '📷 ارسال فیش جدید', callback_data: `custom_order_reupload_receipt_${order.id}` }]],
            },
          }),
        });
      } catch (err) {
        console.error('Failed to notify customer about custom prepayment decision:', err);
      }
    }

    sendToTelegramTopic(
      'finance',
      approved
        ? `✅ <b>فیش بیعانهٔ سفارش دلخواه ${order.orderNumber} تأیید شد.</b>\n👤 مشتری: ${order.customerName}\n💰 مبلغ: ${(order.prepaymentAmount || 0).toLocaleString('fa-IR')} تومان`
        : `❌ <b>فیش بیعانهٔ سفارش دلخواه ${order.orderNumber} رد شد.</b>\n👤 مشتری: ${order.customerName}${safeReviewReason ? `\n📌 دلیل: ${safeReviewReason}` : ''}`,
    );

    res.json(order);
  });

  // Chat message between customer and admin regarding custom order
  app.post('/api/custom-orders/:id/chat', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { text, sender, senderName, photo } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'متن پیام نمی‌تواند خالی باشد.' });
      return;
    }

    const index = customOrders.findIndex(o => o.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }

    const order = customOrders[index];
    const isFromAdmin = sender === 'admin';
    const newMsg = {
      id: `cmsg-${Date.now()}`,
      sender: (sender || 'admin') as 'admin' | 'customer',
      senderName: senderName || (isFromAdmin ? 'سرقناد شیرین‌کام' : order.customerName),
      text: text.trim(),
      photo,
      createdAt: new Date().toISOString()
    };

    order.chatMessages.push(newMsg);
    order.updatedAt = new Date().toISOString();
    // Keep the conversation durable immediately; a Railway restart must not
    // discard a just-sent production instruction to the customer.
    saveAllData();

    // If sent by admin, notify customer on telegram
    if (isFromAdmin && getTelegramBotToken() && order.customerTelegramId && order.customerTelegramId !== 'guest') {
      try {
        await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: order.customerTelegramId,
            text: `👨‍🍳 <b>پیام جدید قناد در خصوص سفارش ${order.orderNumber}:</b>\n\n${text.trim()}`,
            parse_mode: 'HTML'
          })
        });
      } catch (e) {
        console.error('Failed to notify customer chat:', e);
      }
    }

    res.json(order);
  });

  // Delete custom order
  app.delete('/api/custom-orders/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const beforeCount = customOrders.length;
    customOrders = customOrders.filter(o => o.id !== id);
    if (customOrders.length === beforeCount) {
      res.status(404).json({ error: 'سفارش دلخواه یافت نشد.' });
      return;
    }
    saveAllData();
    res.json({ success: true });
  });

  // ==========================================
  // --- Unified invoices & customer payments ---
  // ==========================================
  // Orders remain the source of truth: their invoices are produced dynamically
  // so receipt decisions and status updates are visible immediately. Only
  // source=manual invoices are stored as independent finance documents.
  const supportedInvoiceStatuses = new Set<InvoiceStatus>([
    'draft', 'issued', 'pending_payment', 'payment_review', 'partially_paid',
    'paid', 'overdue', 'cancelled', 'refunded',
  ]);
  const supportedPaymentMethods = new Set<InvoicePaymentMethod>([
    'cash', 'cash_on_delivery', 'card_to_card', 'online_payment',
    'online_gateway', 'bank_transfer', 'wallet', 'other',
  ]);
  const supportedPaymentStatuses = new Set<InvoicePaymentStatus>([
    'pending', 'submitted', 'confirmed', 'rejected', 'refunded',
  ]);
  const trimInvoiceText = (value: unknown, maxLength = 1000): string =>
    typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  const invoiceMoney = (value: unknown): number | null => {
    if (value === '' || value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  };
  const invoiceQuantity = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 100000 ? parsed : null;
  };
  const manualInvoiceById = (id: string) => invoices.find((invoice) => invoice.id === id && invoice.source === 'manual');

  // A customer can receive a manual invoice only through the Telegram chat that
  // is stored for that customer by the bot.  "guest" and locally-created
  // placeholder identities are deliberately never valid delivery targets.
  const isCustomerTelegramChatId = (value: unknown): value is string => {
    const chatId = String(value || '').trim();
    return Boolean(chatId && chatId !== 'guest' && !chatId.startsWith('manual-'));
  };
  /** A manual invoice must remain tied to a real bot customer for payment actions. */
  const getBotLinkedCustomerForInvoice = (invoice: Invoice): CustomerUser | undefined => {
    if (!invoice.customerId) return undefined;
    const customer = customers.find((item) => item.id === invoice.customerId);
    return customer && isCustomerTelegramChatId(customer.telegramId) ? customer : undefined;
  };
  const isManualInvoicePayable = (invoice: Invoice): boolean => (
    invoice.source === 'manual'
    && invoice.remainingAmount > 0
    && !['draft', 'paid', 'cancelled', 'refunded'].includes(invoice.status)
    && !invoice.payments.some((payment) => payment.status === 'submitted')
  );
  const buildCustomerInvoiceKeyboard = (invoice: Invoice) => {
    const mainMenuButton = { text: '🏠 بازگشت به منوی اصلی', callback_data: 'back_to_main' };
    if (!isManualInvoicePayable(invoice)) return [[mainMenuButton]];
    return [
      [{ text: '💳 پرداخت فاکتور', callback_data: `invoice_payment_${invoice.id}` }],
      [mainMenuButton],
    ];
  };
  const formatCustomerInvoiceText = (value: unknown, maxLength = 48): string =>
    escapeTelegramHtml(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength));
  const customerInvoiceStatusLabel = (status: InvoiceStatus): string => ({
    draft: 'پیش‌نویس',
    issued: 'صادرشده',
    pending_payment: 'در انتظار پرداخت',
    payment_review: 'در انتظار بررسی پرداخت',
    partially_paid: 'بخشی از مبلغ پرداخت شده',
    paid: 'پرداخت شده',
    overdue: 'سررسید گذشته',
    cancelled: 'لغوشده',
    refunded: 'بازپرداخت شده',
  }[status] || status);

  const buildCustomerInvoiceTelegramMessage = (invoice: Invoice): string => {
    // Keep the customer-facing message below Telegram's 4096-character limit
    // even if a legacy/imported invoice has many unusually long item names.
    const visibleItems = invoice.items.slice(0, 8).map((item, index) =>
      `▫️ ${index + 1}. ${formatCustomerInvoiceText(item.title)} — ${item.quantity.toLocaleString('fa-IR')} ${formatCustomerInvoiceText(item.unit || 'عدد', 16)} × ${item.unitPrice.toLocaleString('fa-IR')} = <b>${item.totalAmount.toLocaleString('fa-IR')} تومان</b>`,
    );
    if (invoice.items.length > 8) visibleItems.push(`▫️ و ${invoice.items.length - 8} قلم دیگر`);

    const lines = [
      '🧾 <b>فاکتور شما صادر شد</b>',
      '',
      `🔖 شماره فاکتور: <code>${formatCustomerInvoiceText(invoice.invoiceNumber, 80)}</code>`,
      `📌 وضعیت: ${customerInvoiceStatusLabel(invoice.status)}`,
      '',
      '<b>اقلام فاکتور</b>',
      ...visibleItems,
      '',
      `جمع اقلام: ${invoice.subtotal.toLocaleString('fa-IR')} تومان`,
    ];
    if (invoice.shippingFee > 0) lines.push(`هزینه ارسال: ${invoice.shippingFee.toLocaleString('fa-IR')} تومان`);
    if (invoice.discountAmount > 0) lines.push(`تخفیف: ${invoice.discountAmount.toLocaleString('fa-IR')} تومان`);
    if (invoice.taxAmount > 0) lines.push(`مالیات: ${invoice.taxAmount.toLocaleString('fa-IR')} تومان`);
    lines.push(`💰 <b>مبلغ کل: ${invoice.totalAmount.toLocaleString('fa-IR')} تومان</b>`);
    if (invoice.paidAmount > 0) lines.push(`پرداخت‌شده: ${invoice.paidAmount.toLocaleString('fa-IR')} تومان`);
    if (invoice.remainingAmount > 0) lines.push(`⏳ <b>مانده قابل پرداخت: ${invoice.remainingAmount.toLocaleString('fa-IR')} تومان</b>`);
    if (invoice.dueDate) lines.push(`📅 سررسید: ${formatCustomerInvoiceText(invoice.dueDate, 32)}`);
    lines.push('', 'برای پیگیری یا هماهنگی بیشتر، از طریق همین ربات با ما در ارتباط باشید.');
    return lines.join('\n');
  };

  const sendManualInvoiceToCustomer = async (invoice: Invoice): Promise<string> => {
    // Resolve the current bot-linked record again on the server. This makes an
    // edited browser payload unable to redirect a selected customer's invoice.
    const linkedCustomer = getBotLinkedCustomerForInvoice(invoice);
    if (!linkedCustomer) {
      throw new Error('برای ارسال تلگرامی، مشتری باید از فهرست کاربرانِ ربات انتخاب شده باشد.');
    }
    const customerChatId = linkedCustomer.telegramId;
    const token = getTelegramBotToken();
    if (!token) {
      throw new Error('توکن ربات تلگرام در تنظیمات امن سرور ثبت نشده است.');
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: customerChatId,
        text: buildCustomerInvoiceTelegramMessage(invoice),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildCustomerInvoiceKeyboard(invoice) },
      }),
    });
    let telegramResult: { ok?: boolean; description?: string } | null = null;
    try {
      telegramResult = await response.json() as { ok?: boolean; description?: string };
    } catch {
      // A non-JSON gateway failure is still represented with the safe generic
      // error below; do not expose upstream response bodies to the panel.
    }
    if (!response.ok || !telegramResult?.ok) {
      throw new Error(telegramResult?.description || 'تلگرام پیام فاکتور را نپذیرفت.');
    }
    return String(customerChatId).trim();
  };

  /** Notify the actual invoice recipient after an admin accepts or rejects a receipt. */
  const notifyCustomerAboutManualInvoicePaymentReview = async (
    invoice: Invoice,
    payment: InvoicePayment,
    approved: boolean,
  ): Promise<void> => {
    const customer = getBotLinkedCustomerForInvoice(invoice);
    const token = getTelegramBotToken();
    if (!customer || !token) return;

    const safeInvoiceNumber = formatCustomerInvoiceText(invoice.invoiceNumber, 80);
    const safeReviewNote = formatCustomerInvoiceText(payment.reviewNote, 500);
    const text = approved
      ? tmsg('invoicePaymentApprovedMessage', {
          invoiceNumber: safeInvoiceNumber,
          amount: payment.amount.toLocaleString('fa-IR'),
        }) + (invoice.remainingAmount > 0 ? `\n⏳ مانده قابل پرداخت: <b>${invoice.remainingAmount.toLocaleString('fa-IR')} تومان</b>` : '\n🎉 فاکتور شما تسویه شد.')
      : tmsg('invoicePaymentRejectedMessage', {
          invoiceNumber: safeInvoiceNumber,
          reason: safeReviewNote ? `\n📌 <b>دلیل:</b> ${escapeTelegramHtml(safeReviewNote)}` : '',
        });
    const buttons = approved
      ? [[{ text: '🏠 بازگشت به منوی اصلی', callback_data: 'back_to_main' }]]
      : [
        [{ text: '📷 ارسال فیش جدید', callback_data: `invoice_payment_${invoice.id}` }],
        [{ text: '🏠 بازگشت به منوی اصلی', callback_data: 'back_to_main' }],
      ];
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: customer.telegramId,
          text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        }),
      });
    } catch (error) {
      // Receipt review has already been committed. A transient bot error must
      // never roll back the financial decision or expose an upstream response.
      console.error(`Failed to notify customer about invoice ${invoice.id} payment review:`, error);
    }
  };

  app.get('/api/invoices', (req: Request, res: Response) => {
    res.json(buildAllInvoices(orders, customOrders, invoices));
  });

  app.post('/api/invoices', (req: Request, res: Response) => {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 100) {
      res.status(400).json({ error: 'حداقل یک و حداکثر صد ردیف کالا یا خدمت برای فاکتور لازم است.' });
      return;
    }

    const customerId = trimInvoiceText(body.customerId, 120);
    const selectedCustomer = customerId ? customers.find((customer) => customer.id === customerId) : undefined;
    if (customerId && !selectedCustomer) {
      res.status(400).json({ error: 'مشتری انتخاب‌شده در سامانه یافت نشد.' });
      return;
    }
    const customerName = trimInvoiceText(body.customerName, 160) || selectedCustomer?.name || '';
    if (!customerName) {
      res.status(400).json({ error: 'نام مشتری برای صدور فاکتور الزامی است.' });
      return;
    }

    const lineItems: InvoiceItem[] = [];
    for (let index = 0; index < rawItems.length; index += 1) {
      const rawItem = rawItems[index] || {};
      const title = trimInvoiceText(rawItem.title, 240);
      const quantity = invoiceQuantity(rawItem.quantity);
      const unitPrice = invoiceMoney(rawItem.unitPrice);
      const itemDiscount = invoiceMoney(rawItem.discountAmount);
      if (!title || quantity === null || unitPrice === null || itemDiscount === null) {
        res.status(400).json({ error: `اطلاعات ردیف ${index + 1} کامل یا معتبر نیست.` });
        return;
      }
      const grossAmount = Math.round(quantity * unitPrice);
      if (itemDiscount > grossAmount) {
        res.status(400).json({ error: `تخفیف ردیف ${index + 1} نمی‌تواند از مبلغ آن بیشتر باشد.` });
        return;
      }
      lineItems.push({
        id: `line-${Date.now()}-${index}`,
        title,
        description: trimInvoiceText(rawItem.description, 1000) || undefined,
        productCode: trimInvoiceText(rawItem.productCode, 120) || undefined,
        quantity,
        unit: trimInvoiceText(rawItem.unit, 80) || 'عدد',
        unitPrice,
        discountAmount: itemDiscount,
        totalAmount: grossAmount - itemDiscount,
      });
    }

    const shippingFee = invoiceMoney(body.shippingFee);
    const discountAmount = invoiceMoney(body.discountAmount);
    const taxAmount = invoiceMoney(body.taxAmount);
    if (shippingFee === null || discountAmount === null || taxAmount === null) {
      res.status(400).json({ error: 'مبالغ هزینه ارسال، تخفیف یا مالیات معتبر نیستند.' });
      return;
    }

    const initialPaymentInput = body.initialPayment && typeof body.initialPayment === 'object'
      ? body.initialPayment
      : null;
    const payments: InvoicePayment[] = [];
    if (initialPaymentInput) {
      const paymentAmount = invoiceMoney(initialPaymentInput.amount);
      const paymentMethod = initialPaymentInput.method as InvoicePaymentMethod;
      const paymentStatus = initialPaymentInput.status as InvoicePaymentStatus;
      if (paymentAmount === null || !supportedPaymentMethods.has(paymentMethod) || !supportedPaymentStatuses.has(paymentStatus)) {
        res.status(400).json({ error: 'اطلاعات پرداخت اولیه معتبر نیست.' });
        return;
      }
      if (paymentAmount > 0 || paymentStatus !== 'pending') {
        const now = new Date().toISOString();
        payments.push({
          id: `payment-manual-${Date.now()}`,
          amount: paymentAmount,
          method: paymentMethod,
          status: paymentStatus,
          transactionReference: trimInvoiceText(initialPaymentInput.transactionReference, 240) || undefined,
          notes: trimInvoiceText(initialPaymentInput.notes, 1000) || undefined,
          createdAt: now,
          updatedAt: now,
          paidAt: paymentStatus === 'confirmed' ? now : undefined,
        });
      }
    }

    const requestedStatus = supportedInvoiceStatuses.has(body.status as InvoiceStatus)
      ? body.status as InvoiceStatus
      : 'pending_payment';
    const now = new Date().toISOString();
    const calculated = calculateInvoiceAmounts({
      items: lineItems,
      shippingFee,
      discountAmount,
      taxAmount,
      payments,
    });
    if (discountAmount > calculated.subtotal + shippingFee + taxAmount) {
      res.status(400).json({ error: 'تخفیف کل نمی‌تواند از مبلغ قابل پرداخت بیشتر باشد.' });
      return;
    }
    const requestedNumber = trimInvoiceText(body.invoiceNumber, 80).replace(/[^a-zA-Z0-9-_]/g, '');
    const invoiceNumber = requestedNumber || `INV-M-${Date.now().toString(36).toUpperCase()}`;
    if (buildAllInvoices(orders, customOrders, invoices).some((invoice) => invoice.invoiceNumber === invoiceNumber)) {
      res.status(409).json({ error: 'شماره فاکتور تکراری است.' });
      return;
    }

    const newInvoice: Invoice = {
      id: `invoice-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      invoiceNumber,
      source: 'manual',
      title: trimInvoiceText(body.title, 240) || 'فاکتور دستی',
      customerId: selectedCustomer?.id,
      customerName,
      customerPhone: trimInvoiceText(body.customerPhone, 60) || selectedCustomer?.phone || undefined,
      customerTelegramId: selectedCustomer?.telegramId || trimInvoiceText(body.customerTelegramId, 100) || undefined,
      customerAddress: trimInvoiceText(body.customerAddress, 1000) || selectedCustomer?.address || undefined,
      items: lineItems,
      ...calculated,
      status: resolveManualInvoiceStatus(requestedStatus, { ...calculated, payments }),
      paymentMethod: payments[0]?.method || (supportedPaymentMethods.has(body.paymentMethod as InvoicePaymentMethod) ? body.paymentMethod as InvoicePaymentMethod : undefined),
      payments,
      dueDate: trimInvoiceText(body.dueDate, 32) || undefined,
      deliveryMethod: body.deliveryMethod === 'pickup' || body.deliveryMethod === 'delivery' ? body.deliveryMethod : undefined,
      deliveryAddress: trimInvoiceText(body.deliveryAddress, 1000) || undefined,
      notes: trimInvoiceText(body.notes, 2000) || undefined,
      createdAt: now,
      updatedAt: now,
    };

    invoices.unshift(newInvoice);
    saveAllData();
    sendToTelegramTopic(
      'finance',
      `🧾 <b>فاکتور دستی جدید صادر شد:</b>\n\n🔖 شماره: <code>${newInvoice.invoiceNumber}</code>\n👤 مشتری: ${newInvoice.customerName}\n💰 مبلغ کل: <b>${newInvoice.totalAmount.toLocaleString('fa-IR')} تومان</b>\n📌 وضعیت: ${newInvoice.status}`,
    );
    res.status(201).json(newInvoice);
  });

  // Send (or deliberately re-send) a standalone invoice to the customer chosen
  // from the bot user list. This remains separate from invoice creation, so a
  // transient Telegram outage never loses a valid, persisted finance document.
  app.post('/api/invoices/:id/send-to-customer', async (req: Request, res: Response) => {
    const invoice = manualInvoiceById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'فقط فاکتورهای دستی قابل ارسال مستقیم برای مشتری هستند.' });
      return;
    }

    try {
      const customerChatId = await sendManualInvoiceToCustomer(invoice);
      const now = new Date().toISOString();
      invoice.customerNotificationSentAt = now;
      const previousNotificationCount = Number(invoice.customerNotificationCount);
      invoice.customerNotificationCount = Number.isFinite(previousNotificationCount) && previousNotificationCount >= 0
        ? Math.floor(previousNotificationCount) + 1
        : 1;
      invoice.updatedAt = now;
      saveAllData();
      sendToTelegramTopic(
        'finance',
        `✉️ <b>فاکتور برای مشتری ارسال شد:</b>\n\n🔖 شماره: <code>${escapeTelegramHtml(invoice.invoiceNumber)}</code>\n👤 مشتری: ${escapeTelegramHtml(invoice.customerName)}\n💬 شناسه تلگرام: <code>${escapeTelegramHtml(customerChatId)}</code>`,
      );
      res.json(invoice);
    } catch (error) {
      console.error(`Failed to send invoice ${invoice.id} to customer:`, error);
      const message = error instanceof Error ? error.message : 'ارسال فاکتور به تلگرام مشتری ناموفق بود.';
      res.status(502).json({ error: message });
    }
  });

  // Register a later payment against a standalone manual invoice. Payments for
  // order-backed invoices must be reviewed in their source order workflow so
  // the finance ledger never drifts away from fulfillment status.
  app.post('/api/invoices/:id/payments', (req: Request, res: Response) => {
    const invoice = manualInvoiceById(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'فاکتور دستی یافت نشد یا پرداخت آن از سفارش مبدا مدیریت می‌شود.' });
      return;
    }
    const paymentInput = req.body || {};
    const paymentAmount = invoiceMoney(paymentInput.amount);
    const paymentMethod = paymentInput.method as InvoicePaymentMethod;
    const paymentStatus = paymentInput.status as InvoicePaymentStatus;
    if (paymentAmount === null || paymentAmount <= 0 || !supportedPaymentMethods.has(paymentMethod) || !supportedPaymentStatuses.has(paymentStatus)) {
      res.status(400).json({ error: 'مبلغ، روش یا وضعیت پرداخت معتبر نیست.' });
      return;
    }

    const now = new Date().toISOString();
    invoice.payments.push({
      id: `payment-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      amount: paymentAmount,
      method: paymentMethod,
      status: paymentStatus,
      transactionReference: trimInvoiceText(paymentInput.transactionReference, 240) || undefined,
      notes: trimInvoiceText(paymentInput.notes, 1000) || undefined,
      createdAt: now,
      updatedAt: now,
      paidAt: paymentStatus === 'confirmed' ? now : undefined,
    });
    const calculated = calculateInvoiceAmounts(invoice);
    Object.assign(invoice, calculated, {
      paymentMethod,
      status: resolveManualInvoiceStatus(invoice.status, { ...calculated, payments: invoice.payments }),
      updatedAt: now,
    });
    saveAllData();
    res.json(invoice);
  });

  // A customer-submitted receipt is never treated as paid automatically. Only
  // an authenticated panel administrator can make this explicit decision.
  app.post('/api/invoices/:id/payments/:paymentId/review', async (req: Request, res: Response) => {
    const invoice = manualInvoiceById(req.params.id);
    const approved = req.body?.approved;
    if (!invoice) {
      res.status(404).json({ error: 'فاکتور دستی برای بررسی پرداخت یافت نشد.' });
      return;
    }
    if (typeof approved !== 'boolean') {
      res.status(400).json({ error: 'تصمیم تأیید یا رد فیش معتبر نیست.' });
      return;
    }
    const payment = invoice.payments.find((item) => item.id === req.params.paymentId);
    if (!payment || payment.status !== 'submitted' || !payment.receiptImage) {
      res.status(409).json({ error: 'فیشِ در انتظار بررسی برای این فاکتور یافت نشد.' });
      return;
    }

    const now = new Date().toISOString();
    const reviewNote = trimInvoiceText(req.body?.reason, 1000);
    payment.status = approved ? 'confirmed' : 'rejected';
    payment.reviewedAt = now;
    payment.reviewedBy = getPanelSession(req)?.username || undefined;
    payment.reviewNote = reviewNote || undefined;
    payment.updatedAt = now;
    if (approved) payment.paidAt = now;
    else delete payment.paidAt;

    const calculated = calculateInvoiceAmounts(invoice);
    Object.assign(invoice, calculated, {
      paymentMethod: payment.method,
      status: resolveManualInvoiceStatus(invoice.status, { ...calculated, payments: invoice.payments }),
      updatedAt: now,
    });
    saveAllData();

    await notifyCustomerAboutManualInvoicePaymentReview(invoice, payment, approved);
    const safeInvoiceNumber = escapeTelegramHtml(invoice.invoiceNumber);
    const safeCustomerName = escapeTelegramHtml(invoice.customerName);
    const safeReviewNote = escapeTelegramHtml(reviewNote);
    sendToTelegramTopic(
      'finance',
      approved
        ? `✅ <b>فیش فاکتور ${safeInvoiceNumber} تأیید شد.</b>\n👤 مشتری: ${safeCustomerName}\n💰 مبلغ: ${payment.amount.toLocaleString('fa-IR')} تومان`
        : `❌ <b>فیش فاکتور ${safeInvoiceNumber} رد شد.</b>\n👤 مشتری: ${safeCustomerName}${safeReviewNote ? `\n📌 دلیل: ${safeReviewNote}` : ''}`,
    );
    res.json(invoice);
  });

  app.patch('/api/invoices/:id/status', (req: Request, res: Response) => {
    const invoice = manualInvoiceById(req.params.id);
    const status = req.body?.status as InvoiceStatus;
    if (!invoice) {
      res.status(404).json({ error: 'فقط وضعیت فاکتورهای دستی قابل تغییر است.' });
      return;
    }
    if (!supportedInvoiceStatuses.has(status)) {
      res.status(400).json({ error: 'وضعیت فاکتور معتبر نیست.' });
      return;
    }
    invoice.status = resolveManualInvoiceStatus(status, invoice);
    invoice.updatedAt = new Date().toISOString();
    saveAllData();
    res.json(invoice);
  });

  // Test a newly entered token, or the existing write-only server token.
  app.post('/api/telegram/test-bot', async (req: Request, res: Response) => {
    const requestedToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const token = requestedToken || getTelegramBotToken();
    if (!token) {
      res.status(400).json({ success: false, message: 'لطفاً توکن ربات تلگرام را وارد کنید' });
      return;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = (await response.json()) as any;
      if (data.ok) {
        res.json({
          success: true,
          bot: data.result,
          message: `ارتباط با ربات @${data.result.username} با موفقیت برقرار شد!`
        });
      } else {
        res.status(400).json({
          success: false,
          message: data.description || 'توکن وارد شده معتبر نمی‌باشد'
        });
      }
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: 'خطا در ارتباط با سرور تلگرام: ' + err.message
      });
    }
  });

  // Broadcast message to users
  app.post('/api/telegram/broadcast', async (req: Request, res: Response) => {
    const { message, photo } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    let sentCount = 0;
    if (getTelegramBotToken() && registeredTelegramChatIds.size > 0) {
      for (const chatId of registeredTelegramChatIds) {
        try {
          if (photo) {
            await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                photo: photo,
                caption: message,
                parse_mode: 'HTML'
              })
            });
          } else {
            await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
              })
            });
          }
          sentCount++;
        } catch (e) {
          console.error(`Failed to send broadcast to ${chatId}:`, e);
        }
      }
    }

    res.json({ success: true, recipientsCount: registeredTelegramChatIds.size, sentCount });
  });

  // --- Telegram Forum Supergroup Topics API ---

  // Helper function to send report to Telegram topic
  async function sendToTelegramTopic(
    key: ForumTopicKey,
    messageText: string,
    photoUrl?: string
  ) {
    const groupId = String(botSettings.forumGroupId || '').trim();
    if (!groupId) {
      console.warn(`[sendToTelegramTopic:${key}] Skipped: forumGroupId is not configured in bot settings.`);
      return;
    }
    const topic = botSettings.forumTopics?.find((t) => t.key === key);
    if (topic && (topic.enabled === false || topic.autoReport === false)) return;

    if (topic) {
      topic.lastReportTime = new Date().toISOString();
      topic.lastReportSummary = messageText.replace(/<[^>]*>?/gm, '').slice(0, 120);
    }

    const token = getTelegramBotToken();
    if (!token) {
      console.warn(`[sendToTelegramTopic:${key}] Skipped: bot token is missing.`);
      return;
    }

    const threadId = topic?.threadId ? Number(topic.threadId) : undefined;

    try {
      if (photoUrl) {
        // 1. If photo is a base64 data URL, upload via multipart FormData
        if (photoUrl.startsWith('data:image/')) {
          try {
            const matches = photoUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');
              const formData = new FormData();
              formData.append('chat_id', groupId);
              formData.append('parse_mode', 'HTML');
              formData.append('caption', messageText);
              if (threadId) {
                formData.append('message_thread_id', String(threadId));
              }
              formData.append('photo', new Blob([buffer], { type: mimeType }), 'receipt.jpg');

              const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                method: 'POST',
                body: formData,
              });
              const photoData = (await photoRes.json().catch(() => ({}))) as any;
              if (photoData?.ok) return;

              // If threadId failed, retry without threadId
              if (threadId) {
                const retryForm = new FormData();
                retryForm.append('chat_id', groupId);
                retryForm.append('parse_mode', 'HTML');
                retryForm.append('caption', messageText);
                retryForm.append('photo', new Blob([buffer], { type: mimeType }), 'receipt.jpg');
                const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                  method: 'POST',
                  body: retryForm,
                });
                const retryData = (await retryRes.json().catch(() => ({}))) as any;
                if (retryData?.ok) return;
              }
            }
          } catch (formErr) {
            console.error(`[ForumTopic:${key}] FormData sendPhoto error:`, formErr);
          }
        } else {
          // 2. Otherwise send photo as file_id or web URL via JSON
          try {
            const payload: any = {
              chat_id: groupId,
              parse_mode: 'HTML',
              photo: photoUrl,
              caption: messageText,
            };
            if (threadId) payload.message_thread_id = threadId;

            const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const photoData = (await photoRes.json().catch(() => ({}))) as any;
            if (photoData?.ok) return;

            // If threadId failed, retry without threadId
            if (threadId) {
              delete payload.message_thread_id;
              const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const retryData = (await retryRes.json().catch(() => ({}))) as any;
              if (retryData?.ok) return;
            }

            // If sendPhoto failed (e.g. document file_id), try sendDocument
            try {
              const docPayload: any = {
                chat_id: groupId,
                parse_mode: 'HTML',
                document: photoUrl,
                caption: messageText,
              };
              if (threadId) docPayload.message_thread_id = threadId;
              const docRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(docPayload),
              });
              const docData = (await docRes.json().catch(() => ({}))) as any;
              if (docData?.ok) return;
            } catch { /* ignore document fallback error */ }
          } catch (jsonErr) {
            console.error(`[ForumTopic:${key}] JSON sendPhoto error:`, jsonErr);
          }
        }
      }

      // 3. Text sendMessage delivery (HTML with thread, falling back to chat root and plain text)
      const textPayload: any = {
        chat_id: groupId,
        parse_mode: 'HTML',
        text: messageText,
      };
      if (threadId) textPayload.message_thread_id = threadId;

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textPayload),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (data?.ok) return;

      // If failed with threadId, retry without threadId
      if (threadId) {
        delete textPayload.message_thread_id;
        const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(textPayload),
        });
        const retryData = (await retryRes.json().catch(() => ({}))) as any;
        if (retryData?.ok) return;
      }

      // Plain text fallback if HTML parse failed
      const plainPayload: any = {
        chat_id: groupId,
        text: messageText.replace(/<[^>]+>/g, ''),
      };
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plainPayload),
      });
    } catch (err) {
      console.error(`Error sending to topic ${key}:`, err);
    }
  }

  // Core function to automatically setup forum topics when bot is added or made admin in a supergroup
  async function autoSetupGroupTopics(
    targetGroupId: string,
    groupTitle?: string,
    botToken?: string
  ): Promise<{ success: boolean; message: string; updatedTopics?: ForumTopicConfig[]; results?: any[] }> {
    const token = botToken || getTelegramBotToken();
    if (!token) {
      return { success: false, message: 'توکن ربات تلگرام تنظیم نشده است.' };
    }

    // 1. Verify chat info
    const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(targetGroupId)}`);
    const chatData = (await chatRes.json().catch(() => ({}))) as any;

    if (!chatData.ok) {
      console.error('[autoSetupGroupTopics] getChat failed:', chatData);
      return { success: false, message: `عدم دسترسی به گروه: ${chatData.description || 'گروه یافت نشد'}` };
    }

    const chat = chatData.result;
    const isForum = Boolean(chat.is_forum);
    const chatType = chat.type; // 'supergroup' | 'group'

    // 2. Check bot admin status and permissions
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = (await meRes.json().catch(() => ({}))) as any;
    const botId = meData.result?.id;

    let isBotAdmin = false;
    let canManageTopics = false;

    if (botId) {
      const memberRes = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(targetGroupId)}&user_id=${botId}`);
      const memberData = (await memberRes.json().catch(() => ({}))) as any;
      if (memberData.ok) {
        const member = memberData.result;
        isBotAdmin = member.status === 'administrator' || member.status === 'creator';
        canManageTopics = member.status === 'creator' || Boolean(member.can_manage_topics);
      }
    }

    // Always register this group ID so reports can reach it even if topics aren't set up yet
    botSettings.forumGroupId = targetGroupId;
    botSettings.forumGroupTitle = groupTitle || chat.title || botSettings.forumGroupTitle || 'سوپرگروه قنادی';
    saveSettings(botSettings);

    // 3. Handle when group is NOT a forum supergroup
    if (!isForum) {
      const notForumMsg = `⚠️ <b>قابلیت تاپیک‌ها (Topics) در این گروه روشن نیست!</b>\n\n🔹 جهت فعال‌سازی ساخت خودکار ۸ تاپیک قنادی:\n۱. وارد پروفایل گروه شده و دکمه <b>ویرایش (Edit)</b> را بزنید.\n۲. گزینه <b>«Topics / مباحث»</b> را روشن (Enable) کنید.\n۳. سپس مجدداً در گروه دستور <code>/setup_topics</code> را ارسال نمایید.\n\n📌 <i>نکته: تا زمان روشن کردن تاپیک‌ها، گزارشات فروشگاه مستقیماً به همین گروه ارسال می‌گردند.</i>`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetGroupId,
          text: notForumMsg,
          parse_mode: 'HTML',
        }),
      });
      return {
        success: false,
        message: 'قابلیت تاپیک‌ها در این گروه فعال نیست. لطفاً Topics را در تنظیمات گروه روشن کنید.',
      };
    }

    // 4. Handle when bot is not admin or missing topic management permission
    if (!isBotAdmin) {
      const notAdminMsg = `⚠️ <b>ربات هنوز در این سوپرگروه ادمین نشده است!</b>\n\nلطفاً ربات را با دسترسی <b>«Manage Topics / مدیریت تاپیک‌ها»</b> ادمین نمایید و سپس دستور <code>/setup_topics</code> را در گروه بفرستید.`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetGroupId,
          text: notAdminMsg,
          parse_mode: 'HTML',
        }),
      });
      return {
        success: false,
        message: 'ربات در این گروه دسترسی ادمین ندارد.',
      };
    }

    if (!canManageTopics) {
      const noPermMsg = `⚠️ <b>دسترسی مدیریت تاپیک‌ها به ربات داده نشده است!</b>\n\nلطفاً در بخش تنظیم دسترسی‌های ادمین برای ربات، گزینه <b>«Manage Topics / مدیریت مباحث»</b> را تیک بزنید و سپس دستور <code>/setup_topics</code> را ارسال کنید.`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetGroupId,
          text: noPermMsg,
          parse_mode: 'HTML',
        }),
      });
      return {
        success: false,
        message: 'دسترسی Manage Topics برای ربات فعال نیست.',
      };
    }

    // 5. Preconditions fully satisfied -> Create real Telegram forum topics
    const topicsToSetup = [
      {
        key: 'orders' as const,
        name: '📦 سفارشات آماده و ارسال',
        iconEmoji: '📦',
        color: 0x6FB9F0, // Blue
        desc: 'اعلان لحظه‌ای ثبت سفارشات جدید مشتریان، تغییر وضعیت پخت و ارسال پیک',
        introMsg: '📦 <b>تاپیک اختصاصی سفارشات و فاکتورها</b>\n\nکلیه سفارشات جدید ثبت‌شده در ربات به همراه جزئیات اقلام، آدرس، تلفن و دکمه‌های تغییر وضعیت لحظه‌ای در این تاپیک ارسال می‌شوند.'
      },
      {
        key: 'custom_orders' as const,
        name: '🎂 سفارشات کیک و دلخواه',
        iconEmoji: '🎂',
        color: 0xFF93B2, // Pink
        desc: 'سفارش‌های کیک و شیرینی دلخواه، طرح و عکس، قیمت‌گذاری سرقناد و بیعانه',
        introMsg: '🎂 <b>تاپیک اختصاصی کیک و شیرینی‌های سفارشی</b>\n\nکلیه درخواست‌های پخت کیک دلخواه، طرح‌های ارسالی مشتریان، تعیین قیمت و مراحل پخت در این تاپیک ارسال می‌شوند.'
      },
      {
        key: 'finance' as const,
        name: '💳 امور مالی و فیش‌های بانکی',
        iconEmoji: '💳',
        color: 0x8EEE98, // Green
        desc: 'فیش‌های واریزی کارت‌به‌کارت، تأیید/رد فیش‌ها، فاکتورهای دستی و کیف‌پول',
        introMsg: `💳 <b>تاپیک اختصاصی امور مالی و حسابداری</b>\n\nفیش‌های واریزی کارت‌به‌کارت، تایید تراکنش‌ها، فاکتورهای دستی و شارژ کیف‌پول در این تاپیک قرار می‌گیرد.\nشماره کارت مقصد: <code>${botSettings.cardNumber || '---'}</code>`
      },
      {
        key: 'products' as const,
        name: '🧁 ویترین و انبار محصولات',
        iconEmoji: '🧁',
        color: 0xFFD67E, // Yellow
        desc: 'افزودن محصول جدید، تغییر قیمت‌ها و وضعیت موجودی انبار',
        introMsg: '🧁 <b>تاپیک اختصاصی محصولات و انبارداری</b>\n\nگزارش افزودن کیک و شیرینی جدید، تغییرات قیمت و هشدارهای اتمام موجودی در این تاپیک درج می‌شود.'
      },
      {
        key: 'customers' as const,
        name: '👤 اعضا و باشگاه مشتریان',
        iconEmoji: '👤',
        color: 0xCB86DB, // Violet
        desc: 'عضویت کاربران جدید در ربات، ثبت و تغییر آدرس و ویرایش مشخصات مشتری',
        introMsg: '👤 <b>تاپیک اختصاصی باشگاه مشتریان</b>\n\nعضویت مشتریان جدید در ربات، ثبت آدرس‌های جدید و ویرایش مشخصات کاربران در این تاپیک لاگ می‌شود.'
      },
      {
        key: 'discounts' as const,
        name: '🎟️ جشنواره و کدهای تخفیف',
        iconEmoji: '🎟️',
        color: 0xFB6F5F, // Red
        desc: 'تعریف کدهای تخفیف جدید و گزارش لحظه‌ای استفاده مشتریان',
        introMsg: '🎟️ <b>تاپیک اختصاصی کدهای تخفیف و کمپین‌ها</b>\n\nاطلاع‌رسانی کدهای تخفیف فعال‌شده و گزارش استفاده مشتریان از تخفیف‌ها در این تاپیک ارسال می‌شود.'
      },
      {
        key: 'support' as const,
        name: '💬 پیام‌ها و پشتیبانی',
        iconEmoji: '💬',
        color: 0x6FB9F0, // Blue
        desc: 'پیام‌ها و تیکت‌های دریافتی از مشتریان و ارسال پاسخ پشتیبانی',
        introMsg: '💬 <b>تاپیک پشتیبانی و پیام‌های مشتریان</b>\n\nپیام‌ها، تیکت‌ها و درخواست‌های ارسالی مشتریان جهت پاسخگویی سریع تیم پشتیبانی در این تاپیک قرار می‌گیرد.'
      },
      {
        key: 'system_backups' as const,
        name: '💾 پشتیبان‌گیری و سیستم',
        iconEmoji: '💾',
        color: 0xCB86DB, // Violet
        desc: 'گزارش بکاپ‌های خودکار دیتابیس، اسنپ‌شات‌ها و وضعیت فنی سرور',
        introMsg: '💾 <b>تاپیک پشتیبان‌گیری، امنیت و سیستم</b>\n\nگزارش‌های زمان‌بندی‌شده پشتیبان‌گیری خودکار دیتابیس و نقاط بازیابی در این تاپیک ثبت می‌شوند.'
      },
    ];

    const results: any[] = [];
    let updatedTopics = [...(botSettings.forumTopics || [])];
    let createdCount = 0;

    for (let i = 0; i < topicsToSetup.length; i++) {
      const item = topicsToSetup[i];
      let threadId: number | undefined;
      let createdViaApi = false;

      try {
        const createRes = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetGroupId,
            name: item.name,
            icon_color: item.color,
          }),
        });
        let createData = (await createRes.json().catch(() => ({}))) as any;
        if (!createData.ok) {
          console.warn(`[telegram:topics] createForumTopic with color failed for ${item.name} (${createData.description}), retrying without color...`);
          const retryRes = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetGroupId,
              name: item.name,
            }),
          });
          createData = (await retryRes.json().catch(() => ({}))) as any;
        }

        if (createData.ok && createData.result?.message_thread_id) {
          threadId = Number(createData.result.message_thread_id);
          createdViaApi = true;
          createdCount++;
        } else {
          console.error(`[telegram:topics] Failed to create topic ${item.name}:`, createData);
        }
      } catch (e) {
        console.error(`Failed to create real Telegram topic ${item.name}:`, e);
      }

      if (threadId) {
        const existingIndex = updatedTopics.findIndex((t) => t.key === item.key);
        const topicObj = {
          id: `topic-${Date.now()}-${i}`,
          key: item.key,
          name: item.name,
          iconEmoji: item.iconEmoji,
          threadId: threadId,
          enabled: true,
          autoReport: true,
          description: item.desc,
          lastReportTime: new Date().toISOString(),
          lastReportSummary: `تاپیک ${item.name} با شناسه #${threadId} ساخته و متصل شد.`,
        };

        if (existingIndex !== -1) {
          updatedTopics[existingIndex] = { ...updatedTopics[existingIndex], ...topicObj };
        } else {
          updatedTopics.push(topicObj);
        }

        // Send intro message inside the topic thread
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetGroupId,
              message_thread_id: threadId,
              text: item.introMsg,
              parse_mode: 'HTML',
            }),
          });
        } catch (err) {
          console.error(`Failed to send intro to topic ${item.key}:`, err);
        }
      }

      results.push({
        key: item.key,
        name: item.name,
        threadId,
        createdViaApi,
      });
    }

    botSettings.forumTopics = updatedTopics;
    saveSettings(botSettings);

    // Send summary announcement into the group
    if (createdCount > 0) {
      try {
        const announcementText = `🎉 <b>ساخت تاپیک‌های اختصاصی قنادی با موفقیت انجام شد!</b>\n\n👑 <b>تعداد ${createdCount} تاپیک زیر در سوپرگروه ایجاد و آماده ارسال گزارش‌های زنده شدند:</b>\n\n📦 <b>تاپیک سفارشات آماده</b> (ثبت و پیگیری فاکتورها)\n🎂 <b>تاپیک کیک دلخواه</b> (طرح‌های سفارشی، قیمت‌گذاری و پخت)\n💳 <b>تاپیک امور مالی</b> (فیش‌های واریزی کارت‌به‌کارت و کیف‌پول)\n🧁 <b>تاپیک محصولات</b> (موجودی انبار و تغییر قیمت)\n👤 <b>تاپیک مشتریان</b> (عضویت جدید و ثبت آدرس)\n🎟️ <b>تاپیک تخفیف‌ها</b> (کدهای تخفیف و جشنواره)\n💬 <b>تاپیک پشتیبانی</b> (پیام‌ها و تیکت‌های مشتریان)\n💾 <b>تاپیک سیستم</b> (بکاپ خودکار و امنیت دیتابیس)\n\n⚡️ <i>از هم‌اکنون کلیه رویدادهای فروشگاه به صورت تفکیک‌شده به این تاپیک‌ها ارسال خواهند شد.</i>`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetGroupId,
            text: announcementText,
            parse_mode: 'HTML',
          }),
        });
      } catch (err) {
        console.error('Failed to send group master announcement:', err);
      }
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetGroupId,
          text: `⚠️ تلاش برای ساخت تاپیک‌ها انجام شد اما تلگرام اجازه ساخت تاپیک نداد. لطفاً مطمئن شوید دسترسی Manage Topics به ربات داده شده است.`,
          parse_mode: 'HTML',
        }),
      });
    }

    return {
      success: createdCount > 0,
      message: `تعداد ${createdCount} تاپیک با موفقیت ایجاد شد.`,
      updatedTopics,
      results,
    };
  }

  // Auto-create all topics in the Telegram Forum Supergroup
  app.post('/api/telegram/forum/setup-all-topics', async (req: Request, res: Response) => {
    const { groupId, title, token } = req.body;
    const targetGroupId = groupId || botSettings.forumGroupId;
    const botToken = token || getTelegramBotToken();

    if (!targetGroupId) {
      res.status(400).json({ success: false, message: 'شناسه گروه تاپیک‌دار (Group Chat ID) الزامی است.' });
      return;
    }

    try {
      const { updatedTopics, results } = await autoSetupGroupTopics(targetGroupId, title, botToken);
      res.json({
        success: true,
        message: `تعداد ${updatedTopics.length} تاپیک اختصاصی با موفقیت در گروه ${targetGroupId} ایجاد و همگام‌سازی شدند.`,
        topics: updatedTopics,
        results,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'خطا در ایجاد خودکار تاپیک‌ها: ' + err.message });
    }
  });

  // Simulated auto-group addition endpoint for testing from admin panel
  app.post('/api/telegram/forum/simulate-group-add', async (req: Request, res: Response) => {
    const simulatedGroupId = req.body.groupId || '-1002849173620';
    const simulatedGroupTitle = req.body.title || 'گروه پرسنل و مدیریت قنادی شیرین‌کام';

    const { updatedTopics, results } = await autoSetupGroupTopics(
      simulatedGroupId,
      simulatedGroupTitle,
      getTelegramBotToken()
    );

    // Also trigger initial live reports to demonstration
    const lastOrder = orders[0];
    if (lastOrder) {
      const lastOrderStatus = lastOrder.status === 'baking'
        ? '👩‍🍳 در حال پخت و تزیین'
        : lastOrder.status === 'receipt_confirmed'
          ? '✅ فیش تأیید شده؛ در انتظار شروع پخت'
          : '📌 در جریان پردازش';
      sendToTelegramTopic(
        'orders',
        `📦 <b>سفارش فعال</b>\n\n🔖 کد: <code>${lastOrder.orderNumber}</code>\n👤 خریدار: ${lastOrder.customerName}\n💰 مبلغ: ${lastOrder.totalAmount.toLocaleString('fa-IR')} تومان\n🛵 وضعیت: ${lastOrderStatus}`
      );
    }

    res.json({
      success: true,
      message: `ربات با موفقیت به گروه «${simulatedGroupTitle}» متصل شد و تمام ۶ تاپیک به صورت خودکار ایجاد شدند!`,
      groupId: simulatedGroupId,
      groupTitle: simulatedGroupTitle,
      topics: updatedTopics,
      results
    });
  });

  // Send single report / test report to a specific topic
  app.post('/api/telegram/forum/send-report', async (req: Request, res: Response) => {
    const { key, customText, customPhoto } = req.body;
    const topic = botSettings.forumTopics?.find((t) => t.key === key);

    if (!topic) {
      res.status(404).json({ success: false, message: 'تاپیک مورد نظر یافت نشد.' });
      return;
    }

    let reportMessage = customText;
    if (!reportMessage) {
      if (key === 'orders') {
        const lastOrder = orders[0];
        reportMessage = `📦 <b>گزارش لحظه‌ای سفارشات قنادی</b>\n\n🔖 <b>شماره آخرین سفارش:</b> <code>${lastOrder?.orderNumber || 'SH-8422'}</code>\n👤 <b>مشتری:</b> ${lastOrder?.customerName || 'سارا حسینی'}\n💰 <b>مبلغ کل:</b> ${(lastOrder?.totalAmount || 940000).toLocaleString('fa-IR')} تومان\n🛵 <b>وضعیت:</b> در حال آماده‌سازی و ارسال با پیک مخصوص`;
      } else if (key === 'custom_orders') {
        reportMessage = `🎂 <b>گزارش سفارشات کیک و شیرینی دلخواه</b>\n\n🔖 <b>تعداد کل طرح‌های سفارشی:</b> ${customOrders.length.toLocaleString('fa-IR')} عدد\n🎨 <b>آخرین سفارش:</b> کیک فوندانت مناسبتی\n👩‍🍳 <b>وضعیت:</b> متصل به کارگاه پخت شیرین‌کام`;
      } else if (key === 'finance') {
        const totalSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
        reportMessage = `💳 <b>گزارش وضعیت مالی و فیش‌های دریافتی</b>\n\n💎 <b>مجموع کل واریزی‌های ثبت‌شده:</b> ${totalSales.toLocaleString('fa-IR')} تومان\n🧾 <b>تعداد کل فاکتورها:</b> ${orders.length.toLocaleString('fa-IR')} عدد\n💳 <b>شماره کارت مقصد:</b> <code>${botSettings.cardNumber || '---'}</code> (${botSettings.cardHolder || 'قنادی شیرین‌کام'})`;
      } else if (key === 'products') {
        const availableCount = products.filter((p) => p.isAvailable).length;
        reportMessage = `🧁 <b>گزارش کاتالوگ و انبار شیرینی‌ها</b>\n\n▫️ کل تنوع کیک و شیرینی: <b>${products.length.toLocaleString('fa-IR')} قلم</b>\n▫️ محصولات آماده تحویل: <b>${availableCount.toLocaleString('fa-IR')} کالا</b>\n▫️ هشدار کسری موجودی: کلیه اقلام در وضعیت نرمال قرار دارند.`;
      } else if (key === 'customers') {
        reportMessage = `👤 <b>گزارش باشگاه مشتریان و اعضا</b>\n\n👥 <b>تعداد کل مشتریان:</b> ${customers.length.toLocaleString('fa-IR')} نفر\n📍 <b>کاربران دارای آدرس ثبت‌شده:</b> ${customers.filter((c) => (c.addresses || []).length > 0 || c.address).length.toLocaleString('fa-IR')} نفر`;
      } else if (key === 'discounts') {
        reportMessage = `🎟️ <b>گزارش کدهای تخفیف و کمپین‌ها</b>\n\n🔖 <b>کدهای فعال در حال حاضر:</b> ${discounts.filter((d) => d.isActive).length.toLocaleString('fa-IR')} کد\n🔥 <b>پرمصرف‌ترین کد:</b> ${discounts[0]?.code || 'SHIRIN20'} (${discounts[0]?.usedCount || 14} بار استفاده)`;
      } else if (key === 'support') {
        reportMessage = `💬 <b>کانال پشتیبانی و پیام‌های مشتریان</b>\n\n📩 پیام‌های جدید دریافتی از مشتریان مستقیماً در این تاپیک ارسال و لاگ می‌شوند تا تیم پاسخگویی سریعاً رسیدگی نماید.`;
      } else if (key === 'system_backups') {
        reportMessage = `💾 <b>گزارش وضعیت پشتیبان‌گیری و سیستم</b>\n\n🛡️ سیستم بکاپ خودکار سرور فعال است.\n📁 آخرین فایل بکاپ دیتابیس با موفقیت ثبت گردید.`;
      } else {
        // analytics
        const totalSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
        reportMessage = `📊 <b>گزارش جامع فروش روزانه قنادی شیرین‌کام</b>\n\n💰 <b>فروش کل:</b> ${totalSales.toLocaleString('fa-IR')} تومان\n📦 <b>تعداد سفارشات موفق:</b> ${orders.length.toLocaleString('fa-IR')} سفارش\n🏆 <b>پرفروش‌ترین کالا:</b> کیک تولد شکلاتی بلژیکی\n📈 <b>میانگین هر سبد خرید:</b> ${Math.round(totalSales / (orders.length || 1)).toLocaleString('fa-IR')} تومان`;
      }
    }

    await sendToTelegramTopic(key, reportMessage, customPhoto);

    res.json({
      success: true,
      message: `گزارش با موفقیت در تاپیک «${topic.name}» (Thread #${topic.threadId}) ثبت و ارسال گردید.`,
      topic,
      reportMessage,
    });
  });

  // ==========================================
  // --- Master Backup & Migration System ---
  // ==========================================

  // Helper to generate full master backup payload
  function generateBackupPayload(generatedBy: string = 'Admin-Manual'): MasterBackupPayload {
    const totalWalletBalances = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);
    const totalEntities = products.length + orders.length + customOrders.length + invoices.length + customers.length + walletTransactions.length + discounts.length + supportTickets.length;
    const nowIso = new Date().toISOString();

    const rawData = {
      products: JSON.parse(JSON.stringify(products)),
      orders: JSON.parse(JSON.stringify(orders)),
      customOrders: JSON.parse(JSON.stringify(customOrders)),
      invoices: JSON.parse(JSON.stringify(invoices)),
      customers: JSON.parse(JSON.stringify(customers)),
      walletTransactions: JSON.parse(JSON.stringify(walletTransactions)),
      discounts: JSON.parse(JSON.stringify(discounts)),
      supportTickets: JSON.parse(JSON.stringify(supportTickets)),
      botSettings: JSON.parse(JSON.stringify(omitPanelPassword(botSettings))),
      backupSchedule: JSON.parse(JSON.stringify(backupSchedule))
    };

    const payloadString = JSON.stringify(rawData);
    const checksum = crypto.createHash('sha256').update(payloadString).digest('hex');

    return {
      app: 'ShirinKam Pastry Management System',
      version: '2.5.0',
      exportTimestamp: nowIso,
      checksum,
      environment: 'production',
      metadata: {
        generatedBy,
        databaseEngine: 'MasterInMemoryEngine',
        totalEntities,
        totalWalletBalances,
        storeName: botSettings.storeName || 'قنادی شیرین‌کام',
        storePhone: botSettings.storePhone || '۰۲۱-۸۸۹۹۲۲۳۳'
      },
      data: rawData
    };
  }

  // Helper to create and store a server snapshot
  function createSnapshotInternal(
    type: 'manual' | 'scheduled' | 'pre_restore_safety' = 'manual',
    customName?: string
  ): BackupSnapshot {
    const payload = generateBackupPayload(type === 'scheduled' ? 'AutoScheduler-Daemon' : type === 'pre_restore_safety' ? 'SafetyGuard-BeforeRestore' : 'Admin-Manual');
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = customName || `shirinkam-backup-${type}-${dateStr}.json`;
    const serialized = JSON.stringify(payload, null, 2);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    // Persist physical backup JSON file to durable disk folder
    try {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      fs.writeFileSync(path.join(BACKUPS_DIR, filename), serialized, 'utf8');
    } catch (e) {
      console.error('[backup] Failed to write snapshot file to disk:', e);
    }

    const totalWalletBalance = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);

    const snapshot: BackupSnapshot = {
      id: `snap-${Date.now()}`,
      filename,
      timestamp: payload.exportTimestamp,
      type,
      sizeBytes,
      checksum: payload.checksum,
      version: payload.version,
      stats: {
        productsCount: products.length,
        ordersCount: orders.length,
        customOrdersCount: customOrders.length,
        invoicesCount: invoices.length,
        customersCount: customers.length,
        totalWalletBalance,
        discountsCount: discounts.length,
        ticketsCount: supportTickets.length,
        forumTopicsCount: botSettings.forumTopics?.length || 0
      },
      payload
    };

    backupSnapshots.unshift(snapshot);

    // Enforce retention limit and delete pruned snapshot files from disk
    const limit = backupSchedule.keepLastSnapshots || 10;
    if (backupSnapshots.length > limit) {
      const removed = backupSnapshots.slice(limit);
      backupSnapshots = backupSnapshots.slice(0, limit);
      for (const oldSnap of removed) {
        try {
          const oldPath = path.join(BACKUPS_DIR, oldSnap.filename);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch {}
      }
    }

    // Update last backup time
    backupSchedule.lastBackupTime = snapshot.timestamp;

    return snapshot;
  }

  function runScheduledBackupCheck() {
    if (!backupSchedule || !backupSchedule.enabled) return;
    const now = Date.now();
    const lastTime = backupSchedule.lastBackupTime ? new Date(backupSchedule.lastBackupTime).getTime() : 0;
    const intervals: Record<string, number> = {
      hourly: 3600 * 1000,
      every_6_hours: 6 * 3600 * 1000,
      every_12_hours: 12 * 3600 * 1000,
      daily: 24 * 3600 * 1000,
      weekly: 7 * 24 * 3600 * 1000,
      every_order: 3600 * 1000
    };
    const intervalMs = intervals[backupSchedule.frequency] || intervals.daily;
    if (now - lastTime >= intervalMs) {
      console.log(`[backup:daemon] Triggering automated scheduled backup (frequency: ${backupSchedule.frequency})`);
      const snapshot = createSnapshotInternal('scheduled');
      saveAllData();
      if (backupSchedule.notifyTelegramTopic) {
        sendToTelegramTopic(
          'system_backups',
          `💾 <b>پشتیبان‌گیری خودکار دیتابیس انجام شد:</b>\n\n📁 فایل: <code>${snapshot.filename}</code>\n👥 تعداد مشتریان: <b>${snapshot.stats.customersCount} نفر</b>\n📦 سفارشات: <b>${snapshot.stats.ordersCount}</b>\n💰 مجموع کیف‌پول: <b>${snapshot.stats.totalWalletBalance.toLocaleString('fa-IR')} تومان</b>`
        );
      }
    }
  }

  // 1. Export Master Backup (Download JSON)
  app.get('/api/backup/export', (req: Request, res: Response) => {
    try {
      const payload = generateBackupPayload('Admin-Export-Download');
      const filename = `shirinkam-master-backup-${new Date().toISOString().slice(0, 10)}.json`;

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: 'خطا در ایجاد خروجی پشتیبان: ' + err.message });
    }
  });

  // 2. Import & Restore Master Backup (Zero-loss Migration)
  app.post('/api/backup/import', (req: Request, res: Response) => {
    try {
      const { payload, mode = 'overwrite' } = req.body;

      if (!payload || !payload.data) {
        res.status(400).json({ success: false, message: 'ساختار فایل بکاپ نامعتبر است (شیء data یافت نشد).' });
        return;
      }

      const importedData = payload.data;

      // Create a safety restore point before overwriting
      createSnapshotInternal('pre_restore_safety', `safety-point-before-restore-${Date.now()}.json`);

      if (mode === 'overwrite') {
        // Full atomic overwrite
        if (Array.isArray(importedData.products)) {
          products = [...importedData.products];
        }
        if (Array.isArray(importedData.orders)) {
          orders = [...importedData.orders];
        }
        if (Array.isArray(importedData.customOrders)) {
          customOrders = [...importedData.customOrders];
        }
        if (Array.isArray(importedData.invoices)) {
          invoices = [...importedData.invoices].filter((invoice: Invoice) => invoice?.source === 'manual');
        }
        if (Array.isArray(importedData.customers)) {
          customers = dedupeCustomers([...importedData.customers]);
        }
        if (Array.isArray(importedData.walletTransactions)) {
          walletTransactions = [...importedData.walletTransactions];
        }
        if (Array.isArray(importedData.discounts)) {
          discounts = [...importedData.discounts];
        }
        if (Array.isArray(importedData.supportTickets)) {
          supportTickets = [...importedData.supportTickets];
        }
        if (importedData.botSettings && typeof importedData.botSettings === 'object') {
          botSettings = { ...botSettings, ...omitSettingsSecrets(importedData.botSettings) };
        }
        if (importedData.backupSchedule && typeof importedData.backupSchedule === 'object') {
          backupSchedule = { ...backupSchedule, ...importedData.backupSchedule };
        }
      } else {
        // Smart merge
        if (Array.isArray(importedData.products)) {
          const existingIds = new Set(products.map(p => p.id));
          importedData.products.forEach((p: Product) => {
            if (!existingIds.has(p.id)) products.push(p);
          });
        }
        if (Array.isArray(importedData.orders)) {
          const existingIds = new Set(orders.map(o => o.id));
          importedData.orders.forEach((o: Order) => {
            if (!existingIds.has(o.id)) orders.push(o);
          });
        }
        if (Array.isArray(importedData.customOrders)) {
          const existingIds = new Set(customOrders.map(o => o.id));
          importedData.customOrders.forEach((o: CustomPastryOrder) => {
            if (!existingIds.has(o.id)) customOrders.push(o);
          });
        }
        if (Array.isArray(importedData.invoices)) {
          const existingIds = new Set(invoices.map(invoice => invoice.id));
          importedData.invoices.forEach((invoice: Invoice) => {
            if (invoice?.source === 'manual' && !existingIds.has(invoice.id)) invoices.push(invoice);
          });
        }
        if (Array.isArray(importedData.customers)) {
          const existingIds = new Set(customers.map(c => c.id));
          importedData.customers.forEach((c: CustomerUser) => {
            if (!existingIds.has(c.id)) customers.push(c);
          });
        }
        if (Array.isArray(importedData.walletTransactions)) {
          const existingIds = new Set(walletTransactions.map(w => w.id));
          importedData.walletTransactions.forEach((w: WalletTransaction) => {
            if (!existingIds.has(w.id)) walletTransactions.push(w);
          });
        }
        if (Array.isArray(importedData.discounts)) {
          const existingCodes = new Set(discounts.map(d => d.code.toUpperCase()));
          importedData.discounts.forEach((d: DiscountCode) => {
            if (!existingCodes.has(d.code.toUpperCase())) discounts.push(d);
          });
        }
        if (Array.isArray(importedData.supportTickets)) {
          const existingIds = new Set(supportTickets.map(t => t.id));
          importedData.supportTickets.forEach((t: SupportTicket) => {
            if (!existingIds.has(t.id)) supportTickets.push(t);
          });
        }
      }

      const totalWalletBalance = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);

      // Persist a completed restore immediately so Railway redeploys cannot
      // discard the restored records or the sanitized settings state.
      saveAllData();
      saveSettings(botSettings);

      // Notify System Backups Telegram topic
      sendToTelegramTopic(
        'system_backups',
        `🛡️ <b>عملیات بازیابی و ریستور موفقیت‌آمیز دیتابیس:</b>\n\n✅ دیتابیس با موفقیت بازگردانی شد.\n👥 تعداد مشتریان: <b>${customers.length} نفر</b>\n💰 <b>مجموع موجودی کیف‌پول‌ها:</b> <b>${totalWalletBalance.toLocaleString('fa-IR')} تومان</b> (تضمین عدم کسر موجودی)\n📦 سفارشات عادی: <b>${orders.length} عدد</b>\n🎂 سفارشات دلخواه: <b>${customOrders.length} عدد</b>\n🧾 فاکتورهای دستی: <b>${invoices.length} عدد</b>\n🧁 محصولات: <b>${products.length} قلم</b>`
      );

      res.json({
        success: true,
        message: 'اطلاعات با موفقیت کامل و بدون هیچ نقصی بازیابی شد.',
        stats: {
          productsCount: products.length,
          ordersCount: orders.length,
          customOrdersCount: customOrders.length,
          invoicesCount: invoices.length,
          customersCount: customers.length,
          totalWalletBalance,
          discountsCount: discounts.length,
          ticketsCount: supportTickets.length,
          forumTopicsCount: botSettings.forumTopics?.length || 0
        },
        restoredEntitiesCount: products.length + orders.length + customOrders.length + invoices.length + customers.length + walletTransactions.length + discounts.length + supportTickets.length,
        totalWalletBalance
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'خطا در بازیابی اطلاعات: ' + err.message });
    }
  });

  // 3. Get all snapshots
  app.get('/api/backup/snapshots', (req: Request, res: Response) => {
    res.json(backupSnapshots.map(redactBackupSnapshot));
  });

  // 4. Create new snapshot on server
  app.post('/api/backup/snapshots', (req: Request, res: Response) => {
    try {
      const { customName } = req.body;
      const snapshot = createSnapshotInternal('manual', customName);
      sendToTelegramTopic(
        'system_backups',
        `💾 <b>نقطه بازیابی دستی جدید ثبت شد:</b>\n\n📁 فایل: <code>${snapshot.filename}</code>\n👥 مشتریان: <b>${snapshot.stats.customersCount} نفر</b>\n📦 سفارشات: <b>${snapshot.stats.ordersCount} عدد</b>\n💰 موجودی کیف‌پول: <b>${snapshot.stats.totalWalletBalance.toLocaleString('fa-IR')} تومان</b>`
      );
      res.status(201).json({
        success: true,
        message: 'نقطه بازیابی جدید روی سرور با موفقیت ایجاد گردید.',
        snapshot
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 5. Restore specific snapshot
  app.post('/api/backup/snapshots/:id/restore', (req: Request, res: Response) => {
    const { id } = req.params;
    const snap = backupSnapshots.find(s => s.id === id);
    if (!snap) {
      res.status(404).json({ success: false, message: 'نقطه بازیابی یافت نشد.' });
      return;
    }

    try {
      // Create safety snapshot before restoring
      createSnapshotInternal('pre_restore_safety', `pre-rollback-from-${id}.json`);

      const d = snap.payload.data;
      if (Array.isArray(d.products)) products = [...d.products];
      if (Array.isArray(d.orders)) orders = [...d.orders];
      if (Array.isArray(d.customOrders)) customOrders = [...d.customOrders];
      if (Array.isArray(d.invoices)) invoices = [...d.invoices].filter((invoice: Invoice) => invoice?.source === 'manual');
      if (Array.isArray(d.customers)) customers = dedupeCustomers([...d.customers]);
      if (Array.isArray(d.walletTransactions)) walletTransactions = [...d.walletTransactions];
      if (Array.isArray(d.discounts)) discounts = [...d.discounts];
      if (Array.isArray(d.supportTickets)) supportTickets = [...d.supportTickets];
      if (d.botSettings) botSettings = { ...botSettings, ...omitSettingsSecrets(d.botSettings) };

      const totalWalletBalance = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);
      saveAllData();
      saveSettings(botSettings);

      sendToTelegramTopic(
        'system_backups',
        `🛡️ <b>بازیابی موفق به نسخه پشتیبان «${snap.filename}»:</b>\n\n👥 مشتریان: <b>${customers.length} نفر</b>\n📦 سفارشات: <b>${orders.length} عدد</b>\n💰 موجودی کل کیف‌پول‌ها: <b>${totalWalletBalance.toLocaleString('fa-IR')} تومان</b>`
      );

      res.json({
        success: true,
        message: `نسخه پشتیبان «${snap.filename}» با موفقیت اعمال گردید.`,
        stats: snap.stats,
        totalWalletBalance
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'خطا در بازیابی: ' + err.message });
    }
  });

  // 6. Delete snapshot
  app.delete('/api/backup/snapshots/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const target = backupSnapshots.find(s => s.id === id);
    if (target) {
      try {
        const filePath = path.join(BACKUPS_DIR, target.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
    backupSnapshots = backupSnapshots.filter(s => s.id !== id);
    saveAllData();
    res.json({ success: true, message: 'نقطه بازیابی حذف گردید.' });
  });

  // 7. Get backup schedule
  app.get('/api/backup/schedule', (req: Request, res: Response) => {
    res.json(backupSchedule);
  });

  // 8. Update backup schedule
  app.put('/api/backup/schedule', (req: Request, res: Response) => {
    backupSchedule = { ...backupSchedule, ...req.body };
    saveAllData();
    runScheduledBackupCheck();
    res.json({
      success: true,
      message: 'تنظیمات زمان‌بندی پشتیبان‌گیری با موفقیت ذخیره شد.',
      schedule: backupSchedule
    });
  });

  // ==========================================
  // --- Customers & Wallets API ---
  // ==========================================

  // Get all customers
  app.get('/api/customers', (req: Request, res: Response) => {
    res.json(customers);
  });

  // Create or update customer
  app.post('/api/customers', (req: Request, res: Response) => {
    try {
      const { id, telegramId, name, phone, username, address, walletBalance } = req.body;
      const normalizedPhone = typeof phone === 'string' ? phone.trim() : (phone || '');
      const normalizedName = typeof name === 'string' ? name.trim() : (name || '');
      const existingIndex = customers.findIndex(c => c.id === id || (telegramId && String(c.telegramId) === String(telegramId)));

      if (existingIndex !== -1) {
        const existing = customers[existingIndex];
        const mergedAddresses = new Set<string>([
          ...(existing.addresses || []),
          ...(Array.isArray(req.body.addresses) ? req.body.addresses : []),
          ...(address ? [String(address)] : [])
        ].filter(Boolean) as string[]);
        customers[existingIndex] = {
          ...existing,
          ...req.body,
          name: isRealName(normalizedName) ? normalizedName : existing.name,
          // A name entered by an admin is a confirmed profile name.
          nameConfirmed: isRealName(normalizedName) ? true : existing.nameConfirmed,
          phone: normalizedPhone || existing.phone,
          addresses: Array.from(mergedAddresses).slice(-20),
          lastActiveAt: new Date().toISOString()
        };
        saveAllData();
        res.json(customers[existingIndex]);
      } else {
        const newCustomer: CustomerUser = {
          id: id || `usr-${Date.now()}`,
          telegramId: telegramId ? String(telegramId) : `manual_${Date.now()}`,
          name: normalizedName || 'مشتری جدید',
          // Admin-entered name is confirmed.
          nameConfirmed: isRealName(normalizedName),
          phone: normalizedPhone,
          username: username || '',
          address: address || '',
          addresses: address ? [String(address).trim()].filter(Boolean) : [],
          source: telegramId ? 'bot' : 'manual',
          walletBalance: Number(walletBalance) || 0,
          rewardPoints: 50,
          totalOrdersCount: 0,
          totalSpentTomans: 0,
          tier: 'bronze',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString()
        };
        customers.unshift(newCustomer);
        saveAllData();
        sendToTelegramTopic(
          'customers',
          `👤 <b>مشتری جدید در پنل مدیریت ثبت شد:</b>\n\n👤 نام: <b>${escapeTelegramHtml(newCustomer.name)}</b>\n📞 تلفن: <code>${newCustomer.phone || '---'}</code>\n🏠 آدرس: ${newCustomer.address || '---'}`
        );
        res.status(201).json(newCustomer);
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin edit of a customer's identity/contact details. Only whitelisted
  // fields can change here (never wallet, points, stats or tier).
  app.put('/api/customers/:id', (req: Request, res: Response) => {
    try {
      const index = customers.findIndex(c => c.id === req.params.id);
      if (index === -1) {
        res.status(404).json({ error: 'کاربر یافت نشد.' });
        return;
      }
      const customer = customers[index];
      const b = req.body || {};
      const clean: Partial<CustomerUser> = {};

      if (typeof b.name === 'string' && b.name.trim()) {
        clean.name = b.name.trim();
        // A name set by the admin is a confirmed profile name.
        clean.nameConfirmed = true;
      }
      if (typeof b.phone === 'string') clean.phone = b.phone.trim();
      if (typeof b.username === 'string') clean.username = b.username.trim().replace(/^@/, '');
      if (b.telegramId !== undefined && b.telegramId !== null && String(b.telegramId).trim()) {
        clean.telegramId = String(b.telegramId).trim();
      }

      // Address book: accept either a full list replacement (array) or a single
      // new current address. Keep them in sync with the legacy `address` MRU.
      let addresses: string[] = Array.isArray(customer.addresses) ? [...customer.addresses] : (customer.address ? [customer.address] : []);
      if (Array.isArray(b.addresses)) {
        addresses = b.addresses.map((a: unknown) => String(a || '').trim()).filter(Boolean);
      }
      if (typeof b.address === 'string' && b.address.trim()) {
        const a = b.address.trim();
        if (!addresses.includes(a)) addresses.push(a);
      }
      clean.addresses = Array.from(new Set(addresses)).slice(-20);
      if (clean.addresses.length > 0) clean.address = clean.addresses[clean.addresses.length - 1];

      if (b.source === 'manual' || b.source === 'bot') clean.source = b.source;

      customers[index] = { ...customer, ...clean, lastActiveAt: new Date().toISOString() };
      saveAllData();
      sendToTelegramTopic(
        'customers',
        `👤 <b>ویرایش مشخصات مشتری در پنل:</b>\n\n👤 نام: <b>${escapeTelegramHtml(customers[index].name)}</b>\n📞 تلفن: <code>${customers[index].phone || '---'}</code>\n🏠 آدرس: ${customers[index].address || '---'}`
      );
      res.json(customers[index]);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Adjust customer wallet balance
  app.post('/api/customers/:id/wallet-adjust', (req: Request, res: Response) => {
    const { id } = req.params;
    const { amount, type = 'admin_adjustment', description = 'تغییر موجودی توسط مدیریت' } = req.body;

    const customerIndex = customers.findIndex(c => c.id === id);
    if (customerIndex === -1) {
      res.status(404).json({ error: 'کاربر یافت نشد.' });
      return;
    }

    const delta = Number(amount) || 0;
    const currentBalance = customers[customerIndex].walletBalance || 0;
    const newBalance = Math.max(0, currentBalance + delta);
    customers[customerIndex].walletBalance = newBalance;

    const transaction: WalletTransaction = {
      id: `wtx-${Date.now()}`,
      customerId: id,
      customerName: customers[customerIndex].name,
      type: type as any,
      amount: delta,
      description,
      createdAt: new Date().toISOString(),
      balanceAfter: newBalance
    };

    walletTransactions.unshift(transaction);

    // Notify finance topic if significant
    sendToTelegramTopic(
      'finance',
      `👛 <b>تغییر موجودی کیف پول مشتری:</b>\n\n👤 مشتری: <b>${customers[customerIndex].name}</b>\n💵 مبلغ تغییر: <b>${delta > 0 ? `+${delta.toLocaleString('fa-IR')}` : delta.toLocaleString('fa-IR')} تومان</b>\n💰 موجودی نهایی: <b>${newBalance.toLocaleString('fa-IR')} تومان</b>\n📝 علت: ${description}`
    );

    res.json({
      success: true,
      customer: customers[customerIndex],
      transaction
    });
  });

  // Get wallet transactions history
  app.get('/api/wallet/transactions', (req: Request, res: Response) => {
    res.json(walletTransactions);
  });

  // Telegram helper functions for live bot polling
  let pollingStopped = false;
  let pollInFlight = false;
  let conflictWarned = false;

  function stopTelegramPolling() {
    pollingStopped = true;
    if (pollingInterval) {
      clearTimeout(pollingInterval);
      pollingInterval = null;
    }
    isPolling = false;
  }

  function restartTelegramPolling(token: string) {
    stopTelegramPolling();
    startTelegramPolling(token);
  }

  console.log(`[telegram:${INSTANCE_ID}] polling controller initialized (pid=${process.pid})`);

  function startTelegramPolling(token: string) {
    if (isPolling) return;
    isPolling = true;
    pollingStopped = false;
    console.log(`[telegram:${INSTANCE_ID}] starting long-poll loop`);

    // Long polling and a webhook cannot coexist: if a webhook is (or was) set,
    // getUpdates returns nothing and every button tap silently dies. Drop any
    // webhook and let pending updates arrive via polling.
    (async () => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
      } catch (e) {
        console.error('[telegram] deleteWebhook failed:', e);
      }
    })();

    // Self-scheduling long-poll loop: exactly ONE getUpdates request is in
    // flight at a time. The previous setInterval-based loop fired every 3s
    // while the previous long-poll (timeout=5s) was still open, so two requests
    // with the same token overlapped and Telegram terminated one with 409
    // Conflict — which also split updates and made buttons appear dead. A long
    // timeout (50s) also keeps this instance holding the getUpdates "lock", so
    // any stray other process keeps losing instead of stealing our updates.
    const pollOnce = async () => {
      if (pollingStopped) return;
      if (pollInFlight) { poll(); return; }
      pollInFlight = true;
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${pollingOffset}&timeout=50`
        );
        const data = (await response.json()) as any;
        if (pollingStopped) { pollInFlight = false; return; }
        if (data.ok && Array.isArray(data.result)) {
          conflictWarned = false; // we hold the lock again
          const got = data.result.length;
          for (const update of data.result) {
            pollingOffset = update.update_id + 1;
            await safeHandleTelegramUpdate(token, update);
          }
          // Re-issue getUpdates immediately (no idle gap) so this instance
          // always holds a pending long-poll, minimising the chance a stale
          // external instance steals an update.
          if (got > 0) { pollInFlight = false; setImmediate(pollOnce); return; }
        } else if (data && data.error_code === 409) {
          // A genuine external instance is polling the same token. Log the
          // instance id once and re-grab as soon as possible.
          if (!conflictWarned) {
            console.error(`[telegram:${INSTANCE_ID}] 409 CONFLICT: ANOTHER process is polling this same bot token. Only ONE instance may run the bot. Re-claiming...`);
            conflictWarned = true;
          }
          pollInFlight = false;
          pollingInterval = setTimeout(pollOnce, 1000);
          return;
        } else if (data && !data.ok) {
          console.error('[telegram] getUpdates error:', data.error_code, data.description);
          pollInFlight = false;
          pollingInterval = setTimeout(pollOnce, 3000);
          return;
        }
      } catch (err) {
        console.error('Error during Telegram update polling:', err);
        pollInFlight = false;
        pollingInterval = setTimeout(pollOnce, 3000);
        return;
      }
      pollInFlight = false;
      poll();
    };

    function poll() {
      if (pollingStopped) return;
      pollingInterval = setTimeout(pollOnce, 100);
    }

    poll();
  }

  // Safety wrapper around a single Telegram update. Any throw inside a handler
  // must NEVER leave the customer staring at a dead button: log the full error
  // (so it is diagnosable from Railway logs), free any half-finished checkout
  // state, and send a visible recovery message. Without this, the polling loop
  // swallows the error silently and the inline button appears to do nothing.
  async function safeHandleTelegramUpdate(token: string, update: any): Promise<void> {
    try {
      await handleTelegramLiveUpdate(token, update);
    } catch (err) {
      const chatId = String(
        update?.callback_query?.message?.chat?.id
        || update?.message?.chat?.id
        || '',
      );
      const cbId = update?.callback_query?.id;
      console.error('[telegram] update handling failed:', err);
      try {
        if (cbId) {
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cbId, text: 'مشکلی پیش آمد؛ لطفاً دوباره تلاش کنید.' }),
          });
        }
      } catch { /* ignore */ }
      if (chatId) {
        // Clear a possibly half-finished checkout flow so the next tap starts fresh.
        const stuck = userStates.get(chatId);
        if (stuck && (stuck.mode === 'checkout_confirm' || String(stuck.mode || '').startsWith('checkout_'))) {
          userStates.delete(chatId);
        }
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: 'HTML',
              text: '⚠️ متأسفیم، در پردازش این مرحله مشکلی پیش آمد.\n\nلطفاً دوباره از سبد خرید اقدام کنید؛ اگر سبد خالی شده، محصولات را یک‌بار دیگر انتخاب کنید.',
              reply_markup: { inline_keyboard: [
                [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }],
                [{ text: '🍰 منوی محصولات', callback_data: 'menu_categories' }],
              ] },
            }),
          });
        } catch { /* ignore */ }
      }
    }
  }

  // Telegram albums (media groups) arrive as separate photo updates sharing a
  // media_group_id. The first photo of an album parks its updates for ~1.6s;
  // the remaining photos are appended to the same batch, after which a single
  // processing pass runs with the full file list — so a customer sending
  // several images at once receives ONE acknowledgment, not one per photo.
  const pendingAlbums = new Map<string, { files: string[]; firstMsg: any }>();
  function deferAlbumUpdate(token: string, msg: any, fileId: string): boolean {
    const groupId = String(msg?.media_group_id || '');
    if (!groupId || !fileId) return false;
    const existing = pendingAlbums.get(groupId);
    if (existing) {
      if (!existing.files.includes(fileId)) existing.files.push(fileId);
      return true; // handled by the batch; do not process now
    }
    const entry = { files: [fileId], firstMsg: msg };
    pendingAlbums.set(groupId, entry);
    setTimeout(() => {
      pendingAlbums.delete(groupId);
      const allFiles = entry.files;
      const batched = entry.firstMsg;
      void safeHandleTelegramUpdate(token, {
        message: {
          ...batched,
          photo: [{ file_id: allFiles[allFiles.length - 1] }],
          document: undefined,
          media_group_id: undefined,
          __albumFiles: allFiles,
        },
      });
    }, 1600);
    return true; // claimed by the batch
  }

  // Send the exact same welcome text + main menu keyboard that /start shows.
  // Used both for /start and for every "back to main menu" button, so the
  // customer always sees the same main menu (no stray cake photo / store name).
  async function sendBotMainMenu(token: string, chatId: string, from: any) {
    const storeName = botSettings.storeName || 'فروشگاه آنلاین';
    const welcomeMsg = tmsg('welcomeMessage', { storeName });
    const inlineKeyboard: any[][] = [
      [{ text: '🍰 منوی محصولات و سفارش آنلاین', callback_data: 'menu_categories' }],
      [{ text: '🎨 محصول سفارشی شما', callback_data: 'custom_product_start' }],
      [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }],
      [{ text: '📦 پیگیری سفارشات من', callback_data: 'track_order' }],
      [{ text: '👤 پروفایل من', callback_data: 'my_profile' }],
      [{ text: '📍 آدرس و اطلاعات تماس', callback_data: 'contact_info' }],
      [{ text: '💬 ارسال پیام به پشتیبانی', callback_data: 'support_send' }],
      [{ text: '📋 مشاهده تیکت‌های من', callback_data: 'my_tickets' }],
    ];
    if (isTelegramAdmin(String(from?.id ?? chatId))) {
      inlineKeyboard.push([{ text: '👨‍🍳 پنل مدیریت', callback_data: 'admin_panel' }]);
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: welcomeMsg,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  }

  async function handleTelegramLiveUpdate(token: string, update: any) {
    /**
     * Complete the optional scheduling portion of a quoted custom order and
     * move the customer to payment selection. Both message and skip callbacks
     * use this one path so bypassing date/time cannot bypass contact checks.
     */
    const finishCustomOrderRegistration = async (
      chatId: string,
      registrationState: any,
      telegramUser?: any,
    ): Promise<boolean> => {
      const order = customOrders.find((item) => item.id === registrationState.orderId);
      if (!order || String(order.customerTelegramId) !== chatId) {
        userStates.delete(chatId);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '❌ سفارش یافت نشد یا امکان ثبت آن برای شما وجود ندارد.',
            parse_mode: 'HTML',
          }),
        });
        return false;
      }

      const profile = getTelegramProfile(telegramUser);
      order.customerName = registrationState.customerName || order.customerName;
      order.customerPhone = registrationState.customerPhone || order.customerPhone;
      order.deliveryAddress = registrationState.deliveryAddress || order.deliveryAddress;
      order.customerUsername = profile.username || registrationState.customerUsername || order.customerUsername;
      order.customerTelegramName = profile.displayName || registrationState.customerTelegramName || order.customerTelegramName;
      // موعد تحویل (تاریخ/ساعت) دیگر از مشتری دریافت نمی‌شود.
      order.deliveryDate = undefined;
      order.deliveryTimeSlot = undefined;
      order.updatedAt = new Date().toISOString();
      upsertCustomerFromCustomOrder(order);
      saveAllData();

      userStates.set(chatId, { mode: 'custom_order_payment_method', orderId: order.id });
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: tmsg('registrationCompleteMessage', {
            finalPrice: order.finalPrice?.toLocaleString() || '---',
            prepaymentAmount: order.prepaymentAmount?.toLocaleString() || '---',
          }),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [
            [{ text: '💵 پرداخت در محل', callback_data: `custom_order_cash_${order.id}` }],
            [{ text: '💳 پرداخت هم اکنون', callback_data: `custom_order_online_${order.id}` }],
            [{ text: '❌ انصراف', callback_data: 'back_to_main' }],
          ] },
        }),
      });
      return true;
    };

    // 1. Handle bot status in group (my_chat_member)
    // Note: Do NOT auto-create topics here. Topics are created only when
    // an authorized administrator explicitly sends /setup_topics or triggers it from the panel.
    if (update.my_chat_member) {
      const mcm = update.my_chat_member;
      const chat = mcm.chat;
      const newStatus = mcm.new_chat_member?.status;

      if (chat && (chat.type === 'supergroup' || chat.type === 'group')) {
        const groupId = chat.id.toString();
        const groupTitle = chat.title || 'سوپرگروه قنادی';
        const actorId = String(mcm.from?.id ?? '');

        botSettings.forumGroupId = groupId;
        botSettings.forumGroupTitle = groupTitle;
        saveSettings(botSettings);

        if (newStatus === 'administrator') {
          console.log(`Bot promoted to administrator in ${groupTitle} (${groupId})`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: groupId,
              text: `✅ <b>ربات مدیریت قنادی با موفقیت ادمین شد.</b>\n\n📌 جهت ساخت ۸ تاپیک تفکیک‌شده گزارشات، لطفاً دستور <code>/setup_topics</code> را در گروه ارسال فرمایید.`,
              parse_mode: 'HTML',
            }),
          });
        }
      }
      return;
    }

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id.toString();
      const text = msg.text || '';
      const incomingImageFileId = getTelegramImageFileId(msg);
      const chatType = msg.chat.type;
      // Broadcasts are for opted-in private chats, never every group that adds
      // this bot.
      if (chatType === 'private') registeredTelegramChatIds.add(chatId);

      // Photo albums share a media_group_id: park every update of the album
      // and process it once with the full list (single reply).
      if (chatType === 'private' && incomingImageFileId && msg.media_group_id && !msg.__albumFiles) {
        const claimed = deferAlbumUpdate(token, msg, incomingImageFileId);
        if (claimed) return;
      }

      // Handle bot added to group via new_chat_members
      if (msg.new_chat_members && (chatType === 'supergroup' || chatType === 'group')) {
        const hasBot = msg.new_chat_members.some((u: any) => u.is_bot);
        if (hasBot) {
          const introMsg = `👋 <b>سلام! ربات مدیریت قنادی شیرین‌کام به گروه اضافه شد.</b>\n\n📌 <b>جهت راه‌اندازی و تفکیک ۸ تاپیک گزارشات:</b>\n۱️⃣ در تنظیمات گروه (Edit Group)، گزینه <b>«Topics / مباحث»</b> را فعال کنید.\n۲️⃣ ربات را با دسترسی <b>«Manage Topics / مدیریت تاپیک‌ها»</b> ادمین فرمایید.\n۳️⃣ سپس دستور <code>/setup_topics</code> را در گروه ارسال کنید.`;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: introMsg, parse_mode: 'HTML' }),
          });
        }
      }

      // Handle /setup_topics or /connect_group command
      const isSetupTopicsCmd = text.startsWith('/setup_topics') || text.startsWith('/connect_group') || text.startsWith('/setup');
      if ((chatType === 'supergroup' || chatType === 'group') && isSetupTopicsCmd) {
        const actorId = String(msg.from?.id ?? '');
        if (!isTelegramAdmin(actorId)) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '⛔️ فقط مدیر مجاز می‌تواند تاپیک‌های گزارش را راه‌اندازی کند.', parse_mode: 'HTML' })
          });
          return;
        }
        await autoSetupGroupTopics(chatId, msg.chat.title, token);
        return;
      }

      if (text === '/start') {
        userStates.delete(chatId);

        // One Telegram account = one customer record. Never create duplicates;
        // just keep the profile (name/username) current.
        const isNew = !customers.some(c => String(c.telegramId) === String(chatId));
        const startProfile = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim();
        upsertBotCustomer(customers, {
          telegramId: chatId,
          name: startProfile,
          username: msg.from?.username || '',
        });
        saveAllData();

        if (isNew) {
          sendToTelegramTopic(
            'customers',
            `👤 <b>عضویت مشتری جدید در ربات:</b>\n\n👤 نام اکانت: <b>${escapeTelegramHtml(startProfile || 'کاربر بدون نام')}</b>\n🆔 شناسه تلگرام: <code>${chatId}</code>\n${msg.from?.username ? `💬 یوزرنیم: @${msg.from.username}\n` : ''}📅 ساعت: ${new Date().toLocaleTimeString('fa-IR')}`
          );
        }

        await sendBotMainMenu(token, chatId, msg.from);
      } else if (text === '/admin') {
        if (!isTelegramAdmin(String(msg.from?.id ?? chatId))) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '⛔️ شما اجازه دسترسی به پنل مدیریت را ندارید.', parse_mode: 'HTML' })
          });
          return;
        }
        const tgCtx = { token, chatId, products, orders, discounts, customers, supportTickets, customOrders, invoices, botSettings, userCarts, userStates, telegramUser: msg.from };
        await handleAdminCallback(tgCtx, 'admin_panel');
        saveAllData();
        return;
      } else if (!incomingImageFileId) {
        // Dispatch ordinary text messages to the state machine.  The previous
        // photo-handler refactor accidentally removed this dispatch, so states
        // such as support_subject never received the title sent by the customer.
        const tgCtx = { token, chatId, products, orders, discounts, customers, supportTickets, customOrders, invoices, botSettings, userCarts, userStates, telegramUser: msg.from };
        const stateHandled = await handleTextMessage(tgCtx, text);
        if (stateHandled) {
          // Persist immediately on Railway instead of waiting for the periodic
          // autosave; this keeps a newly completed ticket across a restart.
          saveAllData();
          return;
        }

        // Profile -> add a new address to the customer's address book.
        const profileAddrState = userStates.get(chatId);
        if (profileAddrState && profileAddrState.mode === 'profile_add_address') {
          const newAddress = text.trim();
          if (newAddress.length < 5) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً آدرس دقیق‌تری وارد کنید (حداقل ۵ حرف):', parse_mode: 'HTML' })
            });
            return;
          }
          const profile = getTelegramProfile(msg.from);
          const customer = upsertBotCustomer(customers, {
            telegramId: chatId,
            name: profile.displayName,
            username: profile.username,
            address: newAddress,
            source: 'bot',
          });
          saveAllData();
          userStates.delete(chatId);
          sendToTelegramTopic(
            'customers',
            `📍 <b>ثبت آدرس جدید توسط مشتری در ربات:</b>\n\n👤 مشتری: <b>${escapeTelegramHtml(customer.name || 'مشتری')}</b>\n🆔 شناسه تلگرام: <code>${chatId}</code>\n🏠 آدرس جدید:\n<i>${escapeTelegramHtml(newAddress)}</i>`
          );
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: 'HTML',
              text: `✅ آدرس جدید به پروفایل شما اضافه شد.\n\n<b>آدرس‌های شما:</b>\n${(customer.addresses || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
              reply_markup: { inline_keyboard: [
                [{ text: '👤 مشاهده پروفایل', callback_data: 'my_profile' }],
                [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }],
              ] }
            })
          });
          return;
        }

        // Handle custom quantity input
        const qtyState = userStates.get(chatId);
        if (qtyState && qtyState.mode === 'custom_qty_input') {
          const qty = parseFloat(text);
          if (isNaN(qty) || qty <= 0) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً یک عدد معتبر وارد کنید:', parse_mode: 'HTML' })
            });
            return;
          }
          const prod = products.find(p => p.id === qtyState.productId);
          if (prod) {
            const cart = userCarts.get(chatId) || [];
            const existing = cart.find(i => i.productId === prod.id);
            if (existing) { existing.quantity += qty; } else { cart.push({ productId: prod.id, quantity: qty }); }
            userCarts.set(chatId, cart);
            const totalQty = cart.reduce((s, i) => s + i.quantity, 0);
            userStates.delete(chatId);
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: `✅ <b>${qty} ${prod.unit}</b> از «${prod.name}» به سبد خرید افزوده شد.\n\n🛒 <b>تعداد کل اقلام سبد:</b> ${totalQty}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🛒 سبد خرید', callback_data: 'view_cart' }], [{ text: '🍰 ادامه خرید', callback_data: 'menu_categories' }]] } })
            });
          }
          return;
        }
        // Handle "add to cart -> then type a quantity" flow (add_to_cart_).
        const askQtyState = userStates.get(chatId);
        if (askQtyState && askQtyState.mode === 'ask_quantity') {
          const qty = parseFloat(text);
          if (isNaN(qty) || qty <= 0) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً یک عدد معتبر وارد کنید (مثلاً: 2):', parse_mode: 'HTML' })
            });
            return;
          }
          const prod = products.find(p => p.id === askQtyState.productId);
          if (prod) {
            const cart = userCarts.get(chatId) || [];
            const existing = cart.find(i => i.productId === prod.id);
            if (existing) { existing.quantity += qty; } else { cart.push({ productId: prod.id, quantity: qty }); }
            userCarts.set(chatId, cart);
            const totalQty = cart.reduce((s, i) => s + i.quantity, 0);
            userStates.delete(chatId);
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: `✅ <b>${qty} ${prod.unit}</b> از «${prod.name}» به سبد خرید افزوده شد.\n\n🛒 <b>تعداد کل اقلام سبد:</b> ${totalQty}`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🛒 مشاهده سبد خرید و پرداخت', callback_data: 'view_cart' }], [{ text: '🍰 ادامه خرید', callback_data: 'menu_categories' }]] } })
            });
          }
          return;
        }
        // Handle checkout flow text messages
        const checkoutState = userStates.get(chatId);
        // A quoted custom product becomes a real order only after the
        // customer provides contact details and their requested Iran-local
        // delivery date/time. Each completed step is persisted immediately.
        const customOrderRegisterState = userStates.get(chatId);
        if (customOrderRegisterState && customOrderRegisterState.mode === 'custom_order_register_name') {
          const customerName = text.trim();
          if (customerName.length < 2) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً نام و نام خانوادگی معتبر را وارد کنید:', parse_mode: 'HTML' })
            });
            return;
          }
          const profile = getTelegramProfile(msg.from);
          customOrderRegisterState.customerName = customerName;
          customOrderRegisterState.customerUsername = profile.username || customOrderRegisterState.customerUsername;
          customOrderRegisterState.customerTelegramName = profile.displayName || customOrderRegisterState.customerTelegramName;
          customOrderRegisterState.mode = 'custom_order_register_phone';
          userStates.set(chatId, customOrderRegisterState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '✅ نام ثبت شد.\n\n📞 <b>مرحله ۲ از ۳:</b> لطفاً <b>شماره تلفن</b> خود را وارد کنید:',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] }
            })
          });
          return;
        }
        if (customOrderRegisterState && customOrderRegisterState.mode === 'custom_order_register_phone') {
          const customerPhone = text.trim();
          if (customerPhone.length < 7) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً شماره تلفن معتبر را وارد کنید:', parse_mode: 'HTML' })
            });
            return;
          }
          customOrderRegisterState.customerPhone = customerPhone;
          customOrderRegisterState.mode = 'custom_order_register_address';
          userStates.set(chatId, customOrderRegisterState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '✅ شماره تلفن ثبت شد.\n\n🏠 <b>مرحله ۳ از ۳:</b> لطفاً <b>آدرس دقیق تحویل</b> را وارد کنید:',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] }
            })
          });
          return;
        }
        if (customOrderRegisterState && (customOrderRegisterState.mode === 'custom_order_register_address' || customOrderRegisterState.mode === 'custom_order_register_address_new')) {
          const deliveryAddress = text.trim();
          if (deliveryAddress.length < 5) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '❌ لطفاً آدرس دقیق‌تری وارد کنید:', parse_mode: 'HTML' })
            });
            return;
          }

          customOrderRegisterState.deliveryAddress = deliveryAddress;
          const order = customOrders.find((item) => item.id === customOrderRegisterState.orderId);
          if (order) {
            const profile = getTelegramProfile(msg.from);
            order.customerName = customOrderRegisterState.customerName || order.customerName;
            order.customerPhone = customOrderRegisterState.customerPhone || order.customerPhone;
            order.deliveryAddress = deliveryAddress;
            order.customerUsername = profile.username || customOrderRegisterState.customerUsername || order.customerUsername;
            order.customerTelegramName = profile.displayName || customOrderRegisterState.customerTelegramName || order.customerTelegramName;
            order.updatedAt = new Date().toISOString();
            upsertCustomerFromCustomOrder(order);
            saveAllData();
          }

          // Delivery date/time is no longer collected from customers; the
          // workshop coordinates timing directly after order acceptance.
          await finishCustomOrderRegistration(chatId, customOrderRegisterState, msg.from);
          return;
        }
        // Delivery date/time ("موعد تحویل") is no longer collected in the bot
        // flow; timing is coordinated directly with the customer afterwards.
        // Handle custom product text inputs
        const customProductState = userStates.get(chatId);
        if (customProductState && customProductState.mode === 'custom_product_description') {
          customProductState.description = text;
          customProductState.mode = 'custom_product_features';
          userStates.set(chatId, customProductState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ توضیحات ثبت شد.\n\n🎯 حالا لطفاً <b>ویژگی‌های خاص</b> محصول را بنویسید:\n\n<i>(مثال: وزن ۲ کیلو، دو طبقه، بدون گلوتن، تزیین با گل طبیعی و تم رنگی آبی)</i>`,
              parse_mode: 'HTML'
            })
          });
          return;
        }
        if (customProductState && customProductState.mode === 'custom_product_features') {
          customProductState.features = text;
          customProductState.mode = 'custom_product_photo';
          userStates.set(chatId, customProductState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ ویژگی‌ها ثبت شد.\n\n📸 حالا لطفاً <b>عکس یا عکس‌های نمونه</b> محصول را ارسال کنید (اختیاری):\n\nمی‌توانید تا <b>۱۰ تصویر</b> (مدل، طرح، تم رنگی، تزیین و…) یکی پس از دیگری بفرستید؛ پس از هر عکس می‌توانید عکس بعدی را بفرستید یا «ثبت عکس‌ها» را بزنید.\n\n<i>(اگر عکسی ندارید، روی دکمه زیر کلیک کنید)</i>`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '⏭️ رد شدن (بدون عکس)', callback_data: 'custom_product_skip_photo' }]
              ]}
            })
          });
          return;
        }
        if (customProductState && (customProductState.mode === 'custom_product_photo' || customProductState.mode === 'custom_product_photos_more')) {
          const photos: string[] = Array.isArray(customProductState.photos) ? customProductState.photos : (customProductState.photo ? [customProductState.photo] : []);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📸 برای ثبت تصاویر مدنظرتان، عکس‌ها را <b>یکی‌یکی در همین چت</b> بفرستید.${photos.length ? `\nتاکنون <b>${photos.length.toLocaleString('fa-IR')}</b> عکس دریافت شده است.` : ''}\n\nپس از اتمام، دکمه «✅ ثبت عکس‌ها» را بزنید.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                ...(photos.length ? [{ text: '✅ ثبت عکس‌ها و ادامه', callback_data: 'custom_product_done_photos' }] : []),
                [{ text: '⏭️ بدون عکس ادامه بده', callback_data: 'custom_product_skip_photo' }],
              ]}
            })
          });
          return;
        }
        if (checkoutState && checkoutState.mode?.startsWith('checkout_')) {
          const tgCtx = { token, chatId, products, orders, discounts, customers, botSettings, userCarts, userStates, msg };
          const handled = await handleCheckoutState(tgCtx, text);
          if (handled) return;
        }
      }
      // Handle photo uploads and supported image documents only when Telegram
      // actually sent image media. This keeps text-only updates out of receipt
      // processing while allowing customers to attach a receipt as a file.
      if (incomingImageFileId) {
        // Handle a receipt sent from the payment action attached to a manually
        // issued invoice.
        const invoiceReceiptState = userStates.get(chatId);
        if (invoiceReceiptState && invoiceReceiptState.mode === 'invoice_payment_receipt') {
          const invoice = manualInvoiceById(String(invoiceReceiptState.invoiceId || ''))
            || invoices.find(inv => inv.id === invoiceReceiptState.invoiceId);

          if (!invoice || invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.status === 'refunded') {
            userStates.delete(chatId);
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '⚠️ امکان ثبت این فیش وجود ندارد؛ فاکتور یافت نشد یا قبلاً تسویه شده است.',
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
              }),
            });
            return;
          }

          const photoFileId = incomingImageFileId;
          const now = new Date().toISOString();
          const payment: InvoicePayment = {
            id: `payment-invoice-telegram-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            amount: Math.round(invoice.remainingAmount || invoice.totalAmount),
            method: 'card_to_card',
            status: 'submitted',
            receiptImage: photoFileId,
            notes: 'فیش واریزی ارسال‌شده توسط مشتری در تلگرام',
            createdAt: now,
            updatedAt: now,
          };
          if (!Array.isArray(invoice.payments)) invoice.payments = [];
          invoice.payments.push(payment);
          const calculated = calculateInvoiceAmounts(invoice);
          Object.assign(invoice, calculated, {
            paymentMethod: 'card_to_card',
            status: resolveManualInvoiceStatus(invoice.status, { ...calculated, payments: invoice.payments }),
            updatedAt: now,
          });
          saveAllData();
          userStates.delete(chatId);
          sendToTelegramTopic(
            'finance',
            `💳 <b>فیش فاکتور اختصاصی دریافت شد:</b>\n\n🔖 شماره فاکتور: <code>${escapeTelegramHtml(invoice.invoiceNumber)}</code>\n👤 خریدار: <b>${escapeTelegramHtml(invoice.customerName)}</b>\n📞 <code>${escapeTelegramHtml(invoice.customerPhone || '---')}</code>\n💰 مبلغ پرداختی: <b>${payment.amount.toLocaleString('fa-IR')} تومان</b>\n💳 کل فاکتور: <b>${invoice.totalAmount.toLocaleString('fa-IR')} تومان</b>\n⏳ وضعیت: <b>در انتظار بررسی و تأیید ادمین</b>`,
            photoFileId,
          );
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>فیش واریزی شما برای فاکتور ${escapeTelegramHtml(invoice.invoiceNumber)} با موفقیت دریافت شد!</b>\n\nپس از بررسی و تأیید توسط مدیریت قنادی، وضعیت فاکتور به‌روزرسانی خواهد شد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
            }),
          });
          return;
        }

        // Handle custom order receipt photo
        const customReceiptState = userStates.get(chatId);
        if (customReceiptState && customReceiptState.mode === 'custom_order_receipt') {
          const photoFileId = incomingImageFileId;
          const order = customOrders.find(o => o.id === customReceiptState.orderId);
          if (order && String(order.customerTelegramId) === chatId) {
            // Receipt submission is NOT payment approval. Keep the order quoted
            // until an admin makes an explicit decision from the panel.
            order.paymentReceiptImage = photoFileId;
            order.paymentMethod = 'card_to_card';
            order.isPrepaymentPaid = false;
            order.prepaymentStatus = 'pending_confirmation';
            order.prepaymentSubmittedAt = new Date().toISOString();
            delete order.prepaymentReviewedAt;
            delete order.prepaymentRejectReason;
            order.status = 'price_quoted';
            order.updatedAt = new Date().toISOString();
            saveAllData();
            userStates.delete(chatId);
            sendToTelegramTopic(
              'finance',
              `💳 <b>فیش بیعانه سفارش دلخواه (${order.orderNumber}) دریافت شد:</b>\n\n👤 مشتری: ${order.customerName}\n💰 مبلغ بیعانه: <b>${(order.prepaymentAmount || 0).toLocaleString('fa-IR')} تومان</b>\n⏳ وضعیت: <b>در انتظار تأیید ادمین</b>`,
              photoFileId,
            );
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: tmsg('customPrepaymentAckMessage'),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [
                  [{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }],
                  [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
                ]}
              })
            });
          }
          return;
        }
        // Handle custom product photo(s). Customers may attach up to 10
        // reference images one after another; each photo is acknowledged and
        // they confirm once their whole set has been uploaded.
        const customPhotoState = userStates.get(chatId);
        if (customPhotoState && (customPhotoState.mode === 'custom_product_photo' || customPhotoState.mode === 'custom_product_photos_more')) {
          const albumFiles: string[] = Array.isArray(msg?.__albumFiles) ? msg.__albumFiles : [incomingImageFileId];
          const collected: string[] = Array.isArray(customPhotoState.photos)
            ? [...customPhotoState.photos]
            : (customPhotoState.photo ? [customPhotoState.photo] : []);
          for (const fileId of albumFiles) {
            if (!collected.includes(fileId)) collected.push(fileId);
          }
          customPhotoState.photos = collected.slice(0, 10);
          customPhotoState.photo = customPhotoState.photos[0] || null;
          customPhotoState.mode = 'custom_product_photos_more';
          userStates.set(chatId, customPhotoState);

          const count = customPhotoState.photos.length;
          const atLimit = count >= 10;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: atLimit
                ? `✅ تصویر دریافت شد. مجموعاً <b>${count.toLocaleString('fa-IR')}</b> عکس (حداکثر مجاز) ثبت شد.\n\nمی‌توانید «✅ ثبت عکس‌ها» را بزنید تا خلاصه سفارش نمایش داده شود.`
                : `✅ تصویر <b>${count.toLocaleString('fa-IR')}</b> دریافت شد.\n\n📸 اگر مدل یا طرح دیگری هم دارید، <b>همین حالا عکس بعدی</b> را بفرستید.\nپس از اتمام، دکمه «✅ ثبت عکس‌ها و ادامه» را بزنید.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '✅ ثبت عکس‌ها و ادامه', callback_data: 'custom_product_done_photos' }],
                atLimit ? [{ text: '❌ انصراف', callback_data: 'back_to_main' }] : [{ text: '⏭️ بدون عکس بیشتر ادامه بده', callback_data: 'custom_product_skip_photo' }],
              ]}
            })
          });
          return;
        }
        // Handle support photo. A Telegram file_id can be sent back through
        // this bot and is resolved by the relative file proxy in the web panel;
        // unlike a generated Railway URL it survives domain configuration changes.
        const supportPhotoState = userStates.get(chatId);
        if (supportPhotoState && supportPhotoState.mode === 'support_photo') {
          const photoFileId = incomingImageFileId;
          supportPhotoState.photo = photoFileId;
          supportPhotoState.mode = 'support_finalize';
          userStates.set(chatId, supportPhotoState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '✅ تصویر دریافت شد.\n\nآیا می‌خواهید تیکت را ثبت نهایی کنید؟',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '✅ ثبت نهایی تیکت', callback_data: 'support_finalize' }],
                [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
              ]}
            })
          });
          return;
        }
        // Handle reply ticket photo upload. Store its Telegram file_id directly
        // so it can be rendered through /api/telegram/file on any Railway host.
        const replyPhotoState = userStates.get(chatId);
        if (replyPhotoState && replyPhotoState.mode === 'reply_to_ticket_photo') {
          const photoFileId = incomingImageFileId;
          const ticket = supportTickets.find(t => t.id === replyPhotoState.ticketId);
          if (ticket) {
            const replyText = replyPhotoState.replyText || '';
            ticket.replies.push({
              id: `rep-${Date.now()}`,
              sender: 'customer',
              senderName: ticket.customerName || 'مشتری',
              text: replyText,
              photo: photoFileId,
              createdAt: new Date().toISOString()
            });
            ticket.status = 'in_progress';
            ticket.updatedAt = new Date().toISOString();
            saveAllData();
            userStates.delete(chatId);
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '✅ عکس شما ثبت شد. پشتیبانی به زودی پاسخ می‌دهد.',
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [
                  [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
                ]}
              })
            });
          }
          return;
        }
        const photoState = userStates.get(chatId);
        if (photoState && photoState.mode === 'waiting_for_receipt') {
          const photoFileId = incomingImageFileId;
          const order = orders.find(o => o.id === photoState.orderId);
          if (order
            && String(order.customerTelegramId) === chatId
            && order.paymentMethod !== 'cash_on_delivery'
            && !['cancelled', 'shipped', 'delivered'].includes(order.status)
            && order.receiptReviewStatus !== 'confirmed') {
            const isReplacement = Boolean(order.paymentReceiptImage);
            order.paymentReceiptImage = photoFileId;
            order.receiptReviewStatus = 'submitted';
            delete order.receiptReviewedAt;
            delete order.receiptReviewReason;
            order.status = 'paid_checking';
            order.updatedAt = new Date().toISOString();
            saveAllData();
            userStates.delete(chatId);
            sendToTelegramTopic(
              'finance',
              `💳 <b>فیش واریزی سفارش ${escapeTelegramHtml(order.orderNumber)} دریافت شد:</b>\n\n👤 مشتری: ${escapeTelegramHtml(order.customerName)}\n💰 مبلغ: <b>${order.totalAmount.toLocaleString('fa-IR')} تومان</b>\n⏳ وضعیت: <b>در انتظار تأیید ادمین</b>${isReplacement ? '\n📷 این فیش جایگزین فیش قبلی شده است.' : ''}`,
              photoFileId,
            );
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: isReplacement
                  ? '✅ فیش واریزی جدید با موفقیت دریافت شد و جایگزین فیش قبلی گردید!\n\nسفارش شما دوباره در انتظار بررسی ادمین قرار گرفت.'
                  : tmsg('receiptAckMessage'),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '📦 سفارشات من', callback_data: 'track_order' }]] }
              })
            });
          } else {
            userStates.delete(chatId);
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '⚠️ امکان ثبت فیش برای این سفارش وجود ندارد (سفارش لغو/تحویل شده، پرداخت در محل، یا فیش قبلاً تأیید شده است).',
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '📦 سفارشات من', callback_data: 'track_order' }]] }
              })
            });
          }
          return;
        }

        // Fallback: If customer sent an image directly without clicking a button first,
        // auto-detect their pending orders or invoices.
        const pendingOrder = orders.find(o =>
          String(o.customerTelegramId) === chatId
          && o.paymentMethod !== 'cash_on_delivery'
          && !['cancelled', 'shipped', 'delivered'].includes(o.status)
          && o.receiptReviewStatus !== 'confirmed'
        );
        if (pendingOrder) {
          const isReplacement = Boolean(pendingOrder.paymentReceiptImage);
          pendingOrder.paymentReceiptImage = incomingImageFileId;
          pendingOrder.receiptReviewStatus = 'submitted';
          delete pendingOrder.receiptReviewedAt;
          delete pendingOrder.receiptReviewReason;
          pendingOrder.status = 'paid_checking';
          pendingOrder.updatedAt = new Date().toISOString();
          saveAllData();
          sendToTelegramTopic(
            'finance',
            `💳 <b>فیش واریزی سفارش ${escapeTelegramHtml(pendingOrder.orderNumber)} دریافت شد:</b>\n\n👤 مشتری: ${escapeTelegramHtml(pendingOrder.customerName)}\n💰 مبلغ: <b>${pendingOrder.totalAmount.toLocaleString('fa-IR')} تومان</b>\n⏳ وضعیت: <b>در انتظار تأیید ادمین</b>${isReplacement ? '\n📷 این فیش جایگزین فیش قبلی شده است.' : ''}`,
            incomingImageFileId,
          );
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>فیش واریزی شما برای سفارش ${escapeTelegramHtml(pendingOrder.orderNumber)} دریافت شد!</b>\n\nپس از بررسی و تأیید ادمین، مراحل آماده‌سازی و ارسال انجام خواهد شد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }], [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] }
            })
          });
          return;
        }

        const pendingCustom = customOrders.find(co =>
          String(co.customerTelegramId) === chatId
          && co.status === 'price_quoted'
          && co.prepaymentStatus !== 'approved'
          && !co.isPrepaymentPaid
        );
        if (pendingCustom) {
          pendingCustom.paymentReceiptImage = incomingImageFileId;
          pendingCustom.paymentMethod = 'card_to_card';
          pendingCustom.isPrepaymentPaid = false;
          pendingCustom.prepaymentStatus = 'pending_confirmation';
          pendingCustom.prepaymentSubmittedAt = new Date().toISOString();
          delete pendingCustom.prepaymentReviewedAt;
          delete pendingCustom.prepaymentRejectReason;
          pendingCustom.updatedAt = new Date().toISOString();
          saveAllData();
          sendToTelegramTopic(
            'finance',
            `💳 <b>فیش بیعانه سفارش دلخواه (${pendingCustom.orderNumber}) دریافت شد:</b>\n\n👤 مشتری: ${escapeTelegramHtml(pendingCustom.customerName)}\n💰 مبلغ بیعانه: <b>${(pendingCustom.prepaymentAmount || 0).toLocaleString('fa-IR')} تومان</b>\n⏳ وضعیت: <b>در انتظار تأیید ادمین</b>`,
            incomingImageFileId,
          );
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>فیش بیعانه سفارش دلخواه (${escapeTelegramHtml(pendingCustom.orderNumber)}) دریافت شد!</b>\n\nپس از تأیید واریزی توسط قناد، پخت کیک شما آغاز خواهد شد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }], [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] }
            })
          });
          return;
        }

        // Generic acknowledgement if image doesn't match any pending receipt
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '📸 تصویر شما دریافت شد.\n\nچنانچه می‌خواهید فیش واریزی ارسال کنید، لطفاً از بخش «📦 پیگیری سفارشات» وارد شده و سفارش مربوطه را انتخاب نمایید.',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }], [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] }
          })
        });
        return;
      }
    } else if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id.toString();
      const data = cb.data;

      // Answer callback query first
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id })
      });

      // Admin callback payloads can be forged or forwarded, so do not rely
      // on whether Telegram happened to show the admin keyboard to this user.
      // In groups, authorize the clicking user — never the shared chat ID.
      const callbackActorId = String(cb.from?.id ?? chatId);
      if (data.startsWith('admin_') && !isTelegramAdmin(callbackActorId)) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: tmsg('adminOnlyMessage'), parse_mode: 'HTML' })
        });
        return;
      }

      // A payment callback is valid only in the private chat of the exact bot
      // user selected by the administrator.
      if (data.startsWith('invoice_payment_')) {
        const invoiceId = data.slice('invoice_payment_'.length);
        const invoice = manualInvoiceById(invoiceId) || invoices.find(inv => inv.id === invoiceId);
        if (!invoice) {
          userStates.delete(chatId);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ فاکتور مورد نظر یافت نشد.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
            }),
          });
          return;
        }

        if (invoice.status === 'paid' || (invoice.remainingAmount !== undefined && invoice.remainingAmount <= 0)) {
          userStates.delete(chatId);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'ℹ️ این فاکتور قبلاً تسویه شده است و نیازی به پرداخت ندارد.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
            }),
          });
          return;
        }

        const cardNumber = trimInvoiceText(botSettings.cardNumber, 120);
        if (!cardNumber) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '⚠️ اطلاعات کارت پرداخت هنوز توسط فروشگاه در تنظیمات پنل ثبت نشده است. لطفاً کمی بعد دوباره تلاش کنید.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
            }),
          });
          return;
        }

        userStates.set(chatId, {
          mode: 'invoice_payment_receipt',
          invoiceId: invoice.id,
          startedAt: new Date().toISOString(),
        });
        const cardHolder = trimInvoiceText(botSettings.cardHolder, 160);
        const shabaNumber = trimInvoiceText(botSettings.shabaNumber, 80);
        const payableAmount = invoice.remainingAmount !== undefined ? invoice.remainingAmount : invoice.totalAmount;
        const paymentText = [
          '💳 <b>پرداخت فاکتور اختصاصی</b>',
          '',
          `🔖 شماره فاکتور: <code>${formatCustomerInvoiceText(invoice.invoiceNumber, 80)}</code>`,
          `💰 مبلغ قابل پرداخت: <b>${payableAmount.toLocaleString('fa-IR')} تومان</b>`,
          '',
          '💳 <b>شماره کارت:</b>',
          `<code>${formatCustomerInvoiceText(cardNumber, 120)}</code>`,
          cardHolder ? `👤 <b>به نام:</b> ${formatCustomerInvoiceText(cardHolder, 160)}` : '',
          shabaNumber ? `🏦 <b>شماره شبا:</b> <code>${formatCustomerInvoiceText(shabaNumber, 80)}</code>` : '',
          '',
          'پس از واریز، لطفاً <b>تصویر فیش واریزی</b> را در همین گفت‌وگو ارسال کنید. فیش پس از بررسی ادمین تأیید یا رد می‌شود.',
        ].filter(Boolean).join('\n');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: paymentText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] },
          }),
        });
        return;
      }

      // Regular (cart) order receipt re-upload. A customer who paid by card
      // transfer can always reach this from the order tracking view, so a
      // missing/rejected receipt never leaves them without a way to send it.
      if (data.startsWith('order_reupload_receipt_')) {
        const orderId = data.slice('order_reupload_receipt_'.length);
        const order = orders.find((item) => item.id === orderId);
        const orderChatId = order ? String(order.customerTelegramId || '') : '';
        if (!order || orderChatId !== chatId || orderChatId !== callbackActorId) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ این سفارش یافت نشد یا به حساب دیگری تعلق دارد.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات من', callback_data: 'track_order' }]] },
            }),
          });
          return;
        }
        if (order.paymentMethod === 'cash_on_delivery') {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `ℹ️ سفارش <code>${escapeTelegramHtml(order.orderNumber)}</code> پرداخت در محل است و نیازی به ارسال فیش ندارد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات من', callback_data: 'track_order' }]] },
            }),
          });
          return;
        }
        if (['cancelled', 'shipped', 'delivered'].includes(order.status)) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'ℹ️ این سفارش در وضعیت پرداخت نیست و فیش جدیدی برای آن پذیرفته نمی‌شود.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات من', callback_data: 'track_order' }]] },
            }),
          });
          return;
        }
        const receiptAlreadyUnderReview = Boolean(order.paymentReceiptImage)
          && !['confirmed', 'rejected'].includes(order.receiptReviewStatus || '');
        if (receiptAlreadyUnderReview) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `⏳ فیش سفارش <code>${escapeTelegramHtml(order.orderNumber)}</code> قبلاً ارسال شده و در انتظار تأیید ادمین است. پس از بررسی، نتیجه به شما اعلام می‌شود.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات من', callback_data: 'track_order' }]] },
            }),
          });
          return;
        }

        const cardNumber = String(botSettings.cardNumber || '').trim();
        if (!cardNumber) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '⚠️ اطلاعات کارت پرداخت هنوز توسط فروشگاه ثبت نشده است. لطفاً کمی بعد دوباره تلاش کنید یا با پشتیبانی در تماس باشید.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '💬 پشتیبانی', callback_data: 'support_send' }]] },
            }),
          });
          return;
        }

        userStates.set(chatId, { mode: 'waiting_for_receipt', orderId: order.id });
        const receiptText = [
          order.receiptReviewStatus === 'rejected' || order.status === 'receipt_confirmed'
            ? `📷 <b>ارسال فیش واریزی سفارش ${escapeTelegramHtml(order.orderNumber)}</b>`
            : `📷 <b>ارسال فیش واریزی سفارش ${escapeTelegramHtml(order.orderNumber)}</b>`,
          '',
          `💰 <b>مبلغ قابل پرداخت:</b> ${order.totalAmount.toLocaleString('fa-IR')} تومان`,
          '💳 <b>شماره کارت:</b>',
          `<code>${escapeTelegramHtml(cardNumber)}</code>`,
          botSettings.cardHolder ? `👤 <b>به نام:</b> ${escapeTelegramHtml(String(botSettings.cardHolder))}` : '',
          '',
          'پس از واریز، لطفاً <b>تصویر فیش واریزی</b> را در همین گفت‌وگو ارسال کنید. فیش پس از بررسی ادمین تأیید یا رد می‌شود.',
        ].filter(Boolean).join('\n');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: receiptText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] },
          }),
        });
        return;
      }

      // Build context for handlers
      const tgCtx = { token, chatId, products, orders, discounts, customers, supportTickets, customOrders, invoices, botSettings, userCarts, userStates, telegramUser: cb.from };

      // Try telegramHandlers first
      if (data.startsWith('admin_cat_')) {
        const handled = await handleAdminCatSelect(tgCtx, data.replace('admin_cat_', ''));
        if (handled) {
          saveAllData();
          return;
        }
      }
      
      // Try admin callbacks
      if (data.startsWith('admin_')) {
        const handled = await handleAdminCallback(tgCtx, data);
        if (handled) {
          saveAllData();
          return;
        }
      }

      // Try customer callbacks. Keep the ids from before the handler so a
      // support_finalize callback can be reported only when it really creates
      // a new ticket.
      const ticketIdsBeforeCallback = new Set(supportTickets.map(ticket => ticket.id));
      const customerHandled = await handleCustomerCallback(tgCtx, data);
      if (customerHandled) {
        // Do not rely solely on the 10-second autosave on Railway: a deploy or
        // restart immediately after submission must not lose the ticket.
        saveAllData();

        if (data === 'support_finalize') {
          const createdTicket = supportTickets.find(ticket => !ticketIdsBeforeCallback.has(ticket.id));
          if (createdTicket) {
            const categoryLabels: Record<string, string> = {
              custom_cake: '🎂 سفارش کیک اختصاصی',
              order_inquiry: '📦 پیگیری سفارش',
              payment_issue: '💳 مشکل پرداخت / فیش',
              feedback: '⭐ انتقاد و پیشنهاد',
              consultation: '💡 مشاوره خرید',
              general: '💬 پیام عمومی'
            };
            await sendToTelegramTopic(
              'support',
              `💬 <b>تیکت پشتیبانی جدید (${createdTicket.ticketNumber})</b>\n\n` +
                `👤 <b>مشتری:</b> ${createdTicket.customerName}\n` +
                `📂 <b>دسته‌بندی:</b> ${categoryLabels[createdTicket.category] || createdTicket.category}\n` +
                `📌 <b>عنوان:</b> ${createdTicket.subject}\n\n` +
                `📝 <b>متن پیام:</b>\n<i>${createdTicket.message}</i>`,
              createdTicket.cakePhoto
            );
          }
        }
        return;
      }

      // Fallback to old handlers below
      if (data === 'my_profile') {
        // Make sure a profile record exists for this Telegram account.
        const profile = getTelegramProfile(cb.from);
        const customer = upsertBotCustomer(customers, {
          telegramId: chatId,
          name: profile.displayName,
          username: profile.username,
          source: 'bot',
        });
        saveAllData();

        const addresses: string[] = customer.addresses && customer.addresses.length
          ? customer.addresses
          : (customer.address ? [customer.address] : []);

        let text = `👤 <b>پروفایل شما</b>\n\n`;
        text += `🪪 <b>نام:</b> ${customer.name || '—'}\n`;
        text += `📞 <b>شماره تلفن:</b> ${customer.phone || 'ثبت نشده'}\n`;
        text += `🆔 <b>شناسه تلگرام:</b> <code>${customer.telegramId}</code>\n`;
        text += `\n🏠 <b>آدرس‌های ثبت‌شده:</b>\n`;
        if (addresses.length === 0) {
          text += `هنوز آدرسی ثبت نکرده‌اید.\n`;
        } else {
          addresses.forEach((addr, i) => {
            text += `${i + 1}. ${addr}\n`;
          });
        }
        text += `\n📦 <b>تعداد سفارش‌ها:</b> ${(customer.totalOrdersCount || 0).toLocaleString('fa-IR')}\n`;
        text += `💰 <b>اعتبار کیف پول:</b> ${(customer.walletBalance || 0).toLocaleString('fa-IR')} تومان\n`;
        text += `\n⚠️ اگر نام، شماره تلفن یا آدرس‌ها اشتباه است، برای اصلاح به <b>پشتیبانی</b> پیام بدهید.`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ افزودن آدرس جدید', callback_data: 'profile_add_address' }],
                [{ text: '💬 پشتیبانی', callback_data: 'support_send' }],
                [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }],
              ]
            }
          })
        });
      } else if (data === 'profile_add_address') {
        userStates.set(chatId, { mode: 'profile_add_address' });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🏠 لطفاً <b>آدرس جدید</b> خود را کامل بنویسید (خیابان، کوچه، پلاک و کد پستی در صورت امکان):`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] }
          })
        });
      } else if (data === 'contact_info') {
        const text = `📍 <b>اطلاعات قنادی:</b>\n\n🏢 <b>نام:</b> ${botSettings.storeName}\n📞 <b>تلفن تماس:</b> ${botSettings.storePhone}\n🏠 <b>آدرس:</b> ${botSettings.storeAddress}\n💳 <b>شماره کارت:</b> <code>${botSettings.cardNumber}</code>\n👤 <b>به نام:</b> ${botSettings.cardHolder}`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_to_main' }]]
            }
          })
        });
      // Custom Product Flow
      } else if (data === 'custom_product_start') {
        userStates.set(chatId, { mode: 'custom_product_category' });
        const categories = ['🎂 کیک تولد و مناسبتی', '🧁 کاپ‌کیک و مافین', '🍰 شیرینی تر', '🍪 شیرینی خشک', '🍮 دسر و پودینگ', '🥐 نان و کروسان', '🍫 شکلات و ترافل', '🎁 سایر'];
        const buttons = categories.map(cat => [{ text: cat, callback_data: `custom_cat_${cat}` }]);
        buttons.push([{ text: '❌ انصراف', callback_data: 'back_to_main' }]);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🎨 <b>محصول سفارشی شما</b>\n\nلطفاً دسته‌بندی محصول سفارشی خود را انتخاب کنید:',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
          })
        });
      } else if (data.startsWith('custom_cat_')) {
        const category = data.replace('custom_cat_', '');
        const state = userStates.get(chatId) || {};
        state.category = category;
        state.mode = 'custom_product_description';
        userStates.set(chatId, state);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ دسته‌بندی: <b>${category}</b>\n\n📝 حالا لطفاً <b>توضیحات کامل</b> محصول سفارشی خود را بنویسید:\n\n<i>(مثال: کیک شکلاتی ۳ کیلویی دو طبقه، تزیین با فوندانت آبی و عروسک، بدون گلوتن)</i>`,
            parse_mode: 'HTML'
          })
        });
      } else if (data === 'custom_product_skip_photo') {
        const state = userStates.get(chatId) || {};
        // Skipping from the very first photo prompt means "no images"; once at
        // least one photo exists, the same button acts as "finish without more".
        const collected: string[] = Array.isArray(state.photos)
          ? state.photos
          : (state.photo ? [state.photo] : []);
        if (state.mode !== 'custom_product_photos_more') {
          state.photo = null;
          state.photos = [];
        } else {
          state.photos = collected.slice(0, 10);
          state.photo = state.photos[0] || null;
        }
        state.mode = 'custom_product_confirm';
        userStates.set(chatId, state);
        const photosCount = (state.photos || []).length;
        // Show confirmation
        const confirmText = `✅ <b>خلاصه محصول سفارشی شما:</b>\n\n` +
          `📂 دسته‌بندی: ${state.category}\n` +
          `📝 توضیحات: ${state.description}\n` +
          `🎯 ویژگی‌ها: ${state.features}\n` +
          `📸 تصاویر نمونه: ${photosCount > 0 ? `✅ ${photosCount.toLocaleString('fa-IR')} عکس ارسال شده` : '❌ ارسال نشده'}\n\n` +
          `آیا اطلاعات صحیح است؟`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: confirmText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '✅ تایید و ارسال', callback_data: 'custom_product_submit' }],
              [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
            ]}
          })
        });
      } else if (data === 'custom_product_done_photos') {
        const state = userStates.get(chatId);
        const collected: string[] = Array.isArray(state?.photos)
          ? state.photos
          : (state?.photo ? [state.photo] : []);
        if (!state || collected.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '📸 هنوز عکسی دریافت نشده است. لطفاً تصویر نمونه را بفرستید یا دکمه «بدون عکس ادامه بده» را بزنید.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '⏭️ بدون عکس ادامه بده', callback_data: 'custom_product_skip_photo' }],
                [{ text: '❌ انصراف', callback_data: 'back_to_main' }],
              ]}
            })
          });
          return;
        }
        state.photos = collected.slice(0, 10);
        state.photo = state.photos[0];
        state.mode = 'custom_product_confirm';
        userStates.set(chatId, state);
        const confirmText = `✅ <b>خلاصه محصول سفارشی شما:</b>\n\n` +
          `📂 دسته‌بندی: ${state.category}\n` +
          `📝 توضیحات: ${state.description}\n` +
          `🎯 ویژگی‌ها: ${state.features}\n` +
          `📸 تصاویر نمونه: ✅ ${state.photos.length.toLocaleString('fa-IR')} عکس ارسال شده\n\n` +
          `آیا اطلاعات صحیح است؟`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: confirmText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '✅ تایید و ارسال', callback_data: 'custom_product_submit' }],
              [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
            ]}
          })
        });
      } else if (data === 'custom_product_submit') {
        const state = userStates.get(chatId);
        if (!state) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ خطا: اطلاعات سفارش یافت نشد. لطفاً دوباره تلاش کنید.',
              parse_mode: 'HTML'
            })
          });
          return;
        }
        // Save the design inquiry. Delivery details are deliberately left empty
        // here and are collected from this customer after the quote is accepted.
        const customOrderId = Date.now().toString();
        const telegramProfile = getTelegramProfile(cb.from);
        const newCustomOrder: CustomPastryOrder = {
          id: customOrderId,
          orderNumber: `CO-${customOrderId.slice(-6)}`,
          customerName: telegramProfile.displayName || 'مشتری',
          customerPhone: '',
          customerTelegramId: chatId,
          customerUsername: telegramProfile.username,
          customerTelegramName: telegramProfile.displayName,
          pastryType: state.category as CustomPastryOrder['pastryType'],
          shapeAndDesign: [state.description, state.features].filter(Boolean).join('\n'),
          // No fixed/automatic delivery day is stored. The customer supplies a
          // valid Solar Hijri date and Iran-local time after price quotation.
          deliveryDate: undefined,
          deliveryTimeSlot: undefined,
          deliveryType: 'delivery',
          status: 'pending_review',
          // Keep all Telegram reference photos with the custom order so they
          // are available as zoomable images in the web panel (up to 10).
          referenceImages: Array.isArray(state.photos) && state.photos.length
            ? state.photos.slice(0, 10)
            : (state.photo ? [state.photo] : []),
          chatMessages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        customOrders.unshift(newCustomOrder);
        saveAllData();
        userStates.delete(chatId);
        sendToTelegramTopic(
          'custom_orders',
          `🎂 <b>سفارش جدید کیک/شیرینی دلخواه ثبت شد!</b>\n\n🔖 <b>کد رهگیری:</b> <code>${newCustomOrder.orderNumber}</code>\n👤 <b>مشتری:</b> ${newCustomOrder.customerName} ${newCustomOrder.customerUsername ? `(@${newCustomOrder.customerUsername})` : ''}\n🧁 <b>نوع:</b> ${newCustomOrder.pastryType}\n🎨 <b>طرح و توضیحات:</b>\n<i>${escapeTelegramHtml(newCustomOrder.shapeAndDesign || 'بدون توضیحات')}</i>\n⏳ وضعیت: <b>در انتظار قیمت‌گذاری سرقناد</b>`,
          newCustomOrder.referenceImages?.[0]
        );
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: tmsg('customOrderSubmittedMessage', { orderNumber: newCustomOrder.orderNumber }),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }],
              [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
            ]}
          })
        });
      // Custom Order Payment Flow
      // (Legacy delivery-date/time scheduling callbacks are intentionally no
      // longer handled; موعد تحویل is collected out-of-band by the workshop.)
      } else if (data.startsWith('custom_order_skip_delivery_date_') || data.startsWith('custom_order_skip_delivery_time_')) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'ℹ️ تعیین تاریخ و ساعت تحویل در ربات انجام نمی‌شود؛ پس از تأیید سفارش، زمان تحویل هماهنگ خواهد شد.',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }], [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] },
          }),
        });
      } else if (data.startsWith('custom_order_reupload_receipt_')) {
        const orderId = data.replace('custom_order_reupload_receipt_', '');
        const order = customOrders.find(item => item.id === orderId);
        if (!order || String(order.customerTelegramId) !== chatId || !hasCompleteCustomOrderDelivery(order)) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '❌ برای ارسال فیش ابتدا مشخصات سفارش را کامل کنید.', parse_mode: 'HTML' })
          });
          return;
        }
        userStates.set(chatId, { mode: 'custom_order_receipt', orderId });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📷 <b>ارسال مجدد فیش بیعانه</b>\n\n💰 مبلغ بیعانه: <b>${order.prepaymentAmount?.toLocaleString() || '---'} تومان</b>\n💳 <b>شماره کارت:</b>\n<code>${botSettings.cardNumber}</code>\n👤 <b>به نام:</b> ${botSettings.cardHolder}\n\nلطفاً عکس فیش صحیح را ارسال کنید. فیش جدید نیز ابتدا توسط ادمین بررسی خواهد شد.`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] }
          })
        });
      } else if (data.startsWith('custom_order_addr_')) {
        const regState = userStates.get(chatId);
        if (!regState || regState.mode !== 'custom_order_register_address') {
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: 'این گزینه دیگر معتبر نیست.' })
          });
          return;
        }
        const suffix = data.replace('custom_order_addr_', '');
        if (suffix === 'new') {
          regState.mode = 'custom_order_register_address_new';
          userStates.set(chatId, regState);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🏠 لطفاً <b>آدرس دقیق تحویل</b> را وارد کنید:',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'back_to_main' }]] }
            })
          });
          return;
        }
        const index = Number(suffix);
        const book: string[] = Array.isArray(regState.addresses) ? regState.addresses : [];
        const chosen = book[index];
        if (!chosen) {
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: 'آدرس پیدا نشد.' })
          });
          return;
        }
        regState.deliveryAddress = chosen;
        userStates.set(chatId, regState);
        await finishCustomOrderRegistration(chatId, regState, cb.from);
      } else if (data.startsWith('custom_order_register_')) {
        const orderId = data.replace('custom_order_register_', '');
        const order = customOrders.find(o => o.id === orderId);
        if (!order) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ سفارش یافت نشد.',
              parse_mode: 'HTML'
            })
          });
          return;
        }
        if (String(order.customerTelegramId) !== chatId) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '❌ امکان ثبت این سفارش برای شما وجود ندارد.', parse_mode: 'HTML' })
          });
          return;
        }
        const telegramProfile = getTelegramProfile(cb.from);
        const knownCustomer = findBotCustomer(customers, String(cb.from.id));
        const knownName = knownCustomer && isRealName(knownCustomer.name) ? knownCustomer.name! : '';
        const knownPhone = knownCustomer?.phone || '';
        const knownAddresses = knownCustomer?.addresses?.length ? knownCustomer.addresses : (knownCustomer?.address ? [knownCustomer.address] : []);
        // If we already know the user's name and phone, never ask again — go straight to address.
        if (knownName && knownPhone) {
          userStates.set(chatId, {
            mode: 'custom_order_register_address',
            orderId: orderId,
            customerName: knownName,
            customerPhone: knownPhone,
            addresses: knownAddresses,
            customerUsername: telegramProfile.username || order.customerUsername,
            customerTelegramName: telegramProfile.displayName || order.customerTelegramName,
          });
          const addressButtons = [
            ...knownAddresses.slice(-5).reverse().map((address: string, index: number) => ([{
              text: `📍 ${address.slice(0, 42)}`,
              callback_data: `custom_order_addr_${knownAddresses.length - 1 - index}`
            }])),
            [{ text: '➕ ثبت آدرس جدید', callback_data: 'custom_order_addr_new' }]
          ];
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👤 <b>${knownName}</b> عزیز، اطلاعات تماس شما از قبل ثبت شده است.\n\n🏠 یک آدرس از قبل ثبت‌شده را انتخاب کنید یا آدرس جدید وارد کنید:`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: addressButtons }
            })
          });
        } else {
          userStates.set(chatId, {
            mode: 'custom_order_register_name',
            orderId: orderId,
            customerUsername: telegramProfile.username || order.customerUsername,
            customerTelegramName: telegramProfile.displayName || order.customerTelegramName,
          });
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>ثبت سفارش</b>\n\nلطفاً <b>نام و نام خانوادگی</b> خود را وارد کنید:`,
              parse_mode: 'HTML'
            })
          });
        }
      } else if (data.startsWith('custom_order_cash_')) {
        const orderId = data.replace('custom_order_cash_', '');
        const order = customOrders.find(o => o.id === orderId);
        if (!order || String(order.customerTelegramId) !== chatId) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ سفارش یافت نشد یا امکان پرداخت آن برای شما وجود ندارد.',
              parse_mode: 'HTML'
            })
          });
          return;
        }
        if (!hasCompleteCustomOrderDelivery(order)) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '❌ ابتدا نام، تلفن و آدرس تحویل را از مسیر ثبت سفارش کامل کنید.', parse_mode: 'HTML' })
          });
          return;
        }
        order.status = 'approved_by_customer';
        order.paymentMethod = 'cash_on_delivery';
        order.isPrepaymentPaid = false;
        order.prepaymentStatus = 'not_required';
        delete order.paymentReceiptImage;
        delete order.prepaymentSubmittedAt;
        delete order.prepaymentReviewedAt;
        delete order.prepaymentRejectReason;
        order.updatedAt = new Date().toISOString();
        saveAllData();
        userStates.delete(chatId);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: tmsg('cashOnDeliverySelectedMessage', {
              finalPrice: order.finalPrice?.toLocaleString() || '---',
            }),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '📦 پیگیری سفارشات', callback_data: 'track_order' }],
              [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
            ]}
          })
        });
      } else if (data.startsWith('custom_order_online_')) {
        const orderId = data.replace('custom_order_online_', '');
        const order = customOrders.find(o => o.id === orderId);
        if (!order || String(order.customerTelegramId) !== chatId) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '❌ سفارش یافت نشد یا امکان پرداخت آن برای شما وجود ندارد.',
              parse_mode: 'HTML'
            })
          });
          return;
        }
        if (!hasCompleteCustomOrderDelivery(order)) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '❌ ابتدا نام، تلفن و آدرس تحویل را از مسیر ثبت سفارش کامل کنید.', parse_mode: 'HTML' })
          });
          return;
        }
        userStates.set(chatId, { mode: 'custom_order_receipt', orderId: orderId });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: tmsg('customOrderPaymentPromptMessage', {
              prepaymentAmount: order.prepaymentAmount?.toLocaleString() || '---',
              cardNumber: botSettings.cardNumber,
              cardHolder: botSettings.cardHolder,
            }),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
            ]}
          })
        });
      } else if (data === 'back_to_main') {
        // Cancel any in-progress checkout/custom-registration state before
        // returning to the menu, then show the exact same main menu as /start.
        userStates.delete(chatId);
        await sendBotMainMenu(token, chatId, cb.from);
      } else if (data === 'admin_web_info') {
        const webUrl = botSettings.webAdminUrl || 'https://shirinkam-admin.iran.run';
        const user = botSettings.webAdminUsername || 'admin';
        const text = `🌐 <b>مشخصات پنل مدیریت تحت وب:</b>\n\n🔗 <b>آدرس وب:</b>\n<code>${webUrl}</code>\n\n👤 <b>نام کاربری:</b> <code>${user}</code>\n🔑 <b>رمز عبور:</b> برای حفظ امنیت نمایش داده نمی‌شود.\n\n<i>برای تغییر نام کاربری یا رمز عبور از تنظیمات امن پنل وب استفاده کنید.</i>`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🌐 ورود به پنل وب', url: webUrl }],
                [{ text: '🔙 بازگشت به پنل ادمین', callback_data: 'admin_panel' }]
              ]
            }
          })
        });
      } else if (data === 'menu_categories') {
        // Build the category list from the ACTUAL catalogue so every button
        // leads to products. Each button shows how many in-stock items that
        // category currently has, so customers don't have to open empty ones.
        const availableProducts = products.filter(p => p && p.isAvailable);
        const categoryOrder: string[] = [];
        const countsByCategory = new Map<string, number>();
        for (const p of availableProducts) {
          const cat = String(p.category || 'سایر').trim() || 'سایر';
          if (!countsByCategory.has(cat)) {
            countsByCategory.set(cat, 0);
            categoryOrder.push(cat);
          }
          countsByCategory.set(cat, (countsByCategory.get(cat) || 0) + 1);
        }
        const fa = (n: number) => n.toLocaleString('fa-IR');
        const categoryButtons: any[][] = [];
        const labelFor = (cat: string) => `${cat} (${fa(countsByCategory.get(cat) || 0)})`;
        for (let i = 0; i < categoryOrder.length; i += 2) {
          const row: any[] = [{ text: labelFor(categoryOrder[i]), callback_data: `cat_${categoryOrder[i]}` }];
          if (categoryOrder[i + 1]) row.push({ text: labelFor(categoryOrder[i + 1]), callback_data: `cat_${categoryOrder[i + 1]}` });
          categoryButtons.push(row);
        }
        categoryButtons.push([
          { text: `🌟 همه محصولات (${fa(availableProducts.length)})`, callback_data: 'cat_all' }
        ]);
        categoryButtons.push([
          { text: '🔙 منوی اصلی', callback_data: 'back_to_main' }
        ]);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🧁 <b>لطفاً دسته‌بندی مورد نظر خود را انتخاب نمایید:</b>\n\n<i>عدد داخل پرانتز = تعداد کالای موجود در هر دسته</i>',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: categoryButtons }
          })
        });
      } else if (data.startsWith('cat_')) {
        const selectedCategory = data.replace('cat_', '');
        const inStockProducts = products.filter(p => p && p.isAvailable);
        const filteredProducts = selectedCategory === 'all' ? inStockProducts : inStockProducts.filter(p => p.category === selectedCategory);
        if (filteredProducts.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `در دسته‌بندی <b>${selectedCategory === 'all' ? 'همه محصولات' : selectedCategory}</b> در حال حاضر محصول فعالی وجود ندارد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به دسته‌ها', callback_data: 'menu_categories' }]] }
            })
          });
          return;
        }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🍰 <b>محصولات ${selectedCategory === 'all' ? 'پرفروش' : selectedCategory} (${filteredProducts.length} مورد):</b>`,
            parse_mode: 'HTML'
          })
        });
        for (const prod of filteredProducts.slice(0, 10)) {
          const priceText = prod.discountPercent 
            ? `<s>${prod.price.toLocaleString()}</s> <b>${(prod.price * (100 - prod.discountPercent) / 100).toLocaleString()}</b> (${prod.discountPercent}٪ تخفیف)`
            : `<b>${prod.price.toLocaleString()}</b>`;
          const caption = `🎂 <b>${prod.name}</b>\n\n💰 <b>قیمت:</b> ${priceText} / هر ${prod.unit}\n📦 <b>وضعیت:</b> ${prod.isAvailable ? '🟢 موجود' : '🔴 ناموجود'}\n\n📝 ${prod.description || ''}`;
          const buttons: any[][] = [
            [{ text: `➕ ۱ ${prod.unit}`, callback_data: `add_qty_${prod.id}_1` }, { text: `➕ ۲ ${prod.unit}`, callback_data: `add_qty_${prod.id}_2` }],
            [{ text: '🛒 سبد خرید', callback_data: 'view_cart' }, { text: '🔙 دسته‌ها', callback_data: 'menu_categories' }]
          ];
          await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              photo: prod.image,
              caption,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: buttons }
            })
          });
        }
      } else if (data.startsWith('custom_qty_')) {
        const prodId = data.replace('custom_qty_', '');
        const prod = products.find(p => p.id === prodId);
        if (!prod) return;
        userStates.set(chatId, { mode: 'custom_qty_input', productId: prodId });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔢 <b>تعداد دلخواه ${prod.name}</b>\n\nلطفاً تعداد (${prod.unit}) را وارد کنید:\n<i>(مثال: 2 یا 4.5)</i>`,
            parse_mode: 'HTML'
          })
        });
      } else if (data.startsWith('add_qty_')) {
        // Quick-add buttons on product cards: add_qty_<productId>_<quantity>.
        // These previously had no handler, so tapping "➕ ۱ / ➕ ۲" did nothing.
        const parts = data.split('_');
        const qty = Number(parts[parts.length - 1]);
        const prodId = data.slice('add_qty_'.length, data.lastIndexOf('_'));
        const prod = products.find(p => p.id === prodId);
        if (!prod) return;
        const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const cart = userCarts.get(chatId) || [];
        const existing = cart.find((i: any) => i.productId === prod.id);
        if (existing) { existing.quantity += quantity; } else { cart.push({ productId: prod.id, quantity }); }
        userCarts.set(chatId, cart);
        // Clear any leftover flow state so checkout later starts cleanly.
        userStates.delete(chatId);
        const totalQty = cart.reduce((s: number, i: any) => s + i.quantity, 0);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ <b>${quantity.toLocaleString('fa-IR')} ${prod.unit}</b> از «${prod.name}» به سبد خرید افزوده شد.\n\n🛒 <b>تعداد کل اقلام سبد:</b> ${totalQty.toLocaleString('fa-IR')}`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '🛒 مشاهده سبد خرید و پرداخت', callback_data: 'view_cart' }],
              [{ text: '🍰 ادامه خرید', callback_data: 'menu_categories' }]
            ] }
          })
        });
      } else if (data.startsWith('add_to_cart_')) {
        const prodId = data.replace('add_to_cart_', '');
        const prod = products.find(p => p.id === prodId);
        if (!prod) return;
        userStates.set(chatId, { mode: 'ask_quantity', productId: prodId });
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔢 <b>${prod.name}</b>\n\nچند ${prod.unit} از این محصول می‌خواهید؟\n<i>(فقط عدد وارد کنید، مثلاً: 2)</i>`,
            parse_mode: 'HTML'
          })
        });
      } else if (data === 'view_cart') {
        const cart = userCarts.get(chatId) || [];
        if (cart.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🛒 <b>سبد خرید شما خالی است!</b>\n\nبرای سفارش از منوی محصولات استفاده کنید.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🍰 مشاهده منو', callback_data: 'menu_categories' }]] }
            })
          });
          return;
        }
        let cartText = '🛒 <b>سبد خرید شما:</b>\n\n';
        let subtotal = 0;
        for (const item of cart) {
          const prod = products.find(p => p.id === item.productId);
          if (prod) {
            const effectivePrice = prod.discountPercent ? prod.price * (100 - prod.discountPercent) / 100 : prod.price;
            const itemTotal = effectivePrice * item.quantity;
            subtotal += itemTotal;
            cartText += `🔹 <b>${prod.name}</b>\n   ${item.quantity} ${prod.unit} × ${effectivePrice.toLocaleString()} = <b>${itemTotal.toLocaleString()}</b>\n\n`;
          }
        }
        cartText += `────────────────\n`;
        cartText += `💵 مجموع اقلام: <b>${subtotal.toLocaleString()} تومان</b>\n`;
        cartText += `🛵 هزینه ارسال: پس از انتخاب نحوه دریافت (حضوری / پیک) در مرحله پرداخت محاسبه می‌شود`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: cartText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
              [{ text: '💳 ثبت سفارش و پرداخت', callback_data: 'checkout_start' }],
              [{ text: '🗑️ خالی کردن سبد', callback_data: 'clear_cart' }],
              [{ text: '🍰 ادامه خرید', callback_data: 'menu_categories' }],
              [{ text: '🏠 بازگشت به منوی اصلی', callback_data: 'back_to_main' }]
            ]}
          })
        });
      } else if (data === 'clear_cart') {
        userCarts.delete(chatId);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🗑️ سبد خرید شما خالی شد.',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '🍰 مشاهده منو', callback_data: 'menu_categories' }]] }
          })
        });
      } else if (data === 'checkout_start') {
        const _cartNow = userCarts.get(chatId) || [];
        console.log('[checkout] checkout_start tapped by', chatId, '| cart items:', _cartNow.length, '| state mode:', (userStates.get(chatId) as any)?.mode || 'none');
        // Immediate guaranteed feedback so the button can NEVER look dead,
        // even if the following step fails for any reason.
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id, text: 'در حال باز کردن فرآیند پرداخت…' })
        }).catch(() => {});
        try {
          const tgCtx = { token, chatId, products, orders, discounts, customers, botSettings, userCarts, userStates, msg: { from: cb.from } };
          await startCheckout(tgCtx);
          console.log('[checkout] startCheckout finished without error');
        } catch (err) {
          console.error('[checkout] startCheckout FAILED:', err);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: 'HTML',
              text: '⚠️ در باز کردن پرداخت مشکلی پیش آمد. لطفاً دوباره از سبد خرید اقدام کنید.',
              reply_markup: { inline_keyboard: [
                [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }],
                [{ text: '🍰 منوی محصولات', callback_data: 'menu_categories' }]
              ] }
            })
          }).catch(() => {});
        }
      } else if (data === 'delivery_pickup' || data === 'delivery_delivery' || data === 'payment_cash_on_delivery' || data === 'payment_online' || data === 'has_discount' || data === 'no_discount' || data === 'confirm_order' || data === 'cancel_order' || data === 'checkout_new_address' || data.startsWith('checkout_saved_address_')) {
        const tgCtx = { token, chatId, products, orders, discounts, customers, botSettings, userCarts, userStates, msg: { from: cb.from } };
        const handled = await handleCheckoutCallback(tgCtx, data);
        if (handled) {
          saveAllData();
          return;
        }
      } else if (data === 'track_order' || data === 'track_orders_list') {
        // Custom pastry orders live in a separate collection from regular cart
        // orders. Include both collections so a customer never sees “no orders”
        // immediately after submitting a custom design request.
        const userOrders = orders.filter((order) => String(order.customerTelegramId) === chatId);
        const userCustomOrders = customOrders.filter((order) => String(order.customerTelegramId) === chatId);
        const totalTrackedOrders = userOrders.length + userCustomOrders.length;

        if (totalTrackedOrders === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: tmsg('noOrdersMessage'),
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🍰 ثبت سفارش جدید', callback_data: 'menu_categories' }], [{ text: '🎨 ثبت محصول سفارشی', callback_data: 'custom_product_start' }]] }
            })
          });
          return;
        }

        const summary = [
          userOrders.length ? `${userOrders.length} سفارش عادی` : '',
          userCustomOrders.length ? `${userCustomOrders.length} سفارش سفارشی` : '',
        ].filter(Boolean).join(' و ');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📦 <b>سفارشات شما (${summary}):</b>`,
            parse_mode: 'HTML'
          })
        });

        for (const ord of userOrders) {
          const statusMap: Record<string, string> = {
            pending_payment: '⏳ در انتظار تأیید',
            paid_checking: '🔍 بررسی فیش',
            receipt_confirmed: '✅ فیش تأیید شد؛ در انتظار شروع پخت',
            baking: '👩‍🍳 در حال پخت',
            shipped: '🛵 ارسال شده',
            delivered: '✅ تحویل شد',
            cancelled: '❌ لغو شده'
          };
          let orderText = `🔖 <b>کد سفارش:</b> <code>${ord.orderNumber}</code>\n`;
          orderText += `📊 وضعیت: <b>${statusMap[ord.status] || ord.status}</b>\n\n`;
          orderText += `📦 <b>اقلام:</b>\n`;
          ord.items.forEach((item, idx) => {
            orderText += `${idx + 1}. ${item.productName}\n`;
            orderText += `   کد: <code>${item.productCode}</code>\n`;
            orderText += `   ${item.quantity} ${item.unit} × ${item.price.toLocaleString()} = <b>${(item.price * item.quantity).toLocaleString()}</b>\n\n`;
          });
          orderText += `─────────────────\n`;
          orderText += `📦 نحوه دریافت: <b>${ord.deliveryMethod === 'pickup' ? '🏪 حضوری' : '🛵 پیک'}</b>\n`;
          orderText += `💳 نحوه پرداخت: <b>${ord.paymentMethod === 'cash_on_delivery' ? '💵 در محل' : '💳 آنلاین'}</b>\n`;
          orderText += `💵 مجموع: <b>${ord.subtotal.toLocaleString()}</b>\n`;
          orderText += `🚚 ارسال: <b>${ord.shippingFee === 0 ? 'رایگان' : ord.shippingFee.toLocaleString()}</b>\n`;
          if (ord.discountAmount > 0) {
            orderText += `🎟️ تخفیف: <b>-${ord.discountAmount.toLocaleString()}</b>\n`;
          }
          orderText += `─────────────────\n`;
          orderText += `💎 <b>مبلغ نهایی: ${ord.totalAmount.toLocaleString()} تومان</b>\n`;

          const receiptAlreadyConfirmed = ord.receiptReviewStatus === 'confirmed'
            || ['receipt_confirmed', 'baking', 'shipped', 'delivered'].includes(ord.status);
          // A receipt is "under review" only once an image actually exists; a
          // fresh card-transfer order (paid_checking, photo not sent yet) must
          // still offer the upload button instead of claiming it was received.
          const receiptUnderReview = Boolean(ord.paymentReceiptImage)
            && !['confirmed', 'rejected'].includes(ord.receiptReviewStatus || '');
          const canSendReceipt = ord.paymentMethod !== 'cash_on_delivery'
            && !['cancelled', 'shipped', 'delivered'].includes(ord.status)
            && !receiptAlreadyConfirmed
            && !receiptUnderReview;

          const orderKeyboard: any[][] = [];
          if (canSendReceipt) {
            orderKeyboard.push([{
              text: ord.receiptReviewStatus === 'rejected' ? '📷 ارسال فیش جدید' : (ord.paymentReceiptImage ? '📷 ارسال مجدد فیش' : '📷 ارسال فیش واریزی'),
              callback_data: `order_reupload_receipt_${ord.id}`,
            }]);
            if (ord.receiptReviewStatus === 'rejected') {
              orderText += `\n❌ <b>فیش قبلی تأیید نشد.</b>${ord.receiptReviewReason ? ` دلیل: ${escapeTelegramHtml(ord.receiptReviewReason)}` : ''}\nلطفاً فیش صحیح را با دکمه زیر ارسال کنید.`;
            } else if (!ord.paymentReceiptImage) {
              orderText += `\n📷 برای ثبت پرداخت، مبلغ را کارت‌به‌کارت واریز کرده و با دکمه «ارسال فیش واریزی» تصویر آن را بفرستید.`;
            }
          } else if (receiptUnderReview) {
            orderText += `\n⏳ <b>فیش واریزی شما دریافت شده و در انتظار تأیید ادمین است.</b>`;
          }
          orderKeyboard.push([{ text: '🔙 بازگشت', callback_data: 'back_to_main' }]);

          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: orderText,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: orderKeyboard }
            })
          });
        }

        for (const customOrder of userCustomOrders) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: formatCustomOrderTrackingMessage(customOrder),
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_to_main' }]] }
            })
          });
        }
      } else if (data === 'admin_orders_list') {
        if (orders.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '📦 هیچ سفارشی ثبت نشده است.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
          return;
        }
        for (const ord of orders.slice(0, 5)) {
          const items = ord.items.map(i => `▫️ ${i.productName} (${i.quantity} ${i.unit})`).join('\n');
          const caption = `📋 <b>سفارش ${ord.orderNumber}</b>\n\n👤 ${ord.customerName}\n📞 <code>${ord.customerPhone}</code>\n\n${items}\n\n💰 <b>${ord.totalAmount.toLocaleString()} تومان</b>`;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: caption,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '👩‍🍳 شروع پخت', callback_data: `admin_status_${ord.id}_baking` }, { text: '🛵 ارسال', callback_data: `admin_status_${ord.id}_shipped` }],
                [{ text: '✅ تحویل شد', callback_data: `admin_status_${ord.id}_delivered` }, { text: '❌ لغو', callback_data: `admin_status_${ord.id}_cancelled` }]
              ]}
            })
          });
        }
      } else if (data.startsWith('admin_status_')) {
        const parts = data.replace('admin_status_', '').split('_');
        const orderId = parts[0];
        const newStatus = parts[1] as any;
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx !== -1) {
          orders[idx].status = newStatus;
          orders[idx].updatedAt = new Date().toISOString();
          const statusLabels: Record<string, string> = { baking: '👩‍🍳 پخت', shipped: '🛵 ارسال', delivered: '✅ تحویل', cancelled: '❌ لغو' };
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ وضعیت سفارش ${orders[idx].orderNumber} به <b>${statusLabels[newStatus] || newStatus}</b> تغییر یافت.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }], [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
        }
      } else if (data === 'admin_products_manager') {
        if (products.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🧁 هیچ محصولی ثبت نشده. از دکمه «➕ افزودن محصول» استفاده کنید.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '➕ افزودن محصول', callback_data: 'admin_add_product' }],
                [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
              ]}
            })
          });
          return;
        }
        for (const prod of products.slice(0, 8)) {
          const caption = `🎂 <b>${prod.name}</b>\n▫️ ${prod.category}\n▫️ قیمت: <b>${prod.price.toLocaleString()}</b> / ${prod.unit}\n▫️ ${prod.isAvailable ? '🟢 موجود' : '🔴 ناموجود'}`;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: caption,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: prod.isAvailable ? '🔴 ناموجود' : '🟢 موجود', callback_data: `admin_toggle_avail_${prod.id}` }, { text: '🗑️ حذف', callback_data: `admin_delete_prod_${prod.id}` }]
              ]}
            })
          });
        }
      } else if (data.startsWith('admin_toggle_avail_')) {
        const prodId = data.replace('admin_toggle_avail_', '');
        const prod = products.find(p => p.id === prodId);
        if (prod) {
          prod.isAvailable = !prod.isAvailable;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ ${prod.name}: <b>${prod.isAvailable ? '🟢 موجود' : '🔴 ناموجود'}</b>`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }], [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
        }
      } else if (data.startsWith('admin_delete_prod_')) {
        const prodId = data.replace('admin_delete_prod_', '');
        const idx = products.findIndex(p => p.id === prodId);
        if (idx !== -1) {
          const name = products[idx].name;
          products.splice(idx, 1);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `🗑️ محصول <b>${name}</b> حذف شد.`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }], [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
        }
      } else if (data === 'admin_add_product') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '➕ <b>افزودن محصول جدید</b>\n\nلطفاً <b>نام محصول</b> را ارسال کنید:\n<i>(مثال: کیک شکلاتی بلژیکی)</i>',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'admin_panel' }]] }
          })
        });
      } else if (data === 'admin_discounts_list') {
        if (discounts.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🎟️ هیچ کد تخفیفی ثبت نشده است.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
          return;
        }
        let text = '🎟️ <b>کدهای تخفیف:</b>\n\n';
        for (const d of discounts) {
          text += `<code>${d.code}</code> - ${d.type === 'percentage' ? d.value + '٪' : d.value.toLocaleString() + ' تومان'} ${d.isActive ? '🟢' : '🔴'}\n`;
        }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
          })
        });
      } else if (data === 'admin_customers_manager') {
        if (customers.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '👥 هیچ مشتری‌ای ثبت نشده است.\n\nمشتریان پس از اولین خرید اضافه می‌شوند.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
            })
          });
          return;
        }
        let text = `👥 <b>مشتریان (${customers.length} نفر):</b>\n\n`;
        for (const c of customers.slice(0, 10)) {
          text += `${c.name} - <code>${c.phone || '---'}</code>\n💳 ${c.walletBalance.toLocaleString()} تومان | ${c.totalOrdersCount} سفارش\n\n`;
        }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
          })
        });
      } else if (data === 'admin_sales_stats') {
        const totalRevenue = orders.reduce((s, o) => s + (o.status !== 'cancelled' ? o.totalAmount : 0), 0);
        const text = `📊 <b>آمار فروش:</b>\n\n💰 مجموع فروش: <b>${totalRevenue.toLocaleString()} تومان</b>\n📦 تعداد سفارشات: <b>${orders.length}</b>\n🧁 محصولات فعال: <b>${products.filter(p => p.isAvailable).length}</b>\n👥 مشتریان: <b>${customers.length}</b>`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
          })
        });
      } else if (data === 'admin_quick_settings') {
        const text = `⚙️ <b>تنظیمات:</b>\n\n💳 کارت: <code>${botSettings.cardNumber}</code>\n👤 ${botSettings.cardHolder}\n🛵 پیک: ${botSettings.shippingFee.toLocaleString()} تومان\n🎁 ارسال رایگان: بالای ${botSettings.freeShippingThreshold.toLocaleString()} تومان`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]] }
          })
        });
      }
    }
  }

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true, 
        allowedHosts: true,
        hmr: { host: '0.0.0.0' }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get('*', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Auto-save data every 10 seconds
  setInterval(() => {
    saveAllData();
  }, 10000);

  // Auto-run scheduled backup daemon every 60 seconds
  setInterval(() => {
    runScheduledBackupCheck();
  }, 60000);
  runScheduledBackupCheck();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('[build] version marker: polling-fix-v5 non-overlap long-poll (no self 409)');
    
    // Auto-start Telegram polling if token is available (from env or persisted settings)
    const activeToken = getTelegramBotToken();
    if (activeToken) {
      botSettings.isLiveBotActive = true;
      startTelegramPolling(activeToken);
      console.log('🤖 Telegram bot polling started automatically from configured token');
    }
  });
}

startServer();
