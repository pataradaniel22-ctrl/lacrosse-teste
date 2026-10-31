import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { InfoTooltip, InfoContent, InfoWarning } from '../../components/ui/info-tooltip';
import { HelpTooltip } from '../../components/ui/help-tooltip';
import ExportModal from '../../components/ExportModal';
import CMJEvaluationDay from '../../components/cmj/CMJEvaluationDay';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  LogOut, 
  Users, 
  AlertTriangle, 
  TrendingUp, 
  Zap, 
  Activity,
  Bell,
  BarChart3,
  Clock,
  ChevronRight,
  Shield,
  User,
  Info,
  Calendar,
  Plus,
  Trash2,
  X,
  Download
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell
} from 'recharts';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Readiness risk threshold - values below this indicate potential concern
const READINESS_DANGER_THRESHOLD = 5;

// Color palette for athlete lines - distinct colors that work on dark backgrounds
const ATHLETE_COLORS = [
  '#FFCC00', // Brazil Yellow
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#F472B6', // Pink
  '#A78BFA', // Purple
  '#F97316', // Orange
  '#14B8A6', // Teal
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#22D3EE', // Cyan
];

// Custom Tooltip for Readiness chart with danger zone highlighting
const ReadinessChartTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const hasAtRiskValues = payload.some(entry => entry.value !== null && entry.value < READINESS_DANGER_THRESHOLD);
    return (
      <div className={`glass-heavy rounded-lg px-3 py-2 border ${hasAtRiskValues ? 'border-red-500/50 bg-red-500/10' : 'border-white/10'}`}>
        <p className="text-sm font-medium mb-1">{label}</p>
        {payload.map((entry, index) => {
          const isAtRisk = entry.value !== null && entry.value < READINESS_DANGER_THRESHOLD;
          return (
            <p key={index} className="text-sm flex items-center gap-1">
              <span 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              <span style={{ color: isAtRisk ? '#EF4444' : entry.color }}>
                {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
                {isAtRisk && <span className="ml-1 text-red-400 text-xs">⚠️</span>}
              </span>
            </p>
          );
        })}
        {hasAtRiskValues && (
          <p className="text-xs text-red-400 mt-1 pt-1 border-t border-red-500/20">
            Below danger threshold ({READINESS_DANGER_THRESHOLD})
          </p>
        )}
      </div>
    );
  }
  return null;
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

// Stable legend formatter to prevent re-renders
const legendFormatter = (value) => <span className="text-xs text-foreground">{value}</span>;

// Stable workload formatter for strain chart
const workloadFormatter = (value, name) => [value?.toLocaleString() || 'N/A', name === 'avg_strain' ? 'Avg Strain' : 'Avg Load'];

// Custom dot renderer for readiness chart with risk highlighting
const createReadinessDot = (colorIndex) => (props) => {
  const { cx, cy, payload, dataKey } = props;
  const value = payload[dataKey];
  if (value === null || value === undefined || cx === null || cy === null) return null;
  const isAtRisk = value < READINESS_DANGER_THRESHOLD;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isAtRisk ? 5 : 3}
      fill={isAtRisk ? '#EF4444' : ATHLETE_COLORS[colorIndex % ATHLETE_COLORS.length]}
      stroke={isAtRisk ? '#FCA5A5' : 'none'}
      strokeWidth={isAtRisk ? 2 : 0}
    />
  );
};

// Radar chart tooltip component
const RadarChartTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="glass-heavy rounded-lg px-3 py-2 border border-white/10">
        <p className="text-sm font-medium">{data.dimension}</p>
        <p className="text-cyan-400 font-bold">{data.value.toFixed(1)} / 10</p>
        <p className="text-xs text-muted-foreground mt-1">
          {data.value >= 7 ? '✅ Good' : data.value >= 5 ? '⚠️ Moderate' : '🔴 Low'}
        </p>
      </div>
    );
  }
  return null;
};

// ACWR tooltip helpers (need to be defined outside for component stability)
const getAcwrColorHelper = (acwr) => {
  if (acwr === null || acwr === undefined) return '#94A3B8';
  if (acwr > 1.5) return '#EF4444';
  if (acwr > 1.3) return '#F59E0B';
  if (acwr >= 0.8) return '#10B981';
  return '#3B82F6';
};

const getAcwrCategoryHelper = (acwr) => {
  if (acwr === null || acwr === undefined) return 'N/A';
  if (acwr > 1.5) return 'High Risk';
  if (acwr > 1.3) return 'Caution';
  if (acwr >= 0.8) return 'Safe';
  return 'Undertraining';
};

// ACWR chart tooltip component
const AcwrChartTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="glass-heavy rounded-lg px-3 py-2 border border-white/10">
        <p className="text-sm font-medium">{data.name}</p>
        <p className="text-sm">ACWR: <span className="font-bold" style={{ color: getAcwrColorHelper(data.acwr) }}>{data.acwr?.toFixed(2) || 'N/A'}</span></p>
        <p className="text-xs mt-1" style={{ color: getAcwrColorHelper(data.acwr) }}>
          {getAcwrCategoryHelper(data.acwr)}
        </p>
      </div>
    );
  }
  return null;
};

export default function StaffDashboard() {
  const { user, logout, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState('all');
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [chartAthletes, setChartAthletes] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [acwrData, setAcwrData] = useState([]);
  const [longTermData, setLongTermData] = useState(null);
  const [menstrualStats, setMenstrualStats] = useState(null);
  const [painAnalytics, setPainAnalytics] = useState(null);
  const [workloadMetrics, setWorkloadMetrics] = useState(null);
  
  // Analysis Context state
  const [analysisContext, setAnalysisContext] = useState('season'); // 'season' or 'event'
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDashboard, setEventDashboard] = useState(null);
  const [eventDay, setEventDay] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({ name: '', event_type: 'training_camp', start_date: '', end_date: '', description: '' });
  
  // Radar chart state
  const [radarData, setRadarData] = useState(null);
  const [radarDaysAgo, setRadarDaysAgo] = useState(0);
  const [radarLoading, setRadarLoading] = useState(false);
  
  // Daily pain state
  const [dailyPainData, setDailyPainData] = useState(null);
  const [dailyPainDaysAgo, setDailyPainDaysAgo] = useState(0);
  const [dailyPainLoading, setDailyPainLoading] = useState(false);
  
  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  
  // CMJ Evaluation Day modal state
  const [showCMJModal, setShowCMJModal] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}` : '';
      const daysParam = teamFilter !== 'all' ? '&days=14' : '?days=14';
      const monthsParam = teamFilter !== 'all' ? '&months=3' : '?months=3';
      const menstrualDaysParam = teamFilter !== 'all' ? '&days=7' : '?days=7';
      const painDaysParam = teamFilter !== 'all' ? '&days=90' : '?days=90';
      const weeksParam = teamFilter !== 'all' ? '&weeks=4' : '?weeks=4';
      const [statsRes, chartsRes, athletesRes, alertsRes, acwrRes, longTermRes, menstrualRes, painRes, workloadRes] = await Promise.all([
        axios.get(`${API}/staff/dashboard/stats${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/charts${teamParam}${daysParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/athletes${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/alerts${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/acwr${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/longterm${teamParam}${monthsParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/menstrual-stats${teamParam}${menstrualDaysParam}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/staff/dashboard/pain-analytics${teamParam}${painDaysParam}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/staff/dashboard/workload-metrics${teamParam}${weeksParam}`, getAuthHeaders()).catch(() => ({ data: null }))
      ]);
      
      setStats(statsRes.data);
      setCharts(chartsRes.data);
      setChartAthletes(chartsRes.data.athletes || []);
      setAthletes(athletesRes.data);
      setAlerts(alertsRes.data);
      setAcwrData(acwrRes.data);
      setLongTermData(longTermRes.data);
      setMenstrualStats(menstrualRes.data);
      setPainAnalytics(painRes.data);
      setWorkloadMetrics(workloadRes.data);
    } catch (error) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [teamFilter, getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch radar data
  const fetchRadarData = useCallback(async (daysAgo = 0) => {
    setRadarLoading(true);
    try {
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${daysAgo}` : `?days_ago=${daysAgo}`;
      const res = await axios.get(`${API}/staff/dashboard/readiness-radar${teamParam}`, getAuthHeaders());
      setRadarData(res.data);
    } catch (error) {
      console.error('Failed to load radar data');
    } finally {
      setRadarLoading(false);
    }
  }, [teamFilter, getAuthHeaders]);

  // Load radar data when team filter changes or days_ago changes
  useEffect(() => {
    fetchRadarData(radarDaysAgo);
  }, [fetchRadarData, radarDaysAgo]);

  const handleRadarDateChange = (daysAgo) => {
    setRadarDaysAgo(daysAgo);
  };

  // Fetch daily pain data
  const fetchDailyPainData = useCallback(async (daysAgo = 0) => {
    setDailyPainLoading(true);
    try {
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${daysAgo}` : `?days_ago=${daysAgo}`;
      const res = await axios.get(`${API}/staff/dashboard/daily-pain${teamParam}`, getAuthHeaders());
      setDailyPainData(res.data);
    } catch (error) {
      console.error('Failed to load daily pain data');
    } finally {
      setDailyPainLoading(false);
    }
  }, [teamFilter, getAuthHeaders]);

  // Load daily pain data when team filter or days_ago changes
  useEffect(() => {
    fetchDailyPainData(dailyPainDaysAgo);
  }, [fetchDailyPainData, dailyPainDaysAgo]);

  const handleDailyPainDateChange = (daysAgo) => {
    setDailyPainDaysAgo(daysAgo);
  };

  // Fetch events for context selector
  const fetchEvents = useCallback(async () => {
    try {
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&include_past=true` : '?include_past=true';
      const res = await axios.get(`${API}/staff/events${teamParam}`, getAuthHeaders());
      setEvents(res.data);
    } catch (error) {
      console.error('Failed to load events');
    }
  }, [teamFilter, getAuthHeaders]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Fetch event dashboard when event is selected
  const fetchEventDashboard = useCallback(async (eventId, day = null) => {
    try {
      const dayParam = day ? `?day=${day}` : '';
      const res = await axios.get(`${API}/staff/events/${eventId}/dashboard${dayParam}`, getAuthHeaders());
      setEventDashboard(res.data);
      setEventDay(res.data.current_day);
    } catch (error) {
      console.error('Failed to load event dashboard');
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (analysisContext === 'event' && selectedEvent) {
      fetchEventDashboard(selectedEvent.id, eventDay);
    }
  }, [analysisContext, selectedEvent, fetchEventDashboard, eventDay]);

  const handleEventDayChange = (day) => {
    setEventDay(day);
    if (selectedEvent) {
      fetchEventDashboard(selectedEvent.id, day);
    }
  };

  const handleCreateEvent = async () => {
    try {
      const res = await axios.post(`${API}/staff/events`, {
        ...eventForm,
        team: teamFilter !== 'all' ? teamFilter : null
      }, getAuthHeaders());
      toast.success('Event created successfully');
      setShowEventModal(false);
      setEventForm({ name: '', event_type: 'training_camp', start_date: '', end_date: '', description: '' });
      fetchEvents();
      // Auto-select the new event
      setSelectedEvent(res.data.event);
      setAnalysisContext('event');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create event');
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm('Are you sure you want to delete this event?')) return;
    try {
      await axios.delete(`${API}/staff/events/${eventId}`, getAuthHeaders());
      toast.success('Event deleted');
      fetchEvents();
      if (selectedEvent?.id === eventId) {
        setSelectedEvent(null);
        setAnalysisContext('season');
      }
    } catch (error) {
      toast.error('Failed to delete event');
    }
  };

  // Get ACWR risk color based on value
  const getAcwrColor = (acwr) => {
    if (acwr === null || acwr === undefined) return '#94A3B8'; // gray
    if (acwr > 1.5) return '#EF4444'; // red - high risk
    if (acwr > 1.3) return '#F59E0B'; // amber - caution
    if (acwr >= 0.8) return '#10B981'; // green - safe
    return '#3B82F6'; // blue - undertraining
  };

  const getAcwrCategory = (acwr) => {
    if (acwr === null || acwr === undefined) return 'N/A';
    if (acwr > 1.5) return 'High Risk';
    if (acwr > 1.3) return 'Caution';
    if (acwr >= 0.8) return 'Safe';
    return 'Undertraining';
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'Red': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'Yellow': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="staff-dashboard">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          {/* Mobile-first header layout */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            {/* Logo and Title - Left side */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <img 
                src="/brazil-lacrosse-logo.png" 
                alt="Brazil Lacrosse"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain shrink-0"
              />
              <div className="min-w-0">
                <h1 className="font-heading font-bold text-sm sm:text-lg truncate">Brazil Lacrosse</h1>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">Staff Dashboard • {user?.name}</p>
              </div>
            </div>
            
            {/* Controls - Right side, wraps on mobile */}
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap sm:flex-nowrap sm:ml-auto">
              {/* Team Filter */}
              <Select value={teamFilter} onValueChange={setTeamFilter}>
                <SelectTrigger className="w-[130px] sm:w-48 bg-background/50 border-white/10 text-xs sm:text-sm h-8 sm:h-10" data-testid="team-filter">
                  <SelectValue placeholder="Filter by team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  <SelectItem value="Brazil Lacrosse Men">Men&apos;s Team</SelectItem>
                  <SelectItem value="Brazil Lacrosse Women">Women&apos;s Team</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Analysis Context Selector */}
              <div className="flex items-center gap-1 sm:gap-2">
                <Select 
                  value={analysisContext} 
                  onValueChange={(val) => {
                    setAnalysisContext(val);
                    if (val === 'season') {
                      setSelectedEvent(null);
                      setEventDashboard(null);
                    }
                  }}
                >
                  <SelectTrigger className="w-24 sm:w-32 bg-background/50 border-white/10 text-xs sm:text-sm h-8 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="season">
                      <span className="flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        Season
                      </span>
                    </SelectItem>
                    <SelectItem value="event">
                      <span className="flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Event
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                {analysisContext === 'event' && (
                  <>
                    <Select 
                      value={selectedEvent?.id || ''} 
                      onValueChange={(val) => {
                        const event = events.find(e => e.id === val);
                        setSelectedEvent(event);
                        if (event) fetchEventDashboard(event.id);
                      }}
                    >
                      <SelectTrigger className="w-28 sm:w-40 bg-background/50 border-white/10 text-xs sm:text-sm h-8 sm:h-10">
                        <SelectValue placeholder="Select event..." />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map(event => (
                          <SelectItem key={event.id} value={event.id}>
                            {event.name}
                          </SelectItem>
                        ))}
                        {events.length === 0 && (
                          <div className="px-2 py-1 text-xs text-muted-foreground">No events</div>
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      className="border-white/10 h-8 w-8 sm:h-9 sm:w-9 shrink-0"
                      onClick={() => setShowEventModal(true)}
                    >
                      <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                    </Button>
                  </>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex items-center gap-1 sm:gap-2 ml-auto sm:ml-0">
                {/* CMJ Evaluation Day Button - Visible on all screen sizes */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 sm:h-9 border-white/10 hover:bg-violet-500/10 hover:border-violet-500/30 flex items-center"
                  onClick={() => setShowCMJModal(true)}
                  title="CMJ Evaluation Day"
                  data-testid="cmj-day-btn"
                >
                  <Activity className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">CMJ Day</span>
                </Button>
                
                {/* Export Button */}
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8 sm:h-9 sm:w-9 border-white/10 hover:bg-primary/10 hover:border-primary/30"
                  onClick={() => setShowExportModal(true)}
                  title="Export Data"
                >
                  <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
                
                {/* Admin Panel Link - Only visible to Admins */}
                {user?.role === 'Admin' && (
                  <Link to="/staff/admin">
                    <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="admin-panel-btn">
                      <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    </Button>
                  </Link>
                )}
                
                <Link to="/staff/alerts">
                  <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="alerts-nav-btn">
                    <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                    {alerts.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-destructive text-[8px] sm:text-[10px] flex items-center justify-center font-bold">
                        {alerts.length}
                      </span>
                    )}
                  </Button>
                </Link>
                
                {/* Profile Photo / Settings Link */}
                <Link to="/staff/profile">
                  {user?.profile_photo ? (
                    <img 
                      src={user.profile_photo.startsWith('http') ? user.profile_photo : `${process.env.REACT_APP_BACKEND_URL}${user.profile_photo}`}
                      alt={user.name}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border-2 border-white/20 hover:border-primary/50 transition-colors"
                    />
                  ) : (
                    <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="profile-btn">
                      <User className="w-4 h-4 sm:w-5 sm:h-5" />
                    </Button>
                  )}
                </Link>
                
                <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 sm:h-9 sm:w-9" data-testid="logout-btn">
                  <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4 mb-4 sm:mb-6">
            <Card className="glass-light border-white/5 animate-fade-in">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <Users className="w-3 sm:w-4 h-3 sm:h-4 text-blue-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Athletes</span>
                  <HelpTooltip metricKey="totalAthletes" />
                </div>
                <p className="text-2xl sm:text-3xl font-heading font-bold">{stats.total_athletes}</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '50ms' }}>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <TrendingUp className="w-3 sm:w-4 h-3 sm:h-4 text-emerald-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Readiness</span>
                  <HelpTooltip metricKey="avgReadiness" />
                </div>
                <p className="text-2xl sm:text-3xl font-heading font-bold">{stats.avg_readiness_7_days?.toFixed(1) || 'N/A'}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">7-day avg</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '100ms' }}>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <Zap className="w-3 sm:w-4 h-3 sm:h-4 text-primary shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Total Load</span>
                  <HelpTooltip metricKey="teamTotalLoad" />
                </div>
                <p className="text-2xl sm:text-3xl font-heading font-bold">{(stats.team_total_load_7_days || 0).toLocaleString()}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">AU (7-day sum)</p>
              </CardContent>
            </Card>
            
            <Card className="glass-light border-white/5 animate-fade-in" style={{ animationDelay: '125ms' }}>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <Activity className="w-3 sm:w-4 h-3 sm:h-4 text-purple-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Avg Load</span>
                  <HelpTooltip metricKey="avgLoadPerAthlete" />
                </div>
                <p className="text-2xl sm:text-3xl font-heading font-bold">{(stats.avg_load_per_athlete_7_days || 0).toLocaleString()}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">AU (7-day avg)</p>
              </CardContent>
            </Card>
            
            <Card className={`glass-light border-white/5 animate-fade-in ${stats.active_alerts > 0 ? 'border-amber-500/30' : ''}`} style={{ animationDelay: '150ms' }}>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <AlertTriangle className={`w-3 sm:w-4 h-3 sm:h-4 ${stats.active_alerts > 0 ? 'text-amber-400' : 'text-muted-foreground'} shrink-0`} />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Alerts</span>
                  <HelpTooltip metricKey="activeAlerts" />
                </div>
                <p className={`text-2xl sm:text-3xl font-heading font-bold ${stats.active_alerts > 0 ? 'text-amber-400' : ''}`}>
                  {stats.active_alerts}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{stats.missing_check_ins} missing</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts & Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Charts Section */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <Tabs defaultValue="short" className="animate-fade-in">
              <TabsList className="bg-muted/50 flex-wrap">
                <TabsTrigger value="short" className="text-xs sm:text-sm">Short Term</TabsTrigger>
                <TabsTrigger value="medium" className="text-xs sm:text-sm">Medium Term</TabsTrigger>
                <TabsTrigger value="long" className="text-xs sm:text-sm">Long Term</TabsTrigger>
              </TabsList>

              <TabsContent value="short" className="mt-3 sm:mt-4 space-y-4">
                {/* Readiness Chart - Individual Athlete Lines with Risk Threshold */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      Daily Readiness Score by Athlete
                      <HelpTooltip metricKey="dailyReadiness" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts?.readiness || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          
                          {/* Danger Zone - Red shaded area below threshold */}
                          <ReferenceArea 
                            y1={0} 
                            y2={READINESS_DANGER_THRESHOLD} 
                            fill="#EF4444" 
                            fillOpacity={0.08}
                            strokeOpacity={0}
                          />
                          
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
                          
                          {/* Danger Threshold Line */}
                          <ReferenceLine 
                            y={READINESS_DANGER_THRESHOLD} 
                            stroke="#EF4444" 
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            label={{ 
                              value: `Risk Threshold (${READINESS_DANGER_THRESHOLD})`, 
                              position: 'insideTopRight',
                              fill: '#EF4444',
                              fontSize: 10,
                              fontWeight: 500
                            }}
                          />
                          
                          <RechartsTooltip content={<ReadinessChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {chartAthletes.map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={createReadinessDot(index)}
                              activeDot={{ r: 6, strokeWidth: 2 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Legend for danger zone */}
                    <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-white/5 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-0.5 bg-red-500" style={{ borderTop: '2px dashed #EF4444' }} />
                        <span className="text-muted-foreground">Risk Threshold ({READINESS_DANGER_THRESHOLD})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-red-300" />
                        <span className="text-muted-foreground">At-Risk Data Point</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-3 bg-red-500/20 rounded-sm" />
                        <span className="text-muted-foreground">Danger Zone</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Load Chart - Individual Athlete Lines */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      Daily Internal Load by Athlete
                      <HelpTooltip metricKey="dailyInternalLoad" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts?.load || []}>
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
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {chartAthletes.map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={{ fill: ATHLETE_COLORS[index % ATHLETE_COLORS.length], strokeWidth: 0, r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Team Daily Readiness Radar - 3rd Chart */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        Team Daily Readiness Profile
                        <InfoTooltip title="Daily Wellness Radar">
                          <InfoContent>
                            Team average wellness profile for a specific day. 
                            Each axis = readiness dimension. Higher values = better.
                          </InfoContent>
                          <InfoWarning>Daily snapshot only, not a trend.</InfoWarning>
                        </InfoTooltip>
                      </CardTitle>
                      
                      {/* Date Navigation */}
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3, 4, 5, 6].map((days) => (
                          <Button
                            key={days}
                            variant={radarDaysAgo === days ? "default" : "outline"}
                            size="sm"
                            className={`text-xs px-2 py-0.5 h-6 ${radarDaysAgo === days ? 'bg-cyan-500 hover:bg-cyan-600' : 'border-white/10'}`}
                            onClick={() => handleRadarDateChange(days)}
                          >
                            {days === 0 ? 'Today' : days === 1 ? 'Yest' : `${days}d`}
                          </Button>
                        ))}
                      </div>
                    </div>
                    
                    {radarData && (
                      <p className="text-xs text-muted-foreground mt-1">
                        📅 {radarData.date} • 👥 {radarData.athletes_count || 0}/{radarData.total_athletes || 0} checked in
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {radarLoading ? (
                      <div className="h-64 flex items-center justify-center">
                        <div className="animate-pulse text-primary text-sm">Loading...</div>
                      </div>
                    ) : radarData?.radar_data?.length > 0 ? (
                      <div className="flex flex-col lg:flex-row items-center gap-4">
                        {/* Radar Chart */}
                        <div className="h-64 w-full lg:w-2/3">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData.radar_data}>
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
                                name="Team Average"
                                dataKey="value"
                                stroke="#22D3EE"
                                fill="#22D3EE"
                                fillOpacity={0.25}
                                strokeWidth={2.5}
                                dot={{ r: 5, fill: '#22D3EE', strokeWidth: 2, stroke: '#fff' }}
                              />
                              <RechartsTooltip content={<RadarChartTooltip />} />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                        
                        {/* Breakdown */}
                        <div className="w-full lg:w-1/3 space-y-2">
                          {radarData.radar_data.map((item, index) => (
                            <div key={index} className="flex items-center justify-between p-1.5 rounded bg-muted/20">
                              <span className="text-xs">{item.dimension}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full ${item.value >= 7 ? 'bg-emerald-500' : item.value >= 5 ? 'bg-amber-500' : 'bg-red-500'}`}
                                    style={{ width: `${(item.value / 10) * 100}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-medium w-6 ${item.value >= 7 ? 'text-emerald-400' : item.value >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                                  {item.value.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          ))}
                          <p className="text-[9px] text-muted-foreground pt-1 border-t border-white/5">
                            <span className="text-emerald-400">■</span> 7-10: Good |{' '}
                            <span className="text-amber-400">■</span> 5-6.9: Moderate |{' '}
                            <span className="text-red-400">■</span> &lt;5: Low
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                        <Activity className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-sm">No check-in data for {radarData?.date || 'this day'}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Daily Pain by Body Region - 4th Chart */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        Daily Pain by Body Region
                        <InfoTooltip title="Daily Pain Snapshot">
                          <InfoContent>
                            Pain frequency by body region for the selected day. Self-reported after training.
                          </InfoContent>
                        </InfoTooltip>
                      </CardTitle>
                      
                      {/* Date Navigation */}
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3, 4, 5, 6].map((days) => (
                          <Button
                            key={days}
                            variant={dailyPainDaysAgo === days ? "default" : "outline"}
                            size="sm"
                            className={`text-xs px-2 py-0.5 h-6 ${dailyPainDaysAgo === days ? 'bg-red-500 hover:bg-red-600' : 'border-white/10'}`}
                            onClick={() => handleDailyPainDateChange(days)}
                          >
                            {days === 0 ? 'Today' : days === 1 ? 'Yest' : `${days}d`}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {dailyPainData && (
                      <p className="text-xs text-muted-foreground mt-1">
                        📅 {dailyPainData.date} • {dailyPainData.sessions_with_pain} pain reports from {dailyPainData.total_sessions} sessions
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {dailyPainLoading ? (
                      <div className="h-32 flex items-center justify-center">
                        <div className="animate-pulse text-primary text-sm">Loading...</div>
                      </div>
                    ) : dailyPainData?.pain_regions?.length > 0 ? (
                      <div className="space-y-2">
                        {dailyPainData.pain_regions.slice(0, 5).map((region, index) => (
                          <div key={index} className="flex items-center justify-between p-2 rounded bg-muted/20">
                            <div className="flex items-center gap-2">
                              {index === 0 && <span className="text-xs">🔥</span>}
                              <span className="text-sm font-medium">{region.region}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-20 h-2 bg-muted/30 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${region.severe_count > 0 ? 'bg-red-500' : region.avg_pain >= 5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.min((region.count / Math.max(...dailyPainData.pain_regions.map(r => r.count))) * 100, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-14">{region.count} reports</span>
                              <span className={`text-xs font-medium w-8 ${region.avg_pain >= 7 ? 'text-red-400' : region.avg_pain >= 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {region.avg_pain}/10
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                        <span className="text-2xl mb-2">✅</span>
                        <p className="text-sm">No pain reports for {dailyPainData?.date || 'this day'}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="medium" className="mt-4 space-y-4">
                {/* ACWR Chart with Risk Coloring */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-400" />
                      ACWR by Athlete
                      <HelpTooltip metricKey="acwrOverview" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={acwrData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            type="number"
                            domain={[0, 2]}
                            tick={{ fill: '#94A3B8', fontSize: 11 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                            ticks={[0, 0.5, 0.8, 1.0, 1.3, 1.5, 2.0]}
                          />
                          <YAxis 
                            type="category"
                            dataKey="name"
                            width={100}
                            tick={{ fill: '#94A3B8', fontSize: 11 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <RechartsTooltip content={<AcwrChartTooltip />} />
                          {/* Reference lines for risk zones */}
                          <ReferenceLine x={0.8} stroke="#3B82F6" strokeDasharray="3 3" strokeWidth={1} />
                          <ReferenceLine x={1.3} stroke="#F59E0B" strokeDasharray="3 3" strokeWidth={1} />
                          <ReferenceLine x={1.5} stroke="#EF4444" strokeDasharray="3 3" strokeWidth={1} />
                          <Bar 
                            dataKey="acwr" 
                            name="ACWR"
                            radius={[0, 4, 4, 0]}
                          >
                            {acwrData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={getAcwrColor(entry.acwr)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-blue-500" />
                        <span className="text-muted-foreground">Undertraining (&lt;0.8)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-emerald-500" />
                        <span className="text-muted-foreground">Safe (0.8-1.3)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-amber-500" />
                        <span className="text-muted-foreground">Caution (1.3-1.5)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-red-500" />
                        <span className="text-muted-foreground">High Risk (&gt;1.5)</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Pain Chart - Individual Athlete Lines */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Pain After Sessions by Athlete
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts?.pain || []}>
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
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {chartAthletes.map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={{ fill: ATHLETE_COLORS[index % ATHLETE_COLORS.length], strokeWidth: 0, r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Weekly Workload Metrics - Improved Layout */}
                {workloadMetrics && (
                  <Card className="glass-light border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        Weekly Workload Analysis
                        <HelpTooltip metricKey="monotony" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Left: Team Strain Trend Chart */}
                        {workloadMetrics.team_averages?.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-medium text-muted-foreground">Team Strain Trend</p>
                              <div className="flex items-center gap-2 text-[10px]">
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-0.5 bg-cyan-400" />
                                  <span>Strain</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <div className="w-3 h-0.5 bg-gray-400 border-dashed border-t" />
                                  <span>Load</span>
                                </div>
                              </div>
                            </div>
                            <div className="h-40">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={workloadMetrics.team_averages}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                  <XAxis 
                                    dataKey="week" 
                                    tick={{ fill: '#94A3B8', fontSize: 9 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                  />
                                  <YAxis 
                                    tick={{ fill: '#94A3B8', fontSize: 9 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                  />
                                  <RechartsTooltip 
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                  />
                                  <Line 
                                    type="monotone" 
                                    dataKey="avg_strain"
                                    name="Avg Strain"
                                    stroke="#22D3EE" 
                                    strokeWidth={2}
                                    dot={{ fill: '#22D3EE', strokeWidth: 0, r: 4 }}
                                  />
                                  <Line 
                                    type="monotone" 
                                    dataKey="avg_load"
                                    name="Avg Load"
                                    stroke="#94A3B8" 
                                    strokeWidth={1}
                                    strokeDasharray="5 5"
                                    dot={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {/* Right: Athlete Monotony List */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-muted-foreground">Athlete Monotony</p>
                            <div className="flex items-center gap-2 text-[9px]">
                              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" />Good</span>
                              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500" />Mod</span>
                              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" />High</span>
                            </div>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {workloadMetrics.athlete_metrics?.map((athlete) => (
                              <div 
                                key={athlete.athlete_id}
                                className="flex items-center justify-between p-2 rounded bg-muted/20 hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <div 
                                    className={`w-2 h-2 rounded-full ${
                                      athlete.latest_status === 'green' ? 'bg-emerald-500' :
                                      athlete.latest_status === 'yellow' ? 'bg-amber-500' :
                                      athlete.latest_status === 'red' ? 'bg-red-500' :
                                      'bg-gray-500'
                                    }`}
                                  />
                                  <span className="text-xs font-medium truncate max-w-[80px]">{athlete.athlete_name.split(' ')[0]}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={`font-medium ${
                                    athlete.latest_status === 'green' ? 'text-emerald-400' :
                                    athlete.latest_status === 'yellow' ? 'text-amber-400' :
                                    athlete.latest_status === 'red' ? 'text-red-400' :
                                    'text-muted-foreground'
                                  }`}>
                                    M:{athlete.latest_monotony?.toFixed(1) || 'N/A'}
                                  </span>
                                  <span className="text-cyan-400">
                                    S:{athlete.latest_strain ? (athlete.latest_strain / 1000).toFixed(0) + 'k' : 'N/A'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      {/* Footer Legend */}
                      <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
                        <p className="text-[10px] text-muted-foreground">
                          M = Monotony (training variation) | S = Strain (cumulative stress)
                        </p>
                        <p className="text-[10px] text-muted-foreground italic">
                          ⓘ For monitoring only
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="long" className="mt-4 space-y-4">
                {/* Monthly Cumulative Load */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-primary" />
                      Monthly Cumulative Load (AU)
                      <HelpTooltip metricKey="monthlyLoad" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={longTermData?.monthly_load || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="month" 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <YAxis 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {(longTermData?.athletes || []).map((name, index) => (
                            <Bar 
                              key={name}
                              dataKey={name}
                              name={name}
                              fill={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              radius={[2, 2, 0, 0]}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Chronic Load Trend (28-day rolling) */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      Chronic Load Trend (28-day Rolling)
                      <HelpTooltip metricKey="chronicLoadTrend" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={longTermData?.chronic_trend || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="week" 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <YAxis 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {(longTermData?.athletes || []).map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={{ fill: ATHLETE_COLORS[index % ATHLETE_COLORS.length], strokeWidth: 0, r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Weekly Readiness Trend */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      Weekly Readiness Average
                      <HelpTooltip metricKey="readinessTrend" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={longTermData?.readiness_trend || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="week" 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <YAxis 
                            domain={[0, 10]} 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {(longTermData?.athletes || []).map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={{ fill: ATHLETE_COLORS[index % ATHLETE_COLORS.length], strokeWidth: 0, r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Pain Distribution & Compliance */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Enhanced Pain by Body Region - Heatmap Style */}
                  <Card className="glass-light border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        Pain by Body Region (90 days)
                        <HelpTooltip metricKey="painByRegion" />
                        {painAnalytics?.most_affected_region && (
                          <Badge variant="outline" className="border-red-500/50 text-red-400 ml-auto">
                            Most Affected: {painAnalytics.most_affected_region.region}
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {painAnalytics?.region_ranking?.length > 0 ? (
                        <div className="space-y-2">
                          {/* Summary Stats */}
                          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                            <div className="p-2 rounded bg-muted/30">
                              <p className="text-lg font-bold">{painAnalytics.sessions_with_pain}</p>
                              <p className="text-[10px] text-muted-foreground">Pain Sessions</p>
                            </div>
                            <div className="p-2 rounded bg-muted/30">
                              <p className="text-lg font-bold">{painAnalytics.pain_rate}%</p>
                              <p className="text-[10px] text-muted-foreground">Pain Rate</p>
                            </div>
                            <div className="p-2 rounded bg-red-500/10">
                              <p className="text-lg font-bold text-red-400">
                                {painAnalytics.region_ranking.reduce((sum, r) => sum + r.severe_pain_count, 0)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">Severe Cases</p>
                            </div>
                          </div>
                          
                          {/* Region Ranking */}
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {painAnalytics.region_ranking.map((region, idx) => {
                              const maxReports = painAnalytics.region_ranking[0]?.total_reports || 1;
                              const barWidth = (region.total_reports / maxReports) * 100;
                              const isTopRegion = idx === 0;
                              
                              return (
                                <div key={region.region} className={`relative p-2 rounded ${isTopRegion ? 'bg-red-500/20 border border-red-500/30' : 'bg-muted/20'}`}>
                                  <div 
                                    className={`absolute inset-y-0 left-0 rounded ${isTopRegion ? 'bg-red-500/30' : 'bg-red-500/10'}`}
                                    style={{ width: `${barWidth}%` }}
                                  />
                                  <div className="relative flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {isTopRegion && <span className="text-red-400">🔥</span>}
                                      <span className={`text-xs font-medium ${isTopRegion ? 'text-red-400' : ''}`}>
                                        {region.region}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">
                                        {region.total_reports} reports
                                      </span>
                                      <Badge 
                                        variant="outline" 
                                        className={`text-[10px] ${region.avg_intensity >= 7 ? 'border-red-500/50 text-red-400' : region.avg_intensity >= 5 ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400'}`}
                                      >
                                        avg {region.avg_intensity}
                                      </Badge>
                                      {region.severe_pain_count > 0 && (
                                        <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-400">
                                          {region.severe_pain_count} severe
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          
                          {/* Most Affected Athletes */}
                          {painAnalytics.athlete_breakdown?.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/10">
                              <p className="text-xs text-muted-foreground mb-2">Top Affected Athletes:</p>
                              <div className="flex flex-wrap gap-1">
                                {painAnalytics.athlete_breakdown.slice(0, 5).map((a, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px]">
                                    {a.athlete_name} ({a.most_affected_region}: {a.pain_count}x)
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">
                          <p>No pain data available</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Athlete Compliance */}
                  <Card className="glass-light border-white/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Clock className="w-4 h-4 text-purple-400" />
                        Check-in Compliance
                        <HelpTooltip metricKey="compliance" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {(longTermData?.compliance || []).map((athlete, index) => (
                          <div key={athlete.name} className="flex items-center justify-between p-2 rounded bg-muted/30">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: ATHLETE_COLORS[index % ATHLETE_COLORS.length] }}
                              />
                              <span className="text-sm font-medium">{athlete.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className={athlete.compliance >= 80 ? 'border-emerald-500/30 text-emerald-400' : athlete.compliance >= 50 ? 'border-amber-500/30 text-amber-400' : 'border-red-500/30 text-red-400'}>
                                {athlete.compliance}%
                              </Badge>
                              {athlete.high_pain_sessions > 0 && (
                                <Badge variant="outline" className="border-red-500/30 text-red-400">
                                  {athlete.high_pain_sessions} pain
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Training Consistency */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4 text-purple-400" />
                      Weekly Training Consistency (Sessions/Week)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={longTermData?.consistency || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis 
                            dataKey="week" 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <YAxis 
                            tick={{ fill: '#94A3B8', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          />
                          <RechartsTooltip content={<CustomChartTooltip />} />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                            formatter={legendFormatter}
                          />
                          {(longTermData?.athletes || []).map((name, index) => (
                            <Line 
                              key={name}
                              type="monotone" 
                              dataKey={name}
                              name={name}
                              stroke={ATHLETE_COLORS[index % ATHLETE_COLORS.length]} 
                              strokeWidth={2}
                              dot={{ fill: ATHLETE_COLORS[index % ATHLETE_COLORS.length], strokeWidth: 0, r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Female Team Wellness Monitor (positioned above Active Alerts) */}
            {menstrualStats && menstrualStats.total_female_athletes > 0 && (teamFilter === 'all' || teamFilter === 'Brazil Lacrosse Women') && (
              <Card className="glass-light border-pink-500/20 animate-fade-in">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className="text-pink-400">🌸</span>
                    Female Team Wellness Monitor
                    <HelpTooltip metricKey="menstrualTracking" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-2 rounded-lg bg-pink-500/10">
                      <p className="text-xl font-bold text-pink-400">{menstrualStats.athletes_on_period_today}</p>
                      <p className="text-[10px] text-muted-foreground">On Period Today</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-pink-500/5">
                      <p className="text-xl font-bold">{menstrualStats.total_female_athletes}</p>
                      <p className="text-[10px] text-muted-foreground">Female Athletes</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-pink-500/5">
                      <p className="text-xl font-bold">{menstrualStats.period_rate}%</p>
                      <p className="text-[10px] text-muted-foreground">Period Rate</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-red-500/10">
                      <p className={`text-xl font-bold ${menstrualStats.high_pain_alerts?.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {menstrualStats.high_pain_alerts?.length || 0}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Pain Alerts</p>
                    </div>
                  </div>
                  
                  {/* Severe Symptoms Alert */}
                  {menstrualStats.severe_symptoms_today?.length > 0 && (
                    <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                      <p className="text-xs font-medium text-red-400 mb-1">⚠️ Severe Menstrual Symptoms</p>
                      <div className="flex flex-wrap gap-1">
                        {menstrualStats.severe_symptoms_today.map((s, i) => (
                          <Badge key={i} variant="outline" className="border-red-500/50 text-red-400 text-[10px]">
                            {s.athlete_name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* High Pain Alerts */}
                  {menstrualStats.high_pain_alerts?.filter(a => a.alert_type === 'COMBINED_HIGH_PAIN').length > 0 && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <p className="text-xs font-medium text-amber-400 mb-1">🔥 Combined High Pain</p>
                      <div className="flex flex-wrap gap-1">
                        {menstrualStats.high_pain_alerts.filter(a => a.alert_type === 'COMBINED_HIGH_PAIN').map((a, i) => (
                          <Badge key={i} variant="outline" className="border-amber-500/50 text-amber-400 text-[10px]">
                            {a.athlete_name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Active Alerts */}
            <Card className="glass-light border-white/5 animate-fade-in">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Active Alerts
                  </div>
                  <Link to="/staff/alerts" className="text-xs text-primary hover:underline">
                    View all
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No active alerts</p>
                ) : (
                  alerts.slice(0, 5).map((alert) => (
                    <div 
                      key={alert.id} 
                      className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{alert.athlete_name}</span>
                        <Badge variant="outline" className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-xs opacity-80">{alert.message}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Athletes List */}
            <Card className="glass-light border-white/5 animate-fade-in">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  Athletes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {athletes.map((athlete) => (
                  <Link 
                    key={athlete.id} 
                    to={`/staff/athlete/${athlete.id}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors group"
                    data-testid={`athlete-link-${athlete.id}`}
                  >
                    <div className="flex items-center gap-3">
                      {athlete.profile_photo ? (
                        <img 
                          src={athlete.profile_photo.startsWith('http') ? athlete.profile_photo : `${process.env.REACT_APP_BACKEND_URL}${athlete.profile_photo}`}
                          alt={athlete.name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-secondary/30 flex items-center justify-center text-sm font-bold">
                          {athlete.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-sm">{athlete.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {athlete.team.includes('Men') ? "Men's" : "Women's"}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Event Creation Modal */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md glass-heavy border-white/10">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-medium">Create New Event</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowEventModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-name">Event Name</Label>
                <Input
                  id="event-name"
                  placeholder="e.g., World Championships 2025"
                  value={eventForm.name}
                  onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                  className="bg-background/50 border-white/10"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="event-type">Event Type</Label>
                <Select 
                  value={eventForm.event_type} 
                  onValueChange={(val) => setEventForm({ ...eventForm, event_type: val })}
                >
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="training_camp">Training Camp</SelectItem>
                    <SelectItem value="tournament">Tournament</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={eventForm.start_date}
                    onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })}
                    className="bg-background/50 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={eventForm.end_date}
                    onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                    className="bg-background/50 border-white/10"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="Event notes..."
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  className="bg-background/50 border-white/10"
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowEventModal(false)}>Cancel</Button>
                <Button 
                  onClick={handleCreateEvent}
                  disabled={!eventForm.name || !eventForm.start_date || !eventForm.end_date}
                >
                  Create Event
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Export Modal */}
      <ExportModal 
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        scope="team"
      />
      
      {/* CMJ Evaluation Day Modal */}
      <CMJEvaluationDay 
        isOpen={showCMJModal}
        onClose={() => setShowCMJModal(false)}
      />
    </div>
  );
}
