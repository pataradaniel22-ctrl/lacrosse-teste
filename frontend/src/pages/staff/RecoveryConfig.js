/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '../../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { toast } from 'sonner';
import axios from 'axios';
import {
  ArrowLeft, ShieldCheck, CheckCircle2, X, Clock, Plus, Trash2, Settings, ClipboardCheck,
} from 'lucide-react';

import RecoveryProofsGallery from '../../components/RecoveryProofsGallery';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CAT_STYLE = {
  Gold: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
  Silver: 'bg-slate-400/20 text-slate-700 border-slate-400/50',
  Bronze: 'bg-orange-600/15 text-orange-700 border-orange-700/40',
};
const catStyle = (c) => CAT_STYLE[c] || 'bg-primary/15 text-primary border-primary/40';

export default function RecoveryConfig() {
  const { user, token, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'Admin';

  const [pending, setPending] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [settings, setSettings] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const reqs = [
        axios.get(`${API}/recovery/pending`, getAuthHeaders()),
        axios.get(`${API}/recovery/catalog`, getAuthHeaders()),
        axios.get(`${API}/recovery/settings`, getAuthHeaders()),
      ];
      const [p, c, s] = await Promise.all(reqs);
      setPending(p.data.pending);
      setCatalog(c.data);
      setSettings(s.data);
    } catch (e) {
      toast.error('Failed to load recovery config');
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const review = async (logId, action) => {
    try {
      await axios.post(`${API}/recovery/logs/${logId}/review`, { action }, getAuthHeaders());
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      fetchAll();
    } catch (e) {
      toast.error('Action failed');
    }
  };

  const saveSettings = async (next) => {
    try {
      const res = await axios.put(`${API}/recovery/settings`, next, getAuthHeaders());
      setSettings(res.data);
      toast.success('Settings updated');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Update failed');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="recovery-config-page">
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="recovery-config-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading font-bold text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> Recovery Admin
            </h1>
            <p className="text-xs text-muted-foreground">Approvals, activities & settings</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">
        <Tabs defaultValue="approvals">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="approvals" data-testid="tab-approvals">
              Approvals {pending.length > 0 && <span className="ml-1 px-1.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px]">{pending.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="proofs" data-testid="tab-proofs">Proofs</TabsTrigger>
            <TabsTrigger value="activities" data-testid="tab-activities">Activities</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          {/* APPROVALS */}
          <TabsContent value="approvals" className="space-y-3 mt-4">
            {pending.length === 0 && (
              <Card className="glass-light border-white/5">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <ClipboardCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No pending submissions. {settings?.approval_mode === 'automatic' ? 'Auto-approval is ON.' : ''}
                </CardContent>
              </Card>
            )}
            {pending.map((p) => (
              <Card key={p.id} className="glass-light border-white/5" data-testid={`pending-${p.id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {p.has_proof ? (
                    <a href={`${API}/recovery/files/${p.file_id}?auth=${token}`} target="_blank" rel="noreferrer">
                      <img src={`${API}/recovery/files/${p.file_id}?auth=${token}`} alt="proof" className="w-14 h-14 rounded-lg object-cover border border-white/10" />
                    </a>
                  ) : (
                    <div className="w-14 h-14 rounded-lg border border-white/10 flex items-center justify-center text-muted-foreground"><ShieldCheck className="w-5 h-5" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{p.athlete_name}</span>
                      <Badge variant="outline" className={`text-[10px] ${catStyle(p.category)}`}>{p.category}</Badge>
                    </div>
                    <p className="text-sm">{p.activity_name} <span className="text-emerald-400 font-semibold">+{p.points}</span></p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {p.date} {p.time}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-500" onClick={() => review(p.id, 'approve')} data-testid={`approve-${p.id}`}>
                      <CheckCircle2 className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" className="h-8" onClick={() => review(p.id, 'reject')} data-testid={`reject-${p.id}`}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* PROOFS GALLERY */}
          <TabsContent value="proofs" className="mt-4">
            <RecoveryProofsGallery />
          </TabsContent>

          {/* ACTIVITIES */}
          <TabsContent value="activities" className="space-y-3 mt-4">
            {isAdmin && catalog && (
              <NewActivityDialog catalog={catalog} getAuthHeaders={getAuthHeaders} onDone={fetchAll} />
            )}
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">Only admins can create or edit activities.</p>
            )}
            {(catalog?.categories || []).map((cat) => (
              <div key={cat.id} className="space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mt-3">{cat.name}</h3>
                {(catalog.activities || []).filter((a) => a.category === cat.name).map((a) => (
                  <Card key={a.id} className="glass-light border-white/5" data-testid={`activity-row-${a.id}`}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{a.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className={`text-[10px] ${catStyle(a.category)}`}>{a.category}</Badge>
                          <span className="text-xs text-emerald-400 font-semibold">+{a.points}</span>
                          {!a.is_default && <span className="text-[10px] text-muted-foreground">custom</span>}
                        </div>
                      </div>
                      {isAdmin && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={async () => {
                          try { await axios.delete(`${API}/recovery/activities/${a.id}`, getAuthHeaders()); toast.success('Removed'); fetchAll(); }
                          catch (e) { toast.error('Failed'); }
                        }} data-testid={`del-activity-${a.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </TabsContent>

          {/* SETTINGS */}
          <TabsContent value="settings" className="space-y-4 mt-4">
            {settings && (
              <Card className="glass-light border-white/5">
                <CardContent className="p-4 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Staff approval required</p>
                      <p className="text-xs text-muted-foreground">Off = points awarded automatically</p>
                    </div>
                    <Switch
                      checked={settings.approval_mode === 'manual'}
                      disabled={!isAdmin}
                      onCheckedChange={(v) => saveSettings({ approval_mode: v ? 'manual' : 'automatic', daily_target: settings.daily_target })}
                      data-testid="approval-mode-switch"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Daily target (points)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        defaultValue={settings.daily_target}
                        disabled={!isAdmin}
                        className="w-32"
                        id="daily-target-input"
                        data-testid="daily-target-input"
                      />
                      {isAdmin && (
                        <Button onClick={() => {
                          const v = parseInt(document.getElementById('daily-target-input').value, 10);
                          if (!v || v < 10) { toast.error('Min 10'); return; }
                          saveSettings({ approval_mode: settings.approval_mode, daily_target: v });
                        }} data-testid="save-target-btn">Save</Button>
                      )}
                    </div>
                  </div>
                  {!isAdmin && <p className="text-xs text-muted-foreground">Only admins can change settings.</p>}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function NewActivityDialog({ catalog, getAuthHeaders, onDone }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [points, setPoints] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !category || !points) { toast.error('Fill all fields'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/recovery/activities`, { name: name.trim(), category, points: parseInt(points, 10) }, getAuthHeaders());
      toast.success('Activity created');
      setOpen(false); setName(''); setCategory(''); setPoints('');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" data-testid="new-activity-btn"><Plus className="w-4 h-4 mr-1" /> New Activity</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm" data-testid="new-activity-dialog">
        <DialogHeader><DialogTitle>New Recovery Activity</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ice Bath" data-testid="activity-name-input" />
          </div>
          <div>
            <Label className="text-sm">Category</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); const c = catalog.categories.find((x) => x.name === v); if (c && !points) setPoints(String(c.default_points)); }}>
              <SelectTrigger data-testid="activity-category-select"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {catalog.categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name} ({c.default_points} pts)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Points</Label>
            <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 30" data-testid="activity-points-input" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="w-full" data-testid="save-activity-btn">{saving ? 'Saving...' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
