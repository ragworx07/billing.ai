import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

import kkrLogo from '../assets/kkr-logo.png';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { getApiErrorMessage } from '../utils/errors';

export function LoginPage() {
  const { login } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const notice = sessionStorage.getItem('auth_notice');
    if (notice) {
      notify.error(notice);
      sessionStorage.removeItem('auth_notice');
    }
  }, [notify]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    try {
      await login(email.trim(), password);
      notify.success('Login successful.');
      navigate('/');
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Invalid login ID or password. Please try again.');
      setErrorMessage(msg);
      notify.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-1 items-center justify-center overflow-auto px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
      <div className="pointer-events-none absolute -left-28 top-1/4 h-72 w-72 rounded-full bg-clay/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-sand/70 blur-3xl" />

      <div className="relative grid w-full max-w-[min(1180px,100%)] overflow-auto rounded-[32px] border border-white/80 bg-white/80 shadow-[0_28px_80px_rgba(27,27,24,0.14)] backdrop-blur-xl lg:max-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
        <section className="relative hidden min-h-0 overflow-auto bg-[linear-gradient(145deg,#151412_0%,#241b17_34%,#4b3126_68%,#82543d_100%)] px-8 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-14 xl:py-12">
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full bg-clay/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-clay/30 blur-3xl" />

          <div className="relative flex flex-1 flex-col items-center justify-center py-8 text-center">
            <div className="pointer-events-none absolute h-72 w-72 rounded-full bg-clay/15 blur-3xl" />
            <div className="relative flex h-[min(9rem,24dvh)] w-[min(9rem,24dvh)] items-center justify-center rounded-[36px] bg-gradient-to-br from-amber-600 via-amber-700 to-amber-900 p-5 shadow-[0_28px_65px_rgba(0,0,0,0.34)] ring-1 ring-white/70 text-white font-black text-3xl tracking-wider">
              ERP
            </div>
            <p className="relative mt-7 text-lg font-black uppercase tracking-[0.11em] text-white xl:text-xl">Billing & Accounting ERP</p>
            <span className="relative mt-6 h-px w-20 bg-sand/50" />
            <p className="relative mt-6 text-xs font-bold uppercase tracking-[0.28em] text-sand/80">Tally Edition · Financial Workspace</p>
            <p className="relative mx-auto mt-4 max-w-sm text-sm leading-6 text-white/70 xl:text-base xl:leading-7">
              One unified platform for sales invoicing, customer ledgers, inventory stock, and financial reports.
            </p>
          </div>

          <div className="relative flex items-center gap-3 text-xs text-white/45">
            <ShieldCheck size={16} className="text-sand/80" />
            <span>Built for modern GST accounting and business billing.</span>
          </div>
        </section>

        <section className="flex min-w-0 items-center justify-center bg-white p-5 sm:p-10 md:p-12 lg:p-10 xl:p-14">
          <div className="w-full max-w-[480px]">
            <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-amber-600 to-amber-900 text-white font-black text-xl shadow-[0_12px_30px_rgba(27,27,24,0.1)] ring-1 ring-slate-100 lg:hidden">
              ERP
            </div>
            <div className="w-full text-center lg:text-left">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-clay">Welcome back</p>
              <h1 className="mt-3 font-display text-3xl leading-tight text-graphite sm:text-4xl">Sign in to Billing ERP</h1>
            </div>

            <form onSubmit={handleSubmit} className="mt-7 w-full space-y-5 text-left">
              {errorMessage && (
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4 text-sm font-medium text-red-800 shadow-sm">
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
                  <div>{errorMessage}</div>
                </div>
              )}
              <div>
                <label htmlFor="login-email" className="mb-2 block text-sm font-bold text-graphite">Login ID</label>
                <div className="relative">
                  <Mail size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate" />
                  <input
                    id="login-email"
                    type="email"
                    placeholder="Enter your login ID"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    required
                    className="h-14 rounded-2xl border-2 border-steel bg-white pl-12 pr-4 text-base font-medium text-graphite shadow-sm placeholder:font-normal placeholder:text-slate/70 focus:border-clay focus:ring-4 focus:ring-clay/15"
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="login-password" className="block text-sm font-bold text-graphite">Password</label>
                  <span className="text-sm font-medium text-slate">Keep it secure</span>
                </div>
                <div className="relative">
                  <LockKeyhole size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    required
                    className="h-14 rounded-2xl border-2 border-steel bg-white pl-12 pr-12 text-base font-medium text-graphite shadow-sm placeholder:font-normal placeholder:text-slate/70 focus:border-clay focus:ring-4 focus:ring-clay/15"
                  />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate/55 hover:bg-sand/60 hover:text-graphite">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-graphite px-4 text-sm font-bold text-white shadow-[0_12px_24px_rgba(27,27,24,0.15)] hover:bg-clay disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing you in...' : 'Continue to workspace'}
                {!loading && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
              </button>
            </form>

            <div className="mt-6 flex w-full items-center gap-3 text-xs text-slate/55">
              <span className="h-px flex-1 bg-slate-200" />
              <span>Private company workspace</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
