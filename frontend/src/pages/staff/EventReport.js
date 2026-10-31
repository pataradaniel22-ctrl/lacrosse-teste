/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ArrowLeft, FileText, Download, Printer, RefreshCw, Plus, Info, Pencil, Trash2, GitCompare, X, SlidersHorizontal, ChevronDown } from 'lucide-react';
import {
  KPICard, SectionCard, EmptyState, ChartFrame, InsightCard, ConfidenceBadge,
  RankList, zoneHigh, zoneLow, zonePct, fmt, maskName, CHART_COLORS,
} from '../../components/eventreport/primitives';
import {
  gridTick, gridStroke, shortDate, inv, teamVals, mapNames,
  HeaderStat, MiniStat, CompareRow, COMPARE_ROWS, ProfileList, RecBlock, IndividualReport, BodyMap,
} from '../../components/eventreport/subcomponents';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TEAM_OPTIONS = [
  { value: 'all', label: 'All teams' },
  { value: 'Brazil Lacrosse Men', label: 'Men' },
  { value: 'Brazil Lacrosse Women', label: 'Women' },
];
const VIEW_OPTIONS = [
  { value: 'complete', label: 'Complete' },
  { value: 'executive', label: 'Executive' },
  { value: 'technical', label: 'Technical' },
  { value: 'medical', label: 'Medical / Physio' },
];
// Which sections are visible per view type
const VIEW_SECTIONS = {
  complete: 'all',
  executive: ['summary', 'kpis', 'overview', 'teams', 'insights', 'recommendations', 'quality'],
  technical: ['kpis', 'overview', 'teams', 'compliance', 'readiness', 'recovery', 'rankings', 'insights', 'quality'],
  medical: ['kpis', 'pain', 'availability', 'readiness', 'recommendations', 'quality'],
};

export default function EventReport() {
  const { getAuthHeaders } = useAuth();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('none');
  const [startDate, setStartDate] = useState('2026-06-24');
  const [endDate, setEndDate] = useState('2026-06-29');
  const [team, setTeam] = useState('all');
  const [view, setView] = useState('complete');
  const [anonymize, setAnonymize] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: collapse the filter/controls area so the report is visible

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [athleteModal, setAthleteModal] = useState(null);
  const [athleteData, setAthleteData] = useState(null);

  // New/edit-event dialog
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', event_type: 'training_camp', start_date: '', end_date: '', team: 'all', description: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Compare mode (Event A = current selection, Event B = compareId)
  const [compareId, setCompareId] = useState('none');
  const [compareReport, setCompareReport] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/staff/events?include_past=true`, getAuthHeaders());
      setEvents(r.data || []);
      return r.data || [];
    } catch (e) { return []; }
  }, [getAuthHeaders]);

  const openCreateDialog = () => {
    setEditingEventId(null);
    setNewEvent({ name: '', event_type: 'training_camp', start_date: '', end_date: '', team: 'all', description: '' });
    setShowEventDialog(true);
  };

  const openEditDialog = () => {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    setEditingEventId(ev.id);
    setNewEvent({
      name: ev.name || '', event_type: ev.event_type || 'training_camp',
      start_date: ev.start_date || '', end_date: ev.end_date || '',
      team: ev.team || 'all', description: ev.description || '',
    });
    setShowEventDialog(true);
  };

  const saveEvent = async () => {
    if (!newEvent.name.trim()) { toast.error('Event name is required'); return; }
    if (!newEvent.start_date || !newEvent.end_date) { toast.error('Start and end dates are required'); return; }
    if (newEvent.end_date < newEvent.start_date) { toast.error('End date must be after start date'); return; }
    setSavingEvent(true);
    try {
      const payload = {
        name: newEvent.name.trim(),
        event_type: newEvent.event_type,
        start_date: newEvent.start_date,
        end_date: newEvent.end_date,
        team: newEvent.team !== 'all' ? newEvent.team : null,
        description: newEvent.description || null,
      };
      if (editingEventId) {
        await axios.put(`${API}/staff/events/${editingEventId}`, payload, getAuthHeaders());
        toast.success('Event updated');
      } else {
        await axios.post(`${API}/staff/events`, payload, getAuthHeaders());
        toast.success('Event created');
      }
      setShowEventDialog(false);
      const list = await loadEvents();
      const ev = list.find((e) => e.id === editingEventId) || list.find((e) => e.name === payload.name && e.start_date === payload.start_date);
      if (ev) {
        setEventId(ev.id);
        setStartDate(ev.start_date);
        setEndDate(ev.end_date);
        setTeam(ev.team || 'all');
      }
      setEditingEventId(null);
      setNewEvent({ name: '', event_type: 'training_camp', start_date: '', end_date: '', team: 'all', description: '' });
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save event');
    } finally {
      setSavingEvent(false);
    }
  };

  const deleteEvent = async () => {
    if (!eventId || eventId === 'none') return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/staff/events/${eventId}`, getAuthHeaders());
      toast.success('Event deleted');
      setConfirmDelete(false);
      if (compareId === eventId) { setCompareId('none'); setCompareReport(null); }
      await loadEvents();
      setEventId('none');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to delete event');
    } finally {
      setDeleting(false);
    }
  };

  // Compare: fetch report B for the selected comparison event
  const onSelectCompare = async (id) => {
    setCompareId(id);
    if (!id || id === 'none') { setCompareReport(null); return; }
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    setCompareLoading(true);
    try {
      const params = { start_date: ev.start_date, end_date: ev.end_date, event_id: ev.id };
      if (ev.team) params.team = ev.team;
      const r = await axios.get(`${API}/staff/event-report`, { ...getAuthHeaders(), params });
      setCompareReport(r.data);
    } catch (e) {
      toast.error('Failed to load comparison period');
      setCompareReport(null);
      setCompareId('none');
    } finally {
      setCompareLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = { start_date: startDate, end_date: endDate };
      if (team !== 'all') params.team = team;
      if (eventId && eventId !== 'none') params.event_id = eventId;
      const r = await axios.get(`${API}/staff/event-report`, { ...getAuthHeaders(), params });
      setReport(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load event report');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, team, eventId, getAuthHeaders]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const onSelectEvent = (id) => {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (ev) {
      setStartDate(ev.start_date);
      setEndDate(ev.end_date);
      if (ev.team) setTeam(ev.team);
    }
  };

  const openAthlete = async (id) => {
    setAthleteModal(id); setAthleteData(null);
    try {
      const r = await axios.get(`${API}/staff/event-report/athlete/${id}`, {
        ...getAuthHeaders(), params: { start_date: startDate, end_date: endDate },
      });
      setAthleteData(r.data.athlete);
    } catch (e) {
      toast.error('No data for this athlete in the selected period');
      setAthleteModal(null);
    }
  };

  const exportCSV = () => {
    if (!report) return;
    const rows = [['Section', 'Metric', 'Value']];
    const k = report.kpis;
    Object.entries({
      Athletes: k.athletes, Adherence: k.adherence, 'Avg Readiness': k.readiness,
      'Avg Sleep': k.sleep, 'Avg Fatigue': k.fatigue, 'Avg Stress': k.stress,
      'Avg Soreness': k.soreness, 'Avg Recovery': k.recovery, 'Total Load': k.total_load,
      'Athletes w/ Pain': k.athletes_with_pain, 'Red Alerts': k.alerts_red,
    }).forEach(([m, v]) => rows.push(['KPI', m, v ?? 'N/A']));
    report.daily.forEach((d) => rows.push(['Daily', d.date,
      `checkins=${d.checkins};readiness=${d.readiness ?? 'NA'};load=${d.load ?? 'NA'};recovery=${d.recovery ?? 'NA'};pain=${d.athletes_with_pain}`]));
    report.team_comparison.forEach((t) => rows.push(['Team', t.label,
      `readiness=${t.readiness ?? 'NA'};adherence=${t.adherence ?? 'NA'};pain=${t.avg_pain ?? 'NA'};recovery=${t.recovery ?? 'NA'}`]));

    // Period comparison (A = current selection, B = "compare with")
    if (compareReport) {
      const A = report, B = compareReport;
      const nameA = meta.event_name || `${meta.start_date}_${meta.end_date}`;
      const nameB = B.meta.event_name || `${B.meta.start_date}_${B.meta.end_date}`;
      rows.push(['Comparison', 'Periods', `A=${nameA}; B=${nameB}`]);
      const cmp = [
        ['Athletes', A.kpis.athletes, B.kpis.athletes],
        ['Adherence %', A.kpis.adherence, B.kpis.adherence],
        ['Avg Readiness', A.kpis.readiness, B.kpis.readiness],
        ['Avg Sleep', A.kpis.sleep, B.kpis.sleep],
        ['Avg Fatigue', A.kpis.fatigue, B.kpis.fatigue],
        ['Avg Stress', A.kpis.stress, B.kpis.stress],
        ['Avg Soreness', A.kpis.soreness, B.kpis.soreness],
        ['Avg Recovery', A.kpis.recovery, B.kpis.recovery],
        ['Total Load', A.kpis.total_load, B.kpis.total_load],
        ['Athletes w/ Pain', A.kpis.athletes_with_pain, B.kpis.athletes_with_pain],
        ['Pain prevalence %', A.kpis.pain_prevalence, B.kpis.pain_prevalence],
        ['Availability %', A.availability.availability_pct, B.availability.availability_pct],
      ];
      cmp.forEach(([label, a, b]) => {
        const delta = (a == null || b == null) ? 'NA' : Math.round((b - a) * 100) / 100;
        rows.push(['Comparison', label, `A=${a ?? 'NA'}; B=${b ?? 'NA'}; delta(B-A)=${delta}`]);
      });
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `event-report_${startDate}_${endDate}.csv`;
    a.click();
  };

  const show = (key) => {
    const cfg = VIEW_SECTIONS[view];
    return cfg === 'all' || cfg.includes(key);
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading event report…</div>;
  }
  if (!report) {
    return <div className="min-h-screen grid place-items-center text-slate-500">No report data.</div>;
  }

  const { meta, header, kpis, daily, team_comparison, team_profiles, compliance,
    readiness, pain, load, recovery, availability, rankings, insights,
    recommendations, data_quality } = report;

  const genDate = new Date(meta.generated_at);

  // radar data (teams)
  const radarData = [
    { m: 'Readiness', ...teamVals(team_comparison, (t) => t.readiness) },
    { m: 'Sleep', ...teamVals(team_comparison, (t) => t.sleep) },
    { m: 'Low Fatigue', ...teamVals(team_comparison, (t) => inv(t.fatigue)) },
    { m: 'Low Stress', ...teamVals(team_comparison, (t) => inv(t.stress)) },
    { m: 'Low Pain', ...teamVals(team_comparison, (t) => inv(t.avg_pain)) },
    { m: 'Recovery', ...teamVals(team_comparison, (t) => t.recovery != null ? t.recovery / 10 : null) },
    { m: 'Compliance', ...teamVals(team_comparison, (t) => t.adherence != null ? t.adherence / 10 : null) },
  ];

  const zonePie = [
    { name: 'Good', value: readiness.zones.good, color: '#10b981' },
    { name: 'Attention', value: readiness.zones.attention, color: '#f59e0b' },
    { name: 'Risk', value: readiness.zones.risk, color: '#ef4444' },
  ];
  const riskPie = [
    { name: 'No risk', value: availability.distribution.green, color: '#10b981' },
    { name: 'Attention', value: availability.distribution.yellow, color: '#f59e0b' },
    { name: 'Multiple', value: availability.distribution.orange, color: '#f97316' },
    { name: 'High risk', value: availability.distribution.red, color: '#ef4444' },
  ];

  return (
    <div className="er-root min-h-screen bg-slate-50 text-slate-800">
      {/* ===== Top bar (screen only) ===== */}
      <div className="er-topbar no-print sticky top-0 z-20 bg-slate-900 border-b border-slate-800 text-slate-100 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => navigate('/staff')} data-testid="er-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            <div>
              <h1 className="text-base font-bold leading-none text-white">Event Report</h1>
              <p className="text-[11px] text-slate-400">Integrated analysis of readiness, load, recovery, pain & availability</p>
            </div>
          </div>
          <div className="flex-1" />
          <span className="hidden lg:flex items-center gap-1 text-[11px] text-amber-300/90 mr-1" data-testid="er-refresh-hint">
            <Info className="w-3.5 h-3.5" /> Changed a filter? Tap Refresh to rebuild.
          </span>
          <Button variant="outline" size="sm" className="border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white" onClick={openCreateDialog} data-testid="er-new-event"><Plus className="w-4 h-4 mr-1" /> New event</Button>
          <Button variant="outline" size="sm" className="border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white" onClick={fetchReport} data-testid="er-refresh"><RefreshCw className="w-4 h-4 mr-1" /> Refresh</Button>
          <Button variant="outline" size="sm" className="border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white" onClick={exportCSV} data-testid="er-export-csv"><Download className="w-4 h-4 mr-1" /> CSV</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => window.print()} data-testid="er-export-pdf">
            <Printer className="w-4 h-4 mr-1" /> Export PDF
          </Button>
          {/* Mobile-only: collapse/expand the filters so the report is visible */}
          <Button
            variant="outline" size="sm"
            className="lg:hidden border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() => setFiltersOpen((o) => !o)}
            data-testid="er-toggle-filters"
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="w-4 h-4 mr-1" /> Filters
            <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {/* Filters + compare (collapsible on mobile, always shown on lg+) */}
        <div className={`${filtersOpen ? 'block' : 'hidden'} lg:block`} data-testid="er-filters-panel">
        {/* Filters */}
        <div className="max-w-7xl mx-auto mt-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <div>
            <Label className="text-[10px] text-slate-400">Event</Label>
            <div className="flex items-center gap-1 min-w-0">
              <div className="flex-1 min-w-0">
                <Select value={eventId} onValueChange={onSelectEvent}>
                  <SelectTrigger className="h-8 text-xs w-full" data-testid="er-event-select"><SelectValue placeholder="Custom range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Custom range</SelectItem>
                    {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {eventId !== 'none' && (
                <>
                  <Button variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={openEditDialog} data-testid="er-edit-event" title="Edit event"><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-red-300 hover:bg-red-900/40 hover:text-red-200" onClick={() => setConfirmDelete(true)} data-testid="er-delete-event" title="Delete event"><Trash2 className="w-3.5 h-3.5" /></Button>
                </>
              )}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-slate-400">From</Label>
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setEventId('none'); }} className="h-8 text-xs" data-testid="er-start-date" />
          </div>
          <div>
            <Label className="text-[10px] text-slate-400">To</Label>
            <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setEventId('none'); }} className="h-8 text-xs" data-testid="er-end-date" />
          </div>
          <div>
            <Label className="text-[10px] text-slate-400">Team</Label>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-8 text-xs" data-testid="er-team-select"><SelectValue /></SelectTrigger>
              <SelectContent>{TEAM_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-slate-400">View</Label>
            <Select value={view} onValueChange={setView}>
              <SelectTrigger className="h-8 text-xs" data-testid="er-view-select"><SelectValue /></SelectTrigger>
              <SelectContent>{VIEW_OPTIONS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch checked={anonymize} onCheckedChange={setAnonymize} id="anon" data-testid="er-anon-toggle" />
            <Label htmlFor="anon" className="text-[11px] text-slate-300">Anonymize</Label>
          </div>
        </div>

        {/* Compare bar */}
        <div className="max-w-7xl mx-auto mt-2 flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-slate-400"><GitCompare className="w-3.5 h-3.5" /> Compare with:</span>
          <Select value={compareId} onValueChange={onSelectCompare}>
            <SelectTrigger className="h-8 text-xs w-56" data-testid="er-compare-select"><SelectValue placeholder="Select a saved event…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No comparison</SelectItem>
              {events.filter((e) => e.id !== eventId).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {compareLoading && <span className="text-[11px] text-slate-400 animate-pulse">loading…</span>}
          {compareReport && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => onSelectCompare('none')} data-testid="er-compare-clear"><X className="w-3.5 h-3.5 mr-1" /> Clear</Button>
          )}
        </div>
        </div>
      </div>

      <div className="er-page max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ===== Print cover ===== */}
        <div className="er-cover print-only">
          <div className="text-center py-24">
            <p className="text-sm uppercase tracking-widest text-slate-400">{meta.organization}</p>
            <h1 className="text-4xl font-black mt-4">Event Report</h1>
            <p className="text-slate-500 mt-2">Integrated analysis of readiness, load, recovery, pain & availability</p>
            {meta.event_name && <p className="text-xl font-semibold mt-6">{meta.event_name}</p>}
            <p className="text-slate-600 mt-2">{meta.start_date} → {meta.end_date} · {meta.num_days} day(s)</p>
            <p className="text-xs text-slate-400 mt-10">Generated {genDate.toLocaleString()}</p>
          </div>
        </div>

        {/* ===== Executive header ===== */}
        <div className="er-header break-inside-avoid rounded-xl bg-gradient-to-r from-slate-900 to-slate-700 text-white p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs uppercase tracking-widest text-white/60">{meta.organization}</p>
              <h2 className="text-2xl font-black">{meta.event_name || 'Event Report'}</h2>
              <p className="text-sm text-white/70">{meta.start_date} → {meta.end_date} · {meta.num_days} monitored day(s)</p>
            </div>
            <div className="text-right text-xs text-white/70">
              <p>Generated: {genDate.toLocaleString()}</p>
              <p>{meta.teams.map((t) => `${t.label} (${t.count})`).join(' · ') || 'Single group'}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mt-4 text-center">
            <HeaderStat label="Athletes" value={header.athletes} />
            <HeaderStat label="Adherence" value={fmt(header.adherence, '%')} />
            <HeaderStat label="Check-ins" value={`${header.actual_checkins}/${header.expected_checkins}`} />
            <HeaderStat label="Pain reports" value={header.pain_reports} />
            <HeaderStat label="Training logs" value={header.training_records} />
            <HeaderStat label="Alerts" value={header.alerts} />
          </div>
        </div>

        {/* ===== Period comparison (A vs B) ===== */}
        {compareReport && (() => {
          const A = report, B = compareReport;
          const nameA = meta.event_name || `${meta.start_date} → ${meta.end_date}`;
          const nameB = B.meta.event_name || `${B.meta.start_date} → ${B.meta.end_date}`;
          const METRICS = [
            { label: 'Athletes', a: A.kpis.athletes, b: B.kpis.athletes, dir: 'info' },
            { label: 'Adherence', unit: '%', a: A.kpis.adherence, b: B.kpis.adherence, dir: 'high' },
            { label: 'Readiness', unit: '/10', a: A.kpis.readiness, b: B.kpis.readiness, dir: 'high' },
            { label: 'Sleep', unit: '/10', a: A.kpis.sleep, b: B.kpis.sleep, dir: 'high' },
            { label: 'Fatigue', unit: '/10', a: A.kpis.fatigue, b: B.kpis.fatigue, dir: 'low' },
            { label: 'Stress', unit: '/10', a: A.kpis.stress, b: B.kpis.stress, dir: 'low' },
            { label: 'Soreness', unit: '/10', a: A.kpis.soreness, b: B.kpis.soreness, dir: 'low' },
            { label: 'Recovery', unit: ' pts', a: A.kpis.recovery, b: B.kpis.recovery, dir: 'high' },
            { label: 'Total Load', unit: ' AU', a: A.kpis.total_load, b: B.kpis.total_load, dir: 'info' },
            { label: 'Athletes w/ pain', a: A.kpis.athletes_with_pain, b: B.kpis.athletes_with_pain, dir: 'low' },
            { label: 'Pain prevalence', unit: '%', a: A.kpis.pain_prevalence, b: B.kpis.pain_prevalence, dir: 'low' },
            { label: 'Availability', unit: '%', a: A.availability.availability_pct, b: B.availability.availability_pct, dir: 'high' },
          ];
          const deltaColor = (m) => {
            if (m.a == null || m.b == null || m.dir === 'info') return 'text-slate-500';
            const d = m.b - m.a;
            if (Math.abs(d) < 0.05) return 'text-slate-500';
            const better = m.dir === 'high' ? d > 0 : d < 0;
            return better ? 'text-emerald-600' : 'text-red-600';
          };
          const deltaText = (m) => {
            if (m.a == null || m.b == null || m.dir === 'info') return '—';
            const d = Math.round((m.b - m.a) * 100) / 100;
            if (d === 0) return '0';
            return `${d > 0 ? '▲ +' : '▼ '}${d}`;
          };
          const chartData = METRICS.filter((m) => m.dir !== 'info' && m.a != null && m.b != null && m.unit === '/10')
            .map((m) => ({ metric: m.label, [nameA]: m.a, [nameB]: m.b }));
          return (
            <SectionCard id="comparison" title="Period Comparison" subtitle={`${nameA}  vs  ${nameB}`}>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="er-compare-table">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-1.5">Metric</th>
                        <th className="text-right px-2 text-emerald-700">{nameA}</th>
                        <th className="text-right px-2 text-blue-700">{nameB}</th>
                        <th className="text-right pl-2">Δ (B−A)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m) => (
                        <tr key={m.label} className="border-b border-slate-100">
                          <td className="py-1.5 text-slate-700">{m.label}</td>
                          <td className="text-right px-2 font-semibold text-slate-700 tabular-nums">{fmt(m.a, m.unit || '')}</td>
                          <td className="text-right px-2 font-semibold text-slate-700 tabular-nums">{fmt(m.b, m.unit || '')}</td>
                          <td className={`text-right pl-2 font-bold tabular-nums ${deltaColor(m)}`}>{deltaText(m)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-slate-400 mt-2">Δ is Period B minus Period A. Green = better for that metric (readiness/sleep/recovery/adherence/availability higher is better; fatigue/stress/soreness/pain lower is better).</p>
                </div>
                <ChartFrame title="Wellness metrics side by side" unit="0-10 (higher = better readiness/sleep)" empty={chartData.length === 0}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={50} />
                      <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={gridTick} />
                      <RTooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey={nameA} fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey={nameB} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartFrame>
              </div>
            </SectionCard>
          );
        })()}

        {/* ===== Executive summary ===== */}
        {show('summary') && (
          <SectionCard id="summary" title="Executive Summary" subtitle="Auto-generated from real event data">
            <p className="text-sm leading-relaxed text-slate-700">{report.executive_summary}</p>
          </SectionCard>
        )}

        {/* ===== KPI grid ===== */}
        {show('kpis') && (
          <SectionCard id="kpis" title="Key Indicators" subtitle="Event-wide averages">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KPICard testid="kpi-athletes" label="Athletes" value={kpis.athletes} zone="gray" sub="Monitored" />
              <KPICard testid="kpi-adherence" label="Adherence" value={kpis.adherence} unit="%" zone={zonePct(kpis.adherence)} sub="Check-in rate" />
              <KPICard testid="kpi-readiness" label="Readiness" value={kpis.readiness} unit="/10" zone={zoneHigh(kpis.readiness)} sub="Avg readiness" />
              <KPICard testid="kpi-sleep" label="Sleep" value={kpis.sleep} unit="/10" zone={zoneHigh(kpis.sleep)} sub="Avg sleep" />
              <KPICard label="Fatigue" value={kpis.fatigue} unit="/10" zone={zoneLow(kpis.fatigue)} sub="Avg fatigue" />
              <KPICard label="Soreness" value={kpis.soreness} unit="/10" zone={zoneLow(kpis.soreness)} sub="Avg soreness" />
              <KPICard label="Stress" value={kpis.stress} unit="/10" zone={zoneLow(kpis.stress)} sub="Avg stress" />
              <KPICard label="Recovery" value={kpis.recovery} unit="pts" zone={zonePct(kpis.recovery, recovery.target * 0.8, recovery.target * 0.5)} sub={`Target ${recovery.target}`} />
              <KPICard label="Total Load" value={kpis.total_load} unit="AU" zone="gray" sub="Accumulated" />
              <KPICard label="Athletes w/ Pain" value={kpis.athletes_with_pain} zone={kpis.athletes_with_pain > 0 ? 'yellow' : 'green'} sub={fmt(kpis.pain_prevalence, '% prevalence')} />
              <KPICard label="Critical Alerts" value={kpis.alerts_red} zone={kpis.alerts_red > 0 ? 'red' : 'green'} sub="Red severity" />
              <KPICard label="Availability" value={availability.availability_pct} unit="%" zone={zonePct(availability.availability_pct, 70, 50)} sub="No risk factors" />
            </div>
          </SectionCard>
        )}

        {/* ===== Event overview ===== */}
        {show('overview') && (
          <SectionCard id="overview" title="Event Overview" subtitle="Daily evolution">
            <div className="grid md:grid-cols-2 gap-6">
              <ChartFrame title="Average readiness by day" unit="0-10" note="Dashed line = danger threshold (≤5)" empty={daily.every((d) => d.readiness === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis domain={[0, 10]} tick={gridTick} />
                    <RTooltip />
                    <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="5 4" label={{ value: 'Danger', position: 'insideBottomRight', fill: '#ef4444', fontSize: 10 }} />
                    <Line type="monotone" dataKey="readiness" stroke="#10b981" strokeWidth={2} name="Readiness" connectNulls dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ChartFrame title="Daily check-in adherence" unit="%" empty={daily.every((d) => d.adherence === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis domain={[0, 100]} tick={gridTick} />
                    <RTooltip />
                    <Bar dataKey="adherence" fill="#3b82f6" name="Adherence %" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ChartFrame title="Daily internal load" unit="AU" empty={daily.every((d) => d.load === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis tick={gridTick} />
                    <RTooltip />
                    <Area type="monotone" dataKey="load" stroke="#f59e0b" fill="#fde68a" name="Load" connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ChartFrame title="Athletes reporting pain by day" unit="count" empty={daily.every((d) => !d.athletes_with_pain)}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis tick={gridTick} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="athletes_with_pain" fill="#ef4444" name="Athletes w/ pain" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
          </SectionCard>
        )}

        {/* ===== Team comparison ===== */}
        {show('teams') && team_comparison.length >= 1 && (
          <SectionCard id="teams" title="Team Comparison" subtitle="Team 1 vs Team 2 across monitoring metrics">
            {team_comparison.length < 2 ? (
              <EmptyState label="Only one team in this selection — comparison not applicable." />
            ) : (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-1.5">Metric</th>
                        <th>All</th>
                        {team_comparison.map((t) => <th key={t.value}>{t.label}</th>)}
                        <th>Interpretation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARE_ROWS.map((row) => (
                        <CompareRow key={row.key} row={row} all={kpis} teams={team_comparison} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <ChartFrame title="Team profile radar" unit="normalized 0-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={gridStroke} />
                      <PolarAngleAxis dataKey="m" tick={{ fill: '#64748b', fontSize: 9 }} />
                      <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                      {team_comparison.map((t, i) => (
                        <Radar key={t.value} name={t.label} dataKey={t.label}
                          stroke={CHART_COLORS[i]} fill={CHART_COLORS[i]} fillOpacity={0.25} />
                      ))}
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </ChartFrame>
              </div>
            )}
          </SectionCard>
        )}

        {/* ===== Compliance ===== */}
        {show('compliance') && (
          <SectionCard id="compliance" title="Monitoring Compliance & Quality" subtitle={`${compliance.actual}/${compliance.expected} expected check-ins`}>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <ChartFrame title="Compliance by day" unit="%" empty={compliance.by_day.every((d) => d.adherence === null)}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compliance.by_day}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                      <YAxis domain={[0, 100]} tick={gridTick} />
                      <RTooltip />
                      <Bar dataKey="adherence" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Adherence %" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartFrame>
                <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
                  <MiniStat label="Overall" value={fmt(compliance.rate, '%')} zone={zonePct(compliance.rate)} />
                  <MiniStat label="100% athletes" value={compliance.perfect_count} zone="green" />
                  <MiniStat label="Low (<50%)" value={compliance.low_count} zone={compliance.low_count > 0 ? 'yellow' : 'green'} />
                </div>
              </div>
              <div className="space-y-4">
                <RankList title="Top adherence" items={mapNames(compliance.top_adherence, openAthlete)} unit="%" testid="rank-top-adherence" anonymize={anonymize} />
                <RankList title="Lowest adherence (staff only)" items={compliance.bottom_adherence} unit="%" tone="attention" anonymize={anonymize} testid="rank-low-adherence" />
              </div>
            </div>
          </SectionCard>
        )}

        {/* ===== Readiness ===== */}
        {show('readiness') && (
          <SectionCard id="readiness" title="Readiness & Wellness" subtitle="Sleep · Fatigue · Stress · Soreness · Disposition">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <ChartFrame title="Readiness average by day" unit="0-10" note="Dashed line = danger threshold (≤5)" empty={readiness.by_day.every((d) => d.value === null)}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readiness.by_day}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                      <YAxis domain={[0, 10]} tick={gridTick} />
                      <RTooltip />
                      <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="5 4" label={{ value: 'Danger', position: 'insideBottomRight', fill: '#ef4444', fontSize: 10 }} />
                      <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} name="Readiness" connectNulls dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartFrame>
              </div>
              <ChartFrame title="Athlete distribution by zone" unit="athletes" empty={zonePie.every((z) => !z.value)}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={zonePie} dataKey="value" nameKey="name" innerRadius={35} outerRadius={70} label>
                      {zonePie.map((z) => <Cell key={z.name} fill={z.color} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
            <div className="grid md:grid-cols-4 gap-2 mt-3 text-xs">
              <MiniStat label="Best day" value={shortDate(readiness.best_day) || '—'} zone="green" />
              <MiniStat label="Worst day" value={shortDate(readiness.worst_day) || '—'} zone="yellow" />
              <MiniStat label="First → Last" value={readiness.trend_first != null ? `${readiness.trend_first} → ${readiness.trend_last}` : '—'} zone={zoneHigh(readiness.trend_last)} />
              <MiniStat label="% at risk" value={fmt(readiness.pct_below, '%')} zone={zonePct(100 - (readiness.pct_below || 0))} />
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <RankList title="Highest average readiness" items={mapNames(readiness.top, openAthlete)} unit="/10" anonymize={anonymize} />
              <RankList title="Lowest average readiness" items={readiness.bottom} unit="/10" tone="attention" anonymize={anonymize} />
            </div>
            <div className="grid md:grid-cols-2 gap-2 mt-3">
              <MiniStat label="Biggest individual drop" value={readiness.biggest_drop ? `${anonymize ? maskName(readiness.biggest_drop.name) : readiness.biggest_drop.name} (${readiness.biggest_drop.value})` : '—'} zone="red" wide />
              <MiniStat label="Most stable athlete" value={readiness.most_stable ? `${anonymize ? maskName(readiness.most_stable.name) : readiness.most_stable.name} (σ ${readiness.most_stable.value})` : '—'} zone="green" wide />
            </div>
          </SectionCard>
        )}

        {/* ===== Pain ===== */}
        {show('pain') && (
          <SectionCard id="pain" title="Pain & Symptoms" subtitle="Reported symptoms — not a medical diagnosis">
            <div className="grid md:grid-cols-4 gap-2 mb-4 text-xs">
              <MiniStat label="Total reports" value={pain.total_reports} zone={pain.total_reports > 0 ? 'yellow' : 'green'} />
              <MiniStat label="Athletes reporting" value={pain.athletes_reporting} zone="yellow" />
              <MiniStat label="Prevalence" value={fmt(pain.prevalence, '%')} zone={zonePct(100 - (pain.prevalence || 0))} />
              <MiniStat label="Avg pain" value={fmt(pain.avg_pain, '/10')} zone={zoneLow(pain.avg_pain)} />
            </div>
            <div className="grid md:grid-cols-2 gap-6 mt-2">
              <BodyMap regions={pain.body_map} />
              <ChartFrame title="Most reported body regions" unit="reports" empty={pain.regions.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pain.regions} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis type="number" tick={gridTick} allowDecimals={false} />
                    <YAxis type="category" dataKey="region" tick={{ fill: '#64748b', fontSize: 10 }} width={80} />
                    <RTooltip />
                    <Bar dataKey="count" fill="#ef4444" radius={[0, 3, 3, 0]} name="Reports" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
            <div className="mt-4">
              <ChartFrame title="Average pain by day" unit="0-10" empty={pain.by_day.every((d) => d.avg === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pain.by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis domain={[0, 10]} tick={gridTick} />
                    <RTooltip />
                    <ReferenceLine y={7} stroke="#ef4444" strokeDasharray="5 4" label={{ value: 'High', position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }} />
                    <Line type="monotone" dataKey="avg" stroke="#f97316" strokeWidth={2} name="Avg pain" connectNulls dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1.5">Recurrent pain (≥2 days)</p>
                {pain.recurrent.length === 0 ? <EmptyState label="None" /> : (
                  <div className="flex flex-wrap gap-1.5">
                    {pain.recurrent.map((p) => <Badge key={p.id} variant="outline" className="text-[11px] border-amber-300 text-amber-700 cursor-pointer" onClick={() => openAthlete(p.id)}>{anonymize ? maskName(p.name) : p.name} · {p.days}d</Badge>)}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1.5">Intense pain (≥7/10)</p>
                {pain.intense.length === 0 ? <EmptyState label="None" /> : (
                  <div className="flex flex-wrap gap-1.5">
                    {pain.intense.map((p) => <Badge key={p.id} variant="outline" className="text-[11px] border-red-300 text-red-700 cursor-pointer" onClick={() => openAthlete(p.id)}>{anonymize ? maskName(p.name) : p.name} · {p.max}/10</Badge>)}
                  </div>
                )}
              </div>
            </div>

            {/* Detailed complaints log */}
            <div className="mt-5 border-t border-slate-200 pt-4" data-testid="pain-complaints">
              <p className="text-sm font-bold text-slate-700 mb-2">Complaints log ({pain.complaints.length})</p>
              {pain.complaints.length === 0 ? <EmptyState label="No complaints reported" /> : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-1.5">Date</th>
                        <th>Athlete</th>
                        <th>Team</th>
                        <th>Region</th>
                        <th>Side</th>
                        <th>Level</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pain.complaints.map((c, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1.5 tabular-nums text-slate-500">{c.date}</td>
                          <td className="font-medium">{anonymize ? maskName(c.name) : c.name}</td>
                          <td className="text-slate-500">{c.team}</td>
                          <td>{c.region}</td>
                          <td className="text-slate-500">{c.laterality || '—'}</td>
                          <td>
                            <span className={`font-bold ${c.level >= 7 ? 'text-red-600' : c.level >= 4 ? 'text-amber-600' : 'text-emerald-600'}`}>{c.level}/10</span>
                          </td>
                          <td className="text-slate-400">{c.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* ===== Load ===== */}
        {show('load') && (
          <SectionCard id="load" title="Perceived Internal Load" subtitle="Duration × RPE (subjective load only)">
            <div className="grid md:grid-cols-4 gap-2 mb-3 text-xs">
              <MiniStat label="Total load" value={fmt(load.total, ' AU')} zone="gray" />
              <MiniStat label="Avg / day" value={fmt(load.avg_per_day, ' AU')} zone="gray" />
              <MiniStat label="Monotony" value={fmt(load.monotony)} zone="gray" />
              <MiniStat label="Strain" value={fmt(load.strain)} zone="gray" />
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <ChartFrame title="Load by day" unit="AU" empty={load.by_day.every((d) => d.load === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={load.by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis tick={gridTick} />
                    <RTooltip />
                    <Bar dataKey="load" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Load" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ChartFrame title="Load vs readiness by day" note="Higher load days vs team readiness" empty={load.readiness_vs_load.every((d) => d.load === null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={load.readiness_vs_load}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                    <YAxis yAxisId="l" tick={gridTick} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 10]} tick={gridTick} />
                    <RTooltip />
                    <Line yAxisId="l" type="monotone" dataKey="load" stroke="#f59e0b" name="Load" connectNulls dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="readiness" stroke="#10b981" name="Readiness" connectNulls dot={false} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
            <div className="mt-3"><RankList title="Highest accumulated load" items={mapNames(load.top, openAthlete)} unit=" AU" anonymize={anonymize} /></div>
          </SectionCard>
        )}

        {/* ===== Recovery ===== */}
        {show('recovery') && (
          <SectionCard id="recovery" title="Recovery Points" subtitle={`Daily recovery scoring (target ${recovery.target})`}>
            <div className="grid md:grid-cols-4 gap-2 mb-3 text-xs">
              <MiniStat label="Avg / day" value={fmt(recovery.avg, ' pts')} zone={zonePct(recovery.avg, recovery.target * 0.8, recovery.target * 0.5)} />
              <MiniStat label="Total points" value={recovery.total_points} zone="gray" />
              <MiniStat label="Compliance" value={fmt(recovery.compliance, '%')} zone={zonePct(recovery.compliance)} />
              <MiniStat label="Best day" value={shortDate(recovery.best_day) || '—'} zone="green" />
            </div>
            <ChartFrame title="Recovery points by day" unit="pts" empty={recovery.by_day.every((d) => d.value === null)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={recovery.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" tick={gridTick} tickFormatter={shortDate} />
                  <YAxis tick={gridTick} />
                  <RTooltip />
                  <Bar dataKey="value" fill="#06b6d4" radius={[3, 3, 0, 0]} name="Recovery pts" />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <RankList title="Top recovery" items={mapNames(recovery.top, openAthlete)} unit=" pts" anonymize={anonymize} />
              <RankList title="Lowest recovery" items={recovery.bottom} unit=" pts" tone="attention" anonymize={anonymize} />
            </div>

            {/* Recovery proof submission report */}
            <div className="mt-5 border-t border-slate-200 pt-4" data-testid="recovery-proofs-report">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <p className="text-sm font-bold text-slate-700">Recovery Proof Submission</p>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">Submitted: {recovery.proofs.submitted_count}</Badge>
                  <Badge variant="outline" className="border-red-300 text-red-700">Not submitted: {recovery.proofs.not_submitted_count}</Badge>
                  <Badge variant="outline">Proof rate: {fmt(recovery.proofs.proof_rate, '%')}</Badge>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-emerald-600 mb-1.5">✓ Submitted proof</p>
                  {recovery.proofs.submitted.length === 0 ? <EmptyState label="Nobody submitted proofs" /> : (
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {recovery.proofs.submitted.map((a) => (
                        <div key={a.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-emerald-50 cursor-pointer hover:bg-emerald-100" onClick={() => openAthlete(a.id)}>
                          <span>{anonymize ? maskName(a.name) : a.name}<span className="text-slate-400 ml-1">· {a.team}</span></span>
                          <span className="font-bold text-emerald-700">{a.count} proof{a.count > 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-600 mb-1.5">✗ No proof submitted</p>
                  {recovery.proofs.not_submitted.length === 0 ? <EmptyState label="Everyone submitted proofs" /> : (
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {recovery.proofs.not_submitted.map((a) => (
                        <div key={a.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-red-50 cursor-pointer hover:bg-red-100" onClick={() => openAthlete(a.id)}>
                          <span>{anonymize ? maskName(a.name) : a.name}<span className="text-slate-400 ml-1">· {a.team}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* ===== Availability & Risk ===== */}
        {show('availability') && (
          <SectionCard id="availability" title="Availability & Risk Overview" subtitle="Explainable, multi-factor — decision support only, not a diagnosis">
            <div className="grid md:grid-cols-3 gap-6">
              <ChartFrame title="Final athlete status" unit="athletes" empty={riskPie.every((r) => !r.value)}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={riskPie} dataKey="value" nameKey="name" innerRadius={35} outerRadius={70} label>
                      {riskPie.map((r) => <Cell key={r.name} fill={r.color} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartFrame>
              <div className="md:col-span-2">
                <p className="text-xs font-bold text-slate-700 mb-1.5">Athletes needing attention</p>
                {availability.attention_rows.length === 0 ? <EmptyState label="No athletes flagged" /> : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {availability.attention_rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-slate-50 cursor-pointer" onClick={() => openAthlete(r.id)} data-testid={`risk-row-${r.id}`}>
                        <span className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${r.level === 'red' ? 'bg-red-500' : r.level === 'orange' ? 'bg-orange-500' : 'bg-amber-500'}`} />
                          <span className="font-medium">{anonymize ? maskName(r.name) : r.name}</span>
                          <span className="text-slate-400">· {r.team}</span>
                        </span>
                        <span className="text-slate-500 text-right truncate max-w-[55%]">{r.factors.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* ===== Rankings ===== */}
        {show('rankings') && (
          <SectionCard id="rankings" title="Event Rankings" subtitle="Positive rankings and attention rankings">
            <div className="grid md:grid-cols-3 gap-5">
              <RankList title="Best readiness" items={mapNames(rankings.top_readiness, openAthlete)} unit="/10" anonymize={anonymize} />
              <RankList title="Most stable readiness (σ)" items={rankings.most_stable_readiness} anonymize={anonymize} />
              <RankList title="Best sleep" items={rankings.best_sleep} unit="/10" anonymize={anonymize} />
              <RankList title="Best recovery" items={rankings.best_recovery} unit=" pts" anonymize={anonymize} />
              <RankList title="Best readiness evolution" items={rankings.best_readiness_evolution} anonymize={anonymize} />
              <RankList title="Highest load" items={rankings.highest_load} unit=" AU" anonymize={anonymize} />
              <RankList title="Most pain days" items={rankings.most_pain_days} unit="d" tone="attention" anonymize={anonymize} />
              <RankList title="Biggest readiness drop" items={rankings.biggest_readiness_drop} tone="attention" anonymize={anonymize} />
              <RankList title="Lowest adherence" items={compliance.bottom_adherence} unit="%" tone="attention" anonymize={anonymize} />
            </div>
          </SectionCard>
        )}

        {/* ===== Team profiles ===== */}
        {show('teams') && team_profiles.length > 0 && (
          <SectionCard id="team-profiles" title="Team Profiles" subtitle="Auto-generated strengths, attention points & recommendations">
            <div className="grid md:grid-cols-2 gap-4">
              {team_profiles.map((tp) => (
                <div key={tp.label} className="border border-slate-200 rounded-lg p-3">
                  <p className="font-bold text-slate-800">{tp.label}</p>
                  <div className="mt-2 space-y-2 text-xs">
                    <ProfileList title="Strengths" items={tp.strengths} color="text-emerald-600" />
                    <ProfileList title="Attention points" items={tp.attention} color="text-amber-600" />
                    <ProfileList title="Recommendations" items={tp.recommendations} color="text-blue-600" />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ===== Insights ===== */}
        {show('insights') && (
          <SectionCard id="insights" title="Key Insights" subtitle="Prioritized, data-backed observations">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {insights.map((ins, i) => <InsightCard key={i} insight={ins} anonymize={anonymize} />)}
            </div>
          </SectionCard>
        )}

        {/* ===== Recommendations ===== */}
        {show('recommendations') && (
          <SectionCard id="recommendations" title="Final Recommendations">
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              <RecBlock title="Coaching staff" items={recommendations.technical} />
              <RecBlock title="Medical / Physiotherapy" items={recommendations.medical} />
              <RecBlock title="Event management" items={recommendations.event} />
              <RecBlock title="Future events" items={recommendations.future} />
            </div>
          </SectionCard>
        )}

        {/* ===== Data quality ===== */}
        {show('quality') && (
          <SectionCard id="quality" title="Data Quality" right={<ConfidenceBadge level={data_quality.confidence} />}>
            <div className="grid md:grid-cols-3 gap-2 text-xs">
              <MiniStat label="Athletes w/o check-in" value={data_quality.athletes_without_checkin} zone={data_quality.athletes_without_checkin ? 'yellow' : 'green'} />
              <MiniStat label="Low-collection days" value={data_quality.low_collection_days.length} zone={data_quality.low_collection_days.length ? 'yellow' : 'green'} />
              <MiniStat label="Report confidence" value={data_quality.confidence} zone={data_quality.confidence === 'high' ? 'green' : data_quality.confidence === 'moderate' ? 'yellow' : 'red'} />
            </div>
            {data_quality.notes.length > 0 && (
              <ul className="mt-3 text-xs text-slate-500 list-disc pl-5 space-y-0.5">
                {data_quality.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </SectionCard>
        )}

        <p className="text-center text-[11px] text-slate-400 pt-4">
          {meta.organization} · Event Report · Generated {genDate.toLocaleString()} · Confidential
        </p>
      </div>

      {/* ===== Individual athlete modal ===== */}
      <Dialog open={!!athleteModal} onOpenChange={(o) => { if (!o) { setAthleteModal(null); setAthleteData(null); } }}>
        <DialogContent className="max-w-2xl" data-testid="athlete-report-modal">
          <DialogHeader>
            <DialogTitle>Individual Athlete Report</DialogTitle>
            <DialogDescription>Per-athlete monitoring summary for the selected period.</DialogDescription>
          </DialogHeader>
          {!athleteData ? <EmptyState label="Loading…" /> : <IndividualReport a={athleteData} anonymize={anonymize} />}
        </DialogContent>
      </Dialog>

      {/* ===== New / edit event dialog ===== */}
      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="max-w-md" data-testid="er-new-event-dialog">
          <DialogHeader>
            <DialogTitle>{editingEventId ? 'Edit report period' : 'New report period'}</DialogTitle>
            <DialogDescription>Create a named event (e.g. "Haverford Camp") over a date range. The report will use all data collected in that period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs" htmlFor="ne-name">Event name</Label>
              <Input id="ne-name" value={newEvent.name} placeholder="Haverford Camp" onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} className="h-9" data-testid="er-ne-name" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={newEvent.event_type} onValueChange={(v) => setNewEvent({ ...newEvent, event_type: v })}>
                <SelectTrigger className="h-9" data-testid="er-ne-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="training_camp">Training camp</SelectItem>
                  <SelectItem value="tournament">Tournament</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start date</Label>
                <Input type="date" value={newEvent.start_date} onChange={(e) => setNewEvent({ ...newEvent, start_date: e.target.value })} className="h-9" data-testid="er-ne-start" />
              </div>
              <div>
                <Label className="text-xs">End date</Label>
                <Input type="date" value={newEvent.end_date} onChange={(e) => setNewEvent({ ...newEvent, end_date: e.target.value })} className="h-9" data-testid="er-ne-end" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Team</Label>
              <Select value={newEvent.team} onValueChange={(v) => setNewEvent({ ...newEvent, team: v })}>
                <SelectTrigger className="h-9" data-testid="er-ne-team"><SelectValue /></SelectTrigger>
                <SelectContent>{TEAM_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="ne-desc">Description (optional)</Label>
              <Input id="ne-desc" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} className="h-9" data-testid="er-ne-desc" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowEventDialog(false)} data-testid="er-ne-cancel">Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={savingEvent} onClick={saveEvent} data-testid="er-ne-save">
              {savingEvent ? 'Saving…' : (editingEventId ? 'Save changes' : 'Create & select')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Confirm delete dialog ===== */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm" data-testid="er-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete this event?</DialogTitle>
            <DialogDescription>
              This removes the saved period "{events.find((e) => e.id === eventId)?.name || ''}" from the list. The underlying athlete data is not affected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} data-testid="er-delete-cancel">Cancel</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={deleting} onClick={deleteEvent} data-testid="er-delete-confirm">
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
