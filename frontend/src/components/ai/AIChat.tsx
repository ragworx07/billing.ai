import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Building2, ChevronRight, RefreshCw, Send, Sparkles, Trash2, User as UserIcon } from 'lucide-react';

import { api } from '../../services/api';
import type { AIChatHealthResponse, AIChatResponse, ChatMessage as ApiChatMessage } from '../../types/api';
import { AIResponseRenderer } from './AIResponseRenderer';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: AIChatResponse;
};

const STORAGE_KEY = 'billing_erp_ai_search_history';

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

const CATEGORIZED_PROMPTS = [
  {
    category: 'Charts & Trends',
    icon: '📊',
    prompts: [
      'Chart total material spend per project',
      'Graph monthly labour cost for this year',
      'Top 5 materials by spend as a pie chart',
    ],
  },
  {
    category: 'Money & Vendors',
    icon: '💰',
    prompts: [
      'Compare total cost against collections for every project',
      'Which vendor payments are pending?',
      'Show outstanding balance per shareholder',
    ],
  },
  {
    category: 'Navigation & Logging',
    icon: '🧭',
    prompts: ['Where should I enter project materials?', 'How do I log worker labour and wages?'],
  },
];

export function AIChat() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const [health, setHealth] = useState<AIChatHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .getAISamplePrompts()
      .then((response) => setSamplePrompts(response.sample_prompts))
      .catch(() => setSamplePrompts([]));
    void refreshHealth();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function sendQuestion(nextQuestion?: string) {
    const finalQuestion = (nextQuestion ?? question).trim();
    if (!finalQuestion || isLoading) return;

    setQuestion('');
    setError('');
    setIsLoading(true);

    const newHistoryMessages = [...messages, { id: createId(), role: 'user' as const, content: finalQuestion }];
    setMessages(newHistoryMessages);

    try {
      const apiHistory: ApiChatMessage[] = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const lastMessage = messages[messages.length - 1];
      const pendingClarification =
        lastMessage?.role === 'assistant' ? lastMessage.response?.clarification ?? null : null;

      const response = await api.askAI(finalQuestion, apiHistory, pendingClarification);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: response.text || response.summary || response.title,
          response,
        },
      ]);
      if (response.sample_prompts?.length) {
        setSamplePrompts(response.sample_prompts);
      }
    } catch {
      setError('AI Assistant could not process that query. Please check your connection or try a more specific question.');
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: 'I could not complete that request safely. Please try asking with a project name or selecting one of the suggested prompts.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendQuestion();
  }

  async function refreshHealth() {
    setHealthLoading(true);
    try {
      const response = await api.getAIHealth();
      setHealth(response);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }

  const internetOk = isOnline;
  const groqOk = Boolean(health?.groq_configured && health?.checks.some((check) => check.name === 'ai_service' && check.ok));
  const dbOk = Boolean(health?.checks.some((check) => check.name === 'database_read' && check.ok));
  const sqlGuardOk = Boolean(health?.checks.some((check) => check.name === 'sql_guard' && check.ok));

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-5">
      {/* Header Banner */}
      <header className="rounded-[2rem] border border-white/70 bg-gradient-to-r from-white via-indigo-50/40 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1 text-xs font-black uppercase tracking-wider text-white shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                Billing ERP · AI Assistant
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                Live On-Demand
              </span>
            </div>
            <h1 className="mt-2.5 font-display text-3xl sm:text-4xl font-extrabold text-graphite">
              Smart ERP & Financial Intelligence
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm sm:text-base font-medium text-slate-600">
              Instant natural-language queries across ledgers, vouchers, receivables, stock items, and P&L financial reports.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMessages([])}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Trash2 className="h-4 w-4 text-slate-400" />
              Clear Conversation
            </button>
          </div>
        </div>
      </header>

      {/* Main Chat Layout */}
      <div className="grid min-w-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,21rem)]">
        
        {/* Chat Stream & Input Area */}
        <section className="flex min-h-[min(580px,calc(100dvh-12rem))] min-w-0 flex-col rounded-[2rem] border border-white/70 bg-white/80 shadow-sm backdrop-blur-md">
          
          {/* Messages Scroll Area */}
          <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
            {messages.length ? (
              messages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  {message.role === 'user' ? (
                    <div className="flex items-start gap-3 max-w-2xl">
                      <div className="rounded-3xl bg-slate-900 px-5 py-3.5 text-white shadow-md">
                        <p className="text-sm sm:text-base font-semibold leading-relaxed">{message.content}</p>
                      </div>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold text-xs">
                        <UserIcon className="h-4 w-4" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 w-full max-w-5xl">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm font-bold text-xs">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {message.response ? (
                          <AIResponseRenderer
                            response={message.response}
                            onQuickReply={(answer) => void sendQuestion(answer)}
                          />
                        ) : (
                          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-base font-medium leading-relaxed text-slate-800 shadow-sm whitespace-pre-line">
                            {message.content}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              /* Welcome Greeting & Discovery Cards */
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-50 via-indigo-100 to-purple-50 shadow-inner border border-indigo-200/60">
                  <Bot className="h-10 w-10 text-indigo-600 animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white shadow-sm">
                    <Sparkles className="h-3 w-3" />
                  </span>
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-graphite">
                  How can I help you today?
                </h2>
                <p className="mt-2 max-w-xl text-sm sm:text-base font-medium text-slate-500 leading-relaxed">
                  Ask anything about your data and I will write the query, chart the answer, and ask you for
                  any missing detail one step at a time.
                </p>

                {/* Discovery Grid */}
                <div className="mt-8 grid gap-3 sm:grid-cols-3 max-w-3xl w-full text-left">
                  {[
                    {
                      icon: '📈',
                      title: 'Charts On Demand',
                      prompt: 'Chart total material spend per project',
                    },
                    {
                      icon: '💰',
                      title: 'Money Questions',
                      prompt: 'Compare total cost against collections for every project',
                    },
                    {
                      icon: '🧭',
                      title: 'Direct Navigation',
                      prompt: 'Where should I enter project materials?',
                    },
                  ].map((card) => (
                    <div
                      key={card.title}
                      onClick={() => void sendQuestion(card.prompt)}
                      className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition-all hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5"
                    >
                      <span className="text-xl mb-2 block">{card.icon}</span>
                      <p className="text-sm font-bold text-slate-800">{card.title}</p>
                      <p className="mt-1 text-xs text-slate-500">"{card.prompt}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aesthetic On-Demand AI Processing State */}
            {isLoading ? (
              <div className="flex items-start gap-3 w-full max-w-xl animate-in fade-in duration-200">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm font-bold text-xs">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex-1 rounded-3xl border border-indigo-100 bg-white/95 p-5 shadow-lg backdrop-blur-xl">
                  <div className="flex items-center gap-3.5">
                    {/* Glowing spinner badge */}
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-600 border-r-indigo-400 animate-spin" />
                      <div
                        className="absolute inset-1 rounded-full border-2 border-transparent border-b-amber-500 border-l-purple-500 animate-spin"
                        style={{ animationDirection: 'reverse', animationDuration: '1.2s' }}
                      />
                      <Sparkles className="h-4 w-4 text-indigo-600 animate-pulse" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">
                        AI is analyzing your request...
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        Writing a read-only SQL query and preparing the chart
                      </p>
                    </div>
                  </div>

                  {/* Pulsing gradient shimmer bar */}
                  <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full w-full bg-gradient-to-r from-indigo-600 via-purple-500 to-amber-500 animate-pulse" />
                  </div>
                </div>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>

          {error ? <p className="mx-5 mb-3 rounded-2xl bg-red-50 px-4 py-3 text-xs sm:text-sm font-bold text-red-700">{error}</p> : null}

          {/* Chat Input Bar */}
          <form onSubmit={handleSubmit} className="border-t border-slate-100 p-4 sm:p-5 bg-slate-50/50 rounded-b-[2rem]">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask anything... (e.g. 'Where should I enter project materials?')"
                className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm sm:text-base font-medium shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !question.trim()}
                className="inline-flex min-w-32 shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-3.5 text-sm sm:text-base font-extrabold text-white shadow-md shadow-indigo-600/20 transition-all hover:from-indigo-700 hover:to-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Ask AI</span>
                    <Send className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Sidebar: Service Status & Prompt Suggestions */}
        <aside className="flex flex-col gap-5">
          {/* Health & Engine Status Card */}
          <div className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-400">Status</p>
                <p className="text-base font-extrabold text-graphite">AI Engine Health</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshHealth()}
                className="rounded-xl bg-slate-50 p-2 text-slate-600 shadow-xs hover:bg-indigo-50 hover:text-indigo-600 transition"
                title="Refresh health check"
              >
                <RefreshCw className={`h-4 w-4 ${healthLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="mt-3.5 space-y-2">
              {[
                { label: 'Internet', ok: internetOk, okText: 'Online', badText: 'Offline' },
                { label: 'Database Connection', ok: dbOk, okText: 'Live', badText: 'Unavailable' },
                { label: 'SQL Analyst Engine', ok: sqlGuardOk, okText: 'Guarded', badText: 'Unavailable' },
                { label: 'Groq LLM Service', ok: groqOk, okText: 'Ready', badText: 'Fallback mode' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-xl bg-slate-50/80 px-3 py-2 text-xs font-bold text-slate-700"
                >
                  <span>{item.label}</span>
                  <span
                    className={`flex items-center gap-1.5 font-extrabold ${item.ok ? 'text-emerald-700' : 'text-amber-700'}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${item.ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {item.ok ? item.okText : item.badText}
                  </span>
                </div>
              ))}
              {health?.model ? (
                <p className="px-3 pt-1 text-[11px] font-semibold text-slate-400">Model: {health.model}</p>
              ) : null}
            </div>
          </div>

          {/* Categorized Prompt Suggestions */}
          <div className="flex-1 rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-sm space-y-5">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">Quick Prompts</p>
              <h3 className="text-lg font-extrabold text-graphite">Suggested Questions</h3>
            </div>

            {CATEGORIZED_PROMPTS.map((cat, idx) => (
              <div key={idx} className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
                  <span>{cat.icon}</span>
                  {cat.category}
                </p>
                <div className="space-y-1.5">
                  {cat.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendQuestion(prompt)}
                      className="w-full text-left rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/80 hover:text-indigo-900 flex items-center justify-between group"
                    >
                      <span className="line-clamp-1">{prompt}</span>
                      <ChevronRight className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

