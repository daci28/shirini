import React, { useState } from 'react';
import { 
  Users, 
  Phone, 
  MapPin, 
  MessageCircle, 
  ShoppingBag, 
  Wallet, 
  Star, 
  Crown, 
  Award, 
  Search,
  Calendar,
  CreditCard,
  TrendingUp,
  User,
  Filter,
  Trash2,
  X,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  ChefHat,
  AlertCircle,
  Ban,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { CustomerUser, WalletTransaction, Order, CustomPastryOrder } from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';
import { matchesSearchValues } from '../utils/search';

interface CustomerManagerProps {
  customers: CustomerUser[];
  walletTransactions: WalletTransaction[];
  orders: Order[];
  customOrders?: CustomPastryOrder[];
  onAdjustWallet?: (customerId: string, amount: number, description: string) => Promise<void>;
  onSaveCustomer?: (data: { name: string; phone: string; address?: string; username?: string; telegramId?: string }) => Promise<void>;
  onUpdateCustomer?: (customerId: string, data: { name?: string; phone?: string; addresses?: string[] }) => Promise<CustomerUser | void>;
  onToggleBlockCustomer?: (customerId: string, blocked: boolean, reason?: string) => Promise<CustomerUser | void>;
}

export const CustomerManager: React.FC<CustomerManagerProps> = ({
  customers,
  walletTransactions,
  orders,
  customOrders = [],
  onAdjustWallet,
  onSaveCustomer,
  onUpdateCustomer,
  onToggleBlockCustomer
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerUser | null>(null);
  const [adjustingCustomer, setAdjustingCustomer] = useState<CustomerUser | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(50000);
  const [adjustReason, setAdjustReason] = useState<string>('شارژ هدیه وفاداری');
  const [showOnlyWithOrders, setShowOnlyWithOrders] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '', username: '', telegramId: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Blocking / unblocking state
  const [blockingCustomer, setBlockingCustomer] = useState<CustomerUser | null>(null);
  const [blockReason, setBlockReason] = useState<string>('');
  const [savingBlock, setSavingBlock] = useState(false);

  const [unblockingCustomer, setUnblockingCustomer] = useState<CustomerUser | null>(null);
  const [savingUnblock, setSavingUnblock] = useState(false);

  // Manual edit of an existing customer.
  const [editingCustomer, setEditingCustomer] = useState<CustomerUser | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', addressesText: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditCustomer = (customer: CustomerUser) => {
    const book = customer.addresses && customer.addresses.length
      ? customer.addresses
      : (customer.address ? [customer.address] : []);
    setEditingCustomer(customer);
    setEditForm({
      name: customer.name || '',
      phone: customer.phone || '',
      addressesText: book.join('\n'),
    });
  };

  const handleSaveEditCustomer = async () => {
    if (!editingCustomer || !onUpdateCustomer) return;
    if (!editForm.name.trim() || !editForm.phone.trim()) {
      alert('نام و شماره تلفن اجباری است.');
      return;
    }
    try {
      setSavingEdit(true);
      const updated = await onUpdateCustomer(editingCustomer.id, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        addresses: editForm.addressesText
          .split('\n')
          .map(a => a.trim())
          .filter(Boolean),
      });
      setEditingCustomer(null);
      if (updated) setSelectedCustomer(updated as CustomerUser);
    } catch (e: any) {
      alert('خطا در ذخیره تغییرات: ' + (e?.message || 'خطای ناشناخته'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveNewCustomer = async () => {
    if (!onSaveCustomer) return;
    if (!newCustomerForm.name.trim() || !newCustomerForm.phone.trim()) {
      alert('لطفاً نام و شماره تلفن کاربر را وارد کنید.');
      return;
    }
    try {
      setSavingCustomer(true);
      await onSaveCustomer({
        name: newCustomerForm.name.trim(),
        phone: newCustomerForm.phone.trim(),
        address: newCustomerForm.address.trim(),
        username: newCustomerForm.username.trim().replace(/^@/, ''),
        telegramId: newCustomerForm.telegramId.trim(),
      });
      setShowAddCustomer(false);
      setNewCustomerForm({ name: '', phone: '', address: '', username: '', telegramId: '' });
    } catch (e: any) {
      alert('خطا در ثبت کاربر: ' + (e?.message || 'خطای ناشناخته'));
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleConfirmBlock = async () => {
    if (!blockingCustomer || !onToggleBlockCustomer) return;
    try {
      setSavingBlock(true);
      const updated = await onToggleBlockCustomer(blockingCustomer.id, true, blockReason.trim());
      if (selectedCustomer && (selectedCustomer.id === blockingCustomer.id || String(selectedCustomer.telegramId) === String(blockingCustomer.telegramId))) {
        setSelectedCustomer(updated as CustomerUser || { ...selectedCustomer, isBlocked: true, blockedAt: new Date().toISOString(), blockedReason: blockReason.trim() });
      }
      setBlockingCustomer(null);
      setBlockReason('');
    } catch (e: any) {
      alert('خطا در مسدودسازی کاربر: ' + (e?.message || 'خطای ناشناخته'));
    } finally {
      setSavingBlock(false);
    }
  };

  const handleConfirmUnblock = async () => {
    if (!unblockingCustomer || !onToggleBlockCustomer) return;
    try {
      setSavingUnblock(true);
      const updated = await onToggleBlockCustomer(unblockingCustomer.id, false);
      if (selectedCustomer && (selectedCustomer.id === unblockingCustomer.id || String(selectedCustomer.telegramId) === String(unblockingCustomer.telegramId))) {
        setSelectedCustomer(updated as CustomerUser || { ...selectedCustomer, isBlocked: false, blockedAt: undefined, blockedReason: undefined });
      }
      setUnblockingCustomer(null);
    } catch (e: any) {
      alert('خطا در رفع مسدودی کاربر: ' + (e?.message || 'خطای ناشناخته'));
    } finally {
      setSavingUnblock(false);
    }
  };

  const getSourceBadge = (customer: CustomerUser) => {
    if (customer.source === 'manual' || String(customer.telegramId || '').startsWith('manual_')) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1">
          <User className="w-3 h-3" />
          دستی
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
        <MessageCircle className="w-3 h-3" />
        ربات
      </span>
    );
  };

  // Match a customer's full order history by Telegram ID first, then fall
  // back to contact details for older records created before IDs were saved.
  const getCustomerOrders = (customer: CustomerUser) => {
    return orders.filter((order) =>
      (order.customerTelegramId && String(order.customerTelegramId) === String(customer.telegramId)) ||
      (customer.phone && order.customerPhone === customer.phone) ||
      (customer.name && order.customerName === customer.name)
    );
  };

  const getCustomerCustomOrders = (customer: CustomerUser) => {
    return customOrders.filter((order) =>
      String(order.customerTelegramId) === String(customer.telegramId) ||
      (customer.phone && order.customerPhone === customer.phone) ||
      (customer.name && order.customerName === customer.name)
    );
  };

  // Search customer identity plus their order number/product information.
  const filteredCustomers = customers.filter((customer) => {
    const customerOrders = getCustomerOrders(customer);
    const customerCustomOrders = getCustomerCustomOrders(customer);
    const matchesSearch = matchesSearchValues(searchQuery, [
      customer.id,
      customer.name,
      customer.phone,
      customer.username,
      customer.telegramId,
      customer.address,
      ...customerOrders.flatMap((order) => [
        order.orderNumber,
        order.id,
        order.customerUsername,
        order.customerTelegramName,
        ...(order.items || []).flatMap((item) => [item.productName, item.productCode]),
      ]),
      ...customerCustomOrders.flatMap((order) => [
        order.orderNumber,
        order.id,
        order.customerUsername,
        order.customerTelegramName,
        order.pastryType,
        order.shapeAndDesign,
        order.writingOnCake,
      ]),
    ]);

    const matchesTier = selectedTier === 'all' || customer.tier === selectedTier;
    const matchesOrders = !showOnlyWithOrders || customer.totalOrdersCount > 0;
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'active' && !customer.isBlocked) || 
      (statusFilter === 'blocked' && Boolean(customer.isBlocked));

    return matchesSearch && matchesTier && matchesOrders && matchesStatus;
  });

  // Calculate totals
  const totalWalletBalance = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);
  const totalOrders = customers.reduce((sum, c) => sum + (c.totalOrdersCount || 0), 0);
  const totalSpent = customers.reduce((sum, c) => sum + (c.totalSpentTomans || 0), 0);
  const customersWithOrders = customers.filter(c => c.totalOrdersCount > 0).length;
  const newCustomers = customers.filter(c => c.totalOrdersCount === 0).length;
  const blockedCustomersCount = customers.filter(c => c.isBlocked).length;

  const handlePerformAdjust = async () => {
    if (!adjustingCustomer || !onAdjustWallet) return;
    try {
      await onAdjustWallet(adjustingCustomer.id, adjustAmount, adjustReason);
      setAdjustingCustomer(null);
      setAdjustAmount(50000);
      setAdjustReason('شارژ هدیه وفاداری');
    } catch (e: any) {
      alert('خطا در تغییر موجودی: ' + e.message);
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'vip': return <Crown className="w-4 h-4" />;
      case 'gold': return <Award className="w-4 h-4" />;
      case 'silver': return <Star className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'vip':
        return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
      case 'gold':
        return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
      case 'silver':
        return 'bg-slate-400/20 text-slate-200 border border-slate-400/30';
      default:
        return 'bg-slate-700 text-slate-300 border border-slate-600';
    }
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'vip': return 'VIP ویژه';
      case 'gold': return 'طلایی';
      case 'silver': return 'نقره‌ای';
      default: return 'برنزی';
    }
  };

  // Get wallet transactions for selected customer
  const getCustomerTransactions = (customerId: string) => {
    return walletTransactions.filter(t => t.customerId === customerId);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
      pending_payment: { label: 'در انتظار پرداخت', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: Clock },
      paid_checking: { label: 'بررسی فیش', color: 'bg-sky-500/20 text-sky-300 border-sky-500/30', icon: AlertCircle },
      receipt_confirmed: { label: 'فیش تأیید شده', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
      baking: { label: 'در حال پخت', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', icon: ChefHat },
      shipped: { label: 'ارسال شده', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30', icon: Truck },
      delivered: { label: 'تحویل شده', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
      cancelled: { label: 'لغو شده', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30', icon: XCircle }
    };

    const config = statusConfig[status] || statusConfig.pending_payment;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-900/40 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -translate-x-20 -translate-y-20 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                مدیریت مشتریان و کاربران ربات
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              پایگاه داده مشتریان، باشگاه وفاداری و مسدودسازی
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              مشاهده اطلاعات کامل مشتریان، موجودی کیف پول، تاریخچه خرید و تراکنش‌ها. امکان بلاک و رفع مسدودی کاربران، ویرایش مشخصات و شارژ کیف پول.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-indigo-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">کل مشتریان</span>
            <Users className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{toPersianDigits(customers.length)}</span>
            <span className="text-xs text-slate-400 mr-1">نفر</span>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-emerald-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">مشتریان دارای سفارش</span>
            <ShoppingBag className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-emerald-400">{toPersianDigits(customersWithOrders)}</span>
            <span className="text-xs text-slate-400 mr-1">نفر</span>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-rose-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">کاربران مسدود (بلاک)</span>
            <Ban className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <span className={`text-xl sm:text-2xl font-bold ${blockedCustomersCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {toPersianDigits(blockedCustomersCount)}
            </span>
            <span className="text-xs text-slate-400 mr-1">نفر</span>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-emerald-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">موجودی کیف‌پول‌ها</span>
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-lg sm:text-xl font-bold text-emerald-400">{formatPrice(totalWalletBalance)}</span>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-rose-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">کل سفارشات</span>
            <Package className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{toPersianDigits(totalOrders)}</span>
            <span className="text-xs text-slate-400 mr-1">سفارش</span>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 hover:border-pink-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">مجموع خریدها</span>
            <TrendingUp className="w-4 h-4 text-pink-400" />
          </div>
          <div>
            <span className="text-lg sm:text-xl font-bold text-white">{formatPrice(totalSpent)}</span>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="نام/یوزرنیم/آیدی تلگرام، شماره تلفن، کد سفارش یا محصول..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-10 pl-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
            />
          </div>
          
          <button
            onClick={() => setShowOnlyWithOrders(!showOnlyWithOrders)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              showOnlyWithOrders
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            فقط کاربران دارای سفارش
          </button>

          <button
            onClick={() => setShowAddCustomer(true)}
            className="px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white shadow-md"
          >
            <User className="w-4 h-4" />
            افزودن کاربر دستی
          </button>
        </div>

        {/* Filter Rows: Status and Tiers */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          {/* Status filter */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">وضعیت حساب:</span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                statusFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              همه ({toPersianDigits(customers.length)})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              فعال ({toPersianDigits(customers.length - blockedCustomersCount)})
            </button>
            <button
              onClick={() => setStatusFilter('blocked')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1 ${
                statusFilter === 'blocked'
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              <Ban className="w-3 h-3 text-rose-400" />
              <span>مسدود شده ({toPersianDigits(blockedCustomersCount)})</span>
            </button>
          </div>

          {/* Tier filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">سطح:</span>
            {['all', 'vip', 'gold', 'silver', 'bronze'].map((tier) => (
              <button
                key={tier}
                onClick={() => setSelectedTier(tier)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedTier === tier
                    ? 'bg-slate-700 text-white shadow-md border border-slate-600 font-bold'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {tier === 'all' ? 'همه' : getTierLabel(tier)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customers List */}
      {filteredCustomers.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
          <Users className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-base font-semibold text-slate-300">هیچ کاربری با این مشخصات یافت نشد.</p>
          <p className="text-xs">کاربران پس از استارت کردن ربات تلگرام یا ثبت سفارش به صورت خودکار اضافه می‌شوند.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredCustomers.map((customer) => {
            const customerOrders = getCustomerOrders(customer);
            return (
              <div
                key={customer.id}
                className={`bg-slate-900 border ${
                  customer.isBlocked 
                    ? 'border-rose-900/60 bg-gradient-to-b from-rose-950/20 to-slate-900 hover:border-rose-700/70' 
                    : 'border-slate-800 hover:border-slate-700'
                } rounded-2xl p-5 space-y-4 transition-all cursor-pointer relative overflow-hidden`}
                onClick={() => setSelectedCustomer(customer)}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${customer.isBlocked ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : getTierBadge(customer.tier)}`}>
                      {customer.isBlocked ? <Ban className="w-5 h-5 text-rose-400" /> : getTierIcon(customer.tier)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-base text-white">{customer.name || 'کاربر بدون نام'}</h3>
                        {customer.isBlocked && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                            <Ban className="w-3 h-3 text-rose-400" />
                            مسدود شده
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getTierBadge(customer.tier)}`}>
                          {getTierLabel(customer.tier)}
                        </span>
                        {getSourceBadge(customer)}
                        <span className="text-xs text-slate-400">@{customer.username || customer.telegramId}</span>
                      </div>
                    </div>
                  </div>
                  {customer.totalOrdersCount === 0 && (
                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      جدید
                    </span>
                  )}
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Phone className="w-3.5 h-3.5 text-sky-400" />
                    <span>{customer.phone || '---'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                    <span>{toPersianDigits(customer.totalOrdersCount)} سفارش</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-emerald-400">{formatPrice(customer.walletBalance)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                    <span>{toPersianDigits(customer.rewardPoints)} امتیاز</span>
                  </div>
                </div>

                {/* Block reason preview if blocked */}
                {customer.isBlocked && customer.blockedReason && (
                  <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-200 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>علت مسدودی: {customer.blockedReason}</span>
                  </div>
                )}

                {/* Address book */}
                {(customer.address || (customer.addresses && customer.addresses.length > 0)) && (
                  <div className="flex items-start gap-2 text-xs text-slate-400">
                    <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 min-w-0">
                      <span className="line-clamp-2 block">{customer.address}</span>
                      {(customer.addresses || []).length > 1 && (
                        <span className="text-[10px] text-slate-500">
                          {toPersianDigits((customer.addresses || []).length)} آدرس ثبت‌شده
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Recent Orders Preview */}
                {customerOrders.length > 0 && (
                  <div className="pt-3 border-t border-slate-800">
                    <p className="text-[11px] font-semibold text-slate-400 mb-2">آخرین سفارشات:</p>
                    <div className="space-y-1.5">
                      {customerOrders.slice(0, 2).map((order) => (
                        <div key={order.id} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-300 font-mono">{order.orderNumber}</span>
                          <span className="text-slate-400">{formatPrice(order.totalAmount)}</span>
                          {getStatusBadge(order.status)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800 gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Calendar className="w-3 h-3" />
                    <span>عضویت: {formatDatePersian(customer.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {customer.isBlocked ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUnblockingCustomer(customer);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-500/40 text-[11px] font-medium flex items-center gap-1 transition-all"
                        title="رفع مسدودی کاربر"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>رفع مسدودی</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setBlockingCustomer(customer);
                          setBlockReason('');
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 hover:border-rose-800/50 text-slate-400 border border-slate-700 text-[11px] font-medium flex items-center gap-1 transition-all"
                        title="مسدودسازی کاربر (بلاک)"
                      >
                        <Ban className="w-3 h-3 text-rose-400" />
                        <span>بلاک</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCustomer(customer);
                        openEditCustomer(customer);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white border border-indigo-500/40 text-[11px] font-medium flex items-center gap-1"
                    >
                      <User className="w-3 h-3" />
                      <span>ویرایش</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdjustingCustomer(customer);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-medium flex items-center gap-1"
                    >
                      <CreditCard className="w-3 h-3" />
                      <span>شارژ</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                مشخصات کامل مشتری
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditCustomer(selectedCustomer)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>ویرایش مشخصات</span>
                </button>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Blocked Status Banner inside Modal */}
            {selectedCustomer.isBlocked && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-300 text-sm">
                  <Ban className="w-4 h-4 text-rose-400" />
                  <span>حساب کاربری مسدود است</span>
                </div>
                <p className="text-[11px] text-rose-300/90 leading-relaxed">
                  دسترسی این کاربر به ربات تلگرام قطع شده است و امکان مشاهده منو، ثبت سفارش یا ارسال پیام به پشتیبانی را ندارد.
                </p>
                {selectedCustomer.blockedAt && (
                  <div className="text-[11px] text-slate-300">
                    📅 زمان مسدودسازی: <b>{formatDatePersian(selectedCustomer.blockedAt)}</b>
                  </div>
                )}
                {selectedCustomer.blockedReason && (
                  <div className="text-[11px] text-slate-300">
                    📌 علت مسدودسازی: <b>{selectedCustomer.blockedReason}</b>
                  </div>
                )}
              </div>
            )}

            {/* Customer Info Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">نام کامل:</span>
                <span className="font-bold text-white">{selectedCustomer.name}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">شماره تلفن:</span>
                <span className="font-bold text-white">{selectedCustomer.phone || '---'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">نام کاربری تلگرام:</span>
                <span className="font-bold text-sky-400">@{selectedCustomer.username || selectedCustomer.telegramId}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">شناسه تلگرام:</span>
                <span className="font-mono text-white">{selectedCustomer.telegramId}</span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-slate-400 block mb-1">موجودی کیف‌پول:</span>
                <span className="font-bold text-emerald-400">{formatPrice(selectedCustomer.walletBalance)} تومان</span>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <span className="text-slate-400 block mb-1">امتیاز وفاداری:</span>
                <span className="font-bold text-amber-400">{toPersianDigits(selectedCustomer.rewardPoints)} ⭐️</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">تعداد کل سفارشات:</span>
                <span className="font-bold text-white">{toPersianDigits(selectedCustomer.totalOrdersCount)} سفارش</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">مجموع خریدها:</span>
                <span className="font-bold text-white">{formatPrice(selectedCustomer.totalSpentTomans)} تومان</span>
              </div>
              <div className="col-span-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">دفترچه آدرس‌ها:</span>
                {(selectedCustomer.addresses && selectedCustomer.addresses.length > 0) ? (
                  <ul className="text-white space-y-1.5">
                    {selectedCustomer.addresses.map((addr, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs">
                        <MapPin className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${addr === selectedCustomer.address ? 'text-rose-400' : 'text-slate-600'}`} />
                        <span className={addr === selectedCustomer.address ? 'text-white font-semibold' : 'text-slate-300'}>
                          {addr}
                          {addr === selectedCustomer.address && <span className="text-[10px] text-rose-400 mr-2">(آخرین استفاده)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-white">{selectedCustomer.address || 'ثبت نشده'}</span>
                )}
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">وضعیت دسترسی:</span>
                {selectedCustomer.isBlocked ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    <Ban className="w-3.5 h-3.5 text-rose-400" />
                    مسدود شده (بلاک)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    فعال
                  </span>
                )}
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">سطح وفاداری:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getTierBadge(selectedCustomer.tier)}`}>
                  {getTierLabel(selectedCustomer.tier)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">منشأ کاربر:</span>
                <span className="inline-flex">{getSourceBadge(selectedCustomer)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block mb-1">تاریخ عضویت:</span>
                <span className="text-white">{formatDatePersian(selectedCustomer.createdAt)}</span>
              </div>
            </div>

            {/* Customer Orders */}
            {getCustomerOrders(selectedCustomer).length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  سفارشات مشتری ({getCustomerOrders(selectedCustomer).length})
                </h5>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {getCustomerOrders(selectedCustomer).map((order) => (
                    <div key={order.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-white">{order.orderNumber}</span>
                        {getStatusBadge(order.status)}
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>{formatDatePersian(order.createdAt)}</span>
                        <span className="font-bold text-amber-400">{formatPrice(order.totalAmount)} تومان</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {order.items.map((item, idx) => (
                          <span key={idx}>
                            {item.productName} ({item.quantity} {item.unit}){idx < order.items.length - 1 ? '، ' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Wallet Transactions */}
            {getCustomerTransactions(selectedCustomer.id).length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-bold text-white flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  تاریخچه تراکنش‌های کیف‌پول
                </h5>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {getCustomerTransactions(selectedCustomer.id).map((tx) => (
                    <div key={tx.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-300">{tx.description}</span>
                        <span className={`font-bold ${tx.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {tx.amount > 0 ? '+' : ''}{formatPrice(tx.amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{formatDatePersian(tx.createdAt)}</span>
                        <span>موجودی پس از: {formatPrice(tx.balanceAfter)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800 flex-wrap">
              <div>
                {selectedCustomer.isBlocked ? (
                  <button
                    type="button"
                    onClick={() => setUnblockingCustomer(selectedCustomer)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>رفع مسدودی کاربر</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setBlockingCustomer(selectedCustomer);
                      setBlockReason('');
                    }}
                    className="px-4 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>مسدودسازی کاربر (بلاک)</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  بستن
                </button>
                <button
                  onClick={() => {
                    openEditCustomer(selectedCustomer);
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>ویرایش مشخصات</span>
                </button>
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setAdjustingCustomer(selectedCustomer);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>شارژ کیف‌پول</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Block Customer Modal */}
      {blockingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Ban className="w-4 h-4 text-rose-400" />
                مسدودسازی کاربر ({blockingCustomer.name || 'بدون نام'})
              </h4>
              <button
                onClick={() => setBlockingCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200 leading-relaxed">
              ⚠️ با مسدود کردن این کاربر، دسترسی وی به تمامی منوها و سفارش‌گیری در ربات تلگرام قطع خواهد شد و سبد خرید فعال او پاک می‌گردد.
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">شناسه تلگرام:</span>
                <span className="font-mono">{blockingCustomer.telegramId || '---'}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">شماره تلفن:</span>
                <span>{blockingCustomer.phone || '---'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                علت مسدودسازی (اختیاری):
              </label>
              <textarea
                rows={3}
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="مثال: ارسال فیش نامعتبر / ثبت سفارشات جعلی / درخواست مشتری..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs leading-6 focus:border-rose-500 focus:outline-none"
              />

              {/* Quick preset reason chips */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-slate-400">انتخاب سریع:</span>
                {[
                  'ارسال فیش واریزی نامعتبر',
                  'ثبت سفارش غیرواقعی و جعلی',
                  'عدم پاسخگویی و مزاحمت',
                  'درخواست شخصی کاربر',
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setBlockReason(reason)}
                    className="px-2 py-1 rounded-lg text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBlockingCustomer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={savingBlock}
                onClick={handleConfirmBlock}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{savingBlock ? 'در حال اعمال...' : 'مسدود کردن کاربر'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock Customer Modal */}
      {unblockingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                رفع مسدودی کاربر ({unblockingCustomer.name || 'بدون نام'})
              </h4>
              <button
                onClick={() => setUnblockingCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200 leading-relaxed">
              آیا از رفع مسدودی کاربر <b>{unblockingCustomer.name}</b> اطمینان دارید؟ با تأیید این عملیات، دسترسی کاربر به تمامی امکانات ربات مجدداً برقرار خواهد شد.
            </div>

            {unblockingCustomer.blockedReason && (
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <span className="text-slate-400 block text-[11px]">علت مسدودی قبلی:</span>
                <span className="text-rose-300 font-semibold">{unblockingCustomer.blockedReason}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUnblockingCustomer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={savingUnblock}
                onClick={handleConfirmUnblock}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{savingUnblock ? 'در حال اعمال...' : 'تأیید و رفع مسدودی'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Wallet Modal */}
      {adjustingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                شارژ کیف‌پول ({adjustingCustomer.name})
              </h4>
              <button
                onClick={() => setAdjustingCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>موجودی فعلی:</span>
                <span className="font-bold text-emerald-400">{formatPrice(adjustingCustomer.walletBalance)} تومان</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">مبلغ تغییر (تومان - منفی برای کسر):</label>
              <input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(Number(e.target.value))}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">علت تغییر:</label>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdjustingCustomer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handlePerformAdjust}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                اعمال در کیف‌پول
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-400" />
                ویرایش مشخصات کاربر ({editingCustomer.name})
              </h4>
              <button onClick={() => setEditingCustomer(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              از این بخش فقط <b>نام</b>، <b>شماره تلفن</b> و <b>آدرس</b> کاربر قابل تغییر است. تغییرات بلافاصله در پروفایل ربات هم اعمال می‌شود.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">نام و نام خانوادگی <span className="text-rose-400">*</span></label>
                <input type="text" value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">شماره تلفن <span className="text-rose-400">*</span></label>
                <input type="tel" value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  dir="ltr"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono text-left focus:border-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">آدرس (برای چند آدرس، هر آدرس را در یک خط بنویسید):</label>
                <textarea rows={4} value={editForm.addressesText}
                  onChange={(e) => setEditForm({ ...editForm, addressesText: e.target.value })}
                  placeholder={"آدرس فعلی\nآدرس دوم (اختیاری)"}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs leading-6 focus:border-indigo-500 focus:outline-none" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingCustomer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">
                انصراف
              </button>
              <button type="button" disabled={savingEdit} onClick={handleSaveEditCustomer}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50">
                {savingEdit ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-400" />
                افزودن کاربر به صورت دستی
              </h4>
              <button
                onClick={() => setShowAddCustomer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              برای مشتری‌ای که از بیرون ربات سفارش می‌دهد (حضوری/تلفنی) یک پروفایل کاربری بسازید. این کاربر در فهرست «دستی» نمایش داده می‌شود و اگر بعداً همان شخص از ربات استفاده کند، پروفایل‌ها بر اساس شماره تلفن/آیدی تلگرام یکپارچه می‌شوند.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">نام و نام خانوادگی <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  value={newCustomerForm.name}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                  placeholder="مثال: علی رضایی"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">شماره تلفن <span className="text-rose-400">*</span></label>
                <input
                  type="tel"
                  value={newCustomerForm.phone}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
                  placeholder="09121234567"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">آدرس:</label>
                <textarea
                  rows={2}
                  value={newCustomerForm.address}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })}
                  placeholder="آدرس دقیق (اختیاری)"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">یوزرنیم تلگرام:</label>
                  <input
                    type="text"
                    value={newCustomerForm.username}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, username: e.target.value })}
                    placeholder="@username (اختیاری)"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">آیدی عددی تلگرام:</label>
                  <input
                    type="text"
                    value={newCustomerForm.telegramId}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, telegramId: e.target.value })}
                    placeholder="اختیاری"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={savingCustomer}
                onClick={handleSaveNewCustomer}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {savingCustomer ? 'در حال ثبت...' : 'ثبت کاربر'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
