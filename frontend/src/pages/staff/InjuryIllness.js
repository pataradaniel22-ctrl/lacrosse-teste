import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { ArrowLeft, ClipboardPlus, Thermometer, Bandage, Search, AlertTriangle, Inbox, Loader2, ShieldAlert } from 'lucide-react';
import {
  API, IirContext, apiError, eventDateKey, optLabel, fmtDate,
  ParticipationBadge, StatusBadge, TimeLossDays,
} from '../../components/iir/iirCommon';
import EpisodeForm from '../../components/iir/EpisodeForm';
import EpisodeDetail from '../../components/iir/EpisodeDetail';
import ExposurePanel from '../../components/iir/ExposurePanel';
import ReportsPanel from '../../components/iir/ReportsPanel';

const selectCls = 'h-9 rounded-md bg-background/50 border border-white/10 px-2 text-sm';

export default function InjuryIllness() {
  const { getAuthHeaders } = useAuth();
  const [me, setMe] = useState(null);
  const [tax, setTax] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [events, setEvents] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState('injury');
  const [formEpisode, setFormEpisode] = useState(null);
  const [formPrefill, setFormPrefill] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const loadEpisodes = useCallback(async () => {
    const [e, a] = await Promise.all([
      axios.get(`${API}/iir/episodes`, getAuthHeaders()),
      axios.get(`${API}/iir/availability`, getAuthHeaders()),
    ]);
    setEpisodes(e.data);
    setAvailability(a.data);
  }, [getAuthHeaders]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const m = await axios.get(`${API}/iir/me`, getAuthHeaders());
      setMe(m.data);
      if (!m.data.level) { setLoading(false); return; }
      const t = await axios.get(`${API}/iir/taxonomy`, getAuthHeaders());
      setTax(t.data);
      const ev = await axios.get(`${API}/iir/events`, getAuthHeaders());
      setEvents(ev.data);
      if (m.data.can_view_availability) {
        const ath = await axios.get(`${API}/iir/athletes`, getAuthHeaders());
        setAthletes(ath.data);
      }
      if (m.data.can_record) {
        const [st, pe] = await Promise.all([
          axios.get(`${API}/iir/staff`, getAuthHeaders()),
          axios.get(`${API}/iir/pending`, getAuthHeaders()),
        ]);
        setStaff(st.data);
        setPending(pe.data);
      }
      if (m.data.can_view_availability) await loadEpisodes();
      if (m.data.level === 'research') setTab('reports');
    } catch (err) {
      toast.error(apiError(err, 'Could not load Injury & Illness data'));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, loadEpisodes]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refresh = async () => {
    try {
      await loadEpisodes();
      if (me?.can_record) {
        const pe = await axios.get(`${API}/iir/pending`, getAuthHeaders());
        setPending(pe.data);
      }
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const openNew = (kind, prefill = null) => {
    setFormKind(kind); setFormEpisode(null); setFormPrefill(prefill); setFormOpen(true);
  };
  const openEdit = (ep) => {
    setFormKind(ep.kind); setFormEpisode(ep); setFormPrefill(null); setFormOpen(true); setDetailId(null);
  };

  const ctx = useMemo(() => ({ tax, athletes, staff, events, getAuthHeaders, me, reloadEvents: async () => {
    const ev = await axios.get(`${API}/iir/events`, getAuthHeaders()); setEvents(ev.data);
  } }), [tax, athletes, staff, events, getAuthHeaders, me]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (!me?.level) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        <ShieldAlert className="w-8 h-8 text-red-400" />
        <p className="font-medium">You do not have access to Injury & Illness Recording.</p>
        <Link to="/staff" className="text-sm text-primary underline">Back to dashboard</Link>
      </div>
    );
  }

  const isClinical = me.can_view_clinical;
  const injuries = episodes.filter((e) => e.kind === 'injury');
  const illnesses = episodes.filter((e) => e.kind === 'illness');
  const active = episodes.filter((e) => e.status === 'open');
  const drafts = episodes.filter((e) => e.status === 'draft');

  return (
    <IirContext.Provider value={ctx}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
            <Link to="/staff" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
            <ClipboardPlus className="w-5 h-5 text-rose-400" />
            <div>
              <h1 className="font-heading font-bold text-lg leading-none">Injury &amp; Illness Recording</h1>
              <p className="text-xs text-muted-foreground">Clinical recording and longitudinal surveillance</p>
            </div>
            {me.can_record && (
              <div className="ml-auto flex gap-2">
                <Button size="sm" className="bg-rose-600 hover:bg-rose-500 text-white" onClick={() => openNew('injury')} data-testid="record-injury-btn">
                  <Bandage className="w-4 h-4 mr-1.5" />Record Injury
                </Button>
                <Button size="sm" className="bg-violet-600 hover:bg-violet-500 text-white" onClick={() => openNew('illness')} data-testid="record-illness-btn">
                  <Thermometer className="w-4 h-4 mr-1.5" />Record Illness
                </Button>
              </div>
            )}
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-5">
          {!isClinical && me.level === 'coach' && (
            <p className="mb-4 text-xs rounded-md border border-white/10 bg-white/5 p-2 text-muted-foreground">
              Coaching staff view: participation and availability only. Diagnoses, clinical notes and attachments are restricted to the health team.
            </p>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/40">
              {me.can_view_availability && <TabsTrigger value="overview" data-testid="iir-tab-overview">Overview</TabsTrigger>}
              {isClinical && <TabsTrigger value="injuries" data-testid="iir-tab-injuries">Injuries ({injuries.length})</TabsTrigger>}
              {isClinical && <TabsTrigger value="illnesses" data-testid="iir-tab-illnesses">Illnesses ({illnesses.length})</TabsTrigger>}
              {isClinical && <TabsTrigger value="followup" data-testid="iir-tab-followup">Follow-up{pending.length ? ` · ${pending.length} pending` : ''}</TabsTrigger>}
              {(isClinical || me.level === 'research') && <TabsTrigger value="exposure" data-testid="iir-tab-exposure">Exposure</TabsTrigger>}
              {me.can_view_reports && <TabsTrigger value="reports" data-testid="iir-tab-reports">Reports &amp; Export</TabsTrigger>}
            </TabsList>

            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Active episodes" value={active.length} />
                <Stat label="Athletes unavailable" value={availability.filter((a) => a.participation === 'unavailable').length} tone="red" />
                <Stat label="Modified participation" value={availability.filter((a) => a.participation === 'modified').length} tone="amber" />
                {isClinical ? <Stat label="Drafts / pending assessments" value={`${drafts.length} / ${pending.length}`} /> : <Stat label="Athletes" value={availability.length} />}
              </div>
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Current availability (all active episodes considered)</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="iir-availability">
                    {availability.filter((a) => a.active_episodes > 0).map((a) => (
                      <div key={a.athlete_id} className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                        <div>
                          <p className="text-sm">{a.name}</p>
                          <p className="text-[10px] text-muted-foreground">{a.team} · {a.active_episodes} active{a.latest_estimated_return ? ` · est. return ${a.latest_estimated_return}` : ''}</p>
                        </div>
                        <ParticipationBadge tax={tax} value={a.participation} />
                      </div>
                    ))}
                    {availability.filter((a) => a.active_episodes > 0).length === 0 && (
                      <p className="text-sm text-muted-foreground">No athlete with an active episode.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              {me.can_view_reports && <ReportsPanel compact />}
              <p className="text-[10px] text-muted-foreground">{tax?.disclaimer}</p>
            </TabsContent>

            {/* INJURIES / ILLNESSES */}
            {isClinical && (
              <TabsContent value="injuries" className="mt-4">
                <EpisodeTable tax={tax} rows={injuries} kind="injury" onOpen={setDetailId} />
              </TabsContent>
            )}
            {isClinical && (
              <TabsContent value="illnesses" className="mt-4">
                <EpisodeTable tax={tax} rows={illnesses} kind="illness" onOpen={setDetailId} />
              </TabsContent>
            )}

            {/* FOLLOW-UP */}
            {isClinical && (
              <TabsContent value="followup" className="mt-4 space-y-4">
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Inbox className="w-4 h-4 text-amber-400" />Pending assessments ({pending.length})</CardTitle>
                    <p className="text-[11px] text-muted-foreground">Complaints from Pain Map, Daily Readiness (pain ≥ 5) and OSTRC. They become clinical records only after confirmation by the health team.</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
                    {pending.slice(0, 50).map((p) => (
                      <PendingRow key={`${p.source}-${p.source_id}`} p={p} getAuthHeaders={getAuthHeaders} onDone={refresh}
                        onRecord={(kind) => openNew(kind, {
                          athlete_id: p.athlete_id,
                          ...(kind === 'injury' ? { date_of_injury: p.date } : { date_of_onset: p.date }),
                          additional_notes: `From ${p.source}: ${p.body_region || p.problem_type || ''} ${p.pain_level != null ? `pain ${p.pain_level}/10` : ''} ${p.description || ''}`.trim(),
                          pending_source: { source: p.source, source_id: p.source_id },
                        })} />
                    ))}
                  </CardContent>
                </Card>
                <Card className="glass-light border-white/5">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Episodes under follow-up ({active.length}) and drafts ({drafts.length})</CardTitle></CardHeader>
                  <CardContent>
                    <EpisodeTable tax={tax} rows={[...drafts, ...active]} onOpen={setDetailId} mixed />
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {(isClinical || me.level === 'research') && (
              <TabsContent value="exposure" className="mt-4"><ExposurePanel /></TabsContent>
            )}
            {me.can_view_reports && (
              <TabsContent value="reports" className="mt-4"><ReportsPanel /></TabsContent>
            )}
          </Tabs>
        </main>

        {me.can_record && (
          <EpisodeForm open={formOpen} onOpenChange={setFormOpen} kind={formKind} episode={formEpisode} prefill={formPrefill}
            onSaved={(ep) => { refresh(); if (ep?.status !== 'draft') setDetailId(ep.id); }} />
        )}
        {isClinical && (
          <EpisodeDetail episodeId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} onEdit={openEdit} onChanged={refresh} />
        )}
      </div>
    </IirContext.Provider>
  );
}

function Stat({ label, value, tone }) {
  const cls = tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-foreground';
  return (
    <Card className="glass-light border-white/5">
      <CardContent className="p-4">
        <p className={`text-2xl font-heading font-bold ${cls}`}>{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function EpisodeTable({ tax, rows, kind, onOpen, mixed }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [team, setTeam] = useState('all');
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))];
  const filtered = rows.filter((r) =>
    (status === 'all' || r.status === status) &&
    (team === 'all' || r.team === team) &&
    (!q || `${r.athlete_name || ''} ${r.other_participant_name || ''} ${r.summary?.what || ''} ${r.summary?.where || ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="h-9 pl-8 w-56 bg-background/50 border-white/10" placeholder="Search athlete or diagnosis" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {(tax?.options.status || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        {teams.length > 1 && (
          <select className={selectCls} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} record(s)</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/5">
        <table className="w-full text-sm" data-testid={`iir-table-${kind || 'mixed'}`}>
          <thead className="bg-white/5 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2">Athlete</th>
              {mixed && <th className="text-left p-2">Type</th>}
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Diagnosis</th>
              <th className="text-left p-2">{kind === 'illness' ? 'System' : kind === 'injury' ? 'Region / side' : 'Region / system'}</th>
              <th className="text-left p-2">Class.</th>
              <th className="text-left p-2">Time loss</th>
              <th className="text-left p-2">Participation</th>
              <th className="text-left p-2">Status</th>
              <th className="p-2" title="Pending fields / warnings">!</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const qual = r.computed?.quality;
              const issues = (qual?.pending.length || 0) + (qual?.warnings.length || 0);
              return (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => onOpen(r.id)} data-testid={`iir-row-${r.id}`}>
                  <td className="p-2">{r.athlete_name || <span className="italic">{r.other_participant_name} (non-athlete)</span>}</td>
                  {mixed && <td className="p-2 text-xs">{r.kind === 'injury' ? 'Injury' : 'Illness'}</td>}
                  <td className="p-2 text-xs whitespace-nowrap">{fmtDate(r[eventDateKey(r.kind)])}</td>
                  <td className="p-2 text-xs max-w-[220px] truncate">{r.summary?.what}</td>
                  <td className="p-2 text-xs max-w-[180px] truncate">{r.summary?.where}</td>
                  <td className="p-2 text-xs">{optLabel(tax, r.kind === 'injury' ? 'inj_classification' : 'ill_classification', r.classification).replace(/ (INJ|ILL).*$/, '') || '—'}</td>
                  <td className="p-2"><TimeLossDays tl={r.computed?.effective_time_loss} compact /></td>
                  <td className="p-2"><ParticipationBadge tax={tax} value={r.participation} /></td>
                  <td className="p-2"><StatusBadge tax={tax} value={r.status} /></td>
                  <td className="p-2 text-center">{issues ? <span className="inline-flex items-center gap-0.5 text-amber-400 text-xs"><AlertTriangle className="w-3 h-3" />{issues}</span> : ''}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground text-sm">No records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">* provisional (open episode, counted up to today) · † start = date of injury/onset because the unavailability start was not recorded</p>
    </div>
  );
}

function PendingRow({ p, getAuthHeaders, onDone, onRecord }) {
  const [busy, setBusy] = useState(false);
  const dismiss = async () => {
    const reason = window.prompt('Assessed — reason for not creating a clinical record (optional):', 'Assessed — no clinical record needed');
    if (reason === null) return;
    setBusy(true);
    try {
      await axios.post(`${API}/iir/pending/dismiss`, { source: p.source, source_id: p.source_id, reason }, getAuthHeaders());
      onDone();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };
  const srcLabel = { readiness: 'Daily Readiness', pain_map: 'Pain Map', ostrc: 'OSTRC' }[p.source];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 px-3 py-2" data-testid="iir-pending-row">
      <Badge variant="outline" className="text-[10px]">{srcLabel}</Badge>
      <span className="text-sm">{p.athlete_name || 'Unknown athlete'}</span>
      <span className="text-xs text-muted-foreground">{fmtDate(p.date)} · {p.body_region || p.problem_type || ''}{p.laterality ? ` (${p.laterality})` : ''}{p.pain_level != null ? ` · pain ${p.pain_level}/10` : ''}{p.severity != null ? ` · severity ${p.severity}` : ''}</span>
      <div className="ml-auto flex gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onRecord('injury')}>Record injury</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onRecord('illness')}>Record illness</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismiss} disabled={busy}>Assessed</Button>
      </div>
    </div>
  );
}
