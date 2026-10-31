/* Reusable presentational primitives for the Event Report page. */
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// Color a 0-10 wellness value: higher is better (readiness/sleep/disposition)
export function zoneHigh(v, good = 6.5, warn = 5) {
  if (v === null || v === undefined) return 'gray';
  if (v >= good) return 'green';
  if (v > warn) return 'yellow';
  return 'red';
}
// Color a 0-10 value where lower is better (fatigue/stress/soreness/pain)
export function zoneLow(v, good = 4, warn = 6) {
  if (v === null || v === undefined) return 'gray';
  if (v <= good) return 'green';
  if (v <= warn) return 'yellow';
  return 'red';
}
// Percentage adherence/availability
export function zonePct(v, good = 80, warn = 60) {
  if (v === null || v === undefined) return 'gray';
  if (v >= good) return 'green';
  if (v >= warn) return 'yellow';
  return 'red';
}

const ZONE_TEXT = {
  green: 'text-emerald-600',
  yellow: 'text-amber-600',
  orange: 'text-orange-600',
  red: 'text-red-600',
  gray: 'text-slate-400',
};
const ZONE_DOT = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  gray: 'bg-slate-300',
};

export const fmt = (v, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`);

export function KPICard({ label, value, unit = '', zone = 'gray', sub, testid }) {
  const insufficient = value === null || value === undefined;
  return (
    <Card className="er-kpi border-slate-200 bg-white" data-testid={testid}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${ZONE_DOT[zone]}`} />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        </div>
        <p className={`mt-2 text-3xl font-black ${insufficient ? 'text-slate-300' : ZONE_TEXT[zone]}`}>
          {insufficient ? 'N/A' : value}
          {!insufficient && unit && <span className="text-base font-semibold text-slate-400 ml-1">{unit}</span>}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{insufficient ? 'Insufficient data' : sub}</p>
      </CardContent>
    </Card>
  );
}

export function SectionCard({ id, title, subtitle, children, right }) {
  return (
    <section id={id} className="er-section break-inside-avoid">
      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold text-slate-800">{title}</CardTitle>
              {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
            {right}
          </div>
        </CardHeader>
        <CardContent className="pt-0">{children}</CardContent>
      </Card>
    </section>
  );
}

export function EmptyState({ label = 'Insufficient data for this period' }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
      {label}
    </div>
  );
}

export function ChartFrame({ title, unit, note, children, empty }) {
  return (
    <div className="er-chart break-inside-avoid">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </div>
      {empty ? <EmptyState /> : <div className="h-56">{children}</div>}
      {note && !empty && <p className="text-[11px] text-slate-400 mt-1">{note}</p>}
    </div>
  );
}

const PRIORITY_STYLE = {
  high: 'bg-red-50 border-red-200 text-red-700',
  moderate: 'bg-amber-50 border-amber-200 text-amber-700',
  low: 'bg-emerald-50 border-emerald-200 text-emerald-700',
};

export function InsightCard({ insight, anonymize }) {
  const p = insight.priority || 'low';
  return (
    <div className={`er-insight break-inside-avoid rounded-lg border p-3 ${PRIORITY_STYLE[p]}`} data-testid="insight-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{insight.title}</p>
        <Badge variant="outline" className="text-[10px] capitalize border-current">{p}</Badge>
      </div>
      <p className="text-xs mt-1 text-slate-600">{insight.text}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-500">
        <span className="font-medium">📊 {insight.metric}</span>
        <span className="opacity-70">· {insight.category}</span>
      </div>
      {insight.action && <p className="text-[11px] mt-1 text-slate-600"><span className="font-semibold">Action:</span> {insight.action}</p>}
    </div>
  );
}

export function ConfidenceBadge({ level }) {
  const map = {
    high: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    moderate: 'bg-amber-100 text-amber-700 border-amber-300',
    low: 'bg-red-100 text-red-700 border-red-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${map[level] || map.low}`}>
      Confidence: {level ? level[0].toUpperCase() + level.slice(1) : '—'}
    </span>
  );
}

export function RankList({ title, items, unit = '', tone = 'positive', anonymize, testid }) {
  const toneBar = tone === 'attention' ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="er-rank break-inside-avoid" data-testid={testid}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-1.5 h-4 rounded-full ${toneBar}`} />
        <p className="text-xs font-bold text-slate-700">{title}</p>
      </div>
      {(!items || items.length === 0) ? (
        <EmptyState label="No data" />
      ) : (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <li key={it.id || i}
              className={`flex items-center justify-between text-xs px-2 py-1 rounded bg-slate-50 ${it.onClick ? 'cursor-pointer hover:bg-slate-100' : ''}`}
              onClick={it.onClick ? () => it.onClick(it.id) : undefined}>
              <span className="truncate text-slate-700">
                <span className="text-slate-400 mr-1.5">{i + 1}.</span>
                {anonymize ? maskName(it.name) : it.name}
                {it.team && <span className="text-slate-400 ml-1">· {it.team}</span>}
              </span>
              <span className="font-bold text-slate-700 tabular-nums ml-2">{fmt(it.value, unit)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function maskName(name) {
  if (!name) return '—';
  return name.split(' ').map((p) => (p ? p[0].toUpperCase() + '.' : '')).join(' ');
}
