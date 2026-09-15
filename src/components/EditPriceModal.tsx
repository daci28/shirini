import React, { useState } from 'react';
import { X, DollarSign, Check, Percent, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Product } from '../types';
import { formatPrice } from '../utils/formatters';

interface EditPriceModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
}

export const EditPriceModal: React.FC<EditPriceModalProps> = ({
  product,
  isOpen,
  onClose,
  onUpdateProduct,
}) => {
  if (!isOpen || !product) return null;

  const [price, setPrice] = useState(product.price.toString());
  const [discountPercent, setDiscountPercent] = useState(
    (product.discountPercent || 0).toString()
  );
  const [loading, setLoading] = useState(false);

  const handleQuickPercent = (percentChange: number) => {
    const current = parseInt(price.replace(/[^0-9]/g, ''), 10) || product.price;
    const updated = Math.round(current * (1 + percentChange / 100) / 1000) * 1000;
    setPrice(updated.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseInt(price.replace(/[^0-9]/g, ''), 10);
    if (isNaN(priceNum) || priceNum <= 0) return;

    setLoading(true);
    try {
      await onUpdateProduct(product.id, {
        price: priceNum,
        discountPercent: parseInt(discountPercent, 10) || 0,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const parsedPrice = parseInt(price.replace(/[^0-9]/g, ''), 10) || 0;
  const parsedDiscount = parseInt(discountPercent, 10) || 0;
  const finalPrice = parsedDiscount > 0 ? parsedPrice * (100 - parsedDiscount) / 100 : parsedPrice;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md text-slate-100 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900/90 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">ویرایش قیمت و تخفیف</h3>
              <p className="text-xs text-slate-400 truncate max-w-[200px]">{product.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          {/* Current product preview */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/50 border border-slate-700/60">
            <img
              src={product.image}
              alt={product.name}
              className="w-12 h-12 rounded-xl object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{product.name}</p>
              <p className="text-[11px] text-slate-400">قیمت فعلی: {formatPrice(product.price)}</p>
            </div>
          </div>

          {/* Quick Adjustment Shortcuts */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">تغییر سریع درصدی قیمت:</label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleQuickPercent(5)}
                className="py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-mono font-bold flex items-center justify-center gap-0.5"
              >
                <ArrowUpRight className="w-3 h-3" /> +۵٪
              </button>
              <button
                type="button"
                onClick={() => handleQuickPercent(10)}
                className="py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-mono font-bold flex items-center justify-center gap-0.5"
              >
                <ArrowUpRight className="w-3 h-3" /> +۱۰٪
              </button>
              <button
                type="button"
                onClick={() => handleQuickPercent(-5)}
                className="py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 border border-slate-700 text-xs font-mono font-bold flex items-center justify-center gap-0.5"
              >
                <ArrowDownRight className="w-3 h-3" /> -۵٪
              </button>
              <button
                type="button"
                onClick={() => handleQuickPercent(-10)}
                className="py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 border border-slate-700 text-xs font-mono font-bold flex items-center justify-center gap-0.5"
              >
                <ArrowDownRight className="w-3 h-3" /> -۱۰٪
              </button>
            </div>
          </div>

          {/* Price input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              قیمت پایه به تومان
            </label>
            <input
              type="number"
              required
              min="1000"
              step="1000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-base font-bold text-white focus:outline-none focus:border-amber-500 font-mono text-left"
            />
            <p className="text-xs text-amber-400 mt-1 font-medium">
              معادل: {formatPrice(parsedPrice)}
            </p>
          </div>

          {/* Discount input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              درصد تخفیف شگفت‌انگیز (اختیاری)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="90"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
              />
              <span className="text-slate-400 text-sm font-bold">٪</span>
            </div>
            {parsedDiscount > 0 && (
              <p className="text-xs text-emerald-400 mt-1">
                قیمت پس از تخفیف: <b>{formatPrice(finalPrice)}</b>
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 transition-all flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>ذخیره و اعمال در بات</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
