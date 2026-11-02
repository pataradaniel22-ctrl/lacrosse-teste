import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Pencil, Save, X, Loader2, Send, AlertTriangle, History, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import FieldInput, { ValuePill } from './FieldInput';
import DocumentsPanel from './DocumentsPanel';
import PassportSuggestion from './PassportSuggestion';
import RequestDialog from './RequestDialog';
import GroupBadges from '../groups/GroupBadges';
import { API, groupBySection } from '../../lib/hub';

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

      {rec.missing.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
          <p className="font-medium text-amber-300 flex items-center gap-1.5 mb-1"><AlertTriangle className="w-3.5 h-3.5" />Missing ({rec.missing.length})</p>
          <p className="text-muted-foreground">{rec.missing.map((m) => m.label).join(' · ')}</p>
        </div>
      )}

      {rec.requests.length > 0 && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs space-y-1.5">
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

      {groupBySection(fields).map(([section, fs]) => (
        <div key={section} className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{section}</p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
            {fs.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                  {f.label}{f.visibility === 'admin' && <span className="text-[9px] px-1 rounded bg-white/10" title="Only admins can see this">admin</span>}
                  {f.key === 'birth_date' && rec.age != null && !edit && <span className="text-foreground/70">· {rec.age} y</span>}
                </p>
                {edit ? <FieldInput field={f} value={vals[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                  : <ValuePill field={f} value={vals[f.key]} alert={rec.alerts?.[f.key]} />}
                {f.help && edit && <p className="text-[10px] text-muted-foreground mt-0.5 break-words">{f.help}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Documents</p>
        <DocumentsPanel
          athleteId={athleteId} docTypes={rec.doc_types} documents={rec.documents} getAuthHeaders={getAuthHeaders}
          canUpload={() => rec.is_admin} canDelete={() => rec.is_admin}
          onChanged={() => { load(); onChanged?.(); }}
          onPassportData={rec.is_admin ? setPassport : undefined}
        />
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
