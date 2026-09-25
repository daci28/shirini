import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Bot, 
  CreditCard, 
  Truck, 
  Phone, 
  MapPin, 
  Send, 
  Check, 
  ShieldCheck, 
  Sparkles, 
  AlertCircle,
  ExternalLink,
  MessageSquare,
  Hash,
  Layers,
  ShoppingBag,
  Ticket,
  BarChart3,
  RefreshCw,
  Zap,
  HelpCircle,
  Globe,
  Lock,
  User,
  Key,
  Copy,
  Eye,
  EyeOff,
  Radio,
  Plus,
  Trash2,
  Clock,
  Timer
} from 'lucide-react';
import { BotSettings, ForumTopicConfig, RequiredChannel, CustomerUser } from '../types';
import { CustomerBroadcastPanel } from './CustomerBroadcastPanel';
import { INITIAL_FORUM_TOPICS } from '../data/initialData';
import { formatPrice } from '../utils/formatters';

type SettingsUpdate = Partial<BotSettings> & { clearTelegramBotToken?: boolean };

interface BotSettingsProps {
  settings: BotSettings;
  onUpdateSettings: (newSettings: SettingsUpdate) => Promise<void>;
  /** Customer database, used to target broadcasts. */
  customers?: CustomerUser[];
}

export const BotSettingsComponent: React.FC<BotSettingsProps> = ({
  settings,
  onUpdateSettings,
  customers = [],
}) => {
  // Secrets are deliberately omitted from GET /settings. Empty write-only
  // fields mean "keep the configured secret", not "clear it".
  const [formData, setFormData] = useState<BotSettings>({
    ...settings,
    webAdminPassword: '',
    telegramBotToken: '',
  });

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      ...settings,
      webAdminPassword: prev.webAdminPassword,
      telegramBotToken: prev.telegramBotToken,
    }));
  }, [settings]);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [clearTelegramBotToken, setClearTelegramBotToken] = useState(false);

  // Forum topics states
  const [isSettingUpTopics, setIsSettingUpTopics] = useState(false);
  const [topicSetupResult, setTopicSetupResult] = useState<string | null>(null);
  const [sendingTopicKey, setSendingTopicKey] = useState<string | null>(null);
  const [topicReportStatus, setTopicReportStatus] = useState<{ key: string; message: string } | null>(null);

  // Web Admin Panel credentials states
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleInputChange = (field: keyof BotSettings, value: any) => {
    if (field === 'telegramBotToken' && String(value).trim()) {
      setClearTelegramBotToken(false);
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const requiredChannels: RequiredChannel[] = formData.requiredChannels || [];

  const updateRequiredChannels = (next: RequiredChannel[]) => {
    handleInputChange('requiredChannels', next);
  };

  const addRequiredChannel = () => {
    updateRequiredChannels([
      ...requiredChannels,
      {
        id: `chan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        chatId: '',
        title: '',
        inviteLink: '',
        enabled: true,
      },
    ]);
  };

  const patchRequiredChannel = (id: string, patch: Partial<RequiredChannel>) => {
    updateRequiredChannels(requiredChannels.map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)));
  };

  const removeRequiredChannel = (id: string) => {
    updateRequiredChannels(requiredChannels.filter((channel) => channel.id !== id));
  };

  const [channelCheck, setChannelCheck] = useState<{ chatId: string; ok: boolean; message: string }[] | null>(null);
  const [isCheckingChannels, setIsCheckingChannels] = useState(false);

  const verifyRequiredChannels = async () => {
    setIsCheckingChannels(true);
    setChannelCheck(null);
    try {
      const res = await fetch('/api/telegram/verify-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channels: requiredChannels.filter((c) => c.enabled !== false) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChannelCheck([{ chatId: '', ok: false, message: data?.error || 'بررسی ناموفق بود.' }]);
        return;
      }
      setChannelCheck(data.results || []);
    } catch {
      setChannelCheck([{ chatId: '', ok: false, message: 'ارتباط با سرور برقرار نشد.' }]);
    } finally {
      setIsCheckingChannels(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const {
        webAdminPassword,
        telegramBotToken,
        hasTelegramBotToken: _hasTelegramBotToken,
        ...safeSettings
      } = formData;
      const updates: SettingsUpdate = { ...safeSettings };
      // Never submit a blank secret: write-only fields intentionally start
      // empty when the server withholds the currently configured value.
      if (webAdminPassword?.trim()) updates.webAdminPassword = webAdminPassword;
      if (telegramBotToken?.trim()) {
        updates.telegramBotToken = telegramBotToken.trim();
        updates.isLiveBotActive = true;
      }
      if (clearTelegramBotToken) {
        updates.clearTelegramBotToken = true;
        updates.isLiveBotActive = false;
      }
      await onUpdateSettings(updates);
      setFormData((previous) => ({
        ...previous,
        webAdminPassword: '',
        telegramBotToken: '',
      }));
      setClearTelegramBotToken(false);
      setShowPassword(false);
      alert('تنظیمات ربات قنادی با موفقیت ذخیره شد.');
    } catch (err) {
      console.error(err);
      // Surface the server's reason (e.g. an invalid required-channel id),
      // otherwise a rejected save looks like the deployment is broken.
      const reason = err instanceof Error && err.message ? err.message : '';
      alert(reason ? `ذخیره تنظیمات ناموفق بود:\n\n${reason}` : 'ذخیره تنظیمات ناموفق بود. لطفاً دوباره تلاش کنید.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestBotConnection = async () => {
    const typedToken = formData.telegramBotToken?.trim();
    if (!typedToken && !settings.hasTelegramBotToken) {
      setTestResult({
        success: false,
        message: 'لطفاً توکن ربات تلگرام را ابتدا وارد کنید.',
      });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/telegram/test-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: typedToken || undefined }),
      });
      const data = (await res.json()) as any;
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? 'اتصال با موفقیت برقرار شد!' : 'خطا در اتصال.'),
      });
      if (data.success && data.bot?.username) {
        setFormData((prev) => ({
          ...prev,
          botUsername: data.bot.username,
          botName: data.bot.first_name || prev.botName,
          isLiveBotActive: true,
        }));
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'خطا در ارتباط با سرور: ' + err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSetupAllForumTopics = async () => {
    if (!formData.forumGroupId) {
      alert('لطفاً ابتدا شناسه گروه تاپیک‌دار (Group Chat ID) را وارد نمایید یا از دکمه شبیه‌سازی اتصال استفاده کنید.');
      return;
    }
    setIsSettingUpTopics(true);
    setTopicSetupResult(null);
    try {
      const res = await fetch('/api/telegram/forum/setup-all-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: formData.forumGroupId,
          title: formData.forumGroupTitle,
          token: formData.telegramBotToken?.trim() || undefined,
        }),
      });
      const data = (await res.json()) as any;
      if (data.success) {
        setFormData((prev) => ({
          ...prev,
          forumTopics: data.topics,
        }));
        await onUpdateSettings({
          forumGroupId: formData.forumGroupId,
          forumGroupTitle: formData.forumGroupTitle,
          forumTopics: data.topics,
        });
        setTopicSetupResult(data.message || 'تاپیک‌ها با موفقیت ایجاد و تنظیم شدند.');
      } else {
        setTopicSetupResult('خطا: ' + (data.message || 'عدم دسترسی ربات به گروه'));
      }
    } catch (err: any) {
      setTopicSetupResult('خطا در برقراری ارتباط: ' + err.message);
    } finally {
      setIsSettingUpTopics(false);
    }
  };

  const handleSimulateGroupAdd = async () => {
    setIsSettingUpTopics(true);
    setTopicSetupResult(null);
    try {
      const res = await fetch('/api/telegram/forum/simulate-group-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: formData.forumGroupId || '-1002849173620',
          title: formData.forumGroupTitle || `سوپرگروه مدیریت ${formData.storeName || 'فروشگاه'}`,
        }),
      });
      const data = (await res.json()) as any;
      if (data.success) {
        setFormData((prev) => ({
          ...prev,
          forumGroupId: data.groupId,
          forumGroupTitle: data.groupTitle,
          forumTopics: data.topics,
        }));
        await onUpdateSettings({
          forumGroupId: data.groupId,
          forumGroupTitle: data.groupTitle,
          forumTopics: data.topics,
        });
        setTopicSetupResult(data.message || 'ربات با موفقیت متصل شد و تمام تاپیک‌ها خودکار ایجاد شدند.');
      } else {
        setTopicSetupResult('خطا: ' + (data.message || 'خطا در شبیه‌سازی'));
      }
    } catch (err: any) {
      setTopicSetupResult('خطا در اتصال: ' + err.message);
    } finally {
      setIsSettingUpTopics(false);
    }
  };

  const handleSendTopicTestReport = async (key: string) => {
    setSendingTopicKey(key);
    setTopicReportStatus(null);
    try {
      const res = await fetch('/api/telegram/forum/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = (await res.json()) as any;
      if (data.success) {
        setTopicReportStatus({
          key,
          message: data.message || 'گزارش با موفقیت در تاپیک ارسال شد.',
        });
        if (formData.forumTopics) {
          const updated = formData.forumTopics.map((t) =>
            t.key === key
              ? {
                  ...t,
                  lastReportTime: new Date().toISOString(),
                  lastReportSummary: data.reportMessage?.replace(/<[^>]*>?/gm, '').slice(0, 100) + '...',
                }
              : t
          );
          setFormData((prev) => ({ ...prev, forumTopics: updated }));
          await onUpdateSettings({ forumTopics: updated });
        }
      } else {
        setTopicReportStatus({ key, message: 'خطا: ' + data.message });
      }
    } catch (err: any) {
      setTopicReportStatus({ key, message: 'خطا: ' + err.message });
    } finally {
      setSendingTopicKey(null);
    }
  };

  const existingTopicKeys = new Set((formData.forumTopics || []).map((t) => t.key));
  const defaultTopicsList: ForumTopicConfig[] = [
    ...(formData.forumTopics || []),
    ...INITIAL_FORUM_TOPICS.filter((t) => !existingTopicKeys.has(t.key)),
  ];

  const handleToggleTopic = async (key: string) => {
    const updated = defaultTopicsList.map((t) =>
      t.key === key ? { ...t, autoReport: !t.autoReport, enabled: !t.enabled } : t
    );
    setFormData((prev) => ({ ...prev, forumTopics: updated }));
    await onUpdateSettings({ forumTopics: updated });
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl text-slate-100">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-semibold">
            <Bot className="w-3.5 h-3.5" />
            <span>پیکربندی ربات تلگرام و قنادی</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            اتصال به سوپرگروه تاپیک‌دار، توکن، حساب بانکی و ارسال
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            شما می‌توانید ربات را به یک گروه تاپیک‌دار متصل کرده تا گزارشات هر بخش (سفارشات آماده، کیک دلخواه، امور مالی، انبار و محصولات، مشتریان، تخفیف‌ها، پشتیبانی و بکاپ سیستم) در ۸ تاپیک اختصاصی ثبت شود.
          </p>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        
        {/* Telegram Forum Topics Supergroup Connection */}
        <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl p-6 shadow-xl space-y-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shadow-md shadow-indigo-500/10">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">اتصال خودکار به سوپرگروه تاپیک‌دار تلگرام (۸ تاپیک تفکیک‌شده)</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    گزارشات زنده و تفکیک‌شده
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  ساخت اتوماتیک تاپیک‌ها به محض افزودن و ادمین کردن ربات در گروه + ارسال لحظه‌ای فاکتورها، واریزی‌ها و انبارداری
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSimulateGroupAdd}
                disabled={isSettingUpTopics}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-indigo-500/30 text-indigo-300 hover:text-white font-bold text-xs shadow-md transition-all flex items-center gap-2"
                title="شبیه‌سازی اضافه شدن بات به سوپرگروه و ساخت فوری ۸ تاپیک"
              >
                <Zap className={`w-4 h-4 text-amber-400 ${isSettingUpTopics ? 'animate-bounce' : ''}`} />
                <span>تست اتصال خودکار به گروه</span>
              </button>

              <button
                type="button"
                onClick={handleSetupAllForumTopics}
                disabled={isSettingUpTopics}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2"
              >
                <Sparkles className={`w-4 h-4 ${isSettingUpTopics ? 'animate-spin' : ''}`} />
                <span>{isSettingUpTopics ? 'در حال ساخت تاپیک‌ها...' : '✨ ایجاد دستی تاپیک‌ها در گروه'}</span>
              </button>
            </div>
          </div>

          {/* Automated Process Visual Steps */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-indigo-400" />
                <span>نحوه اتصال کاملاً خودکار بات به سوپرگروه تلگرام:</span>
              </span>
              <span className="text-[11px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 font-medium">
                سیستم هوشمند Auto-Topic
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  ۱
                </div>
                <div>
                  <h5 className="font-bold text-white text-xs">افزودن بات به سوپرگروه</h5>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    ربات <code className="text-indigo-300 font-mono">@{formData.botUsername || 'shirinkam_bot'}</code> را به گروه پرسنل یا مدیران قنادی دعوت کنید.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  ۲
                </div>
                <div>
                  <h5 className="font-bold text-white text-xs">ارتقا به مدیر (Admin)</h5>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    به ربات دسترسی ادمین با مجوز <code className="text-purple-300 font-mono">Manage Topics</code> بدهید.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  ۳
                </div>
                <div>
                  <h5 className="font-bold text-white text-xs">ساخت خودکار ۸ تاپیک</h5>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    ربات در همان لحظه تاپیک‌ها را می‌سازد و کلیه رویدادهای زنده به تاپیک مربوطه استریم می‌شوند.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Group Chat ID input & helper */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شناسه سوپرگروه تاپیک‌دار (Chat ID گروه)
              </label>
              <input
                type="text"
                value={formData.forumGroupId || ''}
                onChange={(e) => handleInputChange('forumGroupId', e.target.value)}
                placeholder="مثال: -1002345678901 یا @shirinkam_staff"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono text-left"
                dir="ltr"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                با اضافه کردن ربات به گروه یا زدن دستور <code className="text-indigo-300 font-mono">/setup_topics</code> در گروه، به صورت خودکار پر می‌شود.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                عنوان گروه تاپیک‌دار قنادی
              </label>
              <input
                type="text"
                value={formData.forumGroupTitle || ''}
                onChange={(e) => handleInputChange('forumGroupTitle', e.target.value)}
                placeholder="گروه هماهنگی و مدیریت فروشگاه"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                نام نمایشی گروه جهت تفکیک گزارشات و مدیریت تیم
              </p>
            </div>
          </div>

          {topicSetupResult && (
            <div className="p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2 animate-fadeIn">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="leading-relaxed">{topicSetupResult}</span>
            </div>
          )}

          {/* Topics Grid Cards */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Hash className="w-3.5 h-3.5 text-indigo-400" />
              <span>تاپیک‌های تفکیک‌شده متصل به ربات:</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {defaultTopicsList.map((topic) => {
                const isSending = sendingTopicKey === topic.key;
                const statusMsg = topicReportStatus?.key === topic.key ? topicReportStatus.message : null;

                return (
                  <div
                    key={topic.id}
                    className={`bg-slate-950/70 border rounded-2xl p-4 transition-all flex flex-col justify-between gap-3 ${
                      topic.enabled
                        ? 'border-slate-800 hover:border-slate-700'
                        : 'border-slate-900 opacity-60'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{topic.iconEmoji}</span>
                          <div>
                            <h5 className="text-xs font-bold text-white">{topic.name}</h5>
                            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                              Thread #{topic.threadId || '---'}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleTopic(topic.key)}
                          className={`w-9 h-5 rounded-full transition-colors relative p-0.5 flex items-center ${
                            topic.enabled ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'
                          }`}
                          title={topic.enabled ? 'گزارش خودکار فعال است' : 'گزارش خودکار غیرفعال است'}
                        >
                          <span className="w-4 h-4 rounded-full bg-white block shadow-sm" />
                        </button>
                      </div>

                      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                        {topic.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      {topic.lastReportError && (
                        <div className="text-[10px] text-rose-200 bg-rose-950/40 p-2 rounded-lg border border-rose-800/60">
                          <span className="font-semibold">⚠️ گزارش ارسال نشد: </span>
                          <span className="break-words">{topic.lastReportError}</span>
                          <span className="block mt-1 text-rose-300/80">
                            معمولاً یعنی تاپیک پاک شده یا ربات ادمین گروه نیست. در گروه دستور /setup_topics را بزنید.
                          </span>
                        </div>
                      )}

                      {topic.lastReportSummary && (
                        <div className="text-[10px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800 truncate">
                          <span className="text-slate-400 font-semibold">آخرین اعلان: </span>
                          <span className="text-slate-300">{topic.lastReportSummary}</span>
                        </div>
                      )}

                      {statusMsg && (
                        <p className="text-[10px] text-emerald-400 bg-emerald-500/10 p-1.5 rounded border border-emerald-500/20">
                          {statusMsg}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => handleSendTopicTestReport(topic.key)}
                        disabled={isSending}
                        className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 border border-slate-700"
                      >
                        <Send className={`w-3 h-3 rotate-180 ${isSending ? 'animate-bounce' : ''}`} />
                        <span>{isSending ? 'در حال ارسال...' : 'ارسال گزارش آزمایشی به این تاپیک'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        
        {/* Telegram Bot Token Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">اتصال به ربات واقعی تلگرام</h3>
              <p className="text-xs text-slate-400">توکن ارائه‌شده توسط @BotFather در تلگرام</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="telegram-bot-token">
                توکن ربات تلگرام (Telegram Bot Token)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="telegram-bot-token"
                  type="password"
                  autoComplete="new-password"
                  value={formData.telegramBotToken || ''}
                  onChange={(e) => handleInputChange('telegramBotToken', e.target.value)}
                  placeholder={settings.hasTelegramBotToken ? 'برای جایگزینی، توکن جدید را وارد کنید' : 'مثال: 1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ'}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleTestBotConnection}
                  disabled={isTesting || clearTelegramBotToken}
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all shrink-0 flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/20 disabled:opacity-50"
                >
                  {isTesting ? <span>در حال بررسی...</span> : <span>تست اتصال توکن</span>}
                </button>
              </div>
              {settings.hasTelegramBotToken && (
                <p className="mt-2 text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  یک توکن در سرور تنظیم شده است و برای امنیت نمایش داده نمی‌شود.
                </p>
              )}
              {settings.hasTelegramBotToken && !formData.telegramBotToken?.trim() && (
                <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-rose-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearTelegramBotToken}
                    onChange={(event) => setClearTelegramBotToken(event.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-rose-500 focus:ring-rose-500"
                  />
                  حذف توکن ذخیره‌شده در سرور هنگام ذخیره تنظیمات
                </label>
              )}
            </div>

            {testResult && (
              <div
                className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                {testResult.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              💡 <b>راهنمای ساخت ربات:</b> در تلگرام به ربات <code>@BotFather</code> پیام داده و دستور <code>/newbot</code> را بزنید. سپس توکن ارائه‌شده را در کادر بالا کپی کنید تا ربات تلگرامی قنادی شما مستقیماً فعال شود.
            </div>
          </div>
        </div>

        {/* Store & Banking Information */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">مشخصات فروشگاه و حساب بانکی جهت واریز</h3>
              <p className="text-xs text-slate-400">این اطلاعات در فاکتور تلگرام به مشتری نمایش داده می‌شود</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                نام فروشگاه قنادی
              </label>
              <input
                type="text"
                value={formData.storeName}
                onChange={(e) => handleInputChange('storeName', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شماره تلفن سفارشات و پشتیبانی
              </label>
              <input
                type="text"
                value={formData.storePhone}
                onChange={(e) => handleInputChange('storePhone', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شناسه تلگرام مدیر اصلی (Telegram ID)
              </label>
              <input
                type="text"
                value={formData.adminTelegramId || ''}
                onChange={(e) => handleInputChange('adminTelegramId', e.target.value)}
                placeholder="مثال: 589412345 (از @userinfobot)"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono text-left"
                dir="ltr"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                دسترسی کامل به دستورات ادمین و اعلان‌های آنی ربات
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                شماره کارت بانکی (جهت کارت به کارت)
              </label>
              <input
                type="text"
                value={formData.cardNumber}
                onChange={(e) => handleInputChange('cardNumber', e.target.value)}
                placeholder="6037-xxxx-xxxx-xxxx"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono text-left"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                نام صاحب حساب کارت
              </label>
              <input
                type="text"
                value={formData.cardHolder}
                onChange={(e) => handleInputChange('cardHolder', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                آدرس حضوری قنادی
              </label>
              <input
                type="text"
                value={formData.storeAddress}
                onChange={(e) => handleInputChange('storeAddress', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Shipping & Delivery Settings */}
        {/* Forced channel membership */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">عضویت اجباری در کانال</h3>
                <p className="text-xs text-slate-400">مشتری تا عضو کانال‌های زیر نشود نمی‌تواند از ربات استفاده کند</p>
              </div>
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer shrink-0">
              <span className={`text-xs font-semibold ${formData.requiredChannelsEnabled ? 'text-sky-300' : 'text-slate-400'}`}>
                {formData.requiredChannelsEnabled ? 'فعال' : 'غیرفعال'}
              </span>
              <span className="relative inline-flex">
                <input
                  type="checkbox"
                  checked={Boolean(formData.requiredChannelsEnabled)}
                  onChange={(event) => handleInputChange('requiredChannelsEnabled', event.target.checked)}
                  className="sr-only peer"
                />
                <span className="w-11 h-6 bg-slate-700 rounded-full peer-checked:bg-sky-500 transition-colors" />
                <span className="absolute top-0.5 right-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:-translate-x-5" />
              </span>
            </label>
          </div>

          {!formData.requiredChannelsEnabled && (
            <div className="p-3.5 rounded-2xl border border-slate-700 bg-slate-800/50 text-xs text-slate-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-slate-400" />
              این قابلیت خاموش است؛ همهٔ مشتریان بدون محدودیت به ربات دسترسی دارند.
            </div>
          )}

          {formData.requiredChannelsEnabled && (
            <>
              <div className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200 leading-relaxed">
                ⚠️ ربات باید <b>ادمین</b> کانال باشد تا بتواند عضویت را بررسی کند. در غیر این صورت آن کانال نادیده گرفته می‌شود.
                برای کانال عمومی یوزرنیم (مثل <span className="font-mono">@mychannel</span>) و برای کانال خصوصی شناسه عددی
                (مثل <span className="font-mono">-1001234567890</span>) به همراه لینک دعوت وارد کنید.
              </div>

              <div className="space-y-3">
                {requiredChannels.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">هنوز کانالی اضافه نشده است.</p>
                )}

                {requiredChannels.map((channel, index) => (
                  <div key={channel.id} className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-300">کانال {index + 1}</span>
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={channel.enabled !== false}
                            onChange={(event) => patchRequiredChannel(channel.id, { enabled: event.target.checked })}
                            className="rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500"
                          />
                          فعال
                        </label>
                        <button
                          type="button"
                          onClick={() => removeRequiredChannel(channel.id)}
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 transition-colors"
                          title="حذف کانال"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">شناسه کانال *</label>
                        <input
                          type="text"
                          dir="ltr"
                          value={channel.chatId}
                          onChange={(event) => patchRequiredChannel(channel.id, { chatId: event.target.value })}
                          placeholder="@mychannel"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-sky-500 font-mono text-left"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">نام نمایشی</label>
                        <input
                          type="text"
                          value={channel.title || ''}
                          onChange={(event) => patchRequiredChannel(channel.id, { title: event.target.value })}
                          placeholder="کانال اطلاع‌رسانی شیرینی"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                        لینک دعوت {channel.chatId.trim().startsWith('-') && <span className="text-rose-400">(برای کانال خصوصی الزامی است)</span>}
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={channel.inviteLink || ''}
                        onChange={(event) => patchRequiredChannel(channel.id, { inviteLink: event.target.value })}
                        placeholder="https://t.me/+AbCdEf..."
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-sky-500 font-mono text-left"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {requiredChannels.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={verifyRequiredChannels}
                    disabled={isCheckingChannels}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-xs font-bold text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-50"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {isCheckingChannels ? 'در حال بررسی...' : 'بررسی دسترسی ربات به کانال‌ها'}
                  </button>

                  {channelCheck?.map((result, index) => (
                    <div
                      key={`${result.chatId}-${index}`}
                      className={`p-3 rounded-2xl border text-[11px] flex items-start gap-2 ${
                        result.ok
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      {result.ok ? <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                      <span>
                        {result.chatId && <b className="font-mono">{result.chatId}</b>} {result.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {requiredChannels.length < 10 && (
                <button
                  type="button"
                  onClick={addRequiredChannel}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-slate-600 text-xs font-semibold text-slate-300 hover:border-sky-500 hover:text-sky-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  افزودن کانال
                </button>
              )}
            </>
          )}
        </div>

        {/* Shipping Fee Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">هزینه ارسال و پیک</h3>
              <p className="text-xs text-slate-400">تنظیم نرخ پیک اکسپرس و سقف ارسال رایگان</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                هزینه ثابت پیک (تومان)
              </label>
              <input
                type="number"
                value={formData.shippingFee}
                onChange={(e) => handleInputChange('shippingFee', parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                معادل: {formatPrice(formData.shippingFee)}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                سقف خرید برای ارسال رایگان (تومان)
              </label>
              <input
                type="number"
                value={formData.freeShippingThreshold}
                onChange={(e) => handleInputChange('freeShippingThreshold', parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500 font-mono"
              />
              <p className="text-[11px] text-emerald-400 mt-1">
                خریدهای بالای {formatPrice(formData.freeShippingThreshold)} رایگان ارسال می‌شوند.
              </p>
            </div>
          </div>
        </div>

        {/* Payment Timeout & Unpaid Order Auto-Expiration Section */}
        <div className="bg-slate-900 border border-amber-500/30 rounded-3xl p-6 shadow-xl space-y-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-md shadow-amber-500/10">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">مهلت پرداخت و حذف خودکار سفارش‌های بدون فیش</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1 ${
                    formData.unpaidOrderExpiryEnabled 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {formData.unpaidOrderExpiryEnabled ? 'فعال' : 'غیرفعال'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  حذف اتوماتیک سفارش و فاکتور در صورتی که مشتری پس از مدت زمان مشخص‌شده فیش واریز ارسال نکند
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer bg-slate-800/80 hover:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700 transition-all">
                <input
                  type="checkbox"
                  checked={Boolean(formData.unpaidOrderExpiryEnabled)}
                  onChange={(e) => handleInputChange('unpaidOrderExpiryEnabled', e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer"
                />
                <span className="text-xs font-bold text-white select-none">
                  {formData.unpaidOrderExpiryEnabled ? 'حذف خودکار فعال است' : 'حذف خودکار غیرفعال است'}
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  مهلت ارسال فیش پرداخت (مدت زمان به دقیقه):
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={43200}
                      value={formData.unpaidOrderExpiryMinutes ?? 30}
                      onChange={(e) => handleInputChange(
                        'unpaidOrderExpiryMinutes',
                        Math.min(43200, Math.max(1, parseInt(e.target.value, 10) || 1)),
                      )}
                      className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono text-center"
                    />
                    <span className="text-xs text-slate-400">دقیقه</span>
                  </div>

                  {/* Preset quick buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-400">انتخاب سریع:</span>
                    {[
                      { label: '۱۵ دقیقه', val: 15 },
                      { label: '۳۰ دقیقه (پیش‌فرض)', val: 30 },
                      { label: '۴۵ دقیقه', val: 45 },
                      { label: '۱ ساعت', val: 60 },
                      { label: '۲ ساعت', val: 120 },
                      { label: '۲۴ ساعت', val: 1440 },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() => handleInputChange('unpaidOrderExpiryMinutes', preset.val)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          formData.unpaidOrderExpiryMinutes === preset.val
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold shadow-sm'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {formData.unpaidOrderExpiryEnabled ? (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-amber-200 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p>
                      اگر مشتری سفارش کارت‌به‌کارت یا آنلاین ثبت کند و تا <b>{formData.unpaidOrderExpiryMinutes ?? 30} دقیقه</b> هیچ فیشی ارسال نکند، سفارش و فاکتور آن به‌صورت اتوماتیک لغو و حذف خواهند شد.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300 pt-2 border-t border-amber-500/20">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                      <span>فاکتور به‌طور خودکار از لیست فاکتورها پاک می‌شود</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                      <span>پیام لغو به چت تلگرام مشتری ارسال می‌شود</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                      <span>گزارش حذف به سوپرگروه تاپیک‌دار ارسال می‌شود</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                      <span>سفارش‌های پرداخت در محل یا دارای فیش حذف نمی‌شوند</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 leading-relaxed">
                  حذف خودکار در حال حاضر غیرفعال است. با فعال‌سازی تیک بالا، سفارش‌های پرداخت‌نشده بعد از مدت زمان دلخواه شما حذف خواهند شد.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Web Admin Panel Management Section */}
        <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 shadow-xl space-y-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-md shadow-emerald-500/10">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">مدیریت و دسترسی به پنل تحت وب (Web Admin Panel)</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    امنیت و دسترسی
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  تنظیمات نشانی اینترنتی (URL)، نام کاربری (Username) و رمز عبور (Password) جهت ورود به پنل تحت وب
                </p>
              </div>
            </div>

            {formData.webAdminUrl && (
              <a
                href={formData.webAdminUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5 self-start sm:self-auto"
              >
                <span>ورود به پنل تحت وب</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Web Admin URL */}
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                نشانی اینترنتی پنل مدیریت تحت وب (Web Admin URL)
              </label>
              <div className="relative">
                <input
                  type="url"
                  value={formData.webAdminUrl || ''}
                  onChange={(e) => handleInputChange('webAdminUrl', e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 pl-24 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 font-mono text-left"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(formData.webAdminUrl || window.location.origin, 'url')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] text-slate-200 transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedField === 'url' ? 'کپی شد' : 'کپی لینک'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                این لینک در پنل تلگرام نیز به مدیر نمایش داده می‌شود تا بتواند به پنل وب وارد شود.
              </p>
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>نام کاربری مدیر (Admin Username)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.webAdminUsername || ''}
                  onChange={(e) => handleInputChange('webAdminUsername', e.target.value)}
                  placeholder="admin"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 pl-20 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 font-mono text-left"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(formData.webAdminUsername || 'admin', 'username')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] text-slate-200 transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedField === 'username' ? 'کپی' : 'کپی'}</span>
                </button>
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                <span>رمز عبور جدید پنل (اختیاری)</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.webAdminPassword || ''}
                  onChange={(e) => handleInputChange('webAdminPassword', e.target.value)}
                  placeholder="برای حفظ رمز فعلی خالی بگذارید"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 pl-24 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 font-mono text-left"
                  dir="ltr"
                />
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                    title={showPassword ? 'مخفی‌سازی' : 'نمایش'}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">خالی گذاشتن این فیلد، رمز عبور فعلی را بدون تغییر نگه می‌دارد.</p>
            </div>

            {/* Quick Generator & Security info */}
            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={() => {
                  const randomPass = 'shirin_' + Math.random().toString(36).slice(-6) + '!';
                  handleInputChange('webAdminPassword', randomPass);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-400 hover:text-emerald-300 text-xs font-semibold transition-all flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                <span>تولید رمز عبور قوی تصادفی</span>
              </button>
              <p className="text-[10px] text-slate-500 mt-1 text-center">
                رمز فعلی برای امنیت نمایش داده نمی‌شود؛ تنها رمز جدیدی که اینجا وارد کنید ذخیره خواهد شد.
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-8 py-3 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2"
          >
            <Check className="w-5 h-5" />
            <span>{isSaving ? 'در حال ذخیره‌سازی...' : 'ذخیره کلیه تنظیمات'}</span>
          </button>
        </div>

      </form>

      <CustomerBroadcastPanel customers={customers} />

    </div>
  );
};
