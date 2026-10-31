import { useMemo, useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, ReferenceLine, ReferenceArea,
} from 'recharts';
import { AlertTriangle, TrendingDown, Zap } from 'lucide-react';

// Design + highlight-intelligence enhancement of the main readiness chart.
// NO data/calculation changes — everything below is derived from the values already sent.
//   • at risk      -> latest value < threshold (5)
//   • sharp drop   -> latest step change <= SHARP_DROP (big drop between two check-ins)
//   • trending down-> progressive decline (still not at risk)
// Critical athletes (at risk / sharp drop) are thick, opaque and drawn on top; the rest
// are thin, faded and differentiated by dash pattern. Hovering any line shows its value.

const SHARP_DROP = -1.5;          // step change flagged as a sharp drop

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'atrisk', label: 'At Risk' },
  { key: 'sharpdrop', label: 'Sharp Drop' },
  { key: 'trending', label: 'Trending Down' },
  { key: 'women', label: 'Women' },
  { key: 'men', label: 'Men' },
];

export const ReadinessByAthleteChart = ({
  data = [],
  athletes = [],
  colors = [],
  threshold = 5,
  nameToTeam = {},
  onAthleteClick,
}) => {
  const [filter, setFilter] = useState('all');

  // Recharts v3 ResponsiveContainer can lock onto a stale half width on the first
  // paint (leaving a big empty gap on the right of the plot). Remount it once after
  // mount + nudge a resize so it re-measures to the full card width.
  const [rcKey, setRcKey] = useState(0);
  useEffect(() => {
    const fire = () => window.dispatchEvent(new Event('resize'));
    const t0 = setTimeout(() => { setRcKey((k) => k + 1); fire(); }, 80);
    const t1 = setTimeout(fire, 300);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, []);

  const colorFor = (name) => colors[Math.max(0, athletes.indexOf(name)) % (colors.length || 1)];

  // Per-athlete ordered non-null sequence + per-date delta (vs previous check-in)
  const meta = useMemo(() => {
    const m = {};
    athletes.forEach((name) => {
      const seq = [];
      data.forEach((d, i) => {
        const v = d?.[name];
        if (v !== null && v !== undefined) seq.push({ date: d.date, value: v, i });
      });
      const byDate = {};
      seq.forEach((p, idx) => {
        byDate[p.date] = { value: p.value, delta: idx > 0 ? +(p.value - seq[idx - 1].value).toFixed(1) : null };
      });
      m[name] = { seq, byDate, lastIndex: seq.length ? seq[seq.length - 1].i : -1 };
    });
    return m;
  }, [data, athletes]);

  // Classification (at risk / sharp drop / trending) from the latest values only — no calc change
  const cls = useMemo(() => {
    const c = {};
    athletes.forEach((name) => {
      const seq = meta[name].seq;
      if (!seq.length) { c[name] = { status: 'none' }; return; }
      const last = seq[seq.length - 1].value;
      const delta = seq.length > 1 ? +(last - seq[seq.length - 2].value).toFixed(1) : null;
      const atRisk = last < threshold;
      const sharpDrop = delta !== null && delta <= SHARP_DROP;
      let trending = false;
      if (!atRisk && !sharpDrop) {
        if (seq.length >= 3 && seq[seq.length - 1].value < seq[seq.length - 2].value && seq[seq.length - 2].value < seq[seq.length - 3].value) trending = true;
        else if (last < 6 && delta !== null && delta < 0) trending = true; // left the safe zone, approaching risk
      }
      let status = 'normal';
      if (atRisk) status = 'atrisk'; else if (sharpDrop) status = 'sharpdrop'; else if (trending) status = 'attention';
      c[name] = { atRisk, sharpDrop, trending, status, lastValue: last, delta };
    });
    return c;
  }, [athletes, meta, threshold]);

  const teamOf = (name) => nameToTeam[name] || '';
  const isWomen = (name) => /women/i.test(teamOf(name));
  const isMen = (name) => /men/i.test(teamOf(name)) && !isWomen(name);

  const counts = useMemo(() => ({
    all: athletes.length,
    atrisk: athletes.filter((n) => cls[n]?.atRisk).length,
    sharpdrop: athletes.filter((n) => cls[n]?.sharpDrop).length,
    trending: athletes.filter((n) => cls[n]?.trending).length,
    women: athletes.filter(isWomen).length,
    men: athletes.filter(isMen).length,
  }), [athletes, cls]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => athletes.filter((name) => {
    if (filter === 'atrisk') return cls[name]?.atRisk;
    if (filter === 'sharpdrop') return cls[name]?.sharpDrop;
    if (filter === 'trending') return cls[name]?.trending;
    if (filter === 'women') return isWomen(name);
    if (filter === 'men') return isMen(name);
    return true;
  }), [athletes, filter, cls]); // eslint-disable-line react-hooks/exhaustive-deps

  // All lines share the same style; only lines that dip below the threshold are
  // drawn on top so their red (danger) points stay visible.
  const dipsBelow = (name) => (meta[name]?.seq || []).some((p) => p.value < threshold);
  const orderedVisible = useMemo(() => {
    return [...visible].sort((a, b) => (dipsBelow(a) ? 1 : 0) - (dipsBelow(b) ? 1 : 0));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestDate = data.length ? data[data.length - 1].date : null;

  // ---- point markers ----
  // Every line looks the same. We ONLY highlight the points that fall below the
  // danger threshold on a given day (red), so the path into the danger zone is clear.
  const makeDot = (name) => (props) => {
    const { cx, cy, value, index, payload } = props;
    if (value === null || value === undefined || cx == null || cy == null) return null;
    const under = value < threshold;
    const base = colorFor(name);
    const isLast = index === meta[name].lastIndex;
    const day = payload?.date;
    const els = [];
    if (under) {
      els.push(
        <circle key="ring" cx={cx} cy={cy} r={8} fill="none" stroke="#EF4444" strokeOpacity={0.7} strokeWidth={1.5} />,
        <circle key="dot" cx={cx} cy={cy} r={5} fill="#EF4444" stroke="#FCA5A5" strokeWidth={2}
          style={onAthleteClick ? { cursor: 'pointer' } : undefined} onClick={() => onAthleteClick && onAthleteClick(name, day)} />,
      );
      if (isLast) {
        els.push(
          <g key="val" style={{ pointerEvents: 'none' }}>
            <rect x={cx + 7} y={cy - 8} width={26} height={16} rx={4} fill="#EF4444" />
            <text x={cx + 20} y={cy + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{value.toFixed(1)}</text>
          </g>,
        );
      }
    } else {
      els.push(
        <circle key="dot" cx={cx} cy={cy} r={2.5} fill={base} stroke="#0b1220" strokeWidth={1}
          style={onAthleteClick ? { cursor: 'pointer' } : undefined} onClick={() => onAthleteClick && onAthleteClick(name, day)} />,
      );
    }
    return <g>{els}</g>;
  };

  // Hovering any line/point shows that athlete's value (works for ALL athletes)
  const makeActiveDot = (name) => (props) => {
    const { cx, cy, value, payload } = props;
    if (cx == null || cy == null) return null;
    const color = colorFor(name);
    const day = payload?.date;
    return (
      <g style={{ cursor: 'pointer' }} onClick={() => onAthleteClick && onAthleteClick(name, day)}>
        <circle cx={cx} cy={cy} r={12} fill="transparent" />
        <circle cx={cx} cy={cy} r={6} fill={color} stroke="#fff" strokeWidth={1.5} />
        <g style={{ pointerEvents: 'none' }}>
          <rect x={cx - 16} y={cy - 27} width={32} height={16} rx={3} fill="#0b1220" stroke={color} strokeWidth={1} />
          <text x={cx} y={cy - 15} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
            {typeof value === 'number' ? value.toFixed(1) : value}
          </text>
        </g>
      </g>
    );
  };

  const STATUS = {
    atrisk: { label: 'At Risk', color: '#F87171', rank: 0 },
    sharpdrop: { label: 'Sharp Drop', color: '#FB923C', rank: 1 },
    attention: { label: 'Attention', color: '#FBBF24', rank: 2 },
    normal: { label: 'Normal', color: '#94A3B8', rank: 3 },
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const rows = payload
      .filter((p) => p.value !== null && p.value !== undefined && !String(p.name).startsWith('__'))
      .map((p) => {
        const info = cls[p.name] || {};
        const d = meta[p.name]?.byDate?.[label];
        return { name: p.name, value: p.value, color: p.color, status: info.status || 'normal', delta: d ? d.delta : null };
      })
      .sort((a, b) => (STATUS[a.status].rank - STATUS[b.status].rank) || a.value - b.value);
    const isBelow = (r) => r.value < threshold;
    const flagged = rows.filter((r) => r.status !== 'normal' || isBelow(r))
      .sort((a, b) => (Number(isBelow(b)) - Number(isBelow(a))) || (STATUS[a.status].rank - STATUS[b.status].rank) || a.value - b.value);
    const normal = rows.filter((r) => r.status === 'normal' && !isBelow(r));
    const deltaEl = (delta) => (delta !== null && delta !== undefined && delta !== 0)
      ? <span className={delta < 0 ? 'text-red-400' : 'text-emerald-400'}>{delta < 0 ? '▼' : '▲'}{Math.abs(delta).toFixed(1)}</span>
      : null;
    return (
      <div className="rounded-lg border border-white/10 bg-[#0b1220]/95 backdrop-blur px-3 py-2 shadow-xl w-[19rem]">
        <p className="text-xs font-semibold text-foreground mb-1.5">{label}</p>
        {flagged.length > 0 && (
          <div className="space-y-0.5 mb-1.5">
            {flagged.map((r) => {
              const below = isBelow(r);
              const st = STATUS[r.status];
              const color = below ? '#F87171' : st.color;
              const labelText = below ? (r.status === 'atrisk' ? 'At Risk' : 'Danger') : st.label;
              return (
                <div key={r.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className={`truncate ${below ? 'text-red-300' : 'text-foreground'}`}>{r.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {deltaEl(r.delta)}
                    <span className="font-bold" style={{ color }}>{r.value.toFixed(1)}</span>
                    <span className="text-[9px] px-1 py-px rounded" style={{ background: `${color}22`, color }}>{labelText}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {normal.length > 0 && (
          <div>
            {flagged.length > 0 && <div className="border-t border-white/10 mb-1" />}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {normal.map((r) => (
                <div key={r.name} className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {deltaEl(r.delta)}
                    <span className="font-medium text-foreground/80">{r.value.toFixed(1)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ---- chip group renderer (boxed, mobile-friendly) ----
  const chipGroup = (names, tone, Icon, title) => {
    if (!names.length) return null;
    const box = {
      red: 'border-red-500/25 bg-red-500/[0.06]',
      orange: 'border-orange-500/25 bg-orange-500/[0.06]',
      amber: 'border-amber-400/25 bg-amber-500/[0.06]',
    }[tone];
    const chipCls = {
      red: 'bg-red-500/15 border-red-500/30 text-red-200 hover:bg-red-500/25',
      orange: 'bg-orange-500/15 border-orange-500/30 text-orange-200 hover:bg-orange-500/25',
      amber: 'bg-amber-500/15 border-amber-400/30 text-amber-200 hover:bg-amber-500/25',
    }[tone];
    const titleCls = { red: 'text-red-400', orange: 'text-orange-400', amber: 'text-amber-400' }[tone];
    return (
      <div className={`rounded-lg border px-3 py-2 ${box}`}>
        <p className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-2 ${titleCls}`}>
          <Icon className="w-3.5 h-3.5 shrink-0" /> {title}
          <span className="opacity-60 font-bold">{names.length}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {names
            .sort((a, b) => (cls[a]?.lastValue ?? 99) - (cls[b]?.lastValue ?? 99))
            .map((name) => (
              <button
                key={name} type="button" onClick={() => onAthleteClick && onAthleteClick(name)}
                data-testid={`chip-${name}`}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${chipCls}`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorFor(name) }} />
                <span className="truncate max-w-[9rem]">{name}</span>
                <span className="font-bold">{(cls[name]?.lastValue ?? 0).toFixed(1)}</span>
                {cls[name]?.delta !== null && cls[name]?.delta !== undefined && cls[name]?.delta < 0 && (
                  <span className="opacity-90">▼{Math.abs(cls[name].delta).toFixed(1)}</span>
                )}
              </button>
            ))}
        </div>
      </div>
    );
  };

  const atRiskNames = athletes.filter((n) => cls[n]?.atRisk);
  const sharpNames = athletes.filter((n) => cls[n]?.sharpDrop && !cls[n]?.atRisk);
  const trendNames = athletes.filter((n) => cls[n]?.trending);

  // Auto insights
  const insights = [];
  if (counts.atrisk) insights.push({ tone: 'red', Icon: AlertTriangle, text: `${counts.atrisk} athlete${counts.atrisk > 1 ? 's' : ''} at risk` });
  if (counts.sharpdrop) insights.push({ tone: 'orange', Icon: Zap, text: `${counts.sharpdrop} with sharp drop` });
  if (counts.trending) insights.push({ tone: 'amber', Icon: TrendingDown, text: `${counts.trending} trending down` });

  return (
    <div>
      {/* Quick filters + latest date */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2" data-testid="readiness-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key} type="button" onClick={() => setFilter(f.key)}
            data-testid={`readiness-filter-${f.key}`}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.key
                ? (f.key === 'atrisk' ? 'bg-red-500 border-red-500 text-white'
                  : f.key === 'sharpdrop' ? 'bg-orange-500 border-orange-500 text-white'
                  : f.key === 'trending' ? 'bg-amber-500 border-amber-500 text-black'
                  : 'bg-primary border-primary text-primary-foreground')
                : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
            }`}
          >
            {f.label}<span className={`ml-1.5 ${filter === f.key ? 'opacity-90' : 'opacity-60'}`}>{counts[f.key]}</span>
          </button>
        ))}
        {latestDate && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            Latest: <span className="text-foreground font-medium">{latestDate}</span>
          </span>
        )}
      </div>

      {/* Auto insights */}
      {insights.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3" data-testid="readiness-insights">
          {insights.map((ins, i) => {
            const tone = {
              red: 'bg-red-500/10 border-red-500/30 text-red-300',
              orange: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
              amber: 'bg-amber-500/10 border-amber-400/30 text-amber-300',
            }[ins.tone];
            return (
              <span key={i} className={`text-[11px] px-2 py-0.5 rounded-md border flex items-center gap-1.5 ${tone}`}>
                <ins.Icon className="w-3 h-3" /> {ins.text}
              </span>
            );
          })}
        </div>
      )}

      <div className="h-[480px] w-full" data-testid="readiness-chart">
        <ResponsiveContainer key={rcKey} width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 14, right: 46, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
            <ReferenceArea y1={0} y2={threshold} fill="#EF4444" fillOpacity={0.05} strokeOpacity={0} />
            <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 5, 6, 8, 10]} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} width={28} />
            <ReferenceLine
              y={threshold} stroke="#EF4444" strokeWidth={2} strokeDasharray="6 4"
              label={{ value: `Risk Threshold (${threshold})`, position: 'insideTopRight', fill: '#F87171', fontSize: 11, fontWeight: 600 }}
            />
            <RechartsTooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 50 }} allowEscapeViewBox={{ x: false, y: true }} />

            {/* Faint red "danger trajectory": links the below-threshold days of each at-risk athlete */}
            {orderedVisible.filter((name) => dipsBelow(name)).map((name) => (
              <Line
                key={`dz-${name}`} type="monotone"
                dataKey={(d) => (d[name] !== null && d[name] !== undefined && d[name] < threshold ? d[name] : null)}
                name={`__dz_${name}`}
                stroke="#EF4444" strokeWidth={6} strokeOpacity={0.2}
                dot={false} activeDot={false} connectNulls={false}
                isAnimationActive={false} legendType="none"
              />
            ))}

            {orderedVisible.map((name) => {
              const danger = dipsBelow(name);
              return (
                <Line
                  key={name} type="monotone" dataKey={name} name={name}
                  stroke={colorFor(name)}
                  strokeWidth={danger ? 2.75 : 2}
                  strokeOpacity={danger ? 1 : 0.8}
                  dot={makeDot(name)}
                  activeDot={makeActiveDot(name)}
                  connectNulls isAnimationActive={false}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onAthleteClick && onAthleteClick(name)}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend + grouped chips */}
      <div className="mt-4 pt-3 border-t border-white/5 space-y-3">
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs sm:flex sm:flex-wrap sm:justify-center sm:gap-5">
          <div className="flex items-center gap-2">
            <div className="w-5 border-t-2 border-dashed border-red-500 shrink-0" />
            <span className="text-muted-foreground">Risk Threshold ({threshold})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-red-300/60 shrink-0" />
            <span className="text-muted-foreground">Below threshold</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-400 shrink-0">▼</span>
            <span className="text-muted-foreground">Sharp drop</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-3 bg-red-500/20 rounded-sm shrink-0" />
            <span className="text-muted-foreground">Danger Zone</span>
          </div>
        </div>

        {(atRiskNames.length + sharpNames.length + trendNames.length) === 0 ? (
          <p className="text-center text-xs text-emerald-400">✅ Everyone above the risk line and stable on the latest day.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start" data-testid="readiness-chips">
            {chipGroup(atRiskNames, 'red', AlertTriangle, 'At risk')}
            {chipGroup(sharpNames, 'orange', Zap, 'Sharp drop')}
            {chipGroup(trendNames, 'amber', TrendingDown, 'Trending down')}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReadinessByAthleteChart;
