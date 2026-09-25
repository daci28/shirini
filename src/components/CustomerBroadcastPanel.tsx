import React, { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { CustomerUser, BroadcastAudience, BroadcastAudienceType } from '../types';
import { canReceiveBroadcast, collectCustomerTags, resolveBroadcastAudience } from '../utils/broadcastAudience';

interface CustomerBroadcastPanelProps {
  customers: CustomerUser[];
}

/**
 * Send one message to a chosen group of customers.
 *
 * Lives in its own component because it is offered both in the bot settings
 * and next to the support tickets — the place an admin actually goes to talk
 * to customers.
 */
export const CustomerBroadcastPanel: React.FC<CustomerBroadcastPanelProps> = ({ customers }) => {
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [audienceType, setAudienceType] = useState<BroadcastAudienceType>('all');
  const [audienceTag, setAudienceTag] = useState('');
  const [audienceDays, setAudienceDays] = useState(30);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [allowReplies, setAllowReplies] = useState(true);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [tagSaveStatus, setTagSaveStatus] = useState<string | null>(null);

  /** All distinct tags in use, so the admin can reuse a saved category. */
  const availableTags = collectCustomerTags(customers);

  const buildAudience = (): BroadcastAudience => {
    switch (audienceType) {
      case 'tag': return { type: 'tag', tag: audienceTag };
      case 'selected': return { type: 'selected', customerIds: selectedCustomerIds };
      case 'recent_buyers':
      case 'inactive': return { type: audienceType, days: audienceDays };
      default: return { type: audienceType };
    }
  };

  // Same resolver the server uses, so the count on the button is the truth.
  const audienceRecipients = resolveBroadcastAudience(customers, buildAudience()).recipients;

  const unreachableCount = customers.length - customers.filter(canReceiveBroadcast).length;

  const customerSearchResults = (() => {
    const q = audienceSearch.trim().toLowerCase();
    const pool = [...customers].sort((a, b) => (b.lastActiveAt || '').localeCompare(a.lastActiveAt || ''));
    if (!q) return pool.slice(0, 30);
    return pool
      .filter((c) => [c.name, c.phone, c.username].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .slice(0, 30);
  })();

  const toggleCustomerSelection = (id: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  /** Save the current manual selection as a reusable category (tag). */
  const handleSaveSelectionAsTag = async () => {
    const tag = newTagName.trim();
    if (!tag || selectedCustomerIds.length === 0) return;
    setTagSaveStatus(null);
    try {
      const res = await fetch('/api/customers/tags/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, action: 'add', customerIds: selectedCustomerIds }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) throw new Error(data?.error || 'خطا در ذخیره دسته‌بندی');
      setTagSaveStatus(`دسته‌بندی «${tag}» روی ${data.changed} مشتری ذخیره شد. برای دیدن آن صفحه را تازه کنید.`);
      setNewTagName('');
    } catch (err: any) {
      setTagSaveStatus('خطا: ' + err.message);
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim() || isBroadcasting) return;

    setBroadcastStatus(null);
    setBroadcastError(null);
    setIsBroadcasting(true);
    try {
      const res = await fetch('/api/telegram/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: broadcastText.trim(),
          photo: broadcastPhoto.trim() || undefined,
          audience: buildAudience(),
          allowReplies,
          subject: broadcastSubject.trim() || undefined,
        }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) throw new Error(data?.error || 'ارسال پیام ناموفق بود');

      setBroadcastStatus(
        `پیام به ${data.audienceLabel} ارسال شد — موفق: ${data.sentCount} از ${data.recipientsCount}` +
          (data.failedCount ? ` (ناموفق: ${data.failedCount})` : '') +
          (data.createdTicketsCount
            ? ` — ${data.createdTicketsCount} گفتگو ساخته شد و پاسخ مشتری در همین صفحه می‌آید.`
            : '')
      );
      setBroadcastText('');
      setBroadcastPhoto('');
      setBroadcastSubject('');
    } catch (err: any) {
      setBroadcastError('خطا در ارسال پیام: ' + err.message);
    } finally {
      setIsBroadcasting(false);
    }
  };


  return (
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-2xl bg-pink-500/20 text-pink-400 border border-pink-500/30 flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">ارسال پیام به مشتریان</h3>
            <p className="text-xs text-slate-400">به همه، به یک دسته‌بندی دلخواه، یا فقط به مشتریان انتخاب‌شده</p>
          </div>
        </div>

        <form onSubmit={handleBroadcast} className="space-y-3">

          {/* Audience picker */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs font-bold text-slate-200">این پیام برای چه کسانی ارسال شود؟</label>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-pink-500/15 text-pink-300 border border-pink-500/30">
                {audienceRecipients.length} گیرنده
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ['all', '👥 همهٔ مشتریان'],
                ['tag', '🏷️ دسته‌بندی دلخواه'],
                ['selected', '✅ انتخاب دستی'],
                ['no_orders', '🕓 بدون خرید'],
                ['recent_buyers', '🔥 خریداران اخیر'],
                ['inactive', '💤 غیرفعال‌ها'],
              ] as [BroadcastAudienceType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAudienceType(value)}
                  className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                    audienceType === value
                      ? 'bg-pink-600 text-white border-pink-500 shadow-md shadow-pink-600/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {audienceType === 'tag' && (
              <div>
                {availableTags.length === 0 ? (
                  <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl p-2.5">
                    هنوز دسته‌بندی‌ای نساخته‌اید. از گزینهٔ «انتخاب دستی» چند مشتری را تیک بزنید و پایین، آن را با یک نام ذخیره کنید.
                  </p>
                ) : (
                  <select
                    value={audienceTag}
                    onChange={(e) => setAudienceTag(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">— یک دسته‌بندی انتخاب کنید —</option>
                    {availableTags.map(({ tag, count }) => (
                      <option key={tag} value={tag}>{tag} ({count} نفر)</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {(audienceType === 'recent_buyers' || audienceType === 'inactive') && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">بازهٔ زمانی:</span>
                <input
                  type="number"
                  min={1}
                  value={audienceDays}
                  onChange={(e) => setAudienceDays(Number(e.target.value) || 30)}
                  className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-pink-500"
                />
                <span className="text-[11px] text-slate-400">روز گذشته</span>
              </div>
            )}

            {audienceType === 'selected' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={audienceSearch}
                  onChange={(e) => setAudienceSearch(e.target.value)}
                  placeholder="جست‌وجوی مشتری (نام یا تلفن)..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
                <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                  {customerSearchResults.length === 0 ? (
                    <p className="text-[11px] text-slate-500 text-center py-3">مشتری‌ای پیدا نشد.</p>
                  ) : (
                    customerSearchResults.map((customer) => {
                      const checked = selectedCustomerIds.includes(customer.id);
                      const reachable =
                        !!customer.telegramId && String(customer.telegramId).trim() !== 'guest';
                      return (
                        <label
                          key={customer.id}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 border ${
                            checked ? 'bg-pink-500/10 border-pink-500/40' : 'bg-slate-900 border-slate-800'
                          } ${reachable ? '' : 'opacity-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!reachable}
                            onChange={() => toggleCustomerSelection(customer.id)}
                            className="accent-pink-500"
                          />
                          <span className="text-[11px] font-bold text-slate-100 truncate flex-1">
                            {customer.name}
                          </span>
                          {(customer.tags || []).slice(0, 2).map((t) => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                              {t}
                            </span>
                          ))}
                          <span className="text-[10px] text-slate-400 font-mono shrink-0" dir="ltr">
                            {reachable ? customer.phone || '---' : 'بدون تلگرام'}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="ذخیره به‌عنوان دسته‌بندی، مثلاً: مشتری عروسی"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-[11px] text-white focus:outline-none focus:border-pink-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSelectionAsTag}
                    disabled={!newTagName.trim() || selectedCustomerIds.length === 0}
                    className="px-3 py-2 rounded-xl text-[11px] font-bold bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 shrink-0"
                  >
                    ذخیرهٔ دسته‌بندی
                  </button>
                </div>
                {tagSaveStatus && (
                  <p className="text-[11px] text-emerald-300">{tagSaveStatus}</p>
                )}
              </div>
            )}

            {unreachableCount > 0 && (
              <p className="text-[10px] text-slate-500">
                {unreachableCount} مشتری آیدی تلگرام ندارند و پیام برایشان ارسال نمی‌شود.
              </p>
            )}
          </div>

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

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowReplies}
                onChange={(e) => setAllowReplies(e.target.checked)}
                className="accent-pink-500 mt-0.5"
              />
              <span className="text-[11px] text-slate-200 font-bold">
                مشتری بتواند به این پیام پاسخ دهد
                <span className="block font-normal text-slate-400 mt-0.5">
                  زیر پیام دکمهٔ «پاسخ به این پیام» می‌آید و گفتگو در همین بخش تیکت‌ها ادامه پیدا می‌کند.
                </span>
              </span>
            </label>

            {allowReplies && (
              <input
                type="text"
                value={broadcastSubject}
                onChange={(e) => setBroadcastSubject(e.target.value)}
                placeholder="موضوع گفتگو (اختیاری) — مثلاً: جشنوارهٔ یلدا"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-[11px] text-white focus:outline-none focus:border-pink-500"
              />
            )}
          </div>

          {broadcastStatus && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs">
              {broadcastStatus}
            </div>
          )}

          {broadcastError && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs">
              {broadcastError}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isBroadcasting || audienceRecipients.length === 0}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-40 text-white font-bold text-xs shadow-md shadow-pink-600/30 transition-all flex items-center gap-2"
            >
              <Send className="w-4 h-4 rotate-180" />
              <span>
                {isBroadcasting
                  ? 'در حال ارسال...'
                  : `ارسال به ${audienceRecipients.length} مشتری`}
              </span>
            </button>
          </div>
        </form>
      </div>
  );
};
