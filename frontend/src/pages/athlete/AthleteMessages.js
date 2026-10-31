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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  ArrowLeft, MessageSquare, Plus, Send, HeartPulse, AlertTriangle, CheckCircle2, Image as ImageIcon, Star, Pin,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const REASONS = [
  { value: 'question', label: 'I have a question' },
  { value: 'pain', label: 'Report pain / discomfort' },
  { value: 'guidance', label: 'I need guidance' },
  { value: 'feedback', label: 'I want feedback' },
  { value: 'training', label: 'Training-related' },
  { value: 'recovery', label: 'Recovery-related' },
  { value: 'other', label: 'Other' },
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const REGIONS = ['Neck', 'Shoulder', 'Elbow', 'WristHand', 'LowBack', 'HipGroin', 'Knee', 'AnkleFoot', 'Other'];
const SIDES = ['Left', 'Right', 'Both', 'N/A'];
const TRENDS = ['improving', 'worsening', 'same'];
const QUICK_PAIN = ['New pain', 'Pain got worse', 'Pain after training', 'Pain during training', 'Same pain as before', 'Should I train?'];
const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'question', label: 'Questions' },
  { value: 'pain', label: 'Pain' }, { value: 'feedback', label: 'Feedback' }, { value: 'resolved', label: 'Resolved' },
];

const STATUS_LABEL = { sent: 'Sent', read: 'Read', staff_replied: 'Staff replied', resolved: 'Resolved' };
const STATUS_STYLE = {
  sent: 'bg-muted text-muted-foreground',
  read: 'bg-sky-500/15 text-sky-400',
  staff_replied: 'bg-primary/20 text-primary',
  resolved: 'bg-emerald-500/15 text-emerald-400',
};

export default function AthleteMessages() {
  const { id } = useParams();
  if (id) return <ConversationView id={id} />;
  return <MessagesList />;
}

function MessagesList() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [convs, setConvs] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([
        axios.get(`${API}/messages/athlete/conversations?filter=${filter}`, getAuthHeaders()),
        axios.get(`${API}/messages/athlete/feedback`, getAuthHeaders()),
      ]);
      setConvs(c.data || []);
      setFeedback(f.data || []);
    } catch (e) { toast.error('Unable to load messages. Please try again.'); }
  }, [getAuthHeaders, filter]);

  useEffect(() => { load(); }, [load]);

  const markFeedbackRead = async (fb) => {
    if (fb.read_at) return;
    try { await axios.post(`${API}/messages/athlete/feedback/${fb.id}/read`, {}, getAuthHeaders()); load(); } catch (e) {}
  };

  return (
    <div className="min-h-screen bg-background pb-12 overflow-x-hidden" data-testid="athlete-messages">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/athlete')} data-testid="back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-heading font-bold text-lg flex items-center gap-2"><MessageSquare className="w-5 h-5 text-sky-400" /> Messages</h1>
            <p className="text-xs text-muted-foreground">Talk to the staff</p>
          </div>
          <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-message-btn"><Plus className="w-4 h-4 mr-1" /> New</Button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 space-y-5">
        {/* Staff feedback */}
        {feedback.length > 0 && (
          <div className="space-y-2" data-testid="feedback-section">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Staff Feedback</p>
            {feedback.map((fb) => (
              <Card key={fb.id} className={`glass-light border-white/5 ${!fb.read_at ? 'border-primary/30' : ''}`} onClick={() => markFeedbackRead(fb)} data-testid={`feedback-${fb.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {fb.pinned_to_profile && <Pin className="w-3.5 h-3.5 text-amber-400" />}
                    {fb.important && <Star className="w-3.5 h-3.5 text-amber-400" />}
                    <p className="text-sm font-medium">{fb.title}</p>
                    {!fb.read_at && <span className="ml-auto w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{fb.feedback_body}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{fb.admin_name} · {new Date(fb.created_at).toLocaleDateString()}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'border-white/15 text-muted-foreground'}`}
              data-testid={`filter-${f.value}`}>{f.label}</button>
          ))}
        </div>

        {/* Conversations */}
        {convs.length === 0 ? (
          <Card className="glass-light border-white/5"><CardContent className="p-6 text-center text-sm text-muted-foreground">
            No messages yet. Send a message to staff if you have a question or need support.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {convs.map((c) => (
              <Card key={c.id} className="glass-light border-white/5 cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => navigate(`/athlete/messages/${c.id}`)} data-testid={`conversation-${c.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    {c.is_pain_related && <HeartPulse className="w-4 h-4 text-red-400 flex-shrink-0" />}
                    <p className="text-sm font-medium truncate flex-1">{c.title}</p>
                    {c.unread_athlete && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.last_message_preview}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className={`text-[10px] ${STATUS_STYLE[c.athlete_status] || ''}`}>{STATUS_LABEL[c.athlete_status] || c.athlete_status}</Badge>
                    {(c.priority === 'high' || c.priority === 'urgent') && <Badge className="text-[10px] bg-amber-500/15 text-amber-400">{c.priority}</Badge>}
                    <span className="text-[11px] text-muted-foreground ml-auto">{new Date(c.last_message_at).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {showNew && <NewMessageDialog onClose={() => setShowNew(false)} onSent={(cid) => { setShowNew(false); navigate(`/athlete/messages/${cid}`); }} />}
    </div>
  );
}

function NewMessageDialog({ onClose, onSent }) {
  const { getAuthHeaders } = useAuth();
  const [category, setCategory] = useState('question');
  const [title, setTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [attachmentId, setAttachmentId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  // pain
  const [region, setRegion] = useState('');
  const [side, setSide] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [onset, setOnset] = useState('');
  const [trend, setTrend] = useState('');
  const [duringTraining, setDuringTraining] = useState(null);
  const [canTrain, setCanTrain] = useState(null);
  const [aggravating, setAggravating] = useState('');

  const isPain = category === 'pain';

  const chip = (active, onClick, label, testid) => (
    <button key={testid} type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-white/15 text-muted-foreground'}`}
      data-testid={testid}>{label}</button>
  );

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await axios.post(`${API}/messages/attachment`, fd, { ...getAuthHeaders(), headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' } });
      setAttachmentId(res.data.attachment_id);
      toast.success('Image attached.');
    } catch (err) { toast.error('Failed to attach image.'); } finally { setUploading(false); }
  };

  const submit = async () => {
    if (!title.trim()) { toast.error('Add a short title.'); return; }
    if (!messageBody.trim()) { toast.error('Write your message.'); return; }
    setSending(true);
    try {
      const payload = { category, title, message_body: messageBody, priority, attachment_id: attachmentId };
      if (isPain) {
        payload.pain = {
          body_region: region || null, side: side || null, pain_intensity: Number(intensity),
          onset: onset || null, trend: trend || null,
          occurred_during_training: duringTraining, can_train_normally: canTrain,
          aggravating_movements: aggravating || null,
        };
      }
      const res = await axios.post(`${API}/messages/athlete/conversations`, payload, getAuthHeaders());
      toast.success('Message sent. Staff will review and respond as soon as possible.');
      onSent(res.data.id);
    } catch (e) { toast.error('Failed to send message.'); } finally { setSending(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="new-message-dialog">
        <DialogHeader><DialogTitle>New message</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Reason</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {REASONS.map((r) => chip(category === r.value, () => setCategory(r.value), r.label, `reason-${r.value}`))}
            </div>
          </div>

          {isPain && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PAIN.map((q) => chip(title === q, () => setTitle(q), q, `quickpain-${q.replace(/[^a-z]/gi, '')}`))}
              </div>
              <Card className="border-amber-400/30 bg-amber-400/5"><CardContent className="p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs">This does not replace a medical evaluation. If symptoms are severe or urgent, contact the medical staff directly.</p>
              </CardContent></Card>
            </>
          )}

          <div>
            <Label className="text-xs">Short title</Label>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pain in right knee" className="mt-1" data-testid="msg-title-input" />
          </div>

          {isPain && (
            <div className="space-y-3 p-3 rounded-lg bg-white/5 border border-white/5">
              <div>
                <Label className="text-xs">Body region</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">{REGIONS.map((r) => chip(region === r, () => setRegion(r), r, `region-${r}`))}</div>
              </div>
              <div>
                <Label className="text-xs">Side</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">{SIDES.map((s) => chip(side === s, () => setSide(s), s, `side-${s.replace(/[^a-z]/gi, '')}`))}</div>
              </div>
              <div>
                <Label className="text-xs">Pain intensity: <span className="text-foreground font-semibold">{intensity}/10</span></Label>
                <input type="range" min="0" max="10" value={intensity} onChange={(e) => setIntensity(e.target.value)} className="w-full mt-1 accent-red-500" data-testid="intensity-slider" />
              </div>
              <div>
                <Label className="text-xs">When did it start?</Label>
                <Input value={onset} onChange={(e) => setOnset(e.target.value)} placeholder="e.g. 2 days ago" className="mt-1" data-testid="onset-input" />
              </div>
              <div>
                <Label className="text-xs">Trend</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">{TRENDS.map((t) => chip(trend === t, () => setTrend(t), t, `trend-${t}`))}</div>
              </div>
              <div>
                <Label className="text-xs">Happened during training/match?</Label>
                <div className="flex gap-1.5 mt-1">
                  {chip(duringTraining === true, () => setDuringTraining(true), 'Yes', 'during-yes')}
                  {chip(duringTraining === false, () => setDuringTraining(false), 'No', 'during-no')}
                </div>
              </div>
              <div>
                <Label className="text-xs">Can you train normally?</Label>
                <div className="flex gap-1.5 mt-1">
                  {chip(canTrain === true, () => setCanTrain(true), 'Yes', 'cantrain-yes')}
                  {chip(canTrain === false, () => setCanTrain(false), 'No', 'cantrain-no')}
                </div>
              </div>
              <div>
                <Label className="text-xs">Any movement that makes it worse?</Label>
                <Input value={aggravating} onChange={(e) => setAggravating(e.target.value)} placeholder="e.g. squatting" className="mt-1" data-testid="aggravating-input" />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">{isPain ? 'Describe what you are feeling' : 'Message'}</Label>
            <Textarea value={messageBody} maxLength={4000} onChange={(e) => setMessageBody(e.target.value)} rows={4} className="mt-1" data-testid="msg-body-input" />
          </div>

          <div>
            <Label className="text-xs">Priority</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">{PRIORITIES.map((p) => chip(priority === p, () => setPriority(p), p, `priority-${p}`))}</div>
            {priority === 'urgent' && (
              <p className="text-[11px] text-amber-400 mt-1">If this is an emergency, contact local emergency services or your medical staff directly. This messaging system is not monitored 24/7.</p>
            )}
          </div>

          <div>
            <input id="msg-attach" type="file" accept="image/*" className="hidden" onChange={uploadImage} data-testid="attach-input" />
            <label htmlFor="msg-attach">
              <Button asChild variant="outline" size="sm" className="w-full cursor-pointer" disabled={uploading}>
                <span><ImageIcon className="w-4 h-4 mr-2" />{uploading ? 'Uploading...' : attachmentId ? 'Image attached ✓' : 'Attach image (optional)'}</span>
              </Button>
            </label>
          </div>

          <Button className="w-full" onClick={submit} disabled={sending} data-testid="send-message-btn">
            <Send className="w-4 h-4 mr-2" />{sending ? 'Sending...' : 'Send to staff'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConversationView({ id }) {
  const navigate = useNavigate();
  const { getAuthHeaders, token } = useAuth();
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/messages/athlete/conversations/${id}`, getAuthHeaders());
      setData(res.data);
    } catch (e) { toast.error('Conversation not found.'); navigate('/athlete/messages'); }
  }, [id, getAuthHeaders, navigate]);

  useEffect(() => { load(); }, [load]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await axios.post(`${API}/messages/athlete/conversations/${id}/reply`, { message_body: reply }, getAuthHeaders());
      setReply(''); load();
    } catch (e) { toast.error('Failed to send.'); } finally { setSending(false); }
  };

  const resolve = async () => {
    try { await axios.post(`${API}/messages/athlete/conversations/${id}/resolve`, {}, getAuthHeaders()); toast.success('Marked as resolved.'); load(); } catch (e) { toast.error('Failed.'); }
  };

  if (!data) return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  const { conversation: c, messages, pain } = data;

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden" data-testid="athlete-conversation">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/athlete/messages')} data-testid="back-btn"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading font-bold text-base truncate flex items-center gap-2">
              {c.is_pain_related && <HeartPulse className="w-4 h-4 text-red-400" />}{c.title}
            </h1>
            <p className="text-xs text-muted-foreground">{STATUS_LABEL[c.athlete_status] || c.athlete_status}</p>
          </div>
          {c.status !== 'resolved' && <Button variant="outline" size="sm" onClick={resolve} data-testid="resolve-btn"><CheckCircle2 className="w-4 h-4 mr-1" /> Resolve</Button>}
        </div>
      </header>

      <main className="max-w-md mx-auto w-full px-4 py-4 space-y-3 flex-1">
        {pain && (
          <Card className="glass-light border-red-400/20"><CardContent className="p-3 text-xs space-y-1">
            <p className="font-semibold text-red-400">Pain details</p>
            <p>{pain.body_region} {pain.side ? `· ${pain.side}` : ''} · Intensity {pain.pain_intensity}/10</p>
            {pain.trend && <p>Trend: {pain.trend}</p>}
          </CardContent></Card>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_role === 'athlete' ? 'justify-end' : 'justify-start'}`} data-testid={`message-${m.id}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.sender_role === 'athlete' ? 'bg-primary text-primary-foreground' : 'bg-white/10'}`}>
              <p className="text-[10px] opacity-70 mb-0.5">{m.sender_name}</p>
              <p className="text-sm whitespace-pre-wrap break-words">{m.message_body}</p>
              {m.attachment_id && (
                <img src={`${API}/messages/attachment/${m.attachment_id}?auth=${token}`} alt="attachment" className="mt-2 rounded-lg max-w-full" />
              )}
              <p className="text-[10px] opacity-60 mt-1">{new Date(m.created_at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </main>

      {c.status !== 'resolved' && (
        <div className="sticky bottom-0 glass-heavy border-t border-white/10 p-3">
          <div className="max-w-md mx-auto flex gap-2">
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={1} placeholder="Write a reply..." className="resize-none" data-testid="reply-input" />
            <Button onClick={sendReply} disabled={sending} data-testid="send-reply-btn"><Send className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
