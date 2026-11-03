import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Loader2, ArrowUp, ArrowDown, EyeOff, Eye, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { API, TONE, toneOf, SECTION_ORDER } from '../../lib/hub';

const TYPES = [['text', 'Text'], ['select', 'Options (coloured)'], ['date', 'Date'], ['email', 'Email'], ['phone', 'Phone'], ['number', 'Number'], ['textarea', 'Long text']];

function Toggle({ on, onChange, label, testid }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />{label}
    </label>
  );
}

/** Admin editor for Athlete Hub fields and document types. */
export default function HubConfigEditor({ getAuthHeaders: gah, onSaved }) {
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const [fields, setFields] = useState(null);
  const [docs, setDocs] = useState(null);
  const [orig, setOrig] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/hub/config`, getAuthHeaders());
    setFields(r.data.fields); setDocs(r.data.doc_types);
    setOrig(JSON.stringify([r.data.fields, r.data.doc_types]));
  }, [getAuthHeaders]);
  useEffect(() => { load().catch(() => toast.error('Could not load settings')); }, [load]);

  if (!fields) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  const dirty = JSON.stringify([fields, docs]) !== orig;

  const upd = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i, d) => setFields((fs) => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const updDoc = (i, patch) => setDocs((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    setSaving(true);
    try {
      const r = await axios.put(`${API}/admin/hub/config`, { fields, doc_types: docs }, getAuthHeaders());
      setFields(r.data.fields); setDocs(r.data.doc_types); setOrig(JSON.stringify([r.data.fields, r.data.doc_types]));
      toast.success('Settings saved');
      onSaved?.();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-testid="hub-config-editor">
      <div className="sticky top-16 z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-background/95 p-2">
        <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="hub-config-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1" />Save changes</>}</Button>
        {dirty ? <span className="text-xs text-amber-300">Unsaved changes</span> : <span className="text-xs text-muted-foreground">Fields and documents shown in every athlete profile.</span>}
      </div>

      <Card className="glass-light border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profile fields</CardTitle>
          <p className="text-xs text-muted-foreground">
            <b>Who can see:</b> "Admins only" for sensitive data (CPF, address); "Medical staff" for health data (admins + physios); "All staff" shows it to coaches too. Research users never see personal data.
            Built-in fields can be hidden but not deleted (their data is kept).
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {fields.map((f, i) => {
            const isOpen = openKey === (f.key || `new-${i}`);
            return (
              <div key={f.key || `new-${i}`} className={`rounded-lg border ${f.hidden ? 'border-white/5 opacity-60' : 'border-white/10'} bg-background/40`} data-testid={`hub-field-row-${f.key || i}`}>
                <div className="flex items-center gap-2 p-2">
                  <button type="button" onClick={() => setOpenKey(isOpen ? null : (f.key || `new-${i}`))} className="text-muted-foreground">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                  <Input value={f.label} onChange={(e) => upd(i, { label: e.target.value })} className="h-8 flex-1 min-w-[8rem] bg-background/50 border-white/10 text-sm" maxLength={60} />
                  <span className="hidden sm:inline text-[10px] text-muted-foreground w-24 truncate">{TYPES.find((t) => t[0] === f.type)?.[1]}</span>
                  <span className={`hidden sm:inline text-[10px] px-1.5 rounded ${f.visibility === 'admin' ? 'bg-red-500/15 text-red-300' : f.visibility === 'medical' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/10'}`}>{f.visibility === 'admin' ? 'admins' : f.visibility === 'medical' ? 'medical' : 'staff'}</span>
                  <button type="button" title={f.hidden ? 'Show' : 'Hide'} onClick={() => upd(i, { hidden: !f.hidden })} className="p-1">{f.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  <button type="button" onClick={() => move(i, -1)} className="p-1" aria-label="Move up"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} className="p-1" aria-label="Move down"><ArrowDown className="w-4 h-4" /></button>
                  {!f.builtin && <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} className="p-1 text-red-400" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>}
                </div>
                {isOpen && (
                  <div className="border-t border-white/10 p-3 space-y-3 text-xs">
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-1.5">Type
                        <select value={f.type} disabled={f.builtin} onChange={(e) => upd(i, { type: e.target.value, options: e.target.value === 'select' ? (f.options?.length ? f.options : [{ value: 'Yes', label: 'Yes', tone: 'green' }, { value: 'No', label: 'No', tone: 'red' }]) : [] })}
                          className="h-8 rounded-md bg-background/50 border border-white/10 px-2">
                          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">Section
                        <select value={f.section} onChange={(e) => upd(i, { section: e.target.value })} className="h-8 rounded-md bg-background/50 border border-white/10 px-2">
                          {SECTION_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">Who can see
                        <select value={f.visibility} onChange={(e) => upd(i, { visibility: e.target.value })} className="h-8 rounded-md bg-background/50 border border-white/10 px-2" data-testid={`hub-field-visibility-${f.key || i}`}>
                          <option value="staff">All staff</option><option value="medical">Medical staff (admins & physios)</option><option value="admin">Admins only</option>
                        </select>
                      </label>
                      {f.type === 'date' && (
                        <label className="flex items-center gap-1.5">Warn before (days)
                          <Input type="number" min={0} value={f.alert_days ?? ''} onChange={(e) => upd(i, { alert_days: e.target.value })} className="h-8 w-20 bg-background/50 border-white/10" />
                        </label>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <Toggle on={f.athlete_editable} onChange={(v) => upd(i, { athlete_editable: v })} label="Athlete can fill in" />
                      <Toggle on={f.athlete_visible !== false} onChange={(v) => upd(i, { athlete_visible: v })} label="Athlete can see" />
                      <Toggle on={f.required} onChange={(v) => upd(i, { required: v })} label="Required (counts as missing, shows a summary card)" />
                    </div>
                    <Input value={f.help || ''} onChange={(e) => upd(i, { help: e.target.value })} placeholder="Help text / link shown to whoever fills it (optional)" className="h-8 bg-background/50 border-white/10" maxLength={300} />
                    {f.type === 'select' && (
                      <div className="space-y-1.5">
                        <p className="text-muted-foreground">Options and colours</p>
                        {(f.options || []).map((o, oi) => (
                          <div key={oi} className="flex items-center gap-2 flex-wrap">
                            <Input value={o.label} onChange={(e) => upd(i, { options: f.options.map((x, k) => (k === oi ? { ...x, label: e.target.value } : x)) })} className="h-7 w-48 bg-background/50 border-white/10" />
                            <div className="flex gap-1">
                              {Object.keys(TONE).map((t) => (
                                <button key={t} type="button" onClick={() => upd(i, { options: f.options.map((x, k) => (k === oi ? { ...x, tone: t } : x)) })}
                                  className={`w-5 h-5 rounded-full ${toneOf(t).bar} ${o.tone === t ? 'ring-2 ring-white ring-offset-1 ring-offset-background' : 'opacity-50'}`} aria-label={t} />
                              ))}
                            </div>
                            <button type="button" onClick={() => upd(i, { options: f.options.filter((_, k) => k !== oi) })} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => upd(i, { options: [...(f.options || []), { value: '', label: 'New option', tone: 'gray' }] })}><Plus className="w-3.5 h-3.5 mr-1" />Add option</Button>
                        <p className="text-[10px] text-muted-foreground">Renaming an option keeps the athletes who already have it.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Button size="sm" variant="outline" onClick={() => { setFields((fs) => [...fs, { key: '', label: 'New field', type: 'text', section: 'Other', visibility: 'staff', athlete_editable: true, athlete_visible: true, options: [] }]); setOpenKey(`new-${fields.length}`); }}
            data-testid="hub-add-field"><Plus className="w-4 h-4 mr-1" />Add field</Button>
        </CardContent>
      </Card>

      <Card className="glass-light border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Documents</CardTitle>
          <p className="text-xs text-muted-foreground">Types of files that can be attached to a profile. Photos or PDF, up to 10 MB each.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {docs.map((d, i) => (
            <div key={d.key || `nd-${i}`} className="flex items-center gap-3 flex-wrap rounded-lg border border-white/10 bg-background/40 p-2 text-xs">
              <Input value={d.label} onChange={(e) => updDoc(i, { label: e.target.value })} className="h-8 w-56 bg-background/50 border-white/10 text-sm" maxLength={60} />
              <select value={d.visibility} onChange={(e) => updDoc(i, { visibility: e.target.value })} className="h-8 rounded-md bg-background/50 border border-white/10 px-2">
                <option value="staff">All staff can see</option><option value="medical">Medical staff only</option><option value="admin">Admins only</option>
              </select>
              <Toggle on={d.athlete_can_upload} onChange={(v) => updDoc(i, { athlete_can_upload: v })} label="Athlete can upload" />
              <Toggle on={d.required} onChange={(v) => updDoc(i, { required: v })} label="Required" />
              {!d.builtin && <button type="button" onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))} className="ml-auto text-red-400"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setDocs((ds) => [...ds, { key: '', label: 'New document', visibility: 'admin', athlete_can_upload: true, required: false }])} data-testid="hub-add-doc"><Plus className="w-4 h-4 mr-1" />Add document type</Button>
        </CardContent>
      </Card>
    </div>
  );
}
