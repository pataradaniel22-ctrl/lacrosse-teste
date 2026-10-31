/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { toast } from 'sonner';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  ScatterChart, Scatter, Cell, PieChart, Pie, Legend,
} from 'recharts';
import {
  ArrowLeft, ShieldCheck, Flame, TrendingUp, Trophy, Clock, AlertTriangle,
  Users, Target, Activity, RefreshCw, Settings, Award, Droplet, Moon,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CELL = { green: 'bg-emerald-500', yellow: 'bg-amber-400', orange: 'bg-orange-500', red: 'bg-red-500' };
const SEV = {
  red: 'border-red-500 bg-red-500/10 text-red-700',
  orange: 'border-orange-500 bg-orange-500/10 text-orange-700',
  yellow: 'border-amber-400 bg-amber-400/10 text-amber-700',
};
const PIE_COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#94a3b8'];

export default function RecoveryIntelligence() {
  const { getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState('all');
  const [days, setDays] = useState('14');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (team !== 'all') params.set('team', team);
      params.set('days', days);
      const res = await axios.get(`${API}/recovery/staff/overview?${params.toString()}`, getAuthHeaders());
      setData(res.data);
    } catch (e) {
      toast.error('Failed to load recovery intelligence');
    } finally {
      setLoading(false);
    }
  }, [team, days, getAuthHeaders]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const k = data?.kpis || {};

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="recovery-intelligence-page">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="ri-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading font-bold text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" /> Recovery Intelligence
            </h1>
            <p className="text-xs text-muted-foreground">Team recovery compliance, habits & trends</p>
          </div>
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="w-[150px] h-9" data-testid="ri-team-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              <SelectItem value="Brazil Lacrosse Men">Men</SelectItem>
              <SelectItem value="Brazil Lacrosse Women">Women</SelectItem>
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[110px] h-9" data-testid="ri-days-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchData} data-testid="ri-refresh-btn">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/staff/recovery')} data-testid="ri-admin-btn">
            <Settings className="w-4 h-4 mr-1" /> Admin
            {k.pending_approvals > 0 && <span className="ml-1 px-1.5 rounded-full bg-amber-500 text-white text-[10px]">{k.pending_approvals}</span>}
          </Button>
        </div>
      </header>

      {loading || !data ? (
        <div className="h-96 flex items-center justify-center"><div className="animate-pulse text-primary">Loading Intelligence...</div></div>
      ) : (
        <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
          {/* KPI CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="ri-kpis">
            <KpiCard icon={Activity} color="text-blue-500" label="Avg Points Today" value={k.avg_recovery_points_today} sub={`/ ${data.target}`} />
            <KpiCard icon={Target} color="text-emerald-500" label="Team Compliance" value={`${k.team_compliance_pct}%`} />
            <KpiCard icon={Trophy} color="text-amber-500" label="Above Goal" value={k.athletes_above_goal} sub={`/ ${k.total_athletes}`} />
            <KpiCard icon={TrendingUp} color="text-red-500" label="Below Goal" value={k.athletes_below_goal} sub={`/ ${k.total_athletes}`} />
            <KpiCard icon={Flame} color="text-orange-500" label="Streak Leader" value={k.streak_leader?.streak} sub={k.streak_leader?.name} small />
            <KpiCard icon={Clock} color="text-purple-500" label="Pending" value={k.pending_approvals} clickable onClick={() => navigate('/staff/recovery')} />
          </div>

          {/* ALERTS */}
          <Card className="glass-light border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Recovery Alerts
                <Badge variant="outline" className="ml-1">{data.alerts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No alerts. Team recovery is on track. 🎯</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto" data-testid="ri-alerts">
                  {data.alerts.map((a, i) => (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border-l-4 ${SEV[a.severity]}`} data-testid={`ri-alert-${i}`}>
                      {a.severity === 'red' ? '🚨' : a.severity === 'orange' ? '⚠️' : '⚡'}
                      <span className="text-sm">{a.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* TEAM HEATMAP */}
          <Card className="glass-light border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-500" /> Team Recovery Heatmap
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500 align-middle" /> 100+
                <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 align-middle ml-2" /> 80-99
                <span className="inline-block w-3 h-3 rounded-sm bg-orange-500 align-middle ml-2" /> 50-79
                <span className="inline-block w-3 h-3 rounded-sm bg-red-500 align-middle ml-2" /> &lt;50
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <div className="min-w-[640px]" data-testid="ri-heatmap">
                {/* Date header */}
                <div className="flex items-center gap-1 mb-1 pl-32">
                  {data.heatmap.dates.map((d) => (
                    <div key={d} className="flex-1 text-center text-[9px] text-muted-foreground">{d.slice(5)}</div>
                  ))}
                </div>
                {data.heatmap.rows.map((row) => (
                  <div key={row.athlete_id} className="flex items-center gap-1 mb-1">
                    <div className="w-32 text-xs truncate pr-2 flex-shrink-0">{row.name}</div>
                    {row.cells.map((c) => (
                      <div
                        key={c.date}
                        className={`flex-1 h-7 rounded-sm flex items-center justify-center text-[9px] font-medium text-white ${c.points > 0 ? CELL[c.color] : 'bg-muted/40'}`}
                        title={`${row.name} · ${c.date}: ${c.points} pts`}
                      >
                        {c.points > 0 ? c.points : ''}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* TRENDS + CATEGORY */}
          <div className="grid lg:grid-cols-3 gap-5">
            <Card className="glass-light border-white/5 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" /> Daily Team Recovery Points
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64" data-testid="ri-trend-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.trends.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Bar dataKey="avg_points" name="Avg points" radius={[4, 4, 0, 0]}>
                        {data.trends.daily.map((d, i) => (
                          <Cell key={i} fill={d.avg_points >= data.target ? '#10b981' : d.avg_points >= data.target * 0.8 ? '#f59e0b' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Award className="w-4 h-4 text-blue-500" /> Category Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64" data-testid="ri-category-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.trends.category_breakdown} dataKey="points" nameKey="category" cx="50%" cy="50%" outerRadius={70} label={(e) => e.category}>
                        {data.trends.category_breakdown.map((e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* LEADERBOARD */}
          <Card className="glass-light border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" /> Recovery Leaderboard
                <span className="text-xs text-muted-foreground font-normal">(positive accountability)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto" data-testid="ri-leaderboard">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-white/10">
                      <th className="text-left py-2 w-10">#</th>
                      <th className="text-left py-2">Athlete</th>
                      <th className="text-right py-2">Total</th>
                      <th className="text-right py-2 hidden sm:table-cell">Avg</th>
                      <th className="text-right py-2">Streak</th>
                      <th className="text-right py-2">Compliance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((r) => (
                      <tr key={r.athlete_id} className="border-b border-white/5" data-testid={`ri-rank-${r.rank}`}>
                        <td className="py-2">
                          {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}
                        </td>
                        <td className="py-2 font-medium">{r.name}</td>
                        <td className="py-2 text-right font-semibold text-emerald-600">{r.total_points}</td>
                        <td className="py-2 text-right hidden sm:table-cell text-muted-foreground">{r.avg_points}</td>
                        <td className="py-2 text-right">
                          <span className="inline-flex items-center gap-1">{r.streak > 0 && <Flame className="w-3 h-3 text-orange-500" />}{r.streak}</span>
                        </td>
                        <td className="py-2 text-right">
                          <span className={r.compliance_pct >= 80 ? 'text-emerald-600' : r.compliance_pct >= 50 ? 'text-amber-600' : 'text-red-600'}>{r.compliance_pct}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* RELATIONSHIPS */}
          <div className="grid md:grid-cols-2 gap-5">
            <ScatterCard
              title="Recovery vs Readiness"
              icon={Droplet}
              iconColor="text-emerald-500"
              data={data.relationships.recovery_vs_readiness}
              xKey="recovery" yKey="readiness"
              xLabel="Recovery pts" yLabel="Readiness"
              yDomain={[0, 10]}
              color="#10b981"
              note="Observe whether better recovery coincides with higher readiness. No causal claim."
              testid="ri-scatter-readiness"
            />
            <ScatterCard
              title="Recovery vs Pain"
              icon={Moon}
              iconColor="text-red-500"
              data={data.relationships.recovery_vs_pain}
              xKey="recovery" yKey="pain"
              xLabel="Recovery pts" yLabel="Pain"
              yDomain={[0, 10]}
              color="#ef4444"
              note="Observe trends only. No diagnostic interpretation."
              testid="ri-scatter-pain"
            />
          </div>
        </main>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, color, label, value, sub, small, clickable, onClick }) {
  return (
    <Card
      className={`glass-light border-white/5 ${clickable ? 'cursor-pointer hover:border-primary/40 transition-all' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className={`w-3.5 h-3.5 ${color}`} />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        </div>
        <div className="flex items-end gap-1">
          <span className={`font-heading font-bold ${small ? 'text-xl' : 'text-2xl'}`}>{value ?? '-'}</span>
          {sub && <span className="text-xs text-muted-foreground mb-0.5 truncate">{sub}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ScatterCard({ title, icon: Icon, iconColor, data, xKey, yKey, xLabel, yLabel, yDomain, color, note, testid }) {
  return (
    <Card className="glass-light border-white/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56" data-testid={testid}>
          {data.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No overlapping data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis type="number" dataKey={xKey} name={xLabel} tick={{ fontSize: 10 }} label={{ value: xLabel, position: 'insideBottom', offset: -8, fontSize: 10 }} />
                <YAxis type="number" dataKey={yKey} name={yLabel} domain={yDomain} tick={{ fontSize: 10 }} />
                <RTooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={data} fill={color} fillOpacity={0.5} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{note}</p>
      </CardContent>
    </Card>
  );
}
