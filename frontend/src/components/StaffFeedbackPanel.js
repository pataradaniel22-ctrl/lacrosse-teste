import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { Star, Pin, Plus, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CATS = ['general', 'monitoring', 'pain', 'recovery', 'training', 'guidance'];

export default function StaffFeedbackPanel({ athleteId }) {
  const { getAuthHeaders } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [pinned, setPinned] = useState(false);
  const [important, setImportant] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/messages/admin/athlete/${athleteId}/feedback`, getAuthHeaders());
      setItems(r.data || []);
    } catch (e) { /* ignore */ }
  }, [athleteId, getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Fill title and feedback.'); return; }
    setSending(true);
    try {
      await axios.post(`${API}/messages/admin/feedback`, {
        athlete_id: athleteId, title, feedback_body: body, category,
        pinned_to_profile: pinned, important, send_push: true,
      }, getAuthHeaders());
      toast.success('Feedback sent to athlete.');
      setTitle(''); setBody(''); setPinned(false); setImportant(false); setOpen(false);
      load();
    } catch (e) { toast.error('Failed to send feedback.'); } finally { setSending(false); }
  };

  return (
    <Card className="glass-light border-white/5 mb-6" data-testid="staff-feedback-panel">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-5 h-5 text-sky-400" /> Staff Feedback</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} data-testid="profile-feedback-toggle"><Plus className="w-4 h-4 mr-1" /> Feedback</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && (
          <div className="p-3 rounded-lg bg-white/5 border border-primary/20 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {CATS.map((c) => (
                <button key={c} type="button" onClick={() => setCategory(c)} className={`px-2.5 py-1 rounded-full text-xs border capitalize ${category === c ? 'bg-primary text-primary-foreground border-primary' : 'border-white/15 text-muted-foreground'}`} data-testid={`pf-cat-${c}`}>{c}</button>
              ))}
            </div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" data-testid="pf-title-input" />
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Write feedback..." data-testid="pf-body-input" />
            <div className="flex items-center justify-between"><Label className="text-sm">Pin to profile</Label><Switch checked={pinned} onCheckedChange={setPinned} data-testid="pf-pin-switch" /></div>
            <div className="flex items-center justify-between"><Label className="text-sm">Mark important</Label><Switch checked={important} onCheckedChange={setImportant} data-testid="pf-important-switch" /></div>
            <Button className="w-full" onClick={submit} disabled={sending} data-testid="pf-send-btn"><Star className="w-4 h-4 mr-2" />{sending ? 'Sending...' : 'Send feedback'}</Button>
          </div>
        )}
        {items.length === 0 && !open && <p className="text-sm text-muted-foreground">No feedback sent yet.</p>}
        {items.map((fb) => (
          <div key={fb.id} className="p-3 rounded-lg bg-white/5 border border-white/5" data-testid={`profile-feedback-${fb.id}`}>
            <div className="flex items-center gap-2">
              {fb.pinned_to_profile && <Pin className="w-3.5 h-3.5 text-amber-400" />}
              {fb.important && <Star className="w-3.5 h-3.5 text-amber-400" />}
              <p className="text-sm font-medium">{fb.title}</p>
              <Badge className="text-[10px] capitalize bg-white/5 text-muted-foreground ml-auto">{fb.category}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{fb.feedback_body}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{fb.admin_name} · {new Date(fb.created_at).toLocaleDateString()} · {fb.read_at ? 'Read' : 'Unread'}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
