import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Activity, TrendingUp, TrendingDown, Minus, Heart, ShieldCheck, AlertTriangle, ChevronRight, Info } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const COLOR_BG = {
  green: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  yellow: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  orange: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
  red: 'bg-red-500/10 border-red-500/30 text-red-400',
  gray: 'bg-muted/30 border-white/5 text-muted-foreground',
};

const COLOR_DOT = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  gray: 'bg-muted',
};

function TrendArrow({ trend, value }) {
  if (trend === 'up' || (typeof value === 'number' && value > 5)) {
    return <TrendingUp className="w-4 h-4 text-amber-400" data-testid="trend-up" />;
  }
  if (trend === 'down' || (typeof value === 'number' && value < -5)) {
    return <TrendingDown className="w-4 h-4 text-emerald-400" data-testid="trend-down" />;
  }
  return <Minus className="w-4 h-4 text-muted-foreground" data-testid="trend-flat" />;
}

function MiniSparkline({ data, color = '#22d3ee' }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer>
        <LineChart data={data}>
          <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PerformanceSnapshot({ athleteId, getAuthHeaders, className = '' }) {
  const [data, setData] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!athleteId) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const [snap, rec] = await Promise.all([
          axios.get(`${API}/clinical/athlete/${athleteId}/snapshot`, getAuthHeaders()),
          axios.get(`${API}/clinical/athlete/${athleteId}/recovery-composite?days=14`, getAuthHeaders()),
        ]);
        if (mounted) {
          setData(snap.data);
          setRecovery(rec.data);
        }
      } catch (e) {
        if (mounted) setError('Failed to load snapshot');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [athleteId, getAuthHeaders]);

  if (loading) {
    return (
      <Card className={`glass-light border-white/5 ${className}`}>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">Loading snapshot...</CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card className={`glass-light border-white/5 ${className}`}>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">{error || 'No data'}</CardContent>
      </Card>
    );
  }

  const a = data.availability || {};
  const availColor = a.category_color || 'gray';

  return (
    <Card className={`glass-light border-white/5 overflow-hidden ${className}`} data-testid="performance-snapshot">
      <CardHeader className="pb-3 border-b border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-5 h-5 text-primary" />
              Performance Snapshot
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Automatic descriptive summary</p>
          </div>
          <Badge
            variant="outline"
            className={`${COLOR_BG[availColor]} border whitespace-nowrap text-xs font-semibold`}
            data-testid="availability-badge"
          >
            {a.percentage?.toFixed?.(0) ?? a.percentage}% · {a.category}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Narrative */}
        <p className="text-sm text-foreground leading-relaxed" data-testid="snapshot-narrative">
          {data.narrative}
        </p>

        {/* Metric grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricMini
            label="Readiness"
            value={data.readiness?.current?.toFixed?.(1) ?? '—'}
            suffix="/10"
            icon={<Heart className="w-3.5 h-3.5" />}
            color={
              data.readiness?.current >= 7
                ? 'green'
                : data.readiness?.current >= 5
                ? 'yellow'
                : 'red'
            }
            testid="metric-readiness"
          />
          <MetricMini
            label="Recovery"
            value={data.recovery_composite?.current?.toFixed?.(1) ?? '—'}
            suffix="/10"
            sparkline={recovery?.series?.slice(-7) || []}
            icon={
              <TrendArrow
                value={data.recovery_composite?.delta_7d_vs_prev}
                trend={
                  data.recovery_composite?.delta_7d_vs_prev > 0.3
                    ? 'down'  // up in recovery = good (down arrow logic in TrendArrow inverted for context)
                    : data.recovery_composite?.delta_7d_vs_prev < -0.3
                    ? 'up'
                    : null
                }
              />
            }
            color={
              data.recovery_composite?.current >= 7
                ? 'green'
                : data.recovery_composite?.current >= 5
                ? 'yellow'
                : 'red'
            }
            testid="metric-recovery"
          />
          <MetricMini
            label="Load (7d)"
            value={data.load?.last_7d_total ?? '—'}
            suffix={data.load?.change_pct != null ? ` (${data.load.change_pct > 0 ? '+' : ''}${data.load.change_pct}%)` : ''}
            icon={<TrendArrow trend={data.load?.trend} />}
            color={data.load?.trend === 'up' ? 'yellow' : data.load?.trend === 'down' ? 'orange' : 'green'}
            testid="metric-load"
          />
          <MetricMini
            label="Compliance"
            value={data.compliance?.last_7d_pct ?? 0}
            suffix="%"
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            color={
              data.compliance?.last_7d_pct >= 80
                ? 'green'
                : data.compliance?.last_7d_pct >= 50
                ? 'yellow'
                : 'red'
            }
            testid="metric-compliance"
          />
        </div>

        {/* CMJ deviation */}
        {data.cmj_deviation && (
          <div className={`rounded-lg p-3 border ${COLOR_BG[
            Math.abs(data.cmj_deviation.deviation_pct) > 10 ? 'red' :
            Math.abs(data.cmj_deviation.deviation_pct) > 5 ? 'yellow' : 'green'
          ]}`} data-testid="cmj-deviation">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">CMJ vs baseline</span>
              <span className="text-sm font-bold tabular-nums">
                {data.cmj_deviation.deviation_pct > 0 ? '+' : ''}{data.cmj_deviation.deviation_pct}%
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {data.cmj_deviation.current_cm} cm (current) · {data.cmj_deviation.baseline_cm} cm (baseline)
            </div>
          </div>
        )}

        {/* Trends */}
        {data.trends && data.trends.length > 0 && (
          <div className="space-y-2" data-testid="trends-section">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5" />
              Trends detected ({data.trends.length})
            </div>
            {data.trends.map((t, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 border ${COLOR_BG[t.severity] || COLOR_BG.yellow}`}
                data-testid={`trend-${t.type}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${COLOR_DOT[t.severity] || COLOR_DOT.yellow}`} />
                  <p className="text-xs leading-relaxed">{t.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 pt-2 border-t border-white/5">
          <Info className="w-3 h-3 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            {data.disclaimer}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricMini({ label, value, suffix = '', icon, color = 'gray', sparkline, testid }) {
  return (
    <div className={`rounded-lg p-2.5 border ${COLOR_BG[color]}`} data-testid={testid}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <span className="text-lg font-bold tabular-nums">{value}</span>
          <span className="text-[10px] text-muted-foreground ml-0.5">{suffix}</span>
        </div>
        {sparkline && sparkline.length > 1 && <MiniSparkline data={sparkline} />}
      </div>
    </div>
  );
}
