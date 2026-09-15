import React from 'react';
import { CakeSlice, LogOut, Menu } from 'lucide-react';
import { BotSettings } from '../types';

interface MobileHeaderProps {
  botSettings: BotSettings;
  onMenuClick: () => void;
  onLogout: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ botSettings, onMenuClick, onLogout }) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-30 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-lg lg:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-pink-500 flex items-center justify-center shrink-0">
          <CakeSlice className="w-4 h-4 text-white" />
        </div>
        <h1 className="truncate text-sm font-bold text-white">پنل مدیریت فروش</h1>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLogout}
          className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-200 transition flex items-center justify-center border border-slate-700"
          aria-label="خروج از پنل"
          title="خروج از پنل"
        >
          <LogOut className="w-4.5 h-4.5" />
        </button>
        <button
          type="button"
          onClick={onMenuClick}
          className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center justify-center border border-slate-700"
          aria-label="باز کردن منو"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
