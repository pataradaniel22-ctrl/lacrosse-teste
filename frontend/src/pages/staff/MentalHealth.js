import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Brain, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const COLORS = {
  sleep: '#60A5FA', energy: '#34D399', mental_wellness: '#A78BFA',
  readiness: '#FBBF24', stress: '#F87171', pain: '#FB7185',
};
const goodColor = (v) => (v == null ? 'text-muted-foreground' : v >= 7 ? 'text-emerald-400' : v >= 5 ? 'text-amber-400' : 'text-red-400');
const badColor = (v) => (v == null ? 'text-muted-foreground' : v >= 7 ? 'text-red-400' : v >= 4 ? 'text-amber-400' : 'text-emerald-400');

const tooltipStyle = { backgroundColor: '#0b1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 };

export default function MentalHealth() {
  const { getAuthHeaders } = useAuth();
  const [days, setDays] = useState('14');
  const [team, setTeam] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [radarWho, setRadarWho] = useState('team');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const teamP = team !== 'all' ? `&team=${team}` : '';
      const res = await axios.get(`${API}/staff/mental-health?days=${days}${teamP}`, getAuthHeaders());
      setData(res.data);
    } catch (e) {
      toast.error('Failed to load mental health data.');
    } finally {
      setLoading(false);
    }
  }, [days, team, getAuthHeaders]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const s = data?.team_summary;
  const cards = s ? [
    { label: 'Sleep Quality', v: s.sleep, cls: goodColor(s.sleep) },
    { label: 'Energy Level', v: s.energy, cls: goodColor(s.energy) },
    { label: 'Mental Wellness', v: s.mental_wellness, cls: goodColor(s.mental_wellness) },
    { label: 'Readiness', v: s.readiness, cls: goodColor(s.readiness) },
    { label: 'Stress', v: s.stress, cls: badColor(s.stress) },
    { label: 'Avg Pain', v: s.avg_pain, cls: badColor(s.avg_pain) },
  ] : [];

  const responded = (data?.athletes || []).filter((a) => a.responded);
  const isAthlete = radarWho !== 'team';
  const radarSource = isAthlete ? responded.find((a) => a.athlete_id === radarWho) : s;
  const DIMS = [
    { dim: 'Sleep', key: 'sleep', aKey: 'avg_sleep' },
    { dim: 'Energy', key: 'energy', aKey: 'avg_energy' },
    { dim: 'Mental Wellness', key: 'mental_wellness', aKey: 'avg_mental_wellness' },
    { dim: 'Recovery', key: 'recovery', aKey: 'avg_recovery' },
    { dim: 'Readiness', key: 'readiness', aKey: 'avg_readiness' },
  ];
  const radarData = s ? DIMS.map((d) => ({
    dim: d.dim,
    value: (isAthlete ? (radarSource ? radarSource[d.aKey] : null) : s[d.key]) ?? 0,
    teamValue: s[d.key] ?? 0,
  })) : [];
  const radarLabel = isAthlete ? (radarSource?.name || 'Athlete') : 'Team average';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 flex items-center gap-3">
          <Link to="/staff"><Button variant="ghost" size="icon" className="h-9 w-9" data-testid="mh-back-btn"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <div>
              <h1 className="text-lg font-bold leading-tight">Mental Health & Wellness</h1>
              <p className="text-xs text-muted-foreground">Team and individual wellness from the morning check-in</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="w-40 h-9" data-testid="mh-team"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              <SelectItem value="Brazil Lacrosse Men">Men</SelectItem>
              <SelectItem value="Brazil Lacrosse Women">Women</SelectItem>
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36 h-9" data-testid="mh-window"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Today</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          {s && <span className="text-sm text-muted-foreground ml-auto" data-testid="mh-responders">{s.responders}/{s.athletes} responded · {s.pain_athletes} reporting pain</span>}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : !s ? null : (
          <>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3" data-testid="mh-summary">
              {cards.map((c) => (
                <Card key={c.label} className="glass-light border-white/5">
                  <CardContent className="p-3 text-center">
                    <p className={`text-2xl font-bold ${c.cls}`}>{c.v ?? '—'}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{c.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="glass-light border-white/5" data-testid="mh-radar-card">
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm">Wellness radar — 5 dimensions</CardTitle>
                <Select value={radarWho} onValueChange={setRadarWho}>
                  <SelectTrigger className="h-8 w-52 text-xs" data-testid="mh-radar-who"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Team average</SelectItem>
                    {responded.map((a) => <SelectItem key={a.athlete_id} value={a.athlete_id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
                  <div className="lg:col-span-2 h-80" data-testid="mh-radar">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <RadarChart data={radarData} outerRadius="72%">
                        <PolarGrid stroke="rgba(255,255,255,0.12)" />
                        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#CBD5E1' }} />
                        <PolarRadiusAxis domain={[0, 10]} angle={90} tick={{ fontSize: 9, fill: '#64748B' }} />
                        {isAthlete && (
                          <Radar name="Team average" dataKey="teamValue" stroke="#34D399" fill="#34D399" fillOpacity={0.1} strokeDasharray="4 3" />
                        )}
                        <Radar name={radarLabel} dataKey="value" stroke="#A78BFA" fill="#A78BFA" fillOpacity={0.35} />
                        <Tooltip contentStyle={tooltipStyle} />
                        {isAthlete && <Legend wrapperStyle={{ fontSize: 11 }} />}
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Scores list beside the radar (athlete vs team average when a player is selected) */}
                  <div className="space-y-1.5" data-testid="mh-radar-scores">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1 pb-1">
                      <span>Dimension</span>
                      <span className="flex items-center gap-3">
                        <span className="text-purple-300">{isAthlete ? 'Athlete' : 'Team'}</span>
                        {isAthlete && <span className="text-emerald-300">Team</span>}
                      </span>
                    </div>
                    {radarData.map((d) => {
                      const delta = isAthlete ? +(d.value - d.teamValue).toFixed(1) : null;
                      return (
                        <div key={d.dim} className="flex items-center justify-between rounded-md bg-white/[0.03] border border-white/5 px-2.5 py-1.5" data-testid={`mh-radar-score-${d.dim.replace(/\s+/g, '-').toLowerCase()}`}>
                          <span className="text-xs text-foreground/90">{d.dim}</span>
                          <span className="flex items-center gap-3">
                            <span className={`text-sm font-bold tabular-nums ${goodColor(d.value)}`}>{d.value?.toFixed ? d.value.toFixed(1) : d.value}</span>
                            {isAthlete && (
                              <>
                                <span className="text-sm font-semibold tabular-nums text-emerald-300/80 w-8 text-right">{d.teamValue?.toFixed ? d.teamValue.toFixed(1) : d.teamValue}</span>
                                <span className={`text-[11px] font-medium tabular-nums w-10 text-right ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                                  {delta > 0 ? '▲' : delta < 0 ? '▼' : ''}{delta !== 0 ? Math.abs(delta).toFixed(1) : '—'}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {isAthlete && (
                      <p className="text-[10px] text-muted-foreground pt-1 px-1">▲/▼ vs team average · all dimensions higher is better</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Wellness trends (higher is better)</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-72" data-testid="mh-wellness-chart">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <LineChart data={data.team_series} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(d) => String(d).slice(5)} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: '#94A3B8' }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="sleep" name="Sleep" stroke={COLORS.sleep} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="energy" name="Energy" stroke={COLORS.energy} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="mental_wellness" name="Mental Wellness" stroke={COLORS.mental_wellness} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="readiness" name="Readiness" stroke={COLORS.readiness} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Stress & Pain (higher is worse)</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-72" data-testid="mh-stress-chart">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <LineChart data={data.team_series} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(d) => String(d).slice(5)} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: '#94A3B8' }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="stress" name="Stress" stroke={COLORS.stress} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="avg_pain" name="Avg Pain" stroke={COLORS.pain} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">By athlete (latest check-in)</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="mh-athlete-table">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-white/10">
                      <th className="text-left py-2 pr-3">Athlete</th>
                      <th className="text-center px-2">Sleep</th>
                      <th className="text-center px-2">Energy</th>
                      <th className="text-center px-2">Mental</th>
                      <th className="text-center px-2">Stress</th>
                      <th className="text-center px-2">Readiness</th>
                      <th className="text-center px-2">Pain</th>
                      <th className="text-right pl-2">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.athletes.map((a) => (
                      <tr key={a.athlete_id} className="border-b border-white/5" data-testid={`mh-row-${a.athlete_id}`}>
                        <td className="py-2 pr-3 font-medium">{a.name}</td>
                        {a.responded ? (
                          <>
                            <td className={`text-center px-2 font-semibold ${goodColor(a.sleep)}`}>{a.sleep ?? '—'}</td>
                            <td className={`text-center px-2 font-semibold ${goodColor(a.energy)}`}>{a.energy ?? '—'}</td>
                            <td className={`text-center px-2 font-semibold ${goodColor(a.mental_wellness)}`}>{a.mental_wellness ?? '—'}</td>
                            <td className={`text-center px-2 font-semibold ${badColor(a.stress)}`}>{a.stress ?? '—'}</td>
                            <td className={`text-center px-2 font-semibold ${goodColor(a.readiness)}`}>{a.readiness ?? '—'}</td>
                            <td className={`text-center px-2 font-semibold ${badColor(a.pain)}`}>{a.pain ?? 0}</td>
                            <td className="text-right pl-2 text-xs text-muted-foreground">{a.latest_date}</td>
                          </>
                        ) : (
                          <td colSpan={7} className="text-center py-2 text-xs text-muted-foreground">No check-in in this window</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
