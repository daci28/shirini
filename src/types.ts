export type ProductCategory = 
  | 'کیک و پای'
  | 'شیرینی تر و خامه‌ای'
  | 'شیرینی خشک و سنتی'
  | 'دسر و باقلوا'
  | 'کوکی و بیسکوئیت'
  | 'نان و کروسان';

export interface Product {
  id: string;
  productCode: string;
  name: string;
  category: ProductCategory;
  price: number; // in Tomans
  unit: string; // e.g., کیلوگرم, جعبه ۱۲ تایی, دیس نیم‌کیلویی, عدد
  image: string;
  images?: string[];
  description: string;
  isAvailable: boolean;
  discountPercent?: number;
  preparationTimeHours?: number;
  stockKgOrCount?: number;
  createdAt: string;
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid_checking'
  /** Payment receipt was verified; an admin must still explicitly start production. */
  | 'receipt_confirmed'
  | 'baking'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  productId: string;
  productCode: string;
  productName: string;
  productImage: string;
  price: number;
  quantity: number;
  unit: string;
}

export interface DiscountCode {
  id: string;
  code: string;
  type: 'percentage' | 'fixed'; // درصدی یا مبلغی به تومان
  value: number; // e.g. 20 (percent) or 50000 (Tomans)
  minPurchaseAmount?: number; // حداقل مبلغ خرید به تومان
  maxDiscountAmount?: number; // حداکثر سقف تخفیف برای کدهای درصدی
  usageLimit?: number; // سقف کل دفعات استفاده
  usedCount: number; // دفعات استفاده شده
  isActive: boolean;
  expiresAt?: string; // ISO date string
  applicableProductIds?: string[]; // خالی یا تعریف‌نشده = همه محصولات
  description?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerTelegramId?: string;
  /** Telegram @username captured when the customer places the order. */
  customerUsername?: string;
  /** Telegram display name, kept separately from the delivery contact name. */
  customerTelegramName?: string;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  couponCode?: string;
  totalAmount: number;
  status: OrderStatus;
  deliveryMethod: 'pickup' | 'delivery';
  /** Recipient name captured at the pickup/delivery step. */
  deliveryRecipientName?: string;
  paymentMethod: 'cash_on_delivery' | 'online_payment' | 'card_to_card' | 'online_gateway';
  paymentReceiptImage?: string;
  /** Review state of the most recently submitted receipt, retained with the image for audit. */
  receiptReviewStatus?: 'submitted' | 'confirmed' | 'rejected';
  receiptReviewedAt?: string;
  receiptReviewReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ForumTopicKey =
  | 'orders'
  | 'custom_orders'
  | 'finance'
  | 'products'
  | 'customers'
  | 'discounts'
  | 'support'
  | 'system_backups'
  | 'analytics';

export interface ForumTopicConfig {
  id: string;
  key: ForumTopicKey;
  name: string;
  iconEmoji: string;
  colorHex?: string;
  threadId?: number; // Telegram message_thread_id
  enabled: boolean;
  autoReport: boolean;
  description: string;
  lastReportTime?: string;
  lastReportSummary?: string;
}

export interface BotSettings {
  botName: string;
  botUsername: string;
  storeName: string;
  storeBio: string;
  storePhone: string;
  storeAddress: string;
  cardNumber: string;
  cardHolder: string;
  shabaNumber: string;
  shippingFee: number;
  freeShippingThreshold: number;
  adminTelegramId: string;
  adminTelegramIds: string[];
  welcomeMessage: string;
  helpMessage: string;
  orderSuccessMessage?: string;
  paymentGuideMessage?: string;
  supportMessage?: string;
  aboutUsMessage?: string;
  shippingInfoMessage?: string;
  discountBannerMessage?: string;
  customCakeGuideMessage?: string;
  /** Write-only in the panel API; this is only used while submitting a replacement token. */
  telegramBotToken?: string;
  /** Server-provided status flag; it never contains or reveals the token itself. */
  hasTelegramBotToken?: boolean;
  isLiveBotActive: boolean;
  forumGroupId?: string;
  forumGroupTitle?: string;
  forumAutoCreateTopics?: boolean;
  forumTopics?: ForumTopicConfig[];
  webAdminUrl?: string;
  webAdminUsername?: string;
  webAdminPassword?: string;
  webAdminLastLogin?: string;
  /**
   * Admin customizations for the individual customer-facing bot messages.
   * Keys match BotMessageKey in src/data/botMessages; a missing/empty value
   * falls back to the built-in default text.
   */
  botTexts?: Record<string, string>;
}

export type SupportCategory = 
  | 'custom_cake' 
  | 'order_inquiry' 
  | 'payment_issue' 
  | 'feedback' 
  | 'consultation' 
  | 'general';

export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'closed';

export interface SupportTicketReply {
  id: string;
  sender: 'customer' | 'admin';
  senderName: string;
  text: string;
  /** Telegram file_id or an image URL sent with this reply. */
  photo?: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  customerName: string;
  customerTelegramId: string;
  customerUsername?: string;
  customerPhone?: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: 'low' | 'normal' | 'high';
  orderNumber?: string;
  cakePhoto?: string;
  createdAt: string;
  updatedAt: string;
  replies: SupportTicketReply[];
}

export interface CustomerUser {
  id: string;
  telegramId: string;
  name: string;
  /**
   * True when `name` was explicitly typed by the customer (checkout / custom
   * order registration) or set by an admin in the panel. A name copied from the
   * Telegram account profile is NEVER trusted on its own and stays false until
   * the customer confirms it — at checkout the bot always asks for the name
   * when this is not true.
   */
  nameConfirmed?: boolean;
  phone: string;
  username?: string;
  address?: string;
  /** Address book: every new delivery address the customer provides is kept. */
  addresses?: string[];
  walletBalance: number; // in Tomans (کیف پول مشتری)
  rewardPoints: number; // امتیاز باشگاه مشتریان
  totalOrdersCount: number;
  totalSpentTomans: number;
  tier: 'bronze' | 'silver' | 'gold' | 'vip';
  /** 'bot' = created from Telegram activity; 'manual' = added by an admin in the panel. */
  source?: 'bot' | 'manual';
  createdAt: string;
  lastActiveAt: string;
}

export interface WalletTransaction {
  id: string;
  customerId: string;
  customerName: string;
  type: 'deposit' | 'withdraw' | 'cashback' | 'order_payment' | 'admin_adjustment';
  amount: number; // in Tomans
  description: string;
  createdAt: string;
  balanceAfter: number;
}

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: 'hourly' | 'every_6_hours' | 'every_12_hours' | 'daily' | 'weekly' | 'every_order';
  timeOfDay: string; // e.g. "23:30" or "02:00"
  selectedDays: number[]; // 0=Saturday, 1=Sunday, ... 6=Friday
  autoDownload: boolean;
  keepLastSnapshots: number; // e.g. 10
  notifyTelegramTopic: boolean;
  lastBackupTime?: string;
  nextBackupTime?: string;
}

export type CustomPastryType = 
  | 'کیک تولد و مناسبتی'
  | 'کیک عصرانه و خانگی'
  | 'شیرینی تر و خامه‌ای مجلسی'
  | 'شیرینی خشک و سنتی اعلا'
  | 'کوکی و تارت اختصاصی'
  | 'دسر و باقلوا سفارشی'
  | 'پکیج پذیرایی مراسم و جشن';

export type InvoiceSource = 'regular_order' | 'custom_order' | 'manual';

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'pending_payment'
  | 'payment_review'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'refunded';

export type InvoicePaymentMethod =
  | 'cash'
  | 'cash_on_delivery'
  | 'card_to_card'
  | 'online_payment'
  | 'online_gateway'
  | 'bank_transfer'
  | 'wallet'
  | 'other';

export type InvoicePaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'refunded';

export interface InvoiceItem {
  id: string;
  title: string;
  description?: string;
  productCode?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  method: InvoicePaymentMethod;
  status: InvoicePaymentStatus;
  receiptImage?: string;
  transactionReference?: string;
  notes?: string;
  /** Audit information for a customer-submitted receipt reviewed in the panel. */
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt?: string;
  paidAt?: string;
}

/**
 * A unified finance document. `regular_order` and `custom_order` invoices are
 * calculated from their source order; only `manual` invoices are editable and
 * persisted as standalone records.
 */
export interface Invoice {
  id: string;
  invoiceNumber: string;
  source: InvoiceSource;
  sourceId?: string;
  relatedOrderNumber?: string;
  title?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerTelegramId?: string;
  customerAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  paymentMethod?: InvoicePaymentMethod;
  payments: InvoicePayment[];
  dueDate?: string;
  deliveryMethod?: 'pickup' | 'delivery';
  deliveryAddress?: string;
  notes?: string;
  /** Last successful Telegram delivery of this standalone invoice to its customer. */
  customerNotificationSentAt?: string;
  /** Number of successful manual sends/re-sends to the customer's Telegram chat. */
  customerNotificationCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type CustomPrepaymentReviewStatus =
  | 'not_required'
  | 'awaiting_receipt'
  | 'pending_confirmation'
  | 'approved'
  | 'rejected';

export type CustomPastryStatus = 
  | 'pending_review'      // در انتظار بررسی و قیمت‌گذاری قناد
  | 'price_quoted'        // قیمت‌گذاری شد - در انتظار تایید و بیعانه مشتری
  | 'approved_by_customer'// تایید مشتری و واریز بیعانه
  | 'receipt_confirmed'   // فیش بیعانه تأیید شد؛ شروع پخت هنوز با ادمین است
  | 'baking'              // در حال پخت و تزیین کارگاه
  | 'ready'               // آماده تحویل / ارسال
  | 'delivered'           // تحویل داده شد
  | 'rejected';           // رد شده یا لغو

export interface CustomPastryChatMessage {
  id: string;
  sender: 'customer' | 'admin';
  senderName: string;
  text: string;
  photo?: string;
  createdAt: string;
}

export interface CustomPastryOrder {
  id: string;
  orderNumber: string; // e.g. CP-8910
  customerName: string;
  customerPhone: string;
  customerTelegramId: string;
  customerUsername?: string;
  /** Telegram display name before/alongside the delivery contact name. */
  customerTelegramName?: string;
  pastryType: CustomPastryType;
  spongeFlavor?: string; // e.g. وانیلی فرانسوی, شکلاتی بلژیکی, ردولوت, هل و زعفران, نسکافه
  fillingFlavor?: string; // e.g. موز و گردو خامه, نوتلا فندقی, پسته شاهانه, کارامل لوتوس, توت‌فرنگی
  weightKg?: number; // وزن تقریبی به کیلوگرم یا تعداد نفرات
  servingCount?: number; // تعداد مهمانان
  tierCount?: number; // تعداد طبقات
  dietaryType?: 'عادی' | 'کم‌شکر' | 'بدون قند (دیابتی)' | 'بدون گلوتن' | 'وگان' | 'کتوژنیک';
  shapeAndDesign: string; // توضیحات طرح، رنگ، فوندانت یا خامه، مدل، تم
  writingOnCake?: string; // متن یا دل‌نوشته روی کیک / پلاکارت
  referenceImages?: string[]; // تصاویر ارسالی مدل/طرح مشتری
  deliveryType: 'delivery' | 'pickup';
  deliveryAddress?: string;
  /** Requested Solar Hijri delivery day, collected from the customer in Iran's timezone. */
  deliveryDate?: string; // مثال: 1405/06/15
  deliveryTimeSlot?: string; // بازه زمانی تحویل مثلا 17:00 الی 20:00
  estimatedPrice?: number; // برآورد تقریبی سیستم
  finalPrice?: number; // قیمت قطعی اعلام شده توسط قناد (تومان)
  prepaymentAmount?: number; // مبلغ بیعانه تعیین شده (تومان)
  /**
   * `true` only after an administrator approves the submitted receipt. Kept
   * for backwards compatibility with earlier persisted orders.
   */
  isPrepaymentPaid?: boolean;
  /** Independent receipt-review lifecycle; uploading a receipt is never an approval. */
  prepaymentStatus?: CustomPrepaymentReviewStatus;
  prepaymentSubmittedAt?: string;
  prepaymentReviewedAt?: string;
  prepaymentRejectReason?: string;
  paymentMethod?: 'cash_on_delivery' | 'card_to_card';
  paymentReceiptImage?: string; // Telegram file_id or URL of the prepayment receipt
  status: CustomPastryStatus;
  adminNotes?: string; // یادداشت داخلی کارگاه/سرقناد
  rejectReason?: string;
  chatMessages: CustomPastryChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface BackupSnapshotStats {
  productsCount: number;
  ordersCount: number;
  customersCount: number;
  totalWalletBalance: number;
  discountsCount: number;
  ticketsCount: number;
  forumTopicsCount: number;
  customOrdersCount?: number;
  invoicesCount?: number;
}

export interface MasterBackupPayload {
  app: string;
  version: string;
  exportTimestamp: string;
  checksum: string;
  environment: 'production' | 'staging' | 'dev';
  metadata: {
    generatedBy: string;
    databaseEngine: string;
    totalEntities: number;
    totalWalletBalances: number;
    storeName: string;
    storePhone: string;
  };
  data: {
    products: Product[];
    orders: Order[];
    customOrders?: CustomPastryOrder[];
    /** Standalone manual invoices. Order-backed invoices are regenerated from orders. */
    invoices?: Invoice[];
    customers: CustomerUser[];
    walletTransactions: WalletTransaction[];
    discounts: DiscountCode[];
    supportTickets: SupportTicket[];
    botSettings: BotSettings;
    backupSchedule?: BackupScheduleConfig;
  };
}

export interface BackupSnapshot {
  id: string;
  filename: string;
  timestamp: string;
  type: 'manual' | 'scheduled' | 'pre_restore_safety';
  sizeBytes: number;
  stats: BackupSnapshotStats;
  checksum: string;
  version: string;
  payload: MasterBackupPayload;
}

export interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface TelegramMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  photo?: string;
  reply_markup?: {
    inline_keyboard?: TelegramInlineButton[][];
  };
  timestamp: string;
  status?: 'sent' | 'received' | 'read';
}

export interface BotUserState {
  telegramId: string;
  name: string;
  username?: string;
  role: 'customer' | 'admin';
  cart: { productId: string; quantity: number }[];
  currentStep?: string; // for multi-step admin/ordering bot wizard
  tempData?: Record<string, any>;
}
