import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Progress } from '../../components/ui/progress';
import { InfoTooltip, InfoContent, InfoSection, InfoList, InfoWarning } from '../../components/ui/info-tooltip';
import { AnatomicalPainViewer } from '../../components/ui/anatomical-pain-viewer';
import ExportModal from '../../components/ExportModal';
import CMJSection from '../../components/cmj/CMJSection';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  ArrowLeft, 
  TrendingUp, 
  Zap, 
  Activity,
  Calendar,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingDown,
  Download
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine, Legend, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ACWR Risk Zone Colors
const ACWR_COLORS = {
  UNDERTRAINING: '#3B82F6',
  'SWEET SPOT': '#10B981',
  CAUTION: '#F59E0B',
  DANGER: '#EF4444'
};

// Weekly Workload Classification - Individual Athlete
const WORKLOAD_THRESHOLDS = {
  LOW: 1500,        // < 1500 AU = Low
  MODERATE: 3000,   // 1500-3000 AU = Moderate
  HIGH: 3500,       // 3000-3500 AU = High
  VERY_HIGH: 4000   // > 4000 AU = Very High
};

const WORKLOAD_COLORS = {
  LOW: '#10B981',       // Green
  MODERATE: '#F59E0B',  // Yellow
  HIGH: '#F97316',      // Orange
  VERY_HIGH: '#EF4444'  // Red
};

// Get workload classification based on weekly load
const getWorkloadClassification = (weeklyLoad) => {
  if (weeklyLoad < WORKLOAD_THRESHOLDS.LOW) {
    return { label: 'Low', color: WORKLOAD_COLORS.LOW, description: 'Low training stimulus' };
  } else if (weeklyLoad <= WORKLOAD_THRESHOLDS.MODERATE) {
    return { label: 'Moderate', color: WORKLOAD_COLORS.MODERATE, description: 'Adequate training stimulus' };
  } else if (weeklyLoad <= WORKLOAD_THRESHOLDS.HIGH) {
    return { label: 'High', color: WORKLOAD_COLORS.HIGH, description: 'Elevated training load' };
  } else {
    return { label: 'Very High', color: WORKLOAD_COLORS.VERY_HIGH, description: 'Attention required' };
  }
};

// Custom Tooltip component defined outside to prevent re-renders
const CustomChartTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-heavy rounded-lg px-3 py-2 border border-white/10">
        <p className="text-sm font-medium mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }} className="text-sm">
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Individual athlete radar chart tooltip component
const AthleteRadarChartTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="glass-heavy rounded-lg px-3 py-2 border border-white/10">
        <p className="text-sm font-medium">{data.dimension}</p>
        <p className="text-primary font-bold">{data.value.toFixed(1)} / 10</p>
        <p className="text-xs text-muted-foreground mt-1">
          {data.value >= 7 ? '✅ Good' : data.value >= 5 ? '⚠️ Moderate' : '🔴 Low'}
        </p>
      </div>
    );
  }
  return null;
};

export default function AthleteDetail() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [athlete, setAthlete] = useState(null);
  const [readinessWithTeam, setReadinessWithTeam] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [workload, setWorkload] = useState(null);
  const [acwrGabbett, setAcwrGabbett] = useState(null);
  const [painReport, setPainReport] = useState(null);
  const [compliance, setCompliance] = useState(null);
  
  // Radar chart state
  const [radarData, setRadarData] = useState(null);
  const [radarDaysAgo, setRadarDaysAgo] = useState(0);
  const [radarLoading, setRadarLoading] = useState(false);
  
  // Pain map state
  const [painMapData, setPainMapData] = useState(null);
  const [painMapDaysAgo, setPainMapDaysAgo] = useState(0);
  const [painMapLoading, setPainMapLoading] = useState(false);
  
  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [athleteRes, readinessTeamRes, sessionsRes, workloadRes, acwrRes, painRes, complianceRes] = await Promise.all([
        axios.get(`${API}/staff/athlete/${athleteId}`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/readiness-with-team-avg?days=30`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/sessions?days=30`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/workload`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/acwr-gabbett`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/pain-report?days=90`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/compliance`, getAuthHeaders())
      ]);
      
      setAthlete(athleteRes.data);
      setReadinessWithTeam(readinessTeamRes.data);
      setSessions(sessionsRes.data);
      setWorkload(workloadRes.data);
      setAcwrGabbett(acwrRes.data);
      setPainReport(painRes.data);
      setCompliance(complianceRes.data);
    } catch (error) {
      toast.error('Failed to load athlete data');
    } finally {
      setLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch individual athlete radar data
  const fetchRadarData = useCallback(async (daysAgo = 0) => {
    setRadarLoading(true);
    try {
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/readiness-radar?days_ago=${daysAgo}`, getAuthHeaders());
      setRadarData(res.data);
    } catch (error) {
      console.error('Failed to load radar data');
    } finally {
      setRadarLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  // Load radar data when athleteId changes or days_ago changes
  useEffect(() => {
    fetchRadarData(radarDaysAgo);
  }, [fetchRadarData, radarDaysAgo]);

  const handleRadarDateChange = (daysAgo) => {
    setRadarDaysAgo(daysAgo);
  };

  // Fetch pain map data
  const fetchPainMapData = useCallback(async (daysAgo = 0) => {
    setPainMapLoading(true);
    try {
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/pain-map?days_ago=${daysAgo}`, getAuthHeaders());
      setPainMapData(res.data);
    } catch (error) {
      console.error('Failed to load pain map data');
    } finally {
      setPainMapLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  // Load pain map data when athleteId or days_ago changes
  useEffect(() => {
    fetchPainMapData(painMapDaysAgo);
  }, [fetchPainMapData, painMapDaysAgo]);

  const handlePainMapDateChange = (daysAgo) => {
    setPainMapDaysAgo(daysAgo);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  if (!athlete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Athlete not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="athlete-detail-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/staff')}
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-4">
            {athlete.profile_photo ? (
              <img 
                src={athlete.profile_photo.startsWith('http') ? athlete.profile_photo : `${process.env.REACT_APP_BACKEND_URL}${athlete.profile_photo}`} 
                alt={athlete.name} 
                className="w-12 h-12 rounded-xl object-cover" 
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-secondary/30 flex items-center justify-center text-xl font-bold">
                {athlete.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="font-heading font-bold text-xl">{athlete.name}</h1>
              <Badge variant="outline" className="border-primary/30 text-primary text-xs">
                {athlete.team}
              </Badge>
            </div>
          </div>
          
          {/* Export Button */}
          <div className="ml-auto">
            <Button 
              variant="outline" 
              size="sm"
              className="border-white/10 hover:bg-primary/10 hover:border-primary/30"
              onClick={() => setShowExportModal(true)}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {/* ACWR Gabbett Card */}
        {acwrGabbett && (
          <Card className={`mb-6 border-2 animate-fade-in`} style={{ borderColor: ACWR_COLORS[acwrGabbett.risk_zone] + '50' }}>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* ACWR Gauge */}
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2 flex items-center justify-center gap-1">
                    Acute:Chronic Workload Ratio
                    <InfoTooltip title="ACWR (Gabbett Method)">
                      <InfoContent>
                        <p className="mb-2">
                          The ACWR compares recent training load (acute = last 7 days) to long-term average (chronic = 28-day rolling average).
                        </p>
                        <InfoSection label="Formula">Acute Load ÷ Chronic Load</InfoSection>
                        <InfoSection label="Sweet Spot">0.8–1.3 (optimal adaptation)</InfoSection>
                        <InfoSection label="Risk">&gt;1.5 associated with increased injury risk</InfoSection>
                      </InfoContent>
                    </InfoTooltip>
                  </p>
                  <div 
                    className="text-5xl font-heading font-bold mb-2"
                    style={{ color: ACWR_COLORS[acwrGabbett.risk_zone] }}
                  >
                    {acwrGabbett.acwr.toFixed(2)}
                  </div>
                  <Badge 
                    className="text-sm px-3 py-1"
                    style={{ 
                      backgroundColor: ACWR_COLORS[acwrGabbett.risk_zone] + '20',
                      color: ACWR_COLORS[acwrGabbett.risk_zone],
                      borderColor: ACWR_COLORS[acwrGabbett.risk_zone]
                    }}
                  >
                    {acwrGabbett.risk_zone}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-2">{acwrGabbett.risk_description}</p>
                </div>

                {/* Load Values */}
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Acute Load (Current Week)
                      <InfoTooltip title="Acute Load" iconClassName="w-3 h-3">
                        <InfoContent>
                          Sum of internal load (sRPE × duration) from the last 7 days. Represents recent training stress.
                        </InfoContent>
                      </InfoTooltip>
                    </p>
                    <p className="text-2xl font-bold text-primary">{acwrGabbett.acute_load.toLocaleString()} AU</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Chronic Load (4-Week Avg)
                      <InfoTooltip title="Chronic Load" iconClassName="w-3 h-3">
                        <InfoContent>
                          28-day rolling average of weekly load. Represents the athlete&apos;s fitness baseline and training capacity.
                        </InfoContent>
                      </InfoTooltip>
                    </p>
                    <p className="text-2xl font-bold text-blue-400">{acwrGabbett.chronic_load.toLocaleString()} AU</p>
                  </div>
                </div>

                {/* Weekly Trend Chart */}
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground mb-2">Weekly Load Trend</p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={acwrGabbett.weekly_trend}>
                        <XAxis 
                          dataKey="week" 
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          axisLine={false}
                        />
                        <YAxis hide />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Bar dataKey="load" name="Load" radius={[4, 4, 0, 0]}>
                          {acwrGabbett.weekly_trend.map((entry, index) => (
                            <Cell 
                              key={index} 
                              fill={index === acwrGabbett.weekly_trend.length - 1 ? '#FFCC00' : '#3B82F6'} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Risk Zone Legend */}
              <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-white/10 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: ACWR_COLORS.UNDERTRAINING }} />
                  <span className="text-muted-foreground">&lt;0.8 Undertraining</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: ACWR_COLORS['SWEET SPOT'] }} />
                  <span className="text-muted-foreground">0.8-1.3 Sweet Spot</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: ACWR_COLORS.CAUTION }} />
                  <span className="text-muted-foreground">1.3-1.5 Caution</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: ACWR_COLORS.DANGER }} />
                  <span className="text-muted-foreground">&gt;1.5 Danger</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Stats Row */}
        {compliance && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <Card className="glass-light border-white/5">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-2 flex-wrap">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Daily Compliance</span>
                  <InfoTooltip title="Daily Compliance" iconClassName="w-3 h-3">
                    <InfoContent>
                      Percentage of expected morning check-ins completed in the last 7 days. Higher is better.
                    </InfoContent>
                  </InfoTooltip>
                </div>
                <p className="text-xl sm:text-2xl font-bold">{compliance.daily_compliance}%</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{compliance.daily_completed}/{compliance.daily_expected} days</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-2 flex-wrap">
                  <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Monthly</span>
                  <InfoTooltip title="Monthly Compliance" iconClassName="w-3 h-3">
                    <InfoContent>
                      Percentage of expected check-ins completed over 90 days. Indicates long-term engagement.
                    </InfoContent>
                  </InfoTooltip>
                </div>
                <p className="text-xl sm:text-2xl font-bold">{compliance.monthly_compliance}%</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{compliance.monthly_completed}/{compliance.monthly_expected} days</p>
              </CardContent>
            </Card>
            
            {painReport && (
              <>
                <Card className="glass-light border-white/5">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-1 sm:gap-2 mb-2 flex-wrap">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-[10px] sm:text-xs text-muted-foreground">High Pain</span>
                      <InfoTooltip title="High Pain Sessions" iconClassName="w-3 h-3">
                        <InfoContent>
                          Sessions where pain was reported ≥7/10. High count may indicate overtraining or injury risk.
                        </InfoContent>
                      </InfoTooltip>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold text-red-400">{painReport.high_pain_sessions_count}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">of {painReport.total_sessions} total</p>
                  </CardContent>
                </Card>
                
                <Card className="glass-light border-white/5">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-1 sm:gap-2 mb-2 flex-wrap">
                      <Activity className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-[10px] sm:text-xs text-muted-foreground">Affected</span>
                      <InfoTooltip title="Most Affected Region" iconClassName="w-3 h-3">
                        <InfoContent>
                          Body region most frequently associated with pain reports over the analysis period.
                        </InfoContent>
                      </InfoTooltip>
                    </div>
                    <p className="text-base sm:text-lg font-bold truncate">{painReport.most_affected_region || 'None'}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">body region</p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="readiness" className="animate-fade-in">
          <TabsList className="bg-muted/50 flex-wrap">
            <TabsTrigger value="readiness">Readiness</TabsTrigger>
            <TabsTrigger value="workload">Workload</TabsTrigger>
            <TabsTrigger value="cmj">CMJ</TabsTrigger>
            <TabsTrigger value="pain">Pain Report</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Readiness Tab with Team Comparison */}
          <TabsContent value="readiness" className="mt-4 space-y-4">
            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Readiness Score vs Team Average
                  <InfoTooltip title="Readiness Score">
                    <InfoContent>
                      <p className="mb-2">
                        Composite score (1-10) derived from morning check-in data: sleep quality, fatigue, muscle soreness, and stress levels.
                      </p>
                      <InfoSection label="Calculation">Weighted average of wellness indicators (inverted for negative metrics)</InfoSection>
                      <InfoSection label="Interpretation">≥7 = Ready, 5-6 = Moderate, &lt;5 = Low readiness</InfoSection>
                    </InfoContent>
                  </InfoTooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readinessWithTeam?.data || []}>
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
                      <Legend />
                      <ReferenceLine y={6} stroke="#F59E0B" strokeDasharray="3 3" />
                      <Line 
                        type="monotone" 
                        dataKey="athlete_score" 
                        name={athlete.name}
                        stroke="#FFCC00" 
                        strokeWidth={3}
                        dot={{ fill: '#FFCC00', strokeWidth: 0, r: 4 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="team_average" 
                        name="Team Average"
                        stroke="#3B82F6" 
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ fill: '#3B82F6', strokeWidth: 0, r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Yellow dashed line indicates minimum recommended readiness (6.0)
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Workload Tab */}
          <TabsContent value="workload" className="mt-4 space-y-4">
            {workload && (
              <>
                {/* Weekly Workload Classification Card */}
                <Card className="glass-light border-2" style={{ borderColor: getWorkloadClassification(workload.acute_load_7).color + '50' }}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                          Weekly Workload (7d)
                          <InfoTooltip title="Weekly Workload (AU)">
                            <InfoContent>
                              <p className="mb-2">Total Arbitrary Units accumulated over the last 7 days.</p>
                              <InfoSection label="Calculation">Sum of (Session Duration × RPE) for all sessions in the week.</InfoSection>
                            </InfoContent>
                            <InfoList items={[
                              { colorClass: 'bg-emerald-400', text: 'Low: <1500 AU - Insufficient stimulus' },
                              { colorClass: 'bg-amber-400', text: 'Moderate: 1500-3000 AU - Adequate training' },
                              { colorClass: 'bg-orange-400', text: 'High: 3000-3500 AU - Elevated load' },
                              { colorClass: 'bg-red-400', text: 'Very High: >4000 AU - Attention required' }
                            ]} />
                            <InfoWarning>These thresholds are monitoring tools. Interpret with readiness, pain, and recovery data.</InfoWarning>
                          </InfoTooltip>
                        </p>
                        <div className="flex items-baseline gap-3">
                          <p className="text-4xl sm:text-5xl font-bold" style={{ color: getWorkloadClassification(workload.acute_load_7).color }}>
                            {workload.acute_load_7.toLocaleString()}
                          </p>
                          <span className="text-lg text-muted-foreground">AU</span>
                        </div>
                        <Badge 
                          className="mt-2"
                          style={{ 
                            backgroundColor: getWorkloadClassification(workload.acute_load_7).color + '20',
                            color: getWorkloadClassification(workload.acute_load_7).color,
                            borderColor: getWorkloadClassification(workload.acute_load_7).color
                          }}
                        >
                          {getWorkloadClassification(workload.acute_load_7).label} Load
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {getWorkloadClassification(workload.acute_load_7).description}
                        </p>
                      </div>
                      
                      {/* Workload Legend */}
                      <div className="bg-muted/20 rounded-lg p-3 text-xs w-full sm:w-auto">
                        <p className="font-medium mb-2 text-muted-foreground">Workload Ranges</p>
                        <div className="grid grid-cols-2 sm:grid-cols-1 gap-1">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: WORKLOAD_COLORS.LOW }} />
                            <span>&lt;1500 Low</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: WORKLOAD_COLORS.MODERATE }} />
                            <span>1500-3000 Moderate</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: WORKLOAD_COLORS.HIGH }} />
                            <span>3000-3500 High</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: WORKLOAD_COLORS.VERY_HIGH }} />
                            <span>&gt;4000 Very High</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Additional Workload Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        Chronic Load (28d)
                        <InfoTooltip title="Chronic Load" iconClassName="w-3 h-3">
                          <InfoContent>
                            28-day rolling average weekly load. Represents fitness baseline and training capacity.
                          </InfoContent>
                        </InfoTooltip>
                      </p>
                      <p className="text-xl sm:text-2xl font-bold text-blue-400">{workload.chronic_load_28.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        Monotony
                        <InfoTooltip title="Training Monotony" iconClassName="w-3 h-3">
                          <InfoContent>
                            <p className="mb-2">Measures day-to-day variation in training load. Higher values mean less variety.</p>
                            <InfoSection label="Formula">Weekly Mean ÷ Standard Deviation</InfoSection>
                            <InfoSection label="Risk">&gt;2.0 may indicate excessive uniformity, increasing injury/illness risk.</InfoSection>
                          </InfoContent>
                        </InfoTooltip>
                      </p>
                      <p className={`text-xl sm:text-2xl font-bold ${(workload.weekly_monotony || 0) > 2 ? 'text-red-400' : ''}`}>
                        {workload.weekly_monotony?.toFixed(2) || '-'}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        Strain
                        <InfoTooltip title="Training Strain" iconClassName="w-3 h-3">
                          <InfoContent>
                            <p className="mb-2">Combines weekly load with monotony to estimate overall physiological stress.</p>
                            <InfoSection label="Formula">Weekly Load × Monotony</InfoSection>
                          </InfoContent>
                        </InfoTooltip>
                      </p>
                      <p className="text-xl sm:text-2xl font-bold">{workload.weekly_strain?.toLocaleString() || '-'}</p>
                    </CardContent>
                  </Card>
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        ACWR
                        <InfoTooltip title="Acute:Chronic Workload Ratio" iconClassName="w-3 h-3">
                          <InfoContent>
                            Acute Load ÷ Chronic Load. Sweet spot: 0.8-1.3
                          </InfoContent>
                        </InfoTooltip>
                      </p>
                      <p className="text-xl sm:text-2xl font-bold text-primary">
                        {workload.chronic_load_28 > 0 ? (workload.acute_load_7 / workload.chronic_load_28).toFixed(2) : '-'}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Integrated Monotony + Strain Chart */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-400" />
                      Monotony vs Strain Risk Map
                      <InfoTooltip title="Monotony vs Strain Risk Map">
                        <InfoContent>
                          <p className="mb-2">This chart plots monotony (x-axis) against strain (y-axis) to identify risky training patterns.</p>
                          <InfoSection label="Monotony">Weekly Mean Load ÷ SD (higher = less variation)</InfoSection>
                          <InfoSection label="Strain">Weekly Load × Monotony (overall stress)</InfoSection>
                        </InfoContent>
                        <InfoList items={[
                          { colorClass: 'bg-emerald-400', text: 'Green: Controlled stimulus (safe)' },
                          { colorClass: 'bg-amber-400', text: 'Yellow: Caution zone' },
                          { colorClass: 'bg-red-400', text: 'Red: High risk (excessive uniformity + load)' }
                        ]} />
                      </InfoTooltip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 sm:h-72 relative">
                      {/* Risk zone background */}
                      <div className="absolute inset-0 rounded-lg overflow-hidden">
                        {/* Green zone - bottom left */}
                        <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-emerald-500/10 border-r border-t border-emerald-500/20" />
                        {/* Yellow zone - diagonal */}
                        <div className="absolute top-0 left-0 w-1/2 h-1/2 bg-amber-500/10 border-r border-b border-amber-500/20" />
                        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-amber-500/10 border-l border-t border-amber-500/20" />
                        {/* Red zone - top right */}
                        <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-red-500/10 border-l border-b border-red-500/20" />
                      </div>
                      
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            type="number"
                            dataKey="monotony"
                            domain={[0, 4]}
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            label={{ value: 'Monotony', position: 'bottom', fill: '#94A3B8', fontSize: 11 }}
                          />
                          <YAxis 
                            type="number"
                            dataKey="strain"
                            domain={[0, 10000]}
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            label={{ value: 'Strain', angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11 }}
                          />
                          <ReferenceLine x={2} stroke="#F59E0B" strokeDasharray="3 3" />
                          <ReferenceLine y={5000} stroke="#F59E0B" strokeDasharray="3 3" />
                          <Tooltip content={<CustomChartTooltip />} />
                          <Line 
                            data={[{
                              monotony: workload.weekly_monotony || 0,
                              strain: workload.weekly_strain || 0,
                              name: 'Current Week'
                            }]}
                            type="monotone"
                            dataKey="strain"
                            stroke="#FFCC00"
                            strokeWidth={0}
                            dot={{ fill: '#FFCC00', stroke: '#FFCC00', strokeWidth: 2, r: 8 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                      
                      {/* Zone Legend */}
                      <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 text-[10px]">
                        <div className="flex items-center gap-1 bg-background/80 rounded px-2 py-1">
                          <div className="w-2 h-2 rounded bg-emerald-500/50" />
                          <span>Controlled</span>
                        </div>
                        <div className="flex items-center gap-1 bg-background/80 rounded px-2 py-1">
                          <div className="w-2 h-2 rounded bg-amber-500/50" />
                          <span>Caution</span>
                        </div>
                        <div className="flex items-center gap-1 bg-background/80 rounded px-2 py-1">
                          <div className="w-2 h-2 rounded bg-red-500/50" />
                          <span>High Risk</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* CMJ Tab */}
          <TabsContent value="cmj" className="mt-4 space-y-4">
            <CMJSection athleteId={athleteId} athleteName={athlete?.name} />
          </TabsContent>

          {/* Pain Report Tab */}
          <TabsContent value="pain" className="mt-4 space-y-4">
            {painReport && (
              <>
                {/* Persistent Pain Alerts */}
                {painReport.persistent_pain_alerts?.length > 0 && (
                  <Card className="border-red-500/30 bg-red-500/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-400">
                        <AlertTriangle className="w-4 h-4" />
                        Persistent Pain Alerts
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {painReport.persistent_pain_alerts.map((alert, i) => (
                        <div key={i} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <p className="font-medium">{alert.region}</p>
                          <p className="text-sm text-muted-foreground">
                            {alert.consecutive_days} consecutive days with high pain starting {alert.start_date}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {/* Region Analysis Table - expanded to full width */}
                  <Card className="glass-light border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        Pain Analysis by Region
                        <InfoTooltip title="Pain Analysis">
                          <InfoContent>
                            <p className="mb-2">Shows pain data aggregated by body region from training sessions over 28 days.</p>
                            <InfoSection label="Sessions">Number of sessions with pain in this region</InfoSection>
                            <InfoSection label="Avg Intensity">Mean pain level (1-10 scale)</InfoSection>
                            <InfoSection label="High Pain">Sessions with pain ≥7/10</InfoSection>
                          </InfoContent>
                        </InfoTooltip>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                        {painReport.region_analysis.map((region, i) => (
                          <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                            <div>
                              <p className="font-medium">{region.region}</p>
                              <p className="text-xs text-muted-foreground">{region.frequency} sessions</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm">Avg: {region.avg_intensity}/10</p>
                              <Badge variant="outline" className={region.high_pain_count > 0 ? 'border-red-500/30 text-red-400' : 'border-white/10'}>
                                {region.high_pain_count} high pain
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="mt-4 space-y-4">
            {compliance && (
              <>
                {/* Compliance Progress Bars */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Daily (7 days)</span>
                        <span className={`text-lg font-bold ${compliance.daily_compliance >= 80 ? 'text-emerald-400' : compliance.daily_compliance >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                          {compliance.daily_compliance}%
                        </span>
                      </div>
                      <Progress value={compliance.daily_compliance} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-2">
                        {compliance.daily_completed} of {compliance.daily_expected} check-ins
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="glass-light border-white/5">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Weekly (28 days)</span>
                        <span className={`text-lg font-bold ${compliance.weekly_compliance >= 80 ? 'text-emerald-400' : compliance.weekly_compliance >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                          {compliance.weekly_compliance}%
                        </span>
                      </div>
                      <Progress value={compliance.weekly_compliance} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-2">
                        {compliance.weekly_completed} of {compliance.weekly_expected} check-ins
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="glass-light border-white/5">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Monthly (90 days)</span>
                        <span className={`text-lg font-bold ${compliance.monthly_compliance >= 80 ? 'text-emerald-400' : compliance.monthly_compliance >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                          {compliance.monthly_compliance}%
                        </span>
                      </div>
                      <Progress value={compliance.monthly_compliance} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-2">
                        {compliance.monthly_completed} of {compliance.monthly_expected} check-ins
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Check-in Calendar */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Check-in Calendar (Last 14 Days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-7 gap-2">
                      {compliance.calendar.map((day, i) => (
                        <div 
                          key={i}
                          className={`p-2 rounded text-center ${day.checked_in ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/20'}`}
                        >
                          <p className="text-xs text-muted-foreground">{day.date.slice(5)}</p>
                          {day.checked_in ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto mt-1" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 mx-auto mt-1" />
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Recent Sessions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                  {sessions.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No sessions recorded</p>
                  ) : (
                    sessions.slice(-10).reverse().map((session) => (
                      <div key={session.id} className="p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{session.session_type}</span>
                          <Badge variant="outline" className="border-primary/30 text-primary">
                            Load: {session.internal_load}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{new Date(session.date_time_start).toLocaleDateString()}</span>
                          <span>{session.duration_min} min</span>
                          <span>RPE: {session.rpe}</span>
                          {session.pain_after > 0 && (
                            <span className={session.pain_after >= 5 ? 'text-red-400' : 'text-amber-400'}>
                              Pain: {session.pain_after}
                            </span>
                          )}
                        </div>
                        {/* Session Notes */}
                        {session.session_notes && (
                          <div className="mt-2 pt-2 border-t border-white/5">
                            <p className="text-xs text-amber-400/80 font-medium mb-1">📝 Notes:</p>
                            <p className="text-xs text-muted-foreground italic">{session.session_notes}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Recent Check-ins</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                  {readinessWithTeam?.data?.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No check-ins recorded</p>
                  ) : (
                    readinessWithTeam?.data?.slice(-10).reverse().map((r, i) => (
                      <div key={i} className="p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{r.date}</span>
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant="outline" 
                              className={r.athlete_score >= 7 ? 'border-emerald-500/30 text-emerald-400' : r.athlete_score >= 5 ? 'border-amber-500/30 text-amber-400' : 'border-red-500/30 text-red-400'}
                            >
                              {r.athlete_score?.toFixed(1)}
                            </Badge>
                            {r.team_average && (
                              <span className="text-xs text-muted-foreground">
                                vs {r.team_average.toFixed(1)} team
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground mt-2">
                          <span>Sleep: {r.sleep_quality}</span>
                          <span>Fatigue: {r.morning_fatigue}</span>
                          <span>Sore: {r.muscle_soreness}</span>
                          <span>Stress: {r.stress}</span>
                        </div>
                        {/* Morning Check-in Notes */}
                        {r.notes && (
                          <div className="mt-2 pt-2 border-t border-white/5">
                            <p className="text-xs text-cyan-400/80 font-medium mb-1">📝 Notes:</p>
                            <p className="text-xs text-muted-foreground italic">{r.notes}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Pain Location Anatomical Viewer */}
        <div className="mt-6 animate-fade-in">
          <Card className="glass-light border-red-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Pain Location Map
                  <InfoTooltip title="Anatomical Pain Viewer">
                    <InfoContent>
                      <p className="mb-2">Highlights self-reported pain locations from training sessions on the selected day.</p>
                      <p className="mb-2">
                        <span className="text-red-400">Red</span> = Severe (7-10) • 
                        <span className="text-amber-400"> Amber</span> = Moderate (4-6) • 
                        <span className="text-emerald-400"> Green</span> = Mild (1-3)
                      </p>
                    </InfoContent>
                    <InfoWarning>This is self-reported data, not a clinical assessment.</InfoWarning>
                  </InfoTooltip>
                </CardTitle>
                
                {/* Date Navigation */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Day:</span>
                  <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map((days) => (
                      <Button
                        key={days}
                        variant={painMapDaysAgo === days ? "default" : "outline"}
                        size="sm"
                        className={`text-xs px-2 py-1 h-7 ${painMapDaysAgo === days ? 'bg-red-500 hover:bg-red-600' : 'border-white/10'}`}
                        onClick={() => handlePainMapDateChange(days)}
                      >
                        {days === 0 ? 'Today' : days === 1 ? 'Yest' : `${days}d`}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Date info */}
              {painMapData && (
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>📅 {painMapData.date}</span>
                  <span>{painMapData.total_sessions} sessions</span>
                  <span className={painMapData.has_pain ? 'text-red-400' : 'text-emerald-400'}>
                    {painMapData.has_pain ? `⚠️ ${painMapData.pain_locations.length} pain areas` : '✅ No pain reported'}
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {painMapLoading ? (
                <div className="h-48 flex items-center justify-center">
                  <div className="animate-pulse text-primary">Loading pain data...</div>
                </div>
              ) : painMapData?.pain_locations?.length > 0 ? (
                <div className="flex flex-col lg:flex-row items-center gap-6">
                  {/* Anatomical Viewer */}
                  <div className="flex-1 flex justify-center">
                    <AnatomicalPainViewer painLocations={painMapData.pain_locations} />
                  </div>
                  
                  {/* Pain Details List */}
                  <div className="w-full lg:w-1/3 space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Pain Details</p>
                    {painMapData.pain_locations.map((pain, index) => (
                      <div key={index} className="flex items-center justify-between p-2 rounded bg-muted/20">
                        <div className="flex items-center gap-2">
                          <div 
                            className={`w-3 h-3 rounded-full ${
                              pain.severity === 'severe' ? 'bg-red-500' :
                              pain.severity === 'moderate' ? 'bg-amber-500' :
                              'bg-emerald-500'
                            }`}
                          />
                          <span className="text-sm font-medium">{pain.region}</span>
                          {pain.laterality && pain.laterality !== 'N/A' && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 border-white/20">
                              {pain.laterality === 'Both' ? 'Both' : pain.laterality}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${
                            pain.severity === 'severe' ? 'text-red-400' :
                            pain.severity === 'moderate' ? 'text-amber-400' :
                            'text-emerald-400'
                          }`}>
                            {pain.pain_level}/10
                          </span>
                          <span className="text-xs text-muted-foreground capitalize">{pain.severity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
                  <span className="text-4xl mb-3">✅</span>
                  <p className="text-sm">No pain reported for {painMapData?.date || 'this day'}</p>
                  <p className="text-xs mt-1">Athlete did not report any pain from sessions on this day</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Individual Daily Readiness Radar */}
        <div className="mt-6 animate-fade-in">
          <Card className="glass-light border-white/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  {athlete.name}&apos;s Daily Readiness Profile
                  <InfoTooltip title="Individual Wellness Radar">
                    <InfoContent>
                      <p className="mb-2">This radar shows the athlete&apos;s wellness profile for a specific day. Each axis represents a readiness dimension.</p>
                      <InfoSection label="Interpretation">Higher values (closer to edge) = Better wellness</InfoSection>
                    </InfoContent>
                    <InfoWarning>This is a daily snapshot showing individual data only, no team comparison.</InfoWarning>
                  </InfoTooltip>
                </CardTitle>
                
                {/* Date Navigation */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-2">Select Day:</span>
                  <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map((days) => (
                      <Button
                        key={days}
                        variant={radarDaysAgo === days ? "default" : "outline"}
                        size="sm"
                        className={`text-xs px-2 py-1 h-7 ${radarDaysAgo === days ? 'bg-cyan-500 hover:bg-cyan-600' : 'border-white/10'}`}
                        onClick={() => handleRadarDateChange(days)}
                      >
                        {days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Date info */}
              {radarData && (
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>📅 {radarData.date}</span>
                  <span>{radarData.has_data ? '✅ Check-in completed' : '❌ No check-in'}</span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {radarLoading ? (
                <div className="h-72 flex items-center justify-center">
                  <div className="animate-pulse text-primary">Loading radar data...</div>
                </div>
              ) : radarData?.radar_data?.length > 0 ? (
                <div className="flex flex-col lg:flex-row items-center gap-6">
                  {/* Radar Chart */}
                  <div className="h-72 w-full lg:w-2/3">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData.radar_data}>
                        <PolarGrid 
                          stroke="rgba(148, 163, 184, 0.45)"
                          strokeWidth={1.5}
                          gridType="polygon"
                        />
                        <PolarAngleAxis 
                          dataKey="dimension" 
                          tick={{ fill: '#CBD5E1', fontSize: 11, fontWeight: 600 }}
                          tickLine={{ stroke: 'rgba(148, 163, 184, 0.6)', strokeWidth: 1.5 }}
                        />
                        <PolarRadiusAxis 
                          angle={90} 
                          domain={[0, 10]} 
                          tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 500 }}
                          tickCount={6}
                          axisLine={{ stroke: 'rgba(148, 163, 184, 0.5)', strokeWidth: 1.5 }}
                          stroke="rgba(148, 163, 184, 0.5)"
                        />
                        <Radar
                          name={athlete.name}
                          dataKey="value"
                          stroke="#FFCC00"
                          fill="#FFCC00"
                          fillOpacity={0.25}
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: '#FFCC00', strokeWidth: 2, stroke: '#fff' }}
                        />
                        <Tooltip content={<AthleteRadarChartTooltip />} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Dimension Breakdown */}
                  <div className="w-full lg:w-1/3 space-y-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Dimension Breakdown</p>
                    {radarData.radar_data.map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-2 rounded bg-muted/20">
                        <span className="text-sm">{item.dimension}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted/30 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${item.value >= 7 ? 'bg-emerald-500' : item.value >= 5 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${(item.value / 10) * 100}%` }}
                            />
                          </div>
                          <span className={`text-sm font-medium w-8 ${item.value >= 7 ? 'text-emerald-400' : item.value >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                            {item.value.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    ))}
                    
                    {/* Overall Score */}
                    <div className="mt-4 pt-3 border-t border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Overall Readiness</span>
                        <span className={`text-lg font-bold ${
                          (radarData.radar_data.reduce((sum, item) => sum + item.value, 0) / radarData.radar_data.length) >= 7 
                            ? 'text-emerald-400' 
                            : (radarData.radar_data.reduce((sum, item) => sum + item.value, 0) / radarData.radar_data.length) >= 5 
                              ? 'text-amber-400' 
                              : 'text-red-400'
                        }`}>
                          {(radarData.radar_data.reduce((sum, item) => sum + item.value, 0) / radarData.radar_data.length).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-72 flex flex-col items-center justify-center text-muted-foreground">
                  <Activity className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">No check-in data for {radarData?.date || 'this day'}</p>
                  <p className="text-xs mt-1">Try selecting a different day</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      
      {/* Export Modal */}
      <ExportModal 
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        scope="individual"
        athleteId={athleteId}
        athleteName={athlete?.name}
      />
    </div>
  );
}
