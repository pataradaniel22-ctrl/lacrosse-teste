import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  NotebookPen, Trash2, Loader2, Plus, Pencil, Lock, Paperclip, CalendarClock, Search, Download, History,
  CheckCircle2, AlertTriangle, X, FileText, Image as ImageIcon, Activity, Save,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TYPE_STYLE = {
  Assessment: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  Treatment: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  'Follow-up': 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  'Return to play': 'bg-primary/15 text-primary border-primary/40',
  'Test / Imaging': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  Medication: 'bg-pink-500/15 text-pink-300 border-pink-500/40',
  Communication: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
  Note: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
};
const DOMAIN_STYLE = {
  Pain: 'text-red-300', Injury: 'text-orange-300', Illness: 'text-amber-300', 'Mental Health': 'text-purple-300',
  Nutrition: 'text-emerald-300', Performance: 'text-sky-300',
};
const AVAIL_STYLE = { Full: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', Modified: 'bg-amber-400/15 text-amber-300 border-amber-400/40', Out: 'bg-red-500/15 text-red-300 border-red-500/40' };
const SOAP = [['s', 'Subjective', 'What the athlete reports'], ['o', 'Objective', 'Findings, tests, measurements'], ['a', 'Assessment', 'Clinical impression'], ['p', 'Plan', 'Treatment, load, next steps']];
const FIELD_LABEL = { entry_type: 'type', category: 'area', title: 'title', body: 'note', soap: 'SOAP', related: 'body region', occurred_on: 'date', occurred_time: 'time', pain: 'pain', availability: 'availability', follow_up_on: 'follow-up', follow_up_done: 'follow-up done', confidential: 'confidential' };

const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const monthLabel = (iso) => (iso ? new Date(`${iso.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No date');
const EMPTY = { entry_type: 'Assessment', category: 'General', title: '', body: '', soap: { s: '', o: '', a: '', p: '' }, related: '', occurred_on: '', occurred_time: '', pain: '', availability: '', follow_up_on: '', confidential: false };

async function openAttachment(att, getAuthHeaders) {
  const w = window.open('', '_blank');
  try {
    const r = await axios.get(`${API}/staff/clinical-attachments/${att.id}/file`, { ...getAuthHeaders(), responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    if (w) w.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { if (w) w.close(); toast.error('Could not open the file'); }
}

function Chip({ active, onClick, children, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground'}`}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ form */
function EntryForm({ initial, meta, onCancel, onSaved, athleteId, getAuthHeaders }) {
  const editing = !!initial?.id;
  const [f, setF] = useState(() => (editing ? {
    ...EMPTY, ...initial, soap: { ...EMPTY.soap, ...(initial.soap || {}) }, pain: initial.pain ?? '', availability: initial.availability || '',
    follow_up_on: initial.follow_up_on || '', occurred_time: initial.occurred_time || '', related: initial.related || '', title: initial.title || '',
  } : { ...EMPTY, occurred_on: todayIso() }));
  const [useSoap, setUseSoap] = useState(() => !!(initial?.soap && Object.values(initial.soap).some(Boolean)));
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    const payload = {
      entry_type: f.entry_type, category: f.category, title: f.title, related: f.related, occurred_on: f.occurred_on, occurred_time: f.occurred_time,
      pain: f.pain === '' ? null : Number(f.pain), availability: f.availability || null, follow_up_on: f.follow_up_on || null,
      confidential: f.confidential, body: useSoap ? (editing ? f.body : '') : f.body, soap: useSoap ? f.soap : null,
    };
    if (!payload.title && !payload.body && !(payload.soap && Object.values(payload.soap).some((v) => v.trim()))) { toast.error('Write a title, a note or the SOAP fields.'); return; }
    setSaving(true);
    try {
      const r = editing
        ? await axios.put(`${API}/staff/athlete-note/${initial.id}`, payload, getAuthHeaders())
        : await axios.post(`${API}/staff/athlete/${athleteId}/notes`, payload, getAuthHeaders());
      const note = r.data.note;
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file);
        try { await axios.post(`${API}/staff/athlete-note/${note.id}/attachments`, fd, { headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' } }); } // eslint-disable-line no-await-in-loop
        catch (e) { toast.error(`${file.name}: ${e?.response?.data?.detail || 'upload failed'}`); }
      }
      toast.success(editing ? 'Entry updated — previous version kept in history' : 'Entry added to the clinical record');
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };

  const label = 'text-[11px] text-muted-foreground mb-1 block';
  return (
    <Card className="glass-light border-primary/30" data-testid="clinical-entry-form">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold flex items-center gap-2"><NotebookPen className="w-4 h-4 text-primary" />{editing ? 'Edit entry' : 'New clinical entry'}</p>
          <button type="button" onClick={onCancel} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div>
          <span className={label}>Type</span>
          <div className="flex flex-wrap gap-1.5">
            {meta.types.map((t) => <Chip key={t} active={f.entry_type === t} onClick={() => set('entry_type', t)} testid={`clinical-type-${t}`}>{t}</Chip>)}
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="sm:col-span-1"><span className={label}>Date it happened</span>
            <Input type="date" max={todayIso()} value={f.occurred_on} onChange={(e) => set('occurred_on', e.target.value)} className="h-9 bg-background/50 border-white/10" data-testid="clinical-date" /></label>
          <label><span className={label}>Time (optional)</span>
            <Input type="time" value={f.occurred_time} onChange={(e) => set('occurred_time', e.target.value)} className="h-9 bg-background/50 border-white/10" /></label>
          <label><span className={label}>Area</span>
            <select value={f.category} onChange={(e) => set('category', e.target.value)} className="h-9 w-full rounded-md bg-background/50 border border-white/10 px-2 text-sm" data-testid="clinical-area">
              {meta.domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          <label><span className={label}>Body region (optional)</span>
            <Input value={f.related} onChange={(e) => set('related', e.target.value)} placeholder="e.g. Right ankle" className="h-9 bg-background/50 border-white/10" maxLength={120} /></label>
        </div>

        <label className="block"><span className={label}>Title / summary</span>
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Lateral ankle sprain — initial assessment" className="h-9 bg-background/50 border-white/10" maxLength={140} data-testid="clinical-title" /></label>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Chip active={!useSoap} onClick={() => setUseSoap(false)} testid="clinical-mode-free">Free text</Chip>
            <Chip active={useSoap} onClick={() => setUseSoap(true)} testid="clinical-mode-soap">SOAP</Chip>
          </div>
          {useSoap ? (
            <div className="grid sm:grid-cols-2 gap-2">
              {SOAP.map(([k, l, ph]) => (
                <label key={k}><span className={label}><b className="text-foreground">{k.toUpperCase()}</b> · {l}</span>
                  <Textarea rows={3} value={f.soap[k]} onChange={(e) => set('soap', { ...f.soap, [k]: e.target.value })} placeholder={ph} className="bg-background/50 border-white/10 text-sm" data-testid={`clinical-soap-${k}`} /></label>
              ))}
            </div>
          ) : (
            <Textarea rows={4} value={f.body} onChange={(e) => set('body', e.target.value)} placeholder="Observation, assessment, treatment or plan…" className="bg-background/50 border-white/10 text-sm" data-testid="clinical-body" />
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div><span className={label}>Pain (0–10, optional)</span>
            <div className="flex flex-wrap gap-1">
              {[...Array(11).keys()].map((n) => (
                <button key={n} type="button" onClick={() => set('pain', f.pain === n ? '' : n)}
                  className={`w-7 h-7 text-xs rounded-md border ${f.pain === n ? (n >= 7 ? 'bg-red-500 border-red-500 text-white' : n >= 4 ? 'bg-amber-400 border-amber-400 text-black' : 'bg-emerald-500 border-emerald-500 text-white') : 'border-white/10 text-muted-foreground'}`}>{n}</button>
              ))}
            </div></div>
          <div><span className={label}>Training availability</span>
            <div className="flex gap-1.5">
              {meta.availability.map((a) => (
                <button key={a} type="button" onClick={() => set('availability', f.availability === a ? '' : a)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${f.availability === a ? AVAIL_STYLE[a] + ' ring-1 ring-white/30' : 'border-white/10 text-muted-foreground'}`}>{a}</button>
              ))}
            </div></div>
          <label><span className={label}>Follow-up / re-assessment date</span>
            <Input type="date" value={f.follow_up_on} onChange={(e) => set('follow_up_on', e.target.value)} className="h-9 bg-background/50 border-white/10" data-testid="clinical-followup" /></label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden"
            onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ''; }} />
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="clinical-attach"><Paperclip className="w-3.5 h-3.5 mr-1" />Attach files</Button>
          {files.map((file, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 flex items-center gap-1">{file.name}
              <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X className="w-3 h-3" /></button></span>
          ))}
          {meta.can_mark_confidential && (
            <label className="flex items-center gap-1.5 text-xs ml-auto cursor-pointer" data-testid="clinical-confidential">
              <input type="checkbox" checked={f.confidential} onChange={(e) => set('confidential', e.target.checked)} />
              <Lock className="w-3.5 h-3.5 text-red-300" />Confidential (admins & physios only)
            </label>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving} data-testid="clinical-save">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1" />{editing ? 'Save changes' : 'Add to record'}</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ entry card */
function EntryCard({ e, meta, onEdit, onDelete, onFollowDone, getAuthHeaders }) {
  const [showHist, setShowHist] = useState(false);
  const soap = e.soap && Object.values(e.soap).some(Boolean) ? e.soap : null;
  const recorded = String(e.created_at || '').slice(0, 10);
  return (
    <div className={`rounded-xl border bg-background/40 p-3 space-y-2 ${e.confidential ? 'border-red-500/30' : 'border-white/10'}`} data-testid={`clinical-entry-${e.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold">{fmtDate(e.occurred_on)}{e.occurred_time ? ` · ${e.occurred_time}` : ''}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_STYLE[e.entry_type] || TYPE_STYLE.Note}`}>{e.entry_type}</span>
          {e.category && e.category !== 'General' && <span className={`text-[11px] ${DOMAIN_STYLE[e.category] || 'text-muted-foreground'}`}>● {e.category}</span>}
          {e.related && <span className="text-[11px] text-muted-foreground">· {e.related}</span>}
          {e.availability && <span className={`text-[10px] px-2 py-0.5 rounded-full border ${AVAIL_STYLE[e.availability]}`}>{e.availability}</span>}
          {e.pain != null && <span className={`text-[10px] px-2 py-0.5 rounded-full border ${e.pain >= 7 ? 'border-red-500/40 text-red-300' : e.pain >= 4 ? 'border-amber-400/40 text-amber-300' : 'border-emerald-500/40 text-emerald-300'}`}>Pain {e.pain}/10</span>}
          {e.confidential && <span className="text-[10px] flex items-center gap-0.5 text-red-300"><Lock className="w-3 h-3" />Confidential</span>}
        </div>
        <div className="flex items-center gap-1">
          {e.can_edit && <button type="button" onClick={() => onEdit(e)} className="p-1 text-muted-foreground hover:text-foreground" title="Edit" data-testid={`clinical-edit-${e.id}`}><Pencil className="w-3.5 h-3.5" /></button>}
          {meta.is_admin && <button type="button" onClick={() => onDelete(e)} className="p-1 text-red-400 hover:text-red-300" title="Delete" data-testid={`clinical-delete-${e.id}`}><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      {e.title && <p className="font-medium text-sm">{e.title}</p>}
      {soap ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {SOAP.filter(([k]) => soap[k]).map(([k, l]) => (
            <div key={k} className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.toUpperCase()} · {l}</p>
              <p className="text-sm whitespace-pre-wrap">{soap[k]}</p>
            </div>
          ))}
        </div>
      ) : null}
      {e.body && <p className="text-sm whitespace-pre-wrap text-foreground/90">{e.body}</p>}
      {e.attachments?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {e.attachments.map((a) => (
            <button key={a.id} type="button" onClick={() => openAttachment(a, getAuthHeaders)} className="text-[11px] px-2 py-1 rounded-md bg-white/5 border border-white/10 hover:border-white/30 flex items-center gap-1">
              {a.content_type === 'application/pdf' ? <FileText className="w-3.5 h-3.5 text-sky-400" /> : <ImageIcon className="w-3.5 h-3.5 text-sky-400" />}{a.filename}
            </button>
          ))}
        </div>
      )}
      {e.follow_up_on && (
        <div className={`flex items-center gap-2 text-xs rounded-md px-2 py-1 ${e.follow_up_status === 'overdue' ? 'bg-red-500/10 text-red-300' : e.follow_up_status === 'due' ? 'bg-amber-400/10 text-amber-300' : e.follow_up_done ? 'text-emerald-400' : 'text-muted-foreground'}`}>
          <CalendarClock className="w-3.5 h-3.5" />
          {e.follow_up_done ? `Follow-up ${fmtDate(e.follow_up_on)} done` : `Follow-up ${fmtDate(e.follow_up_on)}${e.follow_up_status === 'overdue' ? ' — overdue' : ''}`}
          {!e.follow_up_done && e.can_edit && <button type="button" onClick={() => onFollowDone(e)} className="ml-auto underline">mark done</button>}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2">
        <span>By {e.author}{e.author_role ? ` (${e.author_role})` : ''}</span>
        {recorded && recorded !== e.occurred_on && <span>· recorded {fmtDate(recorded)}</span>}
        {e.revisions?.length > 0 && <button type="button" className="underline flex items-center gap-0.5" onClick={() => setShowHist((v) => !v)}><History className="w-3 h-3" />edited {e.revisions.length}×</button>}
      </div>
      {showHist && (
        <div className="rounded-md bg-white/[0.03] border border-white/5 p-2 space-y-1 text-[11px] text-muted-foreground" data-testid={`clinical-history-${e.id}`}>
          {[...e.revisions].reverse().map((r, i) => (
            <div key={i}>
              <b className="text-foreground/80">{String(r.at).slice(0, 16).replace('T', ' ')} · {r.by}</b> changed {Object.keys(r.previous).map((k) => FIELD_LABEL[k] || k).join(', ')}
              {Object.entries(r.previous).map(([k, v]) => (
                <p key={k} className="pl-2 break-words">before ({FIELD_LABEL[k] || k}): {v === null || v === '' ? '—' : typeof v === 'object' ? Object.entries(v).filter(([, x]) => x).map(([x, y]) => `${x.toUpperCase()}: ${y}`).join(' | ') : String(v)}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ main */
export default function AthleteRecord({ athleteId, athleteName }) {
  const { getAuthHeaders: gah } = useAuth();
  const auth = useRef(gah); auth.current = gah;
  const getAuthHeaders = useCallback(() => auth.current(), []);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // null | {} | entry
  const [type, setType] = useState('all');
  const [domain, setDomain] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/staff/athlete/${athleteId}/notes`, getAuthHeaders());
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to load the clinical record.'); setData({ notes: [], error: true }); }
  }, [athleteId, getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const notes = data?.notes || [];
  const meta = data || { types: [], domains: [], availability: [] };
  const visible = useMemo(() => notes.filter((e) => {
    if (type !== 'all' && e.entry_type !== type) return false;
    if (domain !== 'all' && e.category !== domain) return false;
    if (q) {
      const hay = [e.title, e.body, e.related, e.author, ...(e.soap ? Object.values(e.soap) : [])].join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [notes, type, domain, q]);
  const byMonth = useMemo(() => {
    const m = [];
    visible.forEach((e) => { const k = (e.occurred_on || '').slice(0, 7); const last = m[m.length - 1]; if (last && last.k === k) last.items.push(e); else m.push({ k, items: [e] }); });
    return m;
  }, [visible]);
  const followUps = notes.filter((e) => e.follow_up_status === 'overdue' || e.follow_up_status === 'due').sort((a, b) => a.follow_up_on.localeCompare(b.follow_up_on));
  const latestAvail = notes.find((e) => e.availability);

  const del = async (e) => {
    if (!window.confirm('Delete this entry? It will be hidden but kept in the audit trail.')) return;
    try { await axios.delete(`${API}/staff/athlete-note/${e.id}`, getAuthHeaders()); toast.success('Entry deleted'); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Could not delete'); }
  };
  const followDone = async (e) => {
    try { await axios.put(`${API}/staff/athlete-note/${e.id}`, { follow_up_done: true }, getAuthHeaders()); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Could not update'); }
  };
  const exportCsv = () => {
    const head = ['Date', 'Time', 'Type', 'Area', 'Body region', 'Title', 'Note', 'S', 'O', 'A', 'P', 'Pain', 'Availability', 'Follow-up', 'Follow-up done', 'Confidential', 'Author', 'Role', 'Recorded', 'Edits', 'Attachments'];
    const rows = visible.map((e) => [e.occurred_on, e.occurred_time, e.entry_type, e.category, e.related, e.title, e.body, e.soap?.s, e.soap?.o, e.soap?.a, e.soap?.p, e.pain, e.availability, e.follow_up_on, e.follow_up_done ? 'yes' : '', e.confidential ? 'yes' : '', e.author, e.author_role, String(e.created_at || '').slice(0, 16), e.revisions?.length || 0, (e.attachments || []).map((a) => a.filename).join('; ')]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `clinical-record-${(athleteName || 'athlete').replace(/\s+/g, '-').toLowerCase()}-${todayIso()}.csv`; a.click();
  };

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (data.error) return <p className="text-sm text-muted-foreground p-4">The clinical record is not available.</p>;

  return (
    <div className="space-y-4" data-testid="athlete-record">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="font-heading font-bold text-lg flex items-center gap-2"><NotebookPen className="w-5 h-5 text-primary" />Clinical Record</p>
          <p className="text-xs text-muted-foreground">{notes.length} entr{notes.length === 1 ? 'y' : 'ies'} · every change is kept in the history</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!visible.length} data-testid="clinical-export"><Download className="w-3.5 h-3.5 mr-1" />CSV</Button>
          {!form && <Button size="sm" onClick={() => setForm({})} data-testid="clinical-new"><Plus className="w-3.5 h-3.5 mr-1" />New entry</Button>}
        </div>
      </div>

      {/* At a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-xl border border-white/10 bg-background/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last entry</p>
          <p className="text-sm font-semibold mt-0.5">{notes[0] ? fmtDate(notes[0].occurred_on) : '—'}</p>
          <p className="text-[11px] text-muted-foreground truncate">{notes[0] ? (notes[0].title || notes[0].entry_type) : 'No entries yet'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Availability (latest)</p>
          {latestAvail ? <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full border ${AVAIL_STYLE[latestAvail.availability]}`}>{latestAvail.availability}</span> : <p className="text-sm mt-0.5">—</p>}
          {latestAvail && <p className="text-[11px] text-muted-foreground">since {fmtDate(latestAvail.occurred_on)}</p>}
        </div>
        <div className={`rounded-xl border p-3 ${followUps.some((e) => e.follow_up_status === 'overdue') ? 'border-red-500/40 bg-red-500/5' : followUps.length ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-background/40'}`}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Follow-ups due</p>
          <p className="text-sm font-semibold mt-0.5">{followUps.length}</p>
          <p className="text-[11px] text-muted-foreground">{followUps.filter((e) => e.follow_up_status === 'overdue').length} overdue</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last 30 days</p>
          <p className="text-sm font-semibold mt-0.5">{notes.filter((e) => e.occurred_on && (Date.now() - new Date(`${e.occurred_on}T12:00:00`)) / 86400000 <= 30).length} entries</p>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" />{notes.filter((e) => e.entry_type === 'Treatment').length} treatments total</p>
        </div>
      </div>

      {followUps.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 space-y-1.5" data-testid="clinical-followups">
          <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Follow-ups to do</p>
          {followUps.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-xs">
              <CalendarClock className={`w-3.5 h-3.5 ${e.follow_up_status === 'overdue' ? 'text-red-400' : 'text-amber-300'}`} />
              <span className={e.follow_up_status === 'overdue' ? 'text-red-300' : ''}>{fmtDate(e.follow_up_on)}</span>
              <span className="text-muted-foreground truncate">— {e.title || e.entry_type}{e.related ? ` · ${e.related}` : ''}</span>
              {e.can_edit && <button type="button" onClick={() => followDone(e)} className="ml-auto flex items-center gap-1 text-emerald-400 shrink-0"><CheckCircle2 className="w-3.5 h-3.5" />done</button>}
            </div>
          ))}
        </div>
      )}

      {form && (
        <EntryForm key={form.id || 'new'} initial={form.id ? form : null} meta={meta} athleteId={athleteId} getAuthHeaders={getAuthHeaders}
          onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}

      {/* Filters */}
      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={type === 'all'} onClick={() => setType('all')}>All types</Chip>
          {meta.types.filter((t) => notes.some((e) => e.entry_type === t)).map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(type === t ? 'all' : t)}>{t} {notes.filter((e) => e.entry_type === t).length}</Chip>
          ))}
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="h-7 rounded-full bg-background/50 border border-white/10 px-2 text-xs">
            <option value="all">All areas</option>
            {meta.domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the record" className="h-7 w-48 pl-7 text-xs bg-background/50 border-white/10" data-testid="clinical-search" />
          </div>
        </div>
      )}

      {/* Timeline */}
      {!notes.length ? (
        <Card className="glass-light border-white/5">
          <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
            <p>No entries yet. Record assessments, treatments, tests, return-to-play decisions and follow-ups — past dates are allowed.</p>
            {!form && <Button size="sm" onClick={() => setForm({})}><Plus className="w-3.5 h-3.5 mr-1" />Add the first entry</Button>}
          </CardContent>
        </Card>
      ) : !visible.length ? (
        <p className="text-sm text-muted-foreground text-center py-6">No entries match the filters.</p>
      ) : (
        <div className="space-y-5">
          {byMonth.map(({ k, items }) => (
            <div key={k} className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground sticky top-16 z-10 bg-background/90 backdrop-blur py-1">{monthLabel(k)} · {items.length}</p>
              <div className="border-l border-white/10 pl-3 space-y-2">
                {items.map((e) => <EntryCard key={e.id} e={e} meta={meta} getAuthHeaders={getAuthHeaders} onEdit={(x) => { setForm(x); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onDelete={del} onFollowDone={followDone} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
