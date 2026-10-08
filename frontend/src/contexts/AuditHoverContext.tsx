import { createContext, type ReactNode, useContext, useState } from 'react';
import type { AuditActor } from '../types/api';

type AuditHoverState = {
  actor: AuditActor | null;
  recordLabel: string;
  visible: boolean;
};

type AuditHoverContextValue = {
  showAudit: (actor: AuditActor | null, recordLabel?: string) => void;
  hideAudit: () => void;
};

const AuditHoverContext = createContext<AuditHoverContextValue | null>(null);

function formatAuditTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AuditHoverProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuditHoverState>({ actor: null, recordLabel: '', visible: false });

  return (
    <AuditHoverContext.Provider
      value={{
        showAudit: (actor, recordLabel = 'Record') => setState({ actor, recordLabel, visible: true }),
        hideAudit: () => setState((current) => ({ ...current, visible: false })),
      }}
    >
      {children}
      <div
        className={`pointer-events-none fixed bottom-2 left-2 z-[90] max-w-[min(280px,calc(100vw-1rem))] rounded-md border border-white/10 bg-graphite/90 px-2 py-1 text-[10px] font-semibold leading-tight text-white/80 shadow-md backdrop-blur transition-opacity duration-100 ${state.visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden={!state.visible}
      >
        {state.actor ? (
          <p className="truncate">{state.actor.name} · {formatAuditTime(state.actor.timestamp)}</p>
        ) : (
          <p>No history</p>
        )}
      </div>
    </AuditHoverContext.Provider>
  );
}

export function useAuditHover() {
  const context = useContext(AuditHoverContext);
  if (!context) throw new Error('useAuditHover must be used within AuditHoverProvider');
  return context;
}
