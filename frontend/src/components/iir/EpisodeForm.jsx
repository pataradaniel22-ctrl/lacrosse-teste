import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Loader2, Plus, Trash2, AlertTriangle, Info } from 'lucide-react';
import { API, useIir, apiError, eventDateKey, optLabel, TimeLossDays } from './iirCommon';

/**
 * Layout of the form. Keys refer to fields of the versioned taxonomy
 * (reference fields keep the workbook numbering; app fields are tagged "App").
 */
const LAYOUT = {
  injury: [
    { title: 'Athlete & context', keys: ['participant_type', 'athlete', 'other_participant_name', 'report_by', 'event_id', 'season', 'team', 'category'] },
    { title: 'When & where', keys: ['date_of_injury', 'time_of_injury', 'exact_time', 'position', 'surface', 'surface_type', 'activity', 'activity_segment', 'game_day', 'game_day_offset', 'match_number'] },
    { title: 'Classification', keys: ['classification', 'linked_episode_id', 'prior_full_recovery', 'time_loss', 'mode_of_onset', 'mechanism', 'source', 'occurrence', 'phase_of_play', 'phase_numbers', 'penalty'] },
    { title: 'Injury', keys: ['body_location', 'laterality', 'injury_type'] },
    { title: 'Clinical assessment', keys: ['managed_by', 'assessment_date', 'symptom_onset_date', 'initial_diagnosis', 'diagnosis_status', 'treatment_notes', 'imaging', 'final_diagnosis'] },
    { title: 'Participation, return & outcome', keys: ['status', 'participation', 'unavailability_start', 'estimated_rtp_date', 'partial_return_date', 'full_return_date', 'actual_rtp_date', 'seriousness', 'compat_time_loss_days'] },
    { title: 'Notes', keys: ['additional_notes'] },
  ],
  illness: [
    { title: 'Athlete & context', keys: ['participant_type', 'athlete', 'other_participant_name', 'report_by', 'event_id', 'season', 'team', 'category'] },
    { title: 'When', keys: ['date_of_onset', 'time_of_onset', 'exact_time', 'position', 'game_day', 'game_day_offset'] },
    { title: 'Classification', keys: ['classification', 'linked_episode_id', 'prior_full_recovery', 'time_loss', 'mode_of_onset', 'communicable', 'organ_system', 'aetiology'] },
    { title: 'Clinical assessment', keys: ['managed_by', 'assessment_date', 'symptom_onset_date', 'initial_diagnosis', 'diagnosis_status', 'treatment_notes', 'imaging', 'final_diagnosis'] },
    { title: 'Participation, return & outcome', keys: ['status', 'participation', 'unavailability_start', 'estimated_rtp_date', 'partial_return_date', 'full_return_date', 'actual_rtp_date', 'seriousness', 'compat_time_loss_days'] },
    { title: 'Notes', keys: ['additional_notes'] },
  ],
};

const LONG_TEXT = new Set(['initial_diagnosis', 'treatment_notes', 'final_diagnosis', 'additional_notes']);

const inputCls = 'h-10 bg-background/50 border-white/10 text-sm';
const selectCls = 'w-full h-10 rounded-md bg-background/50 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

function emptyFor(kind) {
  return { kind, participant_type: 'athlete', status: 'draft', body_location: [], injury_type: [], imaging: [] };
}

export default function EpisodeForm({ open, onOpenChange, kind, episode, prefill, onSaved }) {
  const { tax, athletes, staff, events, getAuthHeaders } = useIir();
  const editing = !!episode;
  const [v, setV] = useState(emptyFor(kind));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [prevEpisodes, setPrevEpisodes] = useState([]);

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    if (episode) {
      setV({ ...emptyFor(episode.kind), ...episode, report_by_id: episode.report_by?.id });
    } else {
      setV({ ...emptyFor(kind), ...(prefill || {}) });
    }
  }, [open, episode, kind, prefill]);

  const k = v.kind || kind;
  const fields = useMemo(() => {
    if (!tax) return {};
    const out = {};
    tax.fields[k].forEach((f, i) => { out[f.key] = { ...f, number: i + 1 }; });
    tax.fields.app.forEach((f) => { out[f.key] = { ...f }; });
    return out;
  }, [tax, k]);

  // Previous episodes of the same athlete, for recurrence / exacerbation links
  useEffect(() => {
    if (!open || !v.athlete_id) { setPrevEpisodes([]); return; }
    axios.get(`${API}/iir/episodes?athlete_id=${v.athlete_id}`, getAuthHeaders())
      .then((r) => setPrevEpisodes(r.data.filter((e) => e.id !== episode?.id && e.status !== 'draft')))
      .catch(() => setPrevEpisodes([]));
  }, [open, v.athlete_id, episode, getAuthHeaders]);

  const set = (key, value) => setV((s) => ({ ...s, [key]: value }));

  const visible = (key) => {
    if (key === 'athlete') return v.participant_type !== 'other';
    if (key === 'other_participant_name') return v.participant_type === 'other';
    if (key === 'linked_episode_id' || key === 'prior_full_recovery') return ['recurrent', 'exacerbation'].includes(v.classification);
    return true;
  };

  const save = async (status) => {
    setSaving(true);
    setErrors([]);
    const body = { ...v, kind: k };
    if (status) body.status = status;
    delete body.computed; delete body.summary; delete body.followups; delete body.attachments;
    delete body.athlete_name; delete body.linked_episode;
    body.imaging = (v.imaging || []).filter((i) => i.modality);
    try {
      const r = editing
        ? await axios.patch(`${API}/iir/episodes/${episode.id}`, body, getAuthHeaders())
        : await axios.post(`${API}/iir/episodes`, body, getAuthHeaders());
      const q = r.data.computed?.quality;
      toast.success(body.status === 'draft' ? 'Draft saved' : 'Record saved', {
        description: q && (q.pending.length || q.warnings.length)
          ? `${q.pending.length} pending field(s) · ${q.warnings.length} warning(s)` : undefined,
      });
      onSaved?.(r.data);
      onOpenChange(false);
    } catch (err) {
      const d = err?.response?.data?.detail;
      setErrors(Array.isArray(d) ? d : [{ message: apiError(err) }]);
      toast.error('Could not save', { description: apiError(err) });
    } finally {
      setSaving(false);
    }
  };

  if (!tax) return null;
  const title = editing ? `Edit ${k === 'injury' ? 'injury' : 'illness'}` : (k === 'injury' ? 'Record Injury' : 'Record Illness');
  const errFor = (key) => errors.filter((e) => e.field === key || (key === 'athlete' && e.field === 'athlete_id'));

  const renderField = (key) => {
    const f = fields[key];
    if (!f || !visible(key)) return null;
    const isRef = f.source === 'reference';
    const label = (
      <div className="flex items-center gap-1.5 mb-1">
        {isRef ? (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/40 text-primary" title={`Workbook column ${f.column}: ${(f.original_header || '').replace(/\n/g, ' ')}`}>#{f.number}</Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-white/20 text-muted-foreground" title="Additional field of this app (not in the reference workbook)">App</Badge>
        )}
        <span className="text-xs font-medium">{f.label}</span>
        {f.multiple && <span className="text-[10px] text-muted-foreground">(multiple)</span>}
        {f.notes && <Info className="w-3 h-3 text-muted-foreground" title={f.notes} />}
      </div>
    );
    let control = null;
    const val = v[key];
    switch (f.type) {
      case 'athlete':
        control = (
          <select className={selectCls} value={v.athlete_id || ''} disabled={editing && episode?.status !== 'draft'}
            onChange={(e) => { const a = athletes.find((x) => x.id === e.target.value); setV((s) => ({ ...s, athlete_id: e.target.value, team: s.team || a?.team })); }}
            data-testid="iir-athlete-select">
            <option value="">Select athlete…</option>
            {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` — ${a.team}` : ''}</option>)}
          </select>
        );
        break;
      case 'user':
        control = (
          <select className={selectCls} value={v.report_by_id || ''} onChange={(e) => set('report_by_id', e.target.value)} data-testid="iir-report-by">
            <option value="">(me)</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
          </select>
        );
        break;
      case 'event':
        control = (
          <select className={selectCls} value={val || ''} onChange={(e) => { const ev = events.find((x) => x.id === e.target.value); setV((s) => ({ ...s, event_id: e.target.value || null, season: s.season || ev?.season })); }}>
            <option value="">No event</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.season ? ` (${ev.season})` : ''}</option>)}
          </select>
        );
        break;
      case 'episode':
        control = (
          <>
            <select className={selectCls} value={val || ''} onChange={(e) => set(key, e.target.value || null)} data-testid="iir-linked-episode">
              <option value="">{v.athlete_id ? 'Select previous episode…' : 'Select the athlete first'}</option>
              {prevEpisodes.map((p) => (
                <option key={p.id} value={p.id}>{(p[eventDateKey(p.kind)] || '').slice(0, 10)} · {p.kind} · {p.summary?.what} ({p.summary?.where})</option>
              ))}
            </select>
            {v.athlete_id && prevEpisodes.length === 0 && (
              <p className="text-[11px] text-amber-300 mt-1">No previous episode recorded for this athlete. If the history is not available, record it in the next field.</p>
            )}
          </>
        );
        break;
      case 'date':
        control = <Input type="date" className={inputCls} value={val || ''} onChange={(e) => set(key, e.target.value || null)} data-testid={`iir-${key}`} />;
        break;
      case 'time':
        control = <Input type="time" className={inputCls} value={val || ''} onChange={(e) => set(key, e.target.value || null)} />;
        break;
      case 'number':
        control = <Input type="number" step="1" className={inputCls} value={val ?? ''} onChange={(e) => set(key, e.target.value === '' ? null : e.target.value)} placeholder="e.g. -1, 0, +2" />;
        break;
      case 'calculated': {
        const c = v.computed?.compat_time_loss_days;
        control = (
          <div className="h-10 flex items-center px-3 rounded-md border border-white/5 bg-background/30 text-sm text-muted-foreground">
            {c?.value != null ? `${c.value} day(s)` : (c?.reason === 'end_before_start' ? 'Invalid dates' : 'Calculated after saving, when Actual RTP Date is filled')}
          </div>
        );
        break;
      }
      case 'imaging':
        control = <ImagingEditor tax={tax} value={val || []} onChange={(x) => set(key, x)} />;
        break;
      case 'select':
        if (f.multiple) {
          control = <ChipMulti options={tax.options[f.options]} value={val || []} onChange={(x) => set(key, x)} testid={`iir-${key}`} />;
        } else {
          control = <GroupedSelect options={tax.options[f.options]} value={val || ''} onChange={(x) => set(key, x || null)} testid={`iir-${key}`} />;
        }
        break;
      default:
        control = LONG_TEXT.has(key)
          ? <Textarea className="bg-background/50 border-white/10 text-sm min-h-[70px]" value={val || ''} onChange={(e) => set(key, e.target.value)} data-testid={`iir-${key}`} />
          : <Input className={inputCls} value={val || ''} onChange={(e) => set(key, e.target.value)} data-testid={`iir-${key}`} />;
    }
    const errs = errFor(key);
    const wide = LONG_TEXT.has(key) || f.multiple || f.type === 'imaging' || key === 'linked_episode_id';
    return (
      <div key={key} className={wide ? 'sm:col-span-2' : ''}>
        {label}
        {control}
        {errs.map((e, i) => <p key={i} className="text-[11px] text-red-400 mt-1">{e.message}</p>)}
      </div>
    );
  };

  const generalErrors = errors.filter((e) => !e.field || !fields[e.field === 'athlete_id' ? 'athlete' : e.field]);
  const q = v.computed?.quality;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="iir-episode-form">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">
            Fields marked <span className="text-primary">#n</span> follow the reference workbook ({k === 'injury' ? '30' : '21'} columns);
            fields marked <span className="text-foreground">App</span> are additional. A draft can be saved incomplete — nothing has to be invented.
          </DialogDescription>
        </DialogHeader>

        {q && (q.pending.length > 0 || q.warnings.length > 0) && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1">
            {q.pending.length > 0 && <p className="text-amber-200"><b>Pending:</b> {q.pending.map((p) => fields[p]?.label || p).join(', ')}</p>}
            {q.warnings.map((w, i) => <p key={i} className="text-amber-200 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</p>)}
          </div>
        )}

        <div className="space-y-6">
          {LAYOUT[k].map((sec) => (
            <section key={sec.title}>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 border-b border-white/5 pb-1">{sec.title}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sec.keys.map(renderField)}
              </div>
            </section>
          ))}
        </div>

        {generalErrors.length > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
            {generalErrors.map((e, i) => <p key={i}>{e.message}</p>)}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2 sticky bottom-0 bg-background/95 py-3 border-t border-white/5">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          {(!editing || episode?.status === 'draft') && (
            <Button variant="outline" onClick={() => save('draft')} disabled={saving} data-testid="iir-save-draft">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save draft'}
            </Button>
          )}
          <Button onClick={() => save(v.status && v.status !== 'draft' ? v.status : 'open')} disabled={saving} data-testid="iir-save-record">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editing && episode?.status !== 'draft' ? 'Save changes' : 'Save record')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Native select with option groups (group titles are never selectable). */
export function GroupedSelect({ options, value, onChange, testid, placeholder = 'Select…' }) {
  const groups = [];
  const seen = {};
  (options || []).forEach((o) => {
    const g = o.group || '';
    if (!(g in seen)) { seen[g] = groups.length; groups.push({ g, items: [] }); }
    groups[seen[g]].items.push(o);
  });
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      <option value="">{placeholder}</option>
      {groups.map(({ g, items }) => (g ? (
        <optgroup key={g} label={g}>
          {items.map((o) => <option key={o.code} value={o.code}>{o.label}{o.extension ? ' *' : ''}</option>)}
        </optgroup>
      ) : items.map((o) => <option key={o.code} value={o.code}>{o.label}{o.extension ? ' *' : ''}</option>)))}
    </select>
  );
}

function ChipMulti({ options, value, onChange, testid }) {
  const toggle = (code) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {(options || []).map((o) => {
        const on = value.includes(o.code);
        return (
          <button key={o.code} type="button" onClick={() => toggle(o.code)}
            className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${on ? 'bg-primary/20 border-primary/60 text-primary' : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/30'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ImagingEditor({ tax, value, onChange }) {
  const opts = tax.options.imaging;
  const update = (i, patch) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-[11px] text-muted-foreground">Not filled. Add "None" if no imaging was done.</p>}
      {value.map((im, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <select className={`${selectCls} col-span-4`} value={im.modality || ''} onChange={(e) => update(i, { modality: e.target.value })}>
            <option value="">Modality…</option>
            {opts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
          <Input type="date" className={`${inputCls} col-span-3`} value={im.date || ''} disabled={im.modality === 'none'} onChange={(e) => update(i, { date: e.target.value || null })} />
          <Input className={`${inputCls} col-span-4`} placeholder="Result (optional)" value={im.result || ''} disabled={im.modality === 'none'} onChange={(e) => update(i, { result: e.target.value })} />
          <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { modality: '' }])}><Plus className="w-3 h-3 mr-1" />Add exam</Button>
    </div>
  );
}

export { optLabel, TimeLossDays };
