import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gauge, X } from 'lucide-react';

import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency } from '../utils/format';

export type LabourLimitTone = 'none' | 'ok' | 'watch' | 'limit' | 'over';

export type LabourLimitStatus = {
  hasLimit: boolean;
  limit: number;
  used: number;
  pending: number;
  projected: number;
  remaining: number;
  pct: number;
  tone: LabourLimitTone;
};

const TONE_BAR: Record<Exclude<LabourLimitTone, 'none'>, string> = {
  ok: 'bg-emerald-500',
  watch: 'bg-amber-500',
  limit: 'bg-orange-500',
  over: 'bg-rose-500',
};

const TONE_TEXT: Record<Exclude<LabourLimitTone, 'none'>, string> = {
  ok: 'text-emerald-700',
  watch: 'text-amber-800',
  limit: 'text-orange-800',
  over: 'text-rose-700',
};

export function labourLimitStatus(limit: number | null | undefined, used: number, pending = 0): LabourLimitStatus {
  const booked = Math.max(0, Number(used || 0));
  const extra = Math.max(0, Number(pending || 0));
  const projected = booked + extra;
  if (!limit || limit <= 0) {
    return {
      hasLimit: false,
      limit: 0,
      used: booked,
      pending: extra,
      projected,
      remaining: 0,
      pct: 0,
      tone: 'none',
    };
  }
  const remaining = limit - projected;
  const pct = (projected / limit) * 100;
  let tone: LabourLimitTone = 'ok';
  if (remaining < 0) tone = 'over';
  else if (remaining === 0 || pct >= 99.5) tone = 'limit';
  else if (pct >= 80) tone = 'watch';
  return {
    hasLimit: true,
    limit,
    used: booked,
    pending: extra,
    projected,
    remaining,
    pct,
    tone,
  };
}

export function labourLimitWarningMessage(name: string, status: LabourLimitStatus) {
  if (!status.hasLimit) return null;
  const who = name.trim() || 'This incharge';
  if (status.tone === 'over') {
    return `${who} is over the labour limit by ${formatCurrency(Math.abs(status.remaining))}. Limit ${formatCurrency(status.limit)}, booked ${formatCurrency(status.projected)}.`;
  }
  if (status.tone === 'limit') {
    return `${who} has reached the labour limit of ${formatCurrency(status.limit)}.`;
  }
  if (status.tone === 'watch') {
    return `${who} is close to the labour limit. ${formatCurrency(status.remaining)} left of ${formatCurrency(status.limit)}.`;
  }
  return null;
}

export function labourLimitSuggestionLabel(status: LabourLimitStatus) {
  if (!status.hasLimit) return null;
  if (status.tone === 'over') return `Over ${formatCurrency(Math.abs(status.remaining))}`;
  return `${formatCurrency(status.remaining)} left`;
}

function activeTone(tone: LabourLimitTone): Exclude<LabourLimitTone, 'none'> {
  return tone === 'none' ? 'ok' : tone;
}

function parseAmount(value: string) {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function LimitBar({ status, className }: { status: LabourLimitStatus; className?: string }) {
  if (!status.hasLimit) return null;
  const tone = activeTone(status.tone);
  const width = tone === 'over' ? 100 : Math.min(100, Math.max(0, status.pct));
  return (
    <div className={clsx('h-1.5 overflow-hidden rounded-full bg-slate-200', className)}>
      <div className={clsx('h-full rounded-full transition-all duration-300', TONE_BAR[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

export function LabourInchargeLimitMeter({
  status,
}: {
  inchargeName?: string;
  status: LabourLimitStatus;
}) {
  if (!status.hasLimit) return null;
  const remainingLabel = status.remaining >= 0
    ? `${formatCurrency(status.remaining)} left`
    : `Over ${formatCurrency(Math.abs(status.remaining))}`;
  return (
    <div
      className={clsx(
        'rounded-xl border px-3 py-2',
        status.tone === 'over' && 'border-rose-200 bg-rose-50/80',
        status.tone === 'limit' && 'border-orange-200 bg-orange-50/80',
        status.tone === 'watch' && 'border-amber-200 bg-amber-50/80',
        status.tone === 'ok' && 'border-emerald-200 bg-emerald-50/70',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Limit</p>
        <p className={clsx('text-sm font-black tabular-nums', TONE_TEXT[activeTone(status.tone)])}>{remainingLabel}</p>
      </div>
      <LimitBar status={status} className="mt-1.5" />
      <p className="mt-1.5 text-[11px] font-semibold tabular-nums text-slate-600">
        This entry {formatCurrency(status.pending)} · Booked {formatCurrency(status.used)} · Cap {formatCurrency(status.limit)}
      </p>
      {status.tone === 'over' || status.tone === 'limit' || status.tone === 'watch' ? (
        <p className={clsx('mt-1.5 flex items-center gap-1 text-[11px] font-semibold', TONE_TEXT[activeTone(status.tone)])}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {status.tone === 'over' ? 'This entry crosses the limit.' : status.tone === 'limit' ? 'This uses the last of the limit.' : 'Close to the limit.'}
        </p>
      ) : null}
    </div>
  );
}

export function LabourInchargeLimitDialog({
  open,
  projectId,
  vendorId,
  vendorName,
  incharges,
  limits,
  onClose,
}: {
  open: boolean;
  projectId: number;
  vendorId: number | null;
  vendorName?: string;
  incharges: Array<{ vendorId: number; vendorName: string; labourDue: number }>;
  limits: Map<number, number>;
  onClose: () => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const locked = vendorId != null && vendorId > 0;
  const [selectedId, setSelectedId] = useState<number>(vendorId || 0);
  const [amountText, setAmountText] = useState('');

  useEffect(() => {
    if (!open) return;
    const nextId = vendorId || 0;
    setSelectedId(nextId);
    const existing = nextId ? limits.get(nextId) : undefined;
    setAmountText(existing ? String(existing) : '');
  }, [open, vendorId, limits]);

  const selected = incharges.find((row) => row.vendorId === selectedId) || null;
  const used = selected?.labourDue || 0;
  const amount = parseAmount(amountText);
  const preview = labourLimitStatus(amount > 0 ? amount : limits.get(selectedId) || 0, used);
  const selectedName = selected?.vendorName || vendorName || 'Labour incharge';

  const saveMutation = useMutation({
    mutationFn: () => api.upsertLabourInchargeLimit(projectId, selectedId, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labour-incharge-limits', projectId] });
      notify.success(`Limit set for ${selectedName}.`);
      onClose();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save labour limit.')),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.deleteLabourInchargeLimit(projectId, selectedId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labour-incharge-limits', projectId] });
      notify.success(`Limit removed for ${selectedName}.`);
      onClose();
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to remove labour limit.')),
  });

  const hasExisting = Boolean(selectedId && limits.get(selectedId));
  const canSave = selectedId > 0 && amount > 0 && !saveMutation.isPending;

  const inchargeOptions = useMemo(() => {
    const map = new Map<number, { vendorId: number; vendorName: string; labourDue: number }>();
    incharges.forEach((row) => {
      if (row.vendorId > 0) map.set(row.vendorId, row);
    });
    return Array.from(map.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [incharges]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 px-3 py-6" onClick={onClose}>
      <div
        className="w-full max-w-[22rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Set labour incharge limit"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">Set labour limit</h3>
          </div>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Incharge</label>
            {locked ? (
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">{selectedName}</p>
            ) : (
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900"
                value={selectedId || ''}
                onChange={(event) => {
                  const nextId = Number(event.target.value || 0);
                  setSelectedId(nextId);
                  const existing = nextId ? limits.get(nextId) : undefined;
                  setAmountText(existing ? String(existing) : '');
                }}
              >
                <option value="">Select incharge</option>
                {inchargeOptions.map((row) => (
                  <option key={row.vendorId} value={row.vendorId}>
                    {row.vendorName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Limit amount</label>
            <input
              type="number"
              min="1"
              step="1"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              placeholder="50000"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold tabular-nums text-slate-900"
            />
          </div>

          {selectedId > 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] font-semibold tabular-nums text-slate-600">
              <span>Booked {formatCurrency(used)}</span>
              <span className={clsx(amount > 0 && preview.tone === 'over' ? 'text-rose-700' : 'text-indigo-700')}>
                {amount > 0
                  ? (preview.remaining >= 0 ? `${formatCurrency(preview.remaining)} left` : `Over ${formatCurrency(Math.abs(preview.remaining))}`)
                  : 'Enter a limit'}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          {hasExisting ? (
            <button
              type="button"
              className="text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? 'Removing…' : 'Remove'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-1.5">
            <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
