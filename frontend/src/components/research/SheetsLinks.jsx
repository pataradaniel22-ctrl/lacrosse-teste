import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Link2, Copy, Trash2, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '../../contexts/AuthContext';
import { API } from './exportUtils';

const WINDOWS = [
  { v: 'all', l: 'All time' }, { v: '28', l: 'Rolling last 4 weeks' }, { v: '84', l: 'Rolling last 12 weeks' },
  { v: '182', l: 'Rolling last 6 months' }, { v: '365', l: 'Rolling last 12 months' },
];

const formula = (f) => `=IMPORTDATA("${process.env.REACT_APP_BACKEND_URL}${f.path}")`;

const copy = async (text) => {
  try { await navigator.clipboard.writeText(text); toast.success('Formula copied — paste it in cell A1 of a Google Sheet'); }
  catch (e) { toast.error('Copy failed — select the text manually'); }
};

const FeedRow = ({ f, onRevoke }) => (
  <div className="p-3 rounded-lg border border-white/5 space-y-2" data-testid={`feed-${f.id}`}>
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <p className="text-sm font-medium">{f.name || f.label}</p>
        <p className="text-[11px] text-muted-foreground">
          {f.label} · {f.team || 'All teams'} · {f.period_days ? `last ${f.period_days} days` : 'all time'} · {f.anonymize ? 'anonymized' : 'with names'}
          {' '}· opened {f.access_count}x{f.last_accessed_at ? ` (last ${f.last_accessed_at.slice(0, 16).replace('T', ' ')} UTC)` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(formula(f))} data-testid={`feed-copy-${f.id}`}><Copy className="w-3.5 h-3.5 mr-1" /> Copy formula</Button>
        <Button size="sm" variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10" onClick={() => onRevoke(f)} data-testid={`feed-revoke-${f.id}`}><Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke</Button>
      </div>
    </div>
    <code className="block text-[11px] bg-black/30 rounded px-2 py-1.5 break-all text-emerald-300" data-testid={`feed-formula-${f.id}`}>{formula(f)}</code>
  </div>
);

export const SheetsLinks = ({ datasets = [], teams = [] }) => {
  const { getAuthHeaders } = useAuth();
  const [feeds, setFeeds] = useState([]);
  const [form, setForm] = useState({ dataset: 'ostrc_responses', team: 'all-teams', window: 'all', anonymize: true, name: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setFeeds((await axios.get(`${API}/research/feeds`, getAuthHeaders())).data); }
    catch (e) { toast.error('Failed to load live links'); }
  }, [getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setSaving(true);
    try {
      const r = await axios.post(`${API}/research/feeds`, {
        dataset: form.dataset, team: form.team === 'all-teams' ? null : form.team, anonymize: form.anonymize,
        period_days: form.window === 'all' ? null : Number(form.window), name: form.name,
      }, getAuthHeaders());
      await copy(formula(r.data));
      setForm((f) => ({ ...f, name: '' }));
      load();
    } catch (e) { toast.error('Failed to create link'); } finally { setSaving(false); }
  };

  const revoke = async (f) => {
    if (!window.confirm('Revoke this link? Sheets using it will stop updating.')) return;
    try { await axios.delete(`${API}/research/feeds/${f.id}`, getAuthHeaders()); toast.success('Link revoked'); load(); }
    catch (e) { toast.error('Failed to revoke'); }
  };

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-4" data-testid="sheets-links">
      <Card className="glass-light border-white/5">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Link2 className="w-4 h-4 text-emerald-400" /> New Google Sheets live link</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={form.dataset} onValueChange={(dataset) => setForm({ ...form, dataset })}>
            <SelectTrigger data-testid="feed-dataset-select"><SelectValue /></SelectTrigger>
            <SelectContent>{datasets.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.team} onValueChange={(team) => setForm({ ...form, team })}>
            <SelectTrigger data-testid="feed-team-select"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all-teams">All teams</SelectItem>{teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.window} onValueChange={(window) => setForm({ ...form, window })}>
            <SelectTrigger data-testid="feed-window-select"><SelectValue /></SelectTrigger>
            <SelectContent>{WINDOWS.map((w) => <SelectItem key={w.v} value={w.v}>{w.l}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Name (optional), e.g. OSTRC study 2026" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="feed-name-input" />
          <label className="flex items-center gap-2 text-xs"><Switch className="shrink-0" checked={form.anonymize} onCheckedChange={(anonymize) => setForm({ ...form, anonymize })} data-testid="feed-anonymize-switch" /> Anonymize (athlete codes)</label>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={create} disabled={saving} data-testid="feed-create-btn"><Plus className="w-4 h-4 mr-1" /> Create link & copy formula</Button>
          <ol className="text-[11px] text-muted-foreground list-decimal pl-4 space-y-1">
            <li>Create the link — the formula is copied automatically.</li>
            <li>Open a Google Sheet and paste it in cell A1.</li>
            <li>Google refreshes it by itself (about every hour). Anyone with the link can read the data — revoke it when no longer needed.</li>
          </ol>
        </CardContent>
      </Card>
      <Card className="glass-light border-white/5 min-w-0">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Active links ({feeds.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {feeds.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8" data-testid="feeds-empty">No live links yet.</p>
            : feeds.map((f) => <FeedRow key={f.id} f={f} onRevoke={revoke} />)}
        </CardContent>
      </Card>
    </div>
  );
};
