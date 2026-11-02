import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Save, Loader2, Lock, ClipboardList, CheckCircle2, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import FieldInput, { ValuePill } from '../../components/hub/FieldInput';
import DocumentsPanel from '../../components/hub/DocumentsPanel';
import PassportSuggestion from '../../components/hub/PassportSuggestion';
import { API, groupBySection } from '../../lib/hub';

const linkify = (text) => String(text || '').split(/(https?:\/\/\S+)/g).map((part, i) => (
  /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">{part.replace(/^https?:\/\//, '').slice(0, 40)}<ExternalLink className="w-3 h-3" /></a>
    : part
));

/** Athlete: my registration info and documents for the Brasil Lacrosse staff. */
export default function MyInfo() {
  const { user, getAuthHeaders: gah } = useAuth();
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const [info, setInfo] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [passport, setPassport] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/athlete/hub/me`, getAuthHeaders());
      setInfo(r.data); setDraft(r.data.values || {});
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not load your info'); }
  }, [getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const save = async (values = draft) => {
    setSaving(true);
    try {
      const editable = Object.fromEntries(Object.entries(values).filter(([k]) => info.fields.find((f) => f.key === k)?.athlete_editable));
      const r = await axios.put(`${API}/athlete/hub/me`, { values: editable }, getAuthHeaders());
      toast.success(r.data.changed.length ? 'Saved — thank you!' : 'Nothing to change');
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };

  if (!info) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(info.values || {});
  const requested = info.requests || [];
  const reqKeys = new Set(requested.flatMap((r) => r.remaining.map((i) => i.key)));
  const myDocs = info.doc_types.filter((d) => d.athlete_can_upload || info.documents.some((x) => x.doc_type === d.key));

  return (
    <div className="min-h-screen bg-background pb-28" data-testid="my-info-page">
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/athlete"><Button variant="ghost" size="icon" className="h-9 w-9"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div>
            <h1 className="font-heading font-bold text-lg leading-tight">My info & documents</h1>
            <p className="text-xs text-muted-foreground">For the Brasil Lacrosse staff · {user?.name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {requested.length > 0 ? (
          <Card className="border-amber-400/40 bg-amber-400/10" data-testid="my-info-requests">
            <CardContent className="p-4 space-y-2 text-sm">
              <p className="font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-amber-300" />The staff asked you for:</p>
              {requested.map((r) => (
                <div key={r.id} className="text-xs">
                  <p><b>{r.remaining.map((i) => i.label).join(', ')}</b>{r.due_date ? ` — by ${r.due_date}` : ''}</p>
                  {r.message && <p className="text-muted-foreground mt-0.5">“{r.message}” — {r.created_by?.name}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : info.missing.length === 0 ? (
          <p className="text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Your profile is complete. Thank you!</p>
        ) : null}

        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Only the Brasil Lacrosse staff can see this. Sensitive data (documents, CPF, address) is visible to administrators only.
        </p>

        {passport && (
          <PassportSuggestion data={passport} onClose={() => setPassport(null)}
            onApply={(s) => { setPassport(null); const next = { ...draft, ...s }; setDraft(next); save(next); }} />
        )}

        <Card className="glass-light border-white/10">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">Documents</p>
            <p className="text-xs text-muted-foreground">Take a clear photo or upload a PDF. Tip: when you upload your passport photo page, the app reads the dates for you.</p>
            <DocumentsPanel
              athleteId={user?.id} docTypes={myDocs} documents={info.documents} getAuthHeaders={getAuthHeaders} compact
              canUpload={(dt) => dt.athlete_can_upload}
              canDelete={(d) => d.uploaded_by?.id === user?.id}
              onChanged={load}
              onPassportData={setPassport}
            />
          </CardContent>
        </Card>

        {groupBySection(info.fields).map(([section, fs]) => (
          <Card key={section} className="glass-light border-white/10">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">{section}</p>
              {fs.map((f) => (
                <div key={f.key} data-testid={`my-info-field-${f.key}`}>
                  <p className={`text-xs mb-1 flex items-center gap-1.5 ${reqKeys.has(f.key) ? 'text-amber-300 font-medium' : 'text-muted-foreground'}`}>
                    {f.label}{f.required && !draft[f.key] && <span className="text-[10px] text-red-300">required</span>}
                    {f.key === 'birth_date' && info.age != null && <span className="text-foreground/70">· {info.age} years</span>}
                  </p>
                  {f.athlete_editable
                    ? <FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                    : <div className="flex items-center gap-2"><ValuePill field={f} value={info.values[f.key]} /><span className="text-[10px] text-muted-foreground">set by the staff</span></div>}
                  {f.help && <p className="text-[11px] text-muted-foreground mt-1 break-words">{linkify(f.help)}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </main>

      {dirty && (
        <div className="fixed bottom-20 inset-x-0 z-50 px-4">
          <div className="max-w-2xl mx-auto">
            <Button className="w-full h-12 font-bold shadow-xl" onClick={() => save()} disabled={saving} data-testid="my-info-save">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Save my info</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
