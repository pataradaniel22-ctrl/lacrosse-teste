import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, History, TrendingUp, Zap, Calendar, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Custom Tooltip component defined outside to prevent re-renders
const CustomChartTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-heavy rounded-lg px-3 py-2 border border-white/10">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-primary font-bold">{payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export default function MyHistory() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [readiness, setReadiness] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [healthHistory, setHealthHistory] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, readinessRes, sessionsRes, recoveryRes, healthRes] = await Promise.all([
        axios.get(`${API}/athlete/summary`, getAuthHeaders()),
        axios.get(`${API}/readiness/history?days=14`, getAuthHeaders()),
        axios.get(`${API}/sessions/history?days=14`, getAuthHeaders()),
        axios.get(`${API}/recovery/history?days=14`, getAuthHeaders()),
        axios.get(`${API}/health/my-history`, getAuthHeaders()).catch(() => ({ data: [] }))
      ]);
      
      setSummary(summaryRes.data);
      setReadiness(readinessRes.data);
      setSessions(sessionsRes.data);
      setRecovery(recoveryRes.data);
      setHealthHistory(Array.isArray(healthRes.data) ? healthRes.data : (healthRes.data?.submissions || []));
    } catch (error) {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const reportError = async (submissionId) => {
    const reason = window.prompt('Briefly describe what was wrong with this health check (the medical team will be notified):');
    if (reason === null) return;
    try {
      await axios.post(`${API}/health/athlete/report-error`, { submission_id: submissionId, reason: reason.trim() }, getAuthHeaders());
      toast.success('Reported to the medical team. They will review and correct it.');
      fetchData();
    } catch (e) {
      toast.error('Failed to report the error');
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prepare chart data
  const chartData = readiness.slice().reverse().map(r => ({
    date: r.date.slice(5),
    readiness: r.readiness_score
  }));

  const loadChartData = sessions.reduce((acc, s) => {
    const date = s.date_time_start.slice(5, 10);
    const existing = acc.find(d => d.date === date);
    if (existing) {
      existing.load += s.internal_load;
    } else {
      acc.push({ date, load: s.internal_load });
    }
    return acc;
  }, []).reverse();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="my-history-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/athlete')}
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <History className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg">My History</h1>
              <p className="text-xs text-muted-foreground">Your progress over time</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Avg Readiness</span>
                </div>
                <p className="text-2xl font-heading font-bold">{summary.last_7_days_avg_readiness.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Last 7 days</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Load</span>
                </div>
                <p className="text-2xl font-heading font-bold">{summary.last_7_days_total_load.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Last 7 days</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="readiness" className="animate-fade-in">
          <TabsList className="grid w-full grid-cols-4 bg-muted/50">
            <TabsTrigger value="readiness">Readiness</TabsTrigger>
            <TabsTrigger value="load">Load</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="health" data-testid="tab-health">Health</TabsTrigger>
          </TabsList>

          <TabsContent value="readiness" className="mt-4">
            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Readiness Score Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.length > 0 ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        />
                        <YAxis 
                          domain={[0, 10]} 
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Line 
                          type="monotone" 
                          dataKey="readiness" 
                          stroke="#10B981" 
                          strokeWidth={2}
                          dot={{ fill: '#10B981', strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No readiness data yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="load" className="mt-4">
            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Daily Load Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadChartData.length > 0 ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={loadChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis 
                          dataKey="date" 
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        />
                        <YAxis 
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Line 
                          type="monotone" 
                          dataKey="load" 
                          stroke="#FFCC00" 
                          strokeWidth={2}
                          dot={{ fill: '#FFCC00', strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No session data yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4 space-y-3">
            {sessions.length === 0 && readiness.length === 0 ? (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center text-muted-foreground">
                  No entries yet
                </CardContent>
              </Card>
            ) : (
              <>
                {sessions.slice(0, 10).map((session, index) => (
                  <Card key={session.id} className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-blue-400" />
                          </div>
                          <div>
                            <p className="font-medium">{session.session_type}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.date_time_start).toLocaleDateString()} • {session.duration_min}min
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline" className="border-primary/30 text-primary">
                            Load: {session.internal_load}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">RPE: {session.rpe}</p>
                        </div>
                      </div>
                      {session.photo_id && (
                        <img
                          src={`${API}/sessions/photo/${session.photo_id}?auth=${(getAuthHeaders().headers?.Authorization || '').replace('Bearer ', '')}`}
                          alt="Session"
                          className="mt-3 w-full max-h-48 object-cover rounded-lg border border-white/10"
                          data-testid={`session-photo-${session.id}`}
                          loading="lazy"
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="health" className="mt-4 space-y-3" data-testid="health-history-tab">
            {healthHistory.length === 0 ? (
              <Card className="glass-light border-white/5"><CardContent className="p-6 text-center text-sm text-muted-foreground">No weekly health checks submitted yet.</CardContent></Card>
            ) : (
              healthHistory.map((h) => (
                <Card key={h.id} className="glass-light border-white/5" data-testid={`health-history-item-${h.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">
                          {(h.reporting_period_end || h.submitted_at || '').slice(0, 10)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {h.has_health_problem
                            ? `${h.number_of_reported_problems || 0} problem(s) reported · severity ${h.highest_severity_score || 0}/100`
                            : 'No health problems reported'}
                        </p>
                        {h.correction_requested && (
                          <Badge variant="outline" className="mt-2 border-fuchsia-500/40 text-fuchsia-300 text-[10px]">Error reported — awaiting staff</Badge>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {h.contains_substantial_problem && (
                          <Badge variant="outline" className="border-red-500/40 text-red-300 text-[10px] mb-2">Substantial</Badge>
                        )}
                        <div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8 border-white/10"
                            disabled={h.correction_requested}
                            onClick={() => reportError(h.id)}
                            data-testid={`report-error-${h.id}`}
                          >
                            {h.correction_requested ? 'Reported' : 'Report error'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
