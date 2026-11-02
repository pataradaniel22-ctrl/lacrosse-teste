import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Loader2, Plus, Trash2, CalendarRange, Timer, Users } from 'lucide-react';
import { API, useIir, apiError, fmtDate } from './iirCommon';

const selectCls = 'h-9 w-full rounded-md bg-background/50 border border-white/10 px-2 text-sm';
const inp = 'h-9 bg-background/50 border-white/10 text-sm';

export default function ExposurePanel() {
  const { me, athletes, events, getAuthHeaders, reloadEvents } = useIir();
  const canEdit = me?.can_manage_exposure;
  const [data, setData] = useState(null);
  const [monitoring, setMonitoring] = useState([]);
  const [eventFilter, setEventFilter] = useState('');
  const [showSession, setShowSession] = useState(false);
  const [showEvent, setShowEvent] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = eventFilter ? `?event_id=${eventFilter}` : '';
      const [s, m] = await Promise.all([
        axios.get(`${API}/iir/exposure/sessions${q}`, getAuthHeaders()),
        axios.get(`${API}/iir/monitoring${q}`, getAuthHeaders()),
      ]);
      setData(s.data);
      setMonitoring(m.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not load exposure'));
    }
  }, [eventFilter, getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const removeSession = async (id) => {
    const reason = window.prompt('Reason for removing this session:');
    if (!reason) return;
    try {
      await axios.delete(`${API}/iir/exposure/sessions/${id}?reason=${encodeURIComponent(reason)}`, getAuthHeaders());
      load();
    } catch (err) { toast.error(apiError(err)); }
  };
  const removeMon = async (id) => {
    if (!window.confirm('Remove this monitoring period?')) return;
    try { await axios.delete(`${API}/iir/monitoring/${id}`, getAuthHeaders()); load(); } catch (err) { toast.error(apiError(err)); }
  };

  const hours = data?.totals?.hours || {};
  const athleteDays = monitoring.reduce((acc, m) => {
    const s = new Date(m.start_date); const e = new Date(m.end_date);
    return acc + Math.max(0, Math.round((e - s) / 86400000) + 1);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={`${selectCls} w-64`} value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          <option value="">All events</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setShowEvent((s) => !s)}><CalendarRange className="w-4 h-4 mr-1" />New event</Button>}
        {canEdit && <Button size="sm" onClick={() => setShowSession((s) => !s)} data-testid="iir-add-session-btn"><Plus className="w-4 h-4 mr-1" />Add game / training</Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Box label="Athlete game hours" value={(hours.game || 0).toFixed(1)} />
        <Box label="Athlete training hours" value={(hours.training || 0).toFixed(1)} />
        <Box label="Sessions" value={data?.sessions?.length ?? '—'} />
        <Box label="Monitored athlete-days" value={athleteDays} />
      </div>
      {data?.totals?.estimates?.length > 0 && (
        <p className="text-[11px] text-amber-300">{data.totals.estimates.length} session(s) use a collective estimate (method recorded). Individual records always take precedence for the same session.</p>
      )}

      {showEvent && canEdit && <EventForm getAuthHeaders={getAuthHeaders} onDone={async () => { setShowEvent(false); await reloadEvents(); }} />}
      {showSession && canEdit && <SessionForm athletes={athletes} events={events} getAuthHeaders={getAuthHeaders} onDone={() => { setShowSession(false); load(); }} />}

      <Card className="glass-light border-white/5">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Timer className="w-4 h-4" />Games and trainings</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="iir-sessions-table">
            <thead className="text-[11px] uppercase text-muted-foreground">
              <tr><th className="text-left p-2">Date</th><th className="text-left p-2">Type</th><th className="text-left p-2">Session / match</th><th className="text-left p-2">Team</th><th className="text-right p-2">Duration</th><th className="text-right p-2">Athletes</th><th className="text-right p-2">Athlete-hours</th><th className="text-left p-2">Source</th><th /></tr>
            </thead>
            <tbody>
              {(data?.sessions || []).map((s) => (
                <tr key={s.id} className="border-t border-white/5">
                  <td className="p-2 text-xs">{fmtDate(s.date)}</td>
                  <td className="p-2"><Badge variant="outline" className="text-[10px]">{s.context}</Badge></td>
                  <td className="p-2 text-xs">{s.session_label || '—'}</td>
                  <td className="p-2 text-xs">{s.team || '—'}</td>
                  <td className="p-2 text-xs text-right">{s.duration_min ? `${s.duration_min} min` : '—'}</td>
                  <td className="p-2 text-xs text-right">{s.individual?.length ? s.individual.filter((r) => r.participation !== 'absent').length : (s.collective ? `~${s.collective.athletes}` : '—')}</td>
                  <td className="p-2 text-xs text-right font-mono">{(s.athlete_hours || 0).toFixed(2)}</td>
                  <td className="p-2 text-[11px]">{s.collective ? <span className="text-amber-300" title={s.collective.method}>estimated (collective)</span> : (s.data_source || 'individual')}</td>
                  <td className="p-2">{canEdit && <Button size="icon" variant="ghost" onClick={() => removeSession(s.id)}><Trash2 className="w-3 h-3" /></Button>}</td>
                </tr>
              ))}
              {(data?.sessions || []).length === 0 && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground text-sm">No exposure recorded. Rates will show "not calculable".</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="glass-light border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />Monitoring periods (athlete-days, for illness rates)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && <MonitoringForm athletes={athletes} events={events} getAuthHeaders={getAuthHeaders} onDone={load} />}
          <div className="max-h-64 overflow-y-auto">
            {monitoring.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-xs border-b border-white/5 py-1">
                <span className="w-48 truncate">{m.athlete_name || m.team || 'athlete'}</span>
                <span>{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</span>
                <span className="text-muted-foreground">{m.note}</span>
                {canEdit && <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" onClick={() => removeMon(m.id)}><Trash2 className="w-3 h-3" /></Button>}
              </div>
            ))}
            {monitoring.length === 0 && <p className="text-sm text-muted-foreground">No monitoring periods. Illness rates per 1,000 athlete-days will show "not calculable".</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Box({ label, value }) {
  return (
    <Card className="glass-light border-white/5"><CardContent className="p-4">
      <p className="text-2xl font-heading font-bold">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p>
    </CardContent></Card>
  );
}

function EventForm({ getAuthHeaders, onDone }) {
  const [v, setV] = useState({ format: 'sixes', period_minutes: 8, periods: 4, overtime_minutes: 3, game_days: 4, teams: [] });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await axios.post(`${API}/iir/events`, v, getAuthHeaders()); toast.success('Event created'); onDone(); }
    catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };
  const setT = (i, patch) => setV({ ...v, teams: v.teams.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <Card className="border-primary/30 bg-primary/5"><CardContent className="p-4 space-y-3">
      <p className="text-sm font-medium">New event / camp / competition</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Input className={inp} placeholder="Name *" value={v.name || ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Input className={inp} placeholder="Season (e.g. 2026)" value={v.season || ''} onChange={(e) => setV({ ...v, season: e.target.value })} />
        <Input className={inp} type="date" value={v.start_date || ''} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
        <Input className={inp} type="date" value={v.end_date || ''} onChange={(e) => setV({ ...v, end_date: e.target.value })} />
        <select className={selectCls} value={v.format} onChange={(e) => setV({ ...v, format: e.target.value })}>
          <option value="sixes">Sixes</option><option value="field">Field (10s/12s)</option><option value="box">Box</option><option value="other">Other</option>
        </select>
        <Input className={inp} type="number" placeholder="Period minutes" value={v.period_minutes} onChange={(e) => setV({ ...v, period_minutes: e.target.value })} title="Minutes per period" />
        <Input className={inp} type="number" placeholder="Periods" value={v.periods} onChange={(e) => setV({ ...v, periods: e.target.value })} title="Number of periods" />
        <Input className={inp} type="number" placeholder="Game days" value={v.game_days} onChange={(e) => setV({ ...v, game_days: e.target.value })} title="Number of game days (GD)" />
      </div>
      <p className="text-[11px] text-muted-foreground">Period durations of the reference are the Sixes configuration (4 × 8 min, overtime 3 min); adjust them for other formats.</p>
      <div className="space-y-1">
        <p className="text-xs">Teams in the analysis</p>
        {v.teams.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input className={`${inp} w-48`} placeholder="Team" value={t.name} onChange={(e) => setT(i, { name: e.target.value })} />
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={t.included} onChange={(e) => setT(i, { included: e.target.checked })} />included</label>
            {!t.included && <Input className={inp} placeholder="Reason for exclusion *" value={t.exclusion_reason || ''} onChange={(e) => setT(i, { exclusion_reason: e.target.value })} />}
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setV({ ...v, teams: [...v.teams, { name: '', included: true }] })}><Plus className="w-3 h-3 mr-1" />Add team</Button>
      </div>
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button><Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create event'}</Button></div>
    </CardContent></Card>
  );
}

function SessionForm({ athletes, events, getAuthHeaders, onDone }) {
  const [v, setV] = useState({ context: 'game', data_source: 'measured', date: new Date().toISOString().slice(0, 10) });
  const [modeInd, setModeInd] = useState(true);
  const [team, setTeam] = useState('');
  const [rows, setRows] = useState({});
  const [col, setCol] = useState({});
  const [saving, setSaving] = useState(false);
  const teams = [...new Set(athletes.map((a) => a.team).filter(Boolean))];
  const roster = athletes.filter((a) => !team || a.team === team);

  const fillAll = () => {
    const d = Number(v.duration_min) || 0;
    const r = {};
    roster.forEach((a) => { r[a.id] = { minutes: d, participation: 'full' }; });
    setRows(r);
  };
  const save = async () => {
    setSaving(true);
    const body = { ...v, team: team || null };
    if (modeInd) {
      body.individual = Object.entries(rows).filter(([, r]) => r.participation || r.minutes !== undefined)
        .map(([athlete_id, r]) => ({ athlete_id, minutes: r.minutes === '' ? null : r.minutes, participation: r.participation }));
      if (!body.individual.length) { toast.error('Enter minutes for at least one athlete, or use a collective estimate'); setSaving(false); return; }
    } else {
      body.collective = col;
    }
    try { await axios.post(`${API}/iir/exposure/sessions`, body, getAuthHeaders()); toast.success('Session saved'); onDone(); }
    catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="iir-session-form"><CardContent className="p-4 space-y-3">
      <p className="text-sm font-medium">New game / training</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select className={selectCls} value={v.context} onChange={(e) => setV({ ...v, context: e.target.value })}><option value="game">Game</option><option value="training">Training</option></select>
        <Input className={inp} type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        <Input className={inp} placeholder="Match # / session label" value={v.session_label || ''} onChange={(e) => setV({ ...v, session_label: e.target.value })} />
        <Input className={inp} type="number" placeholder="Duration (min)" value={v.duration_min || ''} onChange={(e) => setV({ ...v, duration_min: e.target.value })} />
        <select className={selectCls} value={v.event_id || ''} onChange={(e) => setV({ ...v, event_id: e.target.value || null })}>
          <option value="">No event</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        <select className={selectCls} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={selectCls} value={v.data_source} onChange={(e) => setV({ ...v, data_source: e.target.value })}>
          <option value="measured">Measured</option><option value="reported">Reported</option><option value="estimated">Estimated</option>
        </select>
        <Input className={inp} placeholder="Coverage note (optional)" value={v.coverage_note || ''} onChange={(e) => setV({ ...v, coverage_note: e.target.value })} />
      </div>
      <div className="flex gap-2 text-xs">
        <button type="button" className={`px-2 py-1 rounded ${modeInd ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`} onClick={() => setModeInd(true)}>Minutes per athlete</button>
        <button type="button" className={`px-2 py-1 rounded ${!modeInd ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`} onClick={() => setModeInd(false)}>Collective estimate</button>
      </div>
      {modeInd ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground">Do not assume everyone played the whole game: enter the minutes actually played.</p>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={fillAll}>Prefill everyone = duration</Button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {roster.map((a) => {
              const r = rows[a.id] || {};
              return (
                <div key={a.id} className="grid grid-cols-12 gap-2 items-center text-xs">
                  <span className="col-span-5 truncate">{a.name}</span>
                  <select className={`${selectCls} col-span-4 h-8`} value={r.participation || ''} onChange={(e) => setRows({ ...rows, [a.id]: { ...r, participation: e.target.value || undefined } })}>
                    <option value="">—</option><option value="full">Full</option><option value="partial">Partial</option><option value="absent">Absent</option>
                  </select>
                  <Input className={`${inp} col-span-3 h-8`} type="number" placeholder="min" value={r.minutes ?? ''} onChange={(e) => setRows({ ...rows, [a.id]: { ...r, minutes: e.target.value } })} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Input className={inp} type="number" placeholder="Athletes" value={col.athletes || ''} onChange={(e) => setCol({ ...col, athletes: e.target.value })} />
          <Input className={inp} type="number" placeholder="Minutes each" value={col.minutes_each || ''} onChange={(e) => setCol({ ...col, minutes_each: e.target.value })} />
          <Input className={inp} placeholder="Estimation method *" value={col.method || ''} onChange={(e) => setCol({ ...col, method: e.target.value })} />
          <p className="col-span-3 text-[11px] text-amber-300">Collective estimates are flagged in reports. Do not also enter individual minutes for the same session.</p>
        </div>
      )}
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button><Button size="sm" onClick={save} disabled={saving} data-testid="iir-save-session">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save session'}</Button></div>
    </CardContent></Card>
  );
}

function MonitoringForm({ athletes, events, getAuthHeaders, onDone }) {
  const [team, setTeam] = useState('');
  const [v, setV] = useState({});
  const [saving, setSaving] = useState(false);
  const teams = [...new Set(athletes.map((a) => a.team).filter(Boolean))];
  const save = async () => {
    const ids = athletes.filter((a) => !team || a.team === team).map((a) => a.id);
    setSaving(true);
    try {
      const r = await axios.post(`${API}/iir/monitoring`, { ...v, athlete_ids: ids }, getAuthHeaders());
      toast.success(`${r.data.added} monitoring period(s) added`);
      setV({}); onDone();
    } catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-center">
      <select className={selectCls} value={team} onChange={(e) => setTeam(e.target.value)}>
        <option value="">All athletes</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <Input className={inp} type="date" value={v.start_date || ''} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
      <Input className={inp} type="date" value={v.end_date || ''} onChange={(e) => setV({ ...v, end_date: e.target.value })} />
      <select className={selectCls} value={v.event_id || ''} onChange={(e) => setV({ ...v, event_id: e.target.value || null })}>
        <option value="">No event</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
      </select>
      <Input className={inp} placeholder="Note" value={v.note || ''} onChange={(e) => setV({ ...v, note: e.target.value })} />
      <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add period'}</Button>
    </div>
  );
}
