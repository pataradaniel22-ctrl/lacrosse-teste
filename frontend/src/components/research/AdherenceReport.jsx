import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { FileSpreadsheet, Sheet, UserCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '../../contexts/AuthContext';
import { PeriodFilter } from './PeriodFilter';
import { API, presetRange, buildQuery, downloadExport } from './exportUtils';

const METRICS = [
  { key: 'overall_pct', label: 'Overall', pct: true },
  { key: 'morning_pct', label: 'Morning check-in (days/7)', pct: true },
  { key: 'ostrc_pct', label: 'OSTRC weekly', pct: true },
  { key: 'recovery_pct', label: 'Recovery (days/7)', pct: true },
  { key: 'training_sessions', label: 'Training logs (count)', pct: false },
];

const cellColor = (v, pct) => {
  if (!pct) return v > 0 ? 'bg-sky-500/20 text-sky-200' : 'bg-white/[0.03] text-muted-foreground';
  if (v >= 80) return 'bg-emerald-500/25 text-emerald-200';
  if (v >= 50) return 'bg-amber-500/25 text-amber-200';
  if (v > 0) return 'bg-red-500/25 text-red-200';
  return 'bg-white/[0.03] text-muted-foreground';
};

const cellTitle = (c) => c && `Morning ${c.morning_days}/${c.days_in_period} · OSTRC ${c.ostrc_submitted ? 'yes' : 'no'} · Recovery ${c.recovery_days}/${c.days_in_period} · Training ${c.training_sessions}`;

export const AdherenceReport = ({ teams = [], includeArchived = true }) => {
  const { getAuthHeaders } = useAuth();
  const [filter, setFilter] = useState({ preset: '12w', ...presetRange('12w'), team: 'all-teams' });
  const [metric, setMetric] = useState('overall_pct');
  const [data, setData] = useState(null);
  const m = METRICS.find((x) => x.key === metric);
  const params = useMemo(() => ({ start: filter.start, end: filter.end, team: filter.team, include_archived: includeArchived }), [filter, includeArchived]);

  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await axios.get(`${API}/research/adherence?${buildQuery(params)}`, getAuthHeaders());
      setData(r.data);
    } catch (e) { toast.error('Failed to load adherence'); setData({ weeks: [], athletes: [], team_weekly: [], overall: {} }); }
  }, [params, getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const fmt = (v) => (v === undefined || v === null ? '—' : m.pct ? `${Math.round(v)}%` : v);
  const exp = (format) => downloadExport('/research/export', { ...params, datasets: 'adherence_weekly', format, anonymize: false }, getAuthHeaders(), `adherence.${format}`);

  return (
    <Card className="glass-light border-white/5" data-testid="adherence-report">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><UserCheck className="w-4 h-4 text-emerald-400" /> Questionnaire adherence by week</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => exp('xlsx')} data-testid="adherence-export-xlsx-btn"><FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel</Button>
            <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10" onClick={() => exp('csv')} data-testid="adherence-export-csv-btn"><Sheet className="w-4 h-4 mr-1.5" /> CSV</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodFilter value={filter} onChange={setFilter} teams={teams} testPrefix="adherence" />
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Metric</p>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="w-[220px] h-9" data-testid="adherence-metric-select"><SelectValue /></SelectTrigger>
              <SelectContent>{METRICS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Overall = mean of morning check-in (days answered ÷ 7), OSTRC weekly (submitted or not) and recovery (days ÷ 7). Training is shown as the number of logs. Partial weeks use only the days inside the period.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? <p className="text-sm text-muted-foreground text-center py-10">Loading…</p> : !data.athletes.length ? (
          <p className="text-sm text-muted-foreground text-center py-10" data-testid="adherence-empty">No athletes for these filters.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="adherence-overall">
              {METRICS.map((x) => (
                <div key={x.key} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.label}</p>
                  <p className="text-xl font-bold" data-testid={`adherence-overall-${x.key}`}>{x.pct ? `${Math.round(data.overall[x.key] || 0)}%` : data.overall[x.key]}</p>
                </div>
              ))}
            </div>
            <div className="overflow-auto max-h-[560px] rounded-lg border border-white/5">
              <table className="text-xs w-full" data-testid="adherence-table">
                <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
                  <tr>
                    <th className="text-left px-3 py-2 sticky left-0 bg-background whitespace-nowrap">Athlete</th>
                    <th className="px-2 py-2 whitespace-nowrap">Avg</th>
                    {data.weeks.map((w) => <th key={w} className="px-2 py-2 whitespace-nowrap font-medium text-muted-foreground">{w.slice(5)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/10">
                    <td className="px-3 py-1.5 sticky left-0 bg-background font-semibold">Team average</td>
                    <td className="px-2 py-1.5 text-center font-semibold">{fmt(data.overall[metric])}</td>
                    {data.team_weekly.map((t) => <td key={t.week_start} className={`px-2 py-1.5 text-center rounded ${cellColor(t[metric], m.pct)}`}>{fmt(t[metric])}</td>)}
                  </tr>
                  {data.athletes.map((a) => (
                    <tr key={a.athlete_code} className="border-b border-white/5" data-testid={`adherence-row-${a.athlete_code}`}>
                      <td className="px-3 py-1.5 sticky left-0 bg-background whitespace-nowrap">
                        <span className="font-medium">{a.athlete_name}</span>
                        <span className="text-muted-foreground ml-1.5 text-[10px]">{a.team?.includes('Women') ? 'W' : 'M'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-center font-semibold">{fmt(a.avg[metric])}</td>
                      {data.weeks.map((w) => {
                        const c = a.weeks[w];
                        return <td key={w} title={cellTitle(c)} className={`px-2 py-1.5 text-center ${cellColor(c?.[metric] ?? 0, m.pct)}`}>{fmt(c?.[metric])}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
