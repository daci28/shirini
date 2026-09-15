import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Check,
  RotateCcw,
  Eye,
  MessageSquare,
  ShoppingBag,
  CreditCard,
  Headphones,
  Cake,
  Wand2,
  CheckCircle2,
  Sun,
  Moon,
  Save,
  Search,
} from 'lucide-react';
import { BotSettings } from '../types';
import {
  BOT_MESSAGE_GROUPS,
  BOT_MESSAGES,
  BOT_MESSAGE_LIST,
  BotMessageKey,
  getDefaultBotText,
  renderBotText,
} from '../data/botMessages';

interface BotTextsCustomizerProps {
  settings: BotSettings;
  onUpdateSettings: (newSettings: Partial<BotSettings>) => Promise<void> | void;
}

const groupIcons: Record<string, React.ReactNode> = {
  MessageSquare: <MessageSquare className="w-4 h-4" />,
  ShoppingBag: <ShoppingBag className="w-4 h-4" />,
  CreditCard: <CreditCard className="w-4 h-4" />,
  Cake: <Cake className="w-4 h-4" />,
  Headphones: <Headphones className="w-4 h-4" />,
};

const sampleVars: Record<string, string> = {
  storeName: 'قنادی شیرین‌کام',
  storePhone: '۰۲۱-۸۸۹۹۲۲۳۳',
  storeAddress: 'تهران، خیابان ولیعصر',
  cardNumber: '6037-9975-1234-5678',
  cardHolder: 'مدیریت قنادی',
  shabaNumber: 'IR650170000000123456789012',
  orderNumber: 'SH-260828-100042',
  totalAmount: '۸۵۰٬۰۰۰',
  invoiceNumber: 'INV-M-8X2K1',
  amount: '۵۰۰٬۰۰۰',
  remaining: '۳۵۰٬۰۰۰',
  finalPrice: '۲٬۵۰۰٬۰۰۰',
  prepaymentAmount: '۱٬۰۰۰٬۰۰۰',
  ticketNumber: 'TK-4821',
  reason: '',
};

/** Tone-based suggested alternative for each message, shown as a one-click preset. */
function buildSuggestions(key: BotMessageKey): { id: string; title: string; tag: string; emoji: string; content: string }[] {
  const def = BOT_MESSAGES[key];
  const base = def.defaultText;
  return [
    {
      id: `${key}-warm`,
      title: 'لحن صمیمی و گرم',
      tag: 'دوستانه',
      emoji: '🥰',
      content: base
        .replace('خوش آمدید', 'خوش اومدید 🌸')
        .replace('لطفاً', 'خواهش می‌کنیم')
        .replace('متأسفانه', 'متأسفیم عزیز'),
    },
    {
      id: `${key}-formal`,
      title: 'لحن رسمی و محترمانه',
      tag: 'رسمی',
      emoji: '🏛️',
      content: base
        .replace('لطفاً', 'خواهشمند است')
        .replace('بفرمایید', 'ارسال نمایید')
        .replace('متشکریم', 'سپاسگزاریم'),
    },
  ];
}

export const BotTextsCustomizer: React.FC<BotTextsCustomizerProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const overrides: Record<string, string> = useMemo(
    () => ({ ...(settings.botTexts || {}) }),
    [settings.botTexts],
  );
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>(overrides);
  const [activeKey, setActiveKey] = useState<BotMessageKey>('welcomeMessage');
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [telegramPreviewTheme, setTelegramPreviewTheme] = useState<'dark' | 'light'>('light');

  // Keep the draft in sync when settings reload from the server.
  React.useEffect(() => {
    setDraftTexts({ ...(settings.botTexts || {}) });
  }, [settings.botTexts]);

  const currentDef = BOT_MESSAGES[activeKey];
  const currentValue = (draftTexts[activeKey] ?? '').toString();
  const isOverridden = (key: BotMessageKey) => Boolean((draftTexts[key] ?? '').trim());
  const isDirty = useMemo(() => {
    const saved = settings.botTexts || {};
    return BOT_MESSAGE_LIST.some((def) => (draftTexts[def.key] ?? '') !== (saved[def.key] ?? ''));
  }, [draftTexts, settings.botTexts]);

  const visibleDefs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fa-IR');
    return BOT_MESSAGE_LIST.filter((def) => {
      const inGroup = activeGroup === 'all' || BOT_MESSAGE_GROUPS.find((g) => g.key === activeGroup)?.keys.includes(def.key);
      const inQuery = !normalized
        || def.title.toLocaleLowerCase('fa-IR').includes(normalized)
        || def.description.toLocaleLowerCase('fa-IR').includes(normalized);
      return inGroup && inQuery;
    });
  }, [query, activeGroup]);

  const setText = (key: BotMessageKey, value: string) => {
    setDraftTexts((prev) => ({ ...prev, [key]: value }));
    setIsSaved(false);
  };

  const resetToDefault = (key: BotMessageKey) => {
    setDraftTexts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setIsSaved(false);
  };

  const handleSave = async () => {
    // Store only non-empty, non-default overrides to keep settings compact.
    const cleaned: Record<string, string> = {};
    for (const def of BOT_MESSAGE_LIST) {
      const value = (draftTexts[def.key] ?? '').toString();
      if (value.trim() && value.trim() !== def.defaultText.trim()) {
        cleaned[def.key] = value;
      }
    }
    setSaving(true);
    try {
      await onUpdateSettings({ botTexts: cleaned });
      setDraftTexts(cleaned);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3500);
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (varName: string) => {
    setText(activeKey, currentValue + ' ' + varName);
  };

  const applySuggestion = (content: string) => {
    setText(activeKey, content);
  };

  const isDarkTg = telegramPreviewTheme === 'dark';
  const suggestions = buildSuggestions(activeKey);
  const overriddenCount = BOT_MESSAGE_LIST.filter((def) => isOverridden(def.key)).length;

  const renderTelegramFormattedText = (rawText: string) => {
    const populated = renderBotText(rawText, sampleVars);
    const boldStyle = isDarkTg ? 'color:#fff;font-weight:700;' : 'color:#0f172a;font-weight:700;';
    const italicStyle = isDarkTg ? 'color:#fde68a;font-style:italic;' : 'color:#92400e;font-style:italic;';
    const codeStyle = isDarkTg
      ? 'display:inline-block;padding:2px 6px;border-radius:6px;background:#0f172a;color:#38bdf8;font-family:monospace;font-size:11px;'
      : 'display:inline-block;padding:2px 6px;border-radius:6px;background:#e0f2fe;color:#0369a1;font-family:monospace;font-size:11px;font-weight:600;';
    return populated
      .replace(/\n/g, '<br/>')
      .replace(/<b>(.*?)<\/b>/g, `<strong style="${boldStyle}">$1</strong>`)
      .replace(/<i>(.*?)<\/i>/g, `<em style="${italicStyle}">$1</em>`)
      .replace(/<code>(.*?)<\/code>/g, `<code style="${codeStyle}">$1</code>`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-l from-purple-950/40 via-slate-900 to-indigo-950/30 p-5 shadow-xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 text-white shadow-lg">
              <Wand2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">شخصی‌سازی تمام متون ربات</h2>
              <p className="mt-1 text-xs leading-6 text-slate-400">
                هر پیامی که ربات به مشتری می‌فرستد قابل ویرایش است. متن پیش‌فرض به‌عنوان پایه وجود دارد و تغییرات شما جایگزین آن می‌شود.
                {' '}
                <span className="font-bold text-purple-300">{overriddenCount.toLocaleString('fa-IR')}</span>
                {' '}متن سفارشی شده است.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && <span className="text-[11px] text-amber-300">تغییرات ذخیره‌نشده دارید</span>}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
            >
              {isSaved ? <CheckCircle2 className="w-4 h-4 animate-bounce" /> : <Save className="w-4 h-4" />}
              {saving ? 'در حال ذخیره…' : isSaved ? 'ذخیره شد!' : 'ذخیره همه متون'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Messages list */}
        <aside className="space-y-3 lg:col-span-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
            <div className="relative mb-2">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجوی پیام…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pr-9 pl-3 text-xs text-white outline-none focus:border-purple-500"
              />
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveGroup('all')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${activeGroup === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                همه
              </button>
              {BOT_MESSAGE_GROUPS.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setActiveGroup(group.key)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${activeGroup === group.key ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  {group.title}
                </button>
              ))}
            </div>

            <div className="max-h-[560px] space-y-1.5 overflow-y-auto pl-1">
              {visibleDefs.map((def) => {
                const selected = def.key === activeKey;
                const overridden = isOverridden(def.key);
                const group = BOT_MESSAGE_GROUPS.find((g) => g.keys.includes(def.key));
                return (
                  <button
                    key={def.key}
                    type="button"
                    onClick={() => setActiveKey(def.key)}
                    className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-right transition ${
                      selected ? 'border-purple-500 bg-purple-600/15' : 'border-transparent bg-slate-950/40 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                      {groupIcons[group?.icon || 'MessageSquare']}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-slate-100">{def.title}</span>
                        {overridden && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="سفارشی شده" />}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-500">{def.description}</p>
                    </div>
                  </button>
                );
              })}
              {visibleDefs.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500">پیامی مطابق جستجو پیدا نشد.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-[11px] leading-6 text-slate-400 shadow-sm">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" /> راهنما
            </h4>
            متغیرهای داخل {'{ }'} (مثل {'{orderNumber}'}) به‌صورت خودکار با اطلاعات واقعی جایگزین می‌شوند؛ آن‌ها را حذف نکنید.
            تگ‌های <code className="text-amber-400">&lt;b&gt;…&lt;/b&gt;</code> برای پررنگ و <code className="text-sky-400">&lt;code&gt;…&lt;/code&gt;</code> برای متن کپی‌شونده پشتیبانی می‌شوند.
          </div>
        </aside>

        {/* Editor */}
        <section className="space-y-4 lg:col-span-8">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  {groupIcons[BOT_MESSAGE_GROUPS.find((g) => g.keys.includes(activeKey))?.icon || 'MessageSquare']}
                  {currentDef.title}
                </h3>
                <p className="mt-1 text-xs text-slate-400">{currentDef.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {isOverridden(activeKey) && (
                  <span className="rounded-full border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">سفارشی شده</span>
                )}
                <button
                  type="button"
                  onClick={() => setText(activeKey, getDefaultBotText(activeKey))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
                  title="بازگرداندن متن پیش‌فرض"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> پیش‌فرض
                </button>
              </div>
            </div>

            {currentDef.variables.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {currentDef.variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => insertVariable(v.name)}
                    className="rounded-lg border border-sky-500/25 bg-slate-950/70 px-2.5 py-1 font-mono text-[11px] text-sky-300 transition hover:border-sky-400 hover:bg-slate-800"
                    title={v.desc}
                  >
                    <span className="font-bold">{v.name}</span>
                    <span className="mr-1 font-sans text-[10px] text-slate-500">({v.desc})</span>
                  </button>
                ))}
                <button type="button" onClick={() => insertVariable('<b>متن پررنگ</b>')} className="rounded-lg border border-amber-500/25 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition hover:bg-slate-800">&lt;b&gt;بولد&lt;/b&gt;</button>
                <button type="button" onClick={() => insertVariable('<code>متن کپی</code>')} className="rounded-lg border border-emerald-500/25 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-slate-800">&lt;code&gt;کپی&lt;/code&gt;</button>
              </div>
            )}

            <textarea
              rows={8}
              value={currentValue || getDefaultBotText(activeKey)}
              onChange={(e) => setText(activeKey, e.target.value)}
              dir="rtl"
              className="mt-3 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm leading-7 text-white outline-none transition focus:border-purple-500"
              placeholder="متن پیام را وارد کنید؛ خالی بودن یعنی استفاده از پیش‌فرض."
            />
            {currentValue.trim() === '' && (
              <p className="mt-1 text-[10px] text-slate-500">این متن خالی است و نسخهٔ پیش‌فرض برای مشتری ارسال می‌شود.</p>
            )}
          </div>

          {/* Telegram preview */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Eye className="h-4 w-4 text-purple-400" /> پیش‌نمایش پیام در تلگرام
              </h4>
              <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-1 text-[11px]">
                <button type="button" onClick={() => setTelegramPreviewTheme('light')} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${telegramPreviewTheme === 'light' ? 'bg-amber-500 font-bold text-white' : 'text-slate-400'}`}><Sun className="h-3.5 w-3.5" />لایت</button>
                <button type="button" onClick={() => setTelegramPreviewTheme('dark')} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${telegramPreviewTheme === 'dark' ? 'bg-indigo-600 font-bold text-white' : 'text-slate-400'}`}><Moon className="h-3.5 w-3.5" />دارک</button>
              </div>
            </div>
            <div
              className="rounded-2xl p-4 sm:p-6"
              style={{ backgroundColor: isDarkTg ? '#17212b' : '#e4ecf2', border: `1px solid ${isDarkTg ? '#2b3a4a' : '#cbd5e1'}` }}
            >
              <div className="mx-auto flex max-w-xl items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 text-sm font-bold text-white">🍰</div>
                <div
                  className="flex-1 rounded-2xl rounded-tr-none border p-4 text-sm leading-relaxed shadow-md"
                  style={{
                    backgroundColor: isDarkTg ? '#242f3d' : '#ffffff',
                    color: isDarkTg ? '#f8fafc' : '#0f172a',
                    borderColor: isDarkTg ? '#2e3d4f' : '#e2e8f0',
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between border-b pb-1" style={{ borderColor: isDarkTg ? '#2e3d4f' : '#f1f5f9' }}>
                    <span className="text-xs font-bold" style={{ color: isDarkTg ? '#38bdf8' : '#0284c7' }}>{settings.botName || settings.storeName || 'قنادی'}</span>
                    <span className="rounded px-1.5 py-0.2 font-mono text-[10px]" style={{ backgroundColor: isDarkTg ? '#1e293b' : '#f1f5f9', color: isDarkTg ? '#94a3b8' : '#64748b' }}>bot</span>
                  </div>
                  <div className="text-right" dangerouslySetInnerHTML={{ __html: renderTelegramFormattedText(currentValue || getDefaultBotText(activeKey)) }} />
                </div>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
            <h4 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-200">
              <Sparkles className="h-4 w-4 text-amber-400" /> متون پیشنهادی برای این پیام
            </h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {suggestions.map((s) => (
                <div key={s.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h5 className="flex items-center gap-1.5 text-xs font-bold text-white">{s.emoji} {s.title}</h5>
                      <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-300">{s.tag}</span>
                    </div>
                    <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-[11px] leading-6 text-slate-300">{s.content}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => applySuggestion(s.content)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2 text-[11px] font-bold text-slate-200 transition hover:bg-purple-600 hover:text-white"
                  >
                    ✨ اعمال این متن پیشنهادی
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
