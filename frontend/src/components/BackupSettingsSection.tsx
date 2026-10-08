import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SectionCard } from './SectionCard';
import { api } from '../services/api';

interface BackupItem {
  id: string;
  name: string;
  size_formatted: string;
  size_bytes?: number;
  created_at: string;
  view_url: string;
  destination: string;
}

interface BackupConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  retention: number;
  destination: string;
  gdrive_folder_id: string;
  include_database: boolean;
  include_financials: boolean;
  include_manifest: boolean;
}

export function BackupSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [isGdriveConnected, setIsGdriveConnected] = useState(false);
  const [defaultFolderId, setDefaultFolderId] = useState('');
  const [lastStatus, setLastStatus] = useState<any>(null);

  // Config State
  const [config, setConfig] = useState<BackupConfig>({
    enabled: true,
    frequency: 'daily',
    time: '02:00',
    retention: 7,
    destination: 'gdrive',
    gdrive_folder_id: '',
    include_database: true,
    include_financials: true,
    include_manifest: true,
  });

  // Action states
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [downloadingLocal, setDownloadingLocal] = useState(false);
  const [uploadingGdrive, setUploadingGdrive] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<{ text: string; link?: string } | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  // History State
  const [backupsList, setBackupsList] = useState<BackupItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.getBackupConfig();
      if (res.config) {
        setConfig(res.config);
      }
      setIsGdriveConnected(res.is_gdrive_connected);
      setDefaultFolderId(res.default_gdrive_root_id || '');
      setLastStatus(res.last_status);

      await loadHistory(res.config?.gdrive_folder_id);
    } catch (err: any) {
      console.error('Failed to load backup config:', err);
      setActionErrorMessage('Failed to load backup settings. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (customFolderId?: string) => {
    try {
      setLoadingHistory(true);
      const res = await api.getBackupHistory(customFolderId);
      setBackupsList(res.backups || []);
    } catch (err) {
      console.error('Failed to load backup history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      setActionErrorMessage(null);
      await api.updateBackupConfig(config);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
      await loadHistory(config.gdrive_folder_id);
    } catch (err: any) {
      setActionErrorMessage(err?.response?.data?.detail || 'Failed to save configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDownloadLocal = async () => {
    try {
      setDownloadingLocal(true);
      setActionErrorMessage(null);
      setActionSuccessMessage(null);

      const response = await api.exportLocalBackup({
        include_database: config.include_database,
        include_financials: config.include_financials,
        include_manifest: config.include_manifest,
      });

      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `KKR_ERP_Full_Backup_${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setActionSuccessMessage({ text: 'Backup archive downloaded successfully to your computer!' });
    } catch (err: any) {
      setActionErrorMessage(err?.response?.data?.detail || 'Failed to generate local backup archive.');
    } finally {
      setDownloadingLocal(false);
    }
  };

  const handleBackupToGdrive = async () => {
    try {
      setUploadingGdrive(true);
      setActionErrorMessage(null);
      setActionSuccessMessage(null);

      const res = await api.exportGdriveBackup({
        include_database: config.include_database,
        include_financials: config.include_financials,
        include_manifest: config.include_manifest,
        custom_folder_id: config.gdrive_folder_id || undefined,
      });

      setActionSuccessMessage({
        text: `Backup successfully uploaded to Google Drive (${res.filename} - ${res.size_mb} MB)!`,
        link: res.view_url,
      });

      await loadHistory(config.gdrive_folder_id);
    } catch (err: any) {
      setActionErrorMessage(err?.response?.data?.detail || 'Failed to upload backup to Google Drive.');
    } finally {
      setUploadingGdrive(false);
    }
  };

  const handleDeleteBackup = async (fileId: string) => {
    if (!window.confirm('Are you sure you want to delete this backup from Google Drive?')) return;
    try {
      setDeletingId(fileId);
      await api.deleteBackup(fileId);
      setBackupsList((prev) => prev.filter((b) => b.id !== fileId));
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to delete backup.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownloadCloudBackup = async (backup: BackupItem) => {
    try {
      setDownloadingId(backup.id);
      const res = await api.downloadGdriveBackup(backup.id);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Failed to download backup file from Google Drive.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-clay" />
        <span className="ml-3 font-semibold text-slate">Loading backup configuration...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Alert Notices */}
      {actionSuccessMessage && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            <span className="font-semibold text-sm">{actionSuccessMessage.text}</span>
          </div>
          {actionSuccessMessage.link && (
            <a
              href={actionSuccessMessage.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-xs underline hover:text-emerald-600"
            >
              Open in Drive <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {actionErrorMessage && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-800 dark:text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-500" />
          <span className="font-semibold text-sm">{actionErrorMessage}</span>
        </div>
      )}

      {/* Cloud Connection Card */}
      <SectionCard
        title="Storage & Backup Destination"
        description="Configure cloud storage accounts and instant manual export options"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-steel/50 bg-[var(--panel-bg)] p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isGdriveConnected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
              <Cloud className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-graphite">Google Drive Storage</span>
                {isGdriveConnected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Connected & Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
                    Not Connected
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold text-slate">
                {isGdriveConnected
                  ? 'All drawings, bills, notes, and backup archives are synced to your 15 GB Google Drive.'
                  : 'Connect Google Drive OAuth in backend to enable automatic cloud backup.'}
              </span>
            </div>
          </div>
        </div>

        {/* 1-Click Instant Backup Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 pt-2">
          {/* Card 1: Local PC Download */}
          <div className="flex flex-col justify-between rounded-2xl border border-steel/60 bg-[var(--panel-bg)] p-5 hover:border-clay/50 transition">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-bold text-graphite">
                  <HardDrive className="h-5 w-5 text-clay" />
                  Download to PC (.zip)
                </span>
                <span className="rounded-lg bg-steel/30 px-2 py-0.5 text-xs font-bold text-slate">Local Archive</span>
              </div>
              <p className="text-sm font-semibold text-slate">
                Generates a complete standalone archive containing all SQL dumps, JSON table files, and financial CSVs directly to your computer.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                disabled={downloadingLocal}
                onClick={handleDownloadLocal}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-clay px-4 py-2.5 font-bold text-white shadow-sm transition hover:bg-clay/90 disabled:opacity-50"
              >
                {downloadingLocal ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating Archive...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download Backup Archive
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Google Drive Cloud Backup */}
          <div className="flex flex-col justify-between rounded-2xl border border-steel/60 bg-[var(--panel-bg)] p-5 hover:border-clay/50 transition">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-bold text-graphite">
                  <Cloud className="h-5 w-5 text-clay" />
                  Back up to Google Drive
                </span>
                <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  Cloud Vault
                </span>
              </div>
              <p className="text-sm font-semibold text-slate">
                Creates a timestamped snapshot archive and uploads it directly to your designated Google Drive folder with 0 local disk footprint.
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                disabled={uploadingGdrive || !isGdriveConnected}
                onClick={handleBackupToGdrive}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-clay bg-clay/10 px-4 py-2.5 font-bold text-clay shadow-sm transition hover:bg-clay/20 disabled:opacity-50"
              >
                {uploadingGdrive ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading to Google Drive...
                  </>
                ) : (
                  <>
                    <Cloud className="h-4 w-4" />
                    Back Up to Cloud Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Modular Backup Selection (Feature B) */}
      <SectionCard
        title="Modular Backup Scope"
        description="Select which application modules and datasets to include in backup archives"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Include Database */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, include_database: !config.include_database })}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              config.include_database
                ? 'border-clay bg-clay/10 ring-2 ring-clay/30'
                : 'border-steel/60 bg-[var(--panel-bg)] opacity-70'
            }`}
          >
            <Database className="h-5 w-5 shrink-0 text-clay mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-graphite">Database Dump</span>
                {config.include_database && <Check className="h-4 w-4 text-clay" />}
              </div>
              <span className="text-xs font-semibold text-slate">
                Full PostgreSQL SQL dump and JSON export of all 30+ tables.
              </span>
            </div>
          </button>

          {/* Include Financials */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, include_financials: !config.include_financials })}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              config.include_financials
                ? 'border-clay bg-clay/10 ring-2 ring-clay/30'
                : 'border-steel/60 bg-[var(--panel-bg)] opacity-70'
            }`}
          >
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-clay mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-graphite">Financial CSVs</span>
                {config.include_financials && <Check className="h-4 w-4 text-clay" />}
              </div>
              <span className="text-xs font-semibold text-slate">
                Export ledgers for expenses, vendor invoices, petty cash & payments.
              </span>
            </div>
          </button>

          {/* Include Storage Manifest */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, include_manifest: !config.include_manifest })}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              config.include_manifest
                ? 'border-clay bg-clay/10 ring-2 ring-clay/30'
                : 'border-steel/60 bg-[var(--panel-bg)] opacity-70'
            }`}
          >
            <FileText className="h-5 w-5 shrink-0 text-clay mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-graphite">Files Catalog</span>
                {config.include_manifest && <Check className="h-4 w-4 text-clay" />}
              </div>
              <span className="text-xs font-semibold text-slate">
                Index of all 280+ project drawings, PDFs, and Google Drive links.
              </span>
            </div>
          </button>
        </div>
      </SectionCard>

      {/* Automated Scheduled Backups (Feature C) */}
      <SectionCard
        title="Automated Scheduled Backups"
        description="Configure automated hands-free backups with customized retention policies"
      >
        <div className="space-y-4">
          {/* Toggle Enable */}
          <div className="flex items-center justify-between rounded-2xl border border-steel/60 bg-[var(--panel-bg)] p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-clay" />
              <div>
                <span className="block font-bold text-graphite">Enable Automated Background Backups</span>
                <span className="block text-xs font-semibold text-slate">
                  Runs quietly in the background on the schedule defined below
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.enabled}
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                config.enabled ? 'bg-clay' : 'bg-steel/50'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Schedule Parameters */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Frequency */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate">Backup Frequency</label>
              <select
                disabled={!config.enabled}
                value={config.frequency}
                onChange={(e) => setConfig({ ...config, frequency: e.target.value as any })}
                className="w-full rounded-xl border border-steel/60 bg-[var(--panel-bg)] px-3 py-2.5 font-bold text-graphite transition focus:border-clay focus:outline-none disabled:opacity-50"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {/* Time */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate">Execution Time</label>
              <input
                type="time"
                disabled={!config.enabled}
                value={config.time}
                onChange={(e) => setConfig({ ...config, time: e.target.value })}
                className="w-full rounded-xl border border-steel/60 bg-[var(--panel-bg)] px-3 py-2.5 font-bold text-graphite transition focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Retention */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate">Retention Policy</label>
              <select
                disabled={!config.enabled}
                value={config.retention}
                onChange={(e) => setConfig({ ...config, retention: Number(e.target.value) })}
                className="w-full rounded-xl border border-steel/60 bg-[var(--panel-bg)] px-3 py-2.5 font-bold text-graphite transition focus:border-clay focus:outline-none disabled:opacity-50"
              >
                <option value="7">Keep last 7 backups</option>
                <option value="14">Keep last 14 backups</option>
                <option value="30">Keep last 30 backups</option>
                <option value="60">Keep last 60 backups</option>
              </select>
            </div>
          </div>

          {/* Custom Google Drive Folder ID Option (Option 2) */}
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate">
                Google Drive Destination Folder ID (Optional)
              </label>
              <span className="text-xs font-semibold text-slate">
                Default: <code className="bg-steel/30 px-1.5 py-0.5 rounded text-[11px]">{defaultFolderId || 'KKR ERP Files/Backups'}</code>
              </span>
            </div>
            <div className="relative">
              <Folder className="absolute left-3.5 top-3 h-4 w-4 text-slate" />
              <input
                type="text"
                placeholder="Leave blank to use default KKR ERP Files/Backups folder"
                value={config.gdrive_folder_id}
                onChange={(e) => setConfig({ ...config, gdrive_folder_id: e.target.value.trim() })}
                className="w-full rounded-xl border border-steel/60 bg-[var(--panel-bg)] pl-10 pr-4 py-2.5 text-sm font-semibold text-graphite transition focus:border-clay focus:outline-none"
              />
            </div>
            <p className="text-xs font-semibold text-slate">
              To store backups in a separate dedicated Google Drive folder, paste its 33-character Google Drive folder ID here.
            </p>
          </div>

          {/* Save Settings Button */}
          <div className="flex items-center justify-end gap-3 pt-2">
            {configSaved && (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Settings Saved!
              </span>
            )}
            <button
              type="button"
              disabled={savingConfig}
              onClick={handleSaveConfig}
              className="inline-flex items-center gap-2 rounded-xl bg-clay px-5 py-2.5 font-bold text-white shadow-sm transition hover:bg-clay/90 disabled:opacity-50"
            >
              {savingConfig ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save Schedule Settings
                </>
              )}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Cloud Backup History Table */}
      <SectionCard
        title="Google Drive Backup Archives"
        description="Historical snapshots stored in your Google Drive cloud vault"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate">
              {backupsList.length} Cloud Backup{backupsList.length === 1 ? '' : 's'} Found
            </span>
            <button
              type="button"
              disabled={loadingHistory}
              onClick={() => loadHistory(config.gdrive_folder_id)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-clay hover:underline disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh List
            </button>
          </div>

          {backupsList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-steel/60 p-8 text-center">
              <Database className="mx-auto h-8 w-8 text-slate/50" />
              <p className="mt-2 text-sm font-bold text-graphite">No Cloud Backups Found</p>
              <p className="text-xs font-semibold text-slate">
                Click "Back up to Google Drive" above to create your first cloud snapshot.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-steel/60 bg-[var(--panel-bg)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-steel/60 bg-steel/20 text-xs font-bold uppercase tracking-wider text-slate">
                    <th className="px-4 py-3">Archive Name</th>
                    <th className="px-4 py-3">Created Date</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel/40">
                  {backupsList.map((backup) => (
                    <tr key={backup.id} className="hover:bg-steel/10 transition">
                      <td className="px-4 py-3.5 font-bold text-graphite">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-clay shrink-0" />
                          <span className="truncate max-w-[240px] sm:max-w-none">{backup.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate whitespace-nowrap">
                        {backup.created_at ? new Date(backup.created_at).toLocaleString() : 'N/A'}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-graphite whitespace-nowrap">
                        {backup.size_formatted}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          <Cloud className="h-3 w-3" />
                          Google Drive
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            title="Download from Google Drive"
                            disabled={downloadingId === backup.id}
                            onClick={() => handleDownloadCloudBackup(backup)}
                            className="inline-flex items-center gap-1 rounded-lg border border-steel/60 px-2.5 py-1 text-xs font-bold text-graphite transition hover:border-clay hover:text-clay disabled:opacity-50"
                          >
                            {downloadingId === backup.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            Download
                          </button>

                          {backup.view_url && (
                            <a
                              href={backup.view_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in Google Drive"
                              className="inline-flex items-center rounded-lg border border-steel/60 p-1.5 text-slate transition hover:border-clay hover:text-clay"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}

                          <button
                            type="button"
                            title="Delete Backup"
                            disabled={deletingId === backup.id}
                            onClick={() => handleDeleteBackup(backup.id)}
                            className="inline-flex items-center rounded-lg border border-steel/60 p-1.5 text-rose-500 transition hover:border-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                          >
                            {deletingId === backup.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
