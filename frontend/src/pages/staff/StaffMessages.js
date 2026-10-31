import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  ArrowLeft, MessageSquare, Send, HeartPulse, CheckCircle2, Archive, StickyNote, Star, AlertTriangle, Search,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_FILTERS = ['all', 'unread', 'pending', 'replied', 'resolved', 'archived'];
const CATEGORY_FILTERS = ['all', 'question', 'pain', 'guidance', 'feedback', 'training', 'recovery', 'general', 'other'];
const PRIORITY_FILTERS = ['all', 'low', 'normal', 'high', 'urgent'];
const PRIORITY_STYLE = {
  urgent: 'bg-red-500/20 text-red-400', high: 'bg-amber-500/20 text-amber-400',
  normal: 'bg-muted text-muted-foreground', low: 'bg-muted text-muted-foreground',
};
const STATUS_STYLE = {
  pending: 'bg-amber-500/15 text-amber-400', replied: 'bg-sky-500/15 text-sky-400',
  resolved: 'bg-emerald-500/15 text-emerald-400', archived: 'bg-muted text-muted-foreground',
};

export default function StaffMessages() {
  const { id } = useParams();
  if (id) return <StaffConversationView id={id} />;
  return <StaffInbox />;
}

function StaffInbox() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [convs, setConvs] = useState([]);
  const [counts, setCounts] = useState(null);
  const [teams, setTeams] = useState([]);
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [team, setTeam] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (priority !== 'all') params.set('priority', priority);
      if (team !== 'all') params.set('team', team);
      if (q.trim()) params.set('q', q.trim());
      const [c, cnt] = await Promise.all([
        axios.get(`${API}/messages/admin/conversations?${params.toString()}`, getAuthHeaders()),
        axios.get(`${API}/messages/admin/counts`, getAuthHeaders()),
      ]);
      setConvs(c.data || []);
      setCounts(cnt.data);
    } catch (e) {
      if (e.response?.status === 403) { toast.error('Admin only'); navigate('/staff'); }
      else toast.error('Unable to load messages.');
    }
  }, [getAuthHeaders, status, category, priority, team, q, navigate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get(`${API}/staff/athletes`, getAuthHeaders()).then((r) => setTeams([...new Set((r.data || []).map((a) => a.team).filter(Boolean))])).catch(() => {});
  }, [getAuthHeaders]);

  const pill = (active, onClick, label, testid) => (
    <button key={testid} type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition-colors capitalize ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-white/15 text-muted-foreground'}`}
      data-testid={testid}>{label}</button>
  );

  return (
    <div className="min-h-screen bg-background pb-12 overflow-x-hidden" data-testid="staff-messages">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="back-btn"><ArrowLeft className="w-5 h-5" /></Button>
          <div>
            <h1 className="font-heading font-bold text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" /> Athlete Messages</h1>
            <p className="text-xs text-muted-foreground">Inbox & feedback center</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {counts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="message-counts">
            <Card className="glass-light border-white/5"><CardContent className="p-3"><p className="text-xs text-muted-foreground">Unread</p><p className="text-2xl font-bold">{counts.unread}</p></CardContent></Card>
            <Card className="glass-light border-white/5"><CardContent className="p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><HeartPulse className="w-3.5 h-3.5 text-red-400" /> Pain</p><p className="text-2xl font-bold text-red-400">{counts.pain}</p></CardContent></Card>
            <Card className="glass-light border-white/5"><CardContent className="p-3"><p className="text-xs text-muted-foreground">High priority</p><p className="text-2xl font-bold text-amber-400">{counts.high_priority}</p></CardContent></Card>
            <Card className="glass-light border-white/5"><CardContent className="p-3"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold">{counts.pending}</p></CardContent></Card>
          </div>
        )}

        {/* Search + filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search athlete, title..." className="pl-9" data-testid="search-input" />
          </div>
          <div className="flex flex-wrap gap-1.5">{STATUS_FILTERS.map((s) => pill(status === s, () => setStatus(s), s, `status-${s}`))}</div>
          <div className="flex flex-wrap gap-1.5">{CATEGORY_FILTERS.map((c) => pill(category === c, () => setCategory(c), c, `cat-${c}`))}</div>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_FILTERS.map((p) => pill(priority === p, () => setPriority(p), p, `prio-${p}`))}
            {pill(team === 'all', () => setTeam('all'), 'All teams', 'team-all')}
            {teams.map((t) => pill(team === t, () => setTeam(t), t, `team-${t.replace(/\s/g, '-')}`))}
          </div>
        </div>

        {/* List */}
        {convs.length === 0 ? (
          <Card className="glass-light border-white/5"><CardContent className="p-6 text-center text-sm text-muted-foreground">No athlete messages yet.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {convs.map((c) => (
              <Card key={c.id} className={`glass-light border-white/5 cursor-pointer hover:border-primary/30 transition-colors ${c.unread_admin ? 'border-primary/30' : ''}`}
                onClick={() => navigate(`/staff/messages/${c.id}`)} data-testid={`conversation-${c.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    {c.is_pain_related && <HeartPulse className="w-4 h-4 text-red-400 flex-shrink-0" />}
                    <p className="text-sm font-semibold truncate flex-1">{c.athlete_name} <span className="text-xs font-normal text-muted-foreground">· {c.team}</span></p>
                    {c.unread_admin && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-sm truncate">{c.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.last_message_preview}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge className={`text-[10px] ${STATUS_STYLE[c.status] || ''}`}>{c.status}</Badge>
                    <Badge className="text-[10px] capitalize bg-white/5 text-muted-foreground">{c.category}</Badge>
                    {(c.priority === 'high' || c.priority === 'urgent') && <Badge className={`text-[10px] ${PRIORITY_STYLE[c.priority]}`}>{c.priority}</Badge>}
                    <span className="text-[11px] text-muted-foreground ml-auto">{new Date(c.last_message_at).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StaffConversationView({ id }) {
  const navigate = useNavigate();
  const { getAuthHeaders, token } = useAuth();
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/messages/admin/conversations/${id}`, getAuthHeaders());
      setData(res.data);
    } catch (e) {
      if (e.response?.status === 403) navigate('/staff');
      else { toast.error('Conversation not found.'); navigate('/staff/messages'); }
    }
  }, [id, getAuthHeaders, navigate]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error('Action failed.'); } };
  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try { await axios.post(`${API}/messages/admin/conversations/${id}/reply`, { message_body: reply }, getAuthHeaders()); setReply(''); load(); }
    catch (e) { toast.error('Failed to send.'); } finally { setSending(false); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await act(() => axios.post(`${API}/messages/admin/conversations/${id}/internal-note`, { text: note }, getAuthHeaders()), 'Internal note added.');
    setNote('');
  };

  if (!data) return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  const { conversation: c, messages, pain, athlete } = data;

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden" data-testid="staff-conversation">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff/messages')} data-testid="back-btn"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading font-bold text-base truncate flex items-center gap-2">
              {c.is_pain_related && <HeartPulse className="w-4 h-4 text-red-400" />}{c.athlete_name}
            </h1>
            <p className="text-xs text-muted-foreground truncate">{c.title} · {c.category} · {c.priority}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto w-full px-4 py-4 space-y-3 flex-1">
        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {c.status !== 'resolved' && <Button variant="outline" size="sm" onClick={() => act(() => axios.post(`${API}/messages/admin/conversations/${id}/resolve`, {}, getAuthHeaders()), 'Resolved.')} data-testid="resolve-btn"><CheckCircle2 className="w-4 h-4 mr-1" /> Resolve</Button>}
          {c.status !== 'archived' && <Button variant="outline" size="sm" onClick={() => act(() => axios.post(`${API}/messages/admin/conversations/${id}/archive`, {}, getAuthHeaders()), 'Archived.')} data-testid="archive-btn"><Archive className="w-4 h-4 mr-1" /> Archive</Button>}
          <Button variant="outline" size="sm" onClick={() => setShowFeedback(true)} data-testid="feedback-btn"><Star className="w-4 h-4 mr-1" /> Send feedback</Button>
        </div>

        {/* Athlete + pain */}
        {athlete && (
          <Card className="glass-light border-white/5"><CardContent className="p-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>Team: {athlete.team}</span>{athlete.position && <span>Position: {athlete.position}</span>}{athlete.email && <span>{athlete.email}</span>}
          </CardContent></Card>
        )}
        {pain && (
          <Card className="glass-light border-red-400/20" data-testid="pain-details"><CardContent className="p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-red-400 flex items-center gap-1"><HeartPulse className="w-4 h-4" /> Pain report</p>
              {!pain.requires_follow_up && <Button variant="ghost" size="sm" className="h-6 text-amber-400" onClick={() => act(() => axios.post(`${API}/messages/admin/conversations/${id}/pain-followup`, {}, getAuthHeaders()), 'Flagged for follow-up.')} data-testid="followup-btn"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Needs follow-up</Button>}
              {pain.requires_follow_up && <Badge className="text-[10px] bg-amber-500/15 text-amber-400">Follow-up flagged</Badge>}
            </div>
            <p>Region: {pain.body_region} {pain.side ? `(${pain.side})` : ''} · Intensity {pain.pain_intensity}/10</p>
            {pain.onset && <p>Onset: {pain.onset}</p>}
            {pain.trend && <p>Trend: {pain.trend}</p>}
            <p>During training: {pain.occurred_during_training === true ? 'Yes' : pain.occurred_during_training === false ? 'No' : '—'} · Can train: {pain.can_train_normally === true ? 'Yes' : pain.can_train_normally === false ? 'No' : '—'}</p>
            {pain.aggravating_movements && <p>Aggravating: {pain.aggravating_movements}</p>}
          </CardContent></Card>
        )}

        {/* Thread */}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_role === 'staff' ? 'justify-end' : 'justify-start'}`} data-testid={`message-${m.id}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.sender_role === 'staff' ? 'bg-primary text-primary-foreground' : 'bg-white/10'}`}>
              <p className="text-[10px] opacity-70 mb-0.5">{m.sender_name}</p>
              <p className="text-sm whitespace-pre-wrap break-words">{m.message_body}</p>
              {m.attachment_id && <img src={`${API}/messages/attachment/${m.attachment_id}?auth=${token}`} alt="attachment" className="mt-2 rounded-lg max-w-full" />}
              <p className="text-[10px] opacity-60 mt-1">{new Date(m.created_at).toLocaleString()}</p>
            </div>
          </div>
        ))}

        {/* Internal notes */}
        <Card className="glass-light border-amber-400/20"><CardContent className="p-3 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1 text-amber-400"><StickyNote className="w-4 h-4" /> Internal notes (athlete can't see)</p>
          {(c.internal_notes || []).map((n) => (
            <div key={n.id} className="text-xs bg-white/5 rounded p-2"><p>{n.text}</p><p className="text-[10px] text-muted-foreground mt-0.5">{n.author} · {new Date(n.created_at).toLocaleString()}</p></div>
          ))}
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add internal note..." data-testid="note-input" />
            <Button variant="outline" size="sm" onClick={addNote} data-testid="add-note-btn">Add</Button>
          </div>
        </CardContent></Card>
      </main>

      {c.status !== 'resolved' && c.status !== 'archived' && (
        <div className="sticky bottom-0 glass-heavy border-t border-white/10 p-3">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={1} placeholder="Reply to athlete..." className="resize-none" data-testid="reply-input" />
            <Button onClick={sendReply} disabled={sending} data-testid="send-reply-btn"><Send className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {showFeedback && <FeedbackDialog athleteId={c.athlete_id} onClose={() => setShowFeedback(false)} />}
    </div>
  );
}

function FeedbackDialog({ athleteId, onClose }) {
  const { getAuthHeaders } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [pinned, setPinned] = useState(false);
  const [important, setImportant] = useState(false);
  const [sending, setSending] = useState(false);
  const CATS = ['general', 'monitoring', 'pain', 'recovery', 'training', 'guidance'];

  const submit = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Fill title and feedback.'); return; }
    setSending(true);
    try {
      await axios.post(`${API}/messages/admin/feedback`, {
        athlete_id: athleteId, title, feedback_body: body, category,
        pinned_to_profile: pinned, important, send_push: true,
      }, getAuthHeaders());
      toast.success('Feedback sent to athlete.');
      onClose();
    } catch (e) { toast.error('Failed to send feedback.'); } finally { setSending(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="feedback-dialog">
        <DialogHeader><DialogTitle>Send feedback</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Category</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {CATS.map((c) => (
                <button key={c} type="button" onClick={() => setCategory(c)} className={`px-2.5 py-1 rounded-full text-xs border capitalize ${category === c ? 'bg-primary text-primary-foreground border-primary' : 'border-white/15 text-muted-foreground'}`} data-testid={`fb-cat-${c}`}>{c}</button>
              ))}
            </div>
          </div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" data-testid="fb-title-input" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Write feedback..." data-testid="fb-body-input" />
          <div className="flex items-center justify-between"><Label className="text-sm">Pin to profile</Label><Switch checked={pinned} onCheckedChange={setPinned} data-testid="fb-pin-switch" /></div>
          <div className="flex items-center justify-between"><Label className="text-sm">Mark important</Label><Switch checked={important} onCheckedChange={setImportant} data-testid="fb-important-switch" /></div>
          <Button className="w-full" onClick={submit} disabled={sending} data-testid="fb-send-btn"><Star className="w-4 h-4 mr-2" />{sending ? 'Sending...' : 'Send feedback'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
