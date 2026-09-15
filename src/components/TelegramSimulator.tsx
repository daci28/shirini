import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  RefreshCw, 
  Check, 
  ArrowRight, 
  Trash2, 
  Plus, 
  Minus, 
  Camera, 
  Image as ImageIcon, 
  Phone, 
  MapPin, 
  CreditCard, 
  ShieldCheck, 
  User, 
  Moon, 
  Sun, 
  Copy,
  Clock,
  CheckCheck,
  ShoppingBag,
  Cake,
  Edit3,
  Search,
  SlidersHorizontal,
  DollarSign,
  Upload,
  Layers
} from 'lucide-react';
import { 
  Product, 
  Order, 
  BotSettings, 
  TelegramMessage, 
  TelegramInlineButton, 
  ProductCategory,
  DiscountCode
} from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';
import { resolveTelegramImageSource } from '../utils/telegramImage';
import { matchesSearchValues } from '../utils/search';
import { ZoomableImageModal } from './ZoomableImageModal';

interface TelegramSimulatorProps {
  products: Product[];
  orders: Order[];
  discounts?: DiscountCode[];
  botSettings: BotSettings;
  role: 'customer' | 'admin';
  setRole: (role: 'customer' | 'admin') => void;
  onAddProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<Product>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onAddDiscount?: (discount: Omit<DiscountCode, 'id' | 'createdAt'>) => Promise<DiscountCode>;
  onUpdateDiscount?: (id: string, updates: Partial<DiscountCode>) => Promise<void>;
  onDeleteDiscount?: (id: string) => Promise<void>;
  onCreateOrder: (order: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>) => Promise<Order>;
  onUpdateOrderStatus: (id: string, status: Order['status']) => Promise<void>;
  onUpdateSettings?: (newSettings: Partial<BotSettings>) => Promise<void>;
}

export const TelegramSimulator: React.FC<TelegramSimulatorProps> = ({
  products,
  orders,
  discounts = [],
  botSettings,
  role,
  setRole,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onAddDiscount,
  onUpdateDiscount,
  onDeleteDiscount,
  onCreateOrder,
  onUpdateOrderStatus,
  onUpdateSettings
}) => {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    discountAmount: number;
    discountObj?: DiscountCode;
  } | null>(null);
  const [isAwaitingDiscountCode, setIsAwaitingDiscountCode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [copiedCard, setCopiedCard] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [adminStep, setAdminStep] = useState<{
    mode: 'idle' | 'add_name' | 'add_category' | 'add_price' | 'add_image' | 'add_desc' | 'edit_price_val' | 'upload_photo_for_prod' | 'edit_web_user' | 'edit_web_pass' | 'edit_web_url';
    productId?: string;
    draftProduct?: Partial<Product>;
  }>({ mode: 'idle' });

  const [checkoutStep, setCheckoutStep] = useState<{
    step: 'idle' | 'name' | 'phone' | 'address' | 'invoice_preview' | 'receipt';
    draftOrder?: Partial<Order>;
  }>({ step: 'idle' });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Initial welcome message based on role
  useEffect(() => {
    if (messages.length === 0) {
      if (role === 'admin') {
        sendAdminWelcomeMessage();
      } else {
        sendCustomerWelcomeMessage();
      }
    }
  }, [role]);

  // Helper to add Bot message with natural typing delay
  const addBotMessage = (
    text: string,
    buttons?: TelegramInlineButton[][],
    photo?: string,
    delayMs = 400
  ) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          sender: 'bot',
          text,
          photo,
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
          reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
        },
      ]);
    }, delayMs);
  };

  // Helper to add user message
  const addUserMessage = (text: string, photo?: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        sender: 'user',
        text,
        photo,
        timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const sendCustomerWelcomeMessage = () => {
    const text = `🌸 <b>به ربات رسمی قنادی ${botSettings.storeName} خوش آمدید!</b>\n\n${botSettings.welcomeMessage}\n\n🍰 انواع کیک‌های سفارشی، شیرینی تر و خامه‌ای، باقلوای تازه و دسرهای بین‌المللی با پخت روزانه.\n\n👇 جهت مشاهده محصولات، انتخاب تعداد و ثبت سفارش از دکمه‌های شیشه‌ای زیر استفاده نمایید:`;
    const buttons: TelegramInlineButton[][] = [
      [
        { text: '🍰 منوی محصولات و سفارش آنلاین', callback_data: 'customer_categories' },
        { text: `🛒 سبد خرید (${toPersianDigits(cart.reduce((s, i) => s + i.quantity, 0))})`, callback_data: 'view_cart' }
      ],
      [
        { text: '📦 سفارشات من', callback_data: 'track_orders_list' },
        { text: '⭐ پرفروش‌ترین‌های هفته', callback_data: 'cat_all' }
      ],
      [
        { text: '📍 آدرس، تلفن و درباره قنادی', callback_data: 'contact_info' },
        { text: '👨‍🍳 ورود به پنل مدیریت قنادی', callback_data: 'switch_to_admin' }
      ]
    ];
    addBotMessage(text, buttons, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&auto=format&fit=crop&q=80', 200);
  };

  // Helper to calculate cart totals and validate discount
  const getCartCalculation = () => {
    let subtotal = 0;
    cart.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        const effectivePrice = prod.discountPercent 
          ? prod.price * (100 - prod.discountPercent) / 100 
          : prod.price;
        subtotal += effectivePrice * item.quantity;
      }
    });

    let discountAmount = 0;
    let validDiscount = appliedDiscount;

    if (appliedDiscount) {
      const disc = appliedDiscount.discountObj || discounts.find(d => d.code.toUpperCase() === appliedDiscount.code.toUpperCase());
      if (disc) {
        if (!disc.isActive || (disc.minPurchaseAmount && subtotal < disc.minPurchaseAmount)) {
          validDiscount = null;
          discountAmount = 0;
        } else {
          if (disc.type === 'percentage') {
            discountAmount = Math.round((subtotal * disc.value) / 100);
            if (disc.maxDiscountAmount && discountAmount > disc.maxDiscountAmount) {
              discountAmount = disc.maxDiscountAmount;
            }
          } else {
            discountAmount = Math.min(disc.value, subtotal);
          }
        }
      }
    }

    const isFreeShipping = subtotal >= botSettings.freeShippingThreshold;
    const shippingFee = (subtotal === 0 || isFreeShipping) ? 0 : botSettings.shippingFee;
    const totalAmount = Math.max(0, subtotal - discountAmount + shippingFee);

    return {
      subtotal,
      isFreeShipping,
      shippingFee,
      discountAmount,
      totalAmount,
      validDiscount
    };
  };

  // Helper to render formal invoice preview message
  const sendInvoicePreviewMessage = (draft: Partial<Order>) => {
    const { subtotal, isFreeShipping, shippingFee, discountAmount, totalAmount, validDiscount } = getCartCalculation();

    let invoiceText = `🧾 <b>پیش‌نمایش فاکتور نهایی سفارش شما</b>\n`;
    invoiceText += `────────────────────\n`;
    invoiceText += `👤 <b>خریدار:</b> ${draft.customerName || 'مشتری گرامی'}\n`;
    invoiceText += `📞 <b>شماره تماس:</b> <code>${draft.customerPhone || '---'}</code>\n`;
    invoiceText += `🏠 <b>آدرس تحویل:</b> ${draft.customerAddress || '---'}\n`;
    invoiceText += `────────────────────\n`;
    invoiceText += `📋 <b>اقلام سفارش:</b>\n`;

    cart.forEach((item, idx) => {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        const effectivePrice = prod.discountPercent 
          ? prod.price * (100 - prod.discountPercent) / 100 
          : prod.price;
        const itemTotal = effectivePrice * item.quantity;
        invoiceText += `${toPersianDigits(idx + 1)}. <b>${prod.name}</b>\n   ▫️ تعداد: <b>${toPersianDigits(item.quantity)} ${prod.unit}</b> × ${formatPrice(effectivePrice)} = <b>${formatPrice(itemTotal)}</b>\n`;
      }
    });

    invoiceText += `────────────────────\n`;
    invoiceText += `💵 <b>مجموع اقلام:</b> ${formatPrice(subtotal)}\n`;

    if (discountAmount > 0 && validDiscount) {
      invoiceText += `🏷️ <b>تخفیف (${validDiscount.code}):</b> <font color="#10b981">-${formatPrice(discountAmount)}</font>\n`;
    }

    invoiceText += `🛵 <b>هزینه پیک:</b> ${isFreeShipping ? '🎉 رایگان' : formatPrice(shippingFee)}\n`;
    invoiceText += `💎 <b>مبلغ نهایی قابل پرداخت:</b> <b>${formatPrice(totalAmount)}</b>\n`;
    invoiceText += `────────────────────\n`;
    invoiceText += `💳 <b>شماره کارت جهت واریز:</b> <code>${botSettings.cardNumber}</code>\n`;
    invoiceText += `👤 <b>به نام:</b> ${botSettings.cardHolder}\n\n`;
    invoiceText += `⚠️ <i>لطفاً مشخصات و اقلام فوق را بررسی نمایید. در صورت تایید، روی دکمه «تایید نهایی و ثبت سفارش» کلیک کنید.</i>`;

    const buttons: TelegramInlineButton[][] = [
      [
        { text: '✅ تایید نهایی و ثبت سفارش', callback_data: 'confirm_final_order' }
      ],
      [
        { text: '✏️ ویرایش آدرس', callback_data: 'edit_checkout_address' },
        { text: '✏️ ویرایش نام و تلفن', callback_data: 'edit_checkout_contact' }
      ],
      [
        { text: '🏷️ تغییر کد تخفیف', callback_data: 'apply_discount_prompt' },
        { text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }
      ]
    ];

    addBotMessage(invoiceText, buttons);
  };

  const sendAdminWelcomeMessage = () => {
    const regularPendingReceipts = orders.filter(o => o.paymentReceiptImage && (o.status === 'pending_payment' || o.status === 'paid_checking') && !['confirmed', 'rejected'].includes(o.receiptReviewStatus || '')).length;
    const pendingOrdersCount = orders.filter(o => o.status === 'paid_checking' || o.status === 'receipt_confirmed' || o.status === 'baking').length;
    const activeDiscountsCount = discounts.filter(d => d.isActive).length;
    const totalAdminsCount = 1 + (botSettings.adminTelegramIds?.length || 0);

    const text = `👨‍🍳 <b>پنل مدیریت جامع ربات تلگرام قنادی</b>\n────────────────────\nخوش آمدید مدیر گرامی! کلیه بخش‌های متناظر با پنل تحت وب (فاکتورها، سفارشات، محصولات، تخفیف‌ها، مدیران، سوپرگروه ۸ تاپیک و آمار) از این منو در دسترس شماست.`;
    const buttons: TelegramInlineButton[][] = [
      [
        { text: `🧾 فاکتورها و پرداخت‌ها (${toPersianDigits(regularPendingReceipts)})`, callback_data: 'admin_invoices' },
        { text: `📦 سفارشات (${toPersianDigits(pendingOrdersCount)})`, callback_data: 'admin_orders_list' }
      ],
      [
        { text: '➕ افزودن محصول جدید', callback_data: 'admin_add_product' },
        { text: `🧁 محصولات (${toPersianDigits(products.length)})`, callback_data: 'admin_products_manager' }
      ],
      [
        { text: `🎟️ تخفیف‌ها (${toPersianDigits(activeDiscountsCount)})`, callback_data: 'admin_discounts_list' },
        { text: '👥 مدیریت کاربران', callback_data: 'admin_customers_manager' }
      ],
      [
        { text: `🛡️ مدیران ربات (${toPersianDigits(totalAdminsCount)})`, callback_data: 'admin_admins_manager' },
        { text: `🏷️ سوپرگروه (۸ تاپیک)`, callback_data: 'admin_forum_topics' }
      ],
      [
        { text: '📊 آمار و گزارش فروش', callback_data: 'admin_sales_stats' },
        { text: '💾 بکاپ و دیتابیس', callback_data: 'admin_backup' }
      ],
      [
        { text: '💰 مدیریت قیمت‌ها', callback_data: 'admin_price_manager' },
        { text: '⚙️ تنظیمات کارت و ارسال', callback_data: 'admin_quick_settings' }
      ],
      [
        { text: '📢 ارسال پیام همگانی', callback_data: 'admin_broadcast_prompt' },
        { text: '🌐 مشخصات پنل وب', callback_data: 'admin_web_panel_info' }
      ],
      [
        { text: '👥 بازگشت به دید مشتری', callback_data: 'switch_to_customer' }
      ]
    ];
    addBotMessage(text, buttons, 'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?w=800&auto=format&fit=crop&q=80', 200);
  };

  // Handle Telegram Callback Queries (Button Clicks)
  const handleCallbackQuery = async (data?: string) => {
    if (!data) return;

    // Switch roles
    if (data === 'switch_to_admin') {
      setRole('admin');
      addUserMessage('ورود به پنل مدیریت قنادی 👨‍🍳');
      sendAdminWelcomeMessage();
      return;
    }
    if (data === 'switch_to_customer') {
      setRole('customer');
      addUserMessage('بازگشت به دید مشتری 👥');
      sendCustomerWelcomeMessage();
      return;
    }

    // Customer Navigation
    if (data === 'back_to_main') {
      sendCustomerWelcomeMessage();
      return;
    }
    if (data === 'back_to_admin') {
      sendAdminWelcomeMessage();
      return;
    }

    if (data === 'customer_categories') {
      addUserMessage('مشاهده منو و دسته‌بندی‌ها 🍰');
      const categories: ProductCategory[] = [
        'کیک و پای',
        'شیرینی تر و خامه‌ای',
        'شیرینی خشک و سنتی',
        'دسر و باقلوا',
        'کوکی و بیسکوئیت',
        'نان و کروسان'
      ];
      const categoryButtons: TelegramInlineButton[][] = [];
      for (let i = 0; i < categories.length; i += 2) {
        const row: TelegramInlineButton[] = [
          { text: categories[i], callback_data: `cat_${categories[i]}` }
        ];
        if (categories[i + 1]) {
          row.push({ text: categories[i + 1], callback_data: `cat_${categories[i + 1]}` });
        }
        categoryButtons.push(row);
      }
      categoryButtons.push([
        { text: '🌟 همه محصولات پرفروش', callback_data: 'cat_all' },
        { text: '🔙 منوی اصلی', callback_data: 'back_to_main' }
      ]);
      addBotMessage(
        '🧁 <b>لطفاً دسته‌بندی مورد نظر خود را انتخاب نمایید:</b>\nهمه شیرینی‌ها با بهترین مواد اولیه تازه به صورت روزانه پخت می‌شوند.',
        categoryButtons
      );
      return;
    }

    if (data.startsWith('cat_')) {
      const selectedCategory = data.replace('cat_', '');
      const filteredProducts = selectedCategory === 'all' 
        ? products 
        : products.filter(p => p.category === selectedCategory);

      addUserMessage(`دسته‌بندی: ${selectedCategory === 'all' ? 'همه محصولات' : selectedCategory}`);

      if (filteredProducts.length === 0) {
        addBotMessage(
          `در دسته‌بندی <b>${selectedCategory}</b> در حال حاضر محصول فعالی وجود ندارد.`,
          [[{ text: '🔙 بازگشت به دسته‌ها', callback_data: 'customer_categories' }]]
        );
        return;
      }

      addBotMessage(
        `🍰 <b>محصولات ${selectedCategory === 'all' ? 'پرفروش' : selectedCategory} (${toPersianDigits(filteredProducts.length)} مورد):</b>\nبرای انتخاب تعداد دلخواه (مثلاً ۱، ۲، ۳ یا ۵ کیلوگرم) از دکمه‌های شیشه‌ای زیر هر محصول استفاده کنید:`,
        undefined,
        undefined,
        150
      );

      // Send each product card with quantity selector buttons
      filteredProducts.slice(0, 4).forEach((prod, index) => {
        const itemInCart = cart.find(c => c.productId === prod.id);
        const inCartQty = itemInCart ? itemInCart.quantity : 0;
        const priceText = prod.discountPercent 
          ? `<s>${formatPrice(prod.price)}</s> <b>${formatPrice(prod.price * (100 - prod.discountPercent) / 100)}</b> (${toPersianDigits(prod.discountPercent)}٪ تخفیف)`
          : `<b>${formatPrice(prod.price)}</b>`;

        const caption = `🎂 <b>${prod.name}</b>\n\n💰 <b>قیمت:</b> ${priceText} / هر ${prod.unit}\n⏱️ <b>زمان آماده‌سازی:</b> ${toPersianDigits(prod.preparationTimeHours || 2)} ساعت\n📦 <b>وضعیت:</b> ${prod.isAvailable ? '🟢 موجود و تازه' : '🔴 ناموجود'}${inCartQty > 0 ? `\n🛒 <b>تعداد در سبد شما:</b> ${toPersianDigits(inCartQty)} ${prod.unit}` : ''}\n\n📝 ${prod.description}`;

        const buttons: TelegramInlineButton[][] = [
          // Row 1: Direct Quantity Choice
          [
            { text: `➕ ۱ ${prod.unit}`, callback_data: `add_qty_${prod.id}_1` },
            { text: `➕ ۲ ${prod.unit}`, callback_data: `add_qty_${prod.id}_2` },
            { text: `➕ ۳ ${prod.unit}`, callback_data: `add_qty_${prod.id}_3` },
            { text: `➕ ۵ ${prod.unit}`, callback_data: `add_qty_${prod.id}_5` },
          ],
          // Row 2: Fine adjustment if in cart
          ...(inCartQty > 0 ? [
            [
              { text: `➕ ۱ واحد بیشتر`, callback_data: `inc_cart_${prod.id}` },
              { text: `➖ ۱ واحد کمتر`, callback_data: `dec_cart_${prod.id}` },
              { text: `🗑️ حذف از سبد`, callback_data: `remove_from_cart_${prod.id}` }
            ]
          ] : []),
          // Row 3: Navigation
          [
            { text: '🛒 مشاهده سبد و ثبت خرید', callback_data: 'view_cart' },
            { text: '🔙 دسته‌ها', callback_data: 'customer_categories' }
          ]
        ];

        addBotMessage(caption, buttons, prod.image, 300 + index * 200);
      });
      return;
    }

    // Add specific quantity to cart
    if (data.startsWith('add_qty_')) {
      const parts = data.replace('add_qty_', '').split('_');
      const prodId = parts[0];
      const qtyToAdd = parseInt(parts[1], 10) || 1;
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      setCart(prev => {
        const existing = prev.find(i => i.productId === prodId);
        if (existing) {
          return prev.map(i => i.productId === prodId ? { ...i, quantity: i.quantity + qtyToAdd } : i);
        }
        return [...prev, { productId: prodId, quantity: qtyToAdd }];
      });

      const currentQty = (cart.find(c => c.productId === prodId)?.quantity || 0) + qtyToAdd;

      addBotMessage(
        `✅ تعداد <b>${toPersianDigits(qtyToAdd)} ${prod.unit}</b> از «${prod.name}» به سبد افزوده شد.\n📌 <b>تعداد کل در سبد خرید:</b> <b>${toPersianDigits(currentQty)} ${prod.unit}</b>`,
        [
          [
            { text: '🛒 مشاهده سبد و تسویه حساب', callback_data: 'view_cart' },
            { text: '➕ افزودن بیشتر', callback_data: `inc_cart_${prod.id}` }
          ],
          [
            { text: '🍰 منوی سایر شیرینی‌ها', callback_data: 'customer_categories' }
          ]
        ]
      );
      return;
    }

    if (data.startsWith('inc_cart_')) {
      const prodId = data.replace('inc_cart_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      let newQty = 1;
      setCart(prev => {
        const existing = prev.find(i => i.productId === prodId);
        if (existing) {
          newQty = existing.quantity + 1;
          return prev.map(i => i.productId === prodId ? { ...i, quantity: i.quantity + 1 } : i);
        }
        return [...prev, { productId: prodId, quantity: 1 }];
      });

      addBotMessage(`➕ تعداد <b>${prod.name}</b> به <b>${toPersianDigits(newQty)} ${prod.unit}</b> افزایش یافت.`, [
        [
          { text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' },
          { text: '➕ ۱ واحد بیشتر', callback_data: `inc_cart_${prod.id}` },
          { text: '➖ ۱ واحد کمتر', callback_data: `dec_cart_${prod.id}` }
        ]
      ]);
      return;
    }

    if (data.startsWith('dec_cart_')) {
      const prodId = data.replace('dec_cart_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      let remainQty = 0;
      setCart(prev => {
        const existing = prev.find(i => i.productId === prodId);
        if (!existing) return prev;
        if (existing.quantity <= 1) {
          remainQty = 0;
          return prev.filter(i => i.productId !== prodId);
        }
        remainQty = existing.quantity - 1;
        return prev.map(i => i.productId === prodId ? { ...i, quantity: i.quantity - 1 } : i);
      });

      if (remainQty === 0) {
        addBotMessage(`🗑️ محصول <b>${prod.name}</b> از سبد خرید حذف شد.`, [
          [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }]
        ]);
      } else {
        addBotMessage(`➖ تعداد <b>${prod.name}</b> به <b>${toPersianDigits(remainQty)} ${prod.unit}</b> کاهش یافت.`, [
          [
            { text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' },
            { text: '➕ افزایش', callback_data: `inc_cart_${prod.id}` }
          ]
        ]);
      }
      return;
    }

    if (data.startsWith('remove_from_cart_')) {
      const prodId = data.replace('remove_from_cart_', '');
      const prod = products.find(p => p.id === prodId);
      setCart(prev => prev.filter(i => i.productId !== prodId));

      addUserMessage(`حذف ${prod?.name || 'محصول'} از سبد 🗑️`);
      addBotMessage(`🗑️ محصول <b>${prod?.name || ''}</b> با موفقیت از سبد خرید شما حذف گردید.`, [
        [
          { text: '🛒 مشاهده سبد به‌روزشده', callback_data: 'view_cart' },
          { text: '🍰 بازگشت به منو', callback_data: 'customer_categories' }
        ]
      ]);
      return;
    }

    if (data === 'clear_cart') {
      setCart([]);
      addUserMessage('خالی کردن سبد خرید 🗑️');
      addBotMessage('سبد خرید شما با موفقیت خالی شد.', [
        [{ text: '🍰 مشاهده منوی محصولات', callback_data: 'customer_categories' }]
      ]);
      return;
    }

    if (data === 'view_cart') {
      addUserMessage('مشاهده سبد خرید 🛒');
      if (cart.length === 0) {
        addBotMessage(
          '🛒 <b>سبد خرید شما در حال حاضر خالی است!</b>\nبرای انتخاب شیرینی، کیک یا دسرهای خوشمزه روی دکمه زیر کلیک کنید:',
          [[{ text: '🍰 مشاهده منوی قنادی', callback_data: 'customer_categories' }]]
        );
        return;
      }

      const { subtotal, isFreeShipping, shippingFee, discountAmount, totalAmount, validDiscount } = getCartCalculation();

      // If discount became invalid due to subtotal falling below min amount, reset it
      if (appliedDiscount && !validDiscount) {
        setAppliedDiscount(null);
      }

      let cartSummary = '🛍️ <b>سبد خرید شما:</b>\n\n';
      const managementButtons: TelegramInlineButton[][] = [];

      cart.forEach((item, idx) => {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const effectivePrice = prod.discountPercent 
            ? prod.price * (100 - prod.discountPercent) / 100 
            : prod.price;
          const itemTotal = effectivePrice * item.quantity;
          cartSummary += `${toPersianDigits(idx + 1)}. <b>${prod.name}</b>\n   ▫️ تعداد: <b>${toPersianDigits(item.quantity)} ${prod.unit}</b>\n   ▫️ قیمت واحد: ${formatPrice(effectivePrice)}\n   ▫️ مجموع: <b>${formatPrice(itemTotal)}</b>\n\n`;

          // Control buttons per item in cart
          managementButtons.push([
            { text: `➕ (${prod.name.slice(0, 10)}...)`, callback_data: `inc_cart_${prod.id}` },
            { text: `➖ کاهش`, callback_data: `dec_cart_${prod.id}` },
            { text: `❌ حذف کامل`, callback_data: `remove_from_cart_${prod.id}` }
          ]);
        }
      });

      cartSummary += `────────────────────\n`;
      cartSummary += `💵 <b>مجموع اقلام:</b> ${formatPrice(subtotal)}\n`;
      
      if (discountAmount > 0 && validDiscount) {
        cartSummary += `🏷️ <b>کد تخفیف (${validDiscount.code}):</b> <font color="#10b981">-${formatPrice(discountAmount)}</font>\n`;
      }

      cartSummary += `🛵 هزینه ارسال: پس از انتخاب نحوه دریافت (حضوری / پیک) در مرحله پرداخت محاسبه می‌شود\n`;
      cartSummary += `💎 <b>مبلغ اقلام:</b> <b>${formatPrice(subtotal - discountAmount)}</b>`;

      // Discount action button
      const discountButtonRow: TelegramInlineButton[] = validDiscount ? [
        { text: `❌ حذف کد تخفیف (${validDiscount.code})`, callback_data: 'remove_discount_code' }
      ] : [
        { text: '🏷️ اعمال کد تخفیف', callback_data: 'apply_discount_prompt' }
      ];

      const buttons: TelegramInlineButton[][] = [
        [
          { text: '💳 تکمیل خرید و ثبت آدرس', callback_data: 'checkout_start' },
          { text: '🧾 پیش‌نمایش فاکتور', callback_data: 'view_invoice_preview' }
        ],
        discountButtonRow,
        ...managementButtons,
        [
          { text: '➕ افزودن شیرینی‌های دیگر', callback_data: 'customer_categories' },
          { text: '🗑️ خالی کردن کل سبد', callback_data: 'clear_cart' }
        ],
        [
          { text: '🔙 بازگشت به منو', callback_data: 'back_to_main' }
        ]
      ];

      addBotMessage(cartSummary, buttons);
      return;
    }

    // Customer Discount Handlers
    if (data === 'apply_discount_prompt') {
      addUserMessage('اعمال کد تخفیف 🏷️');
      setIsAwaitingDiscountCode(true);

      const activeDiscounts = discounts.filter(d => d.isActive);
      const discountButtons: TelegramInlineButton[][] = [];

      if (activeDiscounts.length > 0) {
        activeDiscounts.slice(0, 3).forEach(d => {
          const label = d.type === 'percentage' 
            ? `🎟️ کد ${d.code} (${toPersianDigits(d.value)}٪ تخفیف)` 
            : `🎟️ کد ${d.code} (${formatPrice(d.value)} تخفیف)`;
          discountButtons.push([
            { text: label, callback_data: `apply_code_direct_${d.code}` }
          ]);
        });
      }

      discountButtons.push([
        { text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }
      ]);

      addBotMessage(
        `🏷️ <b>اعمال کد تخفیف در سبد خرید</b>\n\nلطفاً کد تخفیف خود را در کادر پیام زیر تایپ کرده و ارسال نمایید (مثال: <code>SHIRIN20</code> یا <code>WELCOME50</code>).\n\n👇 همچنین می‌توانید از کدهای تخفیف فعال و عمومی زیر مستقیماً استفاده کنید:`,
        discountButtons
      );
      return;
    }

    if (data.startsWith('apply_code_direct_')) {
      const promoCode = data.replace('apply_code_direct_', '').trim().toUpperCase();
      addUserMessage(`اعمال کد تخفیف ${promoCode} 🎟️`);

      const { subtotal } = getCartCalculation();
      const disc = discounts.find(d => d.code.toUpperCase() === promoCode);

      if (!disc) {
        addBotMessage('❌ کد تخفیف وارد شده معتبر نمی‌باشد.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (!disc.isActive) {
        addBotMessage('❌ این کد تخفیف در حال حاضر غیرفعال است.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.usageLimit && disc.usedCount >= disc.usageLimit) {
        addBotMessage('❌ سقف استفاده از این کد تخفیف به پایان رسیده است.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.expiresAt && new Date(disc.expiresAt) < new Date()) {
        addBotMessage('❌ مهلت استفاده از این کد تخفیف منقضی شده است.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.minPurchaseAmount && subtotal < disc.minPurchaseAmount) {
        addBotMessage(
          `⚠️ این کد تخفیف فقط برای سفارشات بالای <b>${formatPrice(disc.minPurchaseAmount)}</b> معتبر است.\nمبلغ فعلی سبد خرید شما: ${formatPrice(subtotal)}`,
          [
            [{ text: '🍰 افزودن شیرینی دیگر به سبد', callback_data: 'customer_categories' }],
            [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
          ]
        );
        return;
      }

      // Calculate discount amount
      let calculatedDiscount = 0;
      if (disc.type === 'percentage') {
        calculatedDiscount = Math.round((subtotal * disc.value) / 100);
        if (disc.maxDiscountAmount && calculatedDiscount > disc.maxDiscountAmount) {
          calculatedDiscount = disc.maxDiscountAmount;
        }
      } else {
        calculatedDiscount = Math.min(disc.value, subtotal);
      }

      setAppliedDiscount({
        code: disc.code,
        discountAmount: calculatedDiscount,
        discountObj: disc
      });
      setIsAwaitingDiscountCode(false);

      addBotMessage(
        `🎉 <b>کد تخفیف «${disc.code}» با موفقیت روی سبد خرید شما اعمال شد!</b>\n\n💰 <b>مبلغ تخفیف کسر شده:</b> <b>${formatPrice(calculatedDiscount)}</b>\n\nبرای مشاهده فاکتور نهایی یا تکمیل سفارش روی دکمه زیر کلیک کنید:`,
        [
          [{ text: '🛒 مشاهده سبد خرید به‌روزشده', callback_data: 'view_cart' }],
          [{ text: '💳 تکمیل خرید و تسویه حساب', callback_data: 'checkout_start' }]
        ]
      );
      return;
    }

    if (data === 'remove_discount_code') {
      addUserMessage('حذف کد تخفیف ❌');
      setAppliedDiscount(null);
      addBotMessage('کد تخفیف از سبد خرید شما برداشته شد.', [
        [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }]
      ]);
      return;
    }

    if (data === 'checkout_start') {
      if (cart.length === 0) {
        addBotMessage('🛒 سبد خرید شما خالی است! لطفاً ابتدا شیرینی مورد نظرتان را به سبد اضافه کنید.', [
          [{ text: '🍰 مشاهده منوی قنادی', callback_data: 'customer_categories' }]
        ]);
        return;
      }
      addUserMessage('تکمیل خرید و ثبت آدرس 💳');
      setCheckoutStep({ step: 'name', draftOrder: {} });
      addBotMessage(
        '👤 <b>مرحله ۱ از ۳: ثبت مشخصات خریدار</b>\n\nلطفاً <b>نام و نام خانوادگی</b> خود را در کادر پیام زیر تایپ و ارسال کنید:'
      );
      return;
    }

    if (data === 'view_invoice_preview') {
      if (cart.length === 0) {
        addBotMessage('🛒 سبد خرید شما خالی است.', [
          [{ text: '🍰 مشاهده منوی قنادی', callback_data: 'customer_categories' }]
        ]);
        return;
      }
      addUserMessage('🧾 مشاهده پیش‌نمایش فاکتور نهایی');
      const currentDraft = checkoutStep.draftOrder || {
        customerName: 'مشتری گرامی',
        customerPhone: '09120000000',
        customerAddress: 'تهران، تحویل فوری'
      };
      setCheckoutStep({ step: 'invoice_preview', draftOrder: currentDraft });
      sendInvoicePreviewMessage(currentDraft);
      return;
    }

    if (data === 'edit_checkout_address') {
      addUserMessage('ویرایش آدرس تحویل ✏️');
      setCheckoutStep(prev => ({ ...prev, step: 'address' }));
      addBotMessage('🏠 لطفاً <b>آدرس جدید تحویل</b> خود را وارد نمایید:');
      return;
    }

    if (data === 'edit_checkout_contact') {
      addUserMessage('ویرایش مشخصات خریدار ✏️');
      setCheckoutStep(prev => ({ ...prev, step: 'name' }));
      addBotMessage('👤 لطفاً <b>نام و نام خانوادگی</b> جدید خود را وارد نمایید:');
      return;
    }

    if (data === 'confirm_final_order') {
      if (cart.length === 0) {
        addBotMessage('🛒 سبد خرید شما خالی است!', [
          [{ text: '🍰 مشاهده منوی قنادی', callback_data: 'customer_categories' }]
        ]);
        return;
      }

      addUserMessage('✅ تایید نهایی فاکتور و ثبت سفارش');

      const draft = checkoutStep.draftOrder || {};
      let subtotal = 0;
      const orderItems = cart.map(item => {
        const p = products.find(prod => prod.id === item.productId)!;
        const effectivePrice = p.discountPercent 
          ? p.price * (100 - p.discountPercent) / 100 
          : p.price;
        subtotal += effectivePrice * item.quantity;
        return {
          productId: p.id,
          productName: p.name,
          productImage: p.image,
          price: effectivePrice,
          quantity: item.quantity,
          unit: p.unit
        };
      });

      const { discountAmount, totalAmount } = getCartCalculation();
      const shippingFee = subtotal >= botSettings.freeShippingThreshold ? 0 : botSettings.shippingFee;

      const newOrder = await onCreateOrder({
        customerName: draft.customerName || 'مشتری گرامی',
        customerPhone: draft.customerPhone || '09120000000',
        customerAddress: draft.customerAddress || 'ثبت شده توسط مشتری',
        items: orderItems,
        subtotal,
        shippingFee,
        discountAmount,
        couponCode: appliedDiscount?.code,
        totalAmount,
        status: 'paid_checking',
        paymentMethod: 'card_to_card',
        paymentReceiptImage: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80'
      });

      setCart([]);
      setAppliedDiscount(null);
      setCheckoutStep({ step: 'idle' });

      let confirmationText = `🎉 <b>سفارش شما با موفقیت در قنادی ثبت شد!</b>\n\n`;
      confirmationText += `🔖 <b>کد پیگیری سفارش:</b> <code>${newOrder.orderNumber}</code>\n`;
      confirmationText += `👤 <b>تحویل گیرنده:</b> ${newOrder.customerName}\n`;
      confirmationText += `📞 <b>شماره تماس:</b> ${newOrder.customerPhone}\n`;
      confirmationText += `🏠 <b>آدرس ارسال:</b> ${newOrder.customerAddress}\n\n`;
      
      if (newOrder.discountAmount && newOrder.discountAmount > 0) {
        confirmationText += `🎟️ <b>کد تخفیف اعمال شده:</b> <code>${newOrder.couponCode || 'تخفیف'}</code> (-${formatPrice(newOrder.discountAmount)})\n`;
      }

      confirmationText += `💎 <b>مبلغ پرداخت شده نهایی:</b> <b>${formatPrice(newOrder.totalAmount)}</b>\n\n`;
      confirmationText += `💳 <b>شماره کارت قنادی:</b> <code>${botSettings.cardNumber}</code>\n`;
      confirmationText += `👤 <b>به نام:</b> ${botSettings.cardHolder}\n\n`;
      confirmationText += `👩‍🍳 سفارش شما بلافاصله در قنادی شیرین‌کام آماده‌سازی و از طریق پیک مخصوص کیک و شیرینی برای شما ارسال خواهد شد.`;

      addBotMessage(confirmationText, [
        [
          { text: '📦 پیگیری وضعیت این سفارش', callback_data: 'track_orders_list' },
          { text: '🍰 سفارش جدید', callback_data: 'customer_categories' }
        ]
      ]);
      return;
    }

    if (data === 'contact_info') {
      addUserMessage('اطلاعات تماس و آدرس قنادی 📍');
      const text = `🏢 <b>${botSettings.storeName}</b>\n\n📝 ${botSettings.storeBio}\n\n📍 <b>آدرس حضوری:</b> ${botSettings.storeAddress}\n📞 <b>تلفن سفارشات و پشتیبانی:</b> ${botSettings.storePhone}\n💳 <b>شماره کارت رسمی:</b> <code>${botSettings.cardNumber}</code>\n👤 <b>به نام:</b> ${botSettings.cardHolder}\n🏦 <b>شماره شبا:</b> <code>${botSettings.shabaNumber}</code>\n\n🛵 ارسال فوری با پیک مخصوص کیک و شیرینی`;
      const buttons: TelegramInlineButton[][] = [
        [
          { text: '🍰 مشاهده منوی محصولات', callback_data: 'customer_categories' },
          { text: '🔙 بازگشت به صفحه اصلی', callback_data: 'back_to_main' }
        ]
      ];
      addBotMessage(text, buttons, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80');
      return;
    }

    if (data === 'track_orders_list') {
      addUserMessage('پیگیری وضعیت سفارشات 📦');
      if (orders.length === 0) {
        addBotMessage('شما در حال حاضر سفارش فعالی ندارید.', [
          [{ text: '🍰 ثبت سفارش جدید', callback_data: 'customer_categories' }]
        ]);
        return;
      }
      let text = '📦 <b>لیست سفارشات اخیر:</b>\n\n';
      orders.slice(0, 3).forEach((ord) => {
        const statusMap = {
          pending_payment: '⏳ در انتظار پرداخت',
          paid_checking: '🔍 در حال بررسی فیش واریزی',
          receipt_confirmed: '✅ فیش تأیید شد؛ در انتظار شروع پخت',
          baking: '👩‍🍳 در حال پخت و تزیین در کارگاه',
          shipped: '🛵 تحویل به پیک جهت ارسال',
          delivered: '✅ تحویل داده شد',
          cancelled: '❌ لغو شده'
        };
        text += `🔹 <b>کد پیگیری:</b> <code>${ord.orderNumber}</code>\n   ▫️ وضعیت: <b>${statusMap[ord.status]}</b>\n   ▫️ مبلغ: ${formatPrice(ord.totalAmount)}\n   ▫️ تاریخ: ${formatDatePersian(ord.createdAt)}\n\n`;
      });
      addBotMessage(text, [
        [{ text: '🍰 ثبت سفارش جدید', callback_data: 'customer_categories' }],
        [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
      ]);
      return;
    }

    // ==========================================
    // ADMIN FLOW CALLBACKS (صاحب فروشگاه)
    // ==========================================

    if (data === 'admin_add_product') {
      addUserMessage('➕ افزودن شیرینی / کیک جدید');
      setAdminStep({ mode: 'add_name', draftProduct: {} });
      addBotMessage(
        `🍰 <b>افزودن محصول جدید به قنادی (مرحله ۱ از ۵)</b>\n\nلطفاً <b>نام محصول</b> را تایپ و ارسال کنید:\n<i>(مثال: چیزکیک لوتوس بلژیکی، شیرینی لطیفه خامه‌ای، باقلوا گردویی)</i>`
      );
      return;
    }

    if (data.startsWith('admin_cat_select_')) {
      const selectedCat = data.replace('admin_cat_select_', '') as ProductCategory;
      setAdminStep(prev => ({
        mode: 'add_price',
        draftProduct: { ...prev.draftProduct, category: selectedCat }
      }));
      addUserMessage(`دسته‌بندی: ${selectedCat}`);
      addBotMessage(
        `💰 <b>مرحله ۳ از ۵: قیمت‌گذاری</b>\n\nدسته‌بندی <b>${selectedCat}</b> انتخاب شد.\nلطفاً <b>قیمت محصول به تومان</b> را وارد کنید:\n<i>(مثال: 390000 یا 450000)</i>`
      );
      return;
    }

    if (data === 'admin_trigger_file_upload') {
      chatFileInputRef.current?.click();
      return;
    }

    if (data.startsWith('admin_preset_photo_')) {
      const photoUrl = data.replace('admin_preset_photo_', '');
      setAdminStep(prev => ({
        mode: 'add_desc',
        draftProduct: { ...prev.draftProduct, image: photoUrl }
      }));
      addUserMessage('انتخاب عکس از گالری پیشنهادی 🖼️');
      addBotMessage(
        `📝 <b>مرحله ۵ از ۵: توضیحات محصول</b>\n\nعکس با موفقیت ذخیره شد.\nلطفاً <b>توضیحات کوتاه یا مواد تشکیل‌دهنده</b> را تایپ کنید:\n<i>(یا بنویسید «عالی» جهت توضیحات پیش‌فرض)</i>`,
        undefined,
        photoUrl
      );
      return;
    }

    if (data === 'admin_products_manager' || data.startsWith('admin_prod_filter_')) {
      let filterCategory: string | null = null;
      let filterTitle = 'همه دسته‌بندی‌ها';

      if (data === 'admin_prod_filter_cakes') {
        filterCategory = 'کیک و پای';
        filterTitle = 'کیک و پای 🍰';
      } else if (data === 'admin_prod_filter_fresh') {
        filterCategory = 'شیرینی تر';
        filterTitle = 'شیرینی تر 🧁';
      } else if (data === 'admin_prod_filter_dry') {
        filterCategory = 'شیرینی خشک';
        filterTitle = 'شیرینی خشک 🍪';
      } else if (data === 'admin_prod_filter_dessert') {
        filterCategory = 'دسر و کوکی';
        filterTitle = 'دسر و کوکی 🍮';
      }

      addUserMessage(`🧁 مدیریت محصولات: ${filterTitle}`);

      const filteredProducts = filterCategory 
        ? products.filter(p => p.category === filterCategory)
        : products;

      const availableCount = products.filter(p => p.isAvailable).length;
      const discountedCount = products.filter(p => (p.discountPercent || 0) > 0).length;

      let introText = `🧁 <b>بخش مدیریت و ویرایش محصولات قنادی</b>\n\n`;
      introText += `📊 <b>وضعیت کاتالوگ:</b>\n`;
      introText += `▫️ کل محصولات: <b>${toPersianDigits(products.length)} کالا</b>\n`;
      introText += `▫️ در حال عرضه (موجود): <b>${toPersianDigits(availableCount)} کالا</b>\n`;
      introText += `▫️ دارای تخفیف شگفت‌انگیز: <b>${toPersianDigits(discountedCount)} کالا</b>\n\n`;
      introText += `دسته‌بندی در حال نمایش: <b>${filterTitle}</b> (${toPersianDigits(filteredProducts.length)} قلم)\n\n`;
      introText += `👇 برای فیلتر دسته‌ها، افزودن محصول جدید یا ویرایش هر کالا از گزینه‌های زیر استفاده کنید:`;

      const filterButtons: TelegramInlineButton[][] = [
        [
          { text: '🍰 کیک و پای', callback_data: 'admin_prod_filter_cakes' },
          { text: '🧁 شیرینی تر', callback_data: 'admin_prod_filter_fresh' }
        ],
        [
          { text: '🍪 شیرینی خشک', callback_data: 'admin_prod_filter_dry' },
          { text: '🍮 دسر و کوکی', callback_data: 'admin_prod_filter_dessert' }
        ],
        [
          { text: `📋 نمایش همه محصولات (${toPersianDigits(products.length)})`, callback_data: 'admin_prod_filter_all' }
        ],
        [
          { text: '➕ افزودن محصول جدید به منو', callback_data: 'admin_add_product' },
          { text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }
        ]
      ];

      addBotMessage(introText, filterButtons, undefined, 100);

      if (filteredProducts.length === 0) {
        addBotMessage('⚠️ هیچ محصولی در این دسته‌بندی یافت نشد.', [
          [{ text: '➕ افزودن محصول در این دسته', callback_data: 'admin_add_product' }],
          [{ text: '📋 نمایش همه محصولات', callback_data: 'admin_prod_filter_all' }]
        ], undefined, 200);
        return;
      }

      // Display products
      filteredProducts.forEach((prod, idx) => {
        const hasDiscount = prod.discountPercent && prod.discountPercent > 0;
        const effectivePrice = hasDiscount 
          ? prod.price * (100 - prod.discountPercent!) / 100 
          : prod.price;

        let caption = `🎂 <b>${prod.name}</b>\n`;
        caption += `▫️ دسته‌بندی: <b>${prod.category}</b>\n`;
        caption += `▫️ واحد فروش: <b>${prod.unit}</b>\n`;
        
        if (hasDiscount) {
          caption += `▫️ قیمت پایه: <s>${formatPrice(prod.price)}</s>\n`;
          caption += `▫️ تخفیف ویژه: <b>${toPersianDigits(prod.discountPercent!)}٪ تخفیف</b>\n`;
          caption += `▫️ قیمت پس از تخفیف: <b>${formatPrice(effectivePrice)}</b>\n`;
        } else {
          caption += `▫️ قیمت فروش: <b>${formatPrice(prod.price)}</b>\n`;
        }

        caption += `▫️ وضعیت موجودی: <b>${prod.isAvailable ? '🟢 موجود و قابل سفارش' : '🔴 ناموجود در انبار'}</b>\n`;
        if (prod.description) {
          caption += `📝 <i>${prod.description}</i>\n`;
        }

        const buttons: TelegramInlineButton[][] = [
          [
            { text: '✏️ ویرایش قیمت', callback_data: `admin_edit_price_${prod.id}` },
            { text: prod.isAvailable ? '🔴 ناموجود کردن' : '🟢 موجود کردن', callback_data: `admin_toggle_avail_${prod.id}` }
          ],
          [
            { text: hasDiscount ? '❌ حذف تخفیف کالا' : '🏷️ اعمال ۱۵٪ تخفیف', callback_data: `admin_toggle_prod_disc_${prod.id}` },
            { text: '🖼️ تعویض عکس', callback_data: `admin_change_photo_${prod.id}` }
          ],
          [
            { text: '🗑️ حذف کالا از منو', callback_data: `admin_delete_prod_${prod.id}` }
          ]
        ];

        addBotMessage(caption, buttons, prod.image, 250 + idx * 120);
      });
      return;
    }

    if (data.startsWith('admin_toggle_prod_disc_')) {
      const prodId = data.replace('admin_toggle_prod_disc_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      const newDiscountPercent = (prod.discountPercent && prod.discountPercent > 0) ? 0 : 15;
      await onUpdateProduct(prodId, { discountPercent: newDiscountPercent });
      
      addUserMessage(`تغییر تخفیف ویژه: ${prod.name}`);
      addBotMessage(
        newDiscountPercent > 0 
          ? `🎉 تخفیف ۱۵٪ روی محصول <b>${prod.name}</b> با موفقیت اعمال گردید.`
          : `تخفیف محصول <b>${prod.name}</b> برداشته شد.`,
        [
          [{ text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' }],
          [{ text: '👨‍🍳 منوی مدیریت', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    if (data === 'admin_price_manager') {
      addUserMessage('💰 مدیریت و ویرایش قیمت‌ها');
      addBotMessage(
        `🍰 <b>لیست محصولات و قیمت‌های فعلی قنادی:</b>\nروی هر محصول برای ویرایش سریع قیمت، اعمال تخفیف یا تغییر وضعیت موجودی کلیک کنید:`,
        undefined,
        undefined,
        150
      );

      products.slice(0, 6).forEach((prod, idx) => {
        const caption = `🔹 <b>${prod.name}</b>\n▫️ دسته‌بندی: ${prod.category}\n▫️ قیمت فعلی: <b>${formatPrice(prod.price)}</b> / ${prod.unit}\n▫️ موجودی: ${prod.isAvailable ? '🟢 فعال و موجود' : '🔴 ناموجود'}`;
        const buttons: TelegramInlineButton[][] = [
          [
            { text: '✏️ ویرایش قیمت', callback_data: `admin_edit_price_${prod.id}` },
            { text: prod.isAvailable ? '🔴 غیرفعال کردن' : '🟢 فعال کردن', callback_data: `admin_toggle_avail_${prod.id}` }
          ],
          [
            { text: '🖼️ تعویض عکس', callback_data: `admin_change_photo_${prod.id}` },
            { text: '🗑️ حذف محصول', callback_data: `admin_delete_prod_${prod.id}` }
          ]
        ];
        addBotMessage(caption, buttons, prod.image, 250 + idx * 150);
      });
      return;
    }

    if (data.startsWith('admin_change_photo_')) {
      const prodId = data.replace('admin_change_photo_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      setAdminStep({ mode: 'upload_photo_for_prod', productId: prodId });
      addUserMessage(`تعویض عکس: ${prod.name} 🖼️`);
      addBotMessage(
        `🖼️ <b>آپلود عکس جدید برای «${prod.name}»</b>\n\nشما می‌توانید:\n۱. روی دکمه سنجاق 📎 کنار کادر پیام کلیک کرده و فایل عکس را آپلود کنید.\n۲. لینک عکس را در کادر پیام ارسال فرمایید.\n۳. یا یکی از عکس‌های آماده زیر را انتخاب کنید:`,
        [
          [
            { text: '📎 انتخاب و آپلود فایل عکس از گوشی/سیستم', callback_data: 'admin_trigger_file_upload' }
          ],
          [
            { text: '🎂 کیک شکلاتی', callback_data: `admin_apply_photo_${prodId}_https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80` },
            { text: '🧁 شیرینی ناپلئونی', callback_data: `admin_apply_photo_${prodId}_https://images.unsplash.com/photo-1587314168485-3236d6710814?w=700&auto=format&fit=crop&q=80` }
          ],
          [
            { text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' }
          ]
        ],
        prod.image
      );
      return;
    }

    if (data.startsWith('admin_apply_photo_')) {
      const rest = data.replace('admin_apply_photo_', '');
      const underscoreIdx = rest.indexOf('_');
      const prodId = rest.substring(0, underscoreIdx);
      const photoUrl = rest.substring(underscoreIdx + 1);

      await onUpdateProduct(prodId, { image: photoUrl });
      const prod = products.find(p => p.id === prodId);
      setAdminStep({ mode: 'idle' });

      addUserMessage('عکس محصول انتخاب شد ✅');
      addBotMessage(
        `✅ عکس محصول <b>${prod?.name || ''}</b> با موفقیت تغییر یافت.`,
        [
          [
            { text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' },
            { text: '👨‍🍳 منوی مدیریت', callback_data: 'back_to_admin' }
          ]
        ],
        photoUrl
      );
      return;
    }

    if (data.startsWith('admin_edit_price_')) {
      const prodId = data.replace('admin_edit_price_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      setAdminStep({ mode: 'edit_price_val', productId: prodId });
      addUserMessage(`ویرایش قیمت: ${prod.name}`);
      addBotMessage(
        `✏️ <b>ویرایش قیمت محصول: ${prod.name}</b>\nقیمت فعلی: <b>${formatPrice(prod.price)}</b>\n\nلطفاً <b>قیمت جدید به تومان</b> را ارسال کنید (یا یکی از درصدهای افزایش/کاهش را بزنید):`,
        [
          [
            { text: `🔺 افزایش ۵٪ (${formatPrice(Math.round(prod.price * 1.05))})`, callback_data: `admin_quick_price_${prodId}_${Math.round(prod.price * 1.05)}` },
            { text: `🔺 افزایش ۱۰٪ (${formatPrice(Math.round(prod.price * 1.10))})`, callback_data: `admin_quick_price_${prodId}_${Math.round(prod.price * 1.10)}` }
          ],
          [
            { text: `🔻 تخفیف ۱۰٪ (${formatPrice(Math.round(prod.price * 0.90))})`, callback_data: `admin_quick_price_${prodId}_${Math.round(prod.price * 0.90)}` },
            { text: '🔙 انصراف', callback_data: 'admin_products_manager' }
          ]
        ]
      );
      return;
    }

    if (data.startsWith('admin_quick_price_')) {
      const parts = data.replace('admin_quick_price_', '').split('_');
      const prodId = parts[0];
      const newPrice = parseInt(parts[1], 10);
      await onUpdateProduct(prodId, { price: newPrice });
      const prod = products.find(p => p.id === prodId);
      addUserMessage(`قیمت جدید ثبت شد: ${formatPrice(newPrice)}`);
      addBotMessage(
        `✅ قیمت محصول <b>${prod?.name || ''}</b> با موفقیت به <b>${formatPrice(newPrice)}</b> تغییر یافت و در منوی تلگرام به‌روزرسانی شد.`,
        [
          [
            { text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' },
            { text: '👨‍🍳 منوی مدیریت', callback_data: 'back_to_admin' }
          ]
        ]
      );
      return;
    }

    if (data.startsWith('admin_toggle_avail_')) {
      const prodId = data.replace('admin_toggle_avail_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      const newAvail = !prod.isAvailable;
      await onUpdateProduct(prodId, { isAvailable: newAvail });
      addUserMessage(`تغییر وضعیت موجودی: ${prod.name}`);
      addBotMessage(
        `وضعیت محصول <b>${prod.name}</b> به <b>${newAvail ? '🟢 موجود و قابل سفارش' : '🔴 ناموجود'}</b> تغییر یافت.`,
        [
          [
            { text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' },
            { text: '👨‍🍳 منوی مدیریت', callback_data: 'back_to_admin' }
          ]
        ]
      );
      return;
    }

    if (data.startsWith('admin_delete_prod_')) {
      const prodId = data.replace('admin_delete_prod_', '');
      const prod = products.find(p => p.id === prodId);
      if (!prod) return;

      await onDeleteProduct(prodId);
      addUserMessage(`حذف محصول: ${prod.name}`);
      addBotMessage(`🗑️ محصول <b>${prod.name}</b> با موفقیت از فروشگاه و ربات حذف گردید.`, [
        [
          { text: '🧁 بازگشت به مدیریت محصولات', callback_data: 'admin_products_manager' },
          { text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }
        ]
      ]);
      return;
    }

    if (data === 'admin_orders_list') {
      addUserMessage('📦 سفارشات جدید و در انتظار');
      if (orders.length === 0) {
        addBotMessage('هیچ سفارشی در سیستم ثبت نشده است.', [
          [{ text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }]
        ]);
        return;
      }

      addBotMessage(`📦 <b>لیست سفارشات قنادی (${toPersianDigits(orders.length)} سفارش):</b>`, undefined, undefined, 150);

      orders.slice(0, 3).forEach((ord, idx) => {
        const itemsList = ord.items.map(i => `▫️ ${i.productName} (${toPersianDigits(i.quantity)} ${i.unit})`).join('\n');
        const statusLabel = ord.status === 'receipt_confirmed'
          ? '✅ فیش تأیید شده — آماده شروع پخت'
          : ord.status === 'paid_checking'
            ? '🔍 فیش در انتظار بررسی'
            : ord.status === 'baking'
              ? '👩‍🍳 در حال پخت و تزیین'
              : ord.status;
        const caption = `📋 <b>سفارش شماره: ${ord.orderNumber}</b>\n\n👤 <b>مشتری:</b> ${ord.customerName}\n📞 <b>تلفن:</b> <code>${ord.customerPhone}</code>\n🏠 <b>آدرس:</b> ${ord.customerAddress}\n\n🍰 <b>اقلام سفارش:</b>\n${itemsList}\n\n💰 <b>مبلغ کل:</b> <b>${formatPrice(ord.totalAmount)}</b>\n📌 <b>وضعیت:</b> ${statusLabel}\n${ord.notes ? `📝 <b>یادداشت مشتری:</b> ${ord.notes}\n` : ''}`;

        const awaitingReceipt = Boolean(ord.paymentReceiptImage) && (ord.status === 'pending_payment' || ord.status === 'paid_checking');
        const canStartProduction = ord.status === 'receipt_confirmed'
          || (ord.paymentMethod === 'cash_on_delivery' && ord.status === 'pending_payment');
        const buttons: TelegramInlineButton[][] = [];
        if (awaitingReceipt) buttons.push([{ text: '🧾 مشاهده و بررسی فیش', callback_data: `admin_review_receipt_${ord.id}` }]);
        if (canStartProduction) buttons.push([{ text: '👩‍🍳 شروع پخت و تزیین', callback_data: `admin_status_${ord.id}_baking` }]);
        if (ord.status === 'baking') buttons.push([{ text: '🛵 تحویل به پیک', callback_data: `admin_status_${ord.id}_shipped` }]);
        if (ord.status === 'shipped') buttons.push([{ text: '✅ تکمیل و تحویل شد', callback_data: `admin_status_${ord.id}_delivered` }]);
        if (ord.status !== 'delivered' && ord.status !== 'cancelled') buttons.push([{ text: '❌ لغو سفارش', callback_data: `admin_status_${ord.id}_cancelled` }]);

        addBotMessage(caption, buttons, ord.paymentReceiptImage, 250 + idx * 200);
      });
      return;
    }

    if (data.startsWith('admin_review_receipt_')) {
      const orderId = data.replace('admin_review_receipt_', '');
      const order = orders.find((item) => item.id === orderId);
      if (!order?.paymentReceiptImage) {
        addBotMessage('فیشی برای این سفارش ثبت نشده است.');
        return;
      }
      addUserMessage(`بررسی فیش سفارش ${order.orderNumber}`);
      addBotMessage(
        `🧾 <b>فیش واریزی سفارش ${order.orderNumber}</b>\n👤 ${order.customerName}\n💰 ${formatPrice(order.totalAmount)}\n\nپس از بررسی، ابتدا فیش را تأیید یا رد کنید. شروع پخت یک مرحله جداگانه است.`,
        [[
          { text: '✅ تأیید فیش', callback_data: `admin_approve_receipt_${order.id}` },
          { text: '❌ رد فیش', callback_data: `admin_reject_receipt_${order.id}` },
        ], [{ text: '📦 بازگشت به سفارشات', callback_data: 'admin_orders_list' }]],
        order.paymentReceiptImage,
      );
      return;
    }

    if (data.startsWith('admin_approve_receipt_')) {
      const orderId = data.replace('admin_approve_receipt_', '');
      const order = orders.find((item) => item.id === orderId);
      if (!order?.paymentReceiptImage) {
        addBotMessage('فیشی برای تأیید پیدا نشد.');
        return;
      }
      await onUpdateOrderStatus(orderId, 'receipt_confirmed');
      addUserMessage(`تأیید فیش سفارش ${order.orderNumber}`);
      addBotMessage(
        `✅ فیش سفارش <b>${order.orderNumber}</b> تأیید شد.\n📌 وضعیت: <b>فیش تأیید شده</b>\n👩‍🍳 برای ورود به مرحله پخت، دکمه «شروع پخت و تزیین» را جداگانه انتخاب کنید.`,
        [[{ text: '📦 بازگشت به سفارشات', callback_data: 'admin_orders_list' }]],
      );
      return;
    }

    if (data.startsWith('admin_reject_receipt_')) {
      const orderId = data.replace('admin_reject_receipt_', '');
      const order = orders.find((item) => item.id === orderId);
      if (!order || !order.paymentReceiptImage || !['pending_payment', 'paid_checking'].includes(order.status)) {
        addBotMessage('ℹ️ این فیش قبلاً بررسی شده یا برای سفارش موردنظر فیشی ثبت نشده است.');
        return;
      }
      await onUpdateOrderStatus(orderId, 'pending_payment');
      addUserMessage(`رد فیش سفارش ${order.orderNumber}`);
      addBotMessage(`❌ فیش سفارش <b>${order.orderNumber}</b> رد شد و وضعیت به «در انتظار پرداخت» بازگشت.`, [[{ text: '📦 بازگشت به سفارشات', callback_data: 'admin_orders_list' }]]);
      return;
    }

    if (data.startsWith('admin_status_')) {
      const parts = data.replace('admin_status_', '').split('_');
      const orderId = parts[0];
      const newStatus = parts[1] as Order['status'];
      const order = orders.find((item) => item.id === orderId);
      const canStartProduction = order?.status === 'receipt_confirmed'
        || (order?.paymentMethod === 'cash_on_delivery' && order.status === 'pending_payment');
      if (newStatus === 'baking' && !canStartProduction) {
        addBotMessage('⏳ ابتدا فیش را تأیید کنید. سپس دکمه «شروع پخت و تزیین» فعال می‌شود.');
        return;
      }
      await onUpdateOrderStatus(orderId, newStatus);

      const statusTitles = {
        baking: '👩‍🍳 در حال پخت و آماده‌سازی',
        shipped: '🛵 تحویل به پیک جهت ارسال',
        delivered: '✅ تحویل داده شده به مشتری',
        cancelled: '❌ لغو شده',
        pending_payment: 'در انتظار پرداخت',
        paid_checking: 'در حال بررسی فیش',
        receipt_confirmed: '✅ فیش تأیید شده؛ در انتظار شروع پخت'
      };

      addUserMessage(`تغییر وضعیت سفارش به: ${statusTitles[newStatus]}`);
      addBotMessage(
        `✅ وضعیت سفارش با موفقیت به <b>${statusTitles[newStatus]}</b> تغییر یافت و پیامک / پیام اطلاع‌رسانی به مشتری ارسال شد.`,
        [
          [
            { text: '📦 بازگشت به سفارشات', callback_data: 'admin_orders_list' },
            { text: '👨‍🍳 منوی مدیریت', callback_data: 'back_to_admin' }
          ]
        ]
      );
      return;
    }

    if (data === 'admin_sales_stats') {
      addUserMessage('📊 گزارش فروش و آمار');
      const totalRevenue = orders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.totalAmount : 0), 0);
      const activeProductsCount = products.filter(p => p.isAvailable).length;

      const text = `📊 <b>گزارش عملکرد قنادی ${botSettings.storeName}:</b>\n\n💰 <b>مجموع فروش کل:</b> <b>${formatPrice(totalRevenue)}</b>\n📦 <b>تعداد کل سفارشات:</b> ${toPersianDigits(orders.length)} سفارش\n🍰 <b>تعداد محصولات فعال:</b> ${toPersianDigits(activeProductsCount)} محصول\n🌟 <b>پرفروش‌ترین محصول:</b> کیک شکلاتی بلژیکی با گاناش\n🛵 <b>میانگین ارزش هر سفارش:</b> ${formatPrice(Math.round(totalRevenue / (orders.length || 1)))}\n\n📈 سیستم به طور خودکار فروش روزانه و ماهیانه شما را به تفکیک دسته‌بندی تحلیل می‌کند.`;
      addBotMessage(text, [
        [
          { text: '💰 مدیریت قیمت‌ها', callback_data: 'admin_price_manager' },
          { text: '➕ افزودن محصول', callback_data: 'admin_add_product' }
        ],
        [
          { text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }
        ]
      ]);
      return;
    }

    if (data === 'admin_quick_settings') {
      addUserMessage('⚙️ تنظیمات کارت و ارسال');
      const text = `⚙️ <b>تنظیمات مالی و ارسال قنادی:</b>\n\n💳 <b>شماره کارت فعلی:</b> <code>${botSettings.cardNumber}</code>\n👤 <b>صاحب حساب:</b> ${botSettings.cardHolder}\n🛵 <b>هزینه پایه پیک:</b> ${formatPrice(botSettings.shippingFee)}\n🎁 <b>سقف ارسال رایگان:</b> ${formatPrice(botSettings.freeShippingThreshold)}\n\n💡 جهت ویرایش این اطلاعات می‌توانید از تب «تنظیمات ربات» در بالای صفحه استفاده کنید.`;
      addBotMessage(text, [
        [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]
      ]);
      return;
    }

    if (data === 'admin_discounts_list') {
      addUserMessage('🎟️ مدیریت کدهای تخفیف');
      if (discounts.length === 0) {
        addBotMessage(
          '🎟️ <b>هیچ کد تخفیفی تعریف نشده است.</b>\nمی‌توانید با دکمه‌های زیر کدهای تخفیف سریع تعریف کنید یا از تب «کدهای تخفیف» در بالای صفحه اقدام نمایید:',
          [
            [
              { text: '➕ ایجاد کد ۲۰٪ جدید (SHIRIN20)', callback_data: 'admin_quick_promo_percent' },
              { text: '➕ ایجاد کد ۵۰ هزار تومانی (SWEET50)', callback_data: 'admin_quick_promo_fixed' }
            ],
            [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]
          ]
        );
        return;
      }

      let text = `🎟️ <b>لیست کدهای تخفیف قنادی (${toPersianDigits(discounts.length)} کد):</b>\n\n`;
      const actionButtons: TelegramInlineButton[][] = [];

      discounts.forEach((disc, idx) => {
        const valStr = disc.type === 'percentage' 
          ? `${toPersianDigits(disc.value)}٪` 
          : formatPrice(disc.value);
        const statusStr = disc.isActive ? '🟢 فعال' : '🔴 غیرفعال';
        const usageStr = `${toPersianDigits(disc.usedCount)}${disc.usageLimit ? ` از ${toPersianDigits(disc.usageLimit)}` : ''} بار`;

        text += `${toPersianDigits(idx + 1)}. کد: <code>${disc.code}</code>\n   ▫️ مقدار: <b>${valStr}</b> (${disc.type === 'percentage' ? 'درصدی' : 'مبلغ ثابت'})\n   ▫️ وضعیت: ${statusStr}\n   ▫️ تعداد استفاده: ${usageStr}\n   ▫️ توضیحات: ${disc.description || 'بدون توضیح'}\n\n`;

        actionButtons.push([
          { 
            text: `${disc.isActive ? '🔴 غیرفعال‌سازی' : '🟢 فعال‌سازی'} کد ${disc.code}`, 
            callback_data: `admin_toggle_discount_${disc.id}` 
          }
        ]);
      });

      actionButtons.push([
        { text: '➕ ایجاد کد ۲۰٪ جدید', callback_data: 'admin_quick_promo_percent' },
        { text: '➕ ایجاد کد ۵۰ تومانی', callback_data: 'admin_quick_promo_fixed' }
      ]);
      actionButtons.push([
        { text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }
      ]);

      addBotMessage(text, actionButtons);
      return;
    }

    if (data.startsWith('admin_toggle_discount_')) {
      const discId = data.replace('admin_toggle_discount_', '');
      const disc = discounts.find(d => d.id === discId);
      if (disc && onUpdateDiscount) {
        const newStatus = !disc.isActive;
        await onUpdateDiscount(discId, { isActive: newStatus });
        addUserMessage(`تغییر وضعیت کد تخفیف ${disc.code} به ${newStatus ? 'فعال' : 'غیرفعال'}`);
        addBotMessage(
          `✅ وضعیت کد تخفیف <b>${disc.code}</b> با موفقیت به <b>${newStatus ? '🟢 فعال' : '🔴 غیرفعال'}</b> تغییر یافت.`,
          [
            [{ text: '🎟️ مشاهده مجدد لیست کدهای تخفیف', callback_data: 'admin_discounts_list' }],
            [{ text: '👨‍🍳 پنل ادمین', callback_data: 'back_to_admin' }]
          ]
        );
      }
      return;
    }

    if (data === 'admin_quick_promo_percent') {
      if (onAddDiscount) {
        const randomSuffix = Math.floor(10 + Math.random() * 90);
        const newCode = `SWEET${randomSuffix}`;
        await onAddDiscount({
          code: newCode,
          type: 'percentage',
          value: 20,
          maxDiscountAmount: 100000,
          minPurchaseAmount: 150000,
          isActive: true,
          usageLimit: 50,
          usedCount: 0,
          description: `کد تخفیف ۲۰٪ ویژه جشنواره شیرینی (تا سقف ۱۰۰ هزار تومان)`
        });
        addUserMessage(`ایجاد کد تخفیف ۲۰٪ جشنواره (${newCode})`);
        addBotMessage(
          `🎉 <b>کد تخفیف ۲۰٪ با کد «<code>${newCode}</code>» با موفقیت ایجاد و فعال شد!</b>\n\n🔹 درصد تخفیف: ۲۰٪\n🔹 حداکثر تخفیف: ۱۰۰,۰۰۰ تومان\n🔹 حداقل سفارش: ۱۵۰,۰۰۰ تومان\n\nکاربران و مشتریان می‌توانند این کد را در سبد خرید ربات وارد کرده و از تخفیف بهره‌مند شوند.`,
          [
            [{ text: '🎟️ لیست کدهای تخفیف', callback_data: 'admin_discounts_list' }],
            [{ text: '👨‍🍳 پنل مدیریت', callback_data: 'back_to_admin' }]
          ]
        );
      }
      return;
    }

    if (data === 'admin_quick_promo_fixed') {
      if (onAddDiscount) {
        const randomSuffix = Math.floor(10 + Math.random() * 90);
        const newCode = `OFF${randomSuffix}`;
        await onAddDiscount({
          code: newCode,
          type: 'fixed',
          value: 50000,
          minPurchaseAmount: 200000,
          isActive: true,
          usageLimit: 30,
          usedCount: 0,
          description: `تخفیف ۵۰,۰۰۰ تومانی برای خریدهای بالای ۲۰۰ هزار تومان`
        });
        addUserMessage(`ایجاد کد تخفیف ۵۰ هزار تومانی (${newCode})`);
        addBotMessage(
          `🎉 <b>کد تخفیف ۵۰ هزار تومانی با کد «<code>${newCode}</code>» با موفقیت ایجاد شد!</b>\n\n🔹 مبلغ تخفیف: ۵۰,۰۰۰ تومان\n🔹 حداقل خرید: ۲۰۰,۰۰۰ تومان\n\nمشتریان قنادی اکنون می‌توانند از این کد در خریدهای خود استفاده کنند.`,
          [
            [{ text: '🎟️ لیست کدهای تخفیف', callback_data: 'admin_discounts_list' }],
            [{ text: '👨‍🍳 پنل مدیریت', callback_data: 'back_to_admin' }]
          ]
        );
      }
      return;
    }

    if (data === 'admin_broadcast_prompt') {
      addUserMessage('📢 ارسال پیام تخفیف به همه کاربران');
      addBotMessage(
        `📢 <b>ارسال پیام همگانی به اعضای ربات</b>\n\nلطفاً متن پیام تبلیغاتی، کد تخفیف یا خبر خوشمزه جدید قنادی را در کادر پیام زیر تایپ کرده و ارسال نمایید:`
      );
      return;
    }

    // Customer Management in Bot
    if (data === 'admin_customers_manager') {
      addUserMessage('👥 مدیریت کاربران و مشتریان');
      let customersList: any[] = [];
      try {
        const res = await fetch('/api/customers');
        if (res.ok) customersList = await res.json();
      } catch (e) {}
      if (customersList.length === 0) {
        addBotMessage(
          `👥 <b>مدیریت کاربران و مشتریان قنادی</b>\\n\\n⚠️ <b>هنوز هیچ مشتری‌ای ثبت نشده است.</b>\\n\\nمشتریان پس از اولین خرید از طریق ربات تلگرام به صورت خودکار به پایگاه داده اضافه می‌شوند.`,
          [[{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]]
        );
        return;
      }
      const totalWallet = customersList.reduce((s, c) => s + (c.walletBalance || 0), 0);
      const totalOrd = customersList.reduce((s, c) => s + (c.totalOrdersCount || 0), 0);
      let introText = `👥 <b>مدیریت کاربران و مشتریان (${toPersianDigits(customersList.length)} نفر)</b>\\n`;
      introText += `────────────────────\\n`;
      introText += `💳 مجموع کیف‌پول‌ها: <b>${formatPrice(totalWallet)} تومان</b>\\n`;
      introText += `📦 کل سفارشات: <b>${toPersianDigits(totalOrd)} سفارش</b>\\n`;
      introText += `────────────────────\\n\\n`;
      addBotMessage(introText, undefined, undefined, 150);
      customersList.slice(0, 5).forEach((c, idx) => {
        const tierEmoji = c.tier === 'vip' ? '👑' : c.tier === 'gold' ? '🥇' : c.tier === 'silver' ? '🥈' : '🥉';
        const tierLabel = c.tier === 'vip' ? 'VIP' : c.tier === 'gold' ? 'طلایی' : c.tier === 'silver' ? 'نقره‌ای' : 'برنزی';
        let cText = `${tierEmoji} <b>${c.name}</b> (${tierLabel})\\n`;
        cText += `📞 <code>${c.phone || '---'}</code> | @${c.username || c.telegramId}\\n`;
        cText += `💳 کیف‌پول: <b>${formatPrice(c.walletBalance)}</b> | ⭐️ ${toPersianDigits(c.rewardPoints)}\\n`;
        cText += `📦 ${toPersianDigits(c.totalOrdersCount)} سفارش | مجموع: ${formatPrice(c.totalSpentTomans)}`;
        addBotMessage(cText, [[{ text: '💳 شارژ کیف‌پول', callback_data: `admin_charge_wallet_${c.id}` }]], undefined, 200 + idx * 150);
      });
      addBotMessage(
        `💡 برای مدیریت کامل کاربران از تب «کاربران» در پنل تحت وب استفاده فرمایید.`,
        [[{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]]
      );
      return;
    }

    // Forum Supergroup Topics Management
    if (data === 'admin_forum_topics') {
      addUserMessage('📑 تاپیک‌های گروه تلگرام');
      const topics = botSettings.forumTopics || [];
      const isConnected = !!botSettings.forumGroupId;

      let msg = `📑 <b>مدیریت سوپرگروه تاپیک‌دار تلگرام قنادی</b>\n`;
      msg += `────────────────────\n`;
      msg += `🔹 <b>وضعیت اتصال:</b> ${isConnected ? `🟢 متصل به گروه (<code>${botSettings.forumGroupId}</code>)` : '⚠️ گروه تنظیم نشده'}\n`;
      msg += `🔹 <b>نام گروه:</b> ${botSettings.forumGroupTitle || 'گروه مدیریت قنادی شیرین‌کام'}\n`;
      msg += `────────────────────\n`;
      msg += `<b>📌 تاپیک‌های فعال و تفکیک گزارشات:</b>\n\n`;

      topics.forEach((t, i) => {
        msg += `${t.iconEmoji} <b>${t.name}</b> (شناسه تاپیک: <code>#${t.threadId || '---'}</code>)\n`;
        msg += `   ▫️ وضعیت: ${t.enabled ? '🟢 فعال' : '🔴 غیرفعال'}\n`;
        msg += `   ▫️ شرح: ${t.description}\n`;
        if (t.lastReportSummary) {
          msg += `   ▫️ آخرین گزارش: <i>${t.lastReportSummary.slice(0, 50)}...</i>\n`;
        }
        msg += `\n`;
      });

      const buttons: TelegramInlineButton[][] = [
        [
          { text: '⚡ تست اتصال خودکار و ایجاد ۸ تاپیک در گروه', callback_data: 'forum_simulate_group_connect' }
        ],
        [
          { text: '✨ ارسال همزمان گزارش به همه تاپیک‌ها', callback_data: 'forum_send_all_reports' }
        ],
        [
          { text: '📦 سفارشات آماده', callback_data: 'forum_report_orders' },
          { text: '🎂 کیک‌های سفارشی', callback_data: 'forum_report_custom_cakes' }
        ],
        [
          { text: '💳 مالی و فیش‌ها', callback_data: 'forum_report_finance' },
          { text: '🧁 انبار و محصولات', callback_data: 'forum_report_products' }
        ],
        [
          { text: '👥 امور مشتریان', callback_data: 'forum_report_customers' },
          { text: '🎟️ کدهای تخفیف', callback_data: 'forum_report_discounts' }
        ],
        [
          { text: '📊 آمار و تحلیل', callback_data: 'forum_report_analytics' },
          { text: '🛡️ بکاپ و امنیت', callback_data: 'forum_report_backup_system' }
        ],
        [
          { text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }
        ]
      ];

      addBotMessage(msg, buttons);
      return;
    }

    if (data === 'forum_simulate_group_connect') {
      addUserMessage('⚡ شبیه‌سازی عضویت بات در سوپرگروه و ساخت تاپیک‌ها');
      try {
        const res = await fetch('/api/telegram/forum/simulate-group-add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId: botSettings.forumGroupId || '-1002849173620',
            title: botSettings.forumGroupTitle || 'سوپرگروه مدیریت قنادی شیرین‌کام',
          }),
        });
        const result = (await res.json()) as any;
        if (onUpdateSettings && result.topics) {
          await onUpdateSettings({
            forumGroupId: result.groupId,
            forumGroupTitle: result.groupTitle,
            forumTopics: result.topics,
          });
        }
        addBotMessage(
          `🎉 <b>ربات با موفقیت در سوپرگروه ادمین شد!</b>\n\n🏢 <b>گروه:</b> ${result.groupTitle}\n🆔 <b>شناسه:</b> <code>${result.groupId}</code>\n\n📌 <b>تاپیک‌های ایجادشده به صورت خودکار:</b>\n1️⃣ 📦 <b>سفارشات آماده و ارسال</b> (Thread #102)\n2️⃣ 🎂 <b>سفارشات کیک دلخواه و اختصاصی</b> (Thread #103)\n3️⃣ 💳 <b>واریزی‌ها و فیش‌های بانکی</b> (Thread #104)\n4️⃣ 🧁 <b>موجودی و تغییر قیمت محصولات</b> (Thread #106)\n5️⃣ 👥 <b>باشگاه و امور مشتریان</b> (Thread #107)\n6️⃣ 🎟️ <b>کدهای تخفیف و کمپین‌ها</b> (Thread #108)\n7️⃣ 💬 <b>پیام‌ها و پشتیبانی مشتریان</b> (Thread #110)\n8️⃣ 🛡️ <b>بکاپ و امنیت سیستم</b> (Thread #112)\n\n⚡️ <i>کلیه رویدادهای زنده فروشگاه از این پس به صورت تفکیک‌شده در تاپیک مربوطه ارسال می‌شوند.</i>`,
          [
            [{ text: '✨ ارسال تست به همه تاپیک‌ها', callback_data: 'forum_send_all_reports' }],
            [{ text: '📑 مشاهده وضعیت تاپیک‌ها', callback_data: 'admin_forum_topics' }],
            [{ text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }]
          ]
        );
      } catch (err: any) {
        addBotMessage(`⚠️ خطا در اتصال خودکار به گروه: ${err.message}`, [
          [{ text: '📑 بازگشت به تاپیک‌ها', callback_data: 'admin_forum_topics' }]
        ]);
      }
      return;
    }

    if (data === 'forum_send_all_reports') {
      addUserMessage('✨ ارسال گزارش همزمان به تمام تاپیک‌های گروه');
      const topicKeys = ['orders', 'custom_cakes', 'finance', 'products', 'customers', 'discounts', 'analytics', 'backup_system'];
      for (const key of topicKeys) {
        try {
          await fetch('/api/telegram/forum/send-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
          });
        } catch (e) {
          console.error(e);
        }
      }
      addBotMessage(
        `✅ <b>گزارش‌های تفکیک‌شده با موفقیت در ۸ تاپیک سوپرگروه ثبت شدند!</b>\n\n🔹 سفارشات جدید ➡️ تاپیک 📦 سفارشات آماده\n🔹 کیک‌های اختصاصی ➡️ تاپیک 🎂 کیک دلخواه\n🔹 تراکنش‌ها و کارت به کارت ➡️ تاپیک 💳 مالی و فیش‌ها\n🔹 موجودی و قیمت‌ها ➡️ تاپیک 🧁 محصولات و انبار\n🔹 وضعیت کاربران ➡️ تاپیک 👥 امور مشتریان\n🔹 کدهای فعال ➡️ تاپیک 🎟️ تخفیف‌ها و جشنواره\n🔹 عملکرد کلی ➡️ تاپیک 📊 آمار فروش\n🔹 نسخه پشتیبان ➡️ تاپیک 🛡️ بکاپ سیستم`,
        [[{ text: '📑 مدیریت تاپیک‌ها', callback_data: 'admin_forum_topics' }, { text: '👨‍🍳 پنل ادمین', callback_data: 'back_to_admin' }]]
      );
      return;
    }

    if (data.startsWith('forum_report_')) {
      const key = data.replace('forum_report_', '');
      const keyNames: Record<string, string> = {
        orders: '📦 سفارشات آماده',
        custom_cakes: '🎂 سفارشات کیک دلخواه',
        finance: '💳 مالی و حسابداری',
        products: '🧁 محصولات و انبار',
        customers: '👥 باشگاه مشتریان',
        discounts: '🎟️ کدهای تخفیف',
        support: '💬 پشتیبانی مشتریان',
        analytics: '📊 آمار و گزارش تحلیلی',
        backup_system: '🛡️ بکاپ و امنیت سیستم'
      };
      addUserMessage(`ارسال گزارش به تاپیک ${keyNames[key] || key}`);

      try {
        const res = await fetch('/api/telegram/forum/send-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const result = (await res.json()) as any;
        addBotMessage(
          `✅ <b>گزارش با موفقیت به تاپیک «${keyNames[key] || key}» ارسال شد.</b>\n\n📌 <i>متن گزارش:</i>\n${result.reportMessage || 'گزارش ثبت شد.'}`,
          [
            [{ text: '📑 مدیریت تاپیک‌ها', callback_data: 'admin_forum_topics' }],
            [{ text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }]
          ]
        );
      } catch (err: any) {
        addBotMessage(
          `⚠️ خطا در ارسال گزارش به تاپیک: ${err.message}`,
          [[{ text: '📑 بازگشت به تاپیک‌ها', callback_data: 'admin_forum_topics' }]]
        );
      }
      return;
    }

    // Web Admin Panel Credentials & URL Management inside Telegram Bot
    if (data === 'admin_web_panel_info') {
      addUserMessage('🌐 مشخصات و مدیریت پنل تحت وب');
      const webUrl = botSettings.webAdminUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://shirinkam-admin.iran.run');
      const username = botSettings.webAdminUsername || 'admin';

      let msg = `🌐 <b>مشخصات و دسترسی به پنل مدیریت تحت وب</b>\n`;
      msg += `────────────────────\n`;
      msg += `🔗 <b>نشانی ورود (Web URL):</b>\n<code>${webUrl}</code>\n\n`;
      msg += `👤 <b>نام کاربری (Username):</b>\n<code>${username}</code>\n\n`;
      msg += `🔑 <b>رمز عبور (Password):</b>\n<i>برای حفظ امنیت نمایش داده نمی‌شود.</i>\n`;      msg += `────────────────────\n`;
      msg += `💡 <i>از طریق این پنل می‌توانید از طریق مرورگر کامپیوتر یا موبایل، تمام سفارشات، محصولات، تخفیف‌ها و نمودارها را مدیریت کنید.</i>\n\n`;
      msg += `⚡️ برای تغییر هر یک از موارد فوق، دکمه مورد نظر را لمس نمایید:`;

      const buttons: TelegramInlineButton[][] = [
        [
          { text: '🔗 ورود مستقیم به پنل وب', url: webUrl }
        ],
        [
          { text: '✏️ تغییر نام کاربری (Username)', callback_data: 'admin_change_web_user' },
          { text: '🔒 تغییر رمز عبور (Password)', callback_data: 'admin_change_web_pass' }
        ],
        [
          { text: '🎲 ایجاد رمز عبور تصادفی قوی', callback_data: 'admin_random_web_pass' },
          { text: '🌐 تغییر نشانی اینترنتی (URL)', callback_data: 'admin_change_web_url' }
        ],
        [
          { text: '👨‍🍳 بازگشت به پنل اصلی ادمین', callback_data: 'back_to_admin' }
        ]
      ];

      addBotMessage(msg, buttons);
      return;
    }

    if (data === 'admin_change_web_user') {
      addUserMessage('✏️ تغییر نام کاربری پنل وب');
      setAdminStep({ mode: 'edit_web_user' });
      addBotMessage(
        `👤 <b>تغییر نام کاربری (Username) پنل وب:</b>\n\nنام کاربری فعلی: <code>${botSettings.webAdminUsername || 'admin'}</code>\n\nلطفاً <b>نام کاربری جدید</b> مورد نظر خود را به صورت انگلیسی در کادر پایین تایپ کرده و ارسال فرمایید:\n<i>(مثال: admin_ghannadi یا manager)</i>`,
        [[{ text: '❌ انصراف و بازگشت', callback_data: 'admin_web_panel_info' }]]
      );
      return;
    }

    if (data === 'admin_change_web_pass') {
      addUserMessage('🔒 تغییر رمز عبور پنل وب');
      setAdminStep({ mode: 'edit_web_pass' });
      addBotMessage(
        `🔑 <b>تغییر رمز عبور (Password) پنل وب:</b>\n\nرمز فعلی برای حفظ امنیت نمایش داده نمی‌شود. لطفاً <b>رمز عبور جدید</b> را در کادر پیام زیر تایپ کرده و ارسال نمایید:`,
        [
          [{ text: '🎲 ساخت خودکار رمز قوی', callback_data: 'admin_random_web_pass' }],
          [{ text: '❌ انصراف و بازگشت', callback_data: 'admin_web_panel_info' }]
        ]
      );
      return;
    }

    if (data === 'admin_random_web_pass') {
      const generatedPass = 'shirin_' + Math.random().toString(36).slice(-6) + '!';
      addUserMessage('🎲 ایجاد رمز عبور تصادفی قوی برای پنل وب');
      if (onUpdateSettings) {
        await onUpdateSettings({ webAdminPassword: generatedPass });
      }
      addBotMessage(
        `✅ <b>رمز عبور جدید پنل تحت وب با موفقیت ایجاد شد!</b>\n\n🔑 <b>رمز جدید:</b> <code>${generatedPass}</code>\n\nاین رمز هم‌اکنون در سیستم ذخیره شده و برای ورود به پنل وب معتبر است.`,
        [
          [{ text: '🌐 مشاهده مجدد مشخصات ورود', callback_data: 'admin_web_panel_info' }],
          [{ text: '👨‍🍳 بازگشت به پنل ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    if (data === 'admin_change_web_url') {
      addUserMessage('🌐 تغییر آدرس اینترنتی (URL) پنل وب');
      setAdminStep({ mode: 'edit_web_url' });
      addBotMessage(
        `🔗 <b>تغییر آدرس پنل تحت وب:</b>\n\nنشانی فعلی: <code>${botSettings.webAdminUrl || window.location.origin}</code>\n\nلطفاً نشانی جدید پنل (URL) را تایپ و ارسال کنید:\n<i>(مثال: https://admin.myshop.com)</i>`,
        [[{ text: '❌ انصراف', callback_data: 'admin_web_panel_info' }]]
      );
      return;
    }

    // Invoices & Payments Manager in Simulator
    if (data === 'admin_invoices') {
      addUserMessage('🧾 مرکز فاکتورها و پرداخت‌ها');
      const regularPendingReceipts = orders.filter(o => o.paymentReceiptImage && (o.status === 'pending_payment' || o.status === 'paid_checking') && !['confirmed', 'rejected'].includes(o.receiptReviewStatus || ''));
      const totalReceived = orders.filter(o => ['receipt_confirmed', 'baking', 'shipped', 'delivered'].includes(o.status)).reduce((s, o) => s + o.totalAmount, 0);

      let text = `🧾 <b>مرکز فاکتورها، واریزی‌ها و فیش‌های بانکی</b>\n────────────────────\n`;
      text += `💰 <b>مجموع کل دریافتی‌های تأییدشده:</b> <b>${formatPrice(totalReceived)}</b>\n`;
      text += `🔍 <b>فیش‌های کارت‌به‌کارت منتظر تأیید:</b> <b>${toPersianDigits(regularPendingReceipts.length)} مورد</b>\n`;
      text += `────────────────────\n`;

      if (regularPendingReceipts.length === 0) {
        text += `✅ تمام فیش‌های واریزی بررسی شده‌اند و فیش جدیدی در صف بررسی نیست.`;
        addBotMessage(text, [
          [{ text: '📦 سفارشات عادی', callback_data: 'admin_orders_list' }],
          [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]
        ]);
        return;
      }

      text += `📌 <b>فیش‌های ارسالی مشتریان جهت تأیید یا رد:</b>`;
      addBotMessage(text, [[{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]]);

      regularPendingReceipts.slice(0, 3).forEach((o, idx) => {
        const cap = `🧾 <b>فیش سفارش:</b> <code>${o.orderNumber}</code>\n👤 مشتری: <b>${o.customerName}</b>\n📞 <code>${o.customerPhone}</code>\n💰 مبلغ: <b>${formatPrice(o.totalAmount)}</b>\n💳 روش: کارت به کارت`;
        addBotMessage(cap, [
          [{ text: '✅ تأیید فیش سفارش', callback_data: `admin_rapprove_${o.id}` }, { text: '❌ رد فیش', callback_data: `admin_rreject_${o.id}` }],
          [{ text: '📦 مشاهده در لیست سفارشات', callback_data: 'admin_orders_list' }]
        ], o.paymentReceiptImage, 250 + idx * 150);
      });
      return;
    }

    // Admins Manager in Simulator
    if (data === 'admin_admins_manager') {
      addUserMessage('🛡️ مدیریت مدیران و دسترسی‌های ربات');
      const superAdmin = botSettings.adminTelegramId || '❌ تنظیم نشده';
      const assistantAdmins: string[] = (botSettings.adminTelegramIds || []).map(String);

      let text = `🛡️ <b>مدیریت مدیران و دسترسی‌های ربات تلگرام</b>\n────────────────────\n`;
      text += `👑 <b>مدیر ارشد (Super Admin):</b> <code>${superAdmin}</code>\n\n`;
      text += `👥 <b>مدیران و پرسنل کمکی (${toPersianDigits(assistantAdmins.length)}):</b>\n`;
      if (assistantAdmins.length === 0) {
        text += `<i>هیچ مدیر کمکی ثبت نشده است.</i>\n`;
      } else {
        assistantAdmins.forEach((id, i) => {
          text += `${toPersianDigits(i + 1)}️⃣ شناسه: <code>${id}</code>\n`;
        });
      }
      text += `────────────────────\n💡 <i>پرسنل با شناسه بالا می‌توانند با زدن دستور /start به پنل مدیریت در تلگرام دسترسی داشته باشند.</i>`;

      const btns: TelegramInlineButton[][] = [
        [{ text: '➕ افزودن مدیر جدید', callback_data: 'admin_add_admin_prompt' }],
        [{ text: '👑 تغییر شناسه مدیر ارشد', callback_data: 'admin_edit_super_admin' }]
      ];
      if (assistantAdmins.length > 0) {
        for (const id of assistantAdmins) {
          btns.push([{ text: `🗑️ حذف دسترسی ${id}`, callback_data: `admin_del_admin_${id}` }]);
        }
      }
      btns.push([{ text: '👨‍🍳 بازگشت به پنل ادمین', callback_data: 'back_to_admin' }]);
      addBotMessage(text, btns);
      return;
    }

    if (data === 'admin_add_admin_prompt') {
      addUserMessage('➕ افزودن مدیر جدید');
      setAdminStep({ mode: 'add_admin_id' as any });
      addBotMessage(
        '➕ <b>افزودن مدیر جدید:</b>\n\nلطفاً <b>شناسه عددی تلگرام (Telegram ID)</b> پرسنل مورد نظر را تایپ و ارسال کنید:\n(شناسه را از ربات @userinfobot دریافت کنید)',
        [[{ text: '❌ انصراف', callback_data: 'admin_admins_manager' }]]
      );
      return;
    }

    if (data.startsWith('admin_del_admin_')) {
      const idToRemove = data.replace('admin_del_admin_', '');
      const currentList: string[] = (botSettings.adminTelegramIds || []).map(String);
      const updated = currentList.filter(x => String(x) !== String(idToRemove));
      if (onUpdateSettings) {
        await onUpdateSettings({ adminTelegramIds: updated });
      }
      addUserMessage(`حذف دسترسی مدیر ${idToRemove}`);
      addBotMessage(
        `🗑️ دسترسی مدیر با شناسه <code>${idToRemove}</code> با موفقیت حذف شد.`,
        [
          [{ text: '🛡️ لیست مدیران', callback_data: 'admin_admins_manager' }],
          [{ text: '👨‍🍳 منوی ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    // Backup & Database Manager in Simulator
    if (data === 'admin_backup') {
      addUserMessage('💾 بکاپ و دیتابیس قنادی');
      let text = `💾 <b>بکاپ و پایگاه داده قنادی</b>\n────────────────────\n`;
      text += `📦 سفارشات ثبت‌شده: <b>${toPersianDigits(orders.length)}</b>\n`;
      text += `🧁 محصولات فعال: <b>${toPersianDigits(products.length)}</b>\n`;
      text += `🎟️ کدهای تخفیف: <b>${toPersianDigits(discounts.length)}</b>\n`;
      text += `────────────────────\n`;
      text += `دیتابیس سیستم به صورت فایل‌های JSON مستقل روی دیسک سرور با امنیت کامل ذخیره و هر ۱۰ ثانیه همگام‌سازی می‌شود.`;

      addBotMessage(text, [
        [{ text: '⚡ ایجاد نسخه پشتیبان فوری (اسنپ‌شات)', callback_data: 'admin_create_instant_snapshot' }],
        [{ text: '🌐 مشخصات ورود به پنل وب', callback_data: 'admin_web_panel_info' }],
        [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'back_to_admin' }]
      ]);
      return;
    }

    if (data === 'admin_create_instant_snapshot') {
      addUserMessage('⚡ ایجاد نسخه پشتیبان فوری');
      const timeStr = new Date().toLocaleTimeString('fa-IR');
      addBotMessage(
        `✅ <b>نسخه پشتیبان فوری دیتابیس با موفقیت ایجاد شد!</b>\n\n⏰ زمان بکاپ: <b>${timeStr}</b>\n📁 فایل‌های دیتابیس با موفقیت اسنپ‌شات شدند.`,
        [
          [{ text: '💾 منوی بکاپ', callback_data: 'admin_backup' }],
          [{ text: '👨‍🍳 منوی ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }
  };

  // Handle direct file upload from telegram chat attachment
  const handleChatFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('لطفاً یک فایل تصویری انتخاب نمایید.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      if (e.target?.result) {
        const base64Url = e.target.result as string;
        addUserMessage('📤 تصویر پیوست شد', base64Url);

        if (adminStep.mode === 'add_image') {
          setAdminStep(prev => ({
            mode: 'add_desc',
            draftProduct: { ...prev.draftProduct, image: base64Url }
          }));

          addBotMessage(
            `🖼️ <b>عکس آپلود شده برای محصول جدید ثبت شد!</b>\n\nمرحله ۵ از ۵: لطفاً <b>توضیحات کوتاه یا مواد تشکیل‌دهنده</b> را تایپ کنید:\n<i>(یا بنویسید «عالی» جهت توضیحات پیش‌فرض)</i>`,
            undefined,
            base64Url
          );
        } else if (adminStep.mode === 'upload_photo_for_prod' && adminStep.productId) {
          await onUpdateProduct(adminStep.productId, { image: base64Url });
          const prod = products.find(p => p.id === adminStep.productId);
          setAdminStep({ mode: 'idle' });

          addBotMessage(
            `✅ <b>عکس محصول «${prod?.name || ''}» با موفقیت به‌روزرسانی شد!</b>`,
            [[{ text: '💰 بازگشت به مدیریت محصولات', callback_data: 'admin_price_manager' }]],
            base64Url
          );
        } else {
          addBotMessage(
            'تصویر شما دریافت شد. در صورتی که می‌خواهید محصول جدیدی اضافه کنید دکمه زیر را لمس نمایید:',
            [[{ text: '➕ افزودن محصول با این عکس', callback_data: 'admin_add_product' }]],
            base64Url
          );
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle Text Submission from Input Bar
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const userText = inputText.trim();
    setInputText('');
    addUserMessage(userText);

    // Command shortcuts
    if (userText === '/start') {
      if (role === 'admin') sendAdminWelcomeMessage();
      else sendCustomerWelcomeMessage();
      return;
    }

    if (userText === '/admin') {
      setRole('admin');
      sendAdminWelcomeMessage();
      return;
    }

    if (userText === '/help') {
      addBotMessage(botSettings.helpMessage, [
        [{ text: '🍰 مشاهده منو', callback_data: 'customer_categories' }]
      ]);
      return;
    }

    // Admin Add Product Step Machine
    if (adminStep.mode === 'add_name') {
      setAdminStep({
        mode: 'add_category',
        draftProduct: { name: userText }
      });
      const categories: ProductCategory[] = [
        'کیک و پای',
        'شیرینی تر و خامه‌ای',
        'شیرینی خشک و سنتی',
        'دسر و باقلوا',
        'کوکی و بیسکوئیت',
        'نان و کروسان'
      ];
      const buttons = categories.map(cat => [
        { text: cat, callback_data: `admin_cat_select_${cat}` }
      ]);
      addBotMessage(
        `🍰 <b>نام محصول «${userText}» ثبت شد.</b>\n\nمرحله ۲ از ۵: لطفاً <b>دسته‌بندی</b> را با دکمه‌های شیشه‌ای زیر انتخاب کنید:`,
        buttons
      );
      return;
    }

    if (adminStep.mode === 'add_price') {
      const priceNum = parseInt(userText.replace(/[^0-9]/g, ''), 10);
      if (isNaN(priceNum) || priceNum <= 0) {
        addBotMessage('⚠️ لطفاً قیمت را فقط به صورت عدد (مثلاً 350000) وارد کنید:');
        return;
      }

      setAdminStep(prev => ({
        mode: 'add_image',
        draftProduct: { ...prev.draftProduct, price: priceNum, unit: 'کیلوگرم' }
      }));

      // Offer quick preset images or custom upload
      addBotMessage(
        `💰 <b>قیمت ${formatPrice(priceNum)} ثبت شد.</b>\n\nمرحله ۴ از ۵: لطفاً <b>عکس محصول</b> را انتخاب یا آپلود کنید:\n<i>(می‌توانید روی دکمه سنجاق 📎 کلیک کنید و عکس را آپلود نمایید، یا یکی از عکس‌های پیشنهادی زیر را بزنید)</i>`,
        [
          [
            { text: '📎 آپلود عکس از دستگاه (Upload Photo)', callback_data: 'admin_trigger_file_upload' }
          ],
          [
            { text: '🎂 کیک شکلاتی', callback_data: 'admin_preset_photo_https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80' },
            { text: '🧁 شیرینی خامه‌ای', callback_data: 'admin_preset_photo_https://images.unsplash.com/photo-1587314168485-3236d6710814?w=700&auto=format&fit=crop&q=80' }
          ],
          [
            { text: '🍮 باقلوا پسته', callback_data: 'admin_preset_photo_https://images.unsplash.com/photo-1519869325930-281384150729?w=700&auto=format&fit=crop&q=80' },
            { text: '🥐 کروسان فرانسوی', callback_data: 'admin_preset_photo_https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=700&auto=format&fit=crop&q=80' }
          ]
        ]
      );
      return;
    }

    if (adminStep.mode === 'add_image') {
      const imgUrl = userText.startsWith('http') 
        ? userText 
        : 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80';

      setAdminStep(prev => ({
        mode: 'add_desc',
        draftProduct: { ...prev.draftProduct, image: imgUrl }
      }));

      addBotMessage(
        `🖼️ <b>تصویر محصول ذخیره شد.</b>\n\nمرحله ۵ از ۵: لطفاً <b>توضیحات کوتاه یا مشخصات طعم</b> را بنویسید:\n<i>(مثال: پخت تازه با خامه قنادی اعلا و مغز گردو)</i>`,
        undefined,
        imgUrl
      );
      return;
    }

    if (adminStep.mode === 'upload_photo_for_prod' && adminStep.productId) {
      const imgUrl = userText.startsWith('http') 
        ? userText 
        : 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80';

      await onUpdateProduct(adminStep.productId, { image: imgUrl });
      const prod = products.find(p => p.id === adminStep.productId);
      setAdminStep({ mode: 'idle' });

      addBotMessage(
        `✅ عکس محصول <b>${prod?.name || ''}</b> با موفقیت تغییر یافت.`,
        [[{ text: '💰 بازگشت به مدیریت محصولات', callback_data: 'admin_price_manager' }]],
        imgUrl
      );
      return;
    }

    if (adminStep.mode === 'add_desc') {
      const fullDraft = {
        name: adminStep.draftProduct?.name || 'شیرینی مخصوص',
        category: adminStep.draftProduct?.category || 'شیرینی تر و خامه‌ای',
        price: adminStep.draftProduct?.price || 350000,
        unit: 'کیلوگرم',
        image: adminStep.draftProduct?.image || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80',
        description: userText,
        isAvailable: true,
        preparationTimeHours: 2,
        stockKgOrCount: 20
      };

      const created = await onAddProduct(fullDraft);
      setAdminStep({ mode: 'idle' });

      addBotMessage(
        `🎉 <b>محصول با موفقیت ایجاد و به قنادی اضافه شد!</b>\n\n🎂 <b>نام:</b> ${created.name}\n📂 <b>دسته‌بندی:</b> ${created.category}\n💰 <b>قیمت:</b> ${formatPrice(created.price)} / ${created.unit}\n\nهم‌اکنون مشتریان می‌توانند این محصول را در ربات تلگرام مشاهده و سفارش دهند.`,
        [
          [
            { text: '➕ افزودن محصول دیگر', callback_data: 'admin_add_product' },
            { text: '💰 مدیریت قیمت‌ها', callback_data: 'admin_price_manager' }
          ],
          [
            { text: '👨‍🍳 منوی اصلی ادمین', callback_data: 'back_to_admin' }
          ]
        ],
        created.image
      );
      return;
    }

    if (adminStep.mode === 'edit_price_val' && adminStep.productId) {
      const priceNum = parseInt(userText.replace(/[^0-9]/g, ''), 10);
      if (isNaN(priceNum) || priceNum <= 0) {
        addBotMessage('⚠️ لطفاً قیمت جدید را فقط به صورت عدد وارد کنید:');
        return;
      }

      await onUpdateProduct(adminStep.productId, { price: priceNum });
      const prod = products.find(p => p.id === adminStep.productId);
      setAdminStep({ mode: 'idle' });

      addBotMessage(
        `✅ <b>قیمت جدید با موفقیت ثبت شد:</b>\n\nمحصول: <b>${prod?.name || ''}</b>\nقیمت جدید: <b>${formatPrice(priceNum)}</b>`,
        [
          [
            { text: '💰 بازگشت به لیست قیمت‌ها', callback_data: 'admin_price_manager' },
            { text: '👨‍🍳 پنل ادمین', callback_data: 'back_to_admin' }
          ]
        ]
      );
      return;
    }

    // Web Admin Credentials Change Handlers via Telegram Text
    if (adminStep.mode === 'edit_web_user') {
      const newUsername = userText.trim();
      if (!newUsername || newUsername.length < 3) {
        addBotMessage('⚠️ نام کاربری باید حداقل ۳ کاراکتر باشد. لطفاً مجدداً وارد کنید:');
        return;
      }
      if (onUpdateSettings) {
        await onUpdateSettings({ webAdminUsername: newUsername });
      }
      setAdminStep({ mode: 'idle' });
      addBotMessage(
        `✅ <b>نام کاربری پنل تحت وب با موفقیت تغییر یافت!</b>\n\n👤 <b>نام کاربری جدید:</b> <code>${newUsername}</code>`,
        [
          [{ text: '🌐 مشاهده اطلاعات ورود به پنل وب', callback_data: 'admin_web_panel_info' }],
          [{ text: '👨‍🍳 پنل اصلی ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    if (adminStep.mode === 'edit_web_pass') {
      const newPassword = userText.trim();
      if (!newPassword || newPassword.length < 4) {
        addBotMessage('⚠️ رمز عبور باید حداقل ۴ کاراکتر باشد. لطفاً مجدداً تایپ کنید:');
        return;
      }
      if (onUpdateSettings) {
        await onUpdateSettings({ webAdminPassword: newPassword });
      }
      setAdminStep({ mode: 'idle' });
      addBotMessage(
        `✅ <b>رمز عبور پنل تحت وب با موفقیت تغییر یافت!</b>\n\n🔑 <b>رمز عبور جدید:</b> <code>${newPassword}</code>\n\nاز این پس می‌توانید با این رمز جدید به پنل تحت وب قنادی وارد شوید.`,
        [
          [{ text: '🌐 مشاهده اطلاعات ورود به پنل وب', callback_data: 'admin_web_panel_info' }],
          [{ text: '👨‍🍳 پنل اصلی ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    if (adminStep.mode === 'edit_web_url') {
      const newUrl = userText.trim();
      if (onUpdateSettings) {
        await onUpdateSettings({ webAdminUrl: newUrl });
      }
      setAdminStep({ mode: 'idle' });
      addBotMessage(
        `✅ <b>نشانی پنل تحت وب با موفقیت ذخیره شد!</b>\n\n🔗 <b>نشانی جدید:</b> <code>${newUrl}</code>`,
        [
          [{ text: '🌐 مشاهده اطلاعات ورود به پنل وب', callback_data: 'admin_web_panel_info' }],
          [{ text: '👨‍🍳 پنل اصلی ادمین', callback_data: 'back_to_admin' }]
        ]
      );
      return;
    }

    if (isAwaitingDiscountCode) {
      setIsAwaitingDiscountCode(false);
      const promoCode = userText.trim().toUpperCase();
      const { subtotal } = getCartCalculation();
      const disc = discounts.find(d => d.code.toUpperCase() === promoCode);

      if (!disc) {
        addBotMessage(`❌ کد تخفیف «${userText}» یافت نشد یا معتبر نمی‌باشد.`, [
          [
            { text: '🏷️ تلاش مجدد برای کد تخفیف', callback_data: 'apply_discount_prompt' },
            { text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }
          ]
        ]);
        return;
      }

      if (!disc.isActive) {
        addBotMessage('❌ این کد تخفیف در حال حاضر غیرفعال می‌باشد.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.usageLimit && disc.usedCount >= disc.usageLimit) {
        addBotMessage('❌ متأسفانه سقف استفاده از این کد تخفیف به اتمام رسیده است.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.expiresAt && new Date(disc.expiresAt) < new Date()) {
        addBotMessage('❌ مهلت استفاده از این کد تخفیف منقضی شده است.', [
          [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
        ]);
        return;
      }

      if (disc.minPurchaseAmount && subtotal < disc.minPurchaseAmount) {
        addBotMessage(
          `⚠️ این کد تخفیف فقط برای سفارش‌های با مبلغ بالای <b>${formatPrice(disc.minPurchaseAmount)}</b> معتبر است.\nمبلغ فعلی سبد شما: ${formatPrice(subtotal)}`,
          [
            [{ text: '🍰 افزودن شیرینی دیگر به سبد', callback_data: 'customer_categories' }],
            [{ text: '🛒 بازگشت به سبد خرید', callback_data: 'view_cart' }]
          ]
        );
        return;
      }

      let calculatedDiscount = 0;
      if (disc.type === 'percentage') {
        calculatedDiscount = Math.round((subtotal * disc.value) / 100);
        if (disc.maxDiscountAmount && calculatedDiscount > disc.maxDiscountAmount) {
          calculatedDiscount = disc.maxDiscountAmount;
        }
      } else {
        calculatedDiscount = Math.min(disc.value, subtotal);
      }

      setAppliedDiscount({
        code: disc.code,
        discountAmount: calculatedDiscount,
        discountObj: disc
      });

      addBotMessage(
        `🎉 <b>کد تخفیف «${disc.code}» با موفقیت اعمال شد!</b>\n\n💰 <b>مبلغ تخفیف کسر شده:</b> <b>${formatPrice(calculatedDiscount)}</b>`,
        [
          [{ text: '🛒 مشاهده سبد خرید به‌روزشده', callback_data: 'view_cart' }],
          [{ text: '💳 تکمیل خرید و تسویه حساب', callback_data: 'checkout_start' }]
        ]
      );
      return;
    }

    // Checkout Flow Step Machine
    if (checkoutStep.step === 'name') {
      setCheckoutStep({
        step: 'phone',
        draftOrder: { customerName: userText }
      });
      addBotMessage(
        `👤 نام <b>${userText}</b> ثبت شد.\n\n📞 <b>مرحله ۲ از ۳:</b> لطفاً <b>شماره تلفن همراه</b> خود را جهت هماهنگی پیک ارسال کنید:\n<i>(مثال: 09121234567)</i>`
      );
      return;
    }

    if (checkoutStep.step === 'phone') {
      setCheckoutStep(prev => ({
        step: 'address',
        draftOrder: { ...prev.draftOrder, customerPhone: userText }
      }));
      addBotMessage(
        `📞 شماره همراه ثبت شد.\n\n🏠 <b>مرحله ۳ از ۳:</b> لطفاً <b>آدرس دقیق تحویل</b> همراه با پلاک و واحد را وارد نمایید:`
      );
      return;
    }

    if (checkoutStep.step === 'address') {
      const draft = { ...checkoutStep.draftOrder, customerAddress: userText };
      setCheckoutStep({
        step: 'invoice_preview',
        draftOrder: draft
      });

      sendInvoicePreviewMessage(draft);
      return;
    }

    // Default conversational reply / Smart search
    const searchMatch = products.filter((product) => matchesSearchValues(userText, [
      product.productCode,
      product.name,
      product.category,
      product.unit,
      product.description,
    ]));
    if (searchMatch.length > 0) {
      addBotMessage(
        `🔍 <b>نتایج جستجو برای «${userText}» (${toPersianDigits(searchMatch.length)} مورد):</b>`,
        searchMatch.slice(0, 3).map(p => [
          { text: `🍰 ${p.name} - ${formatPrice(p.price)}`, callback_data: `cat_${p.category}` }
        ])
      );
    } else {
      addBotMessage(
        `پیام شما دریافت شد. برای دسترسی سریع از دکمه‌های شیشه‌ای زیر استفاده نمایید:`,
        role === 'admin' 
          ? [[{ text: '👨‍🍳 منوی مدیریت ادمین', callback_data: 'back_to_admin' }]]
          : [[{ text: '🍰 مشاهده منوی قنادی', callback_data: 'customer_categories' }, { text: '🛒 سبد خرید', callback_data: 'view_cart' }]]
      );
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
  };

  return (
    <div className="w-full mx-auto flex flex-col items-center">
      
      {/* Top Simulator Controls Toolbar */}
      <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-3 sm:p-4 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-400 to-blue-600 flex items-center justify-center text-white font-bold shadow-md">
              <Cake className="w-5 h-5" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full animate-ping" />
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                شبیه‌ساز ربات تلگرام
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono shrink-0">
                @{botSettings.botUsername}
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate hidden sm:block">
              دکمه‌های شیشه‌ای • انتخاب تعداد • آپلود عکس
            </p>
          </div>
        </div>

        {/* Role Toggle & Controls */}
        <div className="flex items-center gap-2">
          
          {/* Role Pill Switcher */}
          <div className="bg-slate-800/90 p-1 rounded-xl border border-slate-700 flex items-center gap-1">
            <button
              onClick={() => {
                setRole('customer');
                sendCustomerWelcomeMessage();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                role === 'customer'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>دید مشتری</span>
            </button>
            <button
              onClick={() => {
                setRole('admin');
                sendAdminWelcomeMessage();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                role === 'admin'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>پنل ادمین (قناد)</span>
            </button>
          </div>

          {/* Theme Switcher */}
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="تغییر پوسته تاریک/روشن تلگرام"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-sky-400" />}
          </button>

          {/* Reset Chat */}
          <button
            onClick={() => {
              setMessages([]);
              setCart([]);
              setAdminStep({ mode: 'idle' });
              setCheckoutStep({ step: 'idle' });
              if (role === 'admin') sendAdminWelcomeMessage();
              else sendCustomerWelcomeMessage();
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="ریست و پاک کردن گفت‌وگو"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Telegram Mobile Mockup Frame */}
      <div 
        className={`w-full sm:max-w-[460px] sm:rounded-[38px] sm:border-[8px] rounded-2xl border-2 border-slate-800 shadow-2xl overflow-hidden flex flex-col relative transition-all duration-300 ${
          theme === 'dark' ? 'bg-[#0f172a] text-slate-100' : 'bg-[#e2e8f0] text-slate-900'
        }`}
        style={{ height: '760px', maxHeight: '85vh' }}
      >
        
        {/* Telegram Header */}
        <div className="bg-[#1e293b]/95 backdrop-blur-md px-4 py-3 border-b border-slate-800 text-white flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=120&auto=format&fit=crop&q=80"
                alt="Bot Avatar"
                className="w-10 h-10 rounded-full object-cover ring-2 ring-amber-500/50"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm tracking-tight text-white leading-tight">
                  {botSettings.botName}
                </h3>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/30 text-sky-300 font-mono">bot</span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                {isTyping ? (
                  <span className="text-sky-400 animate-pulse font-medium">در حال تایپ...</span>
                ) : (
                  <span>@{botSettings.botUsername}</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => handleCallbackQuery(role === 'admin' ? 'back_to_admin' : 'back_to_main')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-xs flex items-center gap-1"
              title="منوی اصلی"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>منو</span>
            </button>
          </div>
        </div>

        {/* Telegram Chat Wallpaper Area */}
        <div 
          className="flex-1 overflow-y-auto p-3.5 space-y-3 relative scroll-smooth"
          style={{
            backgroundImage: theme === 'dark' 
              ? 'radial-gradient(circle at 50% 50%, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.95) 100%)'
              : 'radial-gradient(circle at 50% 50%, rgba(241, 245, 249, 0.7) 0%, rgba(226, 232, 240, 0.95) 100%)',
          }}
        >
          {/* Date separator pill */}
          <div className="flex justify-center my-1">
            <span className="text-[11px] px-3 py-0.5 rounded-full bg-slate-800/60 text-slate-400 border border-slate-700/50 backdrop-blur-sm">
              امروز
            </span>
          </div>

          {messages.map((msg) => {
            const isBot = msg.sender === 'bot';
            const imageSource = resolveTelegramImageSource(msg.photo);
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isBot ? 'items-start' : 'items-end'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
              >
                {/* Message Bubble */}
                <div
                  className={`max-w-[88%] rounded-2xl p-3 shadow-md relative group ${
                    isBot
                      ? theme === 'dark'
                        ? 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-tr-sm'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-tr-sm'
                      : 'bg-sky-600 text-white rounded-tl-sm shadow-sky-600/20'
                  }`}
                >
                  {/* Photo if present */}
                  {imageSource && (
                    <button
                      type="button"
                      onClick={() => setPreviewImage(imageSource)}
                      className="mb-2.5 block w-full overflow-hidden rounded-xl border border-white/10 shadow-inner text-right"
                      title="مشاهده و زوم تصویر"
                    >
                      <img
                        src={imageSource}
                        alt="رسانه ارسالی در گفتگو"
                        className="w-full h-44 object-cover hover:scale-105 transition-transform duration-500 cursor-zoom-in"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <span className={`block px-2 py-1 text-[10px] ${isBot ? 'bg-slate-900/90 text-slate-300' : 'bg-sky-700/80 text-sky-100'}`}>
                        برای زوم تصویر کلیک کنید
                      </span>
                    </button>
                  )}

                  {/* Message Text with HTML/formatting */}
                  <div
                    className="text-[13px] leading-relaxed break-words whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: msg.text }}
                  />

                  {/* Timestamp & Status */}
                  <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isBot ? 'text-slate-400' : 'text-sky-200'}`}>
                    <span>{msg.timestamp}</span>
                    {!isBot && <CheckCheck className="w-3 h-3" />}
                  </div>
                </div>

                {/* Glassmorphic Inline Keyboard Buttons */}
                {msg.reply_markup?.inline_keyboard && msg.reply_markup.inline_keyboard.length > 0 && (
                  <div className="w-[88%] mt-1.5 space-y-1.5">
                    {msg.reply_markup.inline_keyboard.map((row, rIdx) => (
                      <div key={rIdx} className="flex gap-1.5 w-full">
                        {row.map((btn, bIdx) => (
                          <button
                            key={bIdx}
                            onClick={() => handleCallbackQuery(btn.callback_data)}
                            className="flex-1 py-2.5 px-2 rounded-xl text-[11px] sm:text-xs font-semibold text-center transition-all duration-200 backdrop-blur-md bg-white/15 hover:bg-white/25 active:scale-[0.97] border border-white/20 shadow-sm text-slate-100 flex items-center justify-center gap-1 group"
                            style={{
                              background: theme === 'dark' 
                                ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%)' 
                                : 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.85) 100%)',
                              boxShadow: '0 4px 12px 0 rgba(0, 0, 0, 0.15)',
                              border: '1px solid rgba(255, 255, 255, 0.2)'
                            }}
                          >
                            <span className="truncate group-hover:text-amber-300 transition-colors">
                              {btn.text}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex items-center gap-1.5 bg-slate-800/80 backdrop-blur-md px-3 py-2 rounded-2xl rounded-tr-sm border border-slate-700/50 w-fit text-slate-400">
              <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips Bar */}
        <div className="bg-slate-900/90 border-t border-slate-800/80 px-2 py-1.5 flex gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
          {role === 'admin' ? (
            <>
              <button
                onClick={() => handleCallbackQuery('admin_add_product')}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap hover:bg-amber-500/30"
              >
                ➕ افزودن شیرینی
              </button>
              <button
                onClick={() => handleCallbackQuery('admin_price_manager')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap hover:bg-slate-700"
              >
                💰 ویرایش قیمت‌ها
              </button>
              <button
                onClick={() => handleCallbackQuery('admin_orders_list')}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap hover:bg-emerald-500/30"
              >
                📦 سفارشات ({toPersianDigits(orders.length)})
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleCallbackQuery('customer_categories')}
                className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/30 whitespace-nowrap hover:bg-sky-500/30"
              >
                🍰 منوی شیرینی‌ها
              </button>
              <button
                onClick={() => handleCallbackQuery('view_cart')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap hover:bg-slate-700"
              >
                🛒 سبد ({toPersianDigits(cart.reduce((s, i) => s + i.quantity, 0))})
              </button>
              <button
                onClick={() => handleCallbackQuery('contact_info')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap hover:bg-slate-700"
              >
                📍 آدرس و تماس
              </button>
              <button
                onClick={() => handleCallbackQuery('switch_to_admin')}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap hover:bg-amber-500/30"
              >
                👨‍🍳 پنل ادمین
              </button>
            </>
          )}
        </div>

        {/* Hidden File Picker for Chat Image Upload */}
        <input
          type="file"
          ref={chatFileInputRef}
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleChatFileUpload(e.target.files[0]);
            }
          }}
        />

        {/* Telegram Chat Input Bar */}
        <form
          onSubmit={handleSendMessage}
          className="bg-[#1e293b] p-2.5 border-t border-slate-800 flex items-center gap-2 shrink-0"
        >
          {/* Attachment button for Photo Upload */}
          <button
            type="button"
            onClick={() => chatFileInputRef.current?.click()}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="آپلود و ارسال عکس (پیوست فایل)"
          >
            <Camera className="w-5 h-5 text-sky-400 hover:scale-110 transition-transform" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              role === 'admin' 
                ? 'دستور /admin یا متن محصول جدید...' 
                : 'پیام، نام شیرینی یا دستور /start...'
            }
            className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className={`p-2 rounded-xl transition-all ${
              inputText.trim()
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30 hover:bg-sky-500'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4 rotate-180" />
          </button>
        </form>

      </div>

      <ZoomableImageModal
        imageSrc={previewImage}
        onClose={() => setPreviewImage(null)}
        alt="تصویر ارسال‌شده در گفتگوی تلگرام"
        title="مشاهده تصویر گفتگو"
        description="برای بررسی جزئیات، بزرگ‌نمایی یا کوچک‌نمایی کنید."
      />

      {/* Quick Helper Guide footer */}
      <div className="mt-4 text-xs text-slate-400 text-center max-w-lg">
        💡 <b>نکته:</b> دکمه‌های بالا دقیقاً ساختار <code>InlineKeyboardMarkup</code> استاندارد تلگرام را با طراحی شیشه‌ای شبیه‌سازی می‌کنند. مشتریان می‌توانند تعداد دلخواه را انتخاب کنند و در سبد خرید آن را تغییر یا حذف نمایند. ادمین نیز می‌تواند با کلیک روی آیکون دوربین 📷 یا از تب بالای صفحه، عکس محصول را مستقیماً آپلود کند.
      </div>

    </div>
  );
};
