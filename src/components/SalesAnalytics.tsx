import React from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  ShoppingBag, 
  CakeSlice, 
  Users, 
  Clock, 
  Sparkles,
  ArrowUpRight,
  PieChart
} from 'lucide-react';
import { Product, Order } from '../types';
import { formatPrice, toPersianDigits, formatDatePersian } from '../utils/formatters';

interface SalesAnalyticsProps {
  products: Product[];
  orders: Order[];
}

export const SalesAnalytics: React.FC<SalesAnalyticsProps> = ({ products, orders }) => {
  const activeOrders = orders.filter(o => o.status !== 'cancelled');
  const totalRevenue = activeOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalItemsSold = activeOrders.reduce(
    (sum, o) => sum + o.items.reduce((iSum, item) => iSum + item.quantity, 0),
    0
  );
  const averageOrderValue = activeOrders.length > 0 ? Math.round(totalRevenue / activeOrders.length) : 0;

  // Category sales breakdown
  const categorySales: Record<string, { count: number; total: number }> = {};
  activeOrders.forEach(order => {
    order.items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      const cat = prod ? prod.category : 'سایر';
      if (!categorySales[cat]) {
        categorySales[cat] = { count: 0, total: 0 };
      }
      categorySales[cat].count += item.quantity;
      categorySales[cat].total += item.price * item.quantity;
    });
  });

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl text-slate-100">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>گزارش عملکرد و فروش قنادی</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            تحلیل فروش، محبوب‌ترین شیرینی‌ها و سفارشات
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            آمار دقیق سفارش‌های ثبت شده توسط مشتریان در ربات تلگرام به صورت زنده و تجمیعی.
          </p>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Revenue */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block font-medium">مجموع فروش کل</span>
            <span className="text-lg font-black text-white block mt-0.5">
              {formatPrice(totalRevenue)}
            </span>
          </div>
        </div>

        {/* Card 2: Orders Count */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block font-medium">تعداد کل سفارشات</span>
            <span className="text-lg font-black text-white block mt-0.5">
              {toPersianDigits(orders.length)} سفارش
            </span>
          </div>
        </div>

        {/* Card 3: Items Sold */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center justify-center shrink-0">
            <CakeSlice className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block font-medium">شیرینی‌های تحویل شده</span>
            <span className="text-lg font-black text-white block mt-0.5">
              {toPersianDigits(totalItemsSold)} عدد/کیلو
            </span>
          </div>
        </div>

        {/* Card 4: Avg Order Value */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 block font-medium">میانگین هر سفارش</span>
            <span className="text-lg font-black text-white block mt-0.5">
              {formatPrice(averageOrderValue)}
            </span>
          </div>
        </div>

      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Category Performance */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <PieChart className="w-5 h-5 text-indigo-400" />
            <span>سهم فروش دسته‌بندی‌های قنادی</span>
          </h3>

          <div className="space-y-3">
            {Object.keys(categorySales).length === 0 ? (
              <p className="text-xs text-slate-500">داده‌ای جهت نمایش موجود نیست.</p>
            ) : (
              Object.entries(categorySales).map(([cat, data], idx) => {
                const percent = totalRevenue > 0 ? Math.round((data.total / totalRevenue) * 100) : 0;
                return (
                  <div key={idx} className="space-y-1.5 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-white">{cat}</span>
                      <span className="text-amber-400">{formatPrice(data.total)} ({toPersianDigits(percent)}٪)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Top selling sweets table */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <span>پرفروش‌ترین شیرینی‌ها و کیک‌ها</span>
          </h3>

          <div className="space-y-2.5">
            {products.slice(0, 4).map((product, idx) => (
              <div
                key={product.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 font-mono text-xs font-bold flex items-center justify-center">
                    {toPersianDigits(idx + 1)}
                  </span>
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-10 h-10 rounded-xl object-cover"
                  />
                  <div>
                    <h4 className="text-xs font-bold text-white line-clamp-1">{product.name}</h4>
                    <span className="text-[10px] text-slate-400">{product.category}</span>
                  </div>
                </div>

                <div className="text-left">
                  <span className="text-xs font-extrabold text-amber-400 block">
                    {formatPrice(product.price)}
                  </span>
                  <span className="text-[10px] text-emerald-400 font-medium">پخت روزانه</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
