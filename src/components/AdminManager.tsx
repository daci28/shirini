import React, { useState } from 'react';
import { 
  ShieldCheck, 
  UserCheck, 
  Plus, 
  Trash2, 
  Crown, 
  Bot, 
  HelpCircle, 
  Key, 
  CheckCircle2, 
  AlertTriangle,
  User,
  ExternalLink,
  Lock,
  Layers,
  Sparkles
} from 'lucide-react';
import { BotSettings } from '../types';

interface AdminManagerProps {
  settings: BotSettings;
  onUpdateSettings: (newSettings: Partial<BotSettings>) => Promise<void>;
}

export const AdminManager: React.FC<AdminManagerProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [primaryAdminId, setPrimaryAdminId] = useState(settings.adminTelegramId || '');
  const [isSavingPrimary, setIsSavingPrimary] = useState(false);
  const [primarySaveStatus, setPrimarySaveStatus] = useState<string | null>(null);

  const [newAdminId, setNewAdminId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const adminIds = (settings.adminTelegramIds || []).map(String);

  const handleSavePrimaryAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPrimary(true);
    setPrimarySaveStatus(null);
    try {
      await onUpdateSettings({ adminTelegramId: primaryAdminId.trim() });
      setPrimarySaveStatus('شناسه مدیر اصلی با موفقیت بروزرسانی شد.');
      setTimeout(() => setPrimarySaveStatus(null), 3000);
    } catch (err: any) {
      setPrimarySaveStatus('خطا در ذخیره شناسه: ' + err.message);
    } finally {
      setIsSavingPrimary(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAdminId.trim();
    if (!trimmed) {
      setError('لطفاً شناسه عددی Telegram ID را وارد کنید.');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setError('شناسه تلگرام باید فقط شامل ارقام انگلیسی باشد (مثال: 123456789).');
      return;
    }
    if (adminIds.includes(trimmed) || trimmed === settings.adminTelegramId) {
      setError('این شناسه تلگرام در حال حاضر در لیست مدیران وجود دارد.');
      return;
    }

    setIsAdding(true);
    setError('');
    setSuccessMessage('');
    try {
      const updated = [...adminIds, trimmed];
      await onUpdateSettings({ adminTelegramIds: updated });
      setNewAdminId('');
      setSuccessMessage(`مدیر با شناسه ${trimmed} با موفقیت افزوده شد.`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError('خطا در افزودن مدیر: ' + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveAdmin = async (id: string) => {
    if (!window.confirm(`آیا از حذف دسترسی مدیریت برای شناسه ${id} اطمینان دارید؟`)) {
      return;
    }
    try {
      const updated = adminIds.filter((x) => x !== id);
      await onUpdateSettings({ adminTelegramIds: updated });
      setSuccessMessage(`دسترسی مدیر ${id} با موفقیت حذف شد.`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError('خطا در حذف مدیر: ' + err.message);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl text-slate-100">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>مدیریت دسترسی‌های پرسنل و ادمین‌ها</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            مدیران مجاز ربات تلگرام قنادی
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            کاربرانی که شناسه تلگرام آنها در این بخش ثبت شود، با ارسال دستور <code className="text-amber-300 font-mono">/start</code> یا <code className="text-amber-300 font-mono">/admin</code> در ربات تلگرام، به پنل مدیریت داخلی قنادی دسترسی خواهند داشت.
          </p>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex items-center gap-3 shrink-0 shadow-inner">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-lg">
            {1 + adminIds.length}
          </div>
          <div>
            <div className="text-xs font-bold text-white">تعداد کل مدیران</div>
            <div className="text-[11px] text-slate-400">۱ مدیر ارشد + {adminIds.length} همکار</div>
          </div>
        </div>
      </div>

      {/* Grid: Primary Admin & Add Secondary Admins */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Primary Admin (Super Admin) */}
        <div className="bg-slate-900 border border-amber-500/30 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">مدیر ارشد قنادی (Super Admin)</h3>
              <p className="text-[11px] text-slate-400">دریافت‌کننده اصلی اعلان‌ها و تایید سفارشات</p>
            </div>
          </div>

          <form onSubmit={handleSavePrimaryAdmin} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شناسه تلگرام مدیر ارشد (Telegram ID)
              </label>
              <input
                type="text"
                value={primaryAdminId}
                onChange={(e) => setPrimaryAdminId(e.target.value)}
                placeholder="مثال: 589412345"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono text-left"
                dir="ltr"
              />
            </div>

            {primarySaveStatus && (
              <p className="text-xs text-amber-300 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20">
                {primarySaveStatus}
              </p>
            )}

            <button
              type="submit"
              disabled={isSavingPrimary}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-amber-600/20 transition-all flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isSavingPrimary ? 'در حال ذخیره...' : 'ذخیره شناسه مدیر ارشد'}</span>
            </button>
          </form>
        </div>

        {/* Add Assistant / Staff Admin */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">افزودن مدیر جدید / پرسنل</h3>
              <p className="text-[11px] text-slate-400">اعطای دسترسی به ربات برای همکاران</p>
            </div>
          </div>

          <form onSubmit={handleAddAdmin} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شناسه عددی تلگرام پرسنل
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAdminId}
                  onChange={(e) => {
                    setNewAdminId(e.target.value);
                    setError('');
                  }}
                  placeholder="مثال: 987654321"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono text-left"
                  dir="ltr"
                />
                <button
                  type="submit"
                  disabled={isAdding}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>افزودن</span>
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            {successMessage && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{successMessage}</span>
              </p>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed">
              مدیران اضافه شده می‌توانند وضعیت سفارشات را از طریق تلگرام تغییر داده و فیش‌های ارسالی را تایید نمایند.
            </p>
          </form>
        </div>

      </div>

      {/* Admin List Cards */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">لیست تمامی مدیران فعال</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {1 + adminIds.length} حساب فعال
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          
          {/* Super Admin Card */}
          <div className="bg-gradient-to-b from-amber-500/10 to-slate-950/80 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Crown className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white">مدیر اصلی</span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 font-medium">
                    مالک
                  </span>
                </div>
                <div className="text-xs font-mono text-amber-300/90 truncate mt-0.5" dir="ltr">
                  {settings.adminTelegramId ? `ID: ${settings.adminTelegramId}` : 'تنظیم نشده'}
                </div>
              </div>
            </div>
            <div className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
              دسترسی کامل
            </div>
          </div>

          {/* Secondary Admins */}
          {adminIds.map((id) => (
            <div
              key={id}
              className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-3 transition shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">همکار / ادمین</span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 font-medium">
                      پرسنل
                    </span>
                  </div>
                  <div className="text-xs font-mono text-indigo-300/90 truncate mt-0.5" dir="ltr">
                    ID: {id}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleRemoveAdmin(id)}
                className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition shrink-0"
                title="حذف دسترسی مدیریت"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {adminIds.length === 0 && (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
              هنوز هیچ مدیر کمکی یا پرسنلی افزوده نشده است. شما می‌توانید با فرم بالا شناسه‌های همکاران را اضافه کنید.
            </div>
          )}

        </div>
      </div>

      {/* Guide: How to find Telegram ID */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-white font-bold text-xs">
          <HelpCircle className="w-4 h-4 text-amber-400" />
          <span>راهنمای دریافت شناسه عددی تلگرام (Telegram ID):</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-400">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">۱</span>
              <span>ربات UserInfoBot</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              در تلگرام به ربات <code className="text-amber-300 font-mono">@userinfobot</code> پیام <code className="text-amber-300 font-mono">/start</code> بفرستید تا شناسه عددی (Id) شما را ارسال کند.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-bold">۲</span>
              <span>کپی و ثبت شناسه</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              عدد چند رقمی (مثلاً <code className="text-indigo-300 font-mono">592819342</code>) را در فیلد بالا وارد کرده و دکمه «افزودن» را بزنید.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center font-bold">۳</span>
              <span>تست در ربات قنادی</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              اکنون با همان اکانت وارد ربات قنادی شوید؛ دکمه «👨‍🍳 پنل مدیریت» به منوی اصلی تلگرام اضافه خواهد شد.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};
