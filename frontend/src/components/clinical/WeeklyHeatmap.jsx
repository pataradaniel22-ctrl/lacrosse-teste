import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Calendar } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const COLOR_CLASS = {
  green: 'bg-emerald-500/60 hover:bg-emerald-500',
  yellow: 'bg-amber-500/60 hover:bg-amber-500',
  orange: 'bg-orange-500/70 hover:bg-orange-500',
  red: 'bg-red-500/70 hover:bg-red-500',
  gray: 'bg-muted/30 hover:bg-muted/50',
};

const ROW_LABELS = {
  readiness: 'Readiness',
  sleep: 'Sleep',
  pain: 'Pain',
  recovery: 'Recovery',
  fatigue: 'Fatigue',
  load: 'Load',
};

const ROW_HINTS = {
  readiness: 'Daily score (0-10, higher = better)',
  sleep: 'Sleep quality (0-10, higher = better)',
  pain: 'Peak reported pain (0-10, lower = better)',
  recovery: 'Composite Sleep+Fatigue+Pain+Stress',
  fatigue: 'Morning fatigue (0-10, lower = better)',
  load: 'Total internal load for the day',
};

export default function WeeklyHeatmap({ athleteId, getAuthHeaders, className = '' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!athleteId) return;
    let mounted = true;
    (async () => {
      try {
        const res = await axios.get(`${API}/clinical/athlete/${athleteId}/heatmap`, getAuthHeaders());
        if (mounted) setData(res.data);
      } catch (e) {
        // silent
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [athleteId, getAuthHeaders]);

  if (loading || !data) {
    return (
      <Card className={`glass-light border-white/5 ${className}`}>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          {loading ? 'Loading heatmap...' : 'Not enough data'}
        </CardContent>
      </Card>
    );
  }

  const { dates, weekdays, rows } = data;

  return (
    <Card className={`glass-light border-white/5 ${className}`} data-testid="weekly-heatmap">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="w-5 h-5 text-primary" />
          Weekly Heatmap
        </CardTitle>
        <p className="text-xs text-muted-foreground">7 days · Green=optimal · Yellow/Orange=attention · Red=critical</p>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <div className="min-w-[420px] px-3 sm:px-0">
            {/* Header row with weekday labels */}
            <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] gap-1.5 mb-1.5">
              <div></div>
              {weekdays.map((w, i) => (
                <div key={i} className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <div>{w}</div>
                  <div className="text-[9px] text-muted-foreground/60">{dates[i].slice(8, 10)}</div>
                </div>
              ))}
            </div>

            {/* Rows */}
            {Object.keys(ROW_LABELS).map((metric) => (
              <div
                key={metric}
                className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] gap-1.5 mb-1.5"
                data-testid={`heatmap-row-${metric}`}
              >
                <div className="flex flex-col justify-center">
                  <span className="text-xs font-medium">{ROW_LABELS[metric]}</span>
                </div>
                {rows[metric].map((cell, i) => (
                  <div
                    key={i}
                    className={`aspect-square sm:aspect-[3/2] rounded transition-all flex items-center justify-center cursor-default group relative ${COLOR_CLASS[cell.color] || COLOR_CLASS.gray}`}
                    title={`${ROW_LABELS[metric]} ${dates[i]}: ${cell.value ?? '—'}\n${ROW_HINTS[metric]}`}
                    data-testid={`heatmap-cell-${metric}-${i}`}
                  >
                    <span className="text-[9px] sm:text-[10px] font-bold tabular-nums text-white drop-shadow">
                      {cell.value !== null && cell.value !== undefined
                        ? typeof cell.value === 'number'
                          ? cell.value < 10
                            ? cell.value.toFixed(1)
                            : Math.round(cell.value)
                          : cell.value
                        : '·'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
