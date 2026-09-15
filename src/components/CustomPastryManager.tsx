import React, { useState } from 'react';
import {
  Cake,
  Sparkles,
  Clock,
  CheckCircle2,
  Check,
  XCircle,
  MessageSquare,
  DollarSign,
  Flame,
  Truck,
  Calendar,
  User,
  Phone,
  MapPin,
  AtSign,
  Hash,
  Image as ImageIcon,
  Search,
  Filter,
  Plus,
  Send,
  AlertCircle,
  Trash2,
  Scale,
  Layers,
  ChevronDown,
  Info,
  CreditCard,
  ChefHat,
  Eye
} from 'lucide-react';
import { CustomerUser, CustomPastryOrder, CustomPastryStatus, CustomPastryType } from '../types';
import { customPrepaymentStatusLabels, getCustomPrepaymentStatus } from '../utils/invoices';
import { resolveTelegramImageSource } from '../utils/telegramImage';
import { formatIranianDateTime } from '../utils/iranianDate';
import { matchesSearchValues } from '../utils/search';
import { ZoomableImageModal } from './ZoomableImageModal';

interface CustomPastryManagerProps {
  customOrders: CustomPastryOrder[];
  customers?: CustomerUser[];
  onAddCustomOrder: (order: Omit<CustomPastryOrder, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'chatMessages'>) => Promise<CustomPastryOrder>;
  onUpdateStatus: (id: string, status: CustomPastryStatus, rejectReason?: string, adminNotes?: string) => Promise<void>;
  onQuotePrice: (id: string, finalPrice: number, prepaymentAmount: number, adminNotes?: string, messageToCustomer?: string) => Promise<void>;
  onReviewPrepayment: (id: string, approved: boolean, reason?: string) => Promise<void>;
  onSendChatMessage: (orderId: string, text: string, senderName?: string) => Promise<void>;
  onDeleteOrder: (id: string) => Promise<void>;
}

export const CustomPastryManager: React.FC<CustomPastryManagerProps> = ({
  customOrders,
  customers = [],
  onAddCustomOrder,
  onUpdateStatus,
  onQuotePrice,
  onReviewPrepayment,
  onSendChatMessage,
  onDeleteOrder
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Modals & Active actions
  const [selectedOrderForQuote, setSelectedOrderForQuote] = useState<CustomPastryOrder | null>(null);
  const [quotePriceInput, setQuotePriceInput] = useState<number>(0);
  const [quotePrepaymentInput, setQuotePrepaymentInput] = useState<number>(0);
  const [quoteMessageInput, setQuoteMessageInput] = useState<string>('');
  const [quoteNotesInput, setQuoteNotesInput] = useState<string>('');

  const [selectedOrderForChat, setSelectedOrderForChat] = useState<CustomPastryOrder | null>(null);
  const [replyMessage, setReplyMessage] = useState('');

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [prepaymentReviewingId, setPrepaymentReviewingId] = useState<string | null>(null);

  // New Custom Order Form state
  const [newOrderForm, setNewOrderForm] = useState({
    customerName: '',
    customerPhone: '',
    customerTelegramId: 'admin_manual',
    pastryType: 'کیک تولد و مناسبتی' as CustomPastryType,
    weightKg: 2,
    servingCount: 15,
    tierCount: 1,
    shapeAndDesign: '',
    writingOnCake: '',
    deliveryDate: '',
    deliveryTimeSlot: '',
    deliveryAddress: '',
    estimatedPrice: 650000,
    referenceImages: ['https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80']
  });

  // Find custom orders by contact identity, Telegram profile, requested cake
  // details, and codes. This is deliberately broader than a visual card search.
  const filteredOrders = customOrders.filter((order) => {
    const linkedCustomer = customers.find((customer) =>
      String(customer.telegramId) === String(order.customerTelegramId) ||
      (order.customerPhone && customer.phone === order.customerPhone) ||
      (order.customerName && customer.name === order.customerName)
    );
    const matchesSearch = matchesSearchValues(searchTerm, [
      order.id,
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      order.customerTelegramId,
      order.customerUsername,
      order.customerTelegramName,
      linkedCustomer?.name,
      linkedCustomer?.username,
      linkedCustomer?.telegramId,
      linkedCustomer?.phone,
      order.deliveryAddress,
      order.deliveryDate,
      order.deliveryTimeSlot,
      order.pastryType,
      order.shapeAndDesign,
      order.writingOnCake,
      ...(order.chatMessages || []).flatMap((message) => [message.senderName, message.text]),
    ]);

    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesType = typeFilter === 'all' || order.pastryType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  // Calculate quick metrics
  const pendingCount = customOrders.filter(o => o.status === 'pending_review').length;
  const bakingCount = customOrders.filter(o => o.status === 'baking').length;
  const readyCount = customOrders.filter(o => o.status === 'ready' || o.status === 'approved_by_customer' || o.status === 'receipt_confirmed').length;
  const pendingPrepaymentCount = customOrders.filter(order => getCustomPrepaymentStatus(order) === 'pending_confirmation').length;
  const totalRevenue = customOrders.reduce((sum, o) => sum + (o.finalPrice || o.estimatedPrice || 0), 0);

  const getStatusBadge = (status: CustomPastryStatus) => {
    switch (status) {
      case 'pending_review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30 animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            در انتظار بررسی و قیمت‌گذاری
          </span>
        );
      case 'price_quoted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
            <DollarSign className="w-3.5 h-3.5" />
            قیمت اعلام شد (منتظر تایید)
          </span>
        );
      case 'approved_by_customer':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CreditCard className="w-3.5 h-3.5" />
            تایید مشتری / پرداخت بیعانه
          </span>
        );
      case 'receipt_confirmed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            فیش بیعانه تأیید شده — آماده شروع پخت
          </span>
        );
      case 'baking':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30">
            <ChefHat className="w-3.5 h-3.5 animate-bounce" />
            در حال پخت و تزیین در کارگاه
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
            <Cake className="w-3.5 h-3.5" />
            آماده تحویل / ارسال با پیک
          </span>
        );
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-500/15 text-teal-400 border border-teal-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            تحویل داده شد
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3.5 h-3.5" />
            رد شده / انصراف
          </span>
        );
      default:
        return null;
    }
  };

  const handleOpenQuoteModal = (order: CustomPastryOrder) => {
    setSelectedOrderForQuote(order);
    const initialPrice = order.finalPrice || order.estimatedPrice || 850000;
    setQuotePriceInput(initialPrice);
    setQuotePrepaymentInput(order.prepaymentAmount || Math.round(initialPrice * 0.4));
    setQuoteMessageInput(`سلام ${order.customerName} عزیز، طرح سفارشی شما با وزن ${order.weightKg || 2} کیلوگرم بررسی شد و امکان اجرای دقیق آن وجود دارد.`);
    setQuoteNotesInput(order.adminNotes || '');
  };

  const handleSaveQuote = async () => {
    if (!selectedOrderForQuote) return;
    await onQuotePrice(
      selectedOrderForQuote.id,
      quotePriceInput,
      quotePrepaymentInput,
      quoteNotesInput,
      quoteMessageInput
    );
    setSelectedOrderForQuote(null);
  };

  const handlePrepaymentDecision = async (order: CustomPastryOrder, approved: boolean) => {
    let reason: string | undefined;
    if (!approved) {
      const enteredReason = window.prompt('در صورت تمایل، دلیل رد فیش را برای مشتری بنویسید:');
      if (enteredReason === null) return;
      reason = enteredReason.trim() || undefined;
    }
    setPrepaymentReviewingId(order.id);
    try {
      await onReviewPrepayment(order.id, approved, reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ثبت تصمیم فیش ناموفق بود.';
      alert(message);
    } finally {
      setPrepaymentReviewingId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedOrderForChat || !replyMessage.trim()) return;
    await onSendChatMessage(selectedOrderForChat.id, replyMessage.trim());
    setReplyMessage('');
    // update local reference in modal
    const updated = customOrders.find(o => o.id === selectedOrderForChat.id);
    if (updated) {
      setSelectedOrderForChat(updated);
    }
  };

  const handleCreateNewOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderForm.customerName || !newOrderForm.customerPhone) {
      alert('لطفاً نام و شماره تماس مشتری را وارد کنید.');
      return;
    }

    await onAddCustomOrder({
      ...newOrderForm,
      // موعد تحویل (تاریخ/ساعت) دیگر از مشتری دریافت نمی‌شود.
      deliveryDate: undefined,
      deliveryTimeSlot: undefined,
      // A manual order has no real Telegram account; make its placeholder ID
      // unique so it never overwrites another manually recorded customer.
      customerTelegramId: newOrderForm.customerTelegramId === 'admin_manual'
        ? `manual-${Date.now()}`
        : newOrderForm.customerTelegramId,
      isPrepaymentPaid: false,
      prepaymentStatus: 'not_required',
      status: 'pending_review'
    });
    setShowNewOrderModal(false);
  };

  return (
    <div className="space-y-6">

      {/* Top Header & Metrics Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 p-5 sm:p-6 rounded-2xl border border-purple-900/30 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/25 ring-2 ring-white/10 shrink-0">
            <Cake className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              مدیریت سفارشات کیک و شیرینی دلخواه
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-normal">
                سفارشی‌سازی اختصاصی
              </span>
              {pendingPrepaymentCount > 0 && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-normal">
                  {pendingPrepaymentCount.toLocaleString('fa-IR')} فیش در انتظار تأیید
                </span>
              )}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              بررسی طرح‌های درخواستی مشتریان، قیمت‌گذاری بر اساس وزن و جزییات دیزاین، دریافت بیعانه و نظارت بر پخت در کارگاه
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowNewOrderModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>ثبت سفارش دلخواه جدید (دستی)</span>
        </button>
      </div>

      {/* Quick Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3 shadow">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{pendingCount}</div>
            <div className="text-xs text-slate-400">نیاز به قیمت‌گذاری قناد</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3 shadow">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/20">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{bakingCount}</div>
            <div className="text-xs text-slate-400">در حال پخت و تزیین</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3 shadow">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
            <Cake className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{readyCount}</div>
            <div className="text-xs text-slate-400">تأیید شده / آماده شروع پخت</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3 shadow">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center shrink-0 border border-purple-500/20">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold text-purple-300">{totalRevenue.toLocaleString('fa-IR')} <span className="text-xs font-normal text-slate-400">تومان</span></div>
            <div className="text-xs text-slate-400">ارزش کل سفارشات دلخواه</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl flex flex-col sm:flex-row gap-3 items-center justify-between shadow">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="نام/یوزرنیم/آیدی تلگرام، کد سفارش یا نام کیک و طرح..."
            className="w-full pl-3 pr-9 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${statusFilter === 'all' ? 'bg-purple-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
            >
              همه ({customOrders.length})
            </button>
            <button
              onClick={() => setStatusFilter('pending_review')}
              className={`px-2.5 py-1 rounded-md transition-all ${statusFilter === 'pending_review' ? 'bg-amber-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
            >
              در انتظار بررسی ({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('baking')}
              className={`px-2.5 py-1 rounded-md transition-all ${statusFilter === 'baking' ? 'bg-orange-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
            >
              در حال پخت ({bakingCount})
            </button>
            <button
              onClick={() => setStatusFilter('delivered')}
              className={`px-2.5 py-1 rounded-md transition-all ${statusFilter === 'delivered' ? 'bg-teal-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
            >
              تحویل شده
            </button>
          </div>
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6">
          <Cake className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-300">هیچ سفارش کیک یا شیرینی دلخواهی یافت نشد</h3>
          <p className="text-xs text-slate-500 mt-1">
            مشتریان می‌توانند از طریق ربات تلگرام با کلیک بر روی «سفارش کیک/شیرینی دلخواه» طرح خود را ارسال کنند.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map(order => {
            const referenceImageSources = (order.referenceImages || [])
              .map((imageReference) => resolveTelegramImageSource(imageReference))
              .filter((imageSource): imageSource is string => Boolean(imageSource));
            const receiptImageSource = resolveTelegramImageSource(order.paymentReceiptImage);
            const hasImages = referenceImageSources.length > 0;
            const isPending = order.status === 'pending_review';
            const prepaymentStatus = getCustomPrepaymentStatus(order);
            const isPrepaymentPending = prepaymentStatus === 'pending_confirmation';
            // New receipt approvals land in `receipt_confirmed`. Keep the
            // older approved_by_customer + approved combination actionable so
            // historic, already-verified orders are not stranded.
            const canStartProduction = (
              (order.status === 'receipt_confirmed' && prepaymentStatus === 'approved')
              || (order.status === 'approved_by_customer' && prepaymentStatus === 'approved')
              || (order.status === 'approved_by_customer' && prepaymentStatus === 'not_required' && order.paymentMethod === 'cash_on_delivery')
            );

            return (
              <div
                key={order.id}
                className={`rounded-2xl border transition-all p-5 shadow-lg ${
                  isPending
                    ? 'bg-slate-900 border-amber-500/40 ring-1 ring-amber-500/20'
                    : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono font-bold text-purple-300">
                      {order.orderNumber}
                    </div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-white text-base">{order.customerName}</h4>
                      {order.customerPhone && (
                        <a href={`tel:${order.customerPhone}`} className="text-xs text-slate-400 hover:text-sky-400 flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          <span>{order.customerPhone}</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {getStatusBadge(order.status)}
                    {isPrepaymentPending && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-200">
                        <Clock className="h-3.5 w-3.5" />
                        فیش در انتظار تأیید ادمین
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {formatIranianDateTime(order.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Customer identity and delivery details are persisted as the bot
                    collects them, so the workshop can act on the actual request. */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  <section className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-4 text-xs">
                    <h5 className="mb-3 flex items-center gap-1.5 font-bold text-sky-300">
                      <User className="h-4 w-4" />
                      مشخصات مشتری
                    </h5>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <span className="block text-[10px] text-slate-500">نام ثبت‌شده</span>
                        <span className="font-semibold text-white">{order.customerName || 'هنوز ثبت نشده'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">نام تلگرام</span>
                        <span className="font-semibold text-slate-200">{order.customerTelegramName || 'در دسترس نیست'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">یوزرنیم تلگرام</span>
                        <span className="font-semibold text-sky-300" dir="ltr">{order.customerUsername ? `@${order.customerUsername.replace(/^@/, '')}` : '---'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">آیدی تلگرام</span>
                        <span className="font-mono font-semibold text-slate-200" dir="ltr">{order.customerTelegramId || '---'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">شماره تماس</span>
                        {order.customerPhone ? (
                          <a href={`tel:${order.customerPhone}`} className="font-semibold text-sky-300 hover:underline" dir="ltr">{order.customerPhone}</a>
                        ) : <span className="text-slate-400">هنوز ثبت نشده</span>}
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">زمان ثبت اولیه (ایران)</span>
                        <span className="font-semibold text-slate-200">{formatIranianDateTime(order.createdAt)}</span>
                      </div>
                    </div>
                    <div className="mt-3 border-t border-sky-900/40 pt-2">
                      <span className="flex items-center gap-1 text-[10px] text-slate-500"><MapPin className="h-3 w-3" /> آدرس تحویل</span>
                      <p className="mt-1 leading-relaxed text-slate-200">{order.deliveryAddress || 'هنوز توسط مشتری ثبت نشده'}</p>
                    </div>
                  </section>

                  <section className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs">
                    <h5 className="mb-3 flex items-center gap-1.5 font-bold text-indigo-300">
                      <Calendar className="h-4 w-4" />
                      زمان تحویل
                    </h5>
                    <p className="leading-relaxed text-slate-300">
                      زمان دقیق تحویل در ربات دریافت نمی‌شود؛ پس از تأیید سفارش و شروع پخت، موعد تحویل به‌صورت تلفنی یا در گفتگوی پشتیبانی با مشتری هماهنگ می‌شود.
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Hash className="h-3.5 w-3.5 text-indigo-400" />
                      <span>نوع تحویل: {order.deliveryType === 'pickup' ? 'دریافت حضوری' : 'ارسال به آدرس مشتری'}</span>
                    </div>
                  </section>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-4">

                  {/* Column 1: Pastry Specifications */}
                  <div className="space-y-2.5 text-xs text-slate-300 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-purple-400 flex items-center gap-1.5 mb-2 text-sm">
                      <Cake className="w-4 h-4" />
                      <span>{order.pastryType}</span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-800/50 pb-1.5">
                      <span className="text-slate-400">وزن / تعداد سرو:</span>
                      <span className="font-medium text-white">
                        {order.weightKg ? `${order.weightKg} کیلوگرم` : ''} {order.servingCount ? `(${order.servingCount} نفر)` : ''}
                      </span>
                    </div>

                    {order.tierCount && order.tierCount > 1 && (
                      <div className="flex items-center justify-between border-b border-slate-800/50 pb-1.5">
                        <span className="text-slate-400">تعداد طبقات کیک:</span>
                        <span className="font-medium text-purple-300">{order.tierCount} طبقه</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-sky-400" />
                        موعد تحویل:
                      </span>
                      <span className="font-bold text-sky-300">هماهنگ تلفنی پس از تأیید</span>
                    </div>
                  </div>

                  {/* Column 2: Design & Writing */}
                  <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-1">
                        <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                        توضیحات و ایده دیزاین مشتری:
                      </span>
                      <p className="text-xs text-slate-200 bg-slate-900 p-2.5 rounded-lg border border-slate-800 leading-relaxed max-h-24 overflow-y-auto">
                        {order.shapeAndDesign || 'طرح و شکل استاندارد قنادی طبق توافق'}
                      </p>
                    </div>

                    {order.writingOnCake && (
                      <div>
                        <span className="text-xs font-semibold text-slate-400 mb-1 block">✍️ متن روی کیک یا روبان:</span>
                        <div className="text-xs text-pink-300 bg-pink-950/30 border border-pink-900/40 px-3 py-1.5 rounded-lg font-medium">
                          «{order.writingOnCake}»
                        </div>
                      </div>
                    )}

                    {/* Reference Images Thumbnails */}
                    {hasImages && (
                      <div>
                        <span className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5" />
                          عکس‌های ارسالی مشتری ({referenceImageSources.length}):
                        </span>
                        <div className="flex items-center gap-2 overflow-x-auto pb-1">
                          {referenceImageSources.map((imageSource, idx) => (
                            <button
                              key={`${order.id}-reference-${idx}`}
                              type="button"
                              onClick={() => setPreviewImage(imageSource)}
                              className="relative group w-14 h-14 rounded-lg overflow-hidden border border-slate-700 hover:border-purple-500 shrink-0 transition-all cursor-pointer"
                              title="مشاهده و زوم تصویر"
                            >
                              <img
                                src={imageSource}
                                alt={`نمونه ${idx + 1}`}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Eye className="w-4 h-4 text-white" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Payment Receipt Image */}
                    {receiptImageSource && (
                      <div>
                        <span className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                          <CreditCard className="w-3.5 h-3.5" />
                          فیش واریزی بیعانه:
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewImage(receiptImageSource)}
                          className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-700 hover:border-emerald-500 shrink-0 transition-all cursor-pointer"
                          title="مشاهده و زوم فیش واریزی"
                        >
                          <img
                            src={receiptImageSource}
                            alt="فیش واریزی"
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-4 h-4 text-white" />
                          </div>
                        </button>
                        <div className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] ${
                          prepaymentStatus === 'approved'
                            ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                            : prepaymentStatus === 'pending_confirmation'
                              ? 'border-amber-700/60 bg-amber-950/30 text-amber-200'
                              : prepaymentStatus === 'rejected'
                                ? 'border-rose-800/60 bg-rose-950/30 text-rose-300'
                                : 'border-slate-700 bg-slate-900/70 text-slate-300'
                        }`}>
                          <p className="flex items-center gap-1 font-semibold">
                            {prepaymentStatus === 'approved' ? <Check className="h-3.5 w-3.5" /> : prepaymentStatus === 'pending_confirmation' ? <Clock className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                            {customPrepaymentStatusLabels[prepaymentStatus]}
                          </p>
                          {prepaymentStatus === 'rejected' && order.prepaymentRejectReason && (
                            <p className="mt-1 leading-relaxed text-rose-200">دلیل رد: {order.prepaymentRejectReason}</p>
                          )}
                        </div>
                        {isPrepaymentPending && (
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              disabled={prepaymentReviewingId === order.id}
                              onClick={() => void handlePrepaymentDecision(order, true)}
                              className="flex items-center justify-center gap-1 rounded-lg border border-emerald-700/60 bg-emerald-600/20 px-2 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              تأیید فیش
                            </button>
                            <button
                              type="button"
                              disabled={prepaymentReviewingId === order.id}
                              onClick={() => void handlePrepaymentDecision(order, false)}
                              className="flex items-center justify-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/40 px-2 py-1.5 text-[11px] font-bold text-rose-200 transition hover:bg-rose-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              رد فیش
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Column 3: Pricing & Actions */}
                  <div className="flex flex-col justify-between bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">قیمت تخمینی سیستم:</span>
                        <span className="text-slate-300">{(order.estimatedPrice || 0).toLocaleString('fa-IR')} تومان</span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 font-bold">مبلغ نهایی تایید شده:</span>
                        <span className="text-base font-black text-emerald-400">
                          {order.finalPrice ? `${order.finalPrice.toLocaleString('fa-IR')} تومان` : 'هنوز قیمت‌گذاری نشده'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs border-t border-slate-800 pt-1.5">
                        <span className="text-slate-400">مبلغ بیعانه:</span>
                        <span className="font-semibold text-purple-300">
                          {order.prepaymentAmount ? `${order.prepaymentAmount.toLocaleString('fa-IR')} تومان` : 'تعیین نشده'}
                        </span>
                      </div>

                      <div className={`flex items-center gap-1.5 text-xs border p-2 rounded-lg ${
                        prepaymentStatus === 'approved'
                          ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/40'
                          : prepaymentStatus === 'pending_confirmation'
                            ? 'text-amber-300 bg-amber-950/30 border-amber-900/40'
                            : prepaymentStatus === 'rejected'
                              ? 'text-rose-300 bg-rose-950/30 border-rose-900/40'
                              : 'text-slate-300 bg-slate-900/50 border-slate-800'
                      }`}>
                        {prepaymentStatus === 'approved' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : prepaymentStatus === 'pending_confirmation' ? <Clock className="w-4 h-4 shrink-0" /> : <CreditCard className="w-4 h-4 shrink-0" />}
                        <span>{customPrepaymentStatusLabels[prepaymentStatus]}</span>
                      </div>
                      {isPrepaymentPending && (
                        <p className="text-[10px] leading-relaxed text-amber-300">فیش دریافت شده است؛ قبل از شروع پخت، آن را از بخش «فیش واریزی بیعانه» تأیید یا رد کنید.</p>
                      )}
                      {prepaymentStatus === 'rejected' && order.prepaymentRejectReason && (
                        <p className="text-[10px] leading-relaxed text-rose-300">دلیل اعلام‌شده به مشتری: {order.prepaymentRejectReason}</p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-2 pt-2 border-t border-slate-800">

                      {/* Price Quote button */}
                      <button
                        onClick={() => handleOpenQuoteModal(order)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white text-xs font-bold shadow transition-all cursor-pointer"
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>{order.finalPrice ? 'ویرایش قیمت و بیعانه' : 'بررسی و اعلام قیمت به مشتری'}</span>
                      </button>

                      {/* State Workflow Quick Actions */}
                      <div className="grid grid-cols-2 gap-1.5">
                        {canStartProduction && (
                          <button
                            onClick={() => void onUpdateStatus(order.id, 'baking').catch((error) => alert(error instanceof Error ? error.message : 'تغییر وضعیت ناموفق بود.'))}
                            className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-orange-600/20 hover:bg-orange-600 text-orange-300 hover:text-white border border-orange-500/30 text-xs font-medium transition-all"
                            title="انتقال به بخش پخت و تزیین"
                          >
                            <ChefHat className="w-3.5 h-3.5" />
                            <span>شروع پخت 👨‍🍳</span>
                          </button>
                        )}

                        {order.status === 'baking' && (
                          <button
                            onClick={() => void onUpdateStatus(order.id, 'ready').catch((error) => alert(error instanceof Error ? error.message : 'تغییر وضعیت ناموفق بود.'))}
                            className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-medium transition-all"
                          >
                            <Cake className="w-3.5 h-3.5" />
                            <span>آماده تحویل 🎂</span>
                          </button>
                        )}

                        {order.status === 'ready' && (
                          <button
                            onClick={() => void onUpdateStatus(order.id, 'delivered').catch((error) => alert(error instanceof Error ? error.message : 'تغییر وضعیت ناموفق بود.'))}
                            className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600 text-teal-300 hover:text-white border border-teal-500/30 text-xs font-medium transition-all"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>تحویل شد 🎉</span>
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedOrderForChat(order)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                          <span>چت و پیام ({order.chatMessages?.length || 0})</span>
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`آیا از حذف سفارش ${order.orderNumber} اطمینان دارید؟`)) {
                              onDeleteOrder(order.id);
                            }
                          }}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 text-rose-400 hover:text-white border border-rose-900/50 text-xs transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>حذف</span>
                        </button>
                      </div>

                    </div>
                  </div>

                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Quote Price Modal */}
      {selectedOrderForQuote && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">اعلام قیمت و بیعانه</h3>
                  <p className="text-xs text-slate-400">سفارش {selectedOrderForQuote.orderNumber} ({selectedOrderForQuote.customerName})</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedOrderForQuote(null)}
                className="text-slate-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  مبلغ کل سفارش (تومان):
                </label>
                <input
                  type="number"
                  value={quotePriceInput}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setQuotePriceInput(val);
                    setQuotePrepaymentInput(Math.round(val * 0.4));
                  }}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-bold text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  مبلغ بیعانه پیش‌پرداخت (تومان) - پیشنهاد ۴۰٪:
                </label>
                <input
                  type="number"
                  value={quotePrepaymentInput}
                  onChange={(e) => setQuotePrepaymentInput(Number(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-amber-400 font-bold text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  پیام توضیحی برای مشتری در تلگرام:
                </label>
                <textarea
                  rows={3}
                  value={quoteMessageInput}
                  onChange={(e) => setQuoteMessageInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  یادداشت داخلی قناد (فقط مدیران می‌بینند):
                </label>
                <input
                  type="text"
                  value={quoteNotesInput}
                  onChange={(e) => setQuoteNotesInput(e.target.value)}
                  placeholder="مثال: فوندانت آبی متالیک آماده شود"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedOrderForQuote(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleSaveQuote}
                className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-600/30"
              >
                تایید و ارسال قیمت به مشتری 🚀
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat & Consultation Modal */}
      {selectedOrderForChat && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col h-[520px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="font-bold text-white text-sm">پیام‌های سفارش {selectedOrderForChat.orderNumber}</h3>
                  <p className="text-xs text-slate-400">مشتری: {selectedOrderForChat.customerName}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedOrderForChat(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Chat Box Body */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2.5 text-xs">
              {(!selectedOrderForChat.chatMessages || selectedOrderForChat.chatMessages.length === 0) ? (
                <div className="text-center py-10 text-slate-500">
                  هنوز پیامی بین قناد و مشتری ردوبدل نشده است.
                </div>
              ) : (
                selectedOrderForChat.chatMessages.map(msg => {
                  const isAdmin = msg.sender === 'admin';
                  const imageSource = resolveTelegramImageSource(msg.photo);
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[85%] rounded-2xl p-3 ${
                        isAdmin
                          ? 'mr-auto bg-purple-950/60 border border-purple-800/40 text-purple-100 rounded-bl-none'
                          : 'ml-auto bg-slate-800 text-slate-200 rounded-br-none'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400 mb-1">
                        <span className="font-bold text-amber-400">{msg.senderName}</span>
                        <span>{new Date(msg.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {msg.text && <p className="leading-relaxed">{msg.text}</p>}
                      {imageSource && (
                        <button
                          type="button"
                          onClick={() => setPreviewImage(imageSource)}
                          className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40 text-right"
                          title="مشاهده و زوم تصویر"
                        >
                          <img
                            src={imageSource}
                            alt={`تصویر ارسالی ${msg.senderName}`}
                            className="max-h-52 max-w-full object-contain"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Send Reply Input */}
            <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="پیام سرقناد به مشتری..."
                className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={handleSendMessage}
                className="p-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow transition-all cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <ZoomableImageModal
        imageSrc={previewImage}
        onClose={() => setPreviewImage(null)}
        alt="تصویر ارسالی مشتری برای سفارش دلخواه"
        title="تصویر ارسالی مشتری"
        description="برای بررسی جزئیات طرح یا فیش، از بزرگ‌نمایی و کوچک‌نمایی استفاده کنید."
      />

      {/* New Custom Order Manual Modal */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateNewOrderSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8 animate-in fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Cake className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-white text-base">ثبت سفارش کیک/شیرینی دلخواه به صورت دستی</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">نام خریدار / مشتری:</label>
                <input
                  type="text"
                  required
                  value={newOrderForm.customerName}
                  onChange={(e) => setNewOrderForm({ ...newOrderForm, customerName: e.target.value })}
                  placeholder="مثال: مریم کریمی"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">شماره تماس همراه:</label>
                <input
                  type="tel"
                  required
                  value={newOrderForm.customerPhone}
                  onChange={(e) => setNewOrderForm({ ...newOrderForm, customerPhone: e.target.value })}
                  placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">نوع شیرینی/کیک:</label>
                <select
                  value={newOrderForm.pastryType}
                  onChange={(e) => setNewOrderForm({ ...newOrderForm, pastryType: e.target.value as CustomPastryType })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="کیک تولد و مناسبتی">کیک تولد و مناسبتی</option>
                  <option value="شیرینی تر اختصاصی">شیرینی تر اختصاصی</option>
                  <option value="کوکی و کاپ‌کیک سفارشی">کوکی و کاپ‌کیک سفارشی</option>
                  <option value="شیرینی خشک و سنتی مجلسی">شیرینی خشک و سنتی مجلسی</option>
                  <option value="دسر اختصاصی">دسر اختصاصی</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">وزن تقریبی (کیلوگرم):</label>
                <input
                  type="number"
                  step="0.5"
                  value={newOrderForm.weightKg}
                  onChange={(e) => setNewOrderForm({ ...newOrderForm, weightKg: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-semibold mb-1">آدرس دقیق تحویل:</label>
                <textarea
                  rows={2}
                  required
                  value={newOrderForm.deliveryAddress}
                  onChange={(e) => setNewOrderForm({ ...newOrderForm, deliveryAddress: e.target.value })}
                  placeholder="شهر، خیابان، کوچه، پلاک و واحد"
                  className="w-full resize-none px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-300 font-semibold mb-1">توضیحات طرح و دیزاین:</label>
              <textarea
                rows={2}
                value={newOrderForm.shapeAndDesign}
                onChange={(e) => setNewOrderForm({ ...newOrderForm, shapeAndDesign: e.target.value })}
                placeholder="تزیین با گلهای طبیعی، رنگ پاستلی صورتی و تم تولد..."
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="text-xs">
              <label className="block text-slate-300 font-semibold mb-1">متن روی کیک:</label>
              <input
                type="text"
                value={newOrderForm.writingOnCake}
                onChange={(e) => setNewOrderForm({ ...newOrderForm, writingOnCake: e.target.value })}
                placeholder="تولدت مبارک عزیز دلم..."
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-pink-300 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/30"
              >
                ثبت و ایجاد سفارش دلخواه ✨
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};
