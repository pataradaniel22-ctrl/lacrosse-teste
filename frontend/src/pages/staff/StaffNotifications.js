import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Badge } from '../../components/ui/badge';
import {
  ArrowLeft, Send, Users, Clock, Trash2, BellRing, CheckCircle2, CalendarClock, Signal,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DEEP_LINKS = [
  { url: '/athlete', label: 'Home' },
  { url: '/athlete/morning-check-in', label: 'Morning Check-in' },
  { url: '/athlete/post-training', label: 'Training Log' },
  { url: '/athlete/recovery', label: 'Recovery' },
  { url: '/athlete/health-check', label: 'Health Check' },
];

const STATUS_STYLES = {
  sent: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  scheduled: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  cancelled: 'bg-muted text-muted-foreground border-white/10',
};

export default function StaffNotifications() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [athletes, setAthletes] = useState([]);
  const [teams, setTeams] = useState([]);
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [sending, setSending] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/athlete');
  const [targetType, setTargetType] = useState('all');
  const [targetTeam, setTargetTeam] = useState('');
  const [selectedAthletes, setSelectedAthletes] = useState([]);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  const load = useCallback(async () => {
    try {
      const [aRes, hRes, anRes] = await Promise.all([
        axios.get(`${API}/staff/athletes`, getAuthHeaders()),
        axios.get(`${API}/staff/notifications`, getAuthHeaders()),
        axios.get(`${API}/staff/notifications/analytics`, getAuthHeaders()),
      ]);
      const ath = aRes.data || [];
      setAthletes(ath);
      setTeams([...new Set(ath.map((a) => a.team).filter(Boolean))]);
      setHistory(hRes.data || []);
      setAnalytics(anRes.data);
    } catch (e) {
      toast.error('Failed to load notifications.');
    }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  const toggleAthlete = (id) => {
    setSelectedAthletes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const resetForm = () => {
    setTitle(''); setBody(''); setUrl('/athlete'); setTargetType('all');
    setTargetTeam(''); setSelectedAthletes([]); setScheduleOn(false); setScheduledAt('');
  };

  const send = async () => {
    if (!title.trim()) { toast.error('Add a title.'); return; }
    if (targetType === 'team' && !targetTeam) { toast.error('Pick a team.'); return; }
    if (targetType === 'athletes' && selectedAthletes.length === 0) { toast.error('Select at least one athlete.'); return; }
    let iso = null;
    if (scheduleOn) {
      if (!scheduledAt) { toast.error('Pick a date and time.'); return; }
      const dt = new Date(scheduledAt);
      if (isNaN(dt.getTime())) { toast.error('Invalid date.'); return; }
      iso = dt.toISOString();
    }
    setSending(true);
    try {
      const payload = {
        title, body, url,
        target_type: targetType,
        target_team: targetType === 'team' ? targetTeam : null,
        target_athlete_ids: targetType === 'athletes' ? selectedAthletes : [],
        scheduled_at: iso,
      };
      const res = await axios.post(`${API}/staff/notifications`, payload, getAuthHeaders());
      if (res.data.status === 'sent') {
        toast.success(`Sent to ${res.data.delivered_count}/${res.data.target_count} athletes.`);
      } else {
        toast.success('Notification scheduled.');
      }
      resetForm();
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send.');
    } finally { setSending(false); }
  };

  const cancel = async (n) => {
    try {
      await axios.delete(`${API}/staff/notifications/${n.id}`, getAuthHeaders());
      toast.success('Scheduled notification cancelled.');
      load();
    } catch (e) { toast.error('Failed to cancel.'); }
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  const chip = (active, onClick, label, testid) => (
    <button
      key={testid}
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent border-white/15 text-muted-foreground hover:border-white/30'
      }`}
      data-testid={testid}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-background pb-12 overflow-x-hidden" data-testid="staff-notifications">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading font-bold text-lg flex items-center gap-2">
              <BellRing className="w-5 h-5 text-primary" /> Notifications
            </h1>
            <p className="text-xs text-muted-foreground">Send push messages to athletes</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Analytics */}
        {analytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="notification-analytics">
            <Card className="glass-light border-white/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Signal className="w-3.5 h-3.5" /> Push coverage</div>
                <p className="text-xl font-bold mt-1">{analytics.coverage_pct}%</p>
                <p className="text-[11px] text-muted-foreground">{analytics.active_subscribers}/{analytics.total_athletes} devices</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="w-3.5 h-3.5" /> Delivery rate</div>
                <p className="text-xl font-bold mt-1">{analytics.delivery_rate_pct}%</p>
                <p className="text-[11px] text-muted-foreground">{analytics.total_delivered}/{analytics.total_targeted} delivered</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Send className="w-3.5 h-3.5" /> Sent</div>
                <p className="text-xl font-bold mt-1">{analytics.notifications_sent}</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="w-3.5 h-3.5" /> Scheduled</div>
                <p className="text-xl font-bold mt-1">{analytics.notifications_scheduled}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {analytics && (
          <p className="text-[11px] text-muted-foreground -mt-1" data-testid="delivery-note">
            Every message is delivered in-app to the athlete's notification bell. Push coverage shows how many also get an OS push (athletes who enabled notifications on their device) — it's an optional bonus channel.
          </p>
        )}
        <Card className="glass-light border-white/5" data-testid="notification-composer">
          <CardHeader><CardTitle className="text-base">New notification</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Training moved to 6pm" className="mt-1" data-testid="notif-title-input" />
            </div>
            <div>
              <Label className="text-xs">Message</Label>
              <Input value={body} maxLength={300} onChange={(e) => setBody(e.target.value)} placeholder="Optional details" className="mt-1" data-testid="notif-body-input" />
            </div>

            <div>
              <Label className="text-xs">Opens when tapped</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DEEP_LINKS.map((l) => chip(url === l.url, () => setUrl(l.url), l.label, `notif-link-${l.url.replace(/\//g, '-')}`))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Send to</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {chip(targetType === 'all', () => setTargetType('all'), 'All athletes', 'target-all')}
                {chip(targetType === 'team', () => setTargetType('team'), 'By team', 'target-team')}
                {chip(targetType === 'athletes', () => setTargetType('athletes'), 'Specific athletes', 'target-athletes')}
              </div>
            </div>

            {targetType === 'team' && (
              <div className="flex flex-wrap gap-1.5">
                {teams.map((t) => chip(targetTeam === t, () => setTargetTeam(t), t, `team-${t.replace(/\s/g, '-')}`))}
              </div>
            )}

            {targetType === 'athletes' && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5" data-testid="athlete-picker">
                {athletes.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAthlete(a.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${selectedAthletes.includes(a.id) ? 'bg-primary/10' : 'hover:bg-white/5'}`}
                    data-testid={`athlete-option-${a.id}`}
                  >
                    <span className="truncate">{a.name} <span className="text-xs text-muted-foreground">· {a.team}</span></span>
                    {selectedAthletes.includes(a.id) && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                  </button>
                ))}
                {athletes.length === 0 && <p className="p-3 text-sm text-muted-foreground">No athletes found.</p>}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <Label className="text-sm flex items-center gap-1.5"><Clock className="w-4 h-4" /> Schedule for later</Label>
              <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} data-testid="schedule-switch" />
            </div>
            {scheduleOn && (
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} data-testid="schedule-input" />
            )}

            <Button className="w-full" onClick={send} disabled={sending} data-testid="send-notification-btn">
              <Send className="w-4 h-4 mr-2" />
              {sending ? 'Working...' : scheduleOn ? 'Schedule notification' : 'Send now'}
            </Button>
          </CardContent>
        </Card>

        {/* History */}
        <Card className="glass-light border-white/5" data-testid="notification-history">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 && <p className="text-sm text-muted-foreground">No notifications yet.</p>}
            {history.map((n) => (
              <div key={n.id} className="p-3 rounded-lg bg-white/5 border border-white/5" data-testid={`history-item-${n.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground truncate">{n.body}</p>}
                  </div>
                  <Badge className={`flex-shrink-0 border ${STATUS_STYLES[n.status] || ''}`}>{n.status}</Badge>
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                  <span>By {n.created_by_name}</span>
                  <span>Target: {n.target_type}{n.target_team ? ` (${n.target_team})` : ''}</span>
                  {n.status === 'sent' && <span>Delivered {n.delivered_count}/{n.target_count}</span>}
                  {n.status === 'scheduled' && <span>For {fmt(n.scheduled_at)}</span>}
                  {n.status === 'sent' && <span>at {fmt(n.sent_at)}</span>}
                  {n.status === 'scheduled' && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => cancel(n)} data-testid={`cancel-${n.id}`}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
