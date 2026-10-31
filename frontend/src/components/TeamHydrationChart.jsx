import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Droplets } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ReferenceLine, Legend,
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Team-wide hydration: % of athletes reporting dehydration (urine color >= 5) per day.
export default function TeamHydrationChart({ team = 'all' }) {
  const { getAuthHeaders } = useAuth();
  const [trend, setTrend] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const teamParam = team && team !== 'all' ? `&team=${encodeURIComponent(team)}` : '';
    axios.get(`${API}/staff/nutrition/hydration-trend?days=${days}${teamParam}`, getAuthHeaders())
      .then((r) => setTrend((r.data?.trend || []).map((d) => ({ ...d, label: d.date.slice(5) }))))
      .catch(() => setTrend([]))
      .finally(() => setLoading(false));
  }, [team, days, getAuthHeaders]);

  return (
    <Card className="glass-light border-white/5" data-testid="team-hydration-chart">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Droplets className="w-4 h-4 text-blue-400" />
            Team Hydration — % dehydrated per day
          </CardTitle>
          <div className="flex items-center gap-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d} type="button" onClick={() => setDays(d)}
                data-testid={`hydration-range-${d}d`}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${days === d ? 'bg-primary border-primary text-primary-foreground' : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'}`}
              >{d}d</button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Dehydration = urine color level ≥ 5. Bars = % of that day's reports; line = avg color (1–8).</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-center text-muted-foreground py-10 text-sm animate-pulse">Loading…</p>
        ) : trend.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 text-sm">No hydration reports in this period.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" />
                <YAxis yAxisId="lvl" orientation="right" domain={[1, 8]} ticks={[1, 4, 8]} tick={{ fill: '#64748b', fontSize: 10 }} />
                <RTooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, n) => n === '% dehydrated' ? [`${v}%`, n] : [v, n]}
                />
                <ReferenceLine yAxisId="pct" y={30} stroke="#f97316" strokeDasharray="4 3" label={{ value: 'Attention 30%', fill: '#fb923c', fontSize: 10, position: 'insideTopRight' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="pct" dataKey="pct_dehydrated" name="% dehydrated" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Line yAxisId="lvl" type="monotone" dataKey="avg_level" name="Avg color" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
