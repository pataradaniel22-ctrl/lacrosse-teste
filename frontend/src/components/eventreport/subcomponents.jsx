/* Event Report sub-components & small helpers (extracted from EventReport.js). */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';
import { Badge } from '../ui/badge';
import { ChartFrame, EmptyState, zoneHigh, zoneLow, fmt, maskName } from './primitives';

export const gridTick = { fill: '#64748b', fontSize: 10 };
export const gridStroke = 'rgba(100,116,139,0.15)';

export function shortDate(d) { return d ? d.slice(5) : d; }
export function inv(v) { return v === null || v === undefined ? null : Math.max(0, 10 - v); }
export function teamVals(teams, getter) {
  const o = {};
  teams.forEach((t) => { o[t.label] = getter(t); });
  return o;
}
export function mapNames(items, onClick) {
  return (items || []).map((it) => ({ ...it, onClick }));
}

export function HeaderStat({ label, value }) {
  return (
    <div className="bg-white/10 rounded-lg py-2">
      <p className="text-lg font-black leading-none">{value ?? '—'}</p>
      <p className="text-[10px] text-white/60 mt-1">{label}</p>
    </div>
  );
}

export function MiniStat({ label, value, zone = 'gray', wide }) {
  const border = { green: 'border-emerald-200', yellow: 'border-amber-200', orange: 'border-orange-200', red: 'border-red-200', gray: 'border-slate-200' }[zone];
  const text = { green: 'text-emerald-600', yellow: 'text-amber-600', orange: 'text-orange-600', red: 'text-red-600', gray: 'text-slate-600' }[zone];
  return (
    <div className={`rounded-lg border ${border} bg-white p-2 ${wide ? 'col-span-1' : ''}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-bold ${text} truncate`}>{value}</p>
    </div>
  );
}

export const COMPARE_ROWS = [
  { key: 'athletes', label: 'Athletes', better: 'none' },
  { key: 'adherence', label: 'Adherence', unit: '%', better: 'high' },
  { key: 'readiness', label: 'Readiness', unit: '/10', better: 'high' },
  { key: 'sleep', label: 'Sleep', unit: '/10', better: 'high' },
  { key: 'fatigue', label: 'Fatigue', unit: '/10', better: 'low' },
  { key: 'stress', label: 'Stress', unit: '/10', better: 'low' },
  { key: 'soreness', label: 'Soreness', unit: '/10', better: 'low' },
  { key: 'recovery', label: 'Recovery', unit: 'pts', better: 'high' },
  { key: 'total_load', label: 'Total load', unit: 'AU', better: 'none' },
  { key: 'avg_pain', label: 'Avg pain', unit: '/10', better: 'low' },
  { key: 'pain_prevalence', label: 'Pain prevalence', unit: '%', better: 'low' },
  { key: 'alerts_red', label: 'Red alerts', better: 'low' },
];

export function CompareRow({ row, all, teams }) {
  const a = teams[0]?.[row.key];
  const b = teams[1]?.[row.key];
  let interp = 'Insufficient data for comparison.';
  if (a != null && b != null) {
    const diff = a - b;
    if (Math.abs(diff) < 0.001) interp = 'Practically identical between teams.';
    else {
      const hi = diff > 0 ? teams[0].label : teams[1].label;
      const pct = b !== 0 ? Math.abs(Math.round((diff / b) * 100)) : null;
      interp = `${hi} higher${pct != null ? ` by ~${pct}%` : ''}.`;
      if (pct != null && pct < 5) interp = 'Small difference, likely no practical relevance.';
    }
  }
  return (
    <tr className="border-b border-slate-100">
      <td className="py-1.5 font-medium text-slate-600">{row.label}</td>
      <td className="tabular-nums">{fmt(all[row.key], row.unit || '')}</td>
      {teams.map((t) => <td key={t.value} className="tabular-nums">{fmt(t[row.key], row.unit || '')}</td>)}
      <td className="text-slate-500">{interp}</td>
    </tr>
  );
}

export function ProfileList({ title, items, color }) {
  return (
    <div>
      <p className={`font-semibold ${color}`}>{title}</p>
      <ul className="list-disc pl-4 text-slate-600 mt-0.5 space-y-0.5">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

export function RecBlock({ title, items }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <p className="font-bold text-slate-800 mb-1.5">{title}</p>
      <ul className="list-disc pl-4 text-slate-600 space-y-1">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

const BODY_POINTS = {
  Neck: { x: 60, y: 44 },
  Shoulder: { x: 84, y: 62 },
  Elbow: { x: 92, y: 102 },
  WristHand: { x: 98, y: 138 },
  LowBack: { x: 60, y: 110 },
  HipGroin: { x: 60, y: 146 },
  Knee: { x: 50, y: 196 },
  AnkleFoot: { x: 48, y: 242 },
  Other: { x: 28, y: 30 },
  Unspecified: { x: 28, y: 30 },
};

export function BodyMap({ regions }) {
  const max = Math.max(1, ...regions.map((r) => r.count));
  const colorOf = (avg) => (avg == null ? '#94a3b8' : avg >= 7 ? '#ef4444' : avg >= 4 ? '#f59e0b' : '#10b981');
  return (
    <div className="er-chart break-inside-avoid">
      <p className="text-sm font-semibold text-slate-700 mb-1">Pain body map</p>
      {regions.length === 0 ? <EmptyState label="No pain reported in this period" /> : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 120 270" className="h-64 flex-shrink-0" data-testid="pain-body-map">
            <g fill="#e2e8f0">
              <circle cx="60" cy="26" r="14" />
              <rect x="44" y="42" width="32" height="72" rx="12" />
              <rect x="30" y="48" width="10" height="82" rx="5" />
              <rect x="80" y="48" width="10" height="82" rx="5" />
              <rect x="47" y="112" width="11" height="122" rx="5" />
              <rect x="62" y="112" width="11" height="122" rx="5" />
            </g>
            {regions.map((r) => {
              const pt = BODY_POINTS[r.region] || { x: 28, y: 30 };
              const rad = 5 + 9 * (r.count / max);
              const col = colorOf(r.avg);
              return (
                <g key={r.region}>
                  <circle cx={pt.x} cy={pt.y} r={rad} fill={col} fillOpacity="0.8" stroke={col} strokeWidth="1" />
                  <text x={pt.x} y={pt.y + 3} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="bold">{r.count}</text>
                </g>
              );
            })}
          </svg>
          <div className="flex-1 space-y-1">
            {regions.slice(0, 9).map((r) => (
              <div key={r.region} className="flex items-center justify-between text-xs gap-2">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(r.avg) }} />
                  {r.label}
                </span>
                <span className="text-slate-500 tabular-nums">{r.count} reports · avg {r.avg ?? '—'}/10 · {r.athletes} ath.</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-1">Marker size = report volume · color = average intensity (green→amber→red). Reported symptoms, not a diagnosis.</p>
    </div>
  );
}

export function IndividualReport({ a, anonymize }) {
  return (
    <div className="space-y-4" data-testid="individual-report">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">{anonymize ? maskName(a.name) : a.name}</p>
          <p className="text-xs text-slate-500">{a.team}{a.position ? ` · ${a.position}` : ''}</p>
        </div>
        <Badge variant="outline">{a.days_monitored} days · {fmt(a.compliance, '%')} compliance</Badge>
      </div>
      <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{a.summary}</p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <MiniStat label="Readiness" value={fmt(a.readiness, '/10')} zone={zoneHigh(a.readiness)} />
        <MiniStat label="Sleep" value={fmt(a.sleep, '/10')} zone={zoneHigh(a.sleep)} />
        <MiniStat label="Fatigue" value={fmt(a.fatigue, '/10')} zone={zoneLow(a.fatigue)} />
        <MiniStat label="Stress" value={fmt(a.stress, '/10')} zone={zoneLow(a.stress)} />
        <MiniStat label="Recovery" value={fmt(a.recovery, ' pts')} zone="gray" />
        <MiniStat label="Load" value={fmt(a.total_load, ' AU')} zone="gray" />
        <MiniStat label="Pain reports" value={a.pain_reports} zone={a.pain_reports ? 'yellow' : 'green'} />
        <MiniStat label="Pain days" value={a.pain_days} zone={a.pain_days >= 2 ? 'yellow' : 'green'} />
        <MiniStat label="Max pain" value={fmt(a.max_pain, '/10')} zone={zoneLow(a.max_pain, 3, 6)} />
      </div>
      {a.readiness_series && a.readiness_series.length > 0 && (
        <ChartFrame title="Readiness evolution" unit="0-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.readiness_series}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
              <YAxis domain={[0, 10]} tick={gridTick} />
              <RTooltip />
              <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} connectNulls dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
      {a.pain_regions && Object.keys(a.pain_regions).length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-700 mb-1">Reported pain regions</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(a.pain_regions).map(([r, c]) => <Badge key={r} variant="outline" className="text-[11px]">{r} · {c}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
}
