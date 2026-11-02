import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ClipboardPlus, Bandage, Thermometer, ChevronRight } from 'lucide-react';
import {
  API, IirContext, eventDateKey, optLabel, fmtDate, ParticipationBadge, StatusBadge, TimeLossDays,
} from './iirCommon';
import EpisodeForm from './EpisodeForm';
import EpisodeDetail from './EpisodeDetail';

/**
 * "Injury & Illness History" section of the athlete profile. Reads and writes the
 * same records as the central Injury & Illness tab (no duplication).
 */
export default function AthleteIirHistory({ athleteId, getAuthHeaders }) {
  const [me, setMe] = useState(null);
  const [tax, setTax] = useState(null);
  const [hist, setHist] = useState(null);
  const [staff, setStaff] = useState([]);
  const [events, setEvents] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [form, setForm] = useState({ open: false, kind: 'injury', episode: null });
  const [detailId, setDetailId] = useState(null);

  const loadHist = useCallback(async () => {
    try {
      const h = await axios.get(`${API}/iir/athletes/${athleteId}/history`, getAuthHeaders());
      setHist(h.data);
    } catch { setHist(null); }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => {
    (async () => {
      try {
        const m = await axios.get(`${API}/iir/me`, getAuthHeaders());
        setMe(m.data);
        if (!m.data.can_view_availability) return;
        const t = await axios.get(`${API}/iir/taxonomy`, getAuthHeaders());
        setTax(t.data);
        if (m.data.can_record) {
          const [s, e, a] = await Promise.all([
            axios.get(`${API}/iir/staff`, getAuthHeaders()),
            axios.get(`${API}/iir/events`, getAuthHeaders()),
            axios.get(`${API}/iir/athletes`, getAuthHeaders()),
          ]);
          setStaff(s.data); setEvents(e.data); setAthletes(a.data);
        }
        await loadHist();
      } catch { /* section hidden on error */ }
    })();
  }, [getAuthHeaders, loadHist]);

  const ctx = useMemo(() => ({ tax, athletes, staff, events, getAuthHeaders, me, reloadEvents: async () => {} }),
    [tax, athletes, staff, events, getAuthHeaders, me]);

  if (!me?.can_view_availability || !tax || !hist) return null;
  const clinical = me.can_view_clinical;
  const all = clinical ? [...hist.active, ...hist.previous] : hist.episodes;

  return (
    <IirContext.Provider value={ctx}>
      <Card className="glass-light border-white/5 my-4" data-testid="athlete-iir-history">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm flex items-center gap-2"><ClipboardPlus className="w-4 h-4 text-rose-400" />Injury &amp; Illness History</CardTitle>
            <ParticipationBadge tax={tax} value={hist.participation.participation} />
            <span className="text-[11px] text-muted-foreground">{hist.participation.active_episodes} active episode(s){clinical && hist.unique_unavailable_days?.days ? ` · ${hist.unique_unavailable_days.days} unique day(s) unavailable${hist.unique_unavailable_days.provisional ? ' (provisional)' : ''}` : ''}</span>
            {me.can_record && (
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm({ open: true, kind: 'injury', episode: null })}><Bandage className="w-3 h-3 mr-1" />Record Injury</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setForm({ open: true, kind: 'illness', episode: null })}><Thermometer className="w-3 h-3 mr-1" />Record Illness</Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {all.length === 0 && <p className="text-sm text-muted-foreground">No injury or illness recorded.</p>}
          {!clinical && all.length > 0 && <p className="text-[11px] text-muted-foreground mb-2">Participation and availability only (clinical details restricted to the health team).</p>}
          <div className="space-y-2">
            {all.map((e) => (
              <button key={e.id} type="button" disabled={!clinical} onClick={() => clinical && setDetailId(e.id)}
                className="w-full text-left rounded-md border border-white/10 hover:bg-white/5 px-3 py-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={e.kind === 'injury' ? 'border-rose-500/40 text-rose-300 text-[10px]' : 'border-violet-500/40 text-violet-300 text-[10px]'}>{e.kind === 'injury' ? 'Injury' : 'Illness'}</Badge>
                {clinical ? (
                  <>
                    <span className="text-sm">{e.summary?.what}</span>
                    <span className="text-xs text-muted-foreground">{e.summary?.where}</span>
                    <span className="text-xs text-muted-foreground">· {fmtDate(e[eventDateKey(e.kind)])}</span>
                    <span className="text-xs">· {optLabel(tax, e.kind === 'injury' ? 'inj_classification' : 'ill_classification', e.classification) || 'classification not filled'}</span>
                    <span className="text-xs">· <TimeLossDays tl={e.computed?.effective_time_loss} /></span>
                    <span className="text-[11px] text-muted-foreground">· est. {fmtDate(e.estimated_rtp_date)} / actual {fmtDate(e.full_return_date)} · {e.report_by?.name}{e.followups?.length ? ` · ${e.followups.length} follow-up(s)` : ''}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Estimated return {fmtDate(e.estimated_rtp_date)}</span>
                )}
                <span className="ml-auto flex items-center gap-1"><StatusBadge tax={tax} value={e.status} /><ParticipationBadge tax={tax} value={e.participation} />{clinical && <ChevronRight className="w-4 h-4 text-muted-foreground" />}</span>
              </button>
            ))}
          </div>
          <Link to="/staff/injury-illness" className="text-[11px] text-primary underline mt-2 inline-block">Open Injury &amp; Illness Recording</Link>
        </CardContent>
      </Card>
      {me.can_record && (
        <EpisodeForm open={form.open} onOpenChange={(o) => setForm((s) => ({ ...s, open: o }))} kind={form.kind} episode={form.episode}
          prefill={{ athlete_id: athleteId }} onSaved={loadHist} />
      )}
      {clinical && (
        <EpisodeDetail episodeId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}
          onEdit={(ep) => { setDetailId(null); setForm({ open: true, kind: ep.kind, episode: ep }); }} onChanged={loadHist} />
      )}
    </IirContext.Provider>
  );
}
