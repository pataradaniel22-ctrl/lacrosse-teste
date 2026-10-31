import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { InfoTooltip, InfoContent, InfoSection, InfoWarning } from '../ui/info-tooltip';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Activity, 
  Plus, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Info,
  Target,
  BarChart3,
  Calendar,
  Edit2,
  Save,
  X
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
  ComposedChart, Bar, Scatter
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CMJ_CONTEXTS = [
  { value: 'pre_training', label: 'Pre-Training' },
  { value: 'post_training', label: 'Post-Training' },
  { value: 'pre_competition', label: 'Pre-Competition' },
  { value: 'post_competition', label: 'Post-Competition' },
  { value: 'retest', label: 'Re-test / Re-evaluation' },
  { value: 'testing_session', label: 'Testing Session' },
];

// Amber reminder marker shown above CMJ bars whose day has a private staff observation
const NoteMarker = (props) => {
  const { cx, cy } = props;
  if (cx == null || cy == null || Number.isNaN(cy)) return null;
  return (
    <g>
      <circle cx={cx} cy={cy - 10} r={6} fill="#f59e0b" stroke="#0f172a" strokeWidth={1} />
      <circle cx={cx} cy={cy - 10} r={2} fill="#0f172a" />
    </g>
  );
};


export default function CMJSection({ athleteId, athleteName }) {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [cmjInfo, setCmjInfo] = useState(null);
  const [neuroData, setNeuroData] = useState(null);
  const [neuroDays, setNeuroDays] = useState(90);
  
  // Form states
  const [showBaselineForm, setShowBaselineForm] = useState(false);
  const [showTestForm, setShowTestForm] = useState(false);
  const [baselineForm, setBaselineForm] = useState({
    date: new Date().toISOString().split('T')[0],
    jump_height_cm: '',
    arms_used: true,
    footwear: 'shoes',
    notes: ''
  });
  const [testForm, setTestForm] = useState({
    date: new Date().toISOString().split('T')[0],
    context: 'pre_training',
    arms_used: true,
    trial_1: '',
    trial_2: '',
    trial_3: '',
    time_of_day: '',
    notes: ''
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, infoRes] = await Promise.all([
        axios.get(`${API}/cmj/athlete/${athleteId}/analytics`, getAuthHeaders()),
        axios.get(`${API}/cmj/info`)
      ]);
      setAnalytics(analyticsRes.data);
      setCmjInfo(infoRes.data);
    } catch (error) {
      console.error('Failed to fetch CMJ data:', error);
    } finally {
      setLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchNeuro = useCallback(async () => {
    try {
      const res = await axios.get(
        `${API}/cmj/athlete/${athleteId}/neuromuscular?days=${neuroDays}`,
        getAuthHeaders()
      );
      setNeuroData(res.data);
    } catch (error) {
      console.error('Failed to fetch neuromuscular data');
    }
  }, [athleteId, neuroDays, getAuthHeaders]);

  useEffect(() => {
    fetchNeuro();
  }, [fetchNeuro]);

  const handleSaveBaseline = async () => {
    if (!baselineForm.jump_height_cm) {
      toast.error('Please enter jump height');
      return;
    }
    
    try {
      await axios.post(
        `${API}/cmj/athlete/${athleteId}/baseline`,
        {
          ...baselineForm,
          jump_height_cm: parseFloat(baselineForm.jump_height_cm)
        },
        getAuthHeaders()
      );
      toast.success('Baseline saved successfully');
      setShowBaselineForm(false);
      fetchData();
    } catch (error) {
      toast.error('Failed to save baseline');
    }
  };

  const handleSaveTest = async () => {
    if (!testForm.trial_1 || !testForm.trial_2 || !testForm.trial_3) {
      toast.error('Please enter all 3 trials');
      return;
    }
    
    try {
      await axios.post(
        `${API}/cmj/athlete/${athleteId}/test`,
        {
          ...testForm,
          trial_1: parseFloat(testForm.trial_1),
          trial_2: parseFloat(testForm.trial_2),
          trial_3: parseFloat(testForm.trial_3)
        },
        getAuthHeaders()
      );
      toast.success('CMJ test recorded');
      setShowTestForm(false);
      setTestForm({
        date: new Date().toISOString().split('T')[0],
        context: 'pre_training',
        arms_used: true,
        trial_1: '',
        trial_2: '',
        trial_3: '',
        time_of_day: '',
        notes: ''
      });
      fetchData();
      fetchNeuro();
    } catch (error) {
      toast.error('Failed to save test');
    }
  };

  // Prepare chart data
  const chartData = analytics?.tests?.slice().reverse().map(test => ({
    date: test.date.slice(5),
    mean: test.cmj_mean,
    best: test.cmj_best,
    context: CMJ_CONTEXTS.find(c => c.value === test.context)?.label || test.context
  })) || [];

  const baselineHeight = analytics?.baseline?.jump_height_cm;

  // Neuromuscular readiness monitoring: CMJ (bars) + wellness/readiness + load (TRIMP)
  const neuroChartData = (neuroData?.points || []).map((p) => ({
    date: (p.date || '').slice(5),
    cmj: p.cmj_best,
    readiness: p.readiness,
    load: p.load,
    hasNote: p.has_staff_note,
    noteMarker: p.has_staff_note ? p.cmj_best : null,
  }));

  if (loading) {
    return (
      <Card className="glass border-white/5">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Activity className="w-6 h-6 animate-pulse text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* CMJ Header */}
      <Card className="glass border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  CMJ Monitoring
                  <InfoTooltip>
                    <InfoContent>
                      <InfoSection title="Counter Movement Jump">
                        {cmjInfo?.cmj_overview?.description}
                      </InfoSection>
                      <InfoWarning>
                        {cmjInfo?.interpretation_note?.description}
                      </InfoWarning>
                    </InfoContent>
                  </InfoTooltip>
                </CardTitle>
                <p className="text-xs text-muted-foreground">Neuromuscular status assessment</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowTestForm(true)}
                className="border-white/10"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Test
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-4">
          {/* Baseline Section */}
          <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Baseline</span>
                <InfoTooltip>
                  <InfoContent>
                    <InfoSection title="Baseline CMJ">
                      The baseline is the reference value for tracking changes. 
                      It should be measured when the athlete is fully rested and healthy.
                    </InfoSection>
                  </InfoContent>
                </InfoTooltip>
              </div>
              
              {analytics?.baseline ? (
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-primary">
                    {analytics.baseline.jump_height_cm} cm
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Set on {analytics.baseline.date}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setBaselineForm({
                        date: analytics.baseline.date,
                        jump_height_cm: analytics.baseline.jump_height_cm,
                        arms_used: analytics.baseline.arms_used,
                        footwear: analytics.baseline.footwear || 'shoes',
                        notes: analytics.baseline.notes || ''
                      });
                      setShowBaselineForm(true);
                    }}
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowBaselineForm(true)}
                  className="border-primary/30 text-primary"
                >
                  Set Baseline
                </Button>
              )}
            </div>
          </div>

          {/* Status and Thresholds */}
          {analytics?.latest_status && (
            <div className={`mb-4 p-3 rounded-lg border ${
              analytics.latest_status.level === 'red' ? 'bg-red-500/10 border-red-500/30' :
              analytics.latest_status.level === 'yellow' ? 'bg-amber-500/10 border-amber-500/30' :
              'bg-emerald-500/10 border-emerald-500/30'
            }`}>
              <div className="flex items-start gap-2">
                {analytics.latest_status.level === 'red' ? (
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" />
                ) : analytics.latest_status.level === 'yellow' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-medium">{analytics.latest_status.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{analytics.latest_status.recommendation}</p>
                </div>
              </div>
            </div>
          )}

          {/* Key Metrics */}
          {analytics?.tests?.length > 0 && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="text-center p-2 rounded-lg bg-muted/20">
                <p className="text-xs text-muted-foreground">Latest Mean</p>
                <p className="text-lg font-bold">{analytics.tests[0]?.cmj_mean} cm</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/20">
                <p className="text-xs text-muted-foreground">Latest Best</p>
                <p className="text-lg font-bold">{analytics.tests[0]?.cmj_best} cm</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/20">
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  CV%
                  <InfoTooltip>
                    <InfoContent>
                      <InfoSection title={cmjInfo?.cv_percent?.title}>
                        {cmjInfo?.cv_percent?.description}
                      </InfoSection>
                    </InfoContent>
                  </InfoTooltip>
                </p>
                <p className={`text-lg font-bold ${
                  analytics.tests[0]?.cv_percent > 10 ? 'text-amber-400' : ''
                }`}>
                  {analytics.tests[0]?.cv_percent}%
                </p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/20">
                <p className="text-xs text-muted-foreground">Δ vs Baseline</p>
                <p className={`text-lg font-bold ${
                  (analytics.tests[0]?.delta_mean_percent || 0) < -5 ? 'text-red-400' :
                  (analytics.tests[0]?.delta_mean_percent || 0) < 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {analytics.tests[0]?.delta_mean_percent !== null 
                    ? `${analytics.tests[0]?.delta_mean_percent > 0 ? '+' : ''}${analytics.tests[0]?.delta_mean_percent}%`
                    : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {/* Typical Error Info */}
          {analytics?.typical_error ? (
            <div className="mb-4 p-2 rounded bg-blue-500/10 border border-blue-500/20">
              <p className="text-xs flex items-center gap-1">
                <Info className="w-3 h-3" />
                Individual Typical Error: ±{analytics.typical_error} cm
                <InfoTooltip>
                  <InfoContent>
                    <InfoSection title={cmjInfo?.typical_error?.title}>
                      {cmjInfo?.typical_error?.description}
                    </InfoSection>
                  </InfoContent>
                </InfoTooltip>
              </p>
            </div>
          ) : analytics?.total_tests > 0 && (
            <div className="mb-4 p-2 rounded bg-muted/30 border border-white/5">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="w-3 h-3" />
                Not enough data to calculate individual threshold (need 3+ tests)
              </p>
            </div>
          )}

          {/* CMJ Timeline Chart */}
          {chartData.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                CMJ Timeline
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#64748b" domain={['auto', 'auto']} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1e293b', 
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    {baselineHeight && (
                      <ReferenceLine 
                        y={baselineHeight} 
                        stroke="#6366f1" 
                        strokeDasharray="5 5"
                        label={{ value: 'Baseline', fontSize: 9, fill: '#6366f1' }}
                      />
                    )}
                    <Line 
                      type="monotone" 
                      dataKey="mean" 
                      stroke="#8b5cf6" 
                      strokeWidth={2}
                      dot={{ fill: '#8b5cf6', r: 4 }}
                      name="Mean"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="best" 
                      stroke="#22c55e" 
                      strokeWidth={1}
                      dot={{ fill: '#22c55e', r: 3 }}
                      name="Best"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No CMJ tests recorded yet</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-3"
                onClick={() => setShowTestForm(true)}
              >
                Record First Test
              </Button>
            </div>
          )}

          {/* Neuromuscular Readiness Monitoring — CMJ (bars) + wellness/readiness + load (TRIMP) */}
          <div className="mt-6" data-testid="cmj-neuromuscular-chart">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Neuromuscular Readiness State Monitoring
                <InfoTooltip>
                  <InfoContent>
                    <InfoSection title="What it shows">
                      CMJ jump height (bars) per test day, overlaid with same-day wellness/readiness (0-10) and training load (TRIMP = duration × RPE). Falling jump height alongside low readiness and/or rising load can signal accumulated neuromuscular fatigue.
                    </InfoSection>
                  </InfoContent>
                </InfoTooltip>
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" data-testid="neuro-window-selector">
                  {[30, 90, 365].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setNeuroDays(d)}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${neuroDays === d ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                      data-testid={`neuro-window-${d}`}
                    >
                      {d === 365 ? '1y' : `${d}d`}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                  onClick={() => setShowTestForm(true)}
                  data-testid="neuro-add-cmj-btn"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add CMJ
                </Button>
              </div>
            </div>
            {neuroChartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={neuroChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" />
                    <YAxis yAxisId="cmj" tick={{ fontSize: 10 }} stroke="#38bdf8" domain={[(dMin) => Math.max(0, Math.floor(dMin) - 4), (dMax) => Math.ceil(dMax) + 2]} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#22c55e" domain={[0, 10]} />
                    <YAxis yAxisId="load" orientation="right" domain={[0, 'auto']} hide />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    {baselineHeight && (
                      <ReferenceLine
                        yAxisId="cmj"
                        y={baselineHeight}
                        stroke="#6366f1"
                        strokeDasharray="5 5"
                        label={{ value: 'Baseline', fontSize: 9, fill: '#6366f1' }}
                      />
                    )}
                    <Bar yAxisId="cmj" dataKey="cmj" name="CMJ height (cm)" fill="#38bdf8" radius={[3, 3, 0, 0]} barSize={22} />
                    <Line yAxisId="right" type="monotone" dataKey="readiness" name="Readiness (0-10)" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} connectNulls />
                    <Line yAxisId="load" type="monotone" dataKey="load" name="Load / TRIMP (AU)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" dot={{ fill: '#f59e0b', r: 2 }} connectNulls />
                    <Scatter yAxisId="cmj" dataKey="noteMarker" name="Staff observation" shape={<NoteMarker />} legendType="circle" fill="#f59e0b" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8 text-sm">No CMJ tests in this period to monitor</p>
            )}
          </div>

          {/* Recent Tests Table */}
          {analytics?.tests?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Recent Tests</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-2">Date</th>
                      <th className="text-left py-2 px-2">Context</th>
                      <th className="text-center py-2 px-2">Mean</th>
                      <th className="text-center py-2 px-2">Best</th>
                      <th className="text-center py-2 px-2">CV%</th>
                      <th className="text-center py-2 px-2">Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.tests.slice(0, 5).map((test, i) => (
                      <tr key={test.id} className="border-b border-white/5">
                        <td className="py-2 px-2">{test.date}</td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" className="text-[10px]">
                            {CMJ_CONTEXTS.find(c => c.value === test.context)?.label}
                          </Badge>
                        </td>
                        <td className="text-center py-2 px-2 font-medium">{test.cmj_mean}</td>
                        <td className="text-center py-2 px-2">{test.cmj_best}</td>
                        <td className={`text-center py-2 px-2 ${test.cv_percent > 10 ? 'text-amber-400' : ''}`}>
                          {test.cv_percent}%
                        </td>
                        <td className={`text-center py-2 px-2 ${
                          test.delta_mean_percent < -5 ? 'text-red-400' :
                          test.delta_mean_percent < 0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          {test.delta_mean_percent !== null 
                            ? `${test.delta_mean_percent > 0 ? '+' : ''}${test.delta_mean_percent}%`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Baseline Form Modal */}
      {showBaselineForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowBaselineForm(false)} />
          <Card className="relative z-10 w-full max-w-md mx-4 glass-heavy border-white/10">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="w-5 h-5" />
                {analytics?.baseline ? 'Update Baseline' : 'Set Baseline CMJ'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Date</Label>
                <Input 
                  type="date" 
                  value={baselineForm.date}
                  onChange={(e) => setBaselineForm({...baselineForm, date: e.target.value})}
                  className="bg-background/50 border-white/10"
                />
              </div>
              <div>
                <Label>Jump Height (cm)</Label>
                <Input 
                  type="number" 
                  step="0.1"
                  value={baselineForm.jump_height_cm}
                  onChange={(e) => setBaselineForm({...baselineForm, jump_height_cm: e.target.value})}
                  placeholder="e.g., 35.5"
                  className="bg-background/50 border-white/10"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="baseline-arms"
                  checked={baselineForm.arms_used}
                  onCheckedChange={(checked) => setBaselineForm({...baselineForm, arms_used: checked})}
                />
                <Label htmlFor="baseline-arms">Arms Used</Label>
              </div>
              <div>
                <Label>Footwear</Label>
                <Select 
                  value={baselineForm.footwear}
                  onValueChange={(v) => setBaselineForm({...baselineForm, footwear: v})}
                >
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shoes">Shoes</SelectItem>
                    <SelectItem value="barefoot">Barefoot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Textarea 
                  value={baselineForm.notes}
                  onChange={(e) => setBaselineForm({...baselineForm, notes: e.target.value})}
                  className="bg-background/50 border-white/10"
                  rows={2}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowBaselineForm(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleSaveBaseline} className="flex-1">
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test Form Modal */}
      {showTestForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowTestForm(false)} />
          <Card className="relative z-10 w-full max-w-md mx-4 glass-heavy border-white/10 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Record CMJ Test
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Date</Label>
                  <Input 
                    type="date" 
                    value={testForm.date}
                    onChange={(e) => setTestForm({...testForm, date: e.target.value})}
                    className="bg-background/50 border-white/10"
                  />
                </div>
                <div>
                  <Label>Time (optional)</Label>
                  <Input 
                    type="time" 
                    value={testForm.time_of_day}
                    onChange={(e) => setTestForm({...testForm, time_of_day: e.target.value})}
                    className="bg-background/50 border-white/10"
                  />
                </div>
              </div>
              <div>
                <Label>Context</Label>
                <Select 
                  value={testForm.context}
                  onValueChange={(v) => setTestForm({...testForm, context: v})}
                >
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CMJ_CONTEXTS.map(ctx => (
                      <SelectItem key={ctx.value} value={ctx.value}>{ctx.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="test-arms"
                  checked={testForm.arms_used}
                  onCheckedChange={(checked) => setTestForm({...testForm, arms_used: checked})}
                />
                <Label htmlFor="test-arms">Arms Used</Label>
              </div>
              
              <div className="p-3 rounded-lg bg-muted/30 border border-white/5">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  3 Trials (Jump Height in cm)
                  <InfoTooltip>
                    <InfoContent>
                      <InfoSection title={cmjInfo?.three_trials?.title}>
                        {cmjInfo?.three_trials?.description}
                      </InfoSection>
                    </InfoContent>
                  </InfoTooltip>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Trial 1</Label>
                    <Input 
                      type="number" 
                      step="0.1"
                      value={testForm.trial_1}
                      onChange={(e) => setTestForm({...testForm, trial_1: e.target.value})}
                      placeholder="cm"
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Trial 2</Label>
                    <Input 
                      type="number" 
                      step="0.1"
                      value={testForm.trial_2}
                      onChange={(e) => setTestForm({...testForm, trial_2: e.target.value})}
                      placeholder="cm"
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Trial 3</Label>
                    <Input 
                      type="number" 
                      step="0.1"
                      value={testForm.trial_3}
                      onChange={(e) => setTestForm({...testForm, trial_3: e.target.value})}
                      placeholder="cm"
                      className="bg-background/50 border-white/10"
                    />
                  </div>
                </div>
              </div>
              
              <div>
                <Label>Notes (optional)</Label>
                <Textarea 
                  value={testForm.notes}
                  onChange={(e) => setTestForm({...testForm, notes: e.target.value})}
                  className="bg-background/50 border-white/10"
                  rows={2}
                  placeholder="Any observations..."
                />
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowTestForm(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleSaveTest} className="flex-1">
                  <Save className="w-4 h-4 mr-1" />
                  Save Test
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
