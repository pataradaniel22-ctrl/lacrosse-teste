import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Loader2, Pencil, Trash2, Paperclip, History, Plus, AlertTriangle, Link2, FileText } from 'lucide-react';
import {
  API, useIir, apiError, eventDateKey, optLabel, optLabels, fmtDate,
  ParticipationBadge, StatusBadge, TimeLossDays,
} from './iirCommon';
import { GroupedSelect } from './EpisodeForm';

const selectCls = 'w-full h-9 rounded-md bg-background/50 border border-white/10 px-3 text-sm';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-5 gap-2 py-1 text-xs border-b border-white/5">
      <span className="col-span-2 text-muted-foreground">{label}</span>
      <span className="col-span-3 break-words">{children || <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

export default function EpisodeDetail({ episodeId, open, onOpenChange, onEdit, onChanged }) {
  const { tax, getAuthHeaders } = useIir();
  const [ep, setEp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState(null);
  const [fu, setFu] = useState({ kind: 'reassessment', date: new Date().toISOString().slice(0, 10) });
  const [savingFu, setSavingFu] = useState(false);
  const [showFu, setShowFu] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/iir/episodes/${episodeId}`, getAuthHeaders());
      setEp(r.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not load the record'));
    } finally {
      setLoading(false);
    }
  }, [episodeId, getAuthHeaders]);

  useEffect(() => { if (open) { setAudit(null); setShowFu(false); load(); } }, [open, load]);

  const loadAudit = async () => {
    const r = await axios.get(`${API}/iir/episodes/${episodeId}/audit`, getAuthHeaders());
    setAudit(r.data);
  };

  const addFollowup = async () => {
    setSavingFu(true);
    try {
      await axios.post(`${API}/iir/episodes/${episodeId}/followups`, fu, getAuthHeaders());
      toast.success('Follow-up added');
      setFu({ kind: 'reassessment', date: new Date().toISOString().slice(0, 10) });
      setShowFu(false);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error('Could not add follow-up', { description: apiError(err) });
    } finally {
      setSavingFu(false);
    }
  };

  const remove = async () => {
    const reason = window.prompt('Reason for deleting this record (kept in the audit trail):');
    if (!reason) return;
    try {
      await axios.delete(`${API}/iir/episodes/${episodeId}?reason=${encodeURIComponent(reason)}`, getAuthHeaders());
      toast.success('Record deleted (kept in audit trail)');
      onOpenChange(false);
      onChanged?.();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await axios.post(`${API}/iir/episodes/${episodeId}/attachments`, fd, {
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Attachment added');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (a) => {
    try {
      const r = await axios.get(`${API}/iir/attachments/${a.id}`, { ...getAuthHeaders(), responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error(apiError(err, 'Could not open attachment'));
    }
  };

  const isInj = ep?.kind === 'injury';
  const c = ep?.computed;
  const q = c?.quality;
  const fuKinds = tax?.options.followup_kind || [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="iir-episode-detail">
        {loading || !ep ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
        ) : (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={isInj ? 'border-rose-500/40 text-rose-300' : 'border-violet-500/40 text-violet-300'}>{isInj ? 'Injury' : 'Illness'}</Badge>
                <StatusBadge tax={tax} value={ep.status} />
                <ParticipationBadge tax={tax} value={ep.participation} />
              </div>
              <SheetTitle className="text-lg">{ep.athlete_name || ep.other_participant_name || 'Participant'}</SheetTitle>
              <SheetDescription className="text-xs">
                {ep.summary?.what} · {ep.summary?.where} · {fmtDate(ep[eventDateKey(ep.kind)])}
              </SheetDescription>
              <p className="text-[10px] text-muted-foreground font-mono">ID {ep.id} · {ep.form_version} / {ep.dictionary_version}</p>
            </SheetHeader>

            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="outline" onClick={() => onEdit?.(ep)} data-testid="iir-edit-btn"><Pencil className="w-3 h-3 mr-1" />Edit</Button>
              {ep.status !== 'draft' && <Button size="sm" onClick={() => setShowFu((s) => !s)} data-testid="iir-add-followup-btn"><Plus className="w-3 h-3 mr-1" />Add follow-up</Button>}
              <Button size="sm" variant="ghost" className="ml-auto text-red-400" onClick={remove}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
            </div>

            {q && (q.pending.length > 0 || q.warnings.length > 0) && (
              <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1" data-testid="iir-quality">
                {q.pending.length > 0 && <p className="text-amber-200"><b>Pending:</b> {q.pending.join(', ')}</p>}
                {q.warnings.map((w, i) => <p key={i} className="text-amber-200 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</p>)}
              </div>
            )}

            {/* Time loss */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-lg border border-white/10 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Effective time loss ({tax?.time_loss_convention})</p>
                <p className="text-lg"><TimeLossDays tl={c?.effective_time_loss} /></p>
                <p className="text-[10px] text-muted-foreground">Unavailability start → full return</p>
              </div>
              <div className="rounded-lg border border-white/10 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Time-Loss (days) — workbook</p>
                <p className="text-lg font-mono">{c?.compat_time_loss_days?.value ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground">Actual RTP Date − Date of {isInj ? 'Injury' : 'Onset'}</p>
              </div>
            </div>

            {/* Follow-up form */}
            {showFu && (
              <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3" data-testid="iir-followup-form">
                <p className="text-sm font-medium">New follow-up (same episode — does not create a new {isInj ? 'injury' : 'illness'})</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Type</p>
                    <select className={selectCls} value={fu.kind} onChange={(e) => setFu({ ...fu, kind: e.target.value })}>
                      {fuKinds.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Date</p>
                    <Input type="date" className="h-9" value={fu.date} onChange={(e) => setFu({ ...fu, date: e.target.value })} />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Participation</p>
                    <GroupedSelect options={tax.options.participation} value={fu.participation || ''} onChange={(x) => setFu({ ...fu, participation: x || undefined })} placeholder="No change" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Revised estimated return</p>
                    <Input type="date" className="h-9" value={fu.estimated_rtp_date || ''} onChange={(e) => setFu({ ...fu, estimated_rtp_date: e.target.value || undefined })} />
                  </div>
                  {(fu.kind === 'full_return' || fu.kind === 'partial_return') && (
                    <label className="col-span-2 flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={!!fu.set_actual_rtp} onChange={(e) => setFu({ ...fu, set_actual_rtp: e.target.checked })} disabled={fu.kind !== 'full_return'} />
                      Also set the workbook "Actual RTP Date" to this full-return date
                    </label>
                  )}
                </div>
                <Textarea placeholder="Symptoms and evolution" className="text-sm" value={fu.symptoms || ''} onChange={(e) => setFu({ ...fu, symptoms: e.target.value })} />
                <Textarea placeholder="Diagnostic update (keeps previous diagnosis in history)" className="text-sm" value={fu.diagnosis || ''} onChange={(e) => setFu({ ...fu, diagnosis: e.target.value })} />
                <Textarea placeholder="Management / treatment" className="text-sm" value={fu.treatment || ''} onChange={(e) => setFu({ ...fu, treatment: e.target.value })} />
                <Textarea placeholder="Exams and referrals" className="text-sm" value={fu.exams_referrals || ''} onChange={(e) => setFu({ ...fu, exams_referrals: e.target.value })} />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowFu(false)}>Cancel</Button>
                  <Button size="sm" onClick={addFollowup} disabled={savingFu} data-testid="iir-save-followup">{savingFu ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save follow-up'}</Button>
                </div>
              </div>
            )}

            {/* Timeline */}
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mt-6 mb-2">Timeline</h4>
            <ol className="relative border-l border-white/10 ml-2 space-y-3" data-testid="iir-timeline">
              <li className="ml-4">
                <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-rose-500/80" />
                <p className="text-xs"><b>{fmtDate(ep[eventDateKey(ep.kind)])}</b> · {isInj ? 'Injury' : 'Onset'} · recorded by {ep.report_by?.name || ep.created_by?.name}</p>
                <p className="text-[11px] text-muted-foreground">{ep.initial_diagnosis || 'Initial diagnosis not recorded'}</p>
              </li>
              {(ep.followups || []).map((f) => (
                <li key={f.id} className="ml-4">
                  <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-sky-500/80" />
                  <p className="text-xs"><b>{fmtDate(f.date)}</b> · {optLabel(tax, 'followup_kind', f.kind)} · {f.by?.name}</p>
                  {f.symptoms && <p className="text-[11px]">Symptoms: {f.symptoms}</p>}
                  {f.diagnosis && <p className="text-[11px]">Diagnosis: {f.diagnosis}{f.previous?.final_diagnosis ? <span className="text-muted-foreground"> (was: {f.previous.final_diagnosis})</span> : null}</p>}
                  {f.treatment && <p className="text-[11px]">Management: {f.treatment}</p>}
                  {f.exams_referrals && <p className="text-[11px]">Exams/referrals: {f.exams_referrals}</p>}
                  {f.applied && Object.keys(f.applied).length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {Object.entries(f.applied).map(([k2, v2]) => `${k2}: ${f.previous?.[k2] ?? '—'} → ${v2}`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>

            {/* Linked episode */}
            {ep.linked_episode && (
              <div className="mt-4 text-xs rounded-md border border-white/10 p-2 flex items-center gap-2">
                <Link2 className="w-3 h-3" /> Linked to previous {ep.linked_episode.kind}: {ep.linked_episode.summary?.what} ({fmtDate(ep.linked_episode.date)})
                · prior full recovery: {optLabel(tax, 'prior_recovery', ep.prior_full_recovery) || '—'}
              </div>
            )}

            {/* Record */}
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mt-6 mb-2">Record</h4>
            <div>
              <Row label="Report by">{ep.report_by?.name}</Row>
              <Row label="Created / last change">{fmtDate(ep.created_at)} {ep.created_by?.name} · {fmtDate(ep.updated_at)} {ep.updated_by?.name}</Row>
              <Row label="Team / category">{ep.team} {ep.category ? `· ${optLabel(tax, 'category', ep.category)}` : ''}</Row>
              <Row label="Position">{optLabel(tax, isInj ? 'inj_position' : 'ill_position', ep.position)}</Row>
              <Row label="Game day">{optLabel(tax, isInj ? 'inj_game_day' : 'ill_game_day', ep.game_day)}{ep.game_day_offset != null ? ` (${ep.game_day_offset > 0 ? '+' : ''}${ep.game_day_offset} d)` : ''}</Row>
              {isInj && <Row label="Activity / segment">{optLabel(tax, 'activity', ep.activity)} {ep.activity_segment ? `· ${optLabel(tax, 'activity_segment', ep.activity_segment)}` : ''}</Row>}
              {isInj && <Row label="Field / surface">{optLabel(tax, 'surface', ep.surface)} {ep.surface_type ? `· ${optLabel(tax, 'surface_type', ep.surface_type)}` : ''}</Row>}
              <Row label="Classification">{optLabel(tax, isInj ? 'inj_classification' : 'ill_classification', ep.classification)}</Row>
              <Row label="Time-Loss">{optLabel(tax, 'time_loss', ep.time_loss)}</Row>
              <Row label="Mode of onset">{optLabel(tax, 'mode_of_onset', ep.mode_of_onset)}</Row>
              {isInj ? (
                <>
                  <Row label="Mechanism / source">{optLabel(tax, 'mechanism', ep.mechanism)} {ep.source ? `· ${optLabel(tax, 'source', ep.source)}` : ''}</Row>
                  <Row label="Occurrence">{optLabel(tax, 'occurrence', ep.occurrence)}</Row>
                  <Row label="Phase / numbers / penalty">{[optLabel(tax, 'phase_of_play', ep.phase_of_play), optLabel(tax, 'phase_numbers', ep.phase_numbers), optLabel(tax, 'penalty', ep.penalty)].filter(Boolean).join(' · ')}</Row>
                  <Row label="Body location">{optLabels(tax, 'body_location', ep.body_location)} {ep.laterality ? `· ${optLabel(tax, 'laterality', ep.laterality)}` : ''}</Row>
                  <Row label="Injury type">{optLabels(tax, 'injury_type', ep.injury_type)}</Row>
                </>
              ) : (
                <>
                  <Row label="Communicable">{optLabel(tax, 'communicable', ep.communicable)}</Row>
                  <Row label="Organ system">{optLabel(tax, 'organ_system', ep.organ_system)}</Row>
                  <Row label="Aetiology">{optLabel(tax, 'aetiology', ep.aetiology)}</Row>
                </>
              )}
              <Row label="Managed by">{optLabel(tax, 'managed_by', ep.managed_by)}</Row>
              <Row label="Initial diagnosis">{ep.initial_diagnosis}</Row>
              <Row label="Final diagnosis">{ep.final_diagnosis} {ep.diagnosis_status ? `(${optLabel(tax, 'diagnosis_status', ep.diagnosis_status)})` : ''}</Row>
              <Row label="Treatment / resolution">{ep.treatment_notes}</Row>
              <Row label="Imaging">{(ep.imaging || []).map((i) => `${optLabel(tax, 'imaging', i.modality)}${i.date ? ` ${i.date}` : ''}${i.result ? `: ${i.result}` : ''}`).join(' · ')}</Row>
              <Row label="Unavailability start">{fmtDate(ep.unavailability_start)}</Row>
              <Row label="Estimated RTP">{fmtDate(ep.estimated_rtp_date)}</Row>
              <Row label="Partial / full return">{fmtDate(ep.partial_return_date)} · {fmtDate(ep.full_return_date)}</Row>
              <Row label="Actual RTP (workbook)">{fmtDate(ep.actual_rtp_date)}</Row>
              <Row label="Seriousness">{optLabel(tax, 'seriousness', ep.seriousness)}</Row>
              <Row label="Additional notes">{ep.additional_notes}</Row>
            </div>

            {/* Attachments */}
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mt-6 mb-2 flex items-center gap-2"><Paperclip className="w-3 h-3" />Clinical attachments (restricted)</h4>
            <div className="space-y-1">
              {(ep.attachments || []).map((a) => (
                <button key={a.id} type="button" onClick={() => openAttachment(a)} className="flex items-center gap-2 text-xs text-sky-300 hover:underline">
                  <FileText className="w-3 h-3" />{a.filename} <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB · {fmtDate(a.uploaded_at)})</span>
                </button>
              ))}
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground mt-1">
                <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add attachment (JPG, PNG, PDF · max 10 MB)
              </label>
            </div>

            {/* Audit */}
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mt-6 mb-2 flex items-center gap-2"><History className="w-3 h-3" />Change history</h4>
            {audit === null ? (
              <Button size="sm" variant="outline" onClick={loadAudit} data-testid="iir-load-audit">Show change history</Button>
            ) : (
              <div className="space-y-2 pb-10">
                {audit.map((a) => (
                  <div key={a.id} className="text-[11px] border-b border-white/5 pb-1">
                    <p><b>{a.action}</b> · {a.by?.name} ({a.by?.role}) · {a.at?.slice(0, 16).replace('T', ' ')}</p>
                    {(a.changes || []).slice(0, 12).map((ch, i) => (
                      <p key={i} className="text-muted-foreground">{ch.field}: {JSON.stringify(ch.old)} → {JSON.stringify(ch.new)}</p>
                    ))}
                    {a.extra?.reason && <p className="text-muted-foreground">Reason: {a.extra.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
