import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SectionCard } from './SectionCard';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'error';

type AvailableUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>;
};

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function AppUpdateSection() {
  const desktop = isTauriRuntime();
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!desktop) return;
    getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion('1.0.0'));
  }, [desktop]);

  async function checkForUpdate() {
    setError('');
    setStatus('checking');
    setAvailable(null);
    try {
      const update = await check();
      if (!update) {
        setStatus('current');
        return;
      }
      setAvailable(update);
      setStatus('available');
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Unable to check for updates.');
    }
  }

  async function installUpdate() {
    if (!available) return;
    setError('');
    setStatus('downloading');
    setProgress('Downloading the latest version…');
    try {
      let downloaded = 0;
      let total = 0;
      await available.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setProgress(total > 0 ? 'Downloading 0%' : 'Downloading the latest version…');
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(`Downloading ${Math.min(100, Math.round((downloaded / total) * 100))}%`);
          }
        } else if (event.event === 'Finished') {
          setProgress('Installing and restarting…');
        }
      });
      await relaunch();
    } catch (cause) {
      setStatus('available');
      setError(cause instanceof Error ? cause.message : 'The update could not be installed.');
    }
  }

  return (
    <SectionCard title="App version">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-slate">Installed version</p>
            <p className="mt-1 font-display text-3xl text-graphite">{currentVersion}</p>
          </div>
          {status === 'current' ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">Up to date</span>
          ) : null}
          {status === 'available' && available ? (
            <span className="rounded-full bg-clay/10 px-3 py-1 text-sm font-bold text-clay">
              Version {available.version} is available
            </span>
          ) : null}
        </div>

        {available?.body ? (
          <p className="whitespace-pre-wrap text-sm font-semibold text-slate">{available.body}</p>
        ) : null}

        {desktop ? (
          <p className="text-sm font-semibold text-slate">
            Check GitHub for a newer KKR ERP release, then install it from here. The app restarts after the update finishes.
          </p>
        ) : (
          <p className="text-sm font-semibold text-slate">
            Version updates run inside the installed desktop app. This browser preview can show the current version only.
          </p>
        )}

        {progress && status === 'downloading' ? (
          <p className="text-sm font-bold text-graphite">{progress}</p>
        ) : null}
        {error ? <p className="text-sm font-bold text-rose-700">{error}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={checkForUpdate}
            disabled={!desktop || status === 'checking' || status === 'downloading'}
            className="inline-flex items-center gap-2 rounded-xl border border-steel px-4 py-2 text-sm font-bold text-graphite transition hover:border-clay hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
            {status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          <button
            type="button"
            onClick={installUpdate}
            disabled={!desktop || !available || status === 'downloading'}
            className="inline-flex items-center gap-2 rounded-xl bg-clay px-4 py-2 text-sm font-bold text-[color:var(--on-accent)] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {status === 'downloading' ? 'Updating…' : 'Update to latest'}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
