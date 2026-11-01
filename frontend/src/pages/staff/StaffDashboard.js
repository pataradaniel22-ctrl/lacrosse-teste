import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Calendar as CalendarPicker } from '../../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { InfoTooltip, InfoContent, InfoWarning } from '../../components/ui/info-tooltip';
import { HelpTooltip, ChartCaption } from '../../components/ui/help-tooltip';
import { ReadinessByAthleteChart } from '../../components/ReadinessByAthleteChart';
import TeamHydrationChart from '../../components/TeamHydrationChart';
import ExportModal from '../../components/ExportModal';
import DailyReportModal from '../../components/DailyReportModal';
import { ThemeToggle } from '../../components/ThemeToggle';
import CMJEvaluationDay from '../../components/cmj/CMJEvaluationDay';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  LogOut, 
  Menu,
  Users, 
  ArrowUpDown,  AlertTriangle, 
  BookOpen,
  Flame,
  Trophy,
  TrendingUp, 
  TrendingDown,
  Zap, 
  Activity,
  Bell,
  BarChart3,
  Clock,
  Phone,
  ChevronRight,
  Shield,
  User,
  Info,
  Calendar,
  Plus,
  Trash2,
  X,
  Download,
  ShieldCheck,
  HeartPulse,
  FileText,
  Send,
  MessageSquare,
  ClipboardList,
  ClipboardCheck,
  Stethoscope,
  Brain,
  Database,
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

// Max number of athletes before per-athlete legend is hidden (it would overflow the
// chart container and overlap surrounding cards on mobile). Tooltip still shows names.
const LEGEND_MAX_ATHLETES = 8;

// Stable workload formatter for strain chart
const workloadFormatter = (value, name) => [value?.toLocaleString() || 'N/A', name === 'avg_strain' ? 'Avg Strain' : 'Avg Load'];

// Tooltip for the daily team-load chart — shows the peak athlete's name
const TeamLoadTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, padding: '8px 10px', color: '#e2e8f0' }}>
      <p style={{ marginBottom: 4, fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value} AU</p>
      ))}
      {row.peak_athlete && row.peak_athlete !== '—' && (
        <p style={{ marginTop: 4, color: '#F87171' }}>Peak: {row.peak_athlete}</p>
      )}
    </div>
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

// Boston-time "today" (YYYY-MM-DD) — the app runs its daily cycle on Boston time
const bostonTodayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const daysAgoFromDate = (dateStr) =>
  Math.round((new Date(bostonTodayStr() + 'T00:00:00') - new Date(dateStr + 'T00:00:00')) / 86400000);

// Calendar popover to pick ANY past date; calls onPickDaysAgo(days_ago) for the existing fetchers
const DatePickerPopover = ({ selectedDateStr, onPickDaysAgo, testid = 'date-picker-trigger' }) => {
  const [open, setOpen] = useState(false);
  const selected = selectedDateStr ? new Date(selectedDateStr + 'T00:00:00') : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs px-2 py-0.5 h-6 border-white/10 gap-1" data-testid={testid}>
          <Calendar className="w-3 h-3" /> Date
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <CalendarPicker
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              onPickDaysAgo(Math.max(0, daysAgoFromDate(ds)));
              setOpen(false);
            }
          }}
          disabled={(date) => date > new Date()}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Date-range selector for the readiness chart: quick presets (days) + a custom range
// (pick a start day and optionally an end day; no end day = up to today).
const ReadinessRangeSelector = ({ range, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: undefined, to: undefined });
  const presets = [7, 14, 30, 90];
  const isCustom = !!range.start;
  const customLabel = range.start
    ? (range.end ? `${range.start} → ${range.end}` : `${range.start} → today`)
    : 'Custom';
  const apply = () => {
    if (!draft.from) return;
    const start = fmtDate(draft.from);
    const end = draft.to ? fmtDate(draft.to) : null;
    onChange(end && end !== start ? { start, end } : { start });
    setOpen(false);
  };
  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="readiness-range-selector">
      {presets.map((d) => (
        <button
          key={d} type="button" onClick={() => onChange({ days: d })}
          data-testid={`readiness-range-${d}d`}
          className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
            !isCustom && (range.days || 14) === d
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
          }`}
        >
          {d}d
        </button>
      ))}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft({ from: undefined, to: undefined }); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline" size="sm" data-testid="readiness-range-custom-btn"
            className={`text-xs px-2 py-0.5 h-7 gap-1 ${isCustom ? 'border-primary text-primary' : 'border-white/10 text-muted-foreground'}`}
          >
            <Calendar className="w-3 h-3" /> {isCustom ? customLabel : 'Custom'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <p className="text-xs text-muted-foreground mb-2 max-w-[16rem]">
            Pick a start day (and optionally an end day). With no end day, the range goes up to today.
          </p>
          <CalendarPicker
            mode="range"
            selected={draft}
            onSelect={(r) => setDraft(r || { from: undefined, to: undefined })}
            disabled={(date) => date > new Date()}
            numberOfMonths={1}
            initialFocus
          />
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-[11px] text-muted-foreground">
              {draft.from ? `${fmtDate(draft.from)} → ${draft.to ? fmtDate(draft.to) : 'today'}` : 'No day selected'}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setDraft({ from: undefined, to: undefined })}>Clear</Button>
              <Button size="sm" className="text-xs h-7" disabled={!draft.from} onClick={apply} data-testid="readiness-range-apply">Apply</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};


export default function StaffDashboard() {
  const { user, logout, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState('all');
  const [athleteFilter, setAthleteFilter] = useState('all');
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [chartAthletes, setChartAthletes] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [msgUnread, setMsgUnread] = useState(0);
  const [staffAlerts, setStaffAlerts] = useState(null);
  const [kpiModal, setKpiModal] = useState(null); // 'overload' | 'low_readiness'
  const [kpiAthletes, setKpiAthletes] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [longTermData, setLongTermData] = useState(null);
  const [menstrualStats, setMenstrualStats] = useState(null);
  const [menstrualDaysAgo, setMenstrualDaysAgo] = useState(0);
  const [painAnalytics, setPainAnalytics] = useState(null);
  const [substantialProblems, setSubstantialProblems] = useState([]);
  const [persistentPain, setPersistentPain] = useState(null);
  const [nonResponders, setNonResponders] = useState(null);
  const [workloadMetrics, setWorkloadMetrics] = useState(null);
  const [loadMonitoring, setLoadMonitoring] = useState(null);
  const [loadDays, setLoadDays] = useState(7);
  const [loadLoading, setLoadLoading] = useState(false);
  // Readiness chart date range: { days: N } preset OR { start, end? } custom range (end omitted = up to today)
  const [readinessRange, setReadinessRange] = useState({ days: 14 });
  const [readinessData, setReadinessData] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  
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
  // Daily report modal state
  const [showDailyReport, setShowDailyReport] = useState(false);
  // Athletes list controls (alphabetical + team filter)
  const [athleteListTeam, setAthleteListTeam] = useState('all');
  const [athleteListSort, setAthleteListSort] = useState('az');
  
  // CMJ Evaluation Day modal state
  const [showCMJModal, setShowCMJModal] = useState(false);

  // EVENT MODE: temporarily hide training-load & evening-recovery analytics for the staff.
  // Only Morning Check-in (readiness), Pain, Compliance, Female Wellness, Recovery & CMJ remain.
  const EVENT_MODE = false;

  const fetchData = useCallback(async () => {
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}${af}` : (af ? `?${af.slice(1)}` : '');
      const sep = teamParam ? '&' : '?';
      const daysParam = `${sep}days=14`;
      const monthsParam = `${sep}months=3`;
      const menstrualDaysParam = `${sep}days=7`;
      const painDaysParam = `${sep}days=90`;
      const weeksParam = `${sep}weeks=4`;
      const [statsRes, chartsRes, athletesRes, alertsRes, longTermRes, menstrualRes, painRes, workloadRes, substantialRes, nonRespRes, persistentPainRes] = await Promise.all([
        axios.get(`${API}/staff/dashboard/stats${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/charts${teamParam}${daysParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/athletes${teamFilter !== 'all' ? `?team=${teamFilter}` : ''}`, getAuthHeaders()),
        axios.get(`${API}/staff/alerts${teamParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/longterm${teamParam}${monthsParam}`, getAuthHeaders()),
        axios.get(`${API}/staff/dashboard/menstrual-stats${teamParam}${menstrualDaysParam}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/staff/dashboard/pain-analytics${teamParam}${painDaysParam}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/staff/dashboard/workload-metrics${teamParam}${weeksParam}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/health/staff/substantial`, getAuthHeaders()).catch(() => ({ data: [] })),
        axios.get(`${API}/staff/non-responders${teamFilter !== 'all' ? `?team=${teamFilter}&days=3` : '?days=3'}`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/staff/dashboard/persistent-pain${teamFilter !== 'all' ? `?team=${teamFilter}&days=21` : '?days=21'}`, getAuthHeaders()).catch(() => ({ data: null }))
      ]);
      
      setStats(statsRes.data);
      setCharts(chartsRes.data);
      // Dedupe athlete names to avoid React duplicate-key warnings (and stale Line components)
      setChartAthletes([...new Set(chartsRes.data.athletes || [])]);
      setAthletes(athletesRes.data);
      setAlerts(alertsRes.data);
      if (user?.role === 'Admin') {
        axios.get(`${API}/messages/admin/counts`, getAuthHeaders())
          .then((r) => setMsgUnread(r.data?.unread || 0)).catch(() => {});
        axios.get(`${API}/messages/admin/alerts`, getAuthHeaders())
          .then((r) => setStaffAlerts(r.data)).catch(() => {});
      }
      setLongTermData(longTermRes.data);
      setMenstrualStats(menstrualRes.data);
      setPainAnalytics(painRes.data);
      setWorkloadMetrics(workloadRes.data);
      setSubstantialProblems(Array.isArray(substantialRes.data) ? substantialRes.data : (substantialRes.data?.substantial || []));
      setNonResponders(nonRespRes.data);
      setPersistentPain(persistentPainRes.data);
    } catch (error) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [teamFilter, athleteFilter, getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openKpi = useCallback(async (metric) => {
    setKpiModal(metric);
    setKpiLoading(true);
    setKpiAthletes(null);
    try {
      const teamP = teamFilter !== 'all' ? `&team=${teamFilter}` : '';
      const res = await axios.get(`${API}/staff/dashboard/kpi-athletes?metric=${metric}${teamP}`, getAuthHeaders());
      setKpiAthletes(res.data);
    } catch (e) {
      setKpiAthletes({ count: 0, athletes: [] });
    } finally {
      setKpiLoading(false);
    }
  }, [teamFilter, getAuthHeaders]);

  // Training-load monitoring (accumulated load per athlete + high-load threshold)
  const fetchLoadMonitoring = useCallback(async (days) => {
    setLoadLoading(true);
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamP = teamFilter !== 'all' ? `?team=${teamFilter}${af}` : (af ? `?${af.slice(1)}` : '');
      const sep = teamP ? '&' : '?';
      const res = await axios.get(`${API}/staff/dashboard/load-monitoring${teamP}${sep}days=${days}`, getAuthHeaders());
      setLoadMonitoring(res.data);
    } catch (error) {
      console.error('Failed to load load-monitoring data');
    } finally {
      setLoadLoading(false);
    }
  }, [teamFilter, athleteFilter, getAuthHeaders]);

  useEffect(() => {
    fetchLoadMonitoring(loadDays);
  }, [fetchLoadMonitoring, loadDays]);

  // Fetch radar data
  const fetchRadarData = useCallback(async (daysAgo = 0) => {
    setRadarLoading(true);
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${daysAgo}${af}` : `?days_ago=${daysAgo}${af}`;
      const res = await axios.get(`${API}/staff/dashboard/readiness-radar${teamParam}`, getAuthHeaders());
      setRadarData(res.data);
    } catch (error) {
      console.error('Failed to load radar data');
    } finally {
      setRadarLoading(false);
    }
  }, [teamFilter, athleteFilter, getAuthHeaders]);

  // Load radar data when team filter changes or days_ago changes
  useEffect(() => {
    fetchRadarData(radarDaysAgo);
  }, [fetchRadarData, radarDaysAgo]);

  const handleRadarDateChange = (daysAgo) => {    setRadarDaysAgo(daysAgo);
  };

  // Readiness chart: fetch only the readiness series for the selected date range
  // (preset days OR custom start/end). Athlete roster + colors stay in sync with the
  // main charts fetch, so we only swap the time-series here.
  const fetchReadiness = useCallback(async () => {
    setReadinessLoading(true);
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}${af}` : (af ? `?${af.slice(1)}` : '');
      const sep = teamParam ? '&' : '?';
      let rangeParam;
      if (readinessRange.start && readinessRange.end) {
        rangeParam = `${sep}start_date=${readinessRange.start}&end_date=${readinessRange.end}`;
      } else if (readinessRange.start) {
        rangeParam = `${sep}start_date=${readinessRange.start}`;
      } else {
        rangeParam = `${sep}days=${readinessRange.days || 14}`;
      }
      const res = await axios.get(`${API}/staff/dashboard/charts${teamParam}${rangeParam}`, getAuthHeaders());
      setReadinessData(res.data?.readiness || []);
    } catch (error) {
      console.error('Failed to load readiness range data');
    } finally {
      setReadinessLoading(false);
    }
  }, [teamFilter, athleteFilter, readinessRange, getAuthHeaders]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  // Navigate to an athlete profile from a chart legend name (handles (M)/(W) suffix)
  const navigateToAthleteByName = (chartName, date = null) => {
    if (!chartName) return;
    const qs = date ? `?date=${date}` : '';
    const go = (id) => navigate(`/staff/athlete/${id}${qs}`);
    // Prefer the exact name->id map returned alongside the chart data (most reliable)
    const mapped = charts?.athlete_map?.[chartName];
    if (mapped) { go(mapped); return; }
    const clean = String(chartName).replace(/\s*\((?:M|W)\)\s*$/, '').trim();
    if (charts?.athlete_map?.[clean]) { go(charts.athlete_map[clean]); return; }
    const matches = athletes.filter((a) => a.name === clean || a.name === chartName);
    let target = matches[0];
    if (matches.length > 1) {
      const team = String(chartName).includes('(M)') ? 'Brazil Lacrosse Men'
        : String(chartName).includes('(W)') ? 'Brazil Lacrosse Women' : null;
      target = matches.find((a) => a.team === team) || matches[0];
    }
    if (target?.id) go(target.id);
  };

  // chartName -> team, for the Women/Men quick filters on the readiness chart
  const readinessNameToTeam = useMemo(() => {
    const map = {};
    const byId = {};
    (athletes || []).forEach((a) => { byId[a.id] = a.team; });
    (chartAthletes || []).forEach((name) => {
      const clean = String(name).replace(/\s*\((?:M|W)\)\s*$/, '').trim();
      const id = charts?.athlete_map?.[name] || charts?.athlete_map?.[clean];
      if (id && byId[id]) { map[name] = byId[id]; return; }
      const match = (athletes || []).find((a) => a.name === clean || a.name === name);
      if (match) map[name] = match.team;
      if (String(name).includes('(M)')) map[name] = 'Brazil Lacrosse Men';
      if (String(name).includes('(W)')) map[name] = 'Brazil Lacrosse Women';
    });
    return map;
  }, [athletes, chartAthletes, charts]);

  // Athletes list: filter by team + sort alphabetically
  const displayedAthleteList = useMemo(() => {
    let list = [...(athletes || [])];
    if (athleteListTeam !== 'all') {
      list = list.filter((a) => (a.team || '').includes(athleteListTeam === 'men' ? 'Men' : 'Women'));
    }
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt', { sensitivity: 'base' }));
    if (athleteListSort === 'za') list.reverse();
    return list;
  }, [athletes, athleteListTeam, athleteListSort]);

  // Fetch daily pain data
  const fetchDailyPainData = useCallback(async (daysAgo = 0, autoSelectLatest = false) => {
    setDailyPainLoading(true);
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${daysAgo}${af}` : `?days_ago=${daysAgo}${af}`;
      const res = await axios.get(`${API}/staff/dashboard/daily-pain${teamParam}`, getAuthHeaders());
      
      // If no data for today and autoSelectLatest is true, try to find the most recent date with data
      if (autoSelectLatest && res.data.total_sessions === 0 && res.data.available_dates?.length > 0) {
        // Find the first available date that might have data
        const today = new Date().toISOString().slice(0, 10);
        const availableDates = res.data.available_dates;
        
        // Check if there's a more recent date than "today" in available_dates (timezone issue)
        const mostRecentDate = availableDates[0];
        if (mostRecentDate > today) {
          // Calculate days_ago for the most recent date (could be negative if in "future" due to timezone)
          const diffDays = Math.round((new Date(today) - new Date(mostRecentDate)) / (1000 * 60 * 60 * 24));
          const newTeamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${diffDays}${af}` : `?days_ago=${diffDays}${af}`;
          const newRes = await axios.get(`${API}/staff/dashboard/daily-pain${newTeamParam}`, getAuthHeaders());
          setDailyPainData(newRes.data);
          setDailyPainLoading(false);
          return;
        }
      }
      
      setDailyPainData(res.data);
    } catch (error) {
      console.error('Failed to load daily pain data');
    } finally {
      setDailyPainLoading(false);
    }
  }, [teamFilter, athleteFilter, getAuthHeaders]);

  // Load daily pain data when team filter or days_ago changes
  useEffect(() => {
    // On initial load (dailyPainDaysAgo === 0), try to auto-select latest date with data
    fetchDailyPainData(dailyPainDaysAgo, dailyPainDaysAgo === 0);
  }, [fetchDailyPainData, dailyPainDaysAgo]);

  const handleDailyPainDateChange = (daysAgo) => {
    setDailyPainDaysAgo(daysAgo);
  };

  // Fetch menstrual stats with days_ago parameter
  const fetchMenstrualStats = useCallback(async (daysAgo = 0) => {
    try {
      const af = athleteFilter !== 'all' ? `&athlete_id=${athleteFilter}` : '';
      const teamParam = teamFilter !== 'all' ? `?team=${teamFilter}&days_ago=${daysAgo}${af}` : `?days_ago=${daysAgo}${af}`;
      const res = await axios.get(`${API}/staff/dashboard/menstrual-stats${teamParam}`, getAuthHeaders());
      setMenstrualStats(res.data);
    } catch (error) {
      console.error('Failed to load menstrual stats');
    }
  }, [teamFilter, athleteFilter, getAuthHeaders]);

  // Load menstrual stats when team filter or days_ago changes
  useEffect(() => {
    fetchMenstrualStats(menstrualDaysAgo);
  }, [fetchMenstrualStats, menstrualDaysAgo]);

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
    <div className="min-h-screen bg-background overflow-x-hidden" data-testid="staff-dashboard">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          {/* Mobile-first header layout */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            {/* Logo and Title - Left side */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <img 
                src="/brazil-lacrosse-logo.png" 
                alt="Brasil Lacrosse"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain shrink-0"
              />
              <div className="min-w-0">
                <h1 className="font-heading font-bold text-sm sm:text-lg truncate">Brasil Lacrosse</h1>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">Staff Dashboard • {user?.name}</p>
              </div>
            </div>
            
            {/* Controls - Right side, wraps on mobile */}
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap w-full sm:w-auto sm:ml-auto">
              {/* Team Filter */}
              <Select value={teamFilter} onValueChange={(val) => { setTeamFilter(val); setAthleteFilter('all'); }}>
                <SelectTrigger className="w-[130px] sm:w-48 bg-background/50 border-white/10 text-xs sm:text-sm h-8 sm:h-10" data-testid="team-filter">
                  <SelectValue placeholder="Filter by team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  <SelectItem value="Brazil Lacrosse Men">Men&apos;s Team</SelectItem>
                  <SelectItem value="Brazil Lacrosse Women">Women&apos;s Team</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Athlete (Player) Filter - applies globally across charts */}
              <Select value={athleteFilter} onValueChange={setAthleteFilter}>
                <SelectTrigger className="w-[130px] sm:w-48 bg-background/50 border-white/10 text-xs sm:text-sm h-8 sm:h-10" data-testid="athlete-filter">
                  <SelectValue placeholder="All Players" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Players</SelectItem>
                  {(() => {
                    const visible = athletes.filter(a => teamFilter === 'all' || a.team === teamFilter);
                    const nameCounts = visible.reduce((acc, a) => ({ ...acc, [a.name]: (acc[a.name] || 0) + 1 }), {});
                    return visible.map(a => {
                      const suffix = nameCounts[a.name] > 1
                        ? ` (${a.team === 'Brazil Lacrosse Men' ? 'M' : a.team === 'Brazil Lacrosse Women' ? 'W' : '?'})`
                        : '';
                      return (
                        <SelectItem key={a.id} value={a.id} data-testid={`athlete-option-${a.id}`}>
                          {a.name}{suffix}
                        </SelectItem>
                      );
                    });
                  })()}
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
              <div className="flex items-center gap-1 sm:gap-2 flex-nowrap w-full sm:w-auto justify-between sm:justify-end mt-1 sm:mt-0 pt-2 sm:pt-0 border-t border-white/5 sm:border-0">
                {/* Consolidated navigation & reports menu */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 sm:h-9 border-white/10 hover:bg-primary/10 hover:border-primary/30 flex items-center gap-1.5"
                      data-testid="staff-menu-btn"
                    >
                      <Menu className="w-4 h-4" />
                      <span className="text-xs sm:text-sm">Menu</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-0" data-testid="staff-menu-popover">
                    {(() => {
                      const Item = ({ icon: Icon, color, label, onClick, testid, badge }) => (
                        <button
                          type="button"
                          onClick={onClick}
                          data-testid={testid}
                          className="flex flex-col items-center justify-center gap-1.5 rounded-lg p-3 hover:bg-white/5 transition-colors text-center relative"
                        >
                          <Icon className={`w-5 h-5 ${color}`} />
                          <span className="text-[11px] leading-tight text-foreground/90">{label}</span>
                          {badge > 0 && (
                            <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[8px] flex items-center justify-center font-bold">{badge}</span>
                          )}
                        </button>
                      );
                      const Section = ({ title, children }) => (
                        <div className="px-2 py-2">
                          <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
                          <div className="grid grid-cols-3 gap-1">{children}</div>
                        </div>
                      );
                      return (
                        <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5">
                          <Section title="Monitoring">
                            <Item icon={ShieldCheck} color="text-emerald-400" label="Recovery" testid="recovery-intel-nav-btn" onClick={() => navigate('/staff/recovery-intelligence')} />
                            <Item icon={HeartPulse} color="text-cyan-400" label="Health" testid="health-nav-btn" onClick={() => navigate('/staff/health')} />
                            <Item icon={Stethoscope} color="text-red-400" label="Pain" testid="pain-nav-btn" onClick={() => navigate('/staff/pain-management')} />
                            <Item icon={Brain} color="text-purple-400" label="Mental" testid="mental-health-nav-btn" onClick={() => navigate('/staff/mental-health')} />
                            <Item icon={Activity} color="text-violet-400" label="CMJ Day" testid="cmj-day-btn" onClick={() => setShowCMJModal(true)} />
                            <Item icon={Trophy} color="text-amber-400" label="Rankings" testid="rankings-nav-btn" onClick={() => navigate('/staff/rankings')} />
                          </Section>
                          <Section title="Reports">
                            <Item icon={FileText} color="text-blue-400" label="Event Report" testid="event-report-nav-btn" onClick={() => navigate('/staff/event-report')} />
                            <Item icon={ClipboardList} color="text-primary" label="Daily Report" testid="daily-report-btn" onClick={() => setShowDailyReport(true)} />
                            <Item icon={Download} color="text-foreground/80" label="Export" testid="export-data-btn" onClick={() => setShowExportModal(true)} />
                            <Item icon={BookOpen} color="text-purple-400" label="Methodology" testid="methodology-nav-btn" onClick={() => navigate('/staff/methodology')} />
                          </Section>
                          <Section title="Communication">
                            <Item icon={Send} color="text-primary" label="Notify" testid="notifications-nav-btn" onClick={() => navigate('/staff/notifications')} />
                            {user?.role === 'Admin' && (
                              <Item icon={MessageSquare} color="text-sky-400" label="Messages" testid="messages-nav-btn" badge={msgUnread} onClick={() => navigate('/staff/messages')} />
                            )}
                          </Section>
                          {user?.role === 'Admin' && (
                            <Section title="Engagement">
                              <Item icon={Flame} color="text-orange-400" label="The Fittest" testid="the-fittest-admin-nav-btn" onClick={() => navigate('/staff/the-fittest')} />
                              <Item icon={Database} color="text-emerald-400" label="Research Data" testid="research-data-nav-btn" onClick={() => navigate('/staff/research-data')} />
                            </Section>
                          )}
                        </div>
                      );
                    })()}
                  </PopoverContent>
                </Popover>

                {/* Admin Panel Link - Only visible to Admins */}
                {user?.role === 'Admin' && (
                  <Link to="/staff/admin">
                    <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="admin-panel-btn">
                      <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    </Button>
                  </Link>
                )}
                
                {user?.role === 'Admin' ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9" data-testid="staff-bell-btn">
                        <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                        {(staffAlerts?.total_unread > 0 || alerts.length > 0) && (
                          <span className={`absolute -top-1 -right-1 min-w-4 h-4 sm:min-w-5 sm:h-5 px-1 rounded-full text-[8px] sm:text-[10px] flex items-center justify-center font-bold ${staffAlerts?.priority_count > 0 ? 'bg-rose-500' : 'bg-destructive'}`}>
                            {(staffAlerts?.total_unread || 0) + alerts.length}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-0" data-testid="staff-bell-popover">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                        <p className="font-semibold text-sm">Alerts</p>
                        <Link to="/staff/alerts" className="text-xs text-primary hover:underline">Health alerts</Link>
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        {(!staffAlerts || staffAlerts.total_unread === 0) ? (
                          <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="staff-bell-empty">No new messages or pain reports.</div>
                        ) : (
                          <>
                            {(staffAlerts.priority || []).map((c) => (
                              <button key={c.id} type="button" onClick={() => navigate(`/staff/messages/${c.id}`)}
                                className="w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`staff-alert-${c.id}`}>
                                <div className="flex items-center gap-2">
                                  {c.is_pain_related && <HeartPulse className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                                  <span className="text-sm font-medium truncate flex-1">{c.athlete_name}</span>
                                  {(c.priority === 'high' || c.priority === 'urgent') && (
                                    <Badge className="text-[9px] bg-amber-500/20 text-amber-300 border-amber-500/40 capitalize">{c.priority}</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.title}</p>
                              </button>
                            ))}
                            {(staffAlerts.others || []).map((c) => (
                              <button key={c.id} type="button" onClick={() => navigate(`/staff/messages/${c.id}`)}
                                className="w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`staff-alert-${c.id}`}>
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                  <span className="text-sm font-medium truncate flex-1">{c.athlete_name}</span>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.title}</p>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
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
                )}
                
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
                
                <ThemeToggle className="h-8 w-8 sm:h-9 sm:w-9" />
                <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 sm:h-9 sm:w-9" data-testid="logout-btn">
                  <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="daily-report-capture" className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
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
            
            <Card className="glass-light border-white/5 animate-fade-in cursor-pointer hover:border-orange-400/40 transition-colors" style={{ animationDelay: '100ms' }} onClick={() => openKpi('overload')} data-testid="kpi-overload">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <Zap className="w-3 sm:w-4 h-3 sm:h-4 text-orange-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Overload</span>
                  <HelpTooltip metricKey="overloadAlerts" />
                </div>
                <p className={`text-2xl sm:text-3xl font-heading font-bold ${(stats.overload_alerts || 0) > 0 ? 'text-orange-400' : ''}`}>{stats.overload_alerts || 0}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">load &gt;30% vs avg</p>
              </CardContent>
            </Card>
            
            <Card className={`glass-light border-white/5 animate-fade-in cursor-pointer hover:border-cyan-400/40 transition-colors ${(stats.missing_check_ins || 0) > 0 ? 'border-amber-500/20' : ''}`} style={{ animationDelay: '125ms' }} onClick={() => openKpi('not_checked_in')} data-testid="kpi-compliance">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <ClipboardCheck className="w-3 sm:w-4 h-3 sm:h-4 text-cyan-400 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Daily Compliance</span>
                  <HelpTooltip metricKey="compliance" />
                </div>
                <p className={`text-2xl sm:text-3xl font-heading font-bold ${(stats.checkin_compliance_today ?? 100) >= 80 ? 'text-emerald-400' : (stats.checkin_compliance_today ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {stats.checkin_compliance_today ?? 0}%
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {(stats.total_athletes || 0) - (stats.missing_check_ins || 0)}/{stats.total_athletes || 0} checked in today
                </p>
              </CardContent>
            </Card>
            
            <Card className={`glass-light border-white/5 animate-fade-in cursor-pointer hover:border-red-400/40 transition-colors ${(stats.low_readiness_today || 0) > 0 ? 'border-red-500/30' : ''}`} style={{ animationDelay: '150ms' }} onClick={() => openKpi('low_readiness')} data-testid="kpi-low-readiness">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                  <TrendingDown className={`w-3 sm:w-4 h-3 sm:h-4 ${(stats.low_readiness_today || 0) > 0 ? 'text-red-400' : 'text-muted-foreground'} shrink-0`} />
                  <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Low Readiness</span>
                  <HelpTooltip metricKey="lowReadinessToday" />
                </div>
                <p className={`text-2xl sm:text-3xl font-heading font-bold ${(stats.low_readiness_today || 0) > 0 ? 'text-red-400' : ''}`}>
                  {stats.low_readiness_today || 0}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">&lt;5 today · {stats.missing_check_ins} missing</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts & Tables */}
        <div data-report-charts-grid className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Charts Section */}
          <div data-report-charts-col className="lg:col-span-2 space-y-4 sm:space-y-6">
            <Tabs defaultValue="short" className="animate-fade-in">
              <TabsList className="bg-muted/50 flex-wrap">
                <TabsTrigger value="short" className="text-xs sm:text-sm">Short Term</TabsTrigger>
                <TabsTrigger value="medium" className="text-xs sm:text-sm">Medium Term</TabsTrigger>
                <TabsTrigger value="long" className="text-xs sm:text-sm">Long Term</TabsTrigger>
              </TabsList>

              <TabsContent value="short" className="mt-3 sm:mt-4 space-y-4">
                {/* Readiness Chart - Individual Athlete Lines with Risk Threshold */}
                <Card className="glass-light border-white/5" data-report-exclude>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        Daily Readiness Score by Athlete
                        <HelpTooltip metricKey="dailyReadiness" />
                        {readinessLoading && <span className="text-[10px] text-muted-foreground animate-pulse">updating…</span>}
                      </CardTitle>
                      <ReadinessRangeSelector range={readinessRange} onChange={setReadinessRange} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ReadinessByAthleteChart
                      data={readinessData ?? charts?.readiness ?? []}
                      athletes={chartAthletes}
                      colors={ATHLETE_COLORS}
                      threshold={READINESS_DANGER_THRESHOLD}
                      nameToTeam={readinessNameToTeam}
                      onAthleteClick={navigateToAthleteByName}
                    />
                    <ChartCaption metricKey="dailyReadiness" />
                  </CardContent>
                </Card>

                {/* Team hydration: % of athletes dehydrated per day */}
                <TeamHydrationChart team={teamFilter} />

                {/* Training Load Monitoring — accumulated load per athlete + high-load threshold */}
                <Card className="glass-light border-white/5" data-testid="load-monitoring-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary" />
                        Training Load Monitoring
                        <HelpTooltip metricKey="teamLoadMonitoring" />
                      </CardTitle>
                      <div className="flex items-center gap-1" data-testid="load-days-selector">
                        {[7, 14, 28].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setLoadDays(d)}
                            className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                              loadDays === d
                                ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                                : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                            }`}
                            data-testid={`load-days-${d}`}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!loadMonitoring || (loadMonitoring.athletes_with_sessions || 0) === 0 ? (
                      <p className="text-center text-muted-foreground py-10 text-sm" data-testid="load-monitoring-empty">
                        {loadLoading ? 'Loading…' : 'No training load recorded in this period yet.'}
                      </p>
                    ) : (
                      <>
                        {/* Summary + legend */}
                        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30" data-testid="load-high-count">
                            {loadMonitoring.high_count} athlete(s) above threshold
                          </Badge>
                          <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="inline-block w-3 h-3 rounded-sm bg-slate-500/60" /> Avg training day</span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="inline-block w-3 h-3 rounded-sm bg-indigo-500" /> Latest day</span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="inline-block w-4 h-0 border-t-2 border-dashed border-sky-400" /> Team avg/day</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mb-3">
                          Each athlete's latest training-day load (front) vs their own average training-day load (behind, rest days excluded) — spot who trained well above their normal.
                        </p>

                        {/* Overlaid bars: latest-day load (front) over the athlete's own weekly average (behind) */}
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={loadMonitoring.athletes} barGap="-100%" barCategoryGap="22%" margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                              <XAxis
                                dataKey="name"
                                tick={{ fill: '#94A3B8', fontSize: 10 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                interval={0}
                                angle={-45}
                                textAnchor="end"
                                height={70}
                              />
                              <YAxis
                                tick={{ fill: '#94A3B8', fontSize: 10 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                label={{ value: 'Load (AU)', angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11 }}
                              />
                              <RechartsTooltip
                                cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const p = payload[0].payload;
                                  const pct = p.day_vs_avg_pct;
                                  return (
                                    <div style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 8, fontSize: 12, padding: '8px 10px', color: '#e2e8f0' }}>
                                      <div style={{ color: '#f8fafc', fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                                      <div>Latest day: <b>{p.day_load}</b> AU{p.day_date ? ` (${p.day_date.slice(5)})` : ''}</div>
                                      <div>Avg training day: <b>{p.avg_daily}</b> AU</div>
                                      {pct != null && (
                                        <div style={{ color: pct > 30 ? '#f87171' : pct < -30 ? '#38bdf8' : '#94a3b8', marginTop: 2 }}>
                                          {pct > 0 ? '+' : ''}{pct}% vs own average {pct > 30 ? '⚠️' : ''}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }}
                              />
                              <Bar dataKey="avg_daily" name="Avg training day" fill="#64748B" fillOpacity={0.45} radius={[3, 3, 0, 0]} barSize={32} isAnimationActive={false} />
                              <Bar dataKey="day_load" name="Latest day" radius={[3, 3, 0, 0]} barSize={16}>
                                {loadMonitoring.athletes.map((a) => (
                                  <Cell key={a.id} fill={a.day_vs_avg_pct != null && a.day_vs_avg_pct > 30 ? '#EF4444' : '#6366F1'} />
                                ))}
                              </Bar>
                              {loadMonitoring.team_day_mean != null && (
                                <ReferenceLine
                                  y={loadMonitoring.team_day_mean}
                                  stroke="#38BDF8"
                                  strokeDasharray="5 4"
                                  strokeOpacity={0.7}
                                  label={{ value: `Team avg ${loadMonitoring.team_day_mean}`, position: 'right', fill: '#38BDF8', fontSize: 9 }}
                                />
                              )}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* High-load athletes list */}
                        {loadMonitoring.high_count > 0 && (
                          <div className="mt-4 pt-4 border-t border-white/5" data-testid="high-load-list">
                            <p className="text-xs font-medium text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> Athletes with elevated load
                            </p>
                            <div className="space-y-2">
                              {loadMonitoring.athletes.filter((a) => a.high).map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => navigate(`/staff/athlete/${a.id}`)}
                                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors text-left"
                                  data-testid={`high-load-${a.id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-red-500" />
                                    <span className="text-sm font-medium">{a.name}</span>
                                    <Badge variant="outline" className="border-white/10 text-[10px]">{a.sessions} sessions</Badge>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-sm font-mono font-bold text-red-400">{a.total_load} AU</span>
                                    {a.pct_above != null && (
                                      <span className="block text-[10px] text-red-300">+{a.pct_above}% vs avg</span>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Daily team load trend (avg vs max) */}
                        {loadMonitoring.daily?.length > 0 && (
                          <div className="mt-5">
                            <p className="text-xs text-muted-foreground mb-2">Daily team load — average vs peak athlete</p>
                            <div className="h-56">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={loadMonitoring.daily}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                  <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                                  <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                                  <RechartsTooltip content={<TeamLoadTooltip />} />
                                  <Legend wrapperStyle={{ paddingTop: '8px', fontSize: 11 }} />
                                  <Line type="monotone" dataKey="avg" name="Avg load" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                  <Line type="monotone" dataKey="max" name="Peak athlete" stroke="#EF4444" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <ChartCaption metricKey="teamLoadMonitoring" />
                  </CardContent>
                </Card>

                {/* Load Chart - Individual Athlete Lines (hidden in Event Mode) */}
                {!EVENT_MODE && (
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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="dailyInternalLoad" />
                  </CardContent>
                </Card>
                )}

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
                        <DatePickerPopover selectedDateStr={radarData?.date} onPickDaysAgo={handleRadarDateChange} testid="radar-date-picker" />
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
                    <ChartCaption metricKey="teamReadinessRadar" />
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
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Quick day buttons */}
                        {[0, 1, 2, 3].map((days) => (
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
                        
                        {/* Dropdown for available dates */}
                        {dailyPainData?.available_dates?.length > 0 && (
                          <Select
                            value={dailyPainData.date}
                            onValueChange={(date) => {
                              const today = new Date().toISOString().slice(0, 10);
                              const diffDays = Math.round((new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24));
                              handleDailyPainDateChange(diffDays);
                            }}
                          >
                            <SelectTrigger className="h-6 w-24 text-xs border-white/10 bg-transparent">
                              <SelectValue placeholder="Date" />
                            </SelectTrigger>
                            <SelectContent>
                              {dailyPainData.available_dates.slice(0, 14).map((date) => (
                                <SelectItem key={date} value={date} className="text-xs">
                                  {date}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <DatePickerPopover selectedDateStr={dailyPainData?.date} onPickDaysAgo={handleDailyPainDateChange} testid="pain-date-picker" />
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
                        {dailyPainData.pain_regions.slice(0, 8).map((region, index) => (
                          <div key={index} className="p-2.5 rounded bg-muted/20" data-testid={`daily-pain-region-${region.region}`}>
                            <div className="flex items-center justify-between">
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
                            {/* Who reported the pain */}
                            {region.entries?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {region.entries.map((e, i) => (
                                  <span
                                    key={i}
                                    data-testid="daily-pain-entry"
                                    className={`text-[11px] px-2 py-0.5 rounded-full border ${e.pain_level >= 7 ? 'border-red-500/40 text-red-300 bg-red-500/10' : e.pain_level >= 5 ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-white/10 text-muted-foreground bg-muted/30'}`}
                                  >
                                    {e.athlete_name}{e.laterality && e.laterality !== 'N/A' ? ` (${e.laterality})` : ''} · {e.pain_level}/10 · {e.source}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                        <span className="text-2xl mb-2">✅</span>
                        <p className="text-sm">No pain reports for {dailyPainData?.date || 'this day'}</p>
                      </div>
                    )}
                    <ChartCaption metricKey="dailyPain" />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="medium" className="mt-4 space-y-4">
                {!EVENT_MODE && (
                <>
                {/* Pain Chart - Individual Athlete Lines */}
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Pain After Sessions by Athlete
                      <HelpTooltip metricKey="painAfterSessions" />
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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="painAfterSessions" />
                  </CardContent>
                </Card>
                </>
                )}

                {/* Weekly Workload Metrics - Improved Layout (hidden in Event Mode) */}
                {!EVENT_MODE && workloadMetrics && (
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
                    <ChartCaption metricKey="monotony" />
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="long" className="mt-4 space-y-4">
                {/* Monthly Cumulative Load (hidden in Event Mode) */}
                {!EVENT_MODE && (
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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="monthlyLoad" />
                  </CardContent>
                </Card>
                )}

                {/* Chronic Load Trend (28-day rolling) (hidden in Event Mode) */}
                {!EVENT_MODE && (
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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="chronicLoadTrend" />
                  </CardContent>
                </Card>
                )}

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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="readinessTrend" />
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
                    <ChartCaption metricKey="painByRegion" />
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
                    <ChartCaption metricKey="compliance" />
                    </CardContent>
                  </Card>
                </div>

                {/* Training Consistency (hidden in Event Mode) */}
                {!EVENT_MODE && (
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4 text-purple-400" />
                      Weekly Training Consistency (Sessions/Week)
                      <HelpTooltip metricKey="trainingConsistency" />
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
                            wrapperStyle={{ paddingTop: '10px', maxHeight: 72, overflowY: 'auto' }}
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
                    <ChartCaption metricKey="trainingConsistency" />
                  </CardContent>
                </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Sidebar */}
          <div data-report-exclude className="space-y-6">
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

            {/* Female Team Wellness Monitor (positioned below Active Alerts) */}
            {menstrualStats && menstrualStats.total_female_athletes > 0 && (teamFilter === 'all' || teamFilter === 'Brazil Lacrosse Women') && (
              <Card className="glass-light border-pink-500/20 animate-fade-in">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span className="text-pink-400">🌸</span>
                      Female Team Wellness Monitor
                      <InfoTooltip title="Menstrual Cycle Tracking">
                        <InfoContent>
                          <p className="mb-2">This panel displays self-reported menstrual cycle data from female athletes.</p>
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
                    
                    {/* Date selector */}
                    <div className="flex items-center gap-1">
                      {[0, 1, 2, 3].map((days) => (
                        <Button
                          key={days}
                          variant={menstrualDaysAgo === days ? "default" : "outline"}
                          size="sm"
                          className={`text-xs px-2 py-0.5 h-6 ${menstrualDaysAgo === days ? 'bg-pink-500 hover:bg-pink-600' : 'border-white/10'}`}
                          onClick={() => setMenstrualDaysAgo(days)}
                        >
                          {days === 0 ? 'Today' : days === 1 ? 'Yest' : `${days}d`}
                        </Button>
                      ))}
                      <DatePickerPopover selectedDateStr={menstrualStats?.selected_date} onPickDaysAgo={setMenstrualDaysAgo} testid="menstrual-date-picker" />
                    </div>
                  </div>
                  
                  {menstrualStats.selected_date && (
                    <p className="text-xs text-muted-foreground mt-1">
                      📅 {menstrualStats.selected_date}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center p-2 rounded-lg bg-pink-500/10">
                      <p className="text-lg font-bold text-pink-400">{menstrualStats.athletes_on_period_today}</p>
                      <p className="text-[9px] text-muted-foreground">In Period</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-pink-500/5">
                      <p className="text-lg font-bold">{menstrualStats.total_female_athletes}</p>
                      <p className="text-[9px] text-muted-foreground">Total Female</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-pink-500/5">
                      <p className="text-lg font-bold">{menstrualStats.period_rate}%</p>
                      <p className="text-[9px] text-muted-foreground">Period Rate</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-red-500/10">
                      <p className={`text-lg font-bold ${menstrualStats.severe_symptoms_today?.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {menstrualStats.severe_symptoms_today?.length || 0}
                      </p>
                      <p className="text-[9px] text-muted-foreground">Severe Pain</p>
                    </div>
                  </div>
                  
                  {/* Detailed Athletes List */}
                  {menstrualStats.athletes_in_period_details?.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-pink-400 flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        Athletes Currently in Period
                      </p>
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        {menstrualStats.athletes_in_period_details.map((athlete, i) => (
                          <Link 
                            key={i} 
                            to={`/staff/athlete/${athlete.athlete_id}`}
                            className="block p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors border border-transparent hover:border-pink-500/30"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm">{athlete.athlete_name}</span>
                              <Badge 
                                variant="outline" 
                                className={`text-[10px] ${
                                  athlete.menstrual_pain === 'Very Severe' ? 'border-red-500 text-red-400' :
                                  athlete.menstrual_pain === 'Severe' ? 'border-red-400 text-red-400' :
                                  athlete.menstrual_pain === 'Moderate' ? 'border-amber-500 text-amber-400' :
                                  'border-pink-500/50 text-pink-400'
                                }`}
                              >
                                {athlete.menstrual_pain} pain
                              </Badge>
                            </div>
                            
                            {/* Menstrual Details */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground">Flow:</span>
                                <span className={`font-medium ${
                                  athlete.menstrual_flow === 'Heavy' ? 'text-red-400' :
                                  athlete.menstrual_flow === 'Moderate' ? 'text-amber-400' :
                                  'text-foreground'
                                }`}>{athlete.menstrual_flow}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground">Readiness:</span>
                                <span className={`font-medium ${
                                  athlete.readiness_score >= 7 ? 'text-emerald-400' :
                                  athlete.readiness_score >= 5 ? 'text-amber-400' :
                                  athlete.readiness_score ? 'text-red-400' : 'text-muted-foreground'
                                }`}>{athlete.readiness_score ? `${athlete.readiness_score}/10` : 'N/A'}</span>
                              </div>
                            </div>
                            
                            {/* Symptoms */}
                            {athlete.menstrual_symptoms?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {athlete.menstrual_symptoms.map((symptom, j) => (
                                  <Badge key={j} variant="outline" className="text-[9px] border-pink-500/30 text-pink-300">
                                    {symptom.replace(/_/g, ' ')}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            
                            {/* Pain Reports */}
                            {athlete.has_pain_today ? (
                              <div className="mt-2 pt-2 border-t border-white/10">
                                <p className="text-[10px] text-red-400 font-medium mb-1">Training Pain Today:</p>
                                <div className="flex flex-wrap gap-1">
                                  {athlete.pain_reports.map((pain, k) => (
                                    <Badge 
                                      key={k} 
                                      variant="outline" 
                                      className={`text-[9px] ${
                                        pain.intensity >= 7 ? 'border-red-500 text-red-400' :
                                        pain.intensity >= 4 ? 'border-amber-500 text-amber-400' :
                                        'border-emerald-500 text-emerald-400'
                                      }`}
                                    >
                                      {pain.region} {pain.laterality !== 'N/A' && `(${pain.laterality})`}: {pain.intensity}/10
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-white/10">
                                No training pain reported today
                              </p>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-muted-foreground">
                        No athletes reported being in their menstrual period on this day
                      </p>
                    </div>
                  )}
                  
                  {/* High Pain Alerts */}
                  {menstrualStats.high_pain_alerts?.filter(a => a.alert_type === 'COMBINED_HIGH_PAIN').length > 0 && (
                    <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <p className="text-xs font-medium text-amber-400 mb-1">🔥 Combined High Pain Alert</p>
                      <p className="text-[10px] text-muted-foreground">
                        Athletes with menstrual pain + high general soreness
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {menstrualStats.high_pain_alerts.filter(a => a.alert_type === 'COMBINED_HIGH_PAIN').map((a, i) => (
                          <Link key={i} to={`/staff/athlete/${a.athlete_id}`}>
                            <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-[10px] hover:bg-amber-500/20">
                              {a.athlete_name}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pain by Body Region (below the menstrual monitor, on the first page) */}
            {painAnalytics?.region_ranking?.length > 0 && (
              <Card className="glass-light border-white/5 animate-fade-in" data-testid="sidebar-pain-by-region">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Pain by Body Region (90d)
                      <HelpTooltip metricKey="painByRegion" />
                    </CardTitle>
                    {painAnalytics?.most_affected_region && (
                      <Badge variant="outline" className="border-red-500/50 text-red-400 text-[10px]">
                        Most: {painAnalytics.most_affected_region.region}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
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
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {painAnalytics.region_ranking.map((region, idx) => {
                      const maxReports = painAnalytics.region_ranking[0]?.total_reports || 1;
                      const barWidth = (region.total_reports / maxReports) * 100;
                      const isTop = idx === 0;
                      return (
                        <div key={region.region} className={`relative p-2 rounded ${isTop ? 'bg-red-500/20 border border-red-500/30' : 'bg-muted/20'}`}>
                          <div className={`absolute inset-y-0 left-0 rounded ${isTop ? 'bg-red-500/30' : 'bg-red-500/10'}`} style={{ width: `${barWidth}%` }} />
                          <div className="relative flex items-center justify-between gap-2">
                            <span className={`text-xs font-medium ${isTop ? 'text-red-400' : ''}`}>{region.region}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-muted-foreground">{region.total_reports}x</span>
                              <Badge variant="outline" className={`text-[10px] ${region.avg_intensity >= 7 ? 'border-red-500/50 text-red-400' : region.avg_intensity >= 5 ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400'}`}>
                                avg {region.avg_intensity}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                </CardContent>
              </Card>
            )}

            {/* Athletes List */}
            <Card className="glass-light border-white/5 animate-fade-in">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    Athletes
                    <Badge variant="outline" className="text-[10px] border-white/10">{displayedAthleteList.length}</Badge>
                  </CardTitle>
                  <button
                    type="button"
                    onClick={() => setAthleteListSort((s) => (s === 'az' ? 'za' : 'az'))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-white/10 bg-background/50 text-muted-foreground hover:border-white/30 transition-colors"
                    data-testid="athlete-sort-toggle"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    {athleteListSort === 'az' ? 'A–Z' : 'Z–A'}
                  </button>
                </div>
                <div className="flex items-center gap-1 mt-2" data-testid="athlete-team-filter">
                  {[
                    { k: 'all', label: 'All' },
                    { k: 'men', label: "Men's" },
                    { k: 'women', label: "Women's" },
                  ].map((t) => (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => setAthleteListTeam(t.k)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${athleteListTeam === t.k ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                      data-testid={`athlete-team-${t.k}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {displayedAthleteList.map((athlete) => (
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

        {/* Compliance & Health alert tables — full width at the bottom of the dashboard */}
        <div data-report-exclude className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Substantial Health Problems */}
          <Card className="glass-light border-red-500/20 animate-fade-in" data-testid="dashboard-substantial-problems">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-4 h-4" />
                Substantial Health Problems
                <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px]">{substantialProblems.length}</Badge>
                <HelpTooltip metricKey="substantialProblem" />
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-1">Problems with substantial impact on participation — each flagged case needs follow-up.</p>
            </CardHeader>
            <CardContent>
              {substantialProblems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="substantial-empty">No substantial health problems this week.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {substantialProblems.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/staff/athlete/${p.athlete_id}`)}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/15 hover:bg-red-500/10 transition-colors text-left"
                      data-testid={`dash-substantial-${p.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{p.athlete_name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {p.problem_category}{p.body_region ? ` · ${p.body_region}` : ''}{(p.body_region === 'Other' || p.problem_category === 'other') && p.athlete_description && !p.confidential ? ` — ${p.athlete_description}` : ''}{p.body_side && p.body_side !== 'na' ? ` (${p.body_side})` : ''} · {p.total_weeks_reported}w
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.requested_medical_contact && <Phone className="w-4 h-4 text-orange-400" />}
                        <Badge variant="outline" className={`text-xs ${p.current_severity_score >= 50 ? 'border-red-500/50 text-red-400' : 'border-amber-500/50 text-amber-400'}`}>{p.current_severity_score}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily check-in non-responders (>3 days) */}
          <Card className="glass-light border-amber-500/20 animate-fade-in" data-testid="dashboard-non-responders">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-400">
                <Clock className="w-4 h-4" />
                Not responding to daily check-in (&gt;3 days)
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">{nonResponders?.count || 0}</Badge>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-1">Compliance alert to share with supervisors and coaches — follow up with these athletes.</p>
            </CardHeader>
            <CardContent>
              {!nonResponders || nonResponders.count === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="non-responders-empty">All athletes have checked in within the last 3 days. ✅</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {nonResponders.athletes.map((a) => (
                    <button
                      key={a.athlete_id}
                      type="button"
                      onClick={() => navigate(`/staff/athlete/${a.athlete_id}`)}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 hover:bg-amber-500/10 transition-colors text-left"
                      data-testid={`dash-nonresponder-${a.athlete_id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.team?.includes('Men') ? "Men's" : "Women's"} · last check-in: {a.last_response || 'never'}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400 shrink-0">
                        {a.days_since == null ? 'Never' : `${a.days_since}d ago`}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Persistent pain (same region, 3+ consecutive days) */}
          <Card className="glass-light border-rose-500/20 animate-fade-in" data-testid="dashboard-persistent-pain">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-rose-400">
                <HeartPulse className="w-4 h-4" />
                Persistent pain (3+ consecutive days)
                <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[10px]">{persistentPain?.count || 0}</Badge>
                <HelpTooltip metricKey="persistentPain" />
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-1">Athletes reporting pain (≥5/10) in the same body region on 3+ days in a row — prioritise for follow-up.</p>
            </CardHeader>
            <CardContent>
              {!persistentPain || persistentPain.count === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="persistent-pain-empty">No athletes with persistent pain right now. ✅</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {persistentPain.athletes.map((a) => (
                    <button
                      key={`${a.athlete_id}-${a.region}`}
                      type="button"
                      onClick={() => navigate(`/staff/athlete/${a.athlete_id}`)}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-rose-500/5 border border-rose-500/15 hover:bg-rose-500/10 transition-colors text-left"
                      data-testid={`dash-persistent-pain-${a.athlete_id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{a.athlete_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.team?.includes('Men') ? "Men's" : "Women's"} · {a.region} · since {a.start_date}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs border-rose-500/50 text-rose-400 shrink-0">
                        {a.consecutive_days}d in a row
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </main>

      {/* KPI athletes drill-down */}
      <Dialog open={!!kpiModal} onOpenChange={(o) => { if (!o) setKpiModal(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" data-testid="kpi-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {kpiModal === 'overload' ? (
                <><Zap className="w-5 h-5 text-orange-400" /> Overload — athletes</>
              ) : kpiModal === 'not_checked_in' ? (
                <><ClipboardCheck className="w-5 h-5 text-cyan-400" /> Missing today's check-in</>
              ) : (
                <><TrendingDown className="w-5 h-5 text-red-400" /> Low readiness today</>
              )}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            {kpiModal === 'overload'
              ? 'Latest training-day load >30% above the athlete\'s own 28-day average.'
              : kpiModal === 'not_checked_in'
              ? 'Athletes who have not submitted their morning check-in today.'
              : 'Checked in today with a readiness score below 5.'}
          </p>
          {kpiLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : (!kpiAthletes || kpiAthletes.count === 0) ? (
            <p className="text-sm text-muted-foreground py-6 text-center" data-testid="kpi-modal-empty">
              {kpiModal === 'not_checked_in' ? 'Everyone has checked in today. ✅' : 'No athletes right now. ✅'}
            </p>
          ) : (
            <div className="space-y-2">
              {kpiAthletes.athletes.map((a) => (
                <button key={a.athlete_id} type="button"
                  onClick={() => { setKpiModal(null); navigate(`/staff/athlete/${a.athlete_id}`); }}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
                  data-testid={`kpi-athlete-${a.athlete_id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{a.athlete_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {a.team?.includes('Men') ? "Men's" : "Women's"}
                      {kpiModal === 'overload' && a.latest_load != null && ` · ${a.latest_load} AU vs ${a.avg_load} avg`}
                    </p>
                  </div>
                  {kpiModal === 'overload' ? (
                    <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-400 shrink-0">+{a.value}%</Badge>
                  ) : kpiModal === 'not_checked_in' ? (
                    <Badge variant="outline" className="text-xs border-cyan-500/50 text-cyan-400 shrink-0">No check-in</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs border-red-500/50 text-red-400 shrink-0">{a.value}/10</Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Daily Report Modal */}
      <DailyReportModal
        open={showDailyReport}
        onOpenChange={setShowDailyReport}
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        getAuthHeaders={getAuthHeaders}
      />
      
      {/* CMJ Evaluation Day Modal */}
      <CMJEvaluationDay 
        isOpen={showCMJModal}
        onClose={() => setShowCMJModal(false)}
      />
    </div>
  );
}
