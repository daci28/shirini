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
  EyeOff
} from 'lucide-react';
import { BotSettings, ForumTopicConfig } from '../types';
import { INITIAL_FORUM_TOPICS } from '../data/initialData';
import { formatPrice } from '../utils/formatters';

type SettingsUpdate = Partial<BotSettings> & { clearTelegramBotToken?: boolean };

interface BotSettingsProps {
  settings: BotSettings;
  onUpdateSettings: (newSettings: SettingsUpdate) => Promise<void>;
}

export const BotSettingsComponent: React.FC<BotSettingsProps> = ({
  settings,
  onUpdateSettings,
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
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);

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
      alert('ذخیره تنظیمات ناموفق بود. لطفاً دوباره تلاش کنید.');
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

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;

    try {
      const res = await fetch('/api/telegram/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: broadcastText.trim(),
          photo: broadcastPhoto.trim() || undefined,
        }),
      });
      const data = (await res.json()) as any;
      setBroadcastStatus(`پیام با موفقیت برای اعضای ربات ارسال شد.`);
      setBroadcastText('');
      setBroadcastPhoto('');
      setTimeout(() => setBroadcastStatus(null), 4000);
    } catch (err: any) {
      setBroadcastStatus('خطا در ارسال پیام: ' + err.message);
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
          title: formData.forumGroupTitle || 'سوپرگروه مدیریت قنادی شیرین‌کام',
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
                placeholder="گروه هماهنگی و مدیریت قنادی شیرین‌کام"
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

      {/* Promotional Broadcast Tool */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-2xl bg-pink-500/20 text-pink-400 border border-pink-500/30 flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">ارسال پیام همگانی به کاربران ربات تلگرام</h3>
            <p className="text-xs text-slate-400">اطلاع‌رسانی تخفیف‌ها، منوی شیرینی جدید و تبریک مناسبت‌ها</p>
          </div>
        </div>

        <form onSubmit={handleBroadcast} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              متن پیام اطلاعیه / تخفیف
            </label>
            <textarea
              rows={3}
              required
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              placeholder="مثال: 🍰 جشنواره شیرینی تازه! با ارسال کد YALDA از ۲۰٪ تخفیف روی تمام کیک‌های سفارشی بهره‌مند شوید..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              لینک عکس پیوست (اختیاری)
            </label>
            <input
              type="url"
              value={broadcastPhoto}
              onChange={(e) => setBroadcastPhoto(e.target.value)}
              placeholder="https://images.unsplash.com/..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {broadcastStatus && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">
              {broadcastStatus}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-xs shadow-md shadow-pink-600/30 transition-all flex items-center gap-2"
            >
              <Send className="w-4 h-4 rotate-180" />
              <span>ارسال پیام به همه کاربران</span>
            </button>
          </div>
        </form>
      </div>

    </div>
  );
};
