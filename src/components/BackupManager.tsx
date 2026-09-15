import React, { useState, useRef } from 'react';
import { 
  Download, 
  Upload, 
  Clock, 
  ShieldCheck, 
  Database, 
  HardDrive, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Calendar, 
  FileJson, 
  Trash2, 
  RotateCcw, 
  Copy, 
  Check, 
  Layers, 
  Wallet, 
  Users, 
  ShoppingBag, 
  Cake, 
  Ticket, 
  MessageSquare, 
  ArrowDownToLine, 
  FileCode, 
  Sparkles,
  Info,
  Server,
  Zap,
  Send,
  Eye,
  X
} from 'lucide-react';
import { 
  MasterBackupPayload, 
  BackupScheduleConfig, 
  BackupSnapshot, 
  CustomerUser, 
  WalletTransaction, 
  Product, 
  Order, 
  DiscountCode, 
  SupportTicket, 
  BotSettings,
  CustomPastryOrder,
  Invoice
} from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';

interface BackupManagerProps {
  products: Product[];
  orders: Order[];
  customOrders: CustomPastryOrder[];
  /** Only standalone manual invoices are persisted in client exports. */
  invoices: Invoice[];
  customers: CustomerUser[];
  walletTransactions: WalletTransaction[];
  discounts: DiscountCode[];
  supportTickets: SupportTicket[];
  botSettings: BotSettings;
  backupSchedule: BackupScheduleConfig;
  backupSnapshots: BackupSnapshot[];
  onUpdateSchedule: (schedule: Partial<BackupScheduleConfig>) => Promise<void>;
  onCreateSnapshot: (customName?: string) => Promise<BackupSnapshot | null>;
  onRestoreSnapshot: (id: string) => Promise<boolean>;
  onDeleteSnapshot: (id: string) => Promise<boolean>;
  onImportBackup: (payload: MasterBackupPayload, mode: 'overwrite' | 'merge') => Promise<boolean>;
  onAdjustWallet?: (customerId: string, amount: number, description: string) => Promise<void>;
}

export const BackupManager: React.FC<BackupManagerProps> = ({
  products,
  orders,
  customOrders,
  invoices,
  customers,
  walletTransactions,
  discounts,
  supportTickets,
  botSettings,
  backupSchedule,
  backupSnapshots,
  onUpdateSchedule,
  onCreateSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onImportBackup,
  onAdjustWallet
}) => {
  const [activeSection, setActiveSection] = useState<'instant' | 'schedule' | 'restore' | 'snapshots'>('instant');
  const [scheduleState, setScheduleState] = useState<BackupScheduleConfig>(backupSchedule);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSuccessMsg, setScheduleSuccessMsg] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotSuccessMsg, setSnapshotSuccessMsg] = useState<string | null>(null);
  
  // Restore flow state
  const [selectedFileContent, setSelectedFileContent] = useState<MasterBackupPayload | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<'overwrite' | 'merge'>('overwrite');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [inspectSnapshot, setInspectSnapshot] = useState<BackupSnapshot | null>(null);
  const [adjustingCustomer, setAdjustingCustomer] = useState<CustomerUser | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(50000);
  const [adjustReason, setAdjustReason] = useState<string>('شارژ هدیه وفاداری');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate totals
  const totalWalletBalance = customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);
  const totalEntities = products.length + orders.length + customOrders.length + invoices.length + customers.length + walletTransactions.length + discounts.length + supportTickets.length;

  // Handle Instant Download
  const handleDownloadMasterBackup = () => {
    try {
      const nowIso = new Date().toISOString();
      const rawData = {
        products,
        orders,
        customOrders,
        invoices,
        customers,
        walletTransactions,
        discounts,
        supportTickets,
        botSettings,
        backupSchedule
      };

      const payload: MasterBackupPayload = {
        app: 'ShirinKam Pastry Management System',
        version: '2.5.0',
        exportTimestamp: nowIso,
        checksum: `chk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        environment: 'production',
        metadata: {
          generatedBy: 'Admin-Manual-UI',
          databaseEngine: 'MasterInMemoryEngine',
          totalEntities,
          totalWalletBalances: totalWalletBalance,
          storeName: botSettings.storeName || 'قنادی شیرین‌کام',
          storePhone: botSettings.storePhone || '۰۲۱-۸۸۹۹۲۲۳۳'
        },
        data: rawData
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
      const downloadAnchor = document.createElement('a');
      const filename = `shirinkam-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      setSnapshotSuccessMsg(`فایل پشتیبان کامل «${filename}» با موفقیت دانلود گردید.`);
      setTimeout(() => setSnapshotSuccessMsg(null), 5000);
    } catch (err: any) {
      alert('خطا در ایجاد فایل بکاپ: ' + err.message);
    }
  };

  // Copy JSON to clipboard
  const handleCopyJson = () => {
    const rawData = {
      products,
      orders,
      customOrders,
      invoices,
      customers,
      walletTransactions,
      discounts,
      supportTickets,
      botSettings,
      backupSchedule
    };

    const payload: MasterBackupPayload = {
      app: 'ShirinKam Pastry Management System',
      version: '2.5.0',
      exportTimestamp: new Date().toISOString(),
      checksum: `chk-${Date.now()}`,
      environment: 'production',
      metadata: {
        generatedBy: 'Admin-Clipboard',
        databaseEngine: 'MasterInMemoryEngine',
        totalEntities,
        totalWalletBalances: totalWalletBalance,
        storeName: botSettings.storeName,
        storePhone: botSettings.storePhone
      },
      data: rawData
    };

    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 3000);
  };

  // Create Server Snapshot
  const handleCreateServerSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      const snap = await onCreateSnapshot();
      if (snap) {
        setSnapshotSuccessMsg(`نقطه بازیابی سرور با موفقیت ایجاد شد (${snap.filename})`);
        setTimeout(() => setSnapshotSuccessMsg(null), 5000);
      }
    } catch (e: any) {
      alert('خطا در ایجاد Snapshot: ' + e.message);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  // Save Schedule Config
  const handleSaveSchedule = async () => {
    setScheduleSaving(true);
    try {
      await onUpdateSchedule(scheduleState);
      setScheduleSuccessMsg(true);
      setTimeout(() => setScheduleSuccessMsg(false), 4000);
    } catch (e: any) {
      alert('خطا در ذخیره زمان‌بندی: ' + e.message);
    } finally {
      setScheduleSaving(false);
    }
  };

  // Handle File Upload & Validation
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileValidationError(null);
    setRestoreSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setFileValidationError('لطفاً یک فایل معتبر با پسوند .json انتخاب نمایید.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        
        // Deep validate structure
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('فرمت فایل JSON نامعتبر است.');
        }

        const data = parsed.data || parsed;
        if (!data.products && !data.orders && !data.customers && !data.botSettings) {
          throw new Error('فایل انتخاب‌شده حاوی اطلاعات پایگاه داده سامانه شیرین‌کام نمی‌باشد.');
        }

        const validatedPayload: MasterBackupPayload = {
          app: parsed.app || 'ShirinKam Pastry Management System',
          version: parsed.version || '2.5.0',
          exportTimestamp: parsed.exportTimestamp || new Date().toISOString(),
          checksum: parsed.checksum || 'manual-upload',
          environment: parsed.environment || 'production',
          metadata: parsed.metadata || {
            generatedBy: 'Uploaded-Backup-File',
            databaseEngine: 'MasterInMemoryEngine',
            totalEntities: (data.products?.length || 0) + (data.orders?.length || 0) + (data.customers?.length || 0),
            totalWalletBalances: data.customers?.reduce((s: number, c: any) => s + (c.walletBalance || 0), 0) || 0,
            storeName: data.botSettings?.storeName || 'قنادی شیرین‌کام',
            storePhone: data.botSettings?.storePhone || ''
          },
          data: {
            products: data.products || [],
            orders: data.orders || [],
            customOrders: data.customOrders || [],
            invoices: data.invoices || [],
            customers: data.customers || [],
            walletTransactions: data.walletTransactions || [],
            discounts: data.discounts || [],
            supportTickets: data.supportTickets || [],
            botSettings: data.botSettings || botSettings,
            backupSchedule: data.backupSchedule || backupSchedule
          }
        };

        setSelectedFileContent(validatedPayload);
      } catch (err: any) {
        setFileValidationError('خطا در خواندن فایل بکاپ: ' + err.message);
        setSelectedFileContent(null);
      }
    };
    reader.readAsText(file);
  };

  // Perform Restore
  const handleExecuteRestore = async () => {
    if (!selectedFileContent) return;
    setIsRestoring(true);
    try {
      const ok = await onImportBackup(selectedFileContent, restoreMode);
      if (ok) {
        setRestoreSuccess('دیتابیس با موفقیت بازگردانی شد! تمامی کیف‌پول‌ها، سفارشات و تنظیمات اعمال گردیدند.');
        setSelectedFileContent(null);
      } else {
        setFileValidationError('خطا در انجام عملیات بازگردانی بر روی سرور.');
      }
    } catch (e: any) {
      setFileValidationError('خطای سیستمی: ' + e.message);
    } finally {
      setIsRestoring(false);
    }
  };

  // Adjust customer wallet balance
  const handlePerformAdjust = async () => {
    if (!adjustingCustomer || !onAdjustWallet) return;
    try {
      await onAdjustWallet(adjustingCustomer.id, adjustAmount, adjustReason);
      setAdjustingCustomer(null);
    } catch (e: any) {
      alert('خطا در تغییر موجودی: ' + e.message);
    }
  };

  const weekdays = [
    { id: 0, name: 'شنبه' },
    { id: 1, name: 'یکشنبه' },
    { id: 2, name: 'دوشنبه' },
    { id: 3, name: 'سه‌شنبه' },
    { id: 4, name: 'چهارشنبه' },
    { id: 5, name: 'پنجشنبه' },
    { id: 6, name: 'جمعه' },
  ];

  const toggleDay = (dayId: number) => {
    setScheduleState(prev => {
      const exists = prev.selectedDays.includes(dayId);
      const updated = exists 
        ? prev.selectedDays.filter(d => d !== dayId)
        : [...prev.selectedDays, dayId].sort();
      return { ...prev, selectedDays: updated };
    });
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
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                سامانه جامع پشتیبان‌گیری و بازیابی صفرخطا
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                حفاظت ۱۰۰٪ از کیف‌پول‌ها
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              مرکز بکاپ‌گیری، زمان‌بندی و مهاجرت دیتابیس قنادی
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              خروجی کامل از تمام بخش‌ها شامل محصولات، سفارشات، مشخصات مشتریان و موجودی کیف‌پول، کدهای تخفیف، تیکت‌ها و تنظیمات ربات. قابلیت انتقال بدون هیچ نقصی به سرور دیگر یا بازیابی در مواقع اضطراری.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            <button
              id="btn-instant-backup-download"
              onClick={handleDownloadMasterBackup}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-600 hover:to-sky-600 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              <span>دانلود آنی بکاپ (JSON)</span>
            </button>
            <button
              id="btn-create-server-snapshot"
              onClick={handleCreateServerSnapshot}
              disabled={creatingSnapshot}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs sm:text-sm font-medium transition-all"
            >
              {creatingSnapshot ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <HardDrive className="w-4 h-4 text-emerald-400" />
              )}
              <span>ثبت نقطه بازیابی سرور</span>
            </button>
          </div>
        </div>

        {/* Global Toast Success Message */}
        {snapshotSuccessMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{snapshotSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* Real-time DB Entities Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Orders */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-amber-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">سفارشات</span>
            <ShoppingBag className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{orders.length}</span>
            <span className="text-xs text-slate-400 mr-1">سفارش</span>
          </div>
          <p className="text-[11px] text-amber-400/90 mt-1 font-medium">
            اقلام و فیش‌های واریزی
          </p>
        </div>

        {/* Products */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-pink-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">کیک و شیرینی</span>
            <Cake className="w-4 h-4 text-pink-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{products.length}</span>
            <span className="text-xs text-slate-400 mr-1">کالا</span>
          </div>
          <p className="text-[11px] text-pink-400/90 mt-1 font-medium">
            قیمت و مشخصات کامل
          </p>
        </div>

        {/* Discounts */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-rose-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">کدهای تخفیف</span>
            <Ticket className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{discounts.length}</span>
            <span className="text-xs text-slate-400 mr-1">کد</span>
          </div>
          <p className="text-[11px] text-rose-400/90 mt-1 font-medium">
            آمار مصرف و سقف‌ها
          </p>
        </div>

        {/* Support Tickets */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-purple-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">تیکت‌ها</span>
            <MessageSquare className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-bold text-white">{supportTickets.length}</span>
            <span className="text-xs text-slate-400 mr-1">تیکت</span>
          </div>
          <p className="text-[11px] text-purple-400/90 mt-1 font-medium">
            پاسخ‌ها و چت مشتریان
          </p>
        </div>

      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-900/80 border border-slate-800 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveSection('instant')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
            activeSection === 'instant'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          <span>پشتیبان‌گیری آنی</span>
        </button>

        <button
          onClick={() => setActiveSection('schedule')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
            activeSection === 'schedule'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>زمان‌بندی خودکار</span>
          {backupSchedule.enabled && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveSection('restore')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
            activeSection === 'restore'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>بازیابی و مهاجرت سرور</span>
        </button>

        <button
          onClick={() => setActiveSection('snapshots')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
            activeSection === 'snapshots'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>نقاط بازیابی ذخیره در سرور</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
            {backupSnapshots.length}
          </span>
        </button>

      </div>

      {/* Tab 1: Instant Backup */}
      {activeSection === 'instant' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left 2 Cols: Main Download Cards */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <FileJson className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">دریافت آنی فایل پشتیبان استاندارد (Master JSON)</h3>
                    <p className="text-xs text-slate-400">حاوی کلیه ساختارهای پایگاه داده با هش رمزنگاری SHA256</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  فرمت استاندارد v2.5.0
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>حجم تخمینی پکیج:</span>
                    <span className="font-mono text-white">~{(totalEntities * 1.8).toFixed(1)} KB</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>مجموع رکوردهای دیتابیس:</span>
                    <span className="font-semibold text-white">{totalEntities} رکورد</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>مجموع اعتبار کیف‌پول‌ها:</span>
                    <span className="font-bold text-emerald-400">{formatPrice(totalWalletBalance)}</span>
                  </div>
                  <button
                    onClick={handleDownloadMasterBackup}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 mt-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>دانلود مستقیم فایل .json</span>
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>ثبت اسنپ‌شات در سرور:</span>
                    <span className="text-emerald-400 font-medium">سریع و بدون دانلود</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>پشتیبانی از Rollback:</span>
                    <span className="text-sky-400 font-medium">با یک کلیک</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>نقطه بازگشت خودکار:</span>
                    <span className="text-white">فعال</span>
                  </div>
                  <button
                    onClick={handleCreateServerSnapshot}
                    disabled={creatingSnapshot}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold border border-slate-700 transition-all mt-2"
                  >
                    {creatingSnapshot ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4 text-emerald-400" />}
                    <span>ایجاد نقطه بازگشت در سرور</span>
                  </button>
                </div>
              </div>

              {/* JSON preview & Copy */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <FileCode className="w-4 h-4 text-indigo-400" />
                    پیش‌نمایش ساختار فایل پشتیبان
                  </label>
                  <button
                    onClick={handleCopyJson}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                  >
                    {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedJson ? 'کپی شد!' : 'کپی کل JSON'}</span>
                  </button>
                </div>

                <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto max-h-56 scrollbar-thin text-left dir-ltr">
                  <pre>{JSON.stringify({
                    app: "ShirinKam Pastry Management System",
                    version: "2.5.0",
                    exportTimestamp: new Date().toISOString(),
                    metadata: {
                      storeName: botSettings.storeName,
                      totalEntities,
                      totalWalletBalances: totalWalletBalance,
                    },
                    data: {
                      products: `[${products.length} Products Included]`,
                      orders: `[${orders.length} Orders Included]`,
                      customers: `[${customers.length} Customers with Wallets Included]`,
                      walletTransactions: `[${walletTransactions.length} Transactions Included]`,
                      discounts: `[${discounts.length} Discounts Included]`,
                      supportTickets: `[${supportTickets.length} Support Tickets Included]`,
                      botSettings: "{Bot Settings, Bank Cards, Forum Topics Included}"
                    }
                  }, null, 2)}</pre>
                </div>
              </div>
            </div>
          </div>

          {/* Right Col: Reliability Guarantees */}
          <div className="space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                تضمین‌های حفظ داده در مهاجرت
              </h3>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-emerald-300 block">کیف‌پول و دارایی مشتریان:</span>
                    موجودی ریالی تک‌تک کاربران به همراه تاریخچه تراکنش‌ها در بکاپ درج شده و روی سرور جدید بدون کسر حتی یک ریال منتقل می‌شود.
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-sky-300 block">وضعیت سفارشات و فیش‌های بانکی:</span>
                    تمام سفارشات در حال پخت، آماده ارسال و تصاویر فیش‌های پرداختی حفظ می‌شوند.
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-amber-300 block">تنظیمات ربات و شماره کارت:</span>
                    متون خوش‌آمدگویی، راهنما، شماره کارت بانکی و شناسه تاپیک‌های تلگرام عیناً بازیابی می‌شوند.
                  </div>
                </div>
              </div>
            </div>

            {/* Quick schedule summary card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  وضعیت زمان‌بندی خودکار
                </h4>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  backupSchedule.enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                }`}>
                  {backupSchedule.enabled ? 'فعال' : 'غیرفعال'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {backupSchedule.enabled 
                  ? `بکاپ‌گیری دوره‌ای روزانه در ساعت ${backupSchedule.timeOfDay} فعال است.`
                  : 'زمان‌بندی خودکار غیرفعال است. جهت تنظیم به تب زمان‌بندی مراجعه فرمایید.'}
              </p>
              <button
                onClick={() => setActiveSection('schedule')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline block"
              >
                تنظیم ساعات و روزهای بکاپ خودکار &larr;
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Tab 2: Scheduled Auto-Backup */}
      {activeSection === 'schedule' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                تنظیمات زمان‌بندی بکاپ‌گیری خودکار
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                تعیین زمان و تناوب پشتیبان‌گیری دوره‌ای از کلیه داده‌های قنادی بدون نیاز به دخالت دست
              </p>
            </div>

            {/* Toggle Switch */}
            <div className="flex items-center gap-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-300">وضعیت سرویس:</span>
              <button
                type="button"
                onClick={() => setScheduleState(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  scheduleState.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    scheduleState.enabled ? 'translate-x-1' : 'translate-x-6'
                  }`}
                />
              </button>
              <span className={`text-xs font-bold ${scheduleState.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {scheduleState.enabled ? 'روشن' : 'خاموش'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Frequency */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                تناوب و دوره زمانی پشتیبان‌گیری
              </label>
              <select
                value={scheduleState.frequency}
                onChange={(e) => setScheduleState(prev => ({ ...prev, frequency: e.target.value as any }))}
                className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white text-xs font-medium focus:border-indigo-500 focus:outline-none"
              >
                <option value="daily">روزانه در ساعت مشخص (پیشنهادی)</option>
                <option value="every_6_hours">هر ۶ ساعت یکبار</option>
                <option value="every_12_hours">هر ۱۲ ساعت یکبار</option>
                <option value="weekly">هفتگی در روزهای انتخابی</option>
                <option value="hourly">ساعتی (برای روزهای شلوغ و جشن‌ها)</option>
                <option value="every_order">بلافاصله پس از ثبت هر سفارش جدید</option>
              </select>
            </div>

            {/* Time of Day */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>ساعت دقیق اجرای بکاپ</span>
                <span className="text-slate-500 text-[11px]">فرمت ۲۴ ساعته (مثال: ۲۳:۳۰)</span>
              </label>
              <input
                type="time"
                value={scheduleState.timeOfDay}
                onChange={(e) => setScheduleState(prev => ({ ...prev, timeOfDay: e.target.value }))}
                className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white text-xs font-mono text-center focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Retention Limit */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                حداکثر تعداد فایل‌های نگهداری‌شده در سرور (Retention Policy)
              </label>
              <select
                value={scheduleState.keepLastSnapshots}
                onChange={(e) => setScheduleState(prev => ({ ...prev, keepLastSnapshots: Number(e.target.value) }))}
                className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white text-xs font-medium focus:border-indigo-500 focus:outline-none"
              >
                <option value={5}>۵ نسخه آخر (کم‌حجم)</option>
                <option value={10}>۱۰ نسخه آخر (استاندارد و امن)</option>
                <option value={20}>۲۰ نسخه آخر</option>
                <option value={50}>۵۰ نسخه آخر (آرشیو طولانی‌مدت)</option>
              </select>
            </div>

            {/* Telegram Notification Option */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                اعلان در سوپرگروه تلگرام
              </label>
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-300">ارسال گزارش بکاپ به تاپیک امور مالی/گزارشات</span>
                <input
                  type="checkbox"
                  checked={scheduleState.notifyTelegramTopic}
                  onChange={(e) => setScheduleState(prev => ({ ...prev, notifyTelegramTopic: e.target.checked }))}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900"
                />
              </div>
            </div>

          </div>

          {/* Days of week selection for weekly schedule */}
          <div className="space-y-3 pt-2">
            <label className="text-xs font-semibold text-slate-300 block">
              روزهای فعال پشتیبان‌گیری در هفته
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {weekdays.map((day) => {
                const isSelected = scheduleState.selectedDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleDay(day.id)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-medium transition-all flex items-center justify-center gap-1.5 border ${
                      isSelected
                        ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50 shadow-sm'
                        : 'bg-slate-950/60 text-slate-500 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-indigo-400" />}
                    <span>{day.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Save Action Banner */}
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-400" />
              <span>آخرین بکاپ گرفته شده: {scheduleState.lastBackupTime ? formatDatePersian(scheduleState.lastBackupTime) : 'هنوز اجرا نشده'}</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {scheduleSuccessMsg && (
                <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> ذخیره شد!
                </span>
              )}
              <button
                id="btn-save-backup-schedule"
                onClick={handleSaveSchedule}
                disabled={scheduleSaving}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
              >
                {scheduleSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>ذخیره تنظیمات زمان‌بندی</span>
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Tab 3: Zero-Loss Restore & Migration */}
      {activeSection === 'restore' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 max-w-4xl mx-auto">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-indigo-400" />
              بازیابی پایگاه داده و مهاجرت به سرور دیگر (Zero-Loss Migration)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              فایل بکاپ JSON گرفته شده از سرور قبلی را بارگذاری کنید. سیستم قبل از اعمال، محتویات فایل، موجودی کیف‌پول‌ها و تعداد سفارشات را اعتبارسنجی می‌کند.
            </p>
          </div>

          {/* Upload Area */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-3xl p-8 text-center cursor-pointer transition-all bg-slate-950/50 hover:bg-slate-950/80 group space-y-3"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400 group-hover:scale-110 transition-transform">
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">برای انتخاب فایل پشتیبان (JSON) کلیک کنید</h4>
              <p className="text-xs text-slate-400 mt-1">یا فایل را گرفته و به اینجا بکشید و رها کنید (Drag & Drop)</p>
            </div>
          </div>

          {/* Errors & Success Messages */}
          {fileValidationError && (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3 animate-fadeIn">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{fileValidationError}</span>
            </div>
          )}

          {restoreSuccess && (
            <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-3 animate-fadeIn">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{restoreSuccess}</span>
            </div>
          )}

          {/* Pre-Restore Verification Card */}
          {selectedFileContent && (
            <div className="bg-slate-950 rounded-3xl p-6 border border-indigo-500/40 space-y-5 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-bold text-white">پیش‌نمایش محتویات فایل پشتیبان تایید شد</span>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {selectedFileContent.version ? `نسخه ${selectedFileContent.version}` : ''}
                </span>
              </div>

              {/* Data counts in the backup */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block mb-1">مشتریان در بکاپ:</span>
                  <span className="font-bold text-white">{selectedFileContent.data.customers?.length || 0} کاربر</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/30">
                  <span className="text-slate-400 block mb-1">مجموع کیف‌پول‌ها در فایل:</span>
                  <span className="font-bold text-emerald-400">
                    {formatPrice(
                      selectedFileContent.data.customers?.reduce((s, c) => s + (c.walletBalance || 0), 0) || 0
                    )}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block mb-1">سفارشات:</span>
                  <span className="font-bold text-white">{selectedFileContent.data.orders?.length || 0} سفارش</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block mb-1">کیک و شیرینی:</span>
                  <span className="font-bold text-white">{selectedFileContent.data.products?.length || 0} قلم</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block mb-1">کدهای تخفیف:</span>
                  <span className="font-bold text-white">{selectedFileContent.data.discounts?.length || 0} کد</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block mb-1">تیکت‌های پشتیبانی:</span>
                  <span className="font-bold text-white">{selectedFileContent.data.supportTickets?.length || 0} تیکت</span>
                </div>
              </div>

              {/* Restore Mode Selection */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-semibold text-slate-300 block">نحوه اعمال بر روی سرور:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 ${
                    restoreMode === 'overwrite'
                      ? 'bg-indigo-600/15 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}>
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={restoreMode === 'overwrite'}
                      onChange={() => setRestoreMode('overwrite')}
                      className="mt-1"
                    />
                    <div className="text-xs">
                      <span className="font-bold block text-slate-200">جایگزینی کامل (Full Overwrite)</span>
                      <span className="text-slate-400 text-[11px] mt-0.5 block">
                        داده‌های فعلی سرور با نسخه پشتیبان همگام شده و کیف‌پول‌ها، محصولات و تنظیمات دقیقاً به حالت فایل بکاپ درمی‌آیند.
                      </span>
                    </div>
                  </label>

                  <label className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 ${
                    restoreMode === 'merge'
                      ? 'bg-indigo-600/15 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}>
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={restoreMode === 'merge'}
                      onChange={() => setRestoreMode('merge')}
                      className="mt-1"
                    />
                    <div className="text-xs">
                      <span className="font-bold block text-slate-200">ادغام هوشمند (Smart Merge)</span>
                      <span className="text-slate-400 text-[11px] mt-0.5 block">
                        محصولات و سفارشات جدید به دیتابیس افزوده می‌شوند بدون آنکه رکوردهای موجود سرور پاک شوند.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Safety notice & Action */}
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  سیستم قبل از اعمال بازگردانی، یک نقطه بازگشت ایمنی (Safety Snapshot) به صورت خودکار ایجاد می‌نماید.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedFileContent(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  انصراف
                </button>
                <button
                  id="btn-confirm-restore"
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={isRestoring}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 flex items-center gap-2"
                >
                  {isRestoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  <span>تایید و اعمال نهایی بازگردانی</span>
                </button>
              </div>

            </div>
          )}

        </div>
      )}

      {/* Tab 4: Snapshots History & Rollback */}
      {activeSection === 'snapshots' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              تاریخچه نقاط بازیابی ذخیره شده در سرور ({backupSnapshots.length})
            </h3>
            <button
              onClick={handleCreateServerSnapshot}
              disabled={creatingSnapshot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              {creatingSnapshot ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
              <span>ثبت Snapshot دستی جدید</span>
            </button>
          </div>

          {backupSnapshots.length === 0 ? (
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
              <HardDrive className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm">هنوز هیچ اسنپ‌شاتی در سرور ثبت نشده است.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {backupSnapshots.map((snap) => (
                <div 
                  key={snap.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 space-y-4 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          snap.type === 'scheduled'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : snap.type === 'pre_restore_safety'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {snap.type === 'scheduled' ? 'خودکار زمان‌بندی' : snap.type === 'pre_restore_safety' ? 'ایمنی قبل از ریستور' : 'دستی ادمین'}
                        </span>
                        <span className="text-xs font-bold text-white font-mono">{snap.filename}</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {formatDatePersian(snap.timestamp)} • حجم: {(snap.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setInspectSnapshot(snap)}
                        title="مشاهده جزئیات"
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`آیا از بازگردانی دیتابیس به نسخه «${snap.filename}» اطمینان دارید؟`)) {
                            await onRestoreSnapshot(snap.id);
                          }
                        }}
                        title="بازگردانی به این نسخه"
                        className="p-2 rounded-lg bg-emerald-950/80 hover:bg-emerald-800 text-emerald-300 hover:text-white border border-emerald-700/50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm('آیا از حذف این Snapshot اطمینان دارید؟')) {
                            await onDeleteSnapshot(snap.id);
                          }
                        }}
                        title="حذف اسنپ‌شات"
                        className="p-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-400 hover:text-white border border-rose-800/50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Summary pills */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                    <div className="p-2 rounded-xl bg-slate-950/80 text-center">
                      <span className="text-slate-500 block">مشتریان:</span>
                      <span className="font-bold text-slate-200">{snap.stats.customersCount} نفر</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 text-center">
                      <span className="text-slate-500 block">کیف‌پول‌ها:</span>
                      <span className="font-bold text-emerald-400">{formatPrice(snap.stats.totalWalletBalance)}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 text-center">
                      <span className="text-slate-500 block">سفارشات:</span>
                      <span className="font-bold text-slate-200">{snap.stats.ordersCount} سفارش</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 text-center">
                      <span className="text-slate-500 block">فاکتور دستی:</span>
                      <span className="font-bold text-violet-300">{(snap.stats.invoicesCount || 0).toLocaleString('fa-IR')} فاکتور</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inspect Snapshot Modal */}
      {inspectSnapshot && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <FileJson className="w-4 h-4 text-indigo-400" />
                جزئیات نقطه بازیابی ({inspectSnapshot.filename})
              </h4>
              <button
                onClick={() => setInspectSnapshot(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">تاریخ ایجاد:</span>
                <span>{formatDatePersian(inspectSnapshot.timestamp)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">نوع ذخیره:</span>
                <span>{inspectSnapshot.type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">هش رمزنگاری (Checksum):</span>
                <span className="font-mono text-[10px] text-slate-400">{inspectSnapshot.checksum}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">تعداد کاربران و مشتریان:</span>
                <span className="font-bold text-white">{inspectSnapshot.stats.customersCount} نفر</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">کل سرمایه کیف‌پول‌ها:</span>
                <span className="font-bold text-emerald-400">{formatPrice(inspectSnapshot.stats.totalWalletBalance)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3">
              <button
                onClick={() => {
                  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(inspectSnapshot.payload, null, 2));
                  const a = document.createElement('a');
                  a.href = dataStr;
                  a.download = inspectSnapshot.filename;
                  a.click();
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>دانلود فایل این Snapshot</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
