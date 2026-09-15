import React, { useState } from 'react';
import { 
  ShoppingBag, 
  Clock, 
  Phone, 
  MapPin, 
  CheckCircle2, 
  Truck, 
  XCircle, 
  AlertCircle, 
  Eye, 
  X,
  CreditCard,
  User,
  Calendar,
  ChefHat,
  Search,
  ZoomIn
} from 'lucide-react';
import { CustomerUser, Order, OrderStatus } from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';
import { matchesSearchValues, normalizeSearchValue } from '../utils/search';
import { resolveTelegramImageSource } from '../utils/telegramImage';
import { ZoomableImageModal } from './ZoomableImageModal';

interface OrderManagerProps {
  orders: Order[];
  customers?: CustomerUser[];
  onUpdateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
}

// Kept as a named export for existing order-search consumers and tests.
export const normalizeOrderSearchValue = normalizeSearchValue;

export const OrderManager: React.FC<OrderManagerProps> = ({
  orders,
  customers = [],
  onUpdateOrderStatus,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeReceiptModal, setActiveReceiptModal] = useState<Order | null>(null);
  const [zoomedReceiptImage, setZoomedReceiptImage] = useState<string | null>(null);
  const [receiptDecisionLoading, setReceiptDecisionLoading] = useState<string | null>(null);

  // Telegram file_ids are not URLs — resolve them through the server's file proxy.
  const receiptImageSrc = (receipt: string | undefined): string | undefined =>
    resolveTelegramImageSource(receipt) || undefined;

  const canReviewReceipt = (order: Order) => Boolean(order.paymentReceiptImage)
    && (order.status === 'pending_payment' || order.status === 'paid_checking')
    && !['confirmed', 'rejected'].includes(order.receiptReviewStatus || '');

  // Approve / reject a payment receipt (notifies the customer via the bot)
  const handleReceiptDecision = async (order: Order, approved: boolean) => {
    setReceiptDecisionLoading(`${order.id}-${approved ? 'a' : 'r'}`);
    try {
      const response = await fetch(`/api/orders/${order.id}/receipt-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'ثبت تصمیم فیش ناموفق بود.');
      }
      // Receipt approval only verifies payment. Production is started later by
      // the separate, explicit «شروع پخت و تزیین» action below.
      await onUpdateOrderStatus(order.id, approved ? 'receipt_confirmed' : 'pending_payment');
      setActiveReceiptModal((current) => (current && current.id === order.id ? null : current));
    } catch (e) {
      console.error('Failed to submit receipt decision:', e);
      alert(e instanceof Error ? e.message : 'ثبت تصمیم فیش ناموفق بود.');
    } finally {
      setReceiptDecisionLoading(null);
    }
  };

  const statusConfig: Record<
    OrderStatus,
    { label: string; bg: string; text: string; border: string; activeBg: string; activeText: string; activeBorder: string; icon: any }
  > = {
    pending_payment: {
      label: 'در انتظار تأیید',
      bg: 'bg-amber-500/15',
      text: 'text-amber-300',
      border: 'border-amber-500/30',
      activeBg: 'bg-amber-500',
      activeText: 'text-white',
      activeBorder: 'border-amber-600',
      icon: Clock,
    },
    paid_checking: {
      label: 'بررسی فیش واریز',
      bg: 'bg-sky-500/15',
      text: 'text-sky-300',
      border: 'border-sky-500/30',
      activeBg: 'bg-sky-500',
      activeText: 'text-white',
      activeBorder: 'border-sky-600',
      icon: AlertCircle,
    },
    receipt_confirmed: {
      label: 'فیش تأیید شده — آماده شروع پخت',
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-300',
      border: 'border-emerald-500/30',
      activeBg: 'bg-emerald-500',
      activeText: 'text-white',
      activeBorder: 'border-emerald-600',
      icon: CheckCircle2,
    },
    baking: {
      label: 'در حال پخت و آماده‌سازی',
      bg: 'bg-indigo-500/15',
      text: 'text-indigo-300',
      border: 'border-indigo-500/30',
      activeBg: 'bg-indigo-500',
      activeText: 'text-white',
      activeBorder: 'border-indigo-600',
      icon: ChefHat,
    },
    shipped: {
      label: 'تحویل به پیک (ارسال)',
      bg: 'bg-purple-500/15',
      text: 'text-purple-300',
      border: 'border-purple-500/30',
      activeBg: 'bg-purple-500',
      activeText: 'text-white',
      activeBorder: 'border-purple-600',
      icon: Truck,
    },
    delivered: {
      label: 'تحویل داده شد',
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-300',
      border: 'border-emerald-500/30',
      activeBg: 'bg-emerald-500',
      activeText: 'text-white',
      activeBorder: 'border-emerald-600',
      icon: CheckCircle2,
    },
    cancelled: {
      label: 'لغو شده',
      bg: 'bg-rose-500/15',
      text: 'text-rose-300',
      border: 'border-rose-500/30',
      activeBg: 'bg-rose-500',
      activeText: 'text-white',
      activeBorder: 'border-rose-600',
      icon: XCircle,
    },
  };

  const filteredOrders = orders.filter((order) => {
    if (selectedStatus !== 'all' && order.status !== selectedStatus) return false;

    // Legacy orders may not have the Telegram profile fields directly on the
    // order. Link the known customer record so all historic orders stay searchable.
    const linkedCustomer = customers.find((customer) =>
      (order.customerTelegramId && String(customer.telegramId) === String(order.customerTelegramId)) ||
      (order.customerPhone && customer.phone === order.customerPhone) ||
      (order.customerName && customer.name === order.customerName)
    );

    return matchesSearchValues(searchQuery, [
      order.orderNumber,
      order.id,
      order.customerName,
      order.customerPhone,
      order.customerAddress,
      order.customerTelegramId,
      order.customerUsername,
      order.customerTelegramName,
      linkedCustomer?.name,
      linkedCustomer?.username,
      linkedCustomer?.telegramId,
      linkedCustomer?.phone,
      order.couponCode,
      order.status,
      order.deliveryMethod,
      order.paymentMethod,
      ...(order.items || []).flatMap((item) => [item.productName, item.productCode, item.unit])
    ]);
  });

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto space-y-6">
      
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 xl:p-8 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 sm:gap-6 shadow-xl">
        <div className="min-w-0 space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>مدیریت سفارشات قنادی</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            پیگیری و پردازش سفارشات ثبت شده در ربات تلگرام
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            سفارشات مشتریان به محض ثبت در تلگرام اینجا قرار می‌گیرند. ابتدا فیش واریز را تأیید کنید، سپس با انتخاب جداگانه وضعیت پخت را تعیین و به پیک بسپارید.
          </p>
        </div>

        <div className="flex w-full sm:w-auto shrink-0 items-center justify-center gap-2 bg-slate-950/80 px-4 py-3 rounded-2xl border border-slate-800 text-slate-300 text-xs">
          <span>کل سفارشات:</span>
          <b className="text-amber-400 text-sm font-bold">{toPersianDigits(orders.length)}</b>
        </div>
      </div>

      {/* Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="جستجو: نام/یوزرنیم/آیدی تلگرام مشتری، کد سفارش یا محصول و نام کیک"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-10 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              aria-label="جستجو در سفارش‌ها"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded-md hover:bg-slate-800"
                aria-label="پاک کردن جستجو"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-400 whitespace-nowrap">
            {searchQuery ? `${toPersianDigits(filteredOrders.length)} نتیجه` : 'پشتیبانی از ارقام فارسی و عربی'}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setSelectedStatus('all')}
          className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            selectedStatus === 'all'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          همه سفارشات ({toPersianDigits(orders.length)})
        </button>

        {Object.entries(statusConfig).map(([statusKey, cfg]) => {
          const count = orders.filter((o) => o.status === statusKey).length;
          const isActive = selectedStatus === statusKey;
          return (
            <button
              key={statusKey}
              onClick={() => setSelectedStatus(statusKey)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                isActive
                  ? `${cfg.activeBg} ${cfg.activeText} border ${cfg.activeBorder} shadow-md`
                  : `${cfg.bg} ${cfg.text} border ${cfg.border} hover:opacity-80`
              }`}
            >
              <span>{cfg.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                isActive ? 'bg-white/25' : 'bg-slate-900/60'
              }`}>
                {toPersianDigits(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
          <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-base font-semibold text-slate-300">سفارشی با این فیلتر یا عبارت جستجو یافت نشد.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const currentCfg = statusConfig[order.status];
            const StatusIcon = currentCfg.icon;
            const canStartProduction = order.status === 'receipt_confirmed'
              || (order.paymentMethod === 'cash_on_delivery' && order.status === 'pending_payment');

            return (
              <div
                key={order.id}
                className="min-w-0 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-3xl p-4 sm:p-6 text-slate-100 shadow-lg transition-all space-y-5"
              >
                {/* Header Row */}
                <div className="flex flex-wrap items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                  <div className="flex min-w-0 flex-1 basis-full sm:basis-auto flex-col sm:flex-row sm:items-center gap-3">
                    <div className="w-full min-w-0 sm:w-auto sm:min-w-[178px] max-w-full min-h-14 px-3 py-2 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 border-2 border-amber-400/50 flex flex-col items-center justify-center text-white font-mono font-bold shadow-lg shadow-amber-500/20">
                      <span className="text-[10px] text-amber-100 font-sans">کد رهگیری سفارش</span>
                      <code className="text-sm sm:text-base leading-tight text-center break-all" dir="ltr">{order.orderNumber}</code>
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="min-w-0 break-words font-bold text-base text-white">{order.customerName}</h3>
                        <span className="max-w-full break-all text-xs text-slate-400 font-mono" dir="ltr">({order.customerPhone})</span>
                      </div>
                      <p className="min-w-0 text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Calendar className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                        <span className="min-w-0 break-words">ثبت شده در: {formatDatePersian(order.createdAt)}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {order.deliveryMethod === 'pickup' ? '🏪 حضوری' : '🛵 پیک'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          {order.paymentMethod === 'cash_on_delivery' ? '💵 در محل' : '💳 آنلاین'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className={`max-w-full self-start px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${currentCfg.bg} ${currentCfg.text} border ${currentCfg.border}`}>
                    <StatusIcon className="w-4 h-4" />
                    <span>{currentCfg.label}</span>
                  </div>
                </div>

                {/* Items & Address Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
                  
                  {/* Ordered Items Breakdown */}
                  <div className="min-w-0 xl:col-span-2 space-y-2.5">
                    <span className="text-xs font-semibold text-slate-400 block">
                      اقلام سفارش داده شده ({toPersianDigits(order.items.length)} قلم):
                    </span>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-2">
                      {order.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="min-w-0 bg-slate-950/70 border border-slate-800 rounded-2xl p-2.5 flex flex-wrap sm:flex-nowrap items-center gap-3"
                        >
                          <img
                            src={item.productImage}
                            alt={item.productName}
                            className="w-12 h-12 shrink-0 rounded-xl object-cover"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{item.productName}</p>
                            <p className="break-all text-[10px] text-slate-500 font-mono">کد: {item.productCode}</p>
                            <p className="text-[11px] text-slate-400">
                              {toPersianDigits(item.quantity)} {item.unit} × {formatPrice(item.price)}
                            </p>
                          </div>
                          <span className="shrink-0 text-end text-xs font-bold text-amber-400">
                            {formatPrice(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {order.notes && (
                      <div className="break-words p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                        <b>یادداشت و متن روی کیک:</b> {order.notes}
                      </div>
                    )}
                  </div>

                  {/* Delivery & Payment Details */}
                  <div className="min-w-0 bg-slate-950/70 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 text-xs text-slate-300">
                        <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <span className="min-w-0 break-words leading-relaxed">{order.customerAddress}</span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <Phone className="w-4 h-4 text-sky-400 shrink-0" />
                        <a href={`tel:${order.customerPhone}`} className="min-w-0 break-all text-sky-400 hover:underline" dir="ltr">
                          {order.customerPhone}
                        </a>
                      </div>

                      {(order.customerTelegramName || order.customerUsername || order.customerTelegramId) && (
                        <div className="space-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                          {order.customerTelegramName && (
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0 text-sky-400" /> نام تلگرام: <span className="break-words text-slate-200">{order.customerTelegramName}</span></div>
                          )}
                          {order.customerUsername && (
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0 text-sky-400" /> یوزرنیم: <span className="break-all text-sky-300" dir="ltr">@{order.customerUsername.replace(/^@/, '')}</span></div>
                          )}
                          {order.customerTelegramId && (
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0 text-sky-400" /> آیدی: <span className="break-all font-mono text-slate-300" dir="ltr">{order.customerTelegramId}</span></div>
                          )}
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-800 text-xs space-y-1">
                        <div className="flex items-start justify-between gap-3 text-slate-400">
                          <span>نحوه دریافت:</span>
                          <span className="text-white font-semibold">
                            {order.deliveryMethod === 'pickup' ? '🏪 حضوری' : '🛵 پیک'}
                          </span>
                        </div>
                        {order.deliveryRecipientName && (
                          <div className="flex items-start justify-between gap-3 text-slate-400">
                            <span>نام گیرنده/تحویل‌گیرنده:</span>
                            <span className="text-white font-semibold">📛 {order.deliveryRecipientName}</span>
                          </div>
                        )}
                        <div className="flex items-start justify-between gap-3 text-slate-400">
                          <span>نحوه پرداخت:</span>
                          <span className="text-white font-semibold">
                            {order.paymentMethod === 'cash_on_delivery' ? '💵 در محل' : '💳 آنلاین'}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3 text-slate-400">
                          <span>مجموع اقلام:</span>
                          <span>{formatPrice(order.subtotal)}</span>
                        </div>
                        <div className="flex items-start justify-between gap-3 text-slate-400">
                          <span>هزینه ارسال:</span>
                          <span>{order.shippingFee === 0 ? 'رایگان' : formatPrice(order.shippingFee)}</span>
                        </div>
                        {order.discountAmount > 0 && (
                          <div className="flex items-start justify-between gap-3 text-emerald-400">
                            <span>تخفیف ({order.couponCode}):</span>
                            <span>-{formatPrice(order.discountAmount)}</span>
                          </div>
                        )}
                        <div className="flex items-start justify-between gap-3 font-bold text-white text-sm pt-1 border-t border-slate-800">
                          <span>مبلغ کل:</span>
                          <span className="text-amber-400">{formatPrice(order.totalAmount)}</span>
                        </div>
                      </div>
                    </div>

                    {receiptImageSrc(order.paymentReceiptImage) && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveReceiptModal(order)}
                          className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          <span>مشاهده، زوم و بررسی فیش مشتری</span>
                        </button>

                        {order.receiptReviewStatus === 'rejected' && (
                          <p className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-2.5 py-2 text-[10px] leading-5 text-rose-200">فیش قبلی رد شده است؛ برای بررسی مجدد، منتظر ارسال فیش جدید از مشتری باشید.</p>
                        )}

                        {canReviewReceipt(order) && (
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              onClick={() => handleReceiptDecision(order, true)}
                              disabled={receiptDecisionLoading !== null}
                              className="py-2 px-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 text-xs font-semibold transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{receiptDecisionLoading === `${order.id}-a` ? 'در حال ثبت...' : 'تایید فیش'}</span>
                            </button>
                            <button
                              onClick={() => handleReceiptDecision(order, false)}
                              disabled={receiptDecisionLoading !== null}
                              className="py-2 px-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>{receiptDecisionLoading === `${order.id}-r` ? 'در حال ثبت...' : 'رد فیش'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </div>

                {/* Status Action Buttons */}
                <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">تغییر مرحله سفارش:</span>
                  
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canStartProduction && (
                      <button
                        onClick={() => onUpdateOrderStatus(order.id, 'baking')}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 text-xs font-semibold transition-all flex items-center gap-1"
                      >
                        <ChefHat className="w-3.5 h-3.5" />
                        <span>شروع پخت و تزیین</span>
                      </button>
                    )}

                    {order.status !== 'shipped' && (
                      <button
                        onClick={() => onUpdateOrderStatus(order.id, 'shipped')}
                        className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white border border-purple-500/40 text-xs font-semibold transition-all flex items-center gap-1"
                      >
                        <Truck className="w-3.5 h-3.5" />
                        <span>تحویل به پیک</span>
                      </button>
                    )}

                    {order.status !== 'delivered' && (
                      <button
                        onClick={() => onUpdateOrderStatus(order.id, 'delivered')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 text-xs font-semibold transition-all flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تکمیل و تحویل شد</span>
                      </button>
                    )}

                    {order.status !== 'cancelled' && (
                      <button
                        onClick={() => onUpdateOrderStatus(order.id, 'cancelled')}
                        className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold transition-all flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>لغو سفارش</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Receipt Viewer Modal */}
      {activeReceiptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl p-4 sm:p-6 text-slate-100 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white">
                فیش واریز سفارش #{activeReceiptModal.orderNumber}
              </h3>
              <button
                onClick={() => setActiveReceiptModal(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-2">
              <img
                src={receiptImageSrc(activeReceiptModal.paymentReceiptImage)}
                alt="فیش واریزی مشتری"
                className="w-full max-h-[70vh] object-contain mx-auto rounded-xl cursor-zoom-in"
                title="برای زوم تصویر کلیک کنید"
                onClick={() => {
                  const imageSource = receiptImageSrc(activeReceiptModal.paymentReceiptImage);
                  if (imageSource) setZoomedReceiptImage(imageSource);
                }}
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = 'none';
                  const parent = el.parentElement;
                  if (parent && !parent.querySelector('.receipt-error')) {
                    const msg = document.createElement('div');
                    msg.className = 'receipt-error text-slate-400 text-xs p-8 text-center';
                    msg.textContent = 'تصویر فیش در دسترس نیست — احتمالاً فیش در چت تلگرام ارسال نشده یا ربات به آن دسترسی ندارد.';
                    parent.appendChild(msg);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const imageSource = receiptImageSrc(activeReceiptModal.paymentReceiptImage);
                  if (imageSource) setZoomedReceiptImage(imageSource);
                }}
                className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-950/85 px-2.5 py-1.5 text-xs font-bold text-white border border-slate-700 hover:bg-slate-800"
                title="باز کردن ابزار زوم"
              >
                <ZoomIn className="w-3.5 h-3.5 text-sky-300" />
                زوم تصویر
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  const imageSource = receiptImageSrc(activeReceiptModal.paymentReceiptImage);
                  if (imageSource) setZoomedReceiptImage(imageSource);
                }}
                className="font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-4"
              >
                + / − بزرگ‌نمایی و کوچک‌نمایی
              </button>
              <a
                href={receiptImageSrc(activeReceiptModal.paymentReceiptImage)}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-sky-300 hover:text-sky-200 underline underline-offset-4"
              >
                باز کردن تصویر در سایز اصلی
              </a>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <p>مبلغ سفارش: <b className="text-amber-400">{formatPrice(activeReceiptModal.totalAmount)}</b></p>
              <p>نام واریز کننده: <b>{activeReceiptModal.customerName}</b></p>
            </div>

            {activeReceiptModal.receiptReviewStatus === 'rejected' && (
              <p className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs leading-5 text-rose-200">این فیش قبلاً رد شده است. تصویر برای سابقه نگه‌داری می‌شود و مشتری باید فیش جدید ارسال کند.</p>
            )}

            {canReviewReceipt(activeReceiptModal) && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleReceiptDecision(activeReceiptModal, true)}
                  disabled={receiptDecisionLoading !== null}
                  className="py-2.5 px-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{receiptDecisionLoading === `${activeReceiptModal.id}-a` ? 'در حال ثبت...' : '✅ تأیید فیش'}</span>
                </button>
                <button
                  onClick={() => handleReceiptDecision(activeReceiptModal, false)}
                  disabled={receiptDecisionLoading !== null}
                  className="py-2.5 px-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{receiptDecisionLoading === `${activeReceiptModal.id}-r` ? 'در حال ثبت...' : '❌ رد فیش'}</span>
                </button>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveReceiptModal(null)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      <ZoomableImageModal
        imageSrc={zoomedReceiptImage}
        onClose={() => setZoomedReceiptImage(null)}
        alt="فیش واریزی مشتری"
        title="بررسی فیش واریزی مشتری"
        description="برای دیدن جزئیات، بزرگ‌نمایی یا کوچک‌نمایی کنید؛ در حالت زوم می‌توانید تصویر را بکشید."
      />

    </div>
  );
};
