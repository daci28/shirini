import React, { useCallback, useEffect, useState } from 'react';
import { 
  INITIAL_PRODUCTS, 
  INITIAL_ORDERS, 
  INITIAL_BOT_SETTINGS,
  INITIAL_DISCOUNT_CODES, 
  INITIAL_SUPPORT_TICKETS,
  INITIAL_CUSTOMERS,
  INITIAL_WALLET_TRANSACTIONS,
  INITIAL_BACKUP_SCHEDULE,
  INITIAL_BACKUP_SNAPSHOTS,
  INITIAL_CUSTOM_ORDERS
} from './data/initialData';
import { 
  Product, 
  Order, 
  BotSettings, 
  OrderStatus, 
  DiscountCode, 
  SupportTicket, 
  TicketStatus,
  CustomerUser,
  WalletTransaction,
  BackupScheduleConfig,
  BackupSnapshot,
  MasterBackupPayload,
  CustomPastryOrder,
  CustomPastryStatus,
  Invoice,
  InvoicePayment,
  InvoicePaymentMethod,
  InvoicePaymentStatus,
  InvoiceStatus
} from './types';
import { Sidebar } from './components/Header';
import { MobileHeader } from './components/MobileHeader';
import { MobileSidebar } from './components/MobileSidebar';
import { ProductManager } from './components/ProductManager';
import { OrderManager } from './components/OrderManager';
import { DiscountManager } from './components/DiscountManager';
import { SalesAnalytics } from './components/SalesAnalytics';
import { BotSettingsComponent } from './components/BotSettings';
import { AdminManager } from './components/AdminManager';
import { SupportManager } from './components/SupportManager';
import { BotTextsCustomizer } from './components/BotTextsCustomizer';
import { BackupManager } from './components/BackupManager';
import { CustomPastryManager } from './components/CustomPastryManager';
import { CustomerManager } from './components/CustomerManager';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { generateUniqueOrderNumber } from './utils/orderNumber';
import { InvoiceManager, ManualInvoicePayload } from './components/InvoiceManager';

export default function App() {
  // Authentication comes exclusively from the HttpOnly server session. A local
  // storage flag can never unlock the panel or its protected APIs.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authenticatedUsername, setAuthenticatedUsername] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [customOrders, setCustomOrders] = useState<CustomPastryOrder[]>(INITIAL_CUSTOM_ORDERS);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [discounts, setDiscounts] = useState<DiscountCode[]>(INITIAL_DISCOUNT_CODES);
  const [botSettings, setBotSettings] = useState<BotSettings>(INITIAL_BOT_SETTINGS);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>(INITIAL_SUPPORT_TICKETS);
  const [customers, setCustomers] = useState<CustomerUser[]>(INITIAL_CUSTOMERS);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>(INITIAL_WALLET_TRANSACTIONS);
  const [backupSchedule, setBackupSchedule] = useState<BackupScheduleConfig>(INITIAL_BACKUP_SCHEDULE);
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>(INITIAL_BACKUP_SNAPSHOTS);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'customers' | 'invoices' | 'products' | 'orders' | 'custom_orders' | 'discounts' | 'support' | 'texts' | 'analytics' | 'settings' | 'backup' | 'admins'>('dashboard');
  // Avoid even a one-frame render of seed data between session confirmation and
  // the authenticated data fetch.
  const [loading, setLoading] = useState(true);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Product and order cards need the whole canvas on tablet/narrow-desktop
    // widths. Below Tailwind's lg breakpoint use the compact navigation rather
    // than squeezing the content beside the fixed sidebar.
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const apiFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await window.fetch(input, { credentials: 'same-origin', ...init });
    if (response.status === 401) {
      setIsAuthenticated(false);
      setAuthenticatedUsername(null);
    }
    return response;
  }, []);

  const refreshInvoices = useCallback(async (): Promise<Invoice[]> => {
    const response = await apiFetch('/api/invoices');
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'دریافت فاکتورها ناموفق بود.');
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('ساختار فاکتورها معتبر نیست.');
    setInvoices(data);
    return data;
  }, [apiFetch]);

  const readApiError = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null);
    return payload?.error || payload?.message || fallback;
  };

  // Confirm the server-side session before requesting any panel data. This
  // prevents a forged local state from rendering or reading the admin API.
  useEffect(() => {
    let isCurrent = true;

    const bootstrapSession = async () => {
      try {
        const response = await window.fetch('/api/auth/session', { credentials: 'same-origin' });
        const session = await response.json().catch(() => null);
        if (!isCurrent) return;
        if (response.ok && session?.authenticated) {
          setAuthenticatedUsername(session.username || null);
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        if (isCurrent) setIsAuthenticated(false);
      }
    };

    void bootstrapSession();
    return () => { isCurrent = false; };
  }, []);

  // Fetch initial data only once the backend has authenticated the session.
  useEffect(() => {
    if (isAuthenticated !== true) return;
    let isCurrent = true;
    setLoading(true);

    async function loadData() {
      try {
        const [prodRes, ordRes, customOrdRes, invoiceRes, discRes, setRes, supRes, custRes, wtxRes, schedRes, snapRes] = await Promise.all([
          apiFetch('/api/products').catch(() => null),
          apiFetch('/api/orders').catch(() => null),
          apiFetch('/api/custom-orders').catch(() => null),
          apiFetch('/api/invoices').catch(() => null),
          apiFetch('/api/discounts').catch(() => null),
          apiFetch('/api/settings').catch(() => null),
          apiFetch('/api/support/tickets').catch(() => null),
          apiFetch('/api/customers').catch(() => null),
          apiFetch('/api/wallet/transactions').catch(() => null),
          apiFetch('/api/backup/schedule').catch(() => null),
          apiFetch('/api/backup/snapshots').catch(() => null),
        ]);
        if (!isCurrent) return;

        if (prodRes?.ok) {
          const prods = await prodRes.json();
          if (Array.isArray(prods)) setProducts(prods);
        }
        if (ordRes?.ok) {
          const ords = await ordRes.json();
          if (Array.isArray(ords)) setOrders(ords);
        }
        if (customOrdRes?.ok) {
          const cords = await customOrdRes.json();
          if (Array.isArray(cords)) setCustomOrders(cords);
        }
        if (invoiceRes?.ok) {
          const invoiceData = await invoiceRes.json();
          if (Array.isArray(invoiceData)) setInvoices(invoiceData);
        }
        if (discRes?.ok) {
          const discs = await discRes.json();
          if (Array.isArray(discs)) setDiscounts(discs);
        }
        if (setRes?.ok) {
          const sett = await setRes.json();
          if (sett && sett.storeName) setBotSettings(sett);
        }
        if (supRes?.ok) {
          const sups = await supRes.json();
          if (Array.isArray(sups)) setSupportTickets(sups);
        }
        if (custRes?.ok) {
          const custs = await custRes.json();
          if (Array.isArray(custs)) setCustomers(custs);
        }
        if (wtxRes?.ok) {
          const wtxs = await wtxRes.json();
          if (Array.isArray(wtxs)) setWalletTransactions(wtxs);
        }
        if (schedRes?.ok) {
          const sched = await schedRes.json();
          if (sched && typeof sched === 'object') setBackupSchedule(sched);
        }
        if (snapRes?.ok) {
          const snaps = await snapRes.json();
          if (Array.isArray(snaps)) setBackupSnapshots(snaps);
        }
      } catch (err) {
        console.warn('Panel data could not be loaded:', err);
      } finally {
        if (isCurrent) setLoading(false);
      }
    }

    void loadData();
    return () => { isCurrent = false; };
  }, [apiFetch, isAuthenticated]);

  // Keep live data fresh only while a valid server session exists.
  useEffect(() => {
    if (isAuthenticated !== true) return;
    let isCurrent = true;

    async function refreshData() {
      try {
        const [prodRes, ordRes, customOrdRes, invoiceRes, supRes, custRes] = await Promise.all([
          apiFetch('/api/products').catch(() => null),
          apiFetch('/api/orders').catch(() => null),
          apiFetch('/api/custom-orders').catch(() => null),
          apiFetch('/api/invoices').catch(() => null),
          apiFetch('/api/support/tickets').catch(() => null),
          apiFetch('/api/customers').catch(() => null),
        ]);
        if (!isCurrent) return;

        if (prodRes?.ok) {
          const prods = await prodRes.json();
          if (Array.isArray(prods)) setProducts(prods);
        }
        if (ordRes?.ok) {
          const ords = await ordRes.json();
          if (Array.isArray(ords)) setOrders(ords);
        }
        if (customOrdRes?.ok) {
          const cords = await customOrdRes.json();
          if (Array.isArray(cords)) setCustomOrders(cords);
        }
        if (invoiceRes?.ok) {
          const invoiceData = await invoiceRes.json();
          if (Array.isArray(invoiceData)) setInvoices(invoiceData);
        }
        if (supRes?.ok) {
          const sups = await supRes.json();
          if (Array.isArray(sups)) setSupportTickets(sups);
        }
        if (custRes?.ok) {
          const custs = await custRes.json();
          if (Array.isArray(custs)) setCustomers(custs);
        }
      } catch (err) {
        console.warn('Auto-refresh failed:', err);
      }
    }

    const interval = window.setInterval(() => { void refreshData(); }, 5000);
    return () => {
      isCurrent = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, isAuthenticated]);

  // Add Product Handler
  const handleAddProduct = async (newProdData: Omit<Product, 'id' | 'createdAt'>): Promise<Product> => {
    const tempProduct: Product = {
      ...newProdData,
      id: `prod-${Date.now()}`,
      createdAt: new Date().toISOString()
    };

    // Optimistic state update
    setProducts(prev => [tempProduct, ...prev]);

    try {
      const res = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempProduct)
      });
      if (res.ok) {
        const saved = await res.json();
        setProducts(prev => prev.map(p => p.id === tempProduct.id ? saved : p));
        return saved;
      }
    } catch (e) {
      console.error('Failed to persist product to server:', e);
    }
    return tempProduct;
  };

  // Update Product Handler
  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    try {
      await apiFetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error('Failed to update product on server:', e);
    }
  };

  // Delete Product Handler
  const handleDeleteProduct = async (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    try {
      await apiFetch(`/api/products/${id}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to delete product on server:', e);
    }
  };

  // Create Order Handler
  const handleCreateOrder = async (orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>): Promise<Order> => {
    const tempOrder: Order = {
      ...orderData,
      id: `ord-${Date.now()}`,
      orderNumber: generateUniqueOrderNumber(orders),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setOrders(prev => [tempOrder, ...prev]);

    try {
      const res = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempOrder)
      });
      if (res.ok) {
        const saved = await res.json();
        setOrders(prev => prev.map(o => o.id === tempOrder.id ? saved : o));
        return saved;
      }
    } catch (e) {
      console.error('Failed to persist order to server:', e);
    }
    return tempOrder;
  };

  // Update Order Status Handler
  const handleUpdateOrderStatus = async (id: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o));
    try {
      const response = await apiFetch(`/api/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (response.ok) {
        const saved = await response.json() as Order;
        setOrders(prev => prev.map(order => order.id === id ? saved : order));
        void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
      } else {
        console.error('Failed to update order status on server:', await readApiError(response, 'تغییر وضعیت سفارش ناموفق بود.'));
      }
    } catch (e) {
      console.error('Failed to update order status on server:', e);
    }
  };

  // Add Discount Code Handler
  const handleAddDiscount = async (newDiscountData: Omit<DiscountCode, 'id' | 'createdAt'>): Promise<DiscountCode> => {
    const tempDiscount: DiscountCode = {
      ...newDiscountData,
      id: `disc-${Date.now()}`,
      createdAt: new Date().toISOString()
    };

    setDiscounts(prev => [tempDiscount, ...prev]);

    try {
      const res = await apiFetch('/api/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDiscountData)
      });
      if (res.ok) {
        const savedDiscount = await res.json();
        setDiscounts(prev => prev.map(d => d.id === tempDiscount.id ? savedDiscount : d));
        return savedDiscount;
      }
    } catch (e) {
      console.error('Failed to save discount to server:', e);
    }
    return tempDiscount;
  };

  // Update Discount Code Handler
  const handleUpdateDiscount = async (id: string, updates: Partial<DiscountCode>) => {
    setDiscounts(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    try {
      await apiFetch(`/api/discounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error('Failed to update discount on server:', e);
    }
  };

  // Delete Discount Code Handler
  const handleDeleteDiscount = async (id: string) => {
    setDiscounts(prev => prev.filter(d => d.id !== id));
    try {
      await apiFetch(`/api/discounts/${id}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to delete discount from server:', e);
    }
  };

  // The server makes panel credentials and the Telegram token write-only.
  // Never copy a newly submitted secret into React's long-lived settings state.
  const handleUpdateSettings = async (
    newSettings: Partial<BotSettings> & { clearTelegramBotToken?: boolean }
  ) => {
    const safeDraft: Partial<BotSettings> & { clearTelegramBotToken?: boolean } = { ...newSettings };
    delete safeDraft.webAdminPassword;
    delete (safeDraft as Partial<BotSettings> & { webAdminPasswordHash?: string }).webAdminPasswordHash;
    delete safeDraft.telegramBotToken;
    delete safeDraft.hasTelegramBotToken;
    delete safeDraft.clearTelegramBotToken;
    const response = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    const savedSettings = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(savedSettings?.error || 'ذخیره تنظیمات در سرور ناموفق بود.');
    }

    setBotSettings((previous) => ({ ...previous, ...safeDraft, ...(savedSettings || {}) }));
  };

  // Support Tickets Handlers
  const handleAddSupportTicket = async (ticketData: Omit<SupportTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'replies'>): Promise<SupportTicket> => {
    const tempTicket: SupportTicket = {
      ...ticketData,
      id: `tkt-${Date.now()}`,
      ticketNumber: `TK-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replies: [
        {
          id: `rep-${Date.now()}`,
          sender: 'customer',
          senderName: ticketData.customerName,
          text: ticketData.message,
          createdAt: new Date().toISOString()
        }
      ]
    };

    setSupportTickets(prev => [tempTicket, ...prev]);

    try {
      const res = await apiFetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempTicket)
      });
      if (res.ok) {
        const saved = await res.json();
        setSupportTickets(prev => prev.map(t => t.id === tempTicket.id ? saved : t));
        return saved;
      }
    } catch (e) {
      console.error('Failed to save support ticket to server:', e);
    }
    return tempTicket;
  };

  const handleReplySupportTicket = async (ticketId: string, replyText: string, senderName?: string) => {
    const newReply = {
      id: `rep-${Date.now()}`,
      sender: 'admin' as const,
      senderName: senderName || 'مدیریت قنادی',
      text: replyText,
      createdAt: new Date().toISOString()
    };

    setSupportTickets(prev =>
      prev.map(t =>
        t.id === ticketId
          ? {
              ...t,
              status: 'answered',
              updatedAt: new Date().toISOString(),
              replies: [...t.replies, newReply]
            }
          : t
      )
    );

    try {
      await apiFetch(`/api/support/tickets/${ticketId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: replyText,
          sender: 'admin',
          senderName: senderName || 'مدیریت قنادی'
        })
      });
    } catch (e) {
      console.error('Failed to send reply to ticket:', e);
    }
  };

  const handleUpdateTicketStatus = async (ticketId: string, status: TicketStatus, priority?: 'low' | 'normal' | 'high') => {
    setSupportTickets(prev =>
      prev.map(t =>
        t.id === ticketId
          ? {
              ...t,
              status,
              priority: priority || t.priority,
              updatedAt: new Date().toISOString()
            }
          : t
      )
    );

    try {
      await apiFetch(`/api/support/tickets/${ticketId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, priority })
      });
    } catch (e) {
      console.error('Failed to update ticket status:', e);
    }
  };

  const handleDeleteSupportTicket = async (ticketId: string) => {
    setSupportTickets(prev => prev.filter(t => t.id !== ticketId));
    try {
      await apiFetch(`/api/support/tickets/${ticketId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to delete support ticket:', e);
    }
  };

  // --- Custom Pastry Orders Handlers ---
  const handleAddCustomOrder = async (orderData: Omit<CustomPastryOrder, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'chatMessages'>): Promise<CustomPastryOrder> => {
    const tempOrder: CustomPastryOrder = {
      ...orderData,
      id: `custom-${Date.now()}`,
      orderNumber: `CK-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chatMessages: []
    };

    setCustomOrders(prev => [tempOrder, ...prev]);

    try {
      const res = await apiFetch('/api/custom-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempOrder)
      });
      if (res.ok) {
        const saved = await res.json();
        setCustomOrders(prev => prev.map(o => o.id === tempOrder.id ? saved : o));
        return saved;
      }
    } catch (e) {
      console.error('Failed to create custom order on server:', e);
    }
    return tempOrder;
  };

  const handleUpdateCustomOrderStatus = async (id: string, status: CustomPastryStatus, rejectReason?: string, adminNotes?: string) => {
    const response = await apiFetch(`/api/custom-orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, rejectReason, adminNotes })
    });
    if (!response.ok) throw new Error(await readApiError(response, 'تغییر وضعیت سفارش ناموفق بود.'));
    const saved = await response.json() as CustomPastryOrder;
    setCustomOrders(prev => prev.map(order => order.id === id ? saved : order));
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
  };

  const handleQuoteCustomOrder = async (id: string, finalPrice: number, prepaymentAmount: number, adminNotes?: string, messageToCustomer?: string) => {
    const response = await apiFetch(`/api/custom-orders/${id}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finalPrice, prepaymentAmount, adminNotes, messageToCustomer })
    });
    if (!response.ok) throw new Error(await readApiError(response, 'ثبت قیمت سفارش ناموفق بود.'));
    const saved = await response.json() as CustomPastryOrder;
    setCustomOrders(prev => prev.map(order => order.id === id ? saved : order));
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
  };

  const handleReviewCustomOrderPrepayment = async (id: string, approved: boolean, reason?: string) => {
    const response = await apiFetch(`/api/custom-orders/${id}/prepayment-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, reason })
    });
    if (!response.ok) throw new Error(await readApiError(response, 'ثبت تصمیم فیش بیعانه ناموفق بود.'));
    const saved = await response.json() as CustomPastryOrder;
    setCustomOrders(prev => prev.map(order => order.id === id ? saved : order));
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
  };

  const handleCreateInvoice = async (payload: ManualInvoicePayload): Promise<Invoice> => {
    const response = await apiFetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'صدور فاکتور ناموفق بود.'));
    const saved = await response.json() as Invoice;
    setInvoices(prev => [saved, ...prev.filter(invoice => invoice.id !== saved.id)]);
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
    return saved;
  };

  const handleSendInvoiceToCustomer = async (invoiceId: string): Promise<Invoice> => {
    const response = await apiFetch(`/api/invoices/${invoiceId}/send-to-customer`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(await readApiError(response, 'ارسال فاکتور به تلگرام مشتری ناموفق بود.'));
    const saved = await response.json() as Invoice;
    setInvoices(prev => prev.map(invoice => invoice.id === saved.id ? saved : invoice));
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
    return saved;
  };

  const handleAddInvoicePayment = async (invoiceId: string, payment: {
    amount: number;
    method: InvoicePaymentMethod;
    status: InvoicePaymentStatus;
    transactionReference?: string;
    notes?: string;
  }): Promise<Invoice> => {
    const response = await apiFetch(`/api/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'ثبت پرداخت ناموفق بود.'));
    const saved = await response.json() as Invoice;
    setInvoices(prev => prev.map(invoice => invoice.id === saved.id ? saved : invoice));
    void refreshInvoices().catch((error) => console.warn('Failed to refresh invoice data:', error));
    return saved;
  };

  const handleChangeInvoiceStatus = async (invoiceId: string, status: InvoiceStatus): Promise<Invoice> => {
    const response = await apiFetch(`/api/invoices/${invoiceId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'تغییر وضعیت فاکتور ناموفق بود.'));
    const saved = await response.json() as Invoice;
    setInvoices(prev => prev.map(invoice => invoice.id === saved.id ? saved : invoice));
    return saved;
  };

  const handleReviewInvoicePayment = async (
    invoice: Invoice,
    payment: InvoicePayment,
    approved: boolean,
    reason?: string,
  ): Promise<Invoice> => {
    let response: Response;

    // The finance screen is unified, while the durable source of a derived
    // invoice remains its order. Route the review to that source so the same
    // receipt is visible and actionable from «فاکتورها» as well as the order
    // workspace — without creating a second, drifting payment record.
    if (invoice.source === 'regular_order') {
      if (!invoice.sourceId) throw new Error('سفارش مبدا این فاکتور پیدا نشد.');
      response = await apiFetch(`/api/orders/${encodeURIComponent(invoice.sourceId)}/receipt-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'ثبت تصمیم فیش سفارش ناموفق بود.'));
      const savedOrder = await response.json() as Order;
      setOrders(prev => prev.map(order => order.id === savedOrder.id ? savedOrder : order));
    } else if (invoice.source === 'custom_order') {
      if (!invoice.sourceId) throw new Error('سفارش سفارشی مبدا این فاکتور پیدا نشد.');
      response = await apiFetch(`/api/custom-orders/${encodeURIComponent(invoice.sourceId)}/prepayment-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'ثبت تصمیم فیش بیعانه ناموفق بود.'));
      const savedOrder = await response.json() as CustomPastryOrder;
      setCustomOrders(prev => prev.map(order => order.id === savedOrder.id ? savedOrder : order));
    } else {
      response = await apiFetch(`/api/invoices/${encodeURIComponent(invoice.id)}/payments/${encodeURIComponent(payment.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, reason }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'ثبت تصمیم فیش فاکتور ناموفق بود.'));
      const savedInvoice = await response.json() as Invoice;
      setInvoices(prev => prev.map(item => item.id === savedInvoice.id ? savedInvoice : item));
    }

    const refreshedInvoices = await refreshInvoices();
    const saved = refreshedInvoices.find((item) => item.id === invoice.id);
    if (!saved) throw new Error('فاکتور پس از ثبت تصمیم پیدا نشد.');
    return saved;
  };

  const handleSendCustomOrderChatMessage = async (orderId: string, text: string, senderName?: string) => {
    const newMsg = {
      id: `cmsg-${Date.now()}`,
      sender: 'admin' as const,
      senderName: senderName || 'سرقناد قنادی',
      text,
      createdAt: new Date().toISOString()
    };

    setCustomOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? {
              ...o,
              chatMessages: [...(o.chatMessages || []), newMsg],
              updatedAt: new Date().toISOString()
            }
          : o
      )
    );

    try {
      await apiFetch(`/api/custom-orders/${orderId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sender: 'admin', senderName: senderName || 'سرقناد قنادی' })
      });
    } catch (e) {
      console.error('Failed to send chat message for custom order:', e);
    }
  };

  const handleDeleteCustomOrder = async (id: string) => {
    setCustomOrders(prev => prev.filter(o => o.id !== id));
    try {
      await apiFetch(`/api/custom-orders/${id}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to delete custom order:', e);
    }
  };

  // --- Backup & Restore Handlers ---

  const handleUpdateBackupSchedule = async (scheduleUpdates: Partial<BackupScheduleConfig>) => {
    setBackupSchedule(prev => ({ ...prev, ...scheduleUpdates }));
    try {
      const res = await apiFetch('/api/backup/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scheduleUpdates)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) setBackupSchedule(data.schedule);
      }
    } catch (e) {
      console.error('Failed to update backup schedule on server:', e);
    }
  };

  const handleCreateBackupSnapshot = async (customName?: string): Promise<BackupSnapshot | null> => {
    try {
      const res = await apiFetch('/api/backup/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customName })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.snapshot) {
          setBackupSnapshots(prev => [data.snapshot, ...prev]);
          return data.snapshot;
        }
      }
    } catch (e) {
      console.error('Failed to create snapshot on server:', e);
    }
    return null;
  };

  const handleRestoreBackupSnapshot = async (id: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/backup/snapshots/${id}/restore`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        // Refresh all local states
        const snap = backupSnapshots.find(s => s.id === id);
        if (snap?.payload?.data) {
          const d = snap.payload.data;
          if (d.products) setProducts(d.products);
          if (d.orders) setOrders(d.orders);
          if (d.customOrders) setCustomOrders(d.customOrders);
          if (d.customers) setCustomers(d.customers);
          if (d.walletTransactions) setWalletTransactions(d.walletTransactions);
          if (d.discounts) setDiscounts(d.discounts);
          if (d.supportTickets) setSupportTickets(d.supportTickets);
          if (d.botSettings) setBotSettings(d.botSettings);
        }
        await refreshInvoices().catch((error) => console.warn('Failed to refresh invoices after restore:', error));
        alert(data.message || 'بازیابی با موفقیت انجام شد.');
        return true;
      }
    } catch (e) {
      console.error('Failed to restore snapshot:', e);
    }
    return false;
  };

  const handleDeleteBackupSnapshot = async (id: string): Promise<boolean> => {
    setBackupSnapshots(prev => prev.filter(s => s.id !== id));
    try {
      const res = await apiFetch(`/api/backup/snapshots/${id}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch (e) {
      console.error('Failed to delete snapshot:', e);
    }
    return false;
  };

  const handleImportBackup = async (payload: MasterBackupPayload, mode: 'overwrite' | 'merge'): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, mode })
      });
      if (res.ok) {
        const data = await res.json();
        const d = payload.data;
        if (mode === 'overwrite') {
          if (d.products) setProducts(d.products);
          if (d.orders) setOrders(d.orders);
          if (d.customOrders) setCustomOrders(d.customOrders);
          if (d.customers) setCustomers(d.customers);
          if (d.walletTransactions) setWalletTransactions(d.walletTransactions);
          if (d.discounts) setDiscounts(d.discounts);
          if (d.supportTickets) setSupportTickets(d.supportTickets);
          if (d.botSettings) setBotSettings(d.botSettings);
        } else {
          // Merge
          if (d.products) {
            setProducts(prev => {
              const ids = new Set(prev.map(p => p.id));
              const toAdd = d.products.filter(p => !ids.has(p.id));
              return [...toAdd, ...prev];
            });
          }
          if (d.orders) {
            setOrders(prev => {
              const ids = new Set(prev.map(o => o.id));
              const toAdd = d.orders.filter(o => !ids.has(o.id));
              return [...toAdd, ...prev];
            });
          }
          if (d.customOrders) {
            setCustomOrders(prev => {
              const ids = new Set(prev.map(o => o.id));
              const toAdd = d.customOrders!.filter(o => !ids.has(o.id));
              return [...toAdd, ...prev];
            });
          }
          if (d.customers) {
            setCustomers(prev => {
              const ids = new Set(prev.map(c => c.id));
              const toAdd = d.customers.filter(c => !ids.has(c.id));
              return [...toAdd, ...prev];
            });
          }
          if (d.walletTransactions) {
            setWalletTransactions(prev => {
              const ids = new Set(prev.map(w => w.id));
              const toAdd = d.walletTransactions.filter(w => !ids.has(w.id));
              return [...toAdd, ...prev];
            });
          }
        }
        await refreshInvoices().catch((error) => console.warn('Failed to refresh invoices after import:', error));
        return true;
      }
    } catch (e) {
      console.error('Failed to import backup payload:', e);
    }
    return false;
  };

  const handleAdjustWallet = async (customerId: string, amount: number, description: string) => {
    try {
      const res = await apiFetch(`/api/customers/${customerId}/wallet-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, description })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.customer) {
          setCustomers(prev => prev.map(c => c.id === customerId ? data.customer : c));
        }
        if (data.transaction) {
          setWalletTransactions(prev => [data.transaction, ...prev]);
        }
      }
    } catch (e) {
      console.error('Failed to adjust wallet:', e);
    }
  };

  const handleSaveCustomer = async (data: { name: string; phone: string; address?: string; username?: string; telegramId?: string }) => {
    const res = await apiFetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.name,
        phone: data.phone,
        address: data.address || '',
        username: data.username || '',
        ...(data.telegramId ? { telegramId: String(data.telegramId).trim() } : {}),
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'خطا در ثبت کاربر');
    }
    const saved = await res.json();
    setCustomers(prev => {
      const exists = prev.some(c => c.id === saved.id || String(c.telegramId) === String(saved.telegramId));
      return exists ? prev.map(c => (c.id === saved.id || String(c.telegramId) === String(saved.telegramId)) ? saved : c) : [saved, ...prev];
    });
  };

  const handleUpdateCustomer = async (customerId: string, data: { name?: string; phone?: string; addresses?: string[] }) => {
    const res = await apiFetch(`/api/customers/${customerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'خطا در به‌روزرسانی کاربر');
    }
    const saved = await res.json();
    setCustomers(prev => prev.map(c => (c.id === saved.id ? saved : c)));
    return saved;
  };

  const handlePanelLogin = async (username: string, password: string) => {
    const response = await window.fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.authenticated) {
      throw new Error(result?.error || 'نام کاربری یا رمز عبور اشتباه است.');
    }

    setAuthenticatedUsername(result.username || username);
    setLoading(true);
    setIsAuthenticated(true);
  };

  const handlePanelLogout = async () => {
    try {
      await window.fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
      // Even if the network drops, clear client access; an expired server
      // session is still required for every protected API request.
      console.warn('Panel logout request failed:', error);
    } finally {
      setMobileOpen(false);
      setLoading(false);
      setAuthenticatedUsername(null);
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-5 text-sm">در حال بررسی نشست امن پنل…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handlePanelLogin} />;
  }

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-5 text-sm">در حال بارگذاری اطلاعات پنل…</div>
      </div>
    );
  }

  return (
    <div 
      dir="rtl" 
      className="min-h-screen w-full min-w-0 flex font-sans bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950"
    >
      
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          botSettings={botSettings}
          ordersCount={orders.filter(o => o.status === 'paid_checking' || o.status === 'receipt_confirmed' || o.status === 'baking').length}
          productsCount={products.length}
          customOrdersCount={customOrders.length}
          pendingCustomOrdersCount={customOrders.filter(o => o.status === 'pending_review').length}
          discountsCount={discounts.filter(d => d.isActive).length}
          openTicketsCount={supportTickets.filter(t => t.status === 'open').length}
          invoicesCount={invoices.filter(invoice => invoice.status === 'payment_review').length}
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded(!sidebarExpanded)}
          onLogout={handlePanelLogout}
          username={authenticatedUsername}
        />
      )}

      {/* Mobile Header */}
      {isMobile && (
        <MobileHeader
          botSettings={botSettings}
          onMenuClick={() => setMobileOpen(true)}
          onLogout={handlePanelLogout}
        />
      )}

      {/* Mobile Sidebar (Overlay) */}
      {isMobile && (
        <MobileSidebar
          isOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        >
        {/* Mobile Navigation */}
        <div className="space-y-1.5">
          {[
            { id: 'dashboard', label: '🏠 داشبورد' },
            { id: 'customers', label: '👥 کاربران' },
            { id: 'invoices', label: '🧾 فاکتورها و پرداخت‌ها' },
            { id: 'products', label: '🍰 محصولات' },
            { id: 'orders', label: '📦 سفارشات عادی' },
            { id: 'custom_orders', label: '🎂 سفارش دلخواه' },
            { id: 'support', label: '💬 پشتیبانی' },
            { id: 'texts', label: '✍️ شخصی‌سازی متون' },
            { id: 'discounts', label: '🎟️ تخفیف‌ها' },
            { id: 'analytics', label: '📊 آمار فروش' },
            { id: 'admins', label: '🛡️ مدیران ربات' },
            { id: 'backup', label: '💾 بکاپ و بازیابی' },
            { id: 'settings', label: '⚙️ تنظیمات' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                setMobileOpen(false);
              }}
              className={`w-full text-right px-4 py-3 rounded-xl text-sm font-medium transition ${
                activeTab === item.id
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handlePanelLogout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-950"
          >
            خروج امن از پنل
          </button>
        </div>
      </MobileSidebar>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-300 ${
        isMobile ? '' : sidebarExpanded ? 'mr-64' : 'mr-16'
      } pt-14 lg:pt-0`}>
        
        <main className="flex-1 min-w-0 w-full mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl">
        {activeTab === 'dashboard' && (
          <Dashboard
            botName={botSettings.storeName}
            invoices={invoices}
            orders={orders}
            customOrders={customOrders}
            customers={customers}
            products={products}
            supportTickets={supportTickets}
            onNavigate={(target) => setActiveTab(target)}
          />
        )}

        {activeTab === 'customers' && (
          <CustomerManager
            customers={customers}
            walletTransactions={walletTransactions}
            orders={orders}
            customOrders={customOrders}
            onAdjustWallet={handleAdjustWallet}
            onSaveCustomer={handleSaveCustomer}
            onUpdateCustomer={handleUpdateCustomer}
          />
        )}

        {activeTab === 'invoices' && (
          <InvoiceManager
            invoices={invoices}
            customers={customers}
            products={products}
            onCreateInvoice={handleCreateInvoice}
            onSendInvoiceToCustomer={handleSendInvoiceToCustomer}
            onAddPayment={handleAddInvoicePayment}
            onChangeInvoiceStatus={handleChangeInvoiceStatus}
            onReviewPayment={handleReviewInvoicePayment}
          />
        )}

        {activeTab === 'products' && (
          <ProductManager
            products={products}
            onAddProduct={handleAddProduct}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
          />
        )}

        {activeTab === 'orders' && (
          <OrderManager
            orders={orders}
            customers={customers}
            onUpdateOrderStatus={handleUpdateOrderStatus}
          />
        )}

        {activeTab === 'custom_orders' && (
          <CustomPastryManager
            customOrders={customOrders}
            customers={customers}
            onAddCustomOrder={handleAddCustomOrder}
            onUpdateStatus={handleUpdateCustomOrderStatus}
            onQuotePrice={handleQuoteCustomOrder}
            onReviewPrepayment={handleReviewCustomOrderPrepayment}
            onSendChatMessage={handleSendCustomOrderChatMessage}
            onDeleteOrder={handleDeleteCustomOrder}
          />
        )}

        {activeTab === 'support' && (
          <SupportManager
            tickets={supportTickets}
            orders={orders}
            customOrders={customOrders}
            botSettings={botSettings}
            onAddTicket={handleAddSupportTicket}
            onReplyTicket={handleReplySupportTicket}
            onUpdateTicketStatus={handleUpdateTicketStatus}
            onDeleteTicket={handleDeleteSupportTicket}
          />
        )}

        {activeTab === 'texts' && (
          <BotTextsCustomizer
            settings={botSettings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeTab === 'discounts' && (
          <DiscountManager
            discounts={discounts}
            orders={orders}
            products={products}
            onAddDiscount={handleAddDiscount}
            onUpdateDiscount={handleUpdateDiscount}
            onDeleteDiscount={handleDeleteDiscount}
          />
        )}

        {activeTab === 'analytics' && (
          <SalesAnalytics
            products={products}
            orders={orders}
          />
        )}

        {activeTab === 'backup' && (
          <BackupManager
            products={products}
            orders={orders}
            customOrders={customOrders}
            invoices={invoices.filter(invoice => invoice.source === 'manual')}
            customers={customers}
            walletTransactions={walletTransactions}
            discounts={discounts}
            supportTickets={supportTickets}
            botSettings={botSettings}
            backupSchedule={backupSchedule}
            backupSnapshots={backupSnapshots}
            onUpdateSchedule={handleUpdateBackupSchedule}
            onCreateSnapshot={handleCreateBackupSnapshot}
            onRestoreSnapshot={handleRestoreBackupSnapshot}
            onDeleteSnapshot={handleDeleteBackupSnapshot}
            onImportBackup={handleImportBackup}
            onAdjustWallet={handleAdjustWallet}
          />
        )}

        {activeTab === 'settings' && (
          <BotSettingsComponent
            settings={botSettings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeTab === 'admins' && (
          <AdminManager
            settings={botSettings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

      </main>

        {/* App Footer */}
        <footer className="border-t border-slate-800 bg-slate-900/80 py-4 text-center text-xs text-slate-500">
          <p>
            سامانه هوشمند ربات تلگرام قنادی و شیرینی‌پزی • با پشتیبانی از دکمه‌های شیشه‌ای و اتصال به Bot API تلگرام
          </p>
        </footer>
      </div>

    </div>
  );
}
