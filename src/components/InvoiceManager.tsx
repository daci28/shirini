import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  ClipboardList,
  CreditCard,
  FilePlus2,
  FileText,
  Filter,
  Image as ImageIcon,
  MapPin,
  PackagePlus,
  Phone,
  Plus,
  ReceiptText,
  Search,
  Send,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  CustomerUser,
  Invoice,
  InvoiceItem,
  InvoicePayment,
  InvoicePaymentMethod,
  InvoicePaymentStatus,
  InvoiceSource,
  InvoiceStatus,
  Product,
} from '../types';
import {
  invoicePaymentMethodLabels,
  invoicePaymentStatusLabels,
  invoiceSourceLabels,
  invoiceStatusLabels,
} from '../utils/invoices';
import { formatIranianDateTime } from '../utils/iranianDate';
import { resolveTelegramImageSource } from '../utils/telegramImage';
import { ZoomableImageModal } from './ZoomableImageModal';

export interface ManualInvoicePayload {
  invoiceNumber?: string;
  title?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerTelegramId?: string;
  customerAddress?: string;
  items: Array<Pick<InvoiceItem, 'title' | 'description' | 'productCode' | 'quantity' | 'unit' | 'unitPrice' | 'discountAmount'>>;
  shippingFee: number;
  discountAmount: number;
  taxAmount: number;
  status: InvoiceStatus;
  paymentMethod: InvoicePaymentMethod;
  initialPayment: {
    amount: number;
    method: InvoicePaymentMethod;
    status: InvoicePaymentStatus;
    transactionReference?: string;
    notes?: string;
  };
  dueDate?: string;
  deliveryMethod?: 'pickup' | 'delivery';
  deliveryAddress?: string;
  notes?: string;
}

interface InvoiceManagerProps {
  invoices: Invoice[];
  customers: CustomerUser[];
  products: Product[];
  onCreateInvoice: (payload: ManualInvoicePayload) => Promise<Invoice>;
  onSendInvoiceToCustomer: (invoiceId: string) => Promise<Invoice>;
  onAddPayment: (invoiceId: string, payload: {
    amount: number;
    method: InvoicePaymentMethod;
    status: InvoicePaymentStatus;
    transactionReference?: string;
    notes?: string;
  }) => Promise<Invoice>;
  onChangeInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => Promise<Invoice>;
  onReviewPayment: (invoice: Invoice, payment: InvoicePayment, approved: boolean, reason?: string) => Promise<Invoice>;
}

interface DraftLine {
  id: string;
  productId: string;
  title: string;
  description: string;
  productCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountAmount: number;
}

interface ManualInvoiceDraft {
  invoiceNumber: string;
  title: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerTelegramId: string;
  customerAddress: string;
  sendToCustomerTelegram: boolean;
  lines: DraftLine[];
  shippingFee: number;
  discountAmount: number;
  taxAmount: number;
  dueDate: string;
  deliveryMethod: 'pickup' | 'delivery';
  paymentMethod: InvoicePaymentMethod;
  paymentStatus: InvoicePaymentStatus;
  initialPaymentAmount: number;
  transactionReference: string;
  paymentNotes: string;
  status: InvoiceStatus;
  notes: string;
}

const makeLine = (): DraftLine => ({
  id: `draft-line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  productId: '',
  title: '',
  description: '',
  productCode: '',
  quantity: 1,
  unit: 'عدد',
  unitPrice: 0,
  discountAmount: 0,
});

const makeInitialDraft = (): ManualInvoiceDraft => ({
  invoiceNumber: '',
  title: 'فاکتور دستی',
  customerId: '',
  customerName: '',
  customerPhone: '',
  customerTelegramId: '',
  customerAddress: '',
  sendToCustomerTelegram: false,
  lines: [makeLine()],
  shippingFee: 0,
  discountAmount: 0,
  taxAmount: 0,
  dueDate: '',
  deliveryMethod: 'delivery',
  paymentMethod: 'card_to_card',
  paymentStatus: 'pending',
  initialPaymentAmount: 0,
  transactionReference: '',
  paymentNotes: '',
  status: 'pending_payment',
  notes: '',
});

const paymentMethodOptions: InvoicePaymentMethod[] = [
  'card_to_card',
  'online_payment',
  'online_gateway',
  'bank_transfer',
  'cash',
  'cash_on_delivery',
  'wallet',
  'other',
];

const paymentStatusOptions: InvoicePaymentStatus[] = [
  'pending',
  'submitted',
  'confirmed',
  'rejected',
  'refunded',
];

const manualInvoiceStatusOptions: InvoiceStatus[] = [
  'draft',
  'issued',
  'pending_payment',
  'payment_review',
  'partially_paid',
  'paid',
  'cancelled',
  'refunded',
];

const money = (amount: number) => `${Math.max(0, Number(amount) || 0).toLocaleString('fa-IR')} تومان`;
const isBotLinkedTelegramId = (value?: string): boolean => {
  const telegramId = String(value || '').trim();
  return Boolean(telegramId && telegramId !== 'guest' && !telegramId.startsWith('manual-'));
};

const sourceClass: Record<InvoiceSource, string> = {
  regular_order: 'border-sky-700/50 bg-sky-950/40 text-sky-300',
  custom_order: 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300',
  manual: 'border-violet-700/50 bg-violet-950/40 text-violet-300',
};

const statusClass: Record<InvoiceStatus, string> = {
  draft: 'border-slate-700 bg-slate-800 text-slate-300',
  issued: 'border-sky-800 bg-sky-950/50 text-sky-300',
  pending_payment: 'border-amber-800 bg-amber-950/50 text-amber-300',
  payment_review: 'border-orange-800 bg-orange-950/50 text-orange-300',
  partially_paid: 'border-indigo-800 bg-indigo-950/50 text-indigo-300',
  paid: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  overdue: 'border-rose-800 bg-rose-950/50 text-rose-300',
  cancelled: 'border-slate-700 bg-slate-800 text-slate-300',
  refunded: 'border-rose-800 bg-rose-950/50 text-rose-300',
};

const paymentStatusClass: Record<InvoicePaymentStatus, string> = {
  pending: 'text-amber-300',
  submitted: 'text-orange-300',
  confirmed: 'text-emerald-300',
  rejected: 'text-rose-300',
  refunded: 'text-rose-300',
};

function InputLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold text-slate-300">{children}</label>;
}

function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none transition placeholder:text-slate-600 focus:border-violet-500 ${props.className || ''}`} />;
}

function FieldSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none transition focus:border-violet-500 ${props.className || ''}`} />;
}

export const InvoiceManager: React.FC<InvoiceManagerProps> = ({
  invoices,
  customers,
  products,
  onCreateInvoice,
  onSendInvoiceToCustomer,
  onAddPayment,
  onChangeInvoiceStatus,
  onReviewPayment,
}) => {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | InvoiceSource>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<ManualInvoiceDraft>(makeInitialDraft);
  const [createError, setCreateError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('card_to_card');
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus>('confirmed');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [isRegisteringPayment, setIsRegisteringPayment] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const [reviewingPaymentId, setReviewingPaymentId] = useState<string | null>(null);
  const [rejectingPayment, setRejectingPayment] = useState<{ invoice: Invoice; payment: InvoicePayment } | null>(null);
  const [paymentReviewReason, setPaymentReviewReason] = useState('');
  const [paymentReviewError, setPaymentReviewError] = useState('');

  // The app refreshes invoices in the background while this detail sheet can
  // stay open. Keep the selected record in sync so a receipt sent moments ago
  // appears immediately instead of requiring the admin to close and reopen it.
  useEffect(() => {
    setSelectedInvoice((current) => {
      if (!current) return current;
      return invoices.find((invoice) => invoice.id === current.id) || null;
    });
  }, [invoices]);

  const telegramCustomers = useMemo(
    () => customers.filter((customer) => isBotLinkedTelegramId(customer.telegramId)),
    [customers],
  );
  const canSendInvoiceToBotCustomer = (invoice: Invoice): boolean => Boolean(
    invoice.customerId && telegramCustomers.some((customer) => customer.id === invoice.customerId),
  );

  const filteredInvoices = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('fa-IR');
    return invoices.filter((invoice) => {
      const matchesSource = sourceFilter === 'all' || invoice.source === sourceFilter;
      const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
      const haystack = [
        invoice.invoiceNumber,
        invoice.relatedOrderNumber,
        invoice.title,
        invoice.customerName,
        invoice.customerPhone,
        invoice.customerTelegramId,
        invoice.customerAddress,
        invoice.notes,
        ...invoice.items.flatMap((item) => [item.title, item.description, item.productCode]),
        ...invoice.payments.flatMap((payment) => [payment.transactionReference, payment.notes]),
      ].filter(Boolean).join(' ').toLocaleLowerCase('fa-IR');
      return matchesSource && matchesStatus && (!normalized || haystack.includes(normalized));
    });
  }, [invoices, search, sourceFilter, statusFilter]);

  const metrics = useMemo(() => {
    const total = invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
    const received = invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
    const receivable = invoices.reduce((sum, invoice) => sum + invoice.remainingAmount, 0);
    const review = invoices.filter((invoice) => invoice.status === 'payment_review').length;
    return { total, received, receivable, review };
  }, [invoices]);

  const draftTotals = useMemo(() => {
    const subtotal = draft.lines.reduce((sum, line) => {
      const gross = Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitPrice) || 0);
      return sum + Math.max(0, gross - Math.max(0, Number(line.discountAmount) || 0));
    }, 0);
    const total = Math.max(0, subtotal + Math.max(0, draft.shippingFee || 0) + Math.max(0, draft.taxAmount || 0) - Math.max(0, draft.discountAmount || 0));
    return { subtotal, total, remaining: Math.max(0, total - Math.max(0, draft.initialPaymentAmount || 0)) };
  }, [draft]);

  const openCreate = () => {
    setDraft(makeInitialDraft());
    setCreateError('');
    setInvoiceNotice(null);
    setIsCreating(true);
  };

  const selectCustomer = (customerId: string) => {
    const customer = telegramCustomers.find((item) => item.id === customerId);
    setDraft((previous) => {
      if (!customer) {
        return { ...previous, customerId: '', sendToCustomerTelegram: false };
      }
      return {
        ...previous,
        customerId,
        customerName: customer.name || previous.customerName,
        customerPhone: customer.phone || previous.customerPhone,
        customerTelegramId: customer.telegramId,
        customerAddress: customer.address || previous.customerAddress,
        sendToCustomerTelegram: true,
      };
    });
  };

  const updateLine = (lineId: string, updates: Partial<DraftLine>) => {
    setDraft((previous) => ({
      ...previous,
      lines: previous.lines.map((line) => line.id === lineId ? { ...line, ...updates } : line),
    }));
  };

  const selectProductForLine = (lineId: string, productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      updateLine(lineId, { productId: '' });
      return;
    }
    updateLine(lineId, {
      productId,
      title: product.name,
      productCode: product.productCode,
      unit: product.unit,
      unitPrice: product.price,
    });
  };

  const submitManualInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError('');
    if (!draft.customerName.trim()) {
      setCreateError('نام مشتری را وارد یا از فهرست مشتریان انتخاب کنید.');
      return;
    }
    if (!draft.lines.length || draft.lines.some((line) => !line.title.trim() || Number(line.quantity) <= 0 || Number(line.unitPrice) < 0)) {
      setCreateError('برای هر ردیف، عنوان، تعداد معتبر و مبلغ واحد را وارد کنید.');
      return;
    }
    if (draft.lines.some((line) => Number(line.discountAmount) > Number(line.quantity) * Number(line.unitPrice))) {
      setCreateError('تخفیف هیچ ردیف نمی‌تواند از مبلغ همان ردیف بیشتر باشد.');
      return;
    }
    if (draft.discountAmount > draftTotals.subtotal + draft.shippingFee + draft.taxAmount) {
      setCreateError('تخفیف کل از مبلغ قابل پرداخت بیشتر است.');
      return;
    }

    if (draft.sendToCustomerTelegram && (!draft.customerId || !isBotLinkedTelegramId(draft.customerTelegramId))) {
      setCreateError('برای ارسال تلگرامی، یک مشتریِ دارای حساب فعال در ربات انتخاب کنید.');
      return;
    }

    setIsSaving(true);
    try {
      const createdInvoice = await onCreateInvoice({
        invoiceNumber: draft.invoiceNumber.trim() || undefined,
        title: draft.title.trim() || undefined,
        customerId: draft.customerId || undefined,
        customerName: draft.customerName.trim(),
        customerPhone: draft.customerPhone.trim() || undefined,
        customerTelegramId: draft.customerTelegramId.trim() || undefined,
        customerAddress: draft.customerAddress.trim() || undefined,
        items: draft.lines.map(({ productId: _productId, id: _id, ...line }) => ({
          ...line,
          title: line.title.trim(),
          description: line.description.trim() || undefined,
          productCode: line.productCode.trim() || undefined,
          quantity: Number(line.quantity),
          unit: line.unit.trim() || 'عدد',
          unitPrice: Number(line.unitPrice),
          discountAmount: Number(line.discountAmount),
        })),
        shippingFee: Number(draft.shippingFee) || 0,
        discountAmount: Number(draft.discountAmount) || 0,
        taxAmount: Number(draft.taxAmount) || 0,
        status: draft.status,
        paymentMethod: draft.paymentMethod,
        initialPayment: {
          amount: Number(draft.initialPaymentAmount) || 0,
          method: draft.paymentMethod,
          status: draft.paymentStatus,
          transactionReference: draft.transactionReference.trim() || undefined,
          notes: draft.paymentNotes.trim() || undefined,
        },
        dueDate: draft.dueDate || undefined,
        deliveryMethod: draft.deliveryMethod,
        deliveryAddress: draft.customerAddress.trim() || undefined,
        notes: draft.notes.trim() || undefined,
      });

      let displayedInvoice = createdInvoice;
      let notice: { tone: 'success' | 'warning'; text: string } = {
        tone: 'success',
        text: 'فاکتور با موفقیت صادر شد.',
      };
      if (draft.sendToCustomerTelegram) {
        try {
          displayedInvoice = await onSendInvoiceToCustomer(createdInvoice.id);
          notice = {
            tone: 'success',
            text: `فاکتور صادر و برای ${displayedInvoice.customerName} در تلگرام ارسال شد.`,
          };
        } catch (error) {
          notice = {
            tone: 'warning',
            text: `فاکتور صادر شد، اما ارسال تلگرام ناموفق بود: ${error instanceof Error ? error.message : 'خطای نامشخص'}`,
          };
        }
      }
      setSelectedInvoice(displayedInvoice);
      setInvoiceNotice(notice);
      setIsCreating(false);
      setDraft(makeInitialDraft());
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'صدور فاکتور ناموفق بود.');
    } finally {
      setIsSaving(false);
    }
  };

  const openPaymentModal = (invoice: Invoice) => {
    setPaymentInvoice(invoice);
    setPaymentAmount(invoice.remainingAmount);
    setPaymentMethod(invoice.paymentMethod || 'card_to_card');
    setPaymentStatus('confirmed');
    setPaymentReference('');
    setPaymentNotes('');
    setPaymentError('');
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentInvoice) return;
    if (paymentAmount <= 0) {
      setPaymentError('مبلغ پرداخت باید بیشتر از صفر باشد.');
      return;
    }
    setPaymentError('');
    setIsRegisteringPayment(true);
    try {
      const updated = await onAddPayment(paymentInvoice.id, {
        amount: paymentAmount,
        method: paymentMethod,
        status: paymentStatus,
        transactionReference: paymentReference.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
      });
      setSelectedInvoice((current) => current?.id === updated.id ? updated : current);
      setPaymentInvoice(null);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'ثبت پرداخت ناموفق بود.');
    } finally {
      setIsRegisteringPayment(false);
    }
  };

  const sendInvoiceToCustomer = async (invoice: Invoice) => {
    if (!canSendInvoiceToBotCustomer(invoice)) {
      alert('برای ارسال تلگرامی، مشتری باید از فهرست کاربرانِ ربات انتخاب شده باشد.');
      return;
    }
    setSendingInvoiceId(invoice.id);
    try {
      const updated = await onSendInvoiceToCustomer(invoice.id);
      setSelectedInvoice(updated);
      setInvoiceNotice({
        tone: 'success',
        text: `فاکتور برای ${updated.customerName} در تلگرام ارسال شد.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ارسال فاکتور به تلگرام مشتری ناموفق بود.';
      setInvoiceNotice({ tone: 'warning', text: message });
      alert(message);
    } finally {
      setSendingInvoiceId(null);
    }
  };

  const reviewCustomerReceipt = async (invoice: Invoice, payment: InvoicePayment, approved: boolean, reason?: string) => {
    setReviewingPaymentId(payment.id);
    setPaymentReviewError('');
    try {
      const updated = await onReviewPayment(invoice, payment, approved, reason?.trim() || undefined);
      setSelectedInvoice(updated);
      setInvoiceNotice({
        tone: 'success',
        text: approved
          ? `فیش ${updated.customerName} تأیید شد و وضعیت فاکتور به‌روز شد.`
          : `فیش ${updated.customerName} رد شد؛ مشتری می‌تواند فیش جدید ارسال کند.`,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ثبت تصمیم فیش فاکتور ناموفق بود.';
      setPaymentReviewError(message);
      setInvoiceNotice({ tone: 'warning', text: message });
      return false;
    } finally {
      setReviewingPaymentId(null);
    }
  };

  const approveCustomerReceipt = async (invoice: Invoice, payment: InvoicePayment) => {
    if (!window.confirm(`فیش پرداخت ${money(payment.amount)} برای فاکتور ${invoice.invoiceNumber} تأیید شود؟`)) return;
    await reviewCustomerReceipt(invoice, payment, true);
  };

  const openRejectCustomerReceipt = (invoice: Invoice, payment: InvoicePayment) => {
    setRejectingPayment({ invoice, payment });
    setPaymentReviewReason('');
    setPaymentReviewError('');
  };

  const submitCustomerReceiptRejection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejectingPayment) return;
    const accepted = await reviewCustomerReceipt(
      rejectingPayment.invoice,
      rejectingPayment.payment,
      false,
      paymentReviewReason,
    );
    if (accepted) setRejectingPayment(null);
  };

  const changeManualInvoiceStatus = async (invoice: Invoice, status: InvoiceStatus) => {
    setIsChangingStatus(true);
    try {
      const updated = await onChangeInvoiceStatus(invoice.id, status);
      setSelectedInvoice(updated);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تغییر وضعیت فاکتور ناموفق بود.');
    } finally {
      setIsChangingStatus(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-800/40 bg-gradient-to-l from-violet-950/45 via-slate-900 to-slate-900 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-900/40">
              <ReceiptText className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-white sm:text-2xl">فاکتورها و پرداخت‌ها</h2>
                <span className="rounded-full border border-violet-700/60 bg-violet-950/60 px-2 py-0.5 text-[11px] text-violet-200">مرکز مالی یکپارچه</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-400 sm:text-sm">
                فاکتورهای سفارش عادی، سفارش سفارشی و پرداخت‌های آن‌ها به‌صورت زنده از مبدا نمایش داده می‌شوند. فاکتورهای دستی نیز به‌طور پایدار در سرور ذخیره می‌شوند.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-950/60 transition hover:bg-violet-500"
          >
            <FilePlus2 className="h-4 w-4" />
            ساخت فاکتور دستی
          </button>
        </div>
      </section>

      {invoiceNotice && <div role="status" className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${invoiceNotice.tone === 'success' ? 'border-emerald-800/60 bg-emerald-950/35 text-emerald-100' : 'border-amber-800/60 bg-amber-950/35 text-amber-100'}`}><span className="leading-5">{invoiceNotice.text}</span><button type="button" onClick={() => setInvoiceNotice(null)} className="shrink-0 rounded p-0.5 opacity-75 hover:bg-black/15 hover:opacity-100" aria-label="بستن پیام"><X className="h-4 w-4" /></button></div>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'کل ارزش فاکتورها', value: money(metrics.total), icon: FileText, className: 'text-violet-300 bg-violet-950/40 border-violet-900/50' },
          { label: 'پرداخت تأییدشده', value: money(metrics.received), icon: BadgeCheck, className: 'text-emerald-300 bg-emerald-950/40 border-emerald-900/50' },
          { label: 'مانده قابل دریافت', value: money(metrics.receivable), icon: WalletCards, className: 'text-amber-300 bg-amber-950/40 border-amber-900/50' },
          { label: 'فیش در انتظار بررسی', value: metrics.review.toLocaleString('fa-IR'), icon: CalendarClock, className: 'text-orange-300 bg-orange-950/40 border-orange-900/50' },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className={`rounded-xl border p-3.5 ${metric.className}`}>
              <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400"><Icon className="h-4 w-4" />{metric.label}</div>
              <strong className="block text-sm sm:text-base">{metric.value}</strong>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/85 p-3.5 shadow-lg">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <FieldInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجو در شماره فاکتور، سفارش، مشتری، کالا، شماره پیگیری یا یادداشت…" className="pr-9" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-slate-500"><Filter className="h-3.5 w-3.5" /> فیلتر:</span>
            <FieldSelect value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | InvoiceSource)} className="w-auto min-w-[125px]">
              <option value="all">همه مسیرها</option>
              <option value="regular_order">سفارش عادی</option>
              <option value="custom_order">سفارش سفارشی</option>
              <option value="manual">فاکتور دستی</option>
            </FieldSelect>
            <FieldSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | InvoiceStatus)} className="w-auto min-w-[145px]">
              <option value="all">همه وضعیت‌ها</option>
              {Object.entries(invoiceStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </FieldSelect>
          </div>
        </div>
      </section>

      {filteredInvoices.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
          <ClipboardList className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-3 text-base font-bold text-slate-300">فاکتوری مطابق فیلترها پیدا نشد</h3>
          <p className="mt-1 text-xs text-slate-500">برای ثبت هزینه یا خدمت خارج از سفارش‌ها، یک فاکتور دستی بسازید.</p>
        </section>
      ) : (
        <section className="space-y-3">
          {filteredInvoices.map((invoice) => {
            // A customer may send a receipt and a later payment record may be
            // added afterwards. Find the newest actual receipt rather than only
            // looking at the final array entry, so it never disappears from the list.
            const receiptPayment = [...invoice.payments].reverse().find((payment) => Boolean(payment.receiptImage));
            const reviewReceiptPayment = [...invoice.payments].reverse().find((payment) => payment.status === 'submitted' && Boolean(payment.receiptImage));
            const receiptSource = receiptPayment?.receiptImage ? resolveTelegramImageSource(receiptPayment.receiptImage) : null;
            return (
              <article key={invoice.id} className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg transition hover:border-slate-700 sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSelectedInvoice(invoice)} className="font-mono text-sm font-black text-white transition hover:text-violet-300">{invoice.invoiceNumber}</button>
                      {invoice.relatedOrderNumber && <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">سفارش {invoice.relatedOrderNumber}</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceClass[invoice.source]}`}>{invoiceSourceLabels[invoice.source]}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass[invoice.status]}`}>{invoiceStatusLabels[invoice.status]}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5 text-sky-400" />{invoice.customerName}</span>
                      {invoice.customerPhone && <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3.5 w-3.5 text-slate-500" />{invoice.customerPhone}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-500" />{formatIranianDateTime(invoice.createdAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs text-slate-500">{invoice.title || invoice.items.map((item) => item.title).join('، ')}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-950/45 p-3 text-center text-[10px] sm:min-w-[330px]">
                    <div><span className="block text-slate-500">کل فاکتور</span><strong className="mt-1 block text-xs text-white">{money(invoice.totalAmount)}</strong></div>
                    <div><span className="block text-slate-500">تأیید شده</span><strong className="mt-1 block text-xs text-emerald-300">{money(invoice.paidAmount)}</strong></div>
                    <div><span className="block text-slate-500">مانده</span><strong className="mt-1 block text-xs text-amber-300">{money(invoice.remainingAmount)}</strong></div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {reviewReceiptPayment && (
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(invoice)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-700/70 bg-orange-950/45 px-3 py-2 text-[11px] font-bold text-orange-100 transition hover:bg-orange-900/50"
                        title="مشاهده، تأیید یا رد فیش مشتری"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        فیش در انتظار تأیید
                      </button>
                    )}
                    {receiptSource && (
                      <button
                        type="button"
                        title="مشاهده و بزرگ‌نمایی فیش پرداخت"
                        aria-label={`مشاهده فیش پرداخت فاکتور ${invoice.invoiceNumber}`}
                        onClick={() => setPreviewImage(receiptSource)}
                        className="group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sky-800/70 bg-sky-950/45 text-sky-300 shadow-sm transition hover:border-sky-500 hover:ring-2 hover:ring-sky-500/20"
                      >
                        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true"><ImageIcon className="h-4 w-4" /></span>
                        <img
                          src={receiptSource}
                          alt="پیش‌نمایش فیش پرداخت مشتری"
                          loading="lazy"
                          className="relative z-10 h-full w-full object-cover transition duration-200 group-hover:scale-110"
                          onError={(event) => { event.currentTarget.style.display = 'none'; }}
                        />
                        <span className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 opacity-0 transition group-hover:opacity-100" aria-hidden="true"><ImageIcon className="h-4 w-4 text-white" /></span>
                      </button>
                    )}
                    <button type="button" onClick={() => setSelectedInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700">
                      جزئیات <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {isCreating && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
          <form onSubmit={submitManualInvoice} className="mx-auto my-4 max-w-6xl rounded-2xl border border-violet-800/50 bg-slate-900 shadow-2xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur sm:p-5">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><FilePlus2 className="h-5 w-5" /></div>
                <div>
                  <h3 className="font-bold text-white">صدور فاکتور دستی</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">مشخصات مشتری، ردیف کالا یا خدمت، پرداخت و سررسید را یک‌جا ثبت کنید.</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsCreating(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white" aria-label="بستن"><X className="h-5 w-5" /></button>
            </header>

            <div className="space-y-6 p-4 sm:p-5">
              {createError && <div className="rounded-xl border border-rose-800/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">{createError}</div>}

              <section>
                <div className="mb-3 flex items-center gap-2"><UserRound className="h-4 w-4 text-sky-400" /><h4 className="text-sm font-bold text-white">مشخصات مشتری و فاکتور</h4></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2"><InputLabel>انتخاب مشتری از کاربران ربات</InputLabel><FieldSelect value={draft.customerId} onChange={(event) => selectCustomer(event.target.value)}><option value="">ثبت فاکتور بدون انتخاب مشتری ربات</option>{telegramCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.username ? ` (@${customer.username})` : ''}{customer.phone ? ` — ${customer.phone}` : ''}</option>)}</FieldSelect>{telegramCustomers.length === 0 && <p className="mt-1 text-[10px] text-amber-300">هنوز کاربری که ربات را شروع کرده باشد، در فهرست مشتریان نیست.</p>}</div>
                  <div><InputLabel>نام مشتری *</InputLabel><FieldInput required value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} placeholder="نام و نام خانوادگی" /></div>
                  <div><InputLabel>شماره تماس</InputLabel><FieldInput value={draft.customerPhone} onChange={(event) => setDraft({ ...draft, customerPhone: event.target.value })} placeholder="0912…" dir="ltr" /></div>
                  <div><InputLabel>شناسه تلگرام مشتری</InputLabel><FieldInput readOnly={Boolean(draft.customerId)} value={draft.customerTelegramId} onChange={(event) => setDraft({ ...draft, customerTelegramId: event.target.value })} placeholder="Telegram ID" dir="ltr" /></div>
                  <div className="sm:col-span-2 lg:col-span-3"><label className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${draft.customerId && isBotLinkedTelegramId(draft.customerTelegramId) ? 'border-sky-800/70 bg-sky-950/30 text-sky-100' : 'cursor-not-allowed border-slate-800 bg-slate-950/45 text-slate-500'}`}><input type="checkbox" checked={draft.sendToCustomerTelegram} disabled={!draft.customerId || !isBotLinkedTelegramId(draft.customerTelegramId)} onChange={(event) => setDraft({ ...draft, sendToCustomerTelegram: event.target.checked })} className="mt-0.5 h-3.5 w-3.5 accent-sky-500" /><span><span className="flex items-center gap-1 font-bold"><Send className="h-3.5 w-3.5" />ارسال خودکار فاکتور در تلگرام</span><span className="mt-1 block text-[10px] leading-4 opacity-80">پس از صدور، نسخه فاکتور به گفت‌وگوی همین مشتری در ربات فرستاده می‌شود.</span></span></label></div>
                  <div className="sm:col-span-2"><InputLabel>عنوان فاکتور</InputLabel><FieldInput value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="مثلاً پذیرایی مراسم شرکت" /></div>
                  <div><InputLabel>شماره فاکتور (اختیاری)</InputLabel><FieldInput value={draft.invoiceNumber} onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })} placeholder="خودکار ساخته می‌شود" dir="ltr" /></div>
                  <div><InputLabel>سررسید</InputLabel><FieldInput type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></div>
                  <div className="sm:col-span-2 lg:col-span-4"><InputLabel>آدرس / محل تحویل</InputLabel><FieldInput value={draft.customerAddress} onChange={(event) => setDraft({ ...draft, customerAddress: event.target.value })} placeholder="شهر، خیابان، پلاک یا محل ارائه خدمت" /></div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><PackagePlus className="h-4 w-4 text-violet-400" /><h4 className="text-sm font-bold text-white">ردیف کالا و خدمات</h4></div><button type="button" onClick={() => setDraft((previous) => ({ ...previous, lines: [...previous.lines, makeLine()] }))} className="inline-flex items-center gap-1 rounded-lg border border-violet-700/60 bg-violet-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-900/50"><Plus className="h-3.5 w-3.5" />افزودن ردیف</button></div>
                <div className="space-y-3">
                  {draft.lines.map((line, index) => {
                    const lineTotal = Math.max(0, line.quantity * line.unitPrice - line.discountAmount);
                    return <div key={line.id} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3 md:grid-cols-12 md:items-end">
                      <div className="md:col-span-3"><InputLabel>کالا از کاتالوگ (اختیاری)</InputLabel><FieldSelect value={line.productId} onChange={(event) => selectProductForLine(line.id, event.target.value)}><option value="">خدمت یا ردیف دستی</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</FieldSelect></div>
                      <div className="md:col-span-3"><InputLabel>عنوان ردیف *</InputLabel><FieldInput required value={line.title} onChange={(event) => updateLine(line.id, { title: event.target.value })} placeholder="مثلاً کیک یا هزینه طراحی" /></div>
                      <div className="grid grid-cols-3 gap-2 md:col-span-4"><div><InputLabel>تعداد</InputLabel><FieldInput required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></div><div><InputLabel>واحد</InputLabel><FieldInput value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })} /></div><div><InputLabel>کد کالا</InputLabel><FieldInput value={line.productCode} onChange={(event) => updateLine(line.id, { productCode: event.target.value })} dir="ltr" /></div></div>
                      <div className="grid grid-cols-2 gap-2 md:col-span-2"><div><InputLabel>مبلغ واحد</InputLabel><FieldInput required type="number" min="0" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} /></div><div><InputLabel>تخفیف ردیف</InputLabel><FieldInput type="number" min="0" value={line.discountAmount} onChange={(event) => updateLine(line.id, { discountAmount: Number(event.target.value) })} /></div></div>
                      <div className="flex items-center justify-between gap-2 md:col-span-12"><FieldInput value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} placeholder="توضیحات ردیف (اختیاری)" /><div className="flex shrink-0 items-center gap-2"><strong className="text-[11px] text-emerald-300">{money(lineTotal)}</strong><button type="button" disabled={draft.lines.length === 1} onClick={() => setDraft((previous) => ({ ...previous, lines: previous.lines.filter((item) => item.id !== line.id) }))} className="rounded-lg p-2 text-rose-400 transition hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-30" title={`حذف ردیف ${index + 1}`}><Trash2 className="h-4 w-4" /></button></div></div>
                    </div>;
                  })}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"><div className="mb-3 flex items-center gap-2"><ReceiptText className="h-4 w-4 text-amber-400" /><h4 className="text-sm font-bold text-white">مبالغ و شرایط</h4></div><div className="grid grid-cols-2 gap-3"><div><InputLabel>هزینه ارسال</InputLabel><FieldInput type="number" min="0" value={draft.shippingFee} onChange={(event) => setDraft({ ...draft, shippingFee: Number(event.target.value) })} /></div><div><InputLabel>مالیات / عوارض</InputLabel><FieldInput type="number" min="0" value={draft.taxAmount} onChange={(event) => setDraft({ ...draft, taxAmount: Number(event.target.value) })} /></div><div><InputLabel>تخفیف کل</InputLabel><FieldInput type="number" min="0" value={draft.discountAmount} onChange={(event) => setDraft({ ...draft, discountAmount: Number(event.target.value) })} /></div><div><InputLabel>روش تحویل</InputLabel><FieldSelect value={draft.deliveryMethod} onChange={(event) => setDraft({ ...draft, deliveryMethod: event.target.value as 'pickup' | 'delivery' })}><option value="delivery">ارسال</option><option value="pickup">دریافت حضوری</option></FieldSelect></div></div></div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"><div className="mb-3 flex items-center gap-2"><CreditCard className="h-4 w-4 text-sky-400" /><h4 className="text-sm font-bold text-white">پرداخت اولیه</h4></div><div className="grid grid-cols-2 gap-3"><div><InputLabel>مبلغ پرداخت</InputLabel><FieldInput type="number" min="0" value={draft.initialPaymentAmount} onChange={(event) => setDraft({ ...draft, initialPaymentAmount: Number(event.target.value) })} /></div><div><InputLabel>روش پرداخت</InputLabel><FieldSelect value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value as InvoicePaymentMethod })}>{paymentMethodOptions.map((method) => <option key={method} value={method}>{invoicePaymentMethodLabels[method]}</option>)}</FieldSelect></div><div><InputLabel>وضعیت پرداخت</InputLabel><FieldSelect value={draft.paymentStatus} onChange={(event) => setDraft({ ...draft, paymentStatus: event.target.value as InvoicePaymentStatus })}>{paymentStatusOptions.map((status) => <option key={status} value={status}>{invoicePaymentStatusLabels[status]}</option>)}</FieldSelect></div><div><InputLabel>شماره پیگیری</InputLabel><FieldInput value={draft.transactionReference} onChange={(event) => setDraft({ ...draft, transactionReference: event.target.value })} dir="ltr" /></div></div><div className="mt-3"><InputLabel>یادداشت پرداخت</InputLabel><FieldInput value={draft.paymentNotes} onChange={(event) => setDraft({ ...draft, paymentNotes: event.target.value })} placeholder="مثلاً تحویل گرفته شد" /></div></div>
                <div className="rounded-xl border border-violet-800/50 bg-violet-950/25 p-4"><div className="mb-3 flex items-center gap-2"><WalletCards className="h-4 w-4 text-violet-300" /><h4 className="text-sm font-bold text-white">خلاصه فاکتور</h4></div><dl className="space-y-2 text-xs"><div className="flex justify-between text-slate-400"><dt>جمع ردیف‌ها</dt><dd>{money(draftTotals.subtotal)}</dd></div><div className="flex justify-between text-slate-400"><dt>ارسال و مالیات</dt><dd>{money(draft.shippingFee + draft.taxAmount)}</dd></div><div className="flex justify-between text-rose-300"><dt>تخفیف کل</dt><dd>− {money(draft.discountAmount)}</dd></div><div className="border-t border-violet-900/60 pt-2 flex justify-between font-bold text-white"><dt>مبلغ نهایی</dt><dd className="text-violet-200">{money(draftTotals.total)}</dd></div><div className="flex justify-between font-semibold text-amber-200"><dt>مانده پس از پرداخت اولیه</dt><dd>{money(draftTotals.remaining)}</dd></div></dl><div className="mt-4"><InputLabel>وضعیت اولیه فاکتور</InputLabel><FieldSelect value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as InvoiceStatus })}>{manualInvoiceStatusOptions.map((status) => <option key={status} value={status}>{invoiceStatusLabels[status]}</option>)}</FieldSelect></div></div>
              </section>

              <section><InputLabel>یادداشت داخلی یا توضیحات مشتری</InputLabel><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-6 text-white outline-none placeholder:text-slate-600 focus:border-violet-500" placeholder="شرایط پرداخت، توضیحات سفارش، نکات تحویل و…" /></section>
            </div>
            <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur sm:px-5"><span className="text-[11px] text-slate-500">فاکتور دستی و پرداخت‌های بعدی در فضای داده پایدار سرور ذخیره می‌شوند.</span><div className="flex gap-2"><button type="button" onClick={() => setIsCreating(false)} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">انصراف</button><button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-950/60 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"><FilePlus2 className="h-4 w-4" />{isSaving ? 'در حال صدور…' : 'صدور فاکتور'}</button></div></footer>
          </form>
        </div>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
          <div className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-base font-black text-white">{selectedInvoice.invoiceNumber}</h3><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceClass[selectedInvoice.source]}`}>{invoiceSourceLabels[selectedInvoice.source]}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass[selectedInvoice.status]}`}>{invoiceStatusLabels[selectedInvoice.status]}</span></div><p className="mt-1 text-xs text-slate-400">{selectedInvoice.title || 'جزئیات فاکتور'} • ثبت در {formatIranianDateTime(selectedInvoice.createdAt)}</p></div><button type="button" onClick={() => setSelectedInvoice(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="بستن"><X className="h-5 w-5" /></button></header>
            <div className="space-y-5 p-4 sm:p-5">
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-3 text-xs"><h4 className="mb-2 flex items-center gap-1.5 font-bold text-sky-300"><UserRound className="h-4 w-4" />مشخصات مشتری</h4><p className="font-semibold text-white">{selectedInvoice.customerName}</p>{selectedInvoice.customerPhone && <p className="mt-1 text-slate-300" dir="ltr">{selectedInvoice.customerPhone}</p>}{selectedInvoice.customerTelegramId && <p className="mt-1 text-slate-400" dir="ltr">Telegram: {selectedInvoice.customerTelegramId}</p>}{selectedInvoice.source === 'manual' && canSendInvoiceToBotCustomer(selectedInvoice) && <p className={`mt-2 text-[10px] ${selectedInvoice.customerNotificationSentAt ? 'text-emerald-300' : 'text-amber-300'}`}>{selectedInvoice.customerNotificationSentAt ? `آخرین ارسال تلگرامی: ${formatIranianDateTime(selectedInvoice.customerNotificationSentAt)}${selectedInvoice.customerNotificationCount && selectedInvoice.customerNotificationCount > 1 ? ` (${selectedInvoice.customerNotificationCount.toLocaleString('fa-IR')} بار)` : ''}` : 'فاکتور هنوز برای مشتری در تلگرام ارسال نشده است.'}</p>}{selectedInvoice.customerAddress && <p className="mt-2 flex gap-1 leading-5 text-slate-300"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />{selectedInvoice.customerAddress}</p>}</div><div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-3 text-xs"><h4 className="mb-2 flex items-center gap-1.5 font-bold text-violet-300"><CalendarClock className="h-4 w-4" />اطلاعات فاکتور</h4>{selectedInvoice.relatedOrderNumber && <p className="text-slate-300">کد سفارش مبدا: <strong className="font-mono text-white">{selectedInvoice.relatedOrderNumber}</strong></p>}{selectedInvoice.dueDate && <p className="mt-1 text-slate-300">سررسید: {selectedInvoice.dueDate}</p>}<p className="mt-1 text-slate-300">روش تحویل: {selectedInvoice.deliveryMethod === 'pickup' ? 'دریافت حضوری' : selectedInvoice.deliveryMethod === 'delivery' ? 'ارسال' : 'ثبت نشده'}</p>{selectedInvoice.deliveryAddress && <p className="mt-2 leading-5 text-slate-400">{selectedInvoice.deliveryAddress}</p>}</div></section>

              <section className="overflow-hidden rounded-xl border border-slate-800"><div className="border-b border-slate-800 bg-slate-950/60 px-3 py-2.5 text-xs font-bold text-slate-200">اقلام و خدمات</div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-right text-xs"><thead className="bg-slate-950/40 text-[10px] text-slate-500"><tr><th className="px-3 py-2 font-medium">شرح</th><th className="px-3 py-2 font-medium">تعداد</th><th className="px-3 py-2 font-medium">مبلغ واحد</th><th className="px-3 py-2 font-medium">تخفیف</th><th className="px-3 py-2 font-medium">جمع</th></tr></thead><tbody>{selectedInvoice.items.map((item) => <tr key={item.id} className="border-t border-slate-800/80 text-slate-300"><td className="px-3 py-2.5"><strong className="block text-white">{item.title}</strong>{item.description && <span className="mt-0.5 block text-[10px] text-slate-500">{item.description}</span>}</td><td className="px-3 py-2.5">{item.quantity.toLocaleString('fa-IR')} {item.unit}</td><td className="px-3 py-2.5">{money(item.unitPrice)}</td><td className="px-3 py-2.5 text-rose-300">{item.discountAmount ? money(item.discountAmount) : '—'}</td><td className="px-3 py-2.5 font-semibold text-emerald-300">{money(item.totalAmount)}</td></tr>)}</tbody></table></div><div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-800 bg-slate-950/35 p-3 text-xs sm:grid-cols-4"><span className="text-slate-400">جمع ردیف‌ها: <strong className="text-white">{money(selectedInvoice.subtotal)}</strong></span><span className="text-slate-400">ارسال: <strong className="text-white">{money(selectedInvoice.shippingFee)}</strong></span><span className="text-slate-400">مالیات: <strong className="text-white">{money(selectedInvoice.taxAmount)}</strong></span><span className="text-rose-300">تخفیف: <strong>{money(selectedInvoice.discountAmount)}</strong></span><span className="col-span-2 border-t border-slate-800 pt-2 font-bold text-white sm:col-span-4">مبلغ نهایی: <strong className="mr-1 text-violet-200">{money(selectedInvoice.totalAmount)}</strong></span></div></section>

              <section className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-emerald-400" /><h4 className="text-sm font-bold text-white">پرداخت‌ها و فیش‌ها</h4></div>
                  {selectedInvoice.source === 'manual' && <div className="flex flex-wrap items-center gap-2">
                    {canSendInvoiceToBotCustomer(selectedInvoice) && <button type="button" disabled={sendingInvoiceId === selectedInvoice.id} onClick={() => void sendInvoiceToCustomer(selectedInvoice)} className="inline-flex items-center gap-1 rounded-lg border border-sky-700/70 bg-sky-950/50 px-3 py-1.5 text-[11px] font-bold text-sky-100 hover:bg-sky-900/60 disabled:cursor-wait disabled:opacity-60"><Send className="h-3.5 w-3.5" />{sendingInvoiceId === selectedInvoice.id ? 'در حال ارسال…' : selectedInvoice.customerNotificationSentAt ? 'ارسال مجدد تلگرامی' : 'ارسال فاکتور تلگرامی'}</button>}
                    <button type="button" onClick={() => openPaymentModal(selectedInvoice)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500"><Plus className="h-3.5 w-3.5" />ثبت پرداخت</button>
                  </div>}
                </div>

                {selectedInvoice.payments.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">هنوز پرداختی برای این فاکتور ثبت نشده است.</p> : <div className="space-y-2">
                  {selectedInvoice.payments.map((payment) => {
                    const receipt = resolveTelegramImageSource(payment.receiptImage);
                    // A submitted customer receipt is reviewable from this
                    // finance screen regardless of whether its invoice is a
                    // standalone document or derives from an order.
                    const needsReview = payment.status === 'submitted' && Boolean(payment.receiptImage);
                    const isReviewing = reviewingPaymentId === payment.id;
                    return <div key={payment.id} className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sky-300"><CreditCard className="h-4 w-4" /></div>
                        <div className="min-w-0"><strong className="block text-xs text-white">{money(payment.amount)} • {invoicePaymentMethodLabels[payment.method]}</strong><span className="mt-0.5 block text-[10px] text-slate-500">{formatIranianDateTime(payment.paidAt || payment.createdAt)}{payment.transactionReference ? ` • پیگیری: ${payment.transactionReference}` : ''}</span>{payment.notes && <span className="mt-0.5 block text-[10px] text-slate-400">{payment.notes}</span>}{payment.reviewedAt && <span className="mt-0.5 block text-[10px] text-slate-500">بررسی: {formatIranianDateTime(payment.reviewedAt)}{payment.reviewedBy ? ` • ${payment.reviewedBy}` : ''}</span>}{payment.reviewNote && <span className={`mt-0.5 block text-[10px] ${payment.status === 'rejected' ? 'text-rose-300' : 'text-slate-400'}`}>{payment.status === 'rejected' ? 'دلیل رد: ' : 'یادداشت بررسی: '}{payment.reviewNote}</span>}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className={`text-[11px] font-semibold ${paymentStatusClass[payment.status]}`}>{invoicePaymentStatusLabels[payment.status]}</span>
                        {receipt && <button type="button" onClick={() => setPreviewImage(receipt)} className="group inline-flex items-center gap-2 rounded-lg border border-sky-900/70 bg-sky-950/40 py-1 pl-2 pr-1.5 text-sky-200 transition hover:bg-sky-900/50" title="مشاهده و بزرگ‌نمایی فیش" aria-label={`مشاهده فیش پرداخت ${money(payment.amount)}`}><span className="relative flex h-8 w-8 overflow-hidden rounded-md bg-slate-900"><span className="absolute inset-0 flex items-center justify-center text-sky-300" aria-hidden="true"><ImageIcon className="h-3.5 w-3.5" /></span><img src={receipt} alt="پیش‌نمایش فیش پرداخت مشتری" className="relative z-10 h-full w-full object-cover transition duration-200 group-hover:scale-110" onError={(event) => { event.currentTarget.style.display = 'none'; }} /></span><span className="text-[10px] font-bold">مشاهده فیش</span></button>}
                        {needsReview && <><button type="button" disabled={isReviewing} onClick={() => void openRejectCustomerReceipt(selectedInvoice, payment)} className="inline-flex items-center gap-1 rounded-lg border border-rose-800/70 bg-rose-950/35 px-2.5 py-1.5 text-[10px] font-bold text-rose-200 hover:bg-rose-900/45 disabled:opacity-60"><X className="h-3.5 w-3.5" />رد فیش</button><button type="button" disabled={isReviewing} onClick={() => void approveCustomerReceipt(selectedInvoice, payment)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-60"><BadgeCheck className="h-3.5 w-3.5" />{isReviewing ? 'در حال ثبت…' : 'تأیید فیش'}</button></>}
                      </div>
                    </div>;
                  })}
                </div>}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs"><div><span className="text-slate-500">پرداخت تأییدشده</span><strong className="mt-1 block text-emerald-300">{money(selectedInvoice.paidAmount)}</strong></div><div><span className="text-slate-500">مانده قابل دریافت</span><strong className="mt-1 block text-amber-300">{money(selectedInvoice.remainingAmount)}</strong></div></div>
              </section>

              {selectedInvoice.source === 'manual' && <section className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-xs font-bold text-white">وضعیت فاکتور دستی</h4><p className="mt-1 text-[10px] leading-5 text-slate-500">وضعیت پرداخت با مبالغ تأییدشده همگام می‌شود.</p></div><FieldSelect disabled={isChangingStatus} value={selectedInvoice.status} onChange={(event) => void changeManualInvoiceStatus(selectedInvoice, event.target.value as InvoiceStatus)} className="w-full sm:w-48">{manualInvoiceStatusOptions.map((status) => <option key={status} value={status}>{invoiceStatusLabels[status]}</option>)}</FieldSelect></div></section>}
              {selectedInvoice.source !== 'manual' && selectedInvoice.payments.some((payment) => payment.status === 'submitted' && payment.receiptImage) && <p className="rounded-xl border border-orange-800/60 bg-orange-950/30 px-3 py-2 text-xs leading-5 text-orange-100">فیش این سفارش در همین بخش قابل مشاهده است. پس از بررسی تصویر، «تأیید فیش» یا «رد فیش» را انتخاب کنید؛ شروع پخت همچنان یک عمل جداگانه است.</p>}
              {selectedInvoice.notes && <section className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs"><h4 className="mb-1 font-bold text-slate-200">یادداشت</h4><p className="whitespace-pre-wrap leading-6 text-slate-400">{selectedInvoice.notes}</p></section>}
            </div>
          </div>
        </div>
      )}

      {paymentInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <form onSubmit={submitPayment} className="w-full max-w-md rounded-2xl border border-emerald-800/60 bg-slate-900 p-5 shadow-2xl"><div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3"><div><h3 className="font-bold text-white">ثبت پرداخت دستی</h3><p className="mt-1 text-[11px] text-slate-400">فاکتور {paymentInvoice.invoiceNumber} • مانده: {money(paymentInvoice.remainingAmount)}</p></div><button type="button" onClick={() => setPaymentInvoice(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></div>{paymentError && <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">{paymentError}</p>}<div className="mt-4 grid grid-cols-2 gap-3"><div><InputLabel>مبلغ پرداخت *</InputLabel><FieldInput required type="number" min="1" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></div><div><InputLabel>روش پرداخت</InputLabel><FieldSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as InvoicePaymentMethod)}>{paymentMethodOptions.map((method) => <option key={method} value={method}>{invoicePaymentMethodLabels[method]}</option>)}</FieldSelect></div><div><InputLabel>وضعیت</InputLabel><FieldSelect value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as InvoicePaymentStatus)}>{paymentStatusOptions.map((status) => <option key={status} value={status}>{invoicePaymentStatusLabels[status]}</option>)}</FieldSelect></div><div><InputLabel>شماره پیگیری</InputLabel><FieldInput value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} dir="ltr" /></div><div className="col-span-2"><InputLabel>یادداشت پرداخت</InputLabel><FieldInput value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="توضیحات پرداخت، رسید کاغذی و…" /></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPaymentInvoice(null)} className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">انصراف</button><button type="submit" disabled={isRegisteringPayment} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-60"><CreditCard className="h-4 w-4" />{isRegisteringPayment ? 'در حال ثبت…' : 'ثبت پرداخت'}</button></div></form>
        </div>
      )}

      {rejectingPayment && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <form onSubmit={submitCustomerReceiptRejection} className="w-full max-w-md rounded-2xl border border-rose-800/60 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3"><div><h3 className="font-bold text-white">رد فیش واریزی مشتری</h3><p className="mt-1 text-[11px] text-slate-400">فاکتور {rejectingPayment.invoice.invoiceNumber} • {money(rejectingPayment.payment.amount)}</p></div><button type="button" disabled={reviewingPaymentId === rejectingPayment.payment.id} onClick={() => setRejectingPayment(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="بستن"><X className="h-5 w-5" /></button></div>
            {paymentReviewError && <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-200">{paymentReviewError}</p>}
            <div className="mt-4"><InputLabel>دلیل رد برای مشتری (اختیاری)</InputLabel><textarea value={paymentReviewReason} onChange={(event) => setPaymentReviewReason(event.target.value)} maxLength={1000} placeholder="مثلاً مبلغ، تاریخ یا تصویر فیش خوانا نیست" className="min-h-24 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-slate-600 focus:border-rose-500" /></div>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">مشتری پیام رد فیش و دکمه ارسال فیش جدید را در تلگرام دریافت می‌کند.</p>
            <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={reviewingPaymentId === rejectingPayment.payment.id} onClick={() => setRejectingPayment(null)} className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-60">انصراف</button><button type="submit" disabled={reviewingPaymentId === rejectingPayment.payment.id} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-60"><X className="h-4 w-4" />{reviewingPaymentId === rejectingPayment.payment.id ? 'در حال ثبت…' : 'رد فیش و اطلاع‌رسانی'}</button></div>
          </form>
        </div>
      )}

      <ZoomableImageModal imageSrc={previewImage} onClose={() => setPreviewImage(null)} alt="فیش پرداخت" title="فیش پرداخت مشتری" description="برای بررسی جزئیات، تصویر را بزرگ‌نمایی کنید و در حالت زوم با حرکت سریع‌تر آن را جابه‌جا کنید." />
    </div>
  );
};
