import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Code2, ExternalLink, HelpCircle, Table2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AIChatAction, AIChatClarification, AIChatResponse } from '../../types/api';

const CHART_COLORS = ['#4f46e5', '#0f766e', '#c2410c', '#9333ea', '#be123c'];

function formatValue(value: unknown): string | number {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (value === null || value === undefined) {
    return '-';
  }
  return String(value);
}

function ActionButtonsRenderer({ actions }: { actions: AIChatAction[] }) {
  const navigate = useNavigate();

  if (!actions || actions.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2.5">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">Quick Actions:</span>
      {actions.map((action, idx) => {
        const isPrimary = action.variant === 'primary' || !action.variant;
        const isSecondary = action.variant === 'secondary';

        const btnClass = isPrimary
          ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm hover:from-indigo-700 hover:to-indigo-800 hover:shadow-md'
          : isSecondary
          ? 'bg-amber-50 border border-amber-200 text-amber-900 hover:bg-amber-100'
          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300';

        return (
          <button
            key={`${action.url}-${idx}`}
            type="button"
            onClick={() => {
              if (action.type === 'external') {
                window.open(action.url, '_blank');
              } else {
                navigate(action.url);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all duration-200 transform active:scale-95 ${btnClass}`}
            title={action.description || action.label}
          >
            <span>{action.label}</span>
            {action.type === 'external' ? (
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function CardRenderer({ response }: { response: AIChatResponse }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {(response.cards || []).map((card, index) => (
        <div key={`${card.label}-${index}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
          <p className="mt-3 text-3xl font-extrabold text-graphite">{formatValue(card.value)}</p>
          {card.detail ? <p className="mt-2 text-base text-slate-600">{card.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

function TableRenderer({ response }: { response: AIChatResponse }) {
  const columns = response.columns || [];
  const rows = response.rows || [];

  if (!columns.length) {
    return <p className="rounded-2xl bg-slate-50 p-4 text-base text-slate-600">No table columns were returned.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-base">
          <thead className="bg-slate-100 text-sm uppercase tracking-[0.14em] text-slate-600">
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-5 py-4 font-extrabold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-slate-50">
                  {columns.map((column, columnIndex) => (
                    <td key={`${rowIndex}-${column}`} className="whitespace-nowrap px-5 py-4 font-semibold text-slate-800">
                      {formatValue(row[columnIndex])}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan={columns.length}>
                  No matching records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartRenderer({ response }: { response: AIChatResponse }) {
  const data = response.data || [];
  const xKey = response.x_key || 'name';
  const yKeys = response.y_keys?.length ? response.y_keys : ['amount'];

  if (!data.length) {
    return <p className="rounded-2xl bg-slate-50 p-4 text-base text-slate-600">No chart data matched your question.</p>;
  }

  if (response.chart_type === 'pie') {
    return (
      <div className="h-[min(22.5rem,70dvh)] min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={yKeys[0]} nameKey={xKey} outerRadius={120} label>
              {data.map((_, index) => (
                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const Chart = response.chart_type === 'line' ? LineChart : BarChart;
  return (
    <div className="h-[min(23.75rem,70dvh)] min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          {yKeys.map((key, index) =>
            response.chart_type === 'line' ? (
              <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={3} />
            ) : (
              <Bar key={key} dataKey={key} fill={CHART_COLORS[index % CHART_COLORS.length]} radius={[8, 8, 0, 0]} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

function ClarificationRenderer({
  clarification,
  onQuickReply,
}: {
  clarification: AIChatClarification;
  onQuickReply?: (answer: string) => void;
}) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-relaxed text-amber-950">{clarification.question}</p>
          {clarification.options.length ? (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {clarification.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onQuickReply?.(option)}
                  disabled={!onQuickReply}
                  className="rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-sm font-bold text-amber-900 shadow-xs transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          {clarification.allow_free_text === false ? null : (
            <p className="mt-3 text-xs font-semibold text-amber-800/80">
              Pick one above, or type your own answer below.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GeneratedSQL({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 transition hover:text-indigo-600"
      >
        <Code2 className="h-3.5 w-3.5" />
        {open ? 'Hide SQL' : 'View SQL'}
      </button>
      {open ? (
        <pre className="mt-2.5 overflow-x-auto rounded-2xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
          {sql}
        </pre>
      ) : null}
    </div>
  );
}

function ChartDataToggle({ response }: { response: AIChatResponse }) {
  const [open, setOpen] = useState(false);

  if (!response.columns?.length || !response.rows?.length) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 transition hover:text-indigo-600"
      >
        <Table2 className="h-3.5 w-3.5" />
        {open ? 'Hide data' : `View data (${response.rows.length} rows)`}
      </button>
      {open ? (
        <div className="mt-2.5">
          <TableRenderer response={response} />
        </div>
      ) : null}
    </div>
  );
}

export function AIResponseRenderer({
  response,
  onQuickReply,
}: {
  response: AIChatResponse;
  onQuickReply?: (answer: string) => void;
}) {
  const displayText = response.text || response.summary;

  return (
    <section className="space-y-4 rounded-[2rem] border border-slate-200 bg-white/90 p-5 shadow-sm">
      <div>
        <p className="font-display text-2xl font-bold text-graphite">{response.title}</p>
        {response.summary && response.type !== 'summary' && response.type !== 'text' ? (
          <p className="mt-2 text-base font-semibold text-slate-600">{response.summary}</p>
        ) : null}
      </div>

      {response.type === 'table' ? <TableRenderer response={response} /> : null}
      {response.type === 'chart' ? (
        <>
          <ChartRenderer response={response} />
          <ChartDataToggle response={response} />
        </>
      ) : null}
      {response.type === 'card' ? <CardRenderer response={response} /> : null}
      {response.type === 'clarification' && response.clarification ? (
        <ClarificationRenderer clarification={response.clarification} onQuickReply={onQuickReply} />
      ) : null}
      {response.type === 'summary' || response.type === 'text' ? (
        <div className="rounded-3xl bg-slate-50/80 p-5 text-base sm:text-lg font-medium leading-relaxed text-slate-800 whitespace-pre-line">
          {displayText || 'No additional text was returned.'}
        </div>
      ) : null}

      {response.actions?.length ? <ActionButtonsRenderer actions={response.actions} /> : null}
      {response.sql ? <GeneratedSQL sql={response.sql} /> : null}
    </section>
  );
}

