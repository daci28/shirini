// Telegram Bot Handler - processes all callback queries and text messages
// Called from server.ts polling loop
import { t as botText } from './data/botMessages';
import { upsertBotCustomer } from './utils/customers';

interface SimpleMap<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
  delete(key: string): boolean;
  has?(key: string): boolean;
}

interface TelegramUserProfile {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramContext {
  token: string;
  chatId: string;
  products: any[];
  orders: any[];
  discounts: any[];
  customers: any[];
  supportTickets: any[];
  customOrders: any[];
  invoices?: any[];
  botSettings: any;
  userCarts: SimpleMap<any[]>;
  userStates: SimpleMap<any>;
  telegramUser?: TelegramUserProfile;
}

// Notify topic in forum supergroup if configured
async function notifyForumTopic(ctx: TelegramContext, key: string, messageText: string, photo?: string) {
  if (!ctx.botSettings?.forumGroupId || !ctx.token) return;
  const topic = (ctx.botSettings.forumTopics || []).find((t: any) => t.key === key);
  if (topic && (topic.enabled === false || topic.autoReport === false)) return;

  const threadId = topic?.threadId ? Number(topic.threadId) : undefined;
  
  if (photo) {
    if (photo.startsWith('data:image/')) {
      try {
        const matches = photo.match(/^data:(image\/\w+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          const formData = new FormData();
          formData.append('chat_id', ctx.botSettings.forumGroupId);
          formData.append('parse_mode', 'HTML');
          formData.append('caption', messageText);
          if (threadId) formData.append('message_thread_id', String(threadId));
          formData.append('photo', new Blob([buffer], { type: mimeType }), 'receipt.jpg');

          const res = await fetch(`https://api.telegram.org/bot${ctx.token}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
          const resData = (await res.json().catch(() => ({}))) as any;
          if (resData?.ok) return;
        }
      } catch (e) {
        console.error('notifyForumTopic base64 error:', e);
      }
    } else {
      try {
        const payload: any = {
          chat_id: ctx.botSettings.forumGroupId,
          parse_mode: 'HTML',
          photo,
          caption: messageText,
        };
        if (threadId) payload.message_thread_id = threadId;
        const res = await fetch(`https://api.telegram.org/bot${ctx.token}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const resData = (await res.json().catch(() => ({}))) as any;
        if (resData?.ok) return;
      } catch (e) {
        console.error('notifyForumTopic photo error:', e);
      }
    }
  }

  try {
    const textPayload: any = {
      chat_id: ctx.botSettings.forumGroupId,
      parse_mode: 'HTML',
      text: messageText,
    };
    if (threadId) textPayload.message_thread_id = threadId;
    const res = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(textPayload),
    });
    const resData = (await res.json().catch(() => ({}))) as any;
    if (resData?.ok) return;

    if (threadId) {
      delete textPayload.message_thread_id;
      await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textPayload),
      });
    }
  } catch (err) {
    console.error('notifyForumTopic final error:', err);
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tgSend(ctx: TelegramContext, text: string, buttons?: any[][], photo?: string) {
  const base: any = { chat_id: ctx.chatId, parse_mode: 'HTML' };
  if (photo) {
    // Check if photo is a base64 data URL
    if (photo.startsWith('data:image/')) {
      try {
        const matches = photo.match(/^data:(image\/\w+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          
          const formData = new FormData();
          formData.append('chat_id', ctx.chatId);
          formData.append('parse_mode', 'HTML');
          formData.append('caption', text);
          formData.append('photo', new Blob([buffer], { type: mimeType }), 'image.jpg');
          
          if (buttons && buttons.length > 0) {
            formData.append('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
          }
          
          const response = await fetch(`https://api.telegram.org/bot${ctx.token}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          const resData = (await response.json().catch(() => ({}))) as any;
          if (resData?.ok) return;
        }
      } catch (err) {
        console.error('Error sending base64 photo:', err);
      }
    } else {
      // Regular URL or Telegram file_id
      try {
        const payload: any = {
          chat_id: ctx.chatId,
          parse_mode: 'HTML',
          photo,
          caption: text,
        };
        if (buttons && buttons.length > 0) {
          payload.reply_markup = { inline_keyboard: buttons };
        }
        const response = await fetch(`https://api.telegram.org/bot${ctx.token}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resData = (await response.json().catch(() => ({}))) as any;
        if (resData?.ok) return;

        // If sendPhoto failed with document file_id, try sendDocument
        try {
          const docPayload: any = {
            chat_id: ctx.chatId,
            parse_mode: 'HTML',
            document: photo,
            caption: text,
          };
          if (buttons && buttons.length > 0) {
            docPayload.reply_markup = { inline_keyboard: buttons };
          }
          const docRes = await fetch(`https://api.telegram.org/bot${ctx.token}/sendDocument`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(docPayload)
          });
          const docData = (await docRes.json().catch(() => ({}))) as any;
          if (docData?.ok) return;
        } catch { /* ignore document retry */ }
      } catch (err) {
        console.error('Error sending photo:', err);
      }
    }
  }

  // Text message delivery (HTML, falling back to plain text)
  try {
    const textPayload: any = {
      chat_id: ctx.chatId,
      parse_mode: 'HTML',
      text,
    };
    if (buttons && buttons.length > 0) {
      textPayload.reply_markup = { inline_keyboard: buttons };
    }
    const response = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(textPayload)
    });
    const resData = (await response.json().catch(() => ({}))) as any;
    if (resData?.ok) return;

    // Plain text fallback if HTML parse failed
    const plainPayload: any = {
      chat_id: ctx.chatId,
      text: text.replace(/<[^>]+>/g, ''),
    };
    if (buttons && buttons.length > 0) {
      plainPayload.reply_markup = { inline_keyboard: buttons };
    }
    await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plainPayload)
    });
  } catch (err) {
    console.error('Error delivering telegram message:', err);
  }
}

/** Receipt upload and receipt approval are distinct states for custom orders. */
function canStartCustomProduction(order: any): boolean {
  const prepaymentStatus = order?.prepaymentStatus
    || (order?.isPrepaymentPaid ? 'approved' : order?.paymentReceiptImage ? 'pending_confirmation' : order?.prepaymentAmount ? 'awaiting_receipt' : 'not_required');
  // Do not turn receipt verification into production automatically. The newly
  // verified stage is `receipt_confirmed`; the legacy approved_by_customer
  // state remains valid only for old verified records or cash-on-delivery.
  return (prepaymentStatus === 'approved' && (order?.status === 'receipt_confirmed' || order?.status === 'approved_by_customer'))
    || (prepaymentStatus === 'not_required' && order?.paymentMethod === 'cash_on_delivery' && order?.status === 'approved_by_customer');
}

// ============ CUSTOMER CALLBACKS ============

export async function handleCustomerCallback(ctx: TelegramContext, data: string): Promise<boolean> {
  // Menu categories — built from the actual catalogue so every button leads to
  // products. Each label shows how many in-stock items that category has, so
  // customers don't have to open empty categories one by one.
  if (data === 'menu_categories') {
    const inStock = ctx.products.filter(p => p && p.isAvailable);
    const fa = (n: number) => n.toLocaleString('fa-IR');
    const order: string[] = [];
    const counts = new Map<string, number>();
    for (const p of inStock) {
      const cat = String(p.category || 'سایر').trim() || 'سایر';
      if (!counts.has(cat)) { counts.set(cat, 0); order.push(cat); }
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const btns: any[][] = [];
    for (let i = 0; i < order.length; i += 2) {
      const row: any[] = [{ text: `${order[i]} (${fa(counts.get(order[i]) || 0)})`, callback_data: `cat_${order[i]}` }];
      if (order[i + 1]) row.push({ text: `${order[i + 1]} (${fa(counts.get(order[i + 1]) || 0)})`, callback_data: `cat_${order[i + 1]}` });
      btns.push(row);
    }
    btns.push([{ text: `🌟 همه محصولات (${fa(inStock.length)})`, callback_data: 'cat_all' }]);
    btns.push([{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]);
    await tgSend(ctx, '🧁 <b>دسته‌بندی محصولات:</b>\n\n<i>عدد داخل پرانتز، تعداد کالای موجود هر دسته است.</i>', btns);
    return true;
  }

  // Category products
  if (data.startsWith('cat_')) {
    const sel = data.replace('cat_', '');
    const filtered = sel === 'all' ? ctx.products.filter(p => p.isAvailable) : ctx.products.filter(p => p.category === sel && p.isAvailable);
    if (filtered.length === 0) {
      await tgSend(ctx, `محصولی در این دسته‌بندی یافت نشد.`, [[{ text: '🔙 دسته‌ها', callback_data: 'menu_categories' }]]);
      return true;
    }
    await tgSend(ctx, `🍰 <b>${sel === 'all' ? 'همه محصولات' : sel}</b> (${filtered.length.toLocaleString('fa-IR')} مورد):`);
    for (const prod of filtered.slice(0, 10)) {
      const discountedPrice = prod.discountPercent ? (prod.price * (100 - prod.discountPercent) / 100) : prod.price;
      const priceText = prod.discountPercent 
        ? `<s>${prod.price.toLocaleString()}</s> ➤ <b>${discountedPrice.toLocaleString()}</b> تومان`
        : `<b>${prod.price.toLocaleString()}</b> تومان`;
      
      let cap = `✨━━━━━━━━━━━━━━━━━━━✨\n`;
      cap += `🎂 <b>${prod.name || 'محصول'}</b>\n`;
      cap += `━━━━━━━━━━━━━━━━━━━\n\n`;
      cap += `📂 <b>دسته‌بندی:</b> ${prod.category || '---'}\n`;
      cap += `🏷️ <b>کد محصول:</b> <code>${prod.productCode || '---'}</code>\n\n`;
      cap += `💰 <b>قیمت:</b> ${priceText}\n`;
      cap += `📦 <b>واحد فروش:</b> هر ${prod.unit || 'عدد'}\n\n`;
      if (prod.description) {
        cap += `📝 <b>توضیحات:</b>\n<i>${prod.description}</i>\n\n`;
      }
      cap += `✅ <b>وضعیت:</b> ${prod.isAvailable ? '🟢 موجود و آماده سفارش' : '🔴 ناموجود'}\n`;
      cap += `✨━━━━━━━━━━━━━━━━━━━✨`;
      
      const allImages = prod.images && prod.images.length > 0 ? prod.images : (prod.image ? [prod.image] : []);
      
      // Debug log
      console.log('Product images debug:', {
        productName: prod.name,
        images: prod.images,
        image: prod.image,
        allImages: allImages,
        allImagesLength: allImages.length
      });
      
      if (allImages.length > 0) {
        if (allImages.length === 1) {
          // Single image with caption and buttons
          await tgSend(ctx, cap, [
            [{ text: '➕ افزودن به سبد خرید', callback_data: `add_to_cart_${prod.id}` }],
            [{ text: '🛒 سبد خرید', callback_data: 'view_cart' }, { text: '🔙 دسته‌ها', callback_data: 'menu_categories' }],
            [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
          ], allImages[0]);
        } else {
          // Multiple images - send as media group
          const media = allImages.map((img, idx) => ({
            type: 'photo',
            media: img,
            caption: idx === 0 ? cap : undefined,
            parse_mode: idx === 0 ? 'HTML' : undefined
          }));
          
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMediaGroup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ctx.chatId,
              media: media
            })
          });
          
          // Send buttons separately
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ctx.chatId,
              text: `<b>${prod.name}</b>`,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [
                [{ text: '➕ افزودن به سبد خرید', callback_data: `add_to_cart_${prod.id}` }],
                [{ text: '🛒 سبد خرید', callback_data: 'view_cart' }, { text: '🔙 دسته‌ها', callback_data: 'menu_categories' }],
                [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
              ]}
            })
          });
        }
      } else {
        // No images - send text only
        await tgSend(ctx, cap, [
          [{ text: '➕ افزودن به سبد خرید', callback_data: `add_to_cart_${prod.id}` }],
          [{ text: '🛒 سبد خرید', callback_data: 'view_cart' }, { text: '🔙 دسته‌ها', callback_data: 'menu_categories' }],
          [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]
        ]);
      }
    }
    return true;
  }

  // Support message

  // My tickets
  if (data === 'my_tickets') {
    const myTickets = ctx.supportTickets.filter(t => t.customerTelegramId === ctx.chatId);
    
    if (myTickets.length === 0) {
      await tgSend(ctx, '📋 <b>تیکت‌های شما</b>\n\nشما هنوز تیکتی ثبت نکرده‌اید.', [
        [{ text: '💬 ارسال تیکت جدید', callback_data: 'support_send' }],
        [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
      ]);
      return true;
    }
    
    let message = `📋 <b>تیکت‌های شما (${myTickets.length} تیکت)</b>\n\n`;
    
    myTickets.slice(0, 10).forEach((ticket, idx) => {
      const statusEmoji = ticket.status === 'open' ? '🟡' : ticket.status === 'answered' ? '✅' : ticket.status === 'closed' ? '🔒' : '⏳';
      const statusText = ticket.status === 'open' ? 'در انتظار پاسخ' : ticket.status === 'answered' ? 'پاسخ داده شده' : ticket.status === 'closed' ? 'بسته شده' : 'در حال بررسی';
      
      message += `${idx + 1}. <b>${ticket.subject || 'بدون عنوان'}</b>\n`;
      message += `   🔖 کد: <code>${ticket.ticketNumber}</code>\n`;
      message += `   ${statusEmoji} وضعیت: ${statusText}\n`;
      message += `   📅 تاریخ: ${new Date(ticket.createdAt).toLocaleDateString('fa-IR')}\n\n`;
    });
    
    if (myTickets.length > 10) {
      message += `\n<i>و ${myTickets.length - 10} تیکت دیگر...</i>\n`;
    }
    
    await tgSend(ctx, message, [
      [{ text: '💬 ارسال تیکت جدید', callback_data: 'support_send' }],
      [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
    ]);
    return true;
  }
  if (data === 'support_send') {
    ctx.userStates.set(ctx.chatId, { mode: 'support_category' });
    await tgSend(ctx, botText(ctx, 'supportPromptMessage'), [
      [{ text: '🎂 سفارش کیک اختصاصی', callback_data: 'support_cat_custom_cake' }],
      [{ text: '📦 پیگیری سفارش', callback_data: 'support_cat_order_inquiry' }],
      [{ text: '💳 مشکل پرداخت / فیش', callback_data: 'support_cat_payment_issue' }],
      [{ text: '⭐ انتقاد و پیشنهاد', callback_data: 'support_cat_feedback' }],
      [{ text: '💡 مشاوره خرید', callback_data: 'support_cat_consultation' }],
      [{ text: '💬 پیام عمومی', callback_data: 'support_cat_general' }],
      [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (data.startsWith('support_cat_')) {
    const category = data.replace('support_cat_', '');
    const state = ctx.userStates.get(ctx.chatId) || {};
    state.category = category;
    state.mode = 'support_subject';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '📝 <b>عنوان پیام:</b>\n\nلطفاً عنوان پیام خود را بنویسید:', [
      [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (data === 'support_photo_yes') {
    const state = ctx.userStates.get(ctx.chatId) || {};
    state.mode = 'support_photo';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '📸 لطفاً تصویر خود را ارسال کنید:', [
      [{ text: '❌ انصراف از تصویر', callback_data: 'support_finalize' }]
    ]);
    return true;
  }


  // Reply to ticket
  // The photo-choice callbacks share the `reply_ticket_` prefix. They must be
  // matched before the broad ticket-id callback below; otherwise selecting
  // "yes" or "no" is mistaken for a ticket with id `photo_yes` / `photo_no`
  // and the customer is incorrectly sent back to the text step.
  if (data === 'reply_ticket_photo_yes') {
    const state = ctx.userStates.get(ctx.chatId);
    if (!state || state.mode !== 'reply_to_ticket_photo_ask' || !state.ticketId) {
      await tgSend(ctx, '⚠️ مرحله پاسخ منقضی شده است. لطفاً دوباره گزینه «پاسخ به این تیکت» را انتخاب کنید.', [
        [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
      ]);
      return true;
    }

    const newState = { ...state, mode: 'reply_to_ticket_photo' };
    ctx.userStates.set(ctx.chatId, newState);
    await tgSend(ctx, '📸 لطفاً عکس خود را ارسال کنید:', [
      [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (data === 'reply_ticket_photo_no') {
    const state = ctx.userStates.get(ctx.chatId);
    if (!state || state.mode !== 'reply_to_ticket_photo_ask' || !state.ticketId) {
      await tgSend(ctx, '⚠️ مرحله پاسخ منقضی شده است. لطفاً دوباره گزینه «پاسخ به این تیکت» را انتخاب کنید.', [
        [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
      ]);
      return true;
    }

    const ticket = ctx.supportTickets.find(t => t.id === state.ticketId);
    if (!ticket) {
      ctx.userStates.delete(ctx.chatId);
      await tgSend(ctx, '⚠️ تیکت موردنظر یافت نشد. لطفاً از پیام پشتیبانی دوباره تلاش کنید.', [
        [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
      ]);
      return true;
    }

    ticket.replies.push({
      id: `rep-${Date.now()}`,
      sender: 'customer',
      senderName: ticket.customerName || 'مشتری',
      text: state.replyText || '',
      createdAt: new Date().toISOString()
    });
    ticket.status = 'in_progress';
    ticket.updatedAt = new Date().toISOString();
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ پاسخ شما ثبت شد. پشتیبانی به زودی پاسخ می‌دهد.', [
      [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (data.startsWith('reply_ticket_')) {
    const ticketId = data.replace('reply_ticket_', '');
    const state = ctx.userStates.get(ctx.chatId) || {};
    state.mode = 'reply_to_ticket_text';
    state.ticketId = ticketId;
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '💬 <b>پاسخ به تیکت:</b>\n\nلطفاً متن پاسخ خود را بنویسید:', [
      [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (data === 'support_finalize') {
    const state = ctx.userStates.get(ctx.chatId);
    if (!state) return false;
    
    const categoryMap: Record<string, string> = {
      'custom_cake': '🎂 سفارش کیک اختصاصی',
      'order_inquiry': '📦 پیگیری سفارش',
      'payment_issue': '💳 مشکل پرداخت',
      'feedback': '⭐ انتقاد و پیشنهاد',
      'consultation': '💡 مشاوره خرید',
      'general': '💬 پیام عمومی'
    };
    
    // A callback query contains Telegram's actual account profile. Combine it
    // with any customer record already captured during /start or checkout so
    // support tickets never fall back to the generic "مشتری ربات" label.
    const existingCustomer = ctx.customers.find(
      (customer) => String(customer.telegramId) === String(ctx.chatId)
    );
    const telegramUser = ctx.telegramUser;
    const profileName = [telegramUser?.first_name, telegramUser?.last_name]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();
    const customerName = profileName || existingCustomer?.name || (telegramUser?.username ? `@${telegramUser.username}` : 'مشتری');
    const customerUsername = telegramUser?.username || existingCustomer?.username || '';
    const customerPhone = existingCustomer?.phone || '';

    // One profile per Telegram account — never a duplicate.
    upsertBotCustomer(ctx.customers, {
      telegramId: ctx.chatId,
      name: customerName,
      phone: customerPhone,
      username: customerUsername,
      source: 'bot',
    });

    const now = new Date().toISOString();
    const ticketNumber = `TK-${Math.floor(1000 + Math.random() * 9000)}`;
    ctx.supportTickets.unshift({
      id: `tkt-${Date.now()}`,
      ticketNumber,
      customerName,
      customerTelegramId: ctx.chatId,
      customerUsername,
      customerPhone,
      category: state.category as any,
      subject: state.subject || 'پیام از ربات',
      message: state.message || '',
      cakePhoto: state.photo,
      status: 'open',
      priority: 'normal',
      createdAt: now,
      updatedAt: now,
      replies: [{
        id: `rep-${Date.now()}`,
        sender: 'customer',
        senderName: customerName,
        text: state.message || '',
        createdAt: now
      }]
    });
    
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, botText(ctx, 'ticketCreatedMessage', { ticketNumber }) + `\n📂 دسته‌بندی: ${categoryMap[state.category] || 'عمومی'}`, [
      [{ text: '🔙 منوی اصلی', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  // Contact info
  if (data === 'contact_info') {
    const s = ctx.botSettings;
    await tgSend(ctx, botText(ctx, 'contactInfoMessage', {
      storeName: s.storeName || '---',
      storePhone: s.storePhone || '---',
      storeAddress: s.storeAddress || '---',
      cardNumber: s.cardNumber || '---',
      cardHolder: s.cardHolder || '---',
    }), [[{ text: '🔙 بازگشت', callback_data: 'back_to_main' }]]);
    return true;
  }

  return false;
}

// ============ ADMIN CALLBACKS ============

export async function handleAdminCallback(ctx: TelegramContext, data: string): Promise<boolean> {

  // Admin Panel Main Dashboard
  if (data === 'admin_panel') {
    const regularPendingReceipts = ctx.orders.filter(o => o.paymentReceiptImage && (o.status === 'pending_payment' || o.status === 'paid_checking') && !['confirmed', 'rejected'].includes(o.receiptReviewStatus || '')).length;
    const customPendingReceipts = ctx.customOrders.filter(o => o.paymentReceiptImage && o.prepaymentStatus === 'pending_confirmation').length;
    const totalPendingReceipts = regularPendingReceipts + customPendingReceipts;
    const runningOrders = ctx.orders.filter(o => ['paid_checking', 'receipt_confirmed', 'baking', 'shipped'].includes(o.status)).length;
    const openTickets = ctx.supportTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
    const revenue = ctx.orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.totalAmount, 0);

    const text = `👨‍🍳 <b>پنل مدیریت هوشمند قنادی شیرین‌کام</b>\n` +
      `────────────────────\n` +
      `💰 <b>فروش کل:</b> <b>${revenue.toLocaleString()} تومان</b>\n` +
      `🧾 <b>فیش‌های منتظر بررسی:</b> <b>${totalPendingReceipts} مورد</b>\n` +
      `📦 <b>سفارشات جاری:</b> <b>${runningOrders} سفارش</b>\n` +
      `💬 <b>تیکت‌های باز:</b> <b>${openTickets} پیام</b>\n` +
      `────────────────────\n` +
      `کلیه بخش‌های پنل تحت وب از این منو در دسترس شماست:`;

    await tgSend(ctx, text, [
      [{ text: `🧾 فاکتورها و پرداخت‌ها (${totalPendingReceipts})`, callback_data: 'admin_invoices' }, { text: `📦 سفارشات عادی (${runningOrders})`, callback_data: 'admin_orders_list' }],
      [{ text: `🎂 سفارش کیک دلخواه (${ctx.customOrders.length})`, callback_data: 'admin_custom_orders' }, { text: `🧁 مدیریت محصولات (${ctx.products.length})`, callback_data: 'admin_products_manager' }],
      [{ text: `➕ افزودن محصول جدید`, callback_data: 'admin_add_product' }, { text: `👥 کاربران و مشتریان (${ctx.customers.length})`, callback_data: 'admin_customers_manager' }],
      [{ text: `🎟️ کدهای تخفیف (${ctx.discounts.length})`, callback_data: 'admin_discounts_list' }, { text: `💬 پشتیبانی و تیکت‌ها (${openTickets})`, callback_data: 'admin_support_list' }],
      [{ text: `🛡️ مدیران ربات (${1 + (ctx.botSettings.adminTelegramIds?.length || 0)})`, callback_data: 'admin_admins_manager' }, { text: `🏷️ سوپرگروه تاپیک‌دار (۸ تاپیک)`, callback_data: 'admin_forum_topics' }],
      [{ text: `📊 آمار و تحلیل فروش`, callback_data: 'admin_sales_stats' }, { text: `💾 بکاپ و دیتابیس`, callback_data: 'admin_backup' }],
      [{ text: `✍️ شخصی‌سازی متون`, callback_data: 'admin_texts' }, { text: `⚙️ تنظیمات و حساب بانکی`, callback_data: 'admin_settings' }],
      [{ text: `📢 ارسال پیام همگانی`, callback_data: 'admin_broadcast' }],
      [{ text: `👥 بازگشت به دید مشتری`, callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  // Invoices & Payment Review Workflow
  if (data === 'admin_invoices') {
    const regularPendingReceipts = ctx.orders.filter(o => (o.status === 'pending_payment' || o.status === 'paid_checking') && !['confirmed', 'rejected'].includes(o.receiptReviewStatus || ''));
    const customPendingReceipts = ctx.customOrders.filter(o => o.prepaymentStatus === 'pending_confirmation' || (o.status === 'price_quoted' && !o.isPrepaymentPaid && (o.prepaymentAmount || 0) > 0));
    
    // Find manual invoices with submitted payments waiting for approval
    const manualPendingInvoices: { invoice: any; payment: any }[] = [];
    if (Array.isArray(ctx.invoices)) {
      ctx.invoices.forEach(inv => {
        if (Array.isArray(inv.payments)) {
          inv.payments.forEach((p: any) => {
            if (p.status === 'submitted') {
              manualPendingInvoices.push({ invoice: inv, payment: p });
            }
          });
        }
      });
    }

    const totalPendingReceipts = regularPendingReceipts.length + customPendingReceipts.length + manualPendingInvoices.length;

    const totalReceived = ctx.orders.filter(o => ['receipt_confirmed', 'baking', 'shipped', 'delivered'].includes(o.status)).reduce((s, o) => s + o.totalAmount, 0)
      + ctx.customOrders.filter(o => o.isPrepaymentPaid || o.prepaymentStatus === 'approved').reduce((s, o) => s + (o.prepaymentAmount || 0), 0)
      + (Array.isArray(ctx.invoices) ? ctx.invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0) : 0);

    let text = `🧾 <b>مرکز فاکتورها، واریزی‌ها و فیش‌های بانکی</b>\n────────────────────\n`;
    text += `💰 <b>مجموع کل دریافتی‌های تأییدشده:</b> <b>${totalReceived.toLocaleString()} تومان</b>\n`;
    text += `🔍 <b>فیش‌ها و واریزی‌های منتظر بررسی:</b> <b>${totalPendingReceipts} مورد</b>\n`;
    text += `────────────────────\n`;

    if (totalPendingReceipts === 0) {
      text += `✅ تمام فیش‌های واریزی بررسی شده‌اند و فیش جدیدی در صف بررسی نیست.`;
      await tgSend(ctx, text, [
        [{ text: '📦 سفارشات عادی', callback_data: 'admin_orders_list' }, { text: '🎂 کیک‌های سفارشی', callback_data: 'admin_custom_orders' }],
        [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'admin_panel' }]
      ]);
      return true;
    }

    text += `📌 <b>فیش‌های ارسالی مشتریان جهت تأیید یا رد:</b>`;
    await tgSend(ctx, text, [[{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'admin_panel' }]]);

    // Manual invoices pending payments
    for (const item of manualPendingInvoices.slice(0, 5)) {
      const inv = item.invoice;
      const pay = item.payment;
      const cap = `🧾 <b>فیش فاکتور اختصاصی:</b> <code>${escapeHtml(inv.invoiceNumber)}</code>\n👤 مشتری: <b>${escapeHtml(inv.customerName)}</b>\n📞 <code>${escapeHtml(inv.customerPhone)}</code>\n💰 مبلغ پرداختی: <b>${pay.amount.toLocaleString()} تومان</b>\n💳 کل فاکتور: <b>${inv.totalAmount.toLocaleString()} تومان</b>`;
      await tgSend(ctx, cap, [
        [{ text: '✅ تأیید فیش فاکتور', callback_data: `admin_inva_approve_${inv.id}_${pay.id}` }, { text: '❌ رد فیش فاکتور', callback_data: `admin_inva_reject_${inv.id}_${pay.id}` }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ], pay.receiptImage);
    }

    // Regular order receipts
    for (const o of regularPendingReceipts.slice(0, 5)) {
      const cap = `🧾 <b>فیش سفارش عادی:</b> <code>${escapeHtml(o.orderNumber)}</code>\n👤 مشتری: <b>${escapeHtml(o.customerName)}</b>\n📞 <code>${escapeHtml(o.customerPhone)}</code>\n💰 مبلغ: <b>${o.totalAmount.toLocaleString()} تومان</b>\n💳 روش پرداخت: کارت به کارت${!o.paymentReceiptImage ? '\n⚠️ تصویر فیش هنوز آپلود نشده است.' : ''}`;
      await tgSend(ctx, cap, [
        [{ text: '✅ تأیید واریزی سفارش', callback_data: `admin_rapprove_${o.id}` }, { text: '❌ رد فیش', callback_data: `admin_rreject_${o.id}` }],
        [{ text: '📦 مشاهده در لیست سفارشات', callback_data: 'admin_orders_list' }]
      ], o.paymentReceiptImage);
    }

    // Custom cake prepayment receipts
    for (const co of customPendingReceipts.slice(0, 5)) {
      const cap = `🎂 <b>فیش بیعانه کیک دلخواه:</b> <code>${escapeHtml(co.orderNumber)}</code>\n👤 مشتری: <b>${escapeHtml(co.customerName)}</b>\n📞 <code>${escapeHtml(co.customerPhone)}</code>\n💰 مبلغ بیعانه: <b>${(co.prepaymentAmount || 0).toLocaleString()} تومان</b>\n🎂 نوع: ${escapeHtml(co.pastryType)}${!co.paymentReceiptImage ? '\n⚠️ تصویر فیش هنوز آپلود نشده است.' : ''}`;
      await tgSend(ctx, cap, [
        [{ text: '✅ تأیید بیعانه', callback_data: `admin_cpreapprove_${co.id}` }, { text: '❌ رد بیعانه', callback_data: `admin_cprereject_${co.id}` }],
        [{ text: '🎂 جزئیات سفارش دلخواه', callback_data: 'admin_custom_orders' }]
      ], co.paymentReceiptImage);
    }
    return true;
  }

  // Manual Invoice Payment Approval
  if (data.startsWith('admin_inva_approve_')) {
    const parts = data.replace('admin_inva_approve_', '').split('_');
    const invoiceId = parts[0];
    const paymentId = parts[1];
    if (Array.isArray(ctx.invoices)) {
      const inv = ctx.invoices.find((i: any) => i.id === invoiceId);
      if (inv && Array.isArray(inv.payments)) {
        const pay = inv.payments.find((p: any) => p.id === paymentId);
        if (pay) {
          pay.status = 'confirmed';
          pay.paidAt = new Date().toISOString();
          pay.updatedAt = new Date().toISOString();
          inv.paidAmount = inv.payments.filter((p: any) => p.status === 'confirmed').reduce((s: number, p: any) => s + p.amount, 0);
          inv.remainingAmount = Math.max(0, inv.totalAmount - inv.paidAmount);
          inv.status = inv.remainingAmount === 0 ? 'paid' : 'partially_paid';
          inv.updatedAt = new Date().toISOString();

          const targetChatId = inv.customerTelegramId || ctx.customers.find((c: any) => c.id === inv.customerId)?.telegramId;
          if (targetChatId && targetChatId !== 'guest') {
            try {
              await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: targetChatId,
                  text: `✅ <b>فیش واریزی فاکتور ${escapeHtml(inv.invoiceNumber)} تأیید شد!</b>\n\n💰 مبلغ: <b>${pay.amount.toLocaleString()} تومان</b>\n📌 وضعیت فاکتور: <b>${inv.status === 'paid' ? 'تسویه کامل' : 'پرداخت جزئی'}</b>\n\nباتشکر از پرداخت شما 🌹`,
                  parse_mode: 'HTML'
                })
              });
            } catch (e) {
              console.error(e);
            }
          }

          // Broadcast to finance topic in supergroup
          await notifyForumTopic(
            ctx,
            'finance',
            `✅ <b>فیش فاکتور اختصاصی ${escapeHtml(inv.invoiceNumber)} تأیید شد:</b>\n\n👤 مشتری: <b>${escapeHtml(inv.customerName)}</b>\n💰 مبلغ: <b>${pay.amount.toLocaleString('fa-IR')} تومان</b>\n💳 وضعیت فاکتور: <b>${inv.status === 'paid' ? 'تسویه کامل' : 'پرداخت جزئی'}</b>`
          );

          await tgSend(ctx, `✅ فیش واریزی فاکتور <b>${escapeHtml(inv.invoiceNumber)}</b> تأیید شد.\n📌 وضعیت: <b>${inv.status === 'paid' ? 'تسویه کامل' : 'پرداخت جزئی'}</b>`, [
            [{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }],
            [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
          ]);
          return true;
        }
      }
    }
    await tgSend(ctx, 'ℹ️ این پرداخت قبلاً بررسی شده یا فاکتور یافت نشد.', [[{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }]]);
    return true;
  }

  // Manual Invoice Payment Rejection
  if (data.startsWith('admin_inva_reject_')) {
    const parts = data.replace('admin_inva_reject_', '').split('_');
    const invoiceId = parts[0];
    const paymentId = parts[1];
    if (Array.isArray(ctx.invoices)) {
      const inv = ctx.invoices.find((i: any) => i.id === invoiceId);
      if (inv && Array.isArray(inv.payments)) {
        const pay = inv.payments.find((p: any) => p.id === paymentId);
        if (pay) {
          pay.status = 'rejected';
          pay.updatedAt = new Date().toISOString();
          inv.paidAmount = inv.payments.filter((p: any) => p.status === 'confirmed').reduce((s: number, p: any) => s + p.amount, 0);
          inv.remainingAmount = Math.max(0, inv.totalAmount - inv.paidAmount);
          inv.status = inv.paidAmount > 0 ? 'partially_paid' : 'unpaid';
          inv.updatedAt = new Date().toISOString();

          const targetChatId = inv.customerTelegramId || ctx.customers.find((c: any) => c.id === inv.customerId)?.telegramId;
          if (targetChatId && targetChatId !== 'guest') {
            ctx.userStates.set(String(targetChatId), { mode: 'invoice_payment_receipt', invoiceId: inv.id });
            try {
              await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: targetChatId,
                  text: `❌ <b>فیش واریزی ارسالی برای فاکتور ${escapeHtml(inv.invoiceNumber)} قابل تأیید نبود.</b>\n\nلطفاً تصویر فیش صحیح را مجدداً در همین صفحه ارسال فرمایید یا با پشتیبانی تماس بگیرید.`,
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: [[{ text: '💳 ارسال مجدد فیش', callback_data: `invoice_payment_${inv.id}` }], [{ text: '🏠 منوی اصلی', callback_data: 'back_to_main' }]] }
                })
              });
            } catch (e) {
              console.error(e);
            }
          }

          // Broadcast to finance topic in supergroup
          await notifyForumTopic(
            ctx,
            'finance',
            `❌ <b>فیش فاکتور اختصاصی ${escapeHtml(inv.invoiceNumber)} رد شد:</b>\n\n👤 مشتری: <b>${escapeHtml(inv.customerName)}</b>\n💰 مبلغ: <b>${pay.amount.toLocaleString('fa-IR')} تومان</b>`
          );

          await tgSend(ctx, `❌ فیش واریزی فاکتور <b>${escapeHtml(inv.invoiceNumber)}</b> رد شد و به مشتری اطلاع داده شد.`, [
            [{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }],
            [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
          ]);
          return true;
        }
      }
    }
    await tgSend(ctx, 'ℹ️ فاکتور یافت نشد.', [[{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }]]);
    return true;
  }

  // Custom cake prepayment approval
  if (data.startsWith('admin_cpreapprove_')) {
    const co = ctx.customOrders.find(o => o.id === data.replace('admin_cpreapprove_', ''));
    if (co) {
      co.isPrepaymentPaid = true;
      co.prepaymentStatus = 'approved';
      co.status = 'receipt_confirmed';
      co.prepaymentReviewedAt = new Date().toISOString();
      co.updatedAt = new Date().toISOString();
      if (co.customerTelegramId && co.customerTelegramId !== 'guest') {
        try {
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: co.customerTelegramId,
              text: `✅ <b>فیش بیعانه کیک شما تأیید شد!</b>\n\n🔖 سفارش <code>${co.orderNumber}</code>\n📌 وضعیت: <b>تأیید بیعانه — آماده شروع پخت</b>\n👩‍🍳 سفارش شما با موفقیت وارد چرخه پخت شد.`,
              parse_mode: 'HTML'
            })
          });
        } catch (e) {
          console.error(e);
        }
      }
      await tgSend(ctx, `✅ فیش بیعانه سفارش دلخواه <b>${co.orderNumber}</b> تأیید شد.\n📌 وضعیت: فیش تأیید شده (آماده پخت)`, [
        [{ text: '👩‍🍳 شروع پخت کیک', callback_data: `admin_cstatus_${co.id}_baking` }],
        [{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ]);
    }
    return true;
  }

  // Custom cake prepayment rejection
  if (data.startsWith('admin_cprereject_')) {
    const co = ctx.customOrders.find(o => o.id === data.replace('admin_cprereject_', ''));
    if (co) {
      co.prepaymentStatus = 'rejected';
      co.isPrepaymentPaid = false;
      co.prepaymentReviewedAt = new Date().toISOString();
      co.updatedAt = new Date().toISOString();
      if (co.customerTelegramId && co.customerTelegramId !== 'guest') {
        try {
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: co.customerTelegramId,
              text: `❌ <b>فیش بیعانه ارسالی برای سفارش کیک ${co.orderNumber} مورد تأیید قرار نگرفت.</b>\n\nلطفاً تصویر فیش صحیح را مجدداً در ربات ارسال فرمایید یا با پشتیبانی تماس بگیرید.`,
              parse_mode: 'HTML'
            })
          });
        } catch (e) {
          console.error(e);
        }
      }
      await tgSend(ctx, `❌ فیش بیعانه سفارش دلخواه <b>${co.orderNumber}</b> رد شد.`, [
        [{ text: '🧾 مرکز فاکتورها', callback_data: 'admin_invoices' }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ]);
    }
    return true;
  }

  // Admins & Staff Access Manager
  if (data === 'admin_admins_manager') {
    const superAdmin = ctx.botSettings.adminTelegramId || '❌ تنظیم نشده';
    const assistantAdmins: string[] = (ctx.botSettings.adminTelegramIds || []).map(String);
    let text = `🛡️ <b>مدیریت مدیران و دسترسی‌های ربات تلگرام</b>\n────────────────────\n`;
    text += `👑 <b>مدیر ارشد (Super Admin):</b> <code>${superAdmin}</code>\n\n`;
    text += `👥 <b>مدیران و پرسنل کمکی (${assistantAdmins.length}):</b>\n`;
    if (assistantAdmins.length === 0) {
      text += `<i>هیچ مدیر کمکی ثبت نشده است.</i>\n`;
    } else {
      assistantAdmins.forEach((id, i) => {
        text += `${i + 1}️⃣ شناسه: <code>${id}</code>\n`;
      });
    }
    text += `────────────────────\n💡 <i>پرسنل با شناسه بالا می‌توانند با زدن دستور /start به پنل مدیریت در تلگرام دسترسی داشته باشند.</i>`;

    const btns: any[][] = [
      [{ text: '➕ افزودن مدیر جدید', callback_data: 'admin_add_admin_prompt' }],
      [{ text: '👑 تغییر شناسه مدیر ارشد', callback_data: 'admin_edit_super_admin' }]
    ];
    if (assistantAdmins.length > 0) {
      for (const id of assistantAdmins) {
        btns.push([{ text: `🗑️ حذف دسترسی ${id}`, callback_data: `admin_del_admin_${id}` }]);
      }
    }
    btns.push([{ text: '👨‍🍳 بازگشت به پنل ادمین', callback_data: 'admin_panel' }]);
    await tgSend(ctx, text, btns);
    return true;
  }

  if (data === 'admin_add_admin_prompt') {
    ctx.userStates.set(ctx.chatId, { mode: 'admin_add_admin_id' });
    await tgSend(ctx, '➕ <b>افزودن مدیر جدید:</b>\n\nلطفاً <b>شناسه عددی تلگرام (Telegram ID)</b> پرسنل مورد نظر را ارسال کنید:\n(شناسه را از ربات @userinfobot دریافت کنید)', [
      [{ text: '❌ انصراف', callback_data: 'admin_admins_manager' }]
    ]);
    return true;
  }

  if (data === 'admin_edit_super_admin') {
    ctx.userStates.set(ctx.chatId, { mode: 'admin_edit_super_admin_id' });
    await tgSend(ctx, `👑 <b>تغییر مدیر ارشد:</b>\nشناسه فعلی: <code>${ctx.botSettings.adminTelegramId || 'تنظیم نشده'}</code>\n\nشناسه عددی جدید را ارسال کنید:`, [
      [{ text: '❌ انصراف', callback_data: 'admin_admins_manager' }]
    ]);
    return true;
  }

  if (data.startsWith('admin_del_admin_')) {
    const idToRemove = data.replace('admin_del_admin_', '');
    const currentList: string[] = (ctx.botSettings.adminTelegramIds || []).map(String);
    ctx.botSettings.adminTelegramIds = currentList.filter(x => String(x) !== String(idToRemove));
    await tgSend(ctx, `🗑️ دسترسی مدیر با شناسه <code>${idToRemove}</code> با موفقیت حذف شد.`, [
      [{ text: '🛡️ لیست مدیران', callback_data: 'admin_admins_manager' }],
      [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Forum Topics Supergroup Manager (8 Topics)
  if (data === 'admin_forum_topics') {
    const isConnected = !!ctx.botSettings.forumGroupId;
    const topics = ctx.botSettings.forumTopics || [];
    let msg = `🏷️ <b>سوپرگروه تاپیک‌دار تلگرام (۸ تاپیک تفکیک‌شده)</b>\n────────────────────\n`;
    msg += `🔹 <b>وضعیت اتصال:</b> ${isConnected ? `🟢 متصل به گروه (<code>${ctx.botSettings.forumGroupId}</code>)` : '⚠️ گروه تنظیم نشده'}\n`;
    msg += `🔹 <b>نام گروه:</b> ${ctx.botSettings.forumGroupTitle || 'گروه مدیریت قنادی'}\n`;
    msg += `────────────────────\n<b>📌 تاپیک‌های فعال قنادی:</b>\n\n`;

    topics.forEach((t: any) => {
      msg += `${t.iconEmoji || '📌'} <b>${t.name}</b> (Thread #<code>${t.threadId || '---'}</code>)\n   ▫️ وضعیت: ${t.enabled !== false ? '🟢 فعال' : '🔴 غیرفعال'}\n   ▫️ شرح: ${t.description}\n\n`;
    });

    await tgSend(ctx, msg, [
      [{ text: '⚡ ساخت خودکار ۸ تاپیک در گروه', callback_data: 'admin_forum_setup_topics' }],
      [{ text: '✏️ تنظیم دستی شناسه گروه', callback_data: 'admin_forum_edit_group_id' }],
      [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  if (data === 'admin_forum_edit_group_id') {
    ctx.userStates.set(ctx.chatId, { mode: 'admin_edit_forum_group_id' });
    await tgSend(ctx, `🏷️ <b>تنظیم شناسه گروه گزارشات:</b>\n\nشناسه فعلی: <code>${ctx.botSettings.forumGroupId || 'تنظیم نشده'}</code>\n\nلطفاً شناسه گروه (مثلاً <code>-1002345678901</code>) را ارسال کنید:`, [
      [{ text: '❌ انصراف', callback_data: 'admin_forum_topics' }]
    ]);
    return true;
  }

  if (data === 'admin_forum_setup_topics') {
    if (!ctx.botSettings.forumGroupId) {
      await tgSend(ctx, '⚠️ ابتدا ربات را به سوپرگروه اضافه و ادمین کنید یا شناسه گروه را در پنل ثبت نمایید.', [
        [{ text: '🏷️ تاپیک‌های گروه', callback_data: 'admin_forum_topics' }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ]);
      return true;
    }

    await tgSend(ctx, `⏳ <b>در حال بررسی سوپرگروه و ساخت ۸ تاپیک در گروه <code>${ctx.botSettings.forumGroupId}</code>...</b>\n\nنتیجه در همین چت و گروه گزارش می‌شود.`);

    try {
      const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/telegram/forum/setup-all-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: ctx.botSettings.forumGroupId, token: ctx.token }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (data.success) {
        await tgSend(ctx, `✅ ${data.message}`, [
          [{ text: '🏷️ مشاهده تاپیک‌ها', callback_data: 'admin_forum_topics' }],
          [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
        ]);
      } else {
        await tgSend(ctx, `⚠️ ${data.message || 'خطا در ساخت تاپیک‌ها'}`, [
          [{ text: '🏷️ بازگشت به تاپیک‌ها', callback_data: 'admin_forum_topics' }]
        ]);
      }
    } catch (e: any) {
      await tgSend(ctx, `❌ خطا در برقراری ارتباط: ${e.message}`, [
        [{ text: '🏷️ بازگشت به تاپیک‌ها', callback_data: 'admin_forum_topics' }]
      ]);
    }
    return true;
  }

  // Backup & Database Management
  if (data === 'admin_backup') {
    const snapCount = Array.isArray(ctx.orders) ? ctx.orders.length : 0;
    let text = `💾 <b>بکاپ و پایگاه داده قنادی</b>\n────────────────────\n`;
    text += `📦 سفارشات ثبت‌شده: <b>${ctx.orders.length}</b>\n`;
    text += `🎂 کیک‌های سفارشی: <b>${ctx.customOrders.length}</b>\n`;
    text += `🧁 محصولات: <b>${ctx.products.length}</b>\n`;
    text += `👥 مشتریان: <b>${ctx.customers.length}</b>\n`;
    text += `🎟️ کدهای تخفیف: <b>${ctx.discounts.length}</b>\n`;
    text += `────────────────────\n`;
    text += `دیتابیس سیستم به صورت فایل‌های JSON مستقل روی دیسک سرور با امنیت کامل ذخیره و هر ۱۰ ثانیه همگام‌سازی می‌شود.`;

    await tgSend(ctx, text, [
      [{ text: '⚡ ایجاد نسخه پشتیبان فوری (اسنپ‌شات)', callback_data: 'admin_create_instant_snapshot' }],
      [{ text: '🌐 مشخصات ورود به پنل وب', callback_data: 'admin_web_info' }],
      [{ text: '👨‍🍳 بازگشت به منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  if (data === 'admin_create_instant_snapshot') {
    const timeStr = new Date().toLocaleTimeString('fa-IR');
    await tgSend(ctx, `✅ <b>نسخه پشتیبان فوری دیتابیس با موفقیت ایجاد شد!</b>\n\n⏰ زمان بکاپ: <b>${timeStr}</b>\n📁 فایل‌های data.json و settings.json روی سرور به‌روز شدند.`, [
      [{ text: '💾 منوی بکاپ', callback_data: 'admin_backup' }],
      [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Add Product Flow
  if (data === 'admin_add_product') {
    ctx.userStates.set(ctx.chatId, { mode: 'add_product_name', draft: {} });
    await tgSend(ctx, '➕ <b>افزودن محصول (مرحله ۱ از ۵)</b>\n\nنام محصول را ارسال کنید:', [[{ text: '❌ انصراف', callback_data: 'admin_panel' }]]);
    return true;
  }

  // Products Manager
  if (data === 'admin_products_manager') {
    if (ctx.products.length === 0) {
      await tgSend(ctx, '🧁 محصولی ثبت نشده.', [[{ text: '➕ افزودن', callback_data: 'admin_add_product' }], [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
      return true;
    }
    await tgSend(ctx, `🧁 <b>محصولات (${ctx.products.length}):</b>`);
    for (const p of ctx.products.slice(0, 10)) {
      await tgSend(ctx, `🎂 <b>${p.name}</b>\n▫️ ${p.category} | ${p.price.toLocaleString()} / ${p.unit}\n▫️ ${p.isAvailable ? '🟢 موجود' : '🔴 ناموجود'}`, [
        [{ text: p.isAvailable ? '🔴 ناموجود' : '🟢 موجود', callback_data: `admin_toggle_avail_${p.id}` }, { text: '✏️ قیمت', callback_data: `admin_edit_price_${p.id}` }],
        [{ text: '🗑️ حذف', callback_data: `admin_delete_prod_${p.id}` }],
        [{ text: '⬅️ بازگشت به پنل', callback_data: 'admin_panel' }]
      ], p.image);
    }
    return true;
  }

  // Toggle availability
  if (data.startsWith('admin_toggle_avail_')) {
    const prod = ctx.products.find(p => p.id === data.replace('admin_toggle_avail_', ''));
    if (prod) { prod.isAvailable = !prod.isAvailable; await tgSend(ctx, `${prod.name}: ${prod.isAvailable ? '🟢' : '🔴'}`, [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }]]); }
    return true;
  }

  // Edit price prompt
  if (data.startsWith('admin_edit_price_')) {
    const prod = ctx.products.find(p => p.id === data.replace('admin_edit_price_', ''));
    if (prod) {
      ctx.userStates.set(ctx.chatId, { mode: 'edit_price', productId: prod.id });
      await tgSend(ctx, `✏️ <b>${prod.name}</b>\nقیمت فعلی: <b>${prod.price.toLocaleString()}</b>\n\nقیمت جدید را ارسال کنید:`);
    }
    return true;
  }

  // Delete product
  if (data.startsWith('admin_delete_prod_')) {
    const idx = ctx.products.findIndex(p => p.id === data.replace('admin_delete_prod_', ''));
    if (idx !== -1) { const n = ctx.products[idx].name; ctx.products.splice(idx, 1); await tgSend(ctx, `🗑️ <b>${n}</b> حذف شد.`, [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }]]); }
    return true;
  }

  // Orders List
  if (data === 'admin_orders_list') {
    if (ctx.orders.length === 0) { await tgSend(ctx, '📦 سفارشی ثبت نشده.', [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]); return true; }
    for (const o of ctx.orders.slice(0, 5)) {
      const items = o.items.map(i => `▫️ ${escapeHtml(i.productName)} (${i.quantity})`).join('\n');
      const hasReceipt = !!o.paymentReceiptImage;
      const awaitingReceipt = (o.status === 'pending_payment' || o.status === 'paid_checking')
        && !['confirmed', 'rejected'].includes(o.receiptReviewStatus || '');
      const canStartProduction = o.status === 'receipt_confirmed'
        || (o.paymentMethod === 'cash_on_delivery' && o.status === 'pending_payment');
      const statusLabel = {
        pending_payment: '⏳ در انتظار پرداخت',
        paid_checking: '🔍 فیش در انتظار بررسی',
        receipt_confirmed: '✅ فیش تأیید شده — آماده شروع پخت',
        baking: '👩‍🍳 در حال پخت',
        shipped: '🛵 در حال ارسال',
        delivered: '✅ تحویل شده',
        cancelled: '❌ لغو شده',
      }[o.status] || o.status;
      const buttons: any[][] = [];
      if (canStartProduction) {
        buttons.push([{ text: '👩‍🍳 شروع پخت', callback_data: `admin_status_${o.id}_baking` }]);
      }
      if (o.status === 'baking') {
        buttons.push([{ text: '🛵 تحویل به پیک', callback_data: `admin_status_${o.id}_shipped` }]);
      }
      if (o.status === 'shipped') {
        buttons.push([{ text: '✅ تحویل شد', callback_data: `admin_status_${o.id}_delivered` }]);
      }
      if (o.status !== 'delivered' && o.status !== 'cancelled') {
        buttons.push([{ text: '❌ لغو', callback_data: `admin_status_${o.id}_cancelled` }]);
      }
      if (hasReceipt || awaitingReceipt) {
        if (hasReceipt) {
          buttons.push([{ text: '🧾 مشاهده تصویر فیش', callback_data: `admin_receipt_${o.id}` }]);
        }
        if (awaitingReceipt) {
          buttons.push([
            { text: '✅ تأیید واریزی', callback_data: `admin_rapprove_${o.id}` },
            { text: '❌ رد فیش', callback_data: `admin_rreject_${o.id}` }
          ]);
        }
      }
      const caption = `📋 <b>${escapeHtml(o.orderNumber)}</b> - ${escapeHtml(o.customerName)}\n📞 <code>${escapeHtml(o.customerPhone)}</code>\n${items}\n💰 <b>${o.totalAmount.toLocaleString()}</b>\n📌 وضعیت: <b>${statusLabel}</b>${hasReceipt ? '\n🧾 فیش واریزی ثبت شده' : ''}`;
      buttons.push([{ text: '⬅️ بازگشت به پنل', callback_data: 'admin_panel' }]);
      await tgSend(ctx, caption, buttons);
    }
    return true;
  }

  // View a customer's payment receipt photo (file_id works natively in Telegram)
  if (data.startsWith('admin_receipt_')) {
    const order = ctx.orders.find(o => o.id === data.replace('admin_receipt_', ''));
    if (order && order.paymentReceiptImage) {
      const canReviewReceipt = (order.status === 'pending_payment' || order.status === 'paid_checking')
        && !['confirmed', 'rejected'].includes(order.receiptReviewStatus || '');
      const receiptButtons = [
        ...(canReviewReceipt ? [[
          { text: '✅ تایید فیش', callback_data: `admin_rapprove_${order.id}` },
          { text: '❌ رد فیش', callback_data: `admin_rreject_${order.id}` },
        ]] : []),
        [{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }],
      ];
      await tgSend(
        ctx,
        `🧾 <b>فیش واریزی سفارش ${escapeHtml(order.orderNumber)}</b>\n👤 ${escapeHtml(order.customerName)}\n💰 ${order.totalAmount.toLocaleString()} تومان${order.status === 'receipt_confirmed' ? '\n📌 وضعیت: فیش تأیید شده — در انتظار شروع پخت' : ''}`,
        receiptButtons,
        order.paymentReceiptImage
      );
    } else if (order) {
      await tgSend(ctx, '🧾 برای این سفارش فیش تصویری ثبت نشده است.', [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }]]);
    }
    return true;
  }

  // Approve payment receipt -> payment is verified; baking remains an explicit action.
  if (data.startsWith('admin_rapprove_')) {
    const order = ctx.orders.find(o => o.id === data.replace('admin_rapprove_', ''));
    if (order && (order.receiptReviewStatus === 'rejected' || (['receipt_confirmed', 'baking', 'shipped', 'delivered'].includes(order.status) && order.receiptReviewStatus === 'confirmed'))) {
      await tgSend(ctx, order.receiptReviewStatus === 'rejected' ? 'ℹ️ این فیش قبلاً رد شده است. لطفاً منتظر ارسال فیش جدید توسط مشتری بمانید.' : 'ℹ️ فیش این سفارش قبلاً تأیید شده است.', [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }]]);
      return true;
    }
    if (order) {
      const reviewedAt = new Date().toISOString();
      order.status = 'receipt_confirmed';
      order.receiptReviewStatus = 'confirmed';
      order.receiptReviewedAt = reviewedAt;
      delete order.receiptReviewReason;
      order.updatedAt = reviewedAt;
      if (order.customerTelegramId && order.customerTelegramId !== 'guest') {
        try {
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: order.customerTelegramId,
              text: `✅ <b>فیش واریزی شما تأیید شد!</b>\n\n🔖 سفارش <code>${escapeHtml(order.orderNumber)}</code>\n📌 وضعیت سفارش: <b>فیش تأیید شده</b>\n👩‍🍳 سفارش شما آمادهٔ شروع پخت و تزیین است.`,
              parse_mode: 'HTML'
            })
          });
        } catch (e) {
          console.error('Failed to notify customer about receipt approval:', e);
        }
      }
      await tgSend(ctx, `✅ فیش سفارش <b>${escapeHtml(order.orderNumber)}</b> تأیید شد و به مشتری اطلاع داده شد.\n📌 وضعیت: فیش تأیید شده\n👩‍🍳 برای شروع پخت، دکمه «شروع پخت» را جداگانه انتخاب کنید.`, [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }], [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    }
    return true;
  }

  // Reject payment receipt -> order back to pending + customer asked to re-send
  if (data.startsWith('admin_rreject_')) {
    const order = ctx.orders.find(o => o.id === data.replace('admin_rreject_', ''));
    if (order) {
      const reviewedAt = new Date().toISOString();
      order.status = 'pending_payment';
      order.receiptReviewStatus = 'rejected';
      order.receiptReviewedAt = reviewedAt;
      delete order.receiptReviewReason;
      order.updatedAt = reviewedAt;
      // Re-arm the customer's photo state so a replacement receipt sent in
      // this chat is accepted after an admin rejection.
      if (order.customerTelegramId && order.customerTelegramId !== 'guest') {
        ctx.userStates.set(String(order.customerTelegramId), { mode: 'waiting_for_receipt', orderId: order.id });
      }
      if (order.customerTelegramId && order.customerTelegramId !== 'guest') {
        try {
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: order.customerTelegramId,
              text: `❌ <b>متأسفانه فیش واریزی قابل تأیید نبود.</b>\n\n🔖 سفارش <code>${escapeHtml(order.orderNumber)}</code>\n📌 وضعیت: در انتظار پرداخت\n\nلطفاً فیش صحیح را دوباره در همین چت ارسال کنید یا با پشتیبانی تماس بگیرید.`,
              parse_mode: 'HTML'
            })
          });
        } catch (e) {
          console.error('Failed to notify customer about receipt rejection:', e);
        }
      }
      await tgSend(ctx, `❌ فیش سفارش <b>${escapeHtml(order.orderNumber)}</b> رد شد و از مشتری خواسته شد فیش را مجدد ارسال کند.`, [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }], [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    }
    return true;
  }

  // Order status change
  if (data.startsWith('admin_status_')) {
    const parts = data.replace('admin_status_', '').split('_');
    const order = ctx.orders.find(o => o.id === parts[0]);
    if (order) {
      const nextStatus = parts[1];
      const canStartProduction = order.status === 'receipt_confirmed'
        || (order.paymentMethod === 'cash_on_delivery' && order.status === 'pending_payment');
      if (nextStatus === 'baking' && !canStartProduction) {
        await tgSend(ctx, '⏳ ابتدا فیش را تأیید کنید. پس از نمایش وضعیت «فیش تأیید شده»، دکمه «شروع پخت» فعال می‌شود.', [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }]]);
        return true;
      }
      order.status = nextStatus as any; order.updatedAt = new Date().toISOString();
      const labels: any = { baking: '👩‍🍳 پخت', shipped: '🛵 ارسال', delivered: '✅ تحویل', cancelled: '❌ لغو' };
      await tgSend(ctx, `✅ ${order.orderNumber}: <b>${labels[parts[1]] || parts[1]}</b>`, [[{ text: '📦 سفارشات', callback_data: 'admin_orders_list' }], [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    }
    return true;
  }

  // Custom Orders
  if (data === 'admin_custom_orders') {
    if (ctx.customOrders.length === 0) { await tgSend(ctx, '🎂 سفارش دلخواهی ثبت نشده.', [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]); return true; }
    for (const o of ctx.customOrders.slice(0, 5)) {
      const mayStartProduction = canStartCustomProduction(o);
      const prepaymentLabel = o.prepaymentStatus === 'pending_confirmation'
        ? '⏳ فیش بیعانه در انتظار تأیید ادمین'
        : o.prepaymentStatus === 'rejected'
          ? '❌ فیش بیعانه رد شده'
          : o.prepaymentStatus === 'approved' || (!o.prepaymentStatus && o.isPrepaymentPaid)
            ? '✅ بیعانه تأیید شده'
            : o.prepaymentAmount
              ? '💳 در انتظار ارسال فیش بیعانه'
              : '💵 پرداخت هنگام تحویل';
      const productionRow = mayStartProduction
        ? [{ text: '👨‍🍳 پخت', callback_data: `admin_cstatus_${o.id}_baking` }, { text: '✅ آماده', callback_data: `admin_cstatus_${o.id}_ready` }]
        : [{ text: '⏳ شروع پخت پس از تأیید بیعانه', callback_data: 'admin_custom_orders' }];
      const customStatusLabel = o.status === 'receipt_confirmed'
        ? '✅ فیش بیعانه تأیید شده — آماده شروع پخت'
        : o.status === 'baking'
          ? '👨‍🍳 در حال پخت و تزیین'
          : o.status;
      await tgSend(ctx, `🎂 <b>${o.orderNumber}</b> - ${o.customerName}\n▫️ ${o.pastryType}\n▫️ وضعیت: ${customStatusLabel}\n▫️ پرداخت: ${prepaymentLabel}`, [
        [{ text: '💰 قیمت‌گذاری', callback_data: `admin_quote_${o.id}` }],
        productionRow,
        [{ text: '❌ رد', callback_data: `admin_cstatus_${o.id}_rejected` }],
        [{ text: '⬅️ بازگشت به پنل', callback_data: 'admin_panel' }]
      ]);
    }
    return true;
  }

  // Quote custom order
  if (data.startsWith('admin_quote_')) {
    ctx.userStates.set(ctx.chatId, { mode: 'quote_price', orderId: data.replace('admin_quote_', '') });
    await tgSend(ctx, '💰 مبلغ نهایی سفارش دلخواه را ارسال کنید:', [[{ text: '❌ انصراف', callback_data: 'admin_custom_orders' }]]);
    return true;
  }

  // Custom order status. Never let a Telegram-admin shortcut bypass the
  // prepayment reviewer that the web panel uses.
  if (data.startsWith('admin_cstatus_')) {
    const payload = data.replace('admin_cstatus_', '');
    const separator = payload.lastIndexOf('_');
    const orderId = separator > 0 ? payload.slice(0, separator) : '';
    const nextStatus = separator > 0 ? payload.slice(separator + 1) : '';
    const order = ctx.customOrders.find(o => o.id === orderId);
    const allowedStatuses = ['baking', 'ready', 'delivered', 'rejected'];
    if (!order || !allowedStatuses.includes(nextStatus)) {
      await tgSend(ctx, '❌ سفارش یا وضعیت موردنظر معتبر نیست.', [[{ text: '🎂 سفارشات دلخواه', callback_data: 'admin_custom_orders' }]]);
      return true;
    }
    if (['baking', 'ready', 'delivered'].includes(nextStatus) && !canStartCustomProduction(order)) {
      await tgSend(ctx, '⏳ ابتدا فیش بیعانه را از پنل وب تأیید کنید یا پرداخت هنگام تحویل را برای سفارش ثبت کنید.', [[{ text: '🎂 سفارشات دلخواه', callback_data: 'admin_custom_orders' }]]);
      return true;
    }
    order.status = nextStatus as any;
    order.updatedAt = new Date().toISOString();
    await tgSend(ctx, `✅ وضعیت: <b>${nextStatus}</b>`, [[{ text: '🎂 سفارشات دلخواه', callback_data: 'admin_custom_orders' }]]);
    return true;
  }

  // Discounts
  if (data === 'admin_discounts_list') {
    const btns: any[][] = [[{ text: '➕ افزودن تخفیف', callback_data: 'admin_add_discount' }]];
    for (const d of ctx.discounts) {
      btns.push([{ text: `${d.code} - ${d.type === 'percentage' ? d.value + '٪' : d.value.toLocaleString()} ${d.isActive ? '🟢' : '🔴'}`, callback_data: `admin_toggle_disc_${d.id}` }, { text: '🗑️', callback_data: `admin_del_disc_${d.id}` }]);
    }
    btns.push([{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]);
    await tgSend(ctx, `🎟️ <b>کدهای تخفیف (${ctx.discounts.length}):</b>`, btns);
    return true;
  }

  if (data === 'admin_add_discount') {
    ctx.userStates.set(ctx.chatId, { mode: 'add_discount' });
    await tgSend(ctx, '🎟️ <b>افزودن کد تخفیف</b>\n\nفرمت: <code>CODE 20 percent</code>\nیا: <code>CODE 50000 fixed</code>\n\nمثال: <code>SWEET20 20 percent</code>', [
      [{ text: '❌ انصراف', callback_data: 'admin_discounts_list' }]
    ]);
    return true;
  }

  if (data.startsWith('admin_toggle_disc_')) {
    const d = ctx.discounts.find(x => x.id === data.replace('admin_toggle_disc_', ''));
    if (d) { d.isActive = !d.isActive; await tgSend(ctx, `${d.code}: ${d.isActive ? '🟢 فعال' : '🔴 غیرفعال'}`, [[{ text: '🎟️ تخفیف‌ها', callback_data: 'admin_discounts_list' }]]); }
    return true;
  }

  if (data.startsWith('admin_del_disc_')) {
    const idx = ctx.discounts.findIndex(x => x.id === data.replace('admin_del_disc_', ''));
    if (idx !== -1) { ctx.discounts.splice(idx, 1); await tgSend(ctx, '🗑️ حذف شد.', [[{ text: '🎟️ تخفیف‌ها', callback_data: 'admin_discounts_list' }]]); }
    return true;
  }

  // Customers
  if (data === 'admin_customers_manager') {
    if (ctx.customers.length === 0) { await tgSend(ctx, '👥 مشتری‌ای ثبت نشده.', [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]); return true; }
    let text = `👥 <b>مشتریان (${ctx.customers.length}):</b>\n\n`;
    for (const c of ctx.customers.slice(0, 15)) {
      text += `👤 <b>${c.name}</b>\n📞 <code>${c.phone || '---'}</code> | @${c.username || '---'}\n💳 ${(c.walletBalance || 0).toLocaleString()} | ${c.totalOrdersCount} سفارش | ${c.tier}\n\n`;
    }
    await tgSend(ctx, text, [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    return true;
  }

  // Support Tickets
  if (data === 'admin_support_list') {
    const open = ctx.supportTickets.filter(t => t.status === 'open' || t.status === 'in_progress');
    if (open.length === 0) {
      await tgSend(ctx, '💬 <b>مرکز پشتیبانی و تیکت‌ها</b>\n\n✅ تیکت بازی وجود ندارد و به تمام پیام‌های مشتریان پاسخ داده شده است.', [
        [{ text: '👨‍🍳 بازگشت به پنل ادمین', callback_data: 'admin_panel' }]
      ]);
      return true;
    }
    await tgSend(ctx, `💬 <b>تیکت‌های باز پشتیبانی (${open.length} مورد):</b>\nجهت ارسال پاسخ به مشتری یا بستن تیکت از دکمه‌های زیر استفاده کنید:`);
    for (const t of open.slice(0, 5)) {
      await tgSend(ctx, `💬 <b>تیکت #${t.ticketNumber}</b> - 👤 <b>${t.customerName}</b>\n📞 <code>${t.customerPhone || '---'}</code>\n📌 موضوع: <b>${t.subject}</b>\n──────────────\n<i>${t.message || ''}</i>`, [
        [{ text: '✍️ ارسال پاسخ به مشتری', callback_data: `admin_reply_ticket_${t.id}` }, { text: '✅ بستن تیکت', callback_data: `admin_close_ticket_${t.id}` }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ]);
    }
    return true;
  }

  if (data.startsWith('admin_reply_ticket_')) {
    const ticketId = data.replace('admin_reply_ticket_', '');
    const ticket = ctx.supportTickets.find(t => t.id === ticketId);
    if (ticket) {
      ctx.userStates.set(ctx.chatId, { mode: 'admin_reply_ticket_text', ticketId });
      await tgSend(ctx, `✍️ <b>پاسخ به تیکت #${ticket.ticketNumber}</b>\n👤 مشتری: <b>${ticket.customerName}</b>\n📌 موضوع: ${ticket.subject}\n\nلطفاً متن پاسخ خود را ارسال کنید:`, [
        [{ text: '❌ انصراف', callback_data: 'admin_support_list' }]
      ]);
    }
    return true;
  }

  if (data.startsWith('admin_close_ticket_')) {
    const t = ctx.supportTickets.find(x => x.id === data.replace('admin_close_ticket_', ''));
    if (t) {
      t.status = 'answered';
      t.updatedAt = new Date().toISOString();
      await tgSend(ctx, `✅ تیکت #${t.ticketNumber} با موفقیت بسته شد.`, [[{ text: '💬 تیکت‌ها', callback_data: 'admin_support_list' }], [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]]);
    }
    return true;
  }

  // Stats
  if (data === 'admin_sales_stats') {
    const revenue = ctx.orders.reduce((s, o) => s + (o.status !== 'cancelled' ? o.totalAmount : 0), 0);
    const today = ctx.orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString());
    await tgSend(ctx, `📊 <b>آمار فروش:</b>\n\n💰 مجموع فروش: <b>${revenue.toLocaleString()}</b>\n📦 کل سفارشات: <b>${ctx.orders.length}</b>\n📅 امروز: <b>${today.length}</b> سفارش\n🧁 محصولات: <b>${ctx.products.filter(p => p.isAvailable).length}</b> فعال\n👥 مشتریان: <b>${ctx.customers.length}</b>\n🎂 سفارش دلخواه: <b>${ctx.customOrders.length}</b>`, [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    return true;
  }

  // Settings
  if (data === 'admin_settings') {
    const s = ctx.botSettings;
    await tgSend(ctx, `⚙️ <b>تنظیمات:</b>\n\n🏢 فروشگاه: ${s.storeName || '❌ تنظیم نشده'}\n📞 تلفن: ${s.storePhone || '❌'}\n🏠 آدرس: ${s.storeAddress || '❌'}\n💳 کارت: ${s.cardNumber ? '<code>' + s.cardNumber + '</code>' : '❌'}\n👤 صاحب: ${s.cardHolder || '❌'}\n🛵 پیک: ${s.shippingFee ? s.shippingFee.toLocaleString() : '0'} تومان\n🎁 ارسال رایگان: ${s.freeShippingThreshold ? s.freeShippingThreshold.toLocaleString() : '0'} تومان`, [
      [{ text: '✏️ ویرایش فروشگاه', callback_data: 'admin_edit_store' }],
      [{ text: '✏️ ویرایش کارت', callback_data: 'admin_edit_card' }],
      [{ text: '✏️ ویرایش ارسال', callback_data: 'admin_edit_shipping' }],
      [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  if (data === 'admin_edit_store') {
    ctx.userStates.set(ctx.chatId, { mode: 'edit_store_name' });
    await tgSend(ctx, `✏️ <b>نام فروشگاه:</b>\nفعلی: ${ctx.botSettings.storeName || '---'}\n\nنام جدید را ارسال کنید:`, [[{ text: '❌ انصراف', callback_data: 'admin_settings' }]]);
    return true;
  }

  if (data === 'admin_edit_card') {
    ctx.userStates.set(ctx.chatId, { mode: 'edit_card_number' });
    await tgSend(ctx, `✏️ <b>شماره کارت:</b>\nفعلی: ${ctx.botSettings.cardNumber || '---'}\n\nشماره جدید را ارسال کنید:`, [[{ text: '❌ انصراف', callback_data: 'admin_settings' }]]);
    return true;
  }

  if (data === 'admin_edit_shipping') {
    ctx.userStates.set(ctx.chatId, { mode: 'edit_shipping_fee' });
    await tgSend(ctx, `✏️ <b>هزینه پیک:</b>\nفعلی: ${ctx.botSettings.shippingFee || 0}\n\nمبلغ جدید (عدد):`, [[{ text: '❌ انصراف', callback_data: 'admin_settings' }]]);
    return true;
  }

  // Texts customization
  if (data === 'admin_texts') {
    await tgSend(ctx, `✍️ <b>شخصی‌سازی متون ربات:</b>\n\nپیام خوش‌آمد: ${ctx.botSettings.welcomeMessage ? '✅' : '❌'}\nپیام راهنما: ${ctx.botSettings.helpMessage ? '✅' : '❌'}\nپیام سفارش موفق: ${ctx.botSettings.orderSuccessMessage ? '✅' : '❌'}`, [
      [{ text: '✏️ پیام خوش‌آمد', callback_data: 'admin_edit_welcome' }],
      [{ text: '✏️ پیام راهنما', callback_data: 'admin_edit_help' }],
      [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  if (data === 'admin_edit_welcome') {
    ctx.userStates.set(ctx.chatId, { mode: 'edit_welcome' });
    await tgSend(ctx, '✏️ پیام خوش‌آمد جدید را ارسال کنید:', [[{ text: '❌ انصراف', callback_data: 'admin_texts' }]]);
    return true;
  }

  if (data === 'admin_edit_help') {
    ctx.userStates.set(ctx.chatId, { mode: 'edit_help' });
    await tgSend(ctx, '✏️ پیام راهنما جدید را ارسال کنید:', [[{ text: '❌ انصراف', callback_data: 'admin_texts' }]]);
    return true;
  }

  // Backup
  if (data === 'admin_backup') {
    await tgSend(ctx, '💾 <b>بکاپ و بازیابی:</b>\n\nبرای دانلود بکاپ کامل به پنل تحت وب مراجعه کنید.', [
      [{ text: '🌐 ورود به پنل وب', callback_data: 'admin_web_info' }],
      [{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Broadcast message to all customers
  if (data === 'admin_broadcast') {
    ctx.userStates.set(ctx.chatId, { mode: 'admin_broadcast_input' });
    await tgSend(ctx, '📢 <b>ارسال پیام گروهی به مشتریان:</b>\n\nلطفاً پیام مورد نظر را ارسال کنید:', [[{ text: '❌ انصراف', callback_data: 'admin_panel' }]]);
    return true;
  }

  return false;
}

// ============ TEXT MESSAGE HANDLERS (STATE MACHINE) ============

export async function handleTextMessage(ctx: TelegramContext, text: string): Promise<boolean> {
  const state = ctx.userStates.get(ctx.chatId);
  if (!state) return false;

  // Add product flow
  if (state.mode === 'add_product_name') {
    state.draft = { name: text }; state.mode = 'add_product_category';
    ctx.userStates.set(ctx.chatId, state);
    const cats = ['کیک و پای', 'شیرینی تر و خامه‌ای', 'شیرینی خشک و سنتی', 'دسر و باقلوا', 'کوکی و بیسکوئیت', 'نان و کروسان'];
    await tgSend(ctx, `نام: <b>${text}</b>\n\nمرحله ۲: دسته‌بندی را انتخاب کنید:`, cats.map(c => [{ text: c, callback_data: `admin_cat_${c}` }]));
    return true;
  }

  if (state.mode === 'add_product_price') {
    const price = parseInt(text.replace(/[^0-9]/g, ''));
    if (isNaN(price)) { await tgSend(ctx, '❌ فقط عدد وارد کنید:'); return true; }
    state.draft.price = price; state.mode = 'add_product_image';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `قیمت: <b>${price.toLocaleString()}</b>\n\nمرحله ۴: لینک عکس محصول را ارسال کنید\n(یا بنویسید «بدون عکس»):`);
    return true;
  }

  if (state.mode === 'add_product_image') {
    state.draft.image = text.startsWith('http') ? text : 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=700&auto=format&fit=crop&q=80';
    state.mode = 'add_product_desc';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, 'مرحله ۵: توضیحات محصول (یا «عالی»):');
    return true;
  }

  if (state.mode === 'add_product_desc') {
    const draft = state.draft;
    const newProd = { id: `prod-${Date.now()}`, productCode: Math.floor(1000000 + Math.random() * 9000000).toString(), name: draft.name, category: draft.category, price: draft.price, unit: 'کیلوگرم', image: draft.image, description: text === 'عالی' ? '' : text, isAvailable: true, preparationTimeHours: 2, stockKgOrCount: 20, createdAt: new Date().toISOString() };
    ctx.products.unshift(newProd);
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, `🎉 <b>${newProd.name}</b> اضافه شد!\n💰 ${newProd.price.toLocaleString()} / ${newProd.unit}`, [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }], [{ text: '➕ محصول دیگر', callback_data: 'admin_add_product' }]], newProd.image);
    return true;
  }

  // Edit price
  if (state.mode === 'edit_price') {
    const price = parseInt(text.replace(/[^0-9]/g, ''));
    if (isNaN(price)) { await tgSend(ctx, '❌ فقط عدد:'); return true; }
    const prod = ctx.products.find(p => p.id === state.productId);
    if (prod) { prod.price = price; await tgSend(ctx, `✅ ${prod.name}: <b>${price.toLocaleString()}</b>`, [[{ text: '🧁 محصولات', callback_data: 'admin_products_manager' }]]); }
    ctx.userStates.delete(ctx.chatId);
    return true;
  }

  // Add discount
  if (state.mode === 'add_discount') {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 3) { await tgSend(ctx, '❌ فرمت: <code>CODE 20 percent</code> یا <code>CODE 50000 fixed</code>'); return true; }
    const code = parts[0].toUpperCase();
    const value = parseInt(parts[1]);
    const type = parts[2] === 'fixed' ? 'fixed' : 'percentage';
    ctx.discounts.unshift({ id: `disc-${Date.now()}`, code, type, value, isActive: true, usedCount: 0, createdAt: new Date().toISOString(), description: '' });
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, `🎉 کد <code>${code}</code> (${type === 'percentage' ? value + '٪' : value.toLocaleString()}) اضافه شد!`, [[{ text: '🎟️ تخفیف‌ها', callback_data: 'admin_discounts_list' }]]);
    return true;
  }

  // Edit settings
  if (state.mode === 'edit_store_name') {
    ctx.botSettings.storeName = text; ctx.userStates.set(ctx.chatId, { mode: 'edit_store_phone' });
    await tgSend(ctx, `✅ نام: <b>${text}</b>\n\nحالا <b>شماره تلفن</b> فروشگاه:`);
    return true;
  }
  if (state.mode === 'edit_store_phone') {
    ctx.botSettings.storePhone = text; ctx.userStates.set(ctx.chatId, { mode: 'edit_store_address' });
    await tgSend(ctx, `✅ تلفن ثبت شد.\n\nحالا <b>آدرس</b> فروشگاه:`);
    return true;
  }
  if (state.mode === 'edit_store_address') {
    ctx.botSettings.storeAddress = text; ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ آدرس ثبت شد!', [[{ text: '⚙️ تنظیمات', callback_data: 'admin_settings' }]]);
    return true;
  }
  if (state.mode === 'edit_card_number') {
    ctx.botSettings.cardNumber = text; ctx.userStates.set(ctx.chatId, { mode: 'edit_card_holder' });
    await tgSend(ctx, `✅ کارت ثبت شد.\n\nحالا <b>نام صاحب حساب</b>:`);
    return true;
  }
  if (state.mode === 'edit_card_holder') {
    ctx.botSettings.cardHolder = text; ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ ثبت شد!', [[{ text: '⚙️ تنظیمات', callback_data: 'admin_settings' }]]);
    return true;
  }
  if (state.mode === 'edit_shipping_fee') {
    const fee = parseInt(text.replace(/[^0-9]/g, ''));
    if (isNaN(fee)) { await tgSend(ctx, '❌ فقط عدد:'); return true; }
    ctx.botSettings.shippingFee = fee; ctx.userStates.set(ctx.chatId, { mode: 'edit_free_threshold' });
    await tgSend(ctx, `✅ پیک: <b>${fee.toLocaleString()}</b>\n\nحالا <b>سقف ارسال رایگان</b> (عدد):`);
    return true;
  }
  if (state.mode === 'edit_free_threshold') {
    const t = parseInt(text.replace(/[^0-9]/g, ''));
    ctx.botSettings.freeShippingThreshold = isNaN(t) ? 0 : t; ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ ثبت شد!', [[{ text: '⚙️ تنظیمات', callback_data: 'admin_settings' }]]);
    return true;
  }

  // Edit texts
  if (state.mode === 'ask_quantity') {
    const qty = parseFloat(text);
    if (isNaN(qty) || qty <= 0) {
      await tgSend(ctx, '❌ لطفاً یک عدد معتبر وارد کنید (مثلاً: 2)');
      return true;
    }
    const prod = ctx.products.find(p => p.id === state.productId);
    if (prod) {
      const cart = ctx.userCarts.get(ctx.chatId) || [];
      const existing = cart.find(i => i.productId === prod.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.push({ productId: prod.id, quantity: qty });
      }
      ctx.userCarts.set(ctx.chatId, cart);
      const totalQty = cart.reduce((s, i) => s + i.quantity, 0);
      ctx.userStates.delete(ctx.chatId);
      await tgSend(ctx, `✅ <b>${qty} ${prod.unit}</b> از «${prod.name}» به سبد خرید افزوده شد.\n\n🛒 <b>تعداد کل اقلام سبد:</b> ${totalQty}`, [
        [{ text: '🛒 مشاهده سبد خرید', callback_data: 'view_cart' }],
        [{ text: '🍰 ادامه خرید', callback_data: 'menu_categories' }]
      ]);
    }
    return true;
  }

  if (state.mode === 'edit_welcome') {
    ctx.botSettings.welcomeMessage = text; ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ پیام خوش‌آمد ذخیره شد!', [[{ text: '✍️ متون', callback_data: 'admin_texts' }]]);
    return true;
  }
  if (state.mode === 'edit_help') {
    ctx.botSettings.helpMessage = text; ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, '✅ پیام راهنما ذخیره شد!', [[{ text: '✍️ متون', callback_data: 'admin_texts' }]]);
    return true;
  }

  // Quote custom order
  if (state.mode === 'quote_price') {
    const price = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(price) || price <= 0) { await tgSend(ctx, '❌ مبلغ نهایی باید عددی بزرگ‌تر از صفر باشد:'); return true; }
    const order = ctx.customOrders.find(o => o.id === state.orderId);
    if (order) {
      order.finalPrice = price;
      order.prepaymentAmount = Math.round(price * 0.4);
      order.status = 'price_quoted';
      // A re-quote must never retain a previously accepted payment receipt.
      order.paymentMethod = undefined;
      order.isPrepaymentPaid = false;
      order.prepaymentStatus = 'awaiting_receipt';
      delete order.paymentReceiptImage;
      delete order.prepaymentSubmittedAt;
      delete order.prepaymentReviewedAt;
      delete order.prepaymentRejectReason;
      order.updatedAt = new Date().toISOString();
      await tgSend(ctx, `✅ قیمت: <b>${price.toLocaleString()}</b>\nبیعانه: <b>${order.prepaymentAmount.toLocaleString()}</b>\n⏳ فیش بیعانه پس از ارسال، نیازمند تأیید ادمین است.`, [[{ text: '🎂 سفارشات', callback_data: 'admin_custom_orders' }]]);
    }
    ctx.userStates.delete(ctx.chatId);
    return true;
  }

  // Admin Add New Staff ID
  if (state.mode === 'admin_add_admin_id') {
    const id = text.trim();
    if (!/^\d+$/.test(id)) {
      await tgSend(ctx, '❌ لطفاً فقط شناسه عددی تلگرام را وارد کنید (مثال: 589123456):');
      return true;
    }
    const current = (ctx.botSettings.adminTelegramIds || []).map(String);
    if (current.includes(id) || id === String(ctx.botSettings.adminTelegramId)) {
      await tgSend(ctx, 'ℹ️ این شناسه قبلاً در لیست مدیران ثبت شده است.', [[{ text: '🛡️ مدیران', callback_data: 'admin_admins_manager' }]]);
      ctx.userStates.delete(ctx.chatId);
      return true;
    }
    ctx.botSettings.adminTelegramIds = [...current, id];
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, `🎉 شناسه <code>${id}</code> با موفقیت به عنوان مدیر ربات افزوده شد!`, [
      [{ text: '🛡️ مدیریت مدیران', callback_data: 'admin_admins_manager' }],
      [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Admin Edit Super Admin ID
  if (state.mode === 'admin_edit_super_admin_id') {
    const id = text.trim();
    if (!/^\d+$/.test(id)) {
      await tgSend(ctx, '❌ لطفاً فقط شناسه عددی تلگرام را وارد کنید (مثال: 589123456):');
      return true;
    }
    ctx.botSettings.adminTelegramId = id;
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, `👑 شناسه مدیر ارشد با موفقیت به <code>${id}</code> تغییر یافت.`, [
      [{ text: '🛡️ مدیریت مدیران', callback_data: 'admin_admins_manager' }],
      [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Admin Edit Forum Group ID
  if (state.mode === 'admin_edit_forum_group_id') {
    const id = text.trim();
    if (!/^-?\d+$/.test(id)) {
      await tgSend(ctx, '❌ لطفاً فقط شناسه عددی گروه را وارد کنید (مثال: <code>-1002345678901</code>):');
      return true;
    }
    ctx.botSettings.forumGroupId = id;
    ctx.userStates.delete(ctx.chatId);
    await tgSend(ctx, `🏷️ شناسه گروه گزارشات به <code>${id}</code> تنظیم شد.\n\nاکنون می‌توانید روی «⚡ ساخت خودکار ۸ تاپیک» بزنید تا تاپیک‌ها ساخته شوند.`, [
      [{ text: '⚡ ساخت خودکار ۸ تاپیک', callback_data: 'admin_forum_setup_topics' }],
      [{ text: '🏷️ تاپیک‌های گروه', callback_data: 'admin_forum_topics' }],
      [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
    ]);
    return true;
  }

  // Admin Reply to Customer Support Ticket
  if (state.mode === 'admin_reply_ticket_text') {
    const ticket = ctx.supportTickets.find(t => t.id === state.ticketId);
    ctx.userStates.delete(ctx.chatId);
    if (ticket) {
      ticket.status = 'answered';
      ticket.updatedAt = new Date().toISOString();
      if (ticket.customerTelegramId && ticket.customerTelegramId !== 'guest') {
        try {
          await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ticket.customerTelegramId,
              text: `📬 <b>پاسخ مدیریت به تیکت پشتیبانی #${ticket.ticketNumber}:</b>\n\n💬 <b>موضوع:</b> ${ticket.subject}\n──────────────\n${text}\n──────────────\n<i>قنادی شیرین‌کام</i>`,
              parse_mode: 'HTML'
            })
          });
        } catch (e) {
          console.error('Failed to send ticket reply to user:', e);
        }
      }
      await tgSend(ctx, `✅ پاسخ با موفقیت برای مشتری ارسال و تیکت #${ticket.ticketNumber} بسته شد.`, [
        [{ text: '💬 تیکت‌ها', callback_data: 'admin_support_list' }],
        [{ text: '👨‍🍳 منوی ادمین', callback_data: 'admin_panel' }]
      ]);
    }
    return true;
  }

  // Broadcast message (admin)
  if (state.mode === 'admin_broadcast_input') {
    ctx.userStates.delete(ctx.chatId);
    let sent = 0;
    const targets = new Set<string>([...ctx.customers.map(c => c.telegramId)].filter(Boolean) as string[]);
    for (const targetId of targets) {
      if (targetId === 'guest') continue;
      try {
        await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: targetId, text, parse_mode: 'HTML' })
        });
        sent++;
      } catch (e) {
        console.error(`Broadcast to ${targetId} failed:`, e);
      }
    }
    await tgSend(ctx, `✅ پیام گروهی برای <b>${sent}</b> مشتری ارسال شد.`, [[{ text: '👨‍🍳 ادمین', callback_data: 'admin_panel' }]]);
    return true;
  }

  // Support message
  if (state.mode === 'support_subject') {
    const newState = { ...state, subject: text, mode: 'support_message' };
    ctx.userStates.set(ctx.chatId, newState);
    await tgSend(ctx, '💬 <b>متن پیام:</b>\n\nلطفاً متن پیام خود را بنویسید:', [
      [{ text: '❌ انصراف', callback_data: 'back_to_main' }]
    ]);
    return true;
  }

  if (state.mode === 'support_message') {
    state.message = text;
    state.mode = 'support_photo_ask';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, '📸 <b>ارسال تصویر (اختیاری):</b>\n\nآیا می‌خواهید تصویری ارسال کنید؟', [
      [{ text: '✅ بله، تصویر دارم', callback_data: 'support_photo_yes' }],
      [{ text: '❌ خیر، ثبت نهایی', callback_data: 'support_finalize' }]
    ]);
    return true;
  }

  if (state.mode === 'reply_to_ticket_text') {
    const newState = { ...state, replyText: text, mode: 'reply_to_ticket_photo_ask' };
    ctx.userStates.set(ctx.chatId, newState);
    await tgSend(ctx, '📸 <b>ارسال تصویر (اختیاری):</b>\n\nآیا می‌خواهید تصویری ارسال کنید؟', [
      [{ text: '✅ بله، تصویر دارم', callback_data: 'reply_ticket_photo_yes' }],
      [{ text: '❌ خیر، ثبت نهایی', callback_data: 'reply_ticket_photo_no' }]
    ]);
    return true;
  }

  return false;
}

// Handle admin category selection for add product
export async function handleAdminCatSelect(ctx: TelegramContext, category: string): Promise<boolean> {
  const state = ctx.userStates.get(ctx.chatId);
  if (state?.mode === 'add_product_category') {
    state.draft.category = category; state.mode = 'add_product_price';
    ctx.userStates.set(ctx.chatId, state);
    await tgSend(ctx, `دسته: <b>${category}</b>\n\nمرحله ۳: <b>قیمت</b> (عدد):`);
    return true;
  }
  return false;
}
