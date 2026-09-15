import React, { useState } from 'react';
import { 
  Ticket, 
  Plus, 
  Search, 
  Copy, 
  Check, 
  Trash2, 
  Edit3, 
  Percent, 
  DollarSign, 
  Calendar, 
  Users, 
  Sparkles, 
  AlertCircle,
  Tag,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  RefreshCw,
  Gift
} from 'lucide-react';
import { DiscountCode, Order, Product } from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';
import { matchesSearchValues } from '../utils/search';

interface DiscountManagerProps {
  discounts: DiscountCode[];
  orders: Order[];
  products: Product[];
  onAddDiscount: (discount: Omit<DiscountCode, 'id' | 'createdAt'>) => Promise<DiscountCode>;
  onUpdateDiscount: (id: string, updates: Partial<DiscountCode>) => Promise<void>;
  onDeleteDiscount: (id: string) => Promise<void>;
  onOpenSimulatorWithCode?: (code: string) => void;
}

export const DiscountManager: React.FC<DiscountManagerProps> = ({
  discounts,
  orders,
  products,
  onAddDiscount,
  onUpdateDiscount,
  onDeleteDiscount,
  onOpenSimulatorWithCode
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'percentage' | 'fixed'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<DiscountCode | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue] = useState<number>(15);
  const [minPurchaseAmount, setMinPurchaseAmount] = useState<number | ''>(250000);
  const [maxDiscountAmount, setMaxDiscountAmount] = useState<number | ''>(100000);
  const [usageLimit, setUsageLimit] = useState<number | ''>(100);
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Applicability: all products or selected ones
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Quick Code Generator
  const generateRandomCode = (prefix = 'SHIRIN') => {
    const num = Math.floor(10 + Math.random() * 90);
    return `${prefix}${num}`;
  };

  const handleCopyCode = (codeStr: string) => {
    navigator.clipboard.writeText(codeStr);
    setCopiedCode(codeStr);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const openAddModal = () => {
    setEditingDiscount(null);
    setCode(generateRandomCode('PASTRY'));
    setType('percentage');
    setValue(20);
    setMinPurchaseAmount(300000);
    setMaxDiscountAmount(100000);
    setUsageLimit(50);
    setExpiresAt('');
    setDescription('');
    setIsActive(true);
    setAppliesToAll(true);
    setSelectedProductIds([]);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item: DiscountCode) => {
    setEditingDiscount(item);
    setCode(item.code);
    setType(item.type);
    setValue(item.value);
    setMinPurchaseAmount(item.minPurchaseAmount !== undefined ? item.minPurchaseAmount : '');
    setMaxDiscountAmount(item.maxDiscountAmount !== undefined ? item.maxDiscountAmount : '');
    setUsageLimit(item.usageLimit !== undefined ? item.usageLimit : '');
    setExpiresAt(item.expiresAt ? item.expiresAt.substring(0, 10) : '');
    setDescription(item.description || '');
    setIsActive(item.isActive);
    setAppliesToAll(!item.applicableProductIds || item.applicableProductIds.length === 0);
    setSelectedProductIds(item.applicableProductIds ? [...item.applicableProductIds] : []);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setFormError('لطفاً کد تخفیف را وارد کنید');
      return;
    }

    if (value <= 0) {
      setFormError('مقدار تخفیف باید بیشتر از صفر باشد');
      return;
    }

    if (type === 'percentage' && value > 100) {
      setFormError('درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد');
      return;
    }

    // Check duplicate code if adding or renaming
    const isDuplicate = discounts.some(
      d => d.code.toUpperCase() === cleanCode && (!editingDiscount || d.id !== editingDiscount.id)
    );
    if (isDuplicate) {
      setFormError('این کد تخفیف قبلاً تعریف شده است. لطفاً کد دیگری انتخاب کنید.');
      return;
    }

    if (!appliesToAll && selectedProductIds.length === 0) {
      setFormError('لطفاً حداقل یک محصول برای اعمال تخفیف انتخاب کنید یا گزینه «همه محصولات» را فعال کنید.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingDiscount) {
        await onUpdateDiscount(editingDiscount.id, {
          code: cleanCode,
          type,
          value: Number(value),
          minPurchaseAmount: minPurchaseAmount !== '' ? Number(minPurchaseAmount) : undefined,
          maxDiscountAmount: type === 'percentage' && maxDiscountAmount !== '' ? Number(maxDiscountAmount) : undefined,
          usageLimit: usageLimit !== '' ? Number(usageLimit) : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          applicableProductIds: appliesToAll ? [] : [...selectedProductIds],
          description,
          isActive
        });
      } else {
        await onAddDiscount({
          code: cleanCode,
          type,
          value: Number(value),
          minPurchaseAmount: minPurchaseAmount !== '' ? Number(minPurchaseAmount) : undefined,
          maxDiscountAmount: type === 'percentage' && maxDiscountAmount !== '' ? Number(maxDiscountAmount) : undefined,
          usageLimit: usageLimit !== '' ? Number(usageLimit) : undefined,
          usedCount: 0,
          isActive,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          applicableProductIds: appliesToAll ? [] : [...selectedProductIds],
          description
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'خطا در ثبت کد تخفیف');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Search a discount through its code, products it applies to, and orders
  // that used it. This lets staff locate a campaign from a cake/product code,
  // an order code, or a customer's Telegram identity.
  const filteredDiscounts = discounts.filter((discount) => {
    const applicableProducts = !discount.applicableProductIds?.length
      ? products
      : products.filter((product) => discount.applicableProductIds?.includes(product.id));
    const linkedOrders = orders.filter((order) => order.couponCode === discount.code);
    const matchesSearch = matchesSearchValues(searchTerm, [
      discount.id,
      discount.code,
      discount.description,
      ...applicableProducts.flatMap((product) => [product.productCode, product.name, product.description]),
      ...linkedOrders.flatMap((order) => [
        order.orderNumber,
        order.id,
        order.customerName,
        order.customerUsername,
        order.customerTelegramName,
        order.customerTelegramId,
        ...(order.items || []).flatMap((item) => [item.productName, item.productCode]),
      ]),
    ]);
    const matchesType = typeFilter === 'all' || discount.type === typeFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && discount.isActive) ||
      (statusFilter === 'inactive' && !discount.isActive);
    return matchesSearch && matchesType && matchesStatus;
  });

  // Calculate Metrics
  const activeCount = discounts.filter(d => d.isActive).length;
  const totalUses = discounts.reduce((sum, d) => sum + (d.usedCount || 0), 0);
  const totalSavingsInOrders = orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20 ring-2 ring-white/10 shrink-0">
            <Ticket className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              مدیریت کدهای تخفیف و کوپن‌ها
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              تعریف کدهای تخفیف درصدی و مبلغی برای ترغیب مشتریان در ربات تلگرام و سبد خرید
            </p>
          </div>
        </div>

        <button
          id="btn-add-discount"
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-600 hover:to-rose-700 text-white font-medium rounded-xl shadow-lg shadow-rose-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>کد تخفیف جدید</span>
        </button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">کدهای فعال</div>
            <div className="text-lg font-bold text-white mt-0.5">
              {toPersianDigits(activeCount)} <span className="text-xs font-normal text-slate-400">از {toPersianDigits(discounts.length)}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">تعداد کل استفاده</div>
            <div className="text-lg font-bold text-white mt-0.5">
              {toPersianDigits(totalUses)} <span className="text-xs font-normal text-slate-400">بار</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">مجموع تخفیف‌های اعطا شده</div>
            <div className="text-lg font-bold text-amber-300 mt-0.5">
              {formatPrice(totalSavingsInOrders)}
            </div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">قابلیت در ربات</div>
            <div className="text-sm font-semibold text-purple-200 mt-0.5">
              دکمه شیشه‌ای سبد خرید
            </div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="کد تخفیف، محصول/کیک، کد سفارش یا نام و آیدی تلگرام مشتری..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pr-10 pl-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Type Filter */}
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                typeFilter === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              همه انواع
            </button>
            <button
              onClick={() => setTypeFilter('percentage')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                typeFilter === 'percentage' ? 'bg-amber-600/80 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              درصدی (%)
            </button>
            <button
              onClick={() => setTypeFilter('fixed')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                typeFilter === 'fixed' ? 'bg-rose-600/80 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              مبلغی (تومان)
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                statusFilter === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              همه
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                statusFilter === 'active' ? 'bg-emerald-600/80 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              فعال
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                statusFilter === 'inactive' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              غیرفعال
            </button>
          </div>
        </div>
      </div>

      {/* Discount Codes Grid / Cards */}
      {filteredDiscounts.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <Ticket className="w-12 h-12 mx-auto text-slate-600 mb-3 stroke-[1.5]" />
          <h3 className="text-base font-bold text-slate-200 mb-1">کد تخفیفی با این مشخصات یافت نشد</h3>
          <p className="text-xs text-slate-500 mb-4">می‌توانید فیلترها را تغییر داده یا کد تخفیف جدیدی ایجاد نمایید.</p>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-xl transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            افزودن اولین کد تخفیف
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
          {filteredDiscounts.map((discount) => {
            const isPercentage = discount.type === 'percentage';
            const isUsedUp = discount.usageLimit ? discount.usedCount >= discount.usageLimit : false;
            const isExpired = discount.expiresAt ? new Date(discount.expiresAt) < new Date() : false;
            const effectiveActive = discount.isActive && !isUsedUp && !isExpired;

            return (
              <div
                key={discount.id}
                className={`relative bg-slate-900 border rounded-2xl p-5 transition-all shadow-md overflow-hidden ${
                  effectiveActive 
                    ? 'border-slate-800 hover:border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950' 
                    : 'border-slate-800/60 opacity-75 bg-slate-950'
                }`}
              >
                {/* Decorative background badge */}
                <div className="absolute -left-6 -bottom-6 opacity-5 pointer-events-none">
                  <Ticket className="w-36 h-36" />
                </div>

                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    {/* Code Badge with Click-to-copy */}
                    <button
                      onClick={() => handleCopyCode(discount.code)}
                      title="کپی کردن کد"
                      className="group flex items-center gap-2 px-3.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl font-mono text-base font-bold text-amber-400 transition-all cursor-pointer shadow-inner"
                    >
                      <span>{discount.code}</span>
                      {copiedCode === discount.code ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-300" />
                      )}
                    </button>

                    {/* Type Tag */}
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${
                      isPercentage 
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {isPercentage ? 'درصدی' : 'مبلغ ثابت'}
                    </span>

                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${
                      discount.applicableProductIds && discount.applicableProductIds.length > 0
                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {discount.applicableProductIds && discount.applicableProductIds.length > 0
                        ? `🎯 ${toPersianDigits(discount.applicableProductIds.length)} محصول خاص`
                        : '🛒 همه محصولات'}
                    </span>
                  </div>

                  {/* Active / Inactive Status Switch */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onUpdateDiscount(discount.id, { isActive: !discount.isActive })}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        discount.isActive ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                      title={discount.isActive ? 'غیرفعال کردن کد' : 'فعال کردن کد'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          discount.isActive ? '-translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Main Value Display */}
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-black text-white">
                    {isPercentage ? `${toPersianDigits(discount.value)}٪` : formatPrice(discount.value)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {isPercentage 
                      ? (discount.maxDiscountAmount ? `(تا سقف ${formatPrice(discount.maxDiscountAmount)})` : 'بدون سقف') 
                      : 'تخفیف مستقیم از فاکتور'}
                  </span>
                </div>

                {/* Description */}
                {discount.description && (
                  <p className="text-xs text-slate-300 mb-3.5 leading-relaxed bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/40">
                    {discount.description}
                  </p>
                )}

                {/* Conditions & Details */}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 mb-4 pt-2 border-t border-slate-800/60">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>حداقل خرید: </span>
                    <strong className="text-slate-200 font-medium">
                      {discount.minPurchaseAmount ? formatPrice(discount.minPurchaseAmount) : 'بدون حداقل'}
                    </strong>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>تعداد استفاده: </span>
                    <strong className="text-slate-200 font-medium">
                      {toPersianDigits(discount.usedCount || 0)} {discount.usageLimit ? `/ ${toPersianDigits(discount.usageLimit)}` : 'بار'}
                    </strong>
                  </div>

                  {discount.expiresAt && (
                    <div className="flex items-center gap-1.5 col-span-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>انقضا: </span>
                      <strong className={`font-medium ${isExpired ? 'text-rose-400' : 'text-slate-200'}`}>
                        {formatDatePersian(discount.expiresAt)}
                        {isExpired && ' (منقضی شده)'}
                      </strong>
                    </div>
                  )}
                </div>

                {/* Usage Progress Bar (if limit exists) */}
                {discount.usageLimit && (
                  <div className="mb-4">
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          isUsedUp ? 'bg-rose-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, ((discount.usedCount || 0) / discount.usageLimit) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(discount)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-all"
                    >
                      <Edit3 className="w-3 h-3 text-slate-400" />
                      <span>ویرایش</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`آیا از حذف کد تخفیف «${discount.code}» اطمینان دارید؟`)) {
                          onDeleteDiscount(discount.id);
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-all border border-rose-500/20"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>حذف</span>
                    </button>
                  </div>

                  <button
                    onClick={() => handleCopyCode(discount.code)}
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium"
                  >
                    {copiedCode === discount.code ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> کپی شد
                      </span>
                    ) : (
                      <span>کپی جهت ارسال به مشتری</span>
                    )}
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Discount Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-scaleUp">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                  <Ticket className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    {editingDiscount ? 'ویرایش کد تخفیف' : 'ایجاد کد تخفیف جدید'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    تعیین شرایط و مقدار تخفیف برای سفارشات قنادی
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              
              {formError && (
                <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-3 rounded-xl text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Code Name & Quick Generator */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  کد تخفیف (لاتین یا فارسی) *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="مثال: EID1404 یا SHIRIN20"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-amber-300 placeholder-slate-600 uppercase focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setCode(generateRandomCode('BAHAR'))}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center gap-1.5 border border-slate-700"
                    title="تولید کد تصادفی"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>تولید خودکار</span>
                  </button>
                </div>
              </div>

              {/* Discount Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  نوع تخفیف *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setType('percentage')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                      type === 'percentage'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Percent className="w-4 h-4" />
                    <span>تخفیف درصدی (%)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setType('fixed')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                      type === 'fixed'
                        ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-md shadow-rose-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>مبلغ ثابت (تومان)</span>
                  </button>
                </div>
              </div>

              {/* Discount Value */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {type === 'percentage' ? 'درصد تخفیف (مثال: ۲۰)' : 'مبلغ تخفیف به تومان (مثال: ۵۰۰۰۰)'} *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      required
                      min={1}
                      max={type === 'percentage' ? 100 : undefined}
                      value={value || ''}
                      onChange={(e) => setValue(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                      {type === 'percentage' ? 'درصد ٪' : 'تومان'}
                    </span>
                  </div>
                </div>

                {type === 'percentage' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      سقف تخفیف (تومان - اختیاری)
                    </label>
                    <input
                      type="number"
                      placeholder="مثال: ۱۲۰۰۰۰"
                      value={maxDiscountAmount}
                      onChange={(e) => setMaxDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
              </div>

              {/* Applicable Products */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  🎯 این کد تخفیف روی چه محصولاتی اعمال شود؟
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAppliesToAll(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      appliesToAll
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    🛒 همه محصولات
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppliesToAll(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      !appliesToAll
                        ? 'bg-amber-600 text-white border-amber-500'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    🎯 فقط محصولات انتخابی
                  </button>
                </div>

                {!appliesToAll && (
                  <div className="space-y-2">
                    {products.length === 0 ? (
                      <p className="text-xs text-slate-500">محصولی برای انتخاب وجود ندارد.</p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{toPersianDigits(selectedProductIds.length)} محصول انتخاب شده</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedProductIds(products.map(p => p.id))}
                              className="text-amber-400 hover:text-amber-300 font-semibold"
                            >
                              انتخاب همه
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedProductIds([])}
                              className="text-slate-400 hover:text-slate-200 font-semibold"
                            >
                              پاک کردن
                            </button>
                          </div>
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-800/60">
                          {products.map(p => (
                            <label
                              key={p.id}
                              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-900/70"
                            >
                              <input
                                type="checkbox"
                                checked={selectedProductIds.includes(p.id)}
                                onChange={(e) =>
                                  setSelectedProductIds(prev =>
                                    e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id)
                                  )
                                }
                                className="w-4 h-4 accent-amber-500"
                              />
                              <span className="text-xs text-slate-200 flex-1">{p.name}</span>
                              <span className="text-[10px] text-slate-500">{p.category}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Minimum Purchase & Usage Limit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    حداقل مبلغ سفارش (تومان)
                  </label>
                  <input
                    type="number"
                    placeholder="مثال: ۲۵۰۰۰۰ (اختیاری)"
                    value={minPurchaseAmount}
                    onChange={(e) => setMinPurchaseAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    محدودیت تعداد استفاده (کل)
                  </label>
                  <input
                    type="number"
                    placeholder="مثال: ۱۰۰ بار (اختیاری)"
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Expiration Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  تاریخ انقضا (اختیاری)
                </label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  توضیحات یا پیام مناسبت
                </label>
                <textarea
                  rows={2}
                  placeholder="مثال: کد تخفیف ویژه اعضای ربات تلگرام برای شیرینی‌های پخت روز"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="text-xs">
                  <span className="font-semibold text-slate-200 block">وضعیت کد تخفیف</span>
                  <span className="text-slate-500">آیا این کد در حال حاضر برای مشتریان قابل استفاده باشد؟</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isActive ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isActive ? '-translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-all"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-600 hover:to-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'در حال ذخیره...' : (editingDiscount ? 'ذخیره تغییرات' : 'ایجاد و انتشار کد تخفیف')}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
