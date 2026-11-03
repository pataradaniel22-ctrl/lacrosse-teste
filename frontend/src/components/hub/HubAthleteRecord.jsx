import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Pencil, Save, X, Loader2, Send, AlertTriangle, History, Clock, CheckCircle2, User, Phone, IdCard, Wallet, Award, StickyNote, Lock, Paperclip, PenLine, FolderOpen } from 'lucide-react';
import { Button } from '../ui/button';
import FieldInput, { ValuePill } from './FieldInput';
import DocumentsPanel from './DocumentsPanel';
import PassportSuggestion from './PassportSuggestion';
import RequestDialog from './RequestDialog';
import GroupBadges from '../groups/GroupBadges';
import { API, groupBySection, toneOf, optionOf, formatValue } from '../../lib/hub';

const SECTION_ICONS = { Personal: User, Contact: Phone, Documents: IdCard, 'Admin & Dues': Wallet, Certifications: Award, Other: StickyNote };

const ACTIONS = {
  values_changed: 'changed', document_uploaded: 'uploaded a document', document_viewed: 'viewed a document',
  document_deleted: 'removed a document', import: 'imported data',
};

/** Full Athlete Hub record for staff (used in the hub drawer and on the athlete page). */
export default function HubAthleteRecord({ athleteId, getAuthHeaders: gah, onChanged, showHeader = true }) {
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const [rec, setRec] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [passport, setPassport] = useState(null);
  const [reqOpen, setReqOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/staff/hub/athlete/${athleteId}`, { ...getAuthHeaders(), skipGroupFilter: true });
      setRec(r.data); setError('');
    } catch (e) { setError(e?.response?.data?.detail || 'Could not load'); }
  }, [athleteId, getAuthHeaders]);
  useEffect(() => { setRec(null); load(); }, [load]);

  const save = async (values) => {
    setSaving(true);
    try {
      const r = await axios.put(`${API}/staff/hub/athlete/${athleteId}`, { values }, getAuthHeaders());
      toast.success(r.data.changed.length ? `Saved (${r.data.changed.length} change${r.data.changed.length > 1 ? 's' : ''})` : 'No changes');
      setEdit(false);
      await load(); onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };

  if (error) return <p className="text-sm text-red-400 p-4">{error}</p>;
  if (!rec) return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const fields = rec.fields.filter((f) => !f.hidden);
  const vals = edit ? draft : rec.values;
  const startEdit = () => { setDraft({ ...rec.values }); setEdit(true); };
  const isFilled = (k) => rec.values[k] !== undefined && rec.values[k] !== null && rec.values[k] !== '';
  const pct = fields.length ? Math.round((fields.filter((f) => isFilled(f.key)).length / fields.length) * 100) : 0;
  const fby = Object.fromEntries(fields.map((f) => [f.key, f]));
  const tileFor = (f) => {
    const v = rec.values[f.key];
    const o = optionOf(f, v);
    const tile = { key: f.key, label: f.label, value: v ? (o?.label || v) : '', tone: o?.tone, Icon: SECTION_ICONS[f.section] || StickyNote };
    if (f.key === 'passport_status' && fby.passport_expiry) {
      const exp = rec.values.passport_expiry; const al = rec.alerts?.passport_expiry;
      if (exp) { tile.sub = `Expires ${formatValue(fby.passport_expiry, exp)}`; if (al) tile.subTone = al === 'expired' ? 'text-red-300 font-semibold' : 'text-amber-200 font-semibold'; } else tile.sub = 'Expiry date not filled';
    }
    if (f.key === 'dues_2026' && fby.dues_plan && rec.values.dues_plan) tile.sub = `Plan: ${rec.values.dues_plan}`;
    const linkedDoc = rec.doc_types.find((d) => d.field === f.key);
    if (linkedDoc && !tile.sub) tile.sub = rec.documents.some((d) => d.doc_type === linkedDoc.key) ? '📎 File attached' : 'No file attached';
    return tile;
  };
  const palsc = fields.filter((f) => f.key.startsWith('palsc_'));
  const tiles = fields.filter((f) => f.type === 'select' && (f.required || ['cpf_status'].includes(f.key))).map(tileFor);
  if (palsc.length) {
    const done = palsc.filter((f) => rec.values[f.key] === 'Done').length;
    const na = palsc.filter((f) => rec.values[f.key] === 'N/A').length;
    const filledP = palsc.filter((f) => isFilled(f.key)).length;
    tiles.push({ key: 'palsc', label: 'PALSC evals', Icon: Award,
      value: filledP ? (na === palsc.length ? 'N/A' : `${done}/${palsc.length - na} done`) : '',
      tone: !filledP ? undefined : na === palsc.length ? 'gray' : done === palsc.length - na ? 'green' : 'red' });
  }

  return (
    <div className="space-y-4" data-testid="hub-athlete-record">
      {showHeader && (
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-lg font-semibold leading-tight">{rec.athlete.name}</p>
            <p className="text-xs text-muted-foreground">{rec.athlete.team}{rec.age != null ? ` · ${rec.age} years` : ''} · login: {rec.athlete.email}</p>
            <GroupBadges groups={rec.athlete.groups} className="mt-1" />
          </div>
        </div>
      )}

      {/* Actions + completeness */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-white/10 bg-background/40 p-3">
        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Profile completeness</span>
            <b className={pct === 100 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-300' : 'text-red-300'}>{pct}%</b>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {rec.is_admin && !edit && <Button size="sm" variant="outline" onClick={startEdit} data-testid="hub-edit-btn"><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>}
          {edit && (
            <>
              <Button size="sm" onClick={() => save(draft)} disabled={saving} data-testid="hub-save-btn">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1" />Save</>}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(false)}><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
            </>
          )}
          {rec.can_request && <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300" onClick={() => setReqOpen(true)} data-testid="hub-request-btn"><Send className="w-3.5 h-3.5 mr-1" />Request info</Button>}
        </div>
      </div>

      {/* Status at a glance */}
      {!edit && tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2" data-testid="hub-status-tiles">
          {tiles.map(({ key, label, value, tone, sub, subTone, Icon }) => (
            <div key={key} className={`rounded-xl border p-3 ${value ? toneOf(tone).pill : 'border-dashed border-white/15 text-muted-foreground'}`}>
              <p className="text-[10px] uppercase tracking-wider opacity-80 flex items-center gap-1"><Icon className="w-3.5 h-3.5" />{label}</p>
              <p className="text-base font-bold mt-1 leading-tight">{value || 'Not filled'}</p>
              {sub && <p className={`text-[11px] mt-0.5 ${subTone || 'opacity-80'}`}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {rec.missing.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" />Missing ({rec.missing.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {rec.missing.map((m) => (
              <span key={`${m.kind}-${m.key}`} className="text-[11px] px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-200 flex items-center gap-1">
                {m.kind === 'doc' ? <Paperclip className="w-3 h-3" /> : <PenLine className="w-3 h-3" />}{m.label}{m.kind === 'doc' ? ' (file)' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {rec.requests.length > 0 && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs space-y-1.5">
          <p className="font-medium text-sky-300 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Open requests</p>
          {rec.requests.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2">
              <p>
                <span className="text-muted-foreground">{String(r.created_at).slice(0, 10)} · {r.created_by?.name}: </span>
                waiting for {r.remaining.map((i) => i.label).join(', ')}{r.due_date ? ` · due ${r.due_date}` : ''}
              </p>
              <button type="button" className="text-muted-foreground underline shrink-0" onClick={async () => {
                await axios.put(`${API}/staff/hub/requests/${r.id}`, { status: 'cancelled' }, getAuthHeaders()); load();
              }}>cancel</button>
            </div>
          ))}
        </div>
      )}

      {passport && (
        <PassportSuggestion data={passport} onClose={() => setPassport(null)}
          onApply={(s) => { setPassport(null); if (edit) setDraft((d) => ({ ...d, ...s })); else save(s); }} />
      )}

      {/* Information blocks */}
      <div className="grid lg:grid-cols-2 gap-3">
        {groupBySection(fields).map(([section, fs]) => {
          const SIcon = SECTION_ICONS[section] || StickyNote;
          const filled = fs.filter((f) => vals[f.key] !== undefined && vals[f.key] !== null && vals[f.key] !== '').length;
          return (
            <div key={section} className="rounded-xl border border-white/10 bg-background/40 overflow-hidden" data-testid={`hub-section-${section}`}>
              <div className="flex items-center justify-between px-3 py-2 bg-white/[0.03] border-b border-white/10">
                <p className="text-sm font-semibold flex items-center gap-2"><SIcon className="w-4 h-4 text-primary" />{section}</p>
                <span className="text-[10px] text-muted-foreground">{filled}/{fs.length}</span>
              </div>
              <dl className="divide-y divide-white/5">
                {fs.map((f) => (
                  <div key={f.key} className={`px-3 py-2 ${edit ? 'space-y-1' : 'flex items-center justify-between gap-3'}`}>
                    <dt className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                      {f.label}
                      {f.visibility === 'admin' && <Lock className="w-3 h-3 text-red-300/80" title="Only admins can see this" />}
                    </dt>
                    <dd className={edit ? '' : 'text-right min-w-0'}>
                      {edit ? <FieldInput field={f} value={vals[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                        : (vals[f.key] === undefined || vals[f.key] === null || vals[f.key] === '')
                          ? <span className="text-[11px] italic text-muted-foreground/50">not filled</span>
                          : (
                            <span className="inline-flex items-center gap-1.5 justify-end flex-wrap">
                              <ValuePill field={f} value={vals[f.key]} alert={rec.alerts?.[f.key]} />
                              {f.key === 'birth_date' && rec.age != null && <span className="text-[11px] text-muted-foreground">({rec.age} y)</span>}
                            </span>
                          )}
                      {f.help && edit && <p className="text-[10px] text-muted-foreground mt-0.5 break-words">{f.help}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-background/40 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-white/[0.03] border-b border-white/10">
          <p className="text-sm font-semibold flex items-center gap-2"><FolderOpen className="w-4 h-4 text-primary" />Documents</p>
          <span className="text-[10px] text-muted-foreground">{rec.documents.length} file{rec.documents.length === 1 ? '' : 's'}</span>
        </div>
        <div className="p-3">
          <DocumentsPanel
            athleteId={athleteId} docTypes={rec.doc_types} documents={rec.documents} getAuthHeaders={getAuthHeaders}
            canUpload={() => rec.is_admin} canDelete={() => rec.is_admin}
            onChanged={() => { load(); onChanged?.(); }}
            onPassportData={rec.is_admin ? setPassport : undefined}
          />
        </div>
      </div>

      {rec.request_history?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Past requests ({rec.request_history.length})</summary>
          <div className="mt-2 space-y-1">
            {rec.request_history.map((r) => (
              <p key={r.id} className="text-muted-foreground">{String(r.created_at).slice(0, 10)} · {r.items.map((i) => i.label).join(', ')} · <b>{r.status}</b>{r.completed_at ? ` ${String(r.completed_at).slice(0, 10)}` : ''}</p>
            ))}
          </div>
        </details>
      )}

      {rec.audit && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1"><History className="w-3.5 h-3.5" />Activity log (admins only)</summary>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {rec.audit.map((a) => (
              <p key={a.id} className="text-muted-foreground">
                {String(a.at).slice(0, 16).replace('T', ' ')} · <b className="text-foreground/80">{a.actor?.name}</b> {ACTIONS[a.action] || a.action}
                {a.detail?.fields ? `: ${a.detail.fields.join(', ')}` : ''}{a.detail?.doc_type ? ` (${a.detail.doc_type})` : ''}
              </p>
            ))}
            {!rec.audit.length && <p className="text-muted-foreground">No activity yet.</p>}
          </div>
        </details>
      )}

      <RequestDialog open={reqOpen} onOpenChange={setReqOpen} athletes={[rec.athlete]} fields={rec.fields} docTypes={rec.doc_types}
        getAuthHeaders={getAuthHeaders} onSent={load} />
    </div>
  );
}
