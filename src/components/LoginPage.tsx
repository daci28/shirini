import React, { useState } from 'react';
import { Lock, User, CakeSlice, Eye, EyeOff, LoaderCircle } from 'lucide-react';

interface LoginPageProps {
  /** Performs the credential check on the server and creates an HttpOnly session. */
  onLogin: (username: string, password: string) => Promise<void>;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      // Credentials are posted only to the server. They are never compared with
      // settings or saved in localStorage by the browser.
      await onLogin(username, password);
      setPassword('');
    } catch (err: any) {
      setError(err?.message || 'ورود به پنل ممکن نشد. لطفاً دوباره تلاش کنید.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-pink-500 shadow-2xl shadow-pink-500/30 mb-4">
            <CakeSlice className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">پنل مدیریت فروش</h1>
          <p className="text-slate-400 text-sm">برای ورود نام کاربری و رمز عبور خود را وارد کنید</p>
        </div>

        <form onSubmit={handleLogin} className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-3xl p-8 space-y-6 shadow-2xl">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="panel-username">نام کاربری</label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                id="panel-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                maxLength={128}
                disabled={isSubmitting}
                className="w-full pr-10 pl-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none transition disabled:opacity-60"
                placeholder="admin"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="panel-password">رمز عبور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                id="panel-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={256}
                disabled={isSubmitting}
                className="w-full pr-10 pl-10 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none transition disabled:opacity-60"
                placeholder="admin"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition disabled:opacity-50"
                disabled={isSubmitting}
                aria-label={showPassword ? 'مخفی‌کردن رمز عبور' : 'نمایش رمز عبور'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold rounded-xl shadow-lg shadow-amber-500/30 transition transform hover:scale-[1.02] disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 inline-flex items-center justify-center gap-2"
          >
            {isSubmitting && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'در حال بررسی...' : 'ورود به پنل'}
          </button>

          <p className="text-xs text-slate-500 text-center">
            برای نصب اولیه، نام کاربری و رمز عبور هر دو <code className="text-amber-400">admin</code> هستند و از تنظیمات پنل قابل تغییرند.
          </p>
        </form>
      </div>
    </div>
  );
};
