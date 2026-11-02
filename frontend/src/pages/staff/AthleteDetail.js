import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Progress } from '../../components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoTooltip, InfoContent, InfoSection, InfoList, InfoWarning } from '../../components/ui/info-tooltip';
import { ChartCaption, HelpTooltip } from '../../components/ui/help-tooltip';
import { AnatomicalPainViewer } from '../../components/ui/anatomical-pain-viewer';
import ExportModal from '../../components/ExportModal';
import CMJSection from '../../components/cmj/CMJSection';
import NutritionHydration from '../../components/NutritionHydration';
import StaffFeedbackPanel from '../../components/StaffFeedbackPanel';
import AthleteRecord from '../../components/AthleteRecord';
import AthleteIirHistory from '../../components/iir/AthleteIirHistory';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  ArrowLeft, 
  TrendingUp, 
  Zap, 
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Target,
  AlertTriangle,
  HeartPulse,
  CheckCircle2,
  XCircle,
  TrendingDown,
  Download,
  Trash2,
  ArrowUpDown,
  StickyNote,
  Save,
  Lock,
  BarChart3,
  Camera,
  X
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine, Legend, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, ComposedChart
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

// Blue-family palette (matches the requested donut aesthetic)
// Distinct, high-contrast color per training type (consistent across the donut and the list)
const SESSION_TYPE_COLOR_MAP = {
  conditioning: '#f59e0b', // amber
  match: '#ef4444',        // red
  game: '#ef4444',
  strength: '#3b82f6',     // blue
  tactical: '#a855f7',     // purple
  technical: '#10b981',    // emerald
  speed: '#ec4899',        // pink
  recovery: '#14b8a6',     // teal
  mobility: '#14b8a6',
  unspecified: '#94a3b8',  // slate
};
const SESSION_TYPE_FALLBACK = ['#f97316', '#22d3ee', '#84cc16', '#e879f9', '#fb7185', '#eab308', '#38bdf8'];
function sessionTypeColor(name) {
  const key = (name || '').trim().toLowerCase();
  if (SESSION_TYPE_COLOR_MAP[key]) return SESSION_TYPE_COLOR_MAP[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SESSION_TYPE_FALLBACK[h % SESSION_TYPE_FALLBACK.length];
}

// Distribution donut of the training session types the athlete logs at check-in
function SessionTypeDonut({ sessions }) {
  const { data, total } = useMemo(() => {
    const counts = {};
    (sessions || []).forEach((s) => {
      const t = (s.session_type || '').trim() || 'Unspecified';
      counts[t] = (counts[t] || 0) + 1;
    });
    const tot = Object.values(counts).reduce((a, b) => a + b, 0);
    const arr = Object.entries(counts)
      .map(([name, value]) => ({ name, value, pct: tot ? (value / tot) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
    return { data: arr, total: tot };
  }, [sessions]);

  return (
    <Card className="glass-light border-white/5" data-testid="session-type-distribution">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-400" />
          Training Type Distribution
          <Badge variant="outline" className="text-[10px] border-white/10">{total} sessions</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">No sessions recorded in this period</p>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                  label={({ pct }) => `${pct.toFixed(1)}%`}
                  labelLine={false}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={sessionTypeColor(entry.name)} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  allowEscapeViewBox={{ x: true, y: true }}
                  formatter={(value, name, props) => [`${value} session${value > 1 ? 's' : ''} (${props.payload.pct.toFixed(1)}%)`, name]}
                  contentStyle={{ background: 'rgba(17,17,17,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, maxHeight: 72, overflowY: 'auto' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


export default function AthleteDetail() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const { getAuthHeaders, user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [loading, setLoading] = useState(true);
  const [athlete, setAthlete] = useState(null);
  const [readinessWithTeam, setReadinessWithTeam] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionWindow, setSessionWindow] = useState(30);
  const [sessionTypeFilter, setSessionTypeFilter] = useState('all');
  const [sessionSort, setSessionSort] = useState({ key: 'date', dir: 'desc' });
  const [sessionModal, setSessionModal] = useState(null);
  const [staffNoteText, setStaffNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [wlrData, setWlrData] = useState(null);
  const [painReport, setPainReport] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [monthCal, setMonthCal] = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  
  // Radar chart state
  const [radarData, setRadarData] = useState(null);
  const [radarDaysAgo, setRadarDaysAgo] = useState(0);
  const [radarLoading, setRadarLoading] = useState(false);
  
  // Pain map state
  const [painMapData, setPainMapData] = useState(null);
  const [activeTab, setActiveTab] = useState('readiness');
  const [painMapDaysAgo, setPainMapDaysAgo] = useState(0);
  const [painMapLoading, setPainMapLoading] = useState(false);
  // Deep-link: arriving from a red readiness point opens the pain tab on that day
  const [initialFocusDate] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('date'); } catch { return null; }
  });
  const focusHandledRef = useRef(false);
  
  // Menstrual status state (for female athletes)
  const [menstrualStatus, setMenstrualStatus] = useState(null);
  const [menstrualDaysAgo, setMenstrualDaysAgo] = useState(0);
  const [menstrualLoading, setMenstrualLoading] = useState(false);
  
  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  
  // Admin deletion state
  const [deleteSessionDialog, setDeleteSessionDialog] = useState({ open: false, session: null });
  const [deleteCheckInDialog, setDeleteCheckInDialog] = useState({ open: false, checkIn: null });
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [athleteRes, readinessTeamRes, sessionsRes, workloadRes, painRes, complianceRes, wlrRes] = await Promise.all([
        axios.get(`${API}/staff/athlete/${athleteId}`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/readiness-with-team-avg?days=30`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/sessions?days=30`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/workload`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/pain-report?days=90`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/compliance`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/workload-readiness?days=30`, getAuthHeaders())
      ]);
      
      setAthlete(athleteRes.data);
      setReadinessWithTeam(readinessTeamRes.data);
      setSessions(sessionsRes.data);
      setWorkload(workloadRes.data);
      setPainReport(painRes.data);
      setCompliance(complianceRes.data);
      setMonthCal(complianceRes.data.month_calendar);
      setWlrData(wlrRes.data);
    } catch (error) {
      toast.error('Failed to load athlete data');
    } finally {
      setLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Change the check-in calendar month (delta = -1 previous / +1 next)
  const changeMonth = useCallback(async (delta) => {
    if (!monthCal) return;
    const [y, m] = monthCal.month_str.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setMonthLoading(true);
    try {
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/compliance?month=${target}`, getAuthHeaders());
      setMonthCal(res.data.month_calendar);
    } catch (e) {
      toast.error('Failed to load month');
    } finally {
      setMonthLoading(false);
    }
  }, [monthCal, athleteId, getAuthHeaders]);

  // Re-fetch training sessions when the window (30/90/365 days) changes
  const fetchSessions = useCallback(async (days) => {
    try {
      const [res, wlrRes] = await Promise.all([
        axios.get(`${API}/staff/athlete/${athleteId}/sessions?days=${days}`, getAuthHeaders()),
        axios.get(`${API}/staff/athlete/${athleteId}/workload-readiness?days=${days}`, getAuthHeaders()),
      ]);
      setSessions(res.data);
      setWlrData(wlrRes.data);
    } catch (error) {
      console.error('Failed to load sessions');
    }
  }, [athleteId, getAuthHeaders]);

  const sessionWindowInit = useRef(true);
  useEffect(() => {
    // Skip the very first run (fetchData already loads the default 30d window),
    // but always refetch on any subsequent window change — including back to 30d.
    if (sessionWindowInit.current) {
      sessionWindowInit.current = false;
      return;
    }
    if (athleteId) fetchSessions(sessionWindow);
  }, [athleteId, sessionWindow, fetchSessions]);

  const sessionPhotoUrl = (pid) =>
    `${API}/sessions/photo/${pid}?auth=${(getAuthHeaders().headers?.Authorization || '').replace('Bearer ', '')}`;

  // Sync the private staff-note editor whenever a different session modal opens
  useEffect(() => {
    setStaffNoteText(sessionModal?.staff_note || '');
  }, [sessionModal?.id]);

  const saveStaffNote = async () => {
    if (!sessionModal) return;
    setSavingNote(true);
    try {
      const res = await axios.put(
        `${API}/staff/athlete/${athleteId}/session/${sessionModal.id}/note`,
        { note: staffNoteText },
        getAuthHeaders()
      );
      const patch = {
        staff_note: res.data.staff_note,
        staff_note_author: res.data.staff_note_author,
        staff_note_updated_at: res.data.staff_note_updated_at,
      };
      setSessions((prev) => prev.map((s) => (s.id === sessionModal.id ? { ...s, ...patch } : s)));
      setSessionModal((prev) => (prev ? { ...prev, ...patch } : prev));
      toast.success(patch.staff_note ? 'Private observation saved' : 'Observation cleared');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save observation');
    } finally {
      setSavingNote(false);
    }
  };

  const toggleSessionSort = (key) => {
    setSessionSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const sessionTypeOptions = [...new Set(sessions.map((s) => s.session_type).filter(Boolean))];

  // Individual "Pain After Sessions" time series (max post-session pain per day)
  const painAfterSeries = useMemo(() => {
    const byDay = {};
    (sessions || []).forEach((s) => {
      if (!s.date_time_start) return;
      const day = s.date_time_start.slice(0, 10);
      const p = Number(s.pain_after || 0);
      byDay[day] = byDay[day] === undefined ? p : Math.max(byDay[day], p);
    });
    return Object.keys(byDay).sort().map((day) => ({ date: day, pain: byDay[day] }));
  }, [sessions]);

  const displayedSessions = [...sessions]
    .filter((s) => sessionTypeFilter === 'all' || s.session_type === sessionTypeFilter)
    .sort((a, b) => {
      const dir = sessionSort.dir === 'asc' ? 1 : -1;
      const key = sessionSort.key;
      let av; let bv;
      if (key === 'date') { av = a.date_time_start || ''; bv = b.date_time_start || ''; }
      else if (key === 'type') { av = a.session_type || ''; bv = b.session_type || ''; }
      else if (key === 'pain') { av = a.pain_after || 0; bv = b.pain_after || 0; }
      else { av = a[key] || 0; bv = b[key] || 0; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

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

  // Fetch pain map data (explicitDate wins over daysAgo)
  const fetchPainMapData = useCallback(async (daysAgo = 0, autoSelectLatest = false, explicitDate = null) => {
    setPainMapLoading(true);
    try {
      const q = explicitDate ? `date=${explicitDate}` : `days_ago=${daysAgo}`;
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/pain-map?${q}`, getAuthHeaders());
      
      // On initial load, if the current day has no pain, jump to the most recent date that does
      if (autoSelectLatest && !res.data.has_pain && res.data.available_dates?.length > 0) {
        const mostRecentDate = res.data.available_dates[0];
        if (mostRecentDate && mostRecentDate !== res.data.date) {
          const newRes = await axios.get(`${API}/staff/athlete/${athleteId}/pain-map?date=${mostRecentDate}`, getAuthHeaders());
          setPainMapData(newRes.data);
          setPainMapLoading(false);
          return;
        }
      }
      
      setPainMapData(res.data);
    } catch (error) {
      console.error('Failed to load pain map data');
    } finally {
      setPainMapLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  // Load pain map data when athleteId or days_ago changes
  useEffect(() => {
    // Deep-link: on first load with a ?date=, open the pain tab on that exact day
    if (!focusHandledRef.current && initialFocusDate) {
      focusHandledRef.current = true;
      setActiveTab('pain');
      fetchPainMapData(0, false, initialFocusDate);
      toast.info(`Showing this athlete's day: ${initialFocusDate}`);
      return;
    }
    // On initial load, try to auto-select latest date with data
    fetchPainMapData(painMapDaysAgo, painMapDaysAgo === 0);
  }, [fetchPainMapData, painMapDaysAgo, initialFocusDate]);

  const handlePainMapDateChange = (daysAgo) => {
    setPainMapDaysAgo(daysAgo);
  };

  // Fetch menstrual status for female athletes
  const fetchMenstrualStatus = useCallback(async (daysAgo = 0) => {
    setMenstrualLoading(true);
    try {
      const res = await axios.get(`${API}/staff/athlete/${athleteId}/menstrual-status?days_ago=${daysAgo}`, getAuthHeaders());
      setMenstrualStatus(res.data);
    } catch (error) {
      console.error('Failed to load menstrual status');
    } finally {
      setMenstrualLoading(false);
    }
  }, [athleteId, getAuthHeaders]);

  // Load menstrual status when athleteId or days_ago changes
  useEffect(() => {
    fetchMenstrualStatus(menstrualDaysAgo);
  }, [fetchMenstrualStatus, menstrualDaysAgo]);

  const handleMenstrualDateChange = (daysAgo) => {
    setMenstrualDaysAgo(daysAgo);
  };

  // Admin deletion handlers
  const handleDeleteSession = async () => {
    if (!deleteSessionDialog.session) return;
    
    setDeleting(true);
    try {
      await axios.delete(
        `${API}/admin/training-session/${deleteSessionDialog.session.id}`,
        getAuthHeaders()
      );
      toast.success('Training session deleted. Workload metrics will be recalculated.');
      // Remove from local state
      setSessions(prev => prev.filter(s => s.id !== deleteSessionDialog.session.id));
      setDeleteSessionDialog({ open: false, session: null });
      // Refresh workload data
      const workloadRes = await axios.get(`${API}/staff/athlete/${athleteId}/workload`, getAuthHeaders());
      setWorkload(workloadRes.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete training session');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCheckIn = async () => {
    if (!deleteCheckInDialog.checkIn) return;
    
    setDeleting(true);
    try {
      await axios.delete(
        `${API}/admin/check-in/${deleteCheckInDialog.checkIn.id}`,
        getAuthHeaders()
      );
      toast.success('Check-in deleted successfully.');
      // Remove from local state
      setReadinessWithTeam(prev => ({
        ...prev,
        data: prev.data.filter(r => r.id !== deleteCheckInDialog.checkIn.id)
      }));
      setDeleteCheckInDialog({ open: false, checkIn: null });
      // Refresh compliance data
      const complianceRes = await axios.get(`${API}/staff/athlete/${athleteId}/compliance`, getAuthHeaders());
      setCompliance(complianceRes.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete check-in');
    } finally {
      setDeleting(false);
    }
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

        {/* Staff Feedback (Admin only) */}
        {user?.role === 'Admin' && <StaffFeedbackPanel athleteId={athleteId} />}

        {/* Injury & Illness History — same records as the Injury & Illness tab */}
        <AthleteIirHistory athleteId={athleteId} getAuthHeaders={getAuthHeaders} />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
          <TabsList className="bg-muted/50 flex-wrap h-auto justify-start gap-1">
            <TabsTrigger value="readiness">Readiness</TabsTrigger>
            <TabsTrigger value="workload">Workload</TabsTrigger>
            <TabsTrigger value="cmj">CMJ</TabsTrigger>
            <TabsTrigger value="pain">Pain Report</TabsTrigger>
            <TabsTrigger value="nutrition" data-testid="athlete-tab-nutrition">Nutrition</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="record" data-testid="athlete-tab-record">Prontuário</TabsTrigger>
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
                <ChartCaption metricKey="dailyReadiness" />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Workload Tab */}
          <TabsContent value="workload" className="mt-4 space-y-4">
            {/* Daily Workload vs Readiness — associates training load with recovery */}
            <Card className="glass-light border-white/5" data-testid="workload-readiness-chart">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    Daily Workload vs Readiness
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {[30, 90, 365].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSessionWindow(d)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${sessionWindow === d ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                        data-testid={`wlr-window-${d}`}
                      >
                        {d === 365 ? '1y' : `${d}d`}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!wlrData?.points?.length ? (
                  <p className="text-center text-muted-foreground py-10 text-sm">No workload or readiness data in this period</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={wlrData.points.map((p) => ({ date: (p.date || '').slice(5), load: p.load, readiness: p.readiness }))} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#64748b" />
                        <YAxis yAxisId="load" tick={{ fontSize: 10 }} stroke="#f59e0b" domain={[0, 'auto']} />
                        <YAxis yAxisId="readiness" orientation="right" tick={{ fontSize: 10 }} stroke="#22c55e" domain={[0, 10]} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar yAxisId="load" dataKey="load" name="Daily Load (AU)" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={16} />
                        <Line yAxisId="readiness" type="monotone" dataKey="readiness" name="Readiness (0-10)" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

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
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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
                    <ChartCaption metricKey="monotony" />
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* CMJ Tab */}
          <TabsContent value="cmj" className="mt-4 space-y-4">
            <CMJSection athleteId={athleteId} athleteName={athlete?.name} />
            <ChartCaption metricKey="cmj" />
            <ChartCaption metricKey="rsi" />
          </TabsContent>

          {/* Pain Report Tab */}
          <TabsContent value="pain" className="mt-4 space-y-4">
            {painReport && (
              <>
                {/* Individual Pain After Sessions line chart */}
                <Card className="glass-light border-white/5" data-testid="pain-after-sessions-chart">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Pain After Sessions
                      <HelpTooltip metricKey="painAfterSessions" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {painAfterSeries.length > 0 ? (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={painAfterSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                            <YAxis domain={[0, 10]} tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                            <Tooltip
                              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0' }}
                              formatter={(v) => [`${v}/10`, 'Pain after']}
                            />
                            <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Review >5', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
                            <Line type="monotone" dataKey="pain" name="Pain after" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', strokeWidth: 0, r: 3 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                        <span className="text-2xl mb-2">✅</span>
                        <p className="text-sm">No post-session pain reported in this period</p>
                      </div>
                    )}
                    <ChartCaption metricKey="painAfterSessions" />
                  </CardContent>
                </Card>

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
                      <ChartCaption metricKey="painByRegion" />
                    </CardContent>
                  </Card>

                {/* Recent Pain Reports (all sources: Check-in / Recovery / Training) */}
                {painReport.recent_reports?.length > 0 && (
                  <Card className="glass-light border-white/5" data-testid="athlete-recent-pain-reports">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="w-4 h-4 text-red-400" />
                        Recent Pain Reports
                        <Badge variant="outline" className="text-[10px] border-white/10">{painReport.recent_reports.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {painReport.recent_reports.map((r, i) => {
                          const sourceColor = r.source === 'Recovery' ? 'border-emerald-500/30 text-emerald-300'
                            : r.source === 'Morning Check-in' ? 'border-cyan-500/30 text-cyan-300'
                            : 'border-purple-500/30 text-purple-300';
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/30" data-testid={`recent-pain-${i}`}>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {r.region}{r.laterality && r.laterality !== 'N/A' ? ` (${r.laterality})` : ''}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{r.date}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline" className={`text-[10px] ${sourceColor}`}>{r.source}</Badge>
                                <span className={`text-sm font-bold w-10 text-right ${r.pain_level >= 7 ? 'text-red-400' : r.pain_level >= 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                  {r.pain_level}/10
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

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
                <ChartCaption metricKey="compliance" />

                {/* Check-in Calendar — full month with month navigation */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium">
                        Check-in Calendar — {monthCal?.month_name} {monthCal?.year}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 border-white/10"
                          onClick={() => changeMonth(-1)}
                          disabled={monthLoading}
                          data-testid="checkin-cal-prev-month"
                          title="Previous month"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 border-white/10"
                          onClick={() => changeMonth(1)}
                          disabled={monthLoading || (() => {
                            const now = new Date();
                            const curStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                            return !monthCal || monthCal.month_str >= curStr;
                          })()}
                          data-testid="checkin-cal-next-month"
                          title="Next month"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                      const days = monthCal?.days || [];
                      const leading = days.length ? new Date(days[0].date + 'T00:00:00').getDay() : 0;
                      const cells = [...Array(leading).fill(null), ...days];
                      return (
                        <div className={monthLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2">
                            {WEEKDAYS.map((w) => (
                              <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{w}</div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                            {cells.map((day, i) => day === null ? (
                              <div key={`empty-${i}`} className="rounded-lg" />
                            ) : (
                              <div
                                key={day.date}
                                data-testid={`checkin-day-${day.date}`}
                                title={day.date}
                                className={`aspect-square flex flex-col items-center justify-center gap-0.5 p-1 rounded-lg ${
                                  day.is_future
                                    ? 'bg-white/[0.02] border border-white/5 opacity-40'
                                    : day.checked_in
                                      ? 'bg-emerald-500/15 border border-emerald-500/30'
                                      : 'bg-red-500/10 border border-red-500/20'
                                }`}
                              >
                                <span className="text-xs sm:text-sm font-semibold text-foreground leading-none">{day.day}</span>
                                {day.is_future ? null : day.checked_in ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-400" />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Checked in</span>
                            <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-400" /> Missed</span>
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-4 space-y-4">
            <SessionTypeDonut sessions={displayedSessions} />
            {/* Admin Info Banner */}
            {isAdmin && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">
                  <strong>Admin Mode:</strong> You can delete check-ins and training sessions. Deleting a session will automatically recalculate workload metrics (Monotony, Strain).
                </p>
              </div>
            )}
            
            {/* Detailed Training Sessions — table with filters, sorting & per-session modal */}
            <Card className="glass-light border-white/5" data-testid="training-sessions-detail">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" />
                    Training Sessions
                    <Badge variant="outline" className="text-[10px] border-white/10">{displayedSessions.length}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Type filter */}
                    <div className="flex items-center gap-1.5" data-testid="session-type-filter">
                      <button
                        type="button"
                        onClick={() => setSessionTypeFilter('all')}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${sessionTypeFilter === 'all' ? 'bg-primary/20 border-primary/50 text-primary font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                      >
                        All
                      </button>
                      {sessionTypeOptions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSessionTypeFilter(t)}
                          className={`px-2.5 py-1 rounded-md text-xs border transition-colors inline-flex items-center gap-1.5 ${sessionTypeFilter === t ? 'bg-primary/20 border-primary/50 text-primary font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sessionTypeColor(t) }} />
                          {t}
                        </button>
                      ))}
                    </div>
                    {/* Window selector */}
                    <div className="flex items-center gap-1" data-testid="session-window-selector">
                      {[{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 365, l: '1y' }].map((o) => (
                        <button
                          key={o.d}
                          type="button"
                          onClick={() => setSessionWindow(o.d)}
                          className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${sessionWindow === o.d ? 'bg-blue-500/20 border-blue-500/50 text-blue-400 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                        >
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <p className="text-[10px] text-red-400/80 mt-1">Admin: hover a row to delete a session (recalculates workload).</p>
                )}
              </CardHeader>
              <CardContent>
                {displayedSessions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8 text-sm">No sessions recorded in this period</p>
                ) : (
                  <div className="max-h-[560px] overflow-y-auto rounded-lg border border-white/5">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10">
                        <TableRow className="hover:bg-transparent">
                          {[
                            { k: 'date', l: 'Date' },
                            { k: 'type', l: 'Type' },
                            { k: 'duration_min', l: 'Min' },
                            { k: 'rpe', l: 'RPE' },
                            { k: 'internal_load', l: 'Load' },
                            { k: 'pain', l: 'Pain' },
                          ].map((col) => (
                            <TableHead
                              key={col.k}
                              onClick={() => toggleSessionSort(col.k)}
                              className="cursor-pointer select-none whitespace-nowrap text-xs"
                              data-testid={`session-col-${col.k}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {col.l}
                                <ArrowUpDown className={`w-3 h-3 ${sessionSort.key === col.k ? 'text-primary' : 'text-muted-foreground/40'}`} />
                              </span>
                            </TableHead>
                          ))}
                          <TableHead className="text-xs">Photo</TableHead>
                          {isAdmin && <TableHead className="w-8"></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedSessions.map((session) => (
                          <TableRow
                            key={session.id}
                            className="group cursor-pointer"
                            onClick={() => setSessionModal(session)}
                            data-testid={`session-row-${session.id}`}
                          >
                            <TableCell className="text-xs whitespace-nowrap">
                              {new Date(session.date_time_start).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-xs font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: sessionTypeColor(session.session_type) }}
                                  data-testid={`session-type-dot-${session.id}`}
                                />
                                {session.session_type}
                                {session.staff_note && (
                                  <StickyNote
                                    className="w-3.5 h-3.5 text-amber-400 shrink-0"
                                    title="Private staff observation added"
                                    data-testid={`session-note-indicator-${session.id}`}
                                  />
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">{session.duration_min}</TableCell>
                            <TableCell className="text-xs">{session.rpe}</TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">{session.internal_load}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {session.pain_after > 0 ? (
                                <span className={session.pain_after >= 5 ? 'text-red-400 font-medium' : 'text-amber-400'}>{session.pain_after}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {session.photo_id ? (
                                <img
                                  src={sessionPhotoUrl(session.photo_id)}
                                  alt="Session"
                                  className="w-10 h-10 object-cover rounded border border-white/10 hover:ring-2 hover:ring-primary/50"
                                  loading="lazy"
                                  onClick={(e) => { e.stopPropagation(); setLightboxUrl(sessionPhotoUrl(session.photo_id)); }}
                                  data-testid={`session-thumb-${session.id}`}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            {isAdmin && (
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  onClick={(e) => { e.stopPropagation(); setDeleteSessionDialog({ open: true, session }); }}
                                  title="Delete training session"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4">
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    Recent Check-ins
                    {isAdmin && <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">Admin Delete</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                  {readinessWithTeam?.data?.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No check-ins recorded</p>
                  ) : (
                    readinessWithTeam?.data?.slice(-10).reverse().map((r, i) => (
                      <div key={r.id || i} className="p-3 rounded-lg bg-muted/30 group">
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
                            {isAdmin && r.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => setDeleteCheckInDialog({ open: true, checkIn: r })}
                                title="Delete check-in"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground mt-2">
                          <span>Sleep: {r.sleep_quality}</span>
                          <span>Fatigue: {r.morning_fatigue}</span>
                          <span>Sore: {r.muscle_soreness}</span>
                          <span>Stress: {r.stress}</span>
                        </div>
                        {/* Pain reported during this check-in */}
                        {r.pain_reports?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-white/5" data-testid={`checkin-pain-${i}`}>
                            <p className="text-xs text-rose-400 font-medium mb-1 flex items-center gap-1">
                              <HeartPulse className="w-3.5 h-3.5" /> Pain reported:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {r.pain_reports.map((pr, pi) => (
                                <Badge key={pi} variant="outline" className="text-[10px] border-rose-500/30 text-rose-300">
                                  {pr.body_region === 'Other' && pr.region_note ? `Other — ${pr.region_note}` : pr.body_region}{pr.laterality && pr.laterality !== 'N/A' ? ` (${pr.laterality})` : ''} · {pr.pain_level}/10
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Morning Check-in Notes */}
                        {r.notes && (
                          <div className="mt-2 pt-2 border-t border-white/5">
                            <p className="text-xs text-cyan-400/80 font-medium mb-1">📝 Notes:</p>
                            <p className="text-xs text-muted-foreground italic">{r.notes}</p>
                          </div>
                        )}
                        {/* Device screenshot (Whoop/Garmin/Apple Health, etc.) */}
                        {r.screenshot_id && (
                          <div className="mt-2 pt-2 border-t border-white/5" data-testid={`checkin-screenshot-${i}`}>
                            <p className="text-xs text-primary/90 font-medium mb-1 flex items-center gap-1">
                              <Camera className="w-3.5 h-3.5" /> Device screenshot:
                            </p>
                            <img
                              src={sessionPhotoUrl(r.screenshot_id)}
                              alt="Device screenshot"
                              className="h-20 w-auto rounded-md border border-white/10 cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => setLightboxUrl(sessionPhotoUrl(r.screenshot_id))}
                              data-testid={`checkin-screenshot-thumb-${i}`}
                            />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Nutrition & Hydration Tab */}
          <TabsContent value="nutrition" className="mt-4">
            <NutritionHydration athleteId={athleteId} isStaff={true} athleteName={athlete?.name} />
          </TabsContent>

          {/* Clinical Record (Prontuário) Tab */}
          <TabsContent value="record" className="mt-4">
            <AthleteRecord athleteId={athleteId} />
          </TabsContent>

        </Tabs>

        {/* Pain Location Anatomical Viewer — only on the Pain Report tab */}
        {activeTab === 'pain' && (
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Day:</span>
                  <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2, 3].map((days) => (
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
                  
                  {/* Dropdown for available dates */}
                  {painMapData?.available_dates?.length > 0 && (
                    <Select
                      value={painMapData.date}
                      onValueChange={(date) => {
                        const today = new Date().toISOString().slice(0, 10);
                        const diffDays = Math.round((new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24));
                        handlePainMapDateChange(diffDays);
                      }}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs border-white/10 bg-transparent">
                        <SelectValue placeholder="Date" />
                      </SelectTrigger>
                      <SelectContent>
                        {painMapData.available_dates.slice(0, 14).map((date) => (
                          <SelectItem key={date} value={date} className="text-xs">
                            {date}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
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
                          {pain.session_type && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 border-sky-500/30 text-sky-400">
                              {pain.session_type}
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
                  <p className="text-xs mt-1">No pain reported from check-ins, sessions or recovery on this day</p>
                </div>
              )}

              {/* Athlete notes reported with the pain */}
              {painMapData?.notes?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-2" data-testid="pain-map-notes">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Athlete notes</p>
                  {painMapData.notes.map((n, i) => (
                    <div key={i} className="p-2 rounded bg-sky-500/5 border border-sky-500/15">
                      <p className="text-[10px] text-sky-400 mb-0.5">{n.source}</p>
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap">{n.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}

        {/* Menstrual Status Panel - Only for female athletes */}
        {menstrualStatus?.is_female_athlete && (
          <div className="mt-6 animate-fade-in">
            <Card className="glass-light border-pink-500/20">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className="text-pink-400">🌸</span>
                    Menstrual Status
                    <InfoTooltip title="Menstrual Cycle Tracking">
                      <InfoContent>
                        <p className="mb-2">Self-reported menstrual cycle data for this athlete on the selected day.</p>
                        <p className="mb-2">
                          <strong>Flow levels:</strong> None, Spotting, Light, Moderate, Heavy
                        </p>
                        <p className="mb-2">
                          <strong>Pain levels:</strong> None, Mild, Moderate, Severe, Very Severe
                        </p>
                        <p>
                          <strong>Symptoms:</strong> Cramps, Low back pain, Abdominal bloating/pain, Headache, Breast tenderness
                        </p>
                      </InfoContent>
                      <InfoWarning>
                        This is self-reported data intended to support training and recovery decisions.
                        Should be interpreted together with readiness, pain, and workload data.
                      </InfoWarning>
                    </InfoTooltip>
                  </CardTitle>
                  
                  {/* Date Navigation */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Day:</span>
                    <div className="flex gap-1 flex-wrap">
                      {[0, 1, 2, 3].map((days) => (
                        <Button
                          key={days}
                          variant={menstrualDaysAgo === days ? "default" : "outline"}
                          size="sm"
                          className={`text-xs px-2 py-1 h-7 ${menstrualDaysAgo === days ? 'bg-pink-500 hover:bg-pink-600' : 'border-white/10'}`}
                          onClick={() => handleMenstrualDateChange(days)}
                        >
                          {days === 0 ? 'Today' : days === 1 ? 'Yest' : `${days}d`}
                        </Button>
                      ))}
                    </div>
                    
                    {/* Dropdown for available dates */}
                    {menstrualStatus?.available_dates?.length > 0 && (
                      <Select
                        value={menstrualStatus.date}
                        onValueChange={(date) => {
                          const today = new Date().toISOString().slice(0, 10);
                          const diffDays = Math.round((new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24));
                          handleMenstrualDateChange(diffDays);
                        }}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs border-white/10 bg-transparent">
                          <SelectValue placeholder="Date" />
                        </SelectTrigger>
                        <SelectContent>
                          {menstrualStatus.available_dates.slice(0, 14).map((date) => (
                            <SelectItem key={date} value={date} className="text-xs">
                              {date}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                
                {/* Date info */}
                {menstrualStatus && (
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>📅 {menstrualStatus.date}</span>
                    {menstrualStatus.has_checkin ? (
                      <span className={menstrualStatus.is_in_period ? 'text-pink-400' : 'text-emerald-400'}>
                        {menstrualStatus.is_in_period ? '🌸 Currently in period' : '✅ Not in period'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">❌ No check-in</span>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {menstrualLoading ? (
                  <div className="h-32 flex items-center justify-center">
                    <div className="animate-pulse text-pink-400">Loading menstrual data...</div>
                  </div>
                ) : !menstrualStatus?.has_checkin ? (
                  <div className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                    <span className="text-3xl mb-2">📋</span>
                    <p className="text-sm">No check-in recorded for {menstrualStatus?.date || 'this day'}</p>
                  </div>
                ) : menstrualStatus.is_in_period && menstrualStatus.menstrual_data ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Menstrual Details */}
                    <div className="p-4 rounded-lg bg-pink-500/10 border border-pink-500/20">
                      <p className="text-xs font-medium text-pink-400 mb-3 uppercase tracking-wider">
                        Menstrual Cycle Details
                      </p>
                      <p className="text-sm text-pink-300 mb-3">
                        {athlete.name} is currently in menstrual period.
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Flow Level:</span>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              menstrualStatus.menstrual_data.flow === 'Heavy' ? 'border-red-500 text-red-400' :
                              menstrualStatus.menstrual_data.flow === 'Moderate' ? 'border-amber-500 text-amber-400' :
                              'border-pink-500 text-pink-400'
                            }`}
                          >
                            {menstrualStatus.menstrual_data.flow}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Pain Level:</span>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              menstrualStatus.menstrual_data.pain_level === 'Very Severe' ? 'border-red-500 text-red-400' :
                              menstrualStatus.menstrual_data.pain_level === 'Severe' ? 'border-red-400 text-red-400' :
                              menstrualStatus.menstrual_data.pain_level === 'Moderate' ? 'border-amber-500 text-amber-400' :
                              'border-emerald-500 text-emerald-400'
                            }`}
                          >
                            {menstrualStatus.menstrual_data.pain_level}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">General Soreness:</span>
                          <span className={`text-sm font-medium ${
                            menstrualStatus.menstrual_data.general_soreness >= 7 ? 'text-red-400' :
                            menstrualStatus.menstrual_data.general_soreness >= 4 ? 'text-amber-400' :
                            'text-emerald-400'
                          }`}>
                            {menstrualStatus.menstrual_data.general_soreness}/10
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Readiness:</span>
                          <span className={`text-sm font-medium ${
                            menstrualStatus.menstrual_data.readiness_score >= 7 ? 'text-emerald-400' :
                            menstrualStatus.menstrual_data.readiness_score >= 4 ? 'text-amber-400' :
                            menstrualStatus.menstrual_data.readiness_score ? 'text-red-400' : 'text-muted-foreground'
                          }`}>
                            {menstrualStatus.menstrual_data.readiness_score ? `${menstrualStatus.menstrual_data.readiness_score}/10` : 'N/A'}
                          </span>
                        </div>
                      </div>
                      
                      {/* Symptoms */}
                      {menstrualStatus.menstrual_data.symptoms?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-pink-500/20">
                          <p className="text-xs text-muted-foreground mb-2">Symptoms Reported:</p>
                          <div className="flex flex-wrap gap-1">
                            {menstrualStatus.menstrual_data.symptoms.map((symptom, j) => (
                              <Badge key={j} variant="outline" className="text-[10px] border-pink-500/30 text-pink-300">
                                {symptom.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Training Pain Details */}
                    <div className="p-4 rounded-lg bg-muted/20 border border-white/10">
                      <p className="text-xs font-medium text-red-400 mb-3 uppercase tracking-wider">
                        Training Pain (Same Day)
                      </p>
                      {menstrualStatus.pain_reports?.length > 0 ? (
                        <div className="space-y-2">
                          {menstrualStatus.pain_reports.map((pain, k) => (
                            <div key={k} className="flex items-center justify-between p-2 rounded bg-muted/30">
                              <div className="flex items-center gap-2">
                                <div 
                                  className={`w-2 h-2 rounded-full ${
                                    pain.intensity >= 7 ? 'bg-red-500' :
                                    pain.intensity >= 4 ? 'bg-amber-500' :
                                    'bg-emerald-500'
                                  }`}
                                />
                                <span className="text-sm">{pain.region}</span>
                                {pain.laterality && pain.laterality !== 'N/A' && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-white/20">
                                    {pain.laterality}
                                  </Badge>
                                )}
                              </div>
                              <span className={`text-sm font-bold ${
                                pain.intensity >= 7 ? 'text-red-400' :
                                pain.intensity >= 4 ? 'text-amber-400' :
                                'text-emerald-400'
                              }`}>
                                {pain.intensity}/10
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-20 flex items-center justify-center text-muted-foreground">
                          <p className="text-sm">No training pain reported today</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                    <span className="text-3xl mb-2">✅</span>
                    <p className="text-sm">Not in menstrual period on {menstrualStatus?.date || 'this day'}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

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

      {/* Delete Training Session Confirmation Dialog */}
      <AlertDialog open={deleteSessionDialog.open} onOpenChange={(open) => !open && setDeleteSessionDialog({ open: false, session: null })}>
        <AlertDialogContent className="bg-background border-red-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              Delete Training Session
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Are you sure you want to delete this training session?</p>
              {deleteSessionDialog.session && (
                <div className="bg-muted/30 rounded-lg p-3 text-sm">
                  <p><strong>Type:</strong> {deleteSessionDialog.session.session_type}</p>
                  <p><strong>Date:</strong> {new Date(deleteSessionDialog.session.date_time_start).toLocaleDateString()}</p>
                  <p><strong>Load:</strong> {deleteSessionDialog.session.internal_load} AU</p>
                  <p><strong>Duration:</strong> {deleteSessionDialog.session.duration_min} min</p>
                </div>
              )}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-400 text-sm">
                <p className="font-medium">⚠️ This action will:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Permanently delete this training session</li>
                  <li>Automatically recalculate Monotony and Strain</li>
                  <li>This action cannot be undone</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteSession}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Check-in Confirmation Dialog */}
      <AlertDialog open={deleteCheckInDialog.open} onOpenChange={(open) => !open && setDeleteCheckInDialog({ open: false, checkIn: null })}>
        <AlertDialogContent className="bg-background border-red-500/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="w-5 h-5" />
              Delete Daily Check-in
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Are you sure you want to delete this wellness check-in?</p>
              {deleteCheckInDialog.checkIn && (
                <div className="bg-muted/30 rounded-lg p-3 text-sm">
                  <p><strong>Date:</strong> {deleteCheckInDialog.checkIn.date}</p>
                  <p><strong>Readiness Score:</strong> {deleteCheckInDialog.checkIn.athlete_score?.toFixed(1)}</p>
                  <p><strong>Sleep:</strong> {deleteCheckInDialog.checkIn.sleep_quality} | <strong>Fatigue:</strong> {deleteCheckInDialog.checkIn.morning_fatigue}</p>
                </div>
              )}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-400 text-sm">
                <p className="font-medium">ℹ️ This action will:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Permanently delete this wellness check-in</li>
                  <li>Update compliance metrics</li>
                  <li>Training sessions are NOT affected</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteCheckIn}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Check-in'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Session Detail Modal */}
      <Dialog open={!!sessionModal} onOpenChange={(open) => !open && setSessionModal(null)}>
        <DialogContent className="bg-background border-white/10 max-w-lg max-h-[90vh] overflow-y-auto" data-testid="session-detail-modal">
          {sessionModal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-400" />
                  {sessionModal.session_type}
                </DialogTitle>
                <DialogDescription>
                  {new Date(sessionModal.date_time_start).toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {/* Core metrics */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { l: 'Duration', v: `${sessionModal.duration_min} min` },
                    { l: 'RPE', v: sessionModal.rpe },
                    { l: 'Internal Load', v: `${sessionModal.internal_load} AU` },
                    { l: 'Pain during', v: sessionModal.pain_during ?? 0 },
                    { l: 'Pain after', v: sessionModal.pain_after ?? 0 },
                    { l: 'End fatigue', v: sessionModal.end_fatigue ?? 0 },
                  ].map((m) => (
                    <div key={m.l} className="p-2.5 rounded-lg bg-muted/30 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</p>
                      <p className="text-lg font-bold">{m.v}</p>
                    </div>
                  ))}
                </div>

                {/* Pain locations */}
                {(sessionModal.pain_reports?.length > 0 || sessionModal.body_region) && (
                  <div>
                    <p className="text-xs font-medium text-red-400 uppercase tracking-wider mb-2">Pain locations</p>
                    <div className="space-y-1.5">
                      {(sessionModal.pain_reports?.length > 0
                        ? sessionModal.pain_reports
                        : [{ body_region: sessionModal.body_region, laterality: sessionModal.laterality, pain_level: sessionModal.pain_after }]
                      ).map((p, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
                          <span className="font-medium capitalize">
                            {p.body_region === 'Other' && p.region_note ? `Other — ${p.region_note}` : String(p.body_region || '').replace(/_/g, ' ')}
                            {p.laterality && p.laterality !== 'N/A' && (
                              <span className="text-muted-foreground"> · {p.laterality}</span>
                            )}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${(p.pain_level || 0) >= 5 ? 'border-red-500/40 text-red-400' : 'border-amber-500/40 text-amber-400'}`}>
                            Level {p.pain_level ?? '—'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {sessionModal.session_notes && (
                  <div>
                    <p className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground italic p-2.5 rounded-lg bg-muted/30">{sessionModal.session_notes}</p>
                  </div>
                )}

                {/* Staff private observation — NEVER visible to the athlete */}
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3" data-testid="staff-note-section">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <p className="text-xs font-medium text-amber-400 uppercase tracking-wider">Private staff observation</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Visible only to staff on this page — the athlete never sees this. Use it as a reminder.
                  </p>
                  <Textarea
                    value={staffNoteText}
                    onChange={(e) => setStaffNoteText(e.target.value)}
                    placeholder="Add a private note about this session…"
                    className="min-h-[80px] text-sm bg-background/40"
                    data-testid="staff-note-input"
                  />
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <p className="text-[10px] text-muted-foreground truncate">
                      {sessionModal.staff_note_updated_at
                        ? `Saved by ${sessionModal.staff_note_author} · ${new Date(sessionModal.staff_note_updated_at).toLocaleDateString()}`
                        : 'No observation yet'}
                    </p>
                    <Button
                      size="sm"
                      onClick={saveStaffNote}
                      disabled={savingNote || staffNoteText === (sessionModal.staff_note || '')}
                      className="h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-black shrink-0"
                      data-testid="staff-note-save-btn"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingNote ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>

                {/* Photo */}
                {sessionModal.photo_id && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Photo</p>
                    <img
                      src={sessionPhotoUrl(sessionModal.photo_id)}
                      alt="Session"
                      className="w-full rounded-lg border border-white/10 cursor-zoom-in hover:opacity-90"
                      onClick={() => setLightboxUrl(sessionPhotoUrl(sessionModal.photo_id))}
                      data-testid="session-modal-photo"
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="bg-black/95 border-white/10 max-w-4xl p-2" data-testid="session-lightbox">
          <DialogHeader className="sr-only">
            <DialogTitle>Session photo</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <img src={lightboxUrl} alt="Session full" className="w-full max-h-[85vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
