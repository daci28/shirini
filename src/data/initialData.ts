import { Product, BotSettings, Order, DiscountCode, SupportTicket, CustomerUser, WalletTransaction, BackupScheduleConfig, BackupSnapshot, CustomPastryOrder, ForumTopicConfig } from '../types';

export const INITIAL_PRODUCTS: Product[] = [];

export const INITIAL_FORUM_TOPICS: ForumTopicConfig[] = [
  {
    id: 'topic-orders',
    key: 'orders',
    name: '📦 سفارشات آماده و ارسال',
    iconEmoji: '📦',
    colorHex: '#6FB9F0',
    enabled: true,
    autoReport: true,
    description: 'اعلان لحظه‌ای ثبت سفارشات جدید مشتریان، تغییر وضعیت پخت و ارسال پیک'
  },
  {
    id: 'topic-custom-orders',
    key: 'custom_orders',
    name: '🎂 سفارشات کیک و دلخواه',
    iconEmoji: '🎂',
    colorHex: '#FF93B2',
    enabled: true,
    autoReport: true,
    description: 'سفارش‌های کیک و شیرینی دلخواه، طرح و عکس، قیمت‌گذاری سرقناد و بیعانه'
  },
  {
    id: 'topic-finance',
    key: 'finance',
    name: '💳 امور مالی و فیش‌های بانکی',
    iconEmoji: '💳',
    colorHex: '#8EEE98',
    enabled: true,
    autoReport: true,
    description: 'فیش‌های واریزی کارت‌به‌کارت، تأیید/رد فیش‌ها، فاکتورهای دستی و کیف‌پول'
  },
  {
    id: 'topic-products',
    key: 'products',
    name: '🧁 ویترین و انبار محصولات',
    iconEmoji: '🧁',
    colorHex: '#FFD67E',
    enabled: true,
    autoReport: true,
    description: 'افزودن محصول جدید، تغییر قیمت‌ها و وضعیت موجودی انبار'
  },
  {
    id: 'topic-customers',
    key: 'customers',
    name: '👤 اعضا و باشگاه مشتریان',
    iconEmoji: '👤',
    colorHex: '#CB86DB',
    enabled: true,
    autoReport: true,
    description: 'عضویت کاربران جدید در ربات، ثبت و تغییر آدرس و ویرایش مشخصات مشتری'
  },
  {
    id: 'topic-discounts',
    key: 'discounts',
    name: '🎟️ جشنواره و کدهای تخفیف',
    iconEmoji: '🎟️',
    colorHex: '#FB6F5F',
    enabled: true,
    autoReport: true,
    description: 'تعریف کدهای تخفیف جدید و گزارش لحظه‌ای استفاده مشتریان'
  },
  {
    id: 'topic-support',
    key: 'support',
    name: '💬 پیام‌ها و پشتیبانی',
    iconEmoji: '💬',
    colorHex: '#6FB9F0',
    enabled: true,
    autoReport: true,
    description: 'پیام‌ها و تیکت‌های دریافتی از مشتریان و ارسال پاسخ پشتیبانی'
  },
  {
    id: 'topic-system-backups',
    key: 'system_backups',
    name: '💾 پشتیبان‌گیری و سیستم',
    iconEmoji: '💾',
    colorHex: '#CB86DB',
    enabled: true,
    autoReport: true,
    description: 'گزارش بکاپ‌های خودکار دیتابیس، اسنپ‌شات‌ها و وضعیت فنی سرور'
  }
];

export const INITIAL_BOT_SETTINGS: BotSettings = {
  botName: '',
  botUsername: '',
  storeName: '',
  storeBio: '',
  storePhone: '',
  storeAddress: '',
  cardNumber: '',
  cardHolder: '',
  shabaNumber: '',
  shippingFee: 0,
  freeShippingThreshold: 0,
  adminTelegramId: '',
  adminTelegramIds: [],
  welcomeMessage: '',
  helpMessage: '',
  orderSuccessMessage: '',
  paymentGuideMessage: '',
  supportMessage: '',
  aboutUsMessage: '',
  shippingInfoMessage: '',
  customCakeGuideMessage: '',
  telegramBotToken: '',
  isLiveBotActive: false,
  forumGroupId: '',
  forumGroupTitle: '',
  forumAutoCreateTopics: false,
  forumTopics: INITIAL_FORUM_TOPICS,
  webAdminUrl: typeof window !== 'undefined' ? window.location.origin : '',
  webAdminUsername: 'admin',
  // The server supplies and hashes the documented initial password; never put
  // a plaintext credential into the browser bundle or settings seed.
  webAdminLastLogin: ''
};

export const INITIAL_ORDERS: Order[] = [];

export const INITIAL_DISCOUNT_CODES: DiscountCode[] = [];

export const INITIAL_SUPPORT_TICKETS: SupportTicket[] = [];

export const INITIAL_CUSTOMERS: CustomerUser[] = [];

export const INITIAL_WALLET_TRANSACTIONS: WalletTransaction[] = [];

export const INITIAL_CUSTOM_ORDERS: CustomPastryOrder[] = [];

export const INITIAL_BACKUP_SCHEDULE: BackupScheduleConfig = {
  enabled: false,
  frequency: 'daily',
  timeOfDay: '23:30',
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
  autoDownload: false,
  keepLastSnapshots: 10,
  notifyTelegramTopic: false,
  lastBackupTime: '',
  nextBackupTime: ''
};

export const INITIAL_BACKUP_SNAPSHOTS: BackupSnapshot[] = [];
