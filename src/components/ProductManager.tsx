import React, { useState, useRef } from 'react';
import { 
  Plus, 
  Check,
  X,
  Search, 
  Filter, 
  Edit3, 
  Trash2, 
  DollarSign, 
  Image as ImageIcon, 
  SlidersHorizontal,
  CakeSlice,
  Clock,
  Sparkles,
  ArrowUpDown,
  Tag,
  Upload
} from 'lucide-react';
import { Product, ProductCategory } from '../types';
import { matchesSearchValues } from '../utils/search';
import { formatPrice, toPersianDigits } from '../utils/formatters';
import { AddProductModal } from './AddProductModal';
import { EditPriceModal } from './EditPriceModal';

interface ProductManagerProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<Product>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
}

export const ProductManager: React.FC<ProductManagerProps> = ({
  products,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPriceProduct, setEditingPriceProduct] = useState<Product | null>(null);
  const [changingPhotoProduct, setChangingPhotoProduct] = useState<Product | null>(null);
  const [newPhotoUrls, setNewPhotoUrls] = useState<string[]>([]);
  const [uploadedBase64Array, setUploadedBase64Array] = useState<string[]>([]);
  const [removedImageIndices, setRemovedImageIndices] = useState<number[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories: (ProductCategory | 'all')[] = [
    'all',
    'کیک و پای',
    'شیرینی تر و خامه‌ای',
    'شیرینی خشک و سنتی',
    'دسر و باقلوا',
    'کوکی و بیسکوئیت',
    'نان و کروسان',
  ];

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      selectedCategory === 'all' || product.category === selectedCategory;
    const matchesSearch = matchesSearchValues(searchQuery, [
      product.productCode,
      product.name,
      product.category,
      product.unit,
      product.description,
    ]);
    return matchesCategory && matchesSearch;
  });

  const handlePhotoUpload = async (files: FileList) => {
    Array.from(files).forEach(async (file) => {
      if (!file.type.startsWith('image/')) {
        alert('لطفاً فقط فایل تصویری (عکس) انتخاب کنید.');
        return;
      }
      
      try {
        const response = await fetch('/api/upload-image', {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': file.type
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setNewPhotoUrls((prev) => [...prev, data.url]);
        } else {
          alert('خطا در آپلود عکس');
        }
      } catch (err) {
        alert('خطا در آپلود عکس');
      }
    });
  };

  const handlePhotoUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingPhotoProduct) return;
    
    // Get current images and remove the ones marked for deletion
    const currentImages = changingPhotoProduct.images || [changingPhotoProduct.image];
    const remainingImages = currentImages.filter((_, idx) => !removedImageIndices.includes(idx));
    
    // Combine remaining current images with new images
    const targetImages = [...remainingImages, ...uploadedBase64Array, ...newPhotoUrls];
    if (targetImages.length === 0) {
      alert('حداقل یک عکس باید وجود داشته باشد');
      return;
    }

    await onUpdateProduct(changingPhotoProduct.id, { 
      image: targetImages[0],
      images: targetImages 
    });
    setChangingPhotoProduct(null);
    setNewPhotoUrls([]);
    setUploadedBase64Array([]);
    setRemovedImageIndices([]);
  };

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto space-y-6">
      
      {/* Top Banner & Action Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 xl:p-8 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 sm:gap-6 shadow-xl">
        <div className="min-w-0 space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold">
            <CakeSlice className="w-3.5 h-3.5" />
            <span>پنل صاحب قنادی</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            مدیریت محصولات، قیمت‌ها و تصاویر
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            هرگونه تغییر در قیمت، عکس، آپلود تصویر یا موجودی شیرینی‌ها به صورت آنی در <b>ربات تلگرام</b> و درگاه سفارش مشتریان اعمال می‌شود.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="w-full sm:w-auto justify-center px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold text-sm shadow-lg shadow-amber-600/30 hover:shadow-amber-500/40 transition-all flex items-center gap-2 shrink-0 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>افزودن محصول جدید</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 sm:gap-4 shadow-lg">
        
        {/* Search Field */}
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی نام کیک/محصول، کد محصول، دسته‌بندی یا ترکیبات..."
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-10 pl-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Pills Slider */}
        <div className="flex min-w-0 w-full xl:w-auto xl:max-w-[58%] items-center gap-1.5 overflow-x-auto pb-1 xl:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700/60'
              }`}
            >
              {cat === 'all' ? '🌟 همه محصولات' : cat}
            </button>
          ))}
        </div>

      </div>

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
          <CakeSlice className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-base font-semibold text-slate-300">محصولی با این مشخصات یافت نشد!</p>
          <p className="text-xs text-slate-500">می‌توانید فیلتر جستجو را تغییر دهید یا محصول جدیدی با آپلود عکس اضافه کنید.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 sm:gap-5">
          {filteredProducts.map((product) => {
            const hasDiscount = product.discountPercent && product.discountPercent > 0;
            const finalPrice = hasDiscount
              ? (product.price * (100 - product.discountPercent!)) / 100
              : product.price;

            return (
              <div
                key={product.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-3xl overflow-hidden text-slate-100 shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col group"
              >
                {/* Product Image & Badges */}
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-950">
                  <img
                    src={product.images?.[0] || product.image}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30" />

                  {/* Category Pill */}
                  <span className="absolute top-3 right-3 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-900/80 backdrop-blur-md text-slate-200 border border-slate-700">
                    {product.category}
                  </span>

                  {/* Product Code */}
                  {product.productCode && (
                    <span className="absolute top-3 left-16 px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-amber-500/20 backdrop-blur-md text-amber-300 border border-amber-500/40">
                      کد: {product.productCode}
                    </span>
                  )}

                  {/* Availability Badge */}
                  <button
                    onClick={() => onUpdateProduct(product.id, { isAvailable: !product.isAvailable })}
                    className={`absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[11px] font-bold backdrop-blur-md transition-all flex items-center gap-1 ${
                      product.isAvailable
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                    }`}
                    title="کلیک برای تغییر موجودی در بات تلگرام"
                  >
                    <span className={`w-2 h-2 rounded-full ${product.isAvailable ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <span>{product.isAvailable ? 'موجود' : 'ناموجود'}</span>
                  </button>

                  {/* Quick Change Photo Button */}
                  <button
                    onClick={() => {
                      setChangingPhotoProduct(product);
                      setNewPhotoUrls([]);
                      setUploadedBase64Array([]);
                      setRemovedImageIndices([]);
                    }}
                    className="absolute bottom-3 left-3 p-2 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-slate-300 hover:text-white border border-slate-700 backdrop-blur-md text-xs flex items-center gap-1.5 transition-all opacity-90 hover:opacity-100"
                    title="مدیریت عکس‌های محصول"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                    <span>تغییر عکس</span>
                  </button>
                </div>

                {/* Body Content */}
                <div className="p-4 sm:p-5 min-w-0 flex-1 flex flex-col justify-between space-y-4">
                  <div className="min-w-0 space-y-2">
                    <h3 className="font-bold text-base text-white line-clamp-1 leading-snug">
                      {product.name}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  </div>

                  {/* Price & Unit Box */}
                  <div className="bg-slate-950/60 rounded-2xl p-3 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-400 block">
                        قیمت ({product.unit}):
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {hasDiscount && (
                          <span className="text-xs text-slate-500 line-through">
                            {formatPrice(product.price)}
                          </span>
                        )}
                        <span className="text-sm sm:text-base font-extrabold text-amber-400">
                          {formatPrice(finalPrice)}
                        </span>
                      </div>
                    </div>

                    {/* Quick Edit Price Button */}
                    <button
                      onClick={() => setEditingPriceProduct(product)}
                      className="shrink-0 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1 transition-all"
                      title="ویرایش قیمت این شیرینی"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تغییر قیمت</span>
                    </button>
                  </div>

                  {/* Card Action Footer */}
                  <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <div className="flex min-w-0 items-center gap-1">
                      <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">آماده‌سازی: {toPersianDigits(product.preparationTimeHours || 2)} ساعت</span>
                    </div>

                    <button
                      onClick={() => {
                        if (confirm(`آیا از حذف محصول «${product.name}» اطمینان دارید؟`)) {
                          onDeleteProduct(product.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="حذف شیرینی از لیست"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Product Modal */}
      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddProduct={onAddProduct}
      />

      {/* Edit Price Modal */}
      <EditPriceModal
        isOpen={!!editingPriceProduct}
        product={editingPriceProduct}
        onClose={() => setEditingPriceProduct(null)}
        onUpdateProduct={onUpdateProduct}
      />

      {/* Change Photo Modal with Upload */}
      {changingPhotoProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex min-w-0 items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <h3 className="min-w-0 font-bold text-base text-white flex items-center gap-2">
                <ImageIcon className="w-5 h-5 shrink-0 text-amber-400" />
                <span className="truncate">آپلود و تغییر عکس: {changingPhotoProduct.name}</span>
              </h3>
              <button
                onClick={() => setChangingPhotoProduct(null)}
                className="shrink-0 p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePhotoUpdateSubmit} className="space-y-4">
              {/* Current Images Grid */}
              <div className="grid grid-cols-3 gap-2">
                {(changingPhotoProduct.images || [changingPhotoProduct.image]).map((img, idx) => {
                  const isRemoved = removedImageIndices.includes(idx);
                  return (
                    <div key={idx} className={`relative aspect-square rounded-xl overflow-hidden bg-slate-950 border ${isRemoved ? 'border-rose-500 opacity-50' : 'border-slate-800'}`}>
                      <img
                        src={img}
                        alt={`عکس ${idx + 1}`}
                        className={`w-full h-full object-cover ${isRemoved ? 'grayscale' : ''}`}
                      />
                      <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-900/80 text-slate-200">
                        {idx === 0 ? 'اصلی' : idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (isRemoved) {
                            setRemovedImageIndices((prev) => prev.filter((i) => i !== idx));
                          } else {
                            setRemovedImageIndices((prev) => [...prev, idx]);
                          }
                        }}
                        className={`absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center ${
                          isRemoved ? 'bg-emerald-500' : 'bg-rose-500'
                        } text-white`}
                      >
                        {isRemoved ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Newly Uploaded Images */}
              {newPhotoUrls.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-emerald-300">عکس‌های جدید:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {newPhotoUrls.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-slate-950 border-2 border-emerald-500">
                        <img
                          src={img}
                          alt={`عکس جدید ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setNewPhotoUrls((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Input */}
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handlePhotoUpload(e.target.files);
                  }
                }}
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-4 border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl text-center cursor-pointer bg-slate-800/40 hover:bg-slate-800/70 transition-all"
              >
                <Upload className="w-6 h-6 text-amber-400 mx-auto mb-1.5" />
                <p className="text-xs font-bold text-white">برای افزودن عکس‌های بیشتر کلیک کنید</p>
                <p className="text-[11px] text-slate-400 mt-0.5">می‌توانید چند عکس همزمان انتخاب کنید</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  یا لینک مستقیم اینترنتی عکس:
                </label>
                <input
                  type="url"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      setNewPhotoUrls((prev) => [...prev, e.target.value]);
                    }
                  }}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setChangingPhotoProduct(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>ذخیره عکس جدید</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
