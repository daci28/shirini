import React, { useState } from 'react';
import { 
  Headphones, 
  MessageSquare, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Send, 
  Phone, 
  User, 
  Calendar, 
  Sparkles, 
  X, 
  Trash2, 
  RefreshCw,
  ChevronLeft,
  Flame,
  Check,
  Plus
} from 'lucide-react';
import { SupportTicket, TicketStatus, SupportCategory, BotSettings, Order, CustomPastryOrder } from '../types';
import { resolveTelegramImageSource } from '../utils/telegramImage';
import { matchesSearchValues } from '../utils/search';
import { ZoomableImageModal } from './ZoomableImageModal';

interface SupportManagerProps {
  tickets: SupportTicket[];
  orders?: Order[];
  customOrders?: CustomPastryOrder[];
  botSettings: BotSettings;
  onAddTicket: (ticket: Omit<SupportTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'replies'>) => Promise<SupportTicket>;
  onReplyTicket: (ticketId: string, replyText: string, senderName?: string) => Promise<void>;
  onUpdateTicketStatus: (ticketId: string, status: TicketStatus, priority?: 'low' | 'normal' | 'high') => Promise<void>;
  onDeleteTicket: (ticketId: string) => Promise<void>;
}

/** Backwards-compatible named export used by ticket image consumers/tests. */
export const getTicketImageSource = resolveTelegramImageSource;

interface TicketImageAttachmentProps {
  imageSource: string;
  sender: 'customer' | 'admin';
  senderName: string;
  onPreview: (imageSource: string) => void;
}

/** Keeps first-ticket images and follow-up reply images visually identical. */
const TicketImageAttachment: React.FC<TicketImageAttachmentProps> = ({
  imageSource,
  sender,
  senderName,
  onPreview,
}) => {
  const isAdmin = sender === 'admin';

  return (
    <div className="mt-2.5 space-y-1.5">
      <span className={`block text-[10px] font-bold ${isAdmin ? 'text-purple-200' : 'text-sky-300'}`}>
        📷 تصویر ارسالی {isAdmin ? 'مدیریت' : 'مشتری'}
      </span>
      <button
        type="button"
        onClick={() => onPreview(imageSource)}
        className="block overflow-hidden rounded-xl border border-white/10 bg-slate-950/50 hover:opacity-90 transition-opacity"
        title="مشاهده و زوم تصویر"
      >
        <img
          src={imageSource}
          alt={`تصویر ارسالی ${senderName}`}
          className="max-h-64 max-w-full object-contain bg-slate-900"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </button>
      <p className="text-[10px] text-slate-400">برای زوم و مشاهده کامل تصویر کلیک کنید</p>
    </div>
  );
};

const getLegacyReplyImage = (text?: string): string | undefined => {
  return text?.match(/\[تصویر\]\((https?:\/\/[^\s)]+)\)/i)?.[1];
};

const getReplyDisplayText = (text?: string): string => {
  return (text || '')
    .replace(/\s*\[تصویر\]\(https?:\/\/[^\s)]+\)\s*/gi, '\n')
    .trim();
};

export const SupportManager: React.FC<SupportManagerProps> = ({
  tickets,
  orders = [],
  customOrders = [],
  botSettings,
  onAddTicket,
  onReplyTicket,
  onUpdateTicketStatus,
  onDeleteTicket,
}) => {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(tickets[0]?.id || null);
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | SupportCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [replyInput, setReplyInput] = useState<string>('');
  const [isSendingReply, setIsSendingReply] = useState<boolean>(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // New ticket form state
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerTelegramId, setNewCustomerTelegramId] = useState('');
  const [newCategory, setNewCategory] = useState<SupportCategory>('custom_cake');
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [newOrderNumber, setNewOrderNumber] = useState('');
  const [newCakePhoto, setNewCakePhoto] = useState('');

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || null;

  // Filter tickets by the complete customer identity and by linked order
  // product/code information, including older orders saved before profile fields.
  const filteredTickets = tickets.filter((ticket) => {
    if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && ticket.category !== categoryFilter) return false;

    const linkedOrders = orders.filter((order) =>
      (ticket.orderNumber && order.orderNumber === ticket.orderNumber) ||
      (ticket.customerTelegramId && String(order.customerTelegramId) === String(ticket.customerTelegramId)) ||
      (ticket.customerPhone && order.customerPhone === ticket.customerPhone)
    );
    const linkedCustomOrders = customOrders.filter((order) =>
      (ticket.orderNumber && order.orderNumber === ticket.orderNumber) ||
      (ticket.customerTelegramId && String(order.customerTelegramId) === String(ticket.customerTelegramId)) ||
      (ticket.customerPhone && order.customerPhone === ticket.customerPhone)
    );

    return matchesSearchValues(searchQuery, [
      ticket.ticketNumber,
      ticket.customerName,
      ticket.customerTelegramId,
      ticket.customerUsername,
      ticket.customerPhone,
      ticket.orderNumber,
      ticket.subject,
      ticket.message,
      ticket.category,
      ...(ticket.replies || []).flatMap((reply) => [reply.senderName, reply.text]),
      ...linkedOrders.flatMap((order) => [
        order.orderNumber,
        order.customerUsername,
        order.customerTelegramName,
        ...(order.items || []).flatMap((item) => [item.productName, item.productCode]),
      ]),
      ...linkedCustomOrders.flatMap((order) => [
        order.orderNumber,
        order.customerUsername,
        order.customerTelegramName,
        order.pastryType,
        order.shapeAndDesign,
        order.writingOnCake,
      ]),
    ]);
  });

  // Quick canned responses
  const QUICK_CANNED_REPLIES = [
    {
      label: '🎂 تایید اجرای کیک سفارشی',
      text: 'سلام و درود، طرح کیک ارسالی شما توسط سرآشپز بررسی شد و طبق مشخصات و وزن درخواستی شما کاملاً قابل اجراست. تاریخ تحویل شما در تقویم پخت قنادی ثبت گردید.',
    },
    {
      label: '🛵 تحویل سفارش به پیک',
      text: 'سلام، سفارش شما بسته‌بندی و تحویل پیک مخصوص حمل کیک گردید و ظرف مدت ۳۰ الی ۴۵ دقیقه آینده به آدرس شما تحویل داده خواهد شد.',
    },
    {
      label: '💳 تایید فیش بانکی',
      text: 'سلام و احترام، فیش واریزی شما توسط واحد مالی تایید گردید و فاکتور نهایی سفارش شما صادر شد.',
    },
    {
      label: '👨‍🍳 در حال تزئین و آماده‌سازی',
      text: 'سلام وقت بخیر، سفارش شما هم‌اکنون در بخش تزئین و خامه کشی قنادی قرار دارد و با بالاترین کیفیت آماده خواهد شد.',
    },
    {
      label: '🌱 مشاوره شیرینی رژیمی',
      text: 'سلام، کلیه شیرینی‌های خشک و جو دوسر ما با شیره توت و استویای طبیعی پخته شده و کاملاً مناسب رژیم‌های بدون قند و افراد دیابتی می‌باشد.',
    },
  ];

  const handleSendReply = async () => {
    if (!selectedTicket || !replyInput.trim() || isSendingReply) return;
    setIsSendingReply(true);
    try {
      await onReplyTicket(selectedTicket.id, replyInput.trim(), 'مدیریت قنادی شیرین‌کام');
      setReplyInput('');
    } catch (e) {
      console.error('Failed to send reply:', e);
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleApplyCannedReply = (text: string) => {
    setReplyInput(text);
  };

  const handleCreateNewTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName || !newSubject || !newMessage) return;

    try {
      const created = await onAddTicket({
        customerName: newCustomerName,
        customerTelegramId: newCustomerTelegramId || 'manual-admin',
        customerPhone: newCustomerPhone || undefined,
        category: newCategory,
        subject: newSubject,
        message: newMessage,
        status: 'open',
        priority: 'normal',
        orderNumber: newOrderNumber || undefined,
        cakePhoto: newCakePhoto || undefined,
      });

      setShowNewTicketModal(false);
      setSelectedTicketId(created.id);

      // Reset form
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerTelegramId('');
      setNewSubject('');
      setNewMessage('');
      setNewOrderNumber('');
      setNewCakePhoto('');
    } catch (err) {
      console.error('Failed to create ticket:', err);
    }
  };

  const getStatusBadge = (status: TicketStatus) => {
    switch (status) {
      case 'open':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-400" />
            در انتظار پاسخ
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
            در حال پیگیری
          </span>
        );
      case 'answered':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            پاسخ داده شده
          </span>
        );
      case 'closed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
            بسته شده
          </span>
        );
    }
  };

  const getCategoryBadge = (category: SupportCategory) => {
    switch (category) {
      case 'custom_cake':
        return <span className="text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded text-[11px] font-bold border border-pink-500/20">🎂 کیک سفارشی</span>;
      case 'order_inquiry':
        return <span className="text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded text-[11px] font-bold border border-sky-500/20">📦 پیگیری سفارش</span>;
      case 'payment_issue':
        return <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-500/20">💳 فیش و واریزی</span>;
      case 'feedback':
        return <span className="text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded text-[11px] font-bold border border-purple-500/20">⭐ نظر و انتقاد</span>;
      case 'consultation':
        return <span className="text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded text-[11px] font-bold border border-teal-500/20">💡 مشاوره خرید</span>;
      default:
        return <span className="text-slate-400 bg-slate-800 px-2 py-0.5 rounded text-[11px] font-bold">💬 پیام عمومی</span>;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Stats */}
      <div className="bg-gradient-to-r from-purple-900/50 via-slate-900 to-sky-900/50 border border-purple-500/30 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-sky-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/25 shrink-0">
              <Headphones className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">مرکز پشتیبانی، تیکت‌ها و سفارشات کیک اختصاصی</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  اتصال زنده به تلگرام
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                پاسخ مستقیم به پیام‌ها، سوالات، هماهنگی طرح کیک تولد و پیگیری سفارشات خریداران از بات تلگرام
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowNewTicketModal(true)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition-all flex items-center justify-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>ثبت تیکت / پیام جدید</span>
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
            <span className="text-[11px] text-slate-400 block">کل تیکت‌ها</span>
            <span className="text-lg font-bold text-white mt-0.5 block">{tickets.length} تیکت</span>
          </div>
          <div className="bg-amber-950/20 p-3 rounded-xl border border-amber-500/30">
            <span className="text-[11px] text-amber-300 block">در انتظار پاسخ</span>
            <span className="text-lg font-bold text-amber-400 mt-0.5 block">
              {tickets.filter((t) => t.status === 'open').length} پیام
            </span>
          </div>
          <div className="bg-pink-950/20 p-3 rounded-xl border border-pink-500/30">
            <span className="text-[11px] text-pink-300 block">سفارش کیک سفارشی</span>
            <span className="text-lg font-bold text-pink-400 mt-0.5 block">
              {tickets.filter((t) => t.category === 'custom_cake').length} طرح
            </span>
          </div>
          <div className="bg-emerald-950/20 p-3 rounded-xl border border-emerald-500/30">
            <span className="text-[11px] text-emerald-300 block">پاسخ‌داده شده</span>
            <span className="text-lg font-bold text-emerald-400 mt-0.5 block">
              {tickets.filter((t) => t.status === 'answered' || t.status === 'closed').length} تیکت
            </span>
          </div>
        </div>
      </div>

      {/* Main Support Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Tickets List & Filters */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Search & Filter Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="نام/یوزرنیم/آیدی تلگرام، کد تیکت/سفارش/محصول یا نام کیک..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
            </div>

            {/* Status Pills */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                همه ({tickets.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('open')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === 'open' ? 'bg-amber-600 text-white' : 'bg-slate-950 text-amber-400/80 hover:text-amber-300'
                }`}
              >
                در انتظار ({tickets.filter((t) => t.status === 'open').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('answered')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === 'answered' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-emerald-400/80 hover:text-emerald-300'
                }`}
              >
                پاسخ داده شده
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('closed')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === 'closed' ? 'bg-slate-700 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                بسته شده
              </button>
            </div>
          </div>

          {/* Tickets List */}
          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1 scrollbar-thin">
            {filteredTickets.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
                <MessageSquare className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                <p className="text-xs">تیکتی با فیلترهای انتخابی یافت نشد.</p>
              </div>
            ) : (
              filteredTickets.map((ticket) => {
                const isSelected = selectedTicketId === ticket.id;
                return (
                  <div
                    key={ticket.id}
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`p-3.5 rounded-2xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-gradient-to-r from-purple-950/40 to-slate-900 border-purple-500/60 shadow-lg ring-1 ring-purple-500/30'
                        : 'bg-slate-900/80 hover:bg-slate-900 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-purple-400">
                          {ticket.ticketNumber}
                        </span>
                        <div className="min-w-0">
                          <h4 className="font-bold text-xs text-white truncate max-w-[160px]">
                            {ticket.customerName}
                          </h4>
                          {ticket.customerUsername && (
                            <span className="block mt-0.5 text-[10px] text-sky-300 truncate max-w-[160px]">
                              @{ticket.customerUsername.replace(/^@/, '')}
                            </span>
                          )}
                        </div>
                      </div>
                      {getStatusBadge(ticket.status)}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      {getCategoryBadge(ticket.category)}
                      {ticket.orderNumber && (
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          {ticket.orderNumber}
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-medium text-slate-300 mt-2 line-clamp-1">
                      {ticket.subject}
                    </p>

                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {ticket.message}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                      <span>{new Date(ticket.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="flex items-center gap-1 text-slate-400">
                        <MessageSquare className="w-3 h-3 text-purple-400" />
                        <span>{ticket.replies.length} پیام</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Ticket Conversation Thread */}
        <div className="lg:col-span-7">
          {selectedTicket ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col h-[740px]">
              
              {/* Header */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/40 rounded-t-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center font-bold text-sm">
                    {selectedTicket.customerName.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-sm">
                        {selectedTicket.customerName}
                      </h3>
                      <span className="font-mono text-xs text-purple-400 font-bold">
                        ({selectedTicket.ticketNumber})
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-0.5">
                      {selectedTicket.customerUsername && (
                        <span className="text-sky-300">@{selectedTicket.customerUsername.replace(/^@/, '')}</span>
                      )}
                      {selectedTicket.customerTelegramId && selectedTicket.customerTelegramId !== 'guest' && selectedTicket.customerTelegramId !== 'manual-admin' && (
                        <span className="flex items-center gap-1" title="شناسه تلگرام مشتری">
                          <User className="w-3 h-3 text-slate-400" />
                          <span className="font-mono" dir="ltr">ID: {selectedTicket.customerTelegramId}</span>
                        </span>
                      )}
                      {selectedTicket.customerPhone && (
                        <span className="flex items-center gap-1" title="شماره تلفن ثبت‌شده در پروفایل یا سفارش">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span className="font-mono" dir="ltr">{selectedTicket.customerPhone}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Changer */}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => onUpdateTicketStatus(selectedTicket.id, e.target.value as TicketStatus)}
                    className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-purple-500"
                  >
                    <option value="open">⏳ در انتظار پاسخ</option>
                    <option value="in_progress">⚙️ در حال پیگیری</option>
                    <option value="answered">✅ پاسخ داده شده</option>
                    <option value="closed">🔒 بسته شده</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => onDeleteTicket(selectedTicket.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                    title="حذف تیکت"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Ticket Meta Info Bar */}
              <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-300">موضوع:</span>
                  <span className="text-white font-medium">{selectedTicket.subject}</span>
                </div>
                {selectedTicket.orderNumber && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">سفارش مرتبط:</span>
                    <span className="font-mono text-purple-400 font-bold bg-purple-950/40 px-2 py-0.5 rounded border border-purple-500/30">
                      {selectedTicket.orderNumber}
                    </span>
                  </div>
                )}
              </div>

              {/* Chat Thread Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-950/30 scrollbar-thin">
                
                {/* Initial customer message: any attached photo stays inside the
                    same message bubble as its text, just like later replies. */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-xs shrink-0">
                    👤
                  </div>
                  <div className="max-w-[85%] bg-slate-800/90 text-slate-100 p-3.5 rounded-2xl rounded-tr-none text-xs leading-relaxed border border-slate-700/60 shadow">
                    <div className="flex items-center justify-between gap-4 mb-1 text-[10px] text-slate-400">
                      <span className="font-bold text-purple-300">{selectedTicket.customerName}</span>
                      <span>{new Date(selectedTicket.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {selectedTicket.message && <p className="whitespace-pre-line">{selectedTicket.message}</p>}
                    {getTicketImageSource(selectedTicket.cakePhoto) && (
                      <TicketImageAttachment
                        imageSource={getTicketImageSource(selectedTicket.cakePhoto)!}
                        sender="customer"
                        senderName={selectedTicket.customerName}
                        onPreview={setPreviewImage}
                      />
                    )}
                  </div>
                </div>

                {/* Subsequent replies */}
                {selectedTicket.replies.slice(1).map((reply) => {
                  const isAdmin = reply.sender === 'admin';
                  // Replies created before the photo field existed stored a
                  // markdown image URL in text. Continue rendering those too.
                  const imageSource = getTicketImageSource(reply.photo || getLegacyReplyImage(reply.text));
                  const displayText = getReplyDisplayText(reply.text);
                  return (
                    <div
                      key={reply.id}
                      className={`flex items-start gap-3 ${isAdmin ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow ${
                        isAdmin ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {isAdmin ? '👨‍🍳' : '👤'}
                      </div>
                      <div className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed shadow border ${
                        isAdmin
                          ? 'bg-purple-950/60 text-purple-50 border-purple-500/40 rounded-tl-none'
                          : 'bg-slate-800/90 text-slate-100 border-slate-700/60 rounded-tr-none'
                      }`}>
                        <div className="flex items-center justify-between gap-4 mb-1 text-[10px] text-slate-400">
                          <span className={`font-bold ${isAdmin ? 'text-amber-300' : 'text-purple-300'}`}>
                            {reply.senderName}
                          </span>
                          <span>{new Date(reply.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {displayText && <p className="whitespace-pre-line">{displayText}</p>}
                        {imageSource && (
                          <TicketImageAttachment
                            imageSource={imageSource}
                            sender={reply.sender}
                            senderName={reply.senderName}
                            onPreview={setPreviewImage}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick Canned Responses Bar */}
              <div className="p-2.5 bg-slate-950/80 border-t border-slate-800/90">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  <span className="text-[11px] font-bold text-amber-400 shrink-0 flex items-center gap-1 px-1">
                    <Sparkles className="w-3 h-3" />
                    پاسخ‌های آماده:
                  </span>
                  {QUICK_CANNED_REPLIES.map((canned, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyCannedReply(canned.text)}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-purple-900/60 text-slate-300 hover:text-purple-200 border border-slate-800 hover:border-purple-500/40 text-[11px] font-medium whitespace-nowrap transition"
                    >
                      {canned.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reply Input Box */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 rounded-b-2xl">
                <div className="flex items-center gap-2">
                  <textarea
                    rows={2}
                    value={replyInput}
                    onChange={(e) => setReplyInput(e.target.value)}
                    placeholder="متن پاسخ خود را بنویسید (مستقیماً در تلگرام مشتری ارسال می‌شود)..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSendReply}
                    disabled={!replyInput.trim() || isSendingReply}
                    className="px-4 py-3 bg-gradient-to-r from-purple-600 to-sky-600 hover:from-purple-500 hover:to-sky-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition shadow-lg shadow-purple-600/20 flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">ارسال پاسخ</span>
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 h-[700px] flex flex-col items-center justify-center">
              <Headphones className="w-12 h-12 text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-300">یک تیکت را از لیست سمت راست انتخاب کنید</p>
              <p className="text-xs text-slate-500 mt-1">مشاهده تاریخچه گفتگو و ارسال پاسخ مستقیم به تلگرام مشتری</p>
            </div>
          )}
        </div>

      </div>

      {/* New Ticket Modal */}
      {showNewTicketModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-base">ثبت پیام یا تیکت پشتیبانی جدید</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTicketModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewTicket} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">نام مشتری *</label>
                  <input
                    type="text"
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="مثال: مریم کریمی"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">تلفن همراه</label>
                  <input
                    type="text"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="0912..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">دسته‌بندی موضوع *</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as SupportCategory)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                  >
                    <option value="custom_cake">🎂 سفارش کیک اختصاصی</option>
                    <option value="order_inquiry">📦 پیگیری سفارش</option>
                    <option value="payment_issue">💳 مشکل پرداخت / فیش</option>
                    <option value="feedback">⭐ انتقاد و پیشنهاد</option>
                    <option value="consultation">💡 مشاوره خرید</option>
                    <option value="general">💬 پیام عمومی</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">شماره سفارش (اختیاری)</label>
                  <input
                    type="text"
                    value={newOrderNumber}
                    onChange={(e) => setNewOrderNumber(e.target.value)}
                    placeholder="مثال: SH-8421"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">عنوان تیکت *</label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="مثال: سفارش کیک تولد دو طبقه با تم آبی"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">متن پیام یا شرح درخواست *</label>
                <textarea
                  rows={3}
                  required
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="توضیحات درخواست مشتری را اینجا بنویسید..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">لینک تصویر کیک (اختیاری)</label>
                <input
                  type="url"
                  value={newCakePhoto}
                  onChange={(e) => setNewCakePhoto(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-600/30"
                >
                  ثبت تیکت
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      <ZoomableImageModal
        imageSrc={previewImage}
        onClose={() => setPreviewImage(null)}
        alt="تصویر ارسال‌شده در تیکت"
        title="تصویر ارسال‌شده در تیکت"
        description="با دکمه‌های بزرگ‌نمایی و کوچک‌نمایی جزئیات تصویر را بررسی کنید."
      />

    </div>
  );
};
