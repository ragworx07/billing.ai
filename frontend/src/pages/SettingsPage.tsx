import {
  Accessibility,
  Check,
  Contrast,
  Database,
  Minus,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sun,
  Type,
  ZoomIn,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AppUpdateSection } from '../components/AppUpdateSection';
import { BackupSettingsSection } from '../components/BackupSettingsSection';
import { SectionCard } from '../components/SectionCard';
import { useAppearance } from '../contexts/AppearanceContext';
import {
  accentOptions,
  cornerOptions,
  densityOptions,
  fontFamilyOptions,
  fontSizeOptions,
  themeOptions,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from '../utils/appearance';

type TabId = 'appearance' | 'typography' | 'display' | 'accessibility' | 'backup' | 'updates';

const tabs: Array<{ id: TabId; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'display', label: 'Display', icon: Monitor },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { id: 'backup', label: 'Data & Backup', icon: Database },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
];

const zoomPresets = [75, 90, 100, 110, 125, 150];

function OptionCard({
  selected,
  onClick,
  title,
  description,
  icon,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition ${
        selected
          ? 'border-clay bg-clay/10 ring-2 ring-clay/30'
          : 'border-steel/60 bg-[var(--panel-bg)] hover:border-clay/50 hover:bg-clay/5'
      }`}
    >
      {children}
      <span className="flex w-full items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-bold text-graphite">
          {icon}
          {title}
        </span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-clay" /> : null}
      </span>
      {description ? <span className="text-sm font-semibold text-slate">{description}</span> : null}
    </button>
  );
}

function ToggleRow({
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  icon: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-steel/60 p-4 text-left transition hover:border-clay/50"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-clay">{icon}</span>
        <span className="min-w-0">
          <span className="block font-bold text-graphite">{label}</span>
          <span className="block text-sm font-semibold text-slate">{description}</span>
        </span>
      </span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-clay' : 'bg-steel/50'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

function ThemeSwatch({ swatch }: { swatch: { bg: string; panel: string; accent: string; ink: string } }) {
  return (
    <span
      className="flex h-16 w-full overflow-hidden rounded-xl border border-steel/40"
      style={{ background: swatch.bg }}
      aria-hidden
    >
      <span className="h-full w-1/4" style={{ background: swatch.panel }} />
      <span className="flex flex-1 flex-col justify-center gap-1.5 px-2">
        <span className="block h-1.5 w-3/4 rounded-full" style={{ background: swatch.ink, opacity: 0.75 }} />
        <span className="block h-1.5 w-1/2 rounded-full" style={{ background: swatch.ink, opacity: 0.35 }} />
        <span className="block h-2.5 w-2/5 rounded-full" style={{ background: swatch.accent }} />
      </span>
    </span>
  );
}

export function SettingsPage() {
  const { appearance, setPreference, stepZoom, resetAppearance, isDefault } = useAppearance();
  const [activeTab, setActiveTab] = useState<TabId>('appearance');

  const lightThemes = themeOptions.filter((option) => option.mode === 'light');
  const darkThemes = themeOptions.filter((option) => option.mode === 'dark');

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate">Application</p>
          <h1 className="mt-1 font-display text-3xl text-graphite">Settings</h1>
        </div>
        <button
          type="button"
          onClick={resetAppearance}
          disabled={isDefault}
          className="inline-flex items-center gap-2 rounded-xl border border-steel px-4 py-2 text-sm font-bold text-graphite transition hover:border-clay hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </button>
      </div>

      <div className="flex min-w-0 flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                active
                  ? 'bg-clay text-[color:var(--on-accent)]'
                  : 'border border-steel/60 text-slate hover:border-clay/50 hover:text-clay'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'appearance' ? (
        <>
          <SectionCard title="Theme">
            <div className="space-y-5">
              <div>
                <p className="mb-2.5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate">
                  <Sun className="h-3.5 w-3.5" />
                  Light
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {lightThemes.map((option) => (
                    <OptionCard
                      key={option.value}
                      selected={appearance.theme === option.value}
                      onClick={() => setPreference('theme', option.value)}
                      title={option.label}
                      description={option.description}
                    >
                      <ThemeSwatch swatch={option.swatch} />
                    </OptionCard>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2.5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate">
                  <Moon className="h-3.5 w-3.5" />
                  Dark
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {darkThemes.map((option) => (
                    <OptionCard
                      key={option.value}
                      selected={appearance.theme === option.value}
                      onClick={() => setPreference('theme', option.value)}
                      title={option.label}
                      description={option.description}
                    >
                      <ThemeSwatch swatch={option.swatch} />
                    </OptionCard>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Accent Colour">
            <p className="mb-3 text-sm font-semibold text-slate">
              Highlights buttons, links and selected rows across every page.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {accentOptions.map((option) => {
                const selected = appearance.accent === option.value;
                const isThemeDefault = option.value === 'theme';
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPreference('accent', option.value)}
                    aria-pressed={selected}
                    title={option.label}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold transition ${
                      selected ? 'border-clay text-graphite ring-2 ring-clay/30' : 'border-steel/60 text-slate hover:border-clay/50'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full border border-black/10 ${isThemeDefault ? 'bg-clay' : ''}`}
                      style={isThemeDefault ? undefined : { background: option.swatch }}
                    />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Corner Style">
            <div className="grid gap-3 sm:grid-cols-3">
              {cornerOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  selected={appearance.corners === option.value}
                  onClick={() => setPreference('corners', option.value)}
                  title={option.label}
                  description={option.description}
                />
              ))}
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeTab === 'typography' ? (
        <>
          <SectionCard title="Font Style">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {fontFamilyOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  selected={appearance.fontFamily === option.value}
                  onClick={() => setPreference('fontFamily', option.value)}
                  title={option.label}
                  description={option.description}
                >
                  <span
                    className="block w-full truncate text-2xl text-graphite"
                    style={{ fontFamily: option.preview }}
                    aria-hidden
                  >
                    Ag 123
                  </span>
                </OptionCard>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Font Size">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {fontSizeOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  selected={appearance.fontSize === option.value}
                  onClick={() => setPreference('fontSize', option.value)}
                  title={option.label}
                  description={option.description}
                  icon={<Type className="h-4 w-4" />}
                />
              ))}
            </div>
          </SectionCard>
        </>
      ) : null}

      {activeTab === 'display' ? (
        <>
          <SectionCard title="Page Zoom">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="inline-flex items-center gap-1 rounded-2xl border border-steel/60 p-1">
                  <button
                    type="button"
                    onClick={() => stepZoom(-1)}
                    disabled={appearance.zoom <= ZOOM_MIN}
                    aria-label="Zoom out"
                    className="rounded-xl p-2 text-graphite transition hover:bg-clay/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4.5rem] text-center font-display text-2xl text-graphite">
                    {appearance.zoom}%
                  </span>
                  <button
                    type="button"
                    onClick={() => stepZoom(1)}
                    disabled={appearance.zoom >= ZOOM_MAX}
                    aria-label="Zoom in"
                    className="rounded-xl p-2 text-graphite transition hover:bg-clay/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {zoomPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setPreference('zoom', preset)}
                      className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${
                        appearance.zoom === preset
                          ? 'bg-clay text-[color:var(--on-accent)]'
                          : 'border border-steel/60 text-slate hover:border-clay/50 hover:text-clay'
                      }`}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-slate">
                  <ZoomIn className="h-4 w-4" />
                  Drag to fine tune ({ZOOM_MIN}% – {ZOOM_MAX}%)
                </span>
                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={ZOOM_STEP}
                  value={appearance.zoom}
                  onChange={(event) => setPreference('zoom', Number(event.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full border-0 bg-steel/40 p-0 accent-clay"
                />
              </label>

              <p className="text-sm font-semibold text-slate">
                Zoom scales the whole interface, including spacing and controls. It stacks on top of
                the font size you pick under Typography.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Spacing Density">
            <div className="grid gap-3 sm:grid-cols-3">
              {densityOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  selected={appearance.density === option.value}
                  onClick={() => setPreference('density', option.value)}
                  title={option.label}
                  description={option.description}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Navigation">
            <ToggleRow
              label="Start with the sidebar collapsed"
              description="Keeps the menu as icons only until you hover it. Matches the Lock and Unlock buttons in the sidebar."
              icon={<PanelLeft className="h-5 w-5" />}
              checked={appearance.sidebarCollapsed}
              onChange={(value) => setPreference('sidebarCollapsed', value)}
            />
          </SectionCard>
        </>
      ) : null}

      {activeTab === 'accessibility' ? (
        <SectionCard title="Accessibility">
          <div className="space-y-3">
            <ToggleRow
              label="Reduce motion"
              description="Turns off page animations, loaders and slide-in transitions."
              icon={<Sparkles className="h-5 w-5" />}
              checked={appearance.reduceMotion}
              onChange={(value) => setPreference('reduceMotion', value)}
            />
            <ToggleRow
              label="High contrast"
              description="Darkens secondary text and thickens field borders for better legibility."
              icon={<Contrast className="h-5 w-5" />}
              checked={appearance.highContrast}
              onChange={(value) => setPreference('highContrast', value)}
            />
          </div>
        </SectionCard>
      ) : null}

      {activeTab === 'backup' ? <BackupSettingsSection /> : null}

      {activeTab === 'updates' ? <AppUpdateSection /> : null}

      {activeTab !== 'backup' && activeTab !== 'updates' ? (
        <SectionCard title="Preview">
        <div className="space-y-4">
          <div>
            <h3 className="font-display text-2xl text-graphite">Site expenses summary</h3>
            <p className="mt-1 text-base font-semibold text-slate">
              Cards, tables, badges and fields all follow the theme you picked above.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Received</p>
              <p className="mt-1 font-display text-xl text-emerald-900">₹ 12,40,000</p>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3">
              <p className="text-xs font-black uppercase tracking-wider text-rose-700">Outstanding</p>
              <p className="mt-1 font-display text-xl text-rose-900">₹ 3,15,000</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs font-black uppercase tracking-wider text-amber-700">Pending</p>
              <p className="mt-1 font-display text-xl text-amber-900">₹ 87,500</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full min-w-[24rem] text-left">
              <thead className="bg-mist">
                <tr>
                  <th className="px-3 py-2 text-xs font-black uppercase tracking-wider text-slate">Project</th>
                  <th className="px-3 py-2 text-xs font-black uppercase tracking-wider text-slate">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-slate">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {[
                  { project: 'Lakeview Villa', status: 'Approved', tone: 'bg-emerald-50 text-emerald-800', amount: '₹ 2,45,000' },
                  { project: 'Anna Nagar Duplex', status: 'Pending', tone: 'bg-amber-50 text-amber-800', amount: '₹ 87,500' },
                ].map((row) => (
                  <tr key={row.project} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-bold text-graphite">{row.project}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${row.tone}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-graphite">{row.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-xl bg-clay px-4 py-2 text-sm font-bold text-[color:var(--on-accent)]"
            >
              Primary action
            </button>
            <button
              type="button"
              className="rounded-xl border border-steel px-4 py-2 text-sm font-bold text-graphite"
            >
              Secondary
            </button>
            <div className="min-w-[12rem] flex-1">
              <input type="text" defaultValue="Sample input field" aria-label="Preview input" />
            </div>
          </div>
        </div>
      </SectionCard>
      ) : null}
    </div>
  );
}
