import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { CalendarRange, FileSpreadsheet, Sheet, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { PeriodFilter } from '../research/PeriodFilter';
import { DataTable } from '../research/DataTable';
import { API, presetRange, buildQuery, downloadExport } from '../research/exportUtils';

const COLS = ['date', 'athlete_name', 'team', 'has_health_problem', 'problem_category', 'body_region', 'body_side',
  'Q1_answer', 'Q1_score', 'Q2_answer', 'Q2_score', 'Q3_answer', 'Q3_score', 'Q4_answer', 'Q4_score',
  'severity_score', 'substantial_problem', 'availability', 'description'];

const Kpi = ({ label, value, testid }) => (
  <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2" data-testid={testid}>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-xl font-bold">{value}</p>
  </div>
);

export const HealthPeriodExplorer = ({ teams = [] }) => {
  const { getAuthHeaders } = useAuth();
  const [filter, setFilter] = useState({ preset: '12w', ...presetRange('12w'), team: 'all-teams', group: 'week' });
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState({ rows: [], total: 0 });
  const [onlyProblems, setOnlyProblems] = useState(false);

  const params = useMemo(() => ({ start: filter.start, end: filter.end, team: filter.team }), [filter]);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        axios.get(`${API}/health/staff/period-stats?${buildQuery({ ...params, group: filter.group })}`, getAuthHeaders()),
        axios.get(`${API}/research/preview/ostrc_responses?${buildQuery({ ...params, limit: 500 })}`, getAuthHeaders()),
      ]);
      setStats(s.data); setRows(p.data);
    } catch (e) {
      toast.error('Failed to load period data');
    }
  }, [params, filter.group, getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const shown = onlyProblems ? rows.rows.filter((r) => r.has_health_problem) : rows.rows;
  const t = stats?.totals || {};
  const exportParams = { ...params, datasets: 'ostrc_responses,ostrc_submissions,health_problems' };

  return (
    <Card className="glass-light border-white/5" data-testid="health-period-explorer">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-cyan-400" /> Responses by period
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => downloadExport('/research/export', { ...exportParams, format: 'xlsx' }, getAuthHeaders(), 'ostrc_data.xlsx')}
              data-testid="health-export-xlsx-btn">
              <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
            </Button>
            <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
              onClick={() => { downloadExport('/research/export', { ...params, datasets: 'ostrc_responses', format: 'csv' }, getAuthHeaders(), 'ostrc_responses.csv'); toast.info('Google Sheets: File → Import → Upload the CSV'); }}
              data-testid="health-export-csv-btn">
              <Sheet className="w-4 h-4 mr-1.5" /> CSV / Google Sheets
            </Button>
            <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
              onClick={() => downloadExport('/research/dictionary', { datasets: 'ostrc_responses,ostrc_submissions,health_problems', format: 'xlsx' }, getAuthHeaders(), 'data_dictionary.xlsx')}
              data-testid="health-dictionary-btn">
              <BookOpen className="w-4 h-4 mr-1.5" /> Dictionary
            </Button>
          </div>
        </div>
        <PeriodFilter value={filter} onChange={setFilter} teams={teams} showGroup testPrefix="health-period" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Kpi label="Submissions" value={t.submissions ?? '—'} testid="hp-kpi-submissions" />
          <Kpi label="Avg response rate" value={`${t.mean_response_rate ?? 0}%`} testid="hp-kpi-response" />
          <Kpi label="Avg prevalence (all)" value={`${t.mean_prevalence_all ?? 0}%`} testid="hp-kpi-prev-all" />
          <Kpi label="Avg prevalence (substantial)" value={`${t.mean_prevalence_substantial ?? 0}%`} testid="hp-kpi-prev-sub" />
          <Kpi label="Problem reports" value={t.problem_reports ?? '—'} testid="hp-kpi-problems" />
        </div>
        <div className="h-64" data-testid="health-period-chart">
          {stats?.periods?.length ? (
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 256 }}>
              <ComposedChart data={stats.periods} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="response_rate" name="Response rate %" fill="rgba(34,211,238,0.25)" radius={[3, 3, 0, 0]} />
                <Line dataKey="prevalence_all" name="Prevalence all %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                <Line dataKey="prevalence_substantial" name="Prevalence substantial %" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground text-center pt-24">No submissions in this period.</p>}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground" data-testid="health-period-rowcount">{shown.length} of {rows.total} response rows</p>
          <label className="text-xs flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} data-testid="health-only-problems" />
            Only weeks with a health problem
          </label>
        </div>
        <DataTable columns={COLS} rows={shown} testid="health-responses-table" />
      </CardContent>
    </Card>
  );
};
