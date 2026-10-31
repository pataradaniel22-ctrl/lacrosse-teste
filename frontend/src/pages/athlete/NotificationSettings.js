import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { ArrowLeft, Bell, BellOff, BellRing, Smartphone, Info, ShieldCheck, Plus, Trash2, Pencil, Clock, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const WEEKDAYS = [
  { i: 0, label: 'Mon' }, { i: 1, label: 'Tue' }, { i: 2, label: 'Wed' },
  { i: 3, label: 'Thu' }, { i: 4, label: 'Fri' }, { i: 5, label: 'Sat' }, { i: 6, label: 'Sun' },
];
const DEEP_LINKS = [
  { url: '/athlete', label: 'Home' },
  { url: '/athlete/morning-check-in', label: 'Morning Check-in' },
  { url: '/athlete/post-training', label: 'Training Log' },
  { url: '/athlete/recovery', label: 'Recovery' },
  { url: '/athlete/nutrition', label: 'Nutrition' },
  { url: '/athlete/health-check', label: 'Health Check' },
];

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Convert URL-safe base64 VAPID public key into Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectPlatform() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return { iOS, standalone };
}

export default function NotificationSettings() {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [morningTime, setMorningTime] = useState('08:00');
  const [eveningTime, setEveningTime] = useState('21:00');
  const [recoveryEnabled, setRecoveryEnabled] = useState(true);
  const [recoveryTime, setRecoveryTime] = useState('19:00');
  const [reminders, setReminders] = useState([]);
  const [editing, setEditing] = useState(null); // reminder object or 'new' or null
  const [form, setForm] = useState({ title: '', body: '', time: '12:00', days: [], url: '/athlete', enabled: true });
  const platform = detectPlatform();

  const loadReminders = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/notifications/reminders`, getAuthHeaders());
      setReminders(res.data || []);
    } catch (e) { /* ignore */ }
  }, [getAuthHeaders]);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/push/preferences`, getAuthHeaders());
      setSubscribed(!!res.data.subscribed);
      setEnabled(!!res.data.enabled);
      setMorningTime(res.data.morning_time || '08:00');
      setEveningTime(res.data.evening_time || '21:00');
      setRecoveryEnabled(res.data.recovery_enabled !== false);
      setRecoveryTime(res.data.recovery_time || '19:00');
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setSupported(false);
      setLoading(false);
      return;
    }
    setPermission(Notification.permission);
    loadPrefs();
    loadReminders();
  }, [loadPrefs, loadReminders]);

  const enablePush = async () => {
    if (!supported) {
      toast.error('Your browser does not support push notifications.');
      return;
    }
    if (platform.iOS && !platform.standalone) {
      toast.error('On iOS, first add the app to your home screen to enable notifications.');
      return;
    }
    setSaving(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        toast.error('Notification permission denied.');
        setSaving(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // Get VAPID public key from server
      const keyRes = await axios.get(`${API}/push/vapid-public-key`);
      const publicKey = keyRes.data.public_key;
      // Create push subscription
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const subJson = sub.toJSON();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      await axios.post(
        `${API}/push/subscribe`,
        {
          endpoint: subJson.endpoint,
          keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
          timezone,
        },
        getAuthHeaders()
      );
      setSubscribed(true);
      setEnabled(true);
      toast.success('Notifications enabled!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to enable notifications. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const disablePush = async () => {
    setSaving(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await axios.delete(`${API}/push/unsubscribe`, getAuthHeaders());
      setSubscribed(false);
      setEnabled(false);
      toast.success('Notifications disabled.');
    } catch (e) {
      toast.error('Error disabling.');
    } finally {
      setSaving(false);
    }
  };

  const savePrefs = async (next = {}) => {
    if (!subscribed) return;
    setSaving(true);
    try {
      await axios.put(
        `${API}/push/preferences`,
        {
          enabled: next.enabled ?? enabled,
          morning_time: next.morning_time ?? morningTime,
          evening_time: next.evening_time ?? eveningTime,
          recovery_enabled: next.recovery_enabled ?? recoveryEnabled,
          recovery_time: next.recovery_time ?? recoveryTime,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        },
        getAuthHeaders()
      );
      toast.success('Preferences saved.');
    } catch (e) {
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    try {
      await axios.post(`${API}/push/test`, {}, getAuthHeaders());
      toast.success('Test notification sent!');
    } catch (e) {
      toast.error('Failed to send the test. Re-enable notifications.');
    }
  };

  const openNew = () => {
    setForm({ title: '', body: '', time: '12:00', days: [], url: '/athlete', enabled: true });
    setEditing('new');
  };
  const openEdit = (r) => {
    setForm({ title: r.title, body: r.body || '', time: r.time, days: r.days || [], url: r.url || '/athlete', enabled: r.enabled });
    setEditing(r);
  };
  const toggleDay = (i) => {
    setForm((f) => ({ ...f, days: f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i].sort((a, b) => a - b) }));
  };
  const saveReminder = async () => {
    if (!form.title.trim()) { toast.error('Give your reminder a title.'); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        await axios.post(`${API}/notifications/reminders`, form, getAuthHeaders());
        toast.success('Reminder created.');
      } else {
        await axios.put(`${API}/notifications/reminders/${editing.id}`, form, getAuthHeaders());
        toast.success('Reminder updated.');
      }
      setEditing(null);
      loadReminders();
    } catch (e) {
      toast.error('Failed to save reminder.');
    } finally { setSaving(false); }
  };
  const toggleReminderEnabled = async (r, v) => {
    try {
      await axios.put(`${API}/notifications/reminders/${r.id}`, { ...r, enabled: v }, getAuthHeaders());
      setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)));
    } catch (e) { toast.error('Failed to update.'); }
  };
  const deleteReminder = async (r) => {
    try {
      await axios.delete(`${API}/notifications/reminders/${r.id}`, getAuthHeaders());
      setReminders((prev) => prev.filter((x) => x.id !== r.id));
      toast.success('Reminder removed.');
    } catch (e) { toast.error('Failed to remove.'); }
  };
  const daysLabel = (days) => {
    if (!days || days.length === 0 || days.length === 7) return 'Every day';
    return days.map((d) => WEEKDAYS[d].label).join(', ');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12" data-testid="notification-settings">
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/athlete')} data-testid="back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading font-bold text-lg">Notifications</h1>
            <p className="text-xs text-muted-foreground">Check-in reminders</p>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {!supported && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4 flex gap-3">
              <BellOff className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm">Your browser does not support push notifications. Use Chrome, Edge, Firefox or Safari 16.4+.</p>
            </CardContent>
          </Card>
        )}

        {supported && platform.iOS && !platform.standalone && (
          <Card className="border-amber-400/30 bg-amber-400/5">
            <CardContent className="p-4 flex gap-3">
              <Smartphone className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-semibold">On iOS, install the app first:</p>
                <ol className="list-decimal ml-5 text-muted-foreground text-xs space-y-1">
                  <li>Tap the Share button in Safari</li>
                  <li>Tap &quot;Add to Home Screen&quot;</li>
                  <li>Open the app from the home screen and come back here</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status / Subscribe toggle */}
        <Card className="glass-light border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="w-5 h-5 text-primary" />
              Push notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!subscribed ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Get reminders so you don't forget your check-in and training log.
                </p>
                <Button
                  className="w-full"
                  onClick={enablePush}
                  disabled={saving || !supported || (platform.iOS && !platform.standalone)}
                  data-testid="enable-push-btn"
                >
                  <BellRing className="w-4 h-4 mr-2" />
                  {saving ? 'Enabling...' : 'Enable notifications'}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Receive reminders</Label>
                    <p className="text-xs text-muted-foreground">Enable/disable without losing the configuration</p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => { setEnabled(v); savePrefs({ enabled: v }); }}
                    data-testid="enabled-switch"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={disablePush}
                  disabled={saving}
                  data-testid="disable-push-btn"
                >
                  <BellOff className="w-4 h-4 mr-2" />
                  Disable and remove device
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Schedule */}
        {subscribed && (
          <Card className="glass-light border-white/5">
            <CardHeader>
              <CardTitle className="text-base">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="morning" className="text-sm">Morning reminder (check-in)</Label>
                <Input
                  id="morning"
                  type="time"
                  value={morningTime}
                  onChange={(e) => setMorningTime(e.target.value)}
                  onBlur={(e) => { if (e.target.value !== morningTime || true) savePrefs({ morning_time: e.target.value }); }}
                  className="mt-1"
                  data-testid="morning-time-input"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sent only if you haven't done your check-in for the day yet.
                </p>
              </div>
              <div>
                <Label htmlFor="evening" className="text-sm">Evening reminder (training)</Label>
                <Input
                  id="evening"
                  type="time"
                  value={eveningTime}
                  onChange={(e) => setEveningTime(e.target.value)}
                  onBlur={(e) => savePrefs({ evening_time: e.target.value })}
                  className="mt-1"
                  data-testid="evening-time-input"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sent only if you haven't logged training today.
                </p>
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="recovery" className="text-sm flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" /> Recovery reminder
                  </Label>
                  <Switch
                    checked={recoveryEnabled}
                    onCheckedChange={(v) => { setRecoveryEnabled(v); savePrefs({ recovery_enabled: v }); }}
                    data-testid="recovery-enabled-switch"
                  />
                </div>
                <Input
                  id="recovery"
                  type="time"
                  value={recoveryTime}
                  disabled={!recoveryEnabled}
                  onChange={(e) => setRecoveryTime(e.target.value)}
                  onBlur={(e) => savePrefs({ recovery_time: e.target.value })}
                  className="mt-1"
                  data-testid="recovery-time-input"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sent only if you haven't reached your daily recovery points goal.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={sendTest}
                data-testid="test-push-btn"
              >
                Send test notification
              </Button>
            </CardContent>
          </Card>
        )}

        {/* My custom reminders */}
        {subscribed && (
          <Card className="glass-light border-white/5" data-testid="custom-reminders-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> My reminders
              </CardTitle>
              <Button size="sm" variant="outline" onClick={openNew} data-testid="add-reminder-btn">
                <Plus className="w-4 h-4 mr-1" /> New
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {reminders.length === 0 && editing === null && (
                <p className="text-sm text-muted-foreground">
                  Create your own reminders — e.g. "Drink water" at 14:00 or "Stretch" every evening.
                </p>
              )}

              {reminders.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-lg bg-white/5 border border-white/5"
                  data-testid={`reminder-item-${r.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.time} · {daysLabel(r.days)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) => toggleReminderEnabled(r, v)}
                      data-testid={`reminder-toggle-${r.id}`}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} data-testid={`reminder-edit-${r.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteReminder(r)} data-testid={`reminder-delete-${r.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Editor */}
              {editing !== null && (
                <div className="p-3 rounded-lg bg-white/5 border border-primary/20 space-y-3" data-testid="reminder-editor">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{editing === 'new' ? 'New reminder' : 'Edit reminder'}</p>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)} data-testid="reminder-cancel-btn">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input
                      value={form.title}
                      maxLength={80}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g. Drink water"
                      className="mt-1"
                      data-testid="reminder-title-input"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Message (optional)</Label>
                    <Input
                      value={form.body}
                      maxLength={200}
                      onChange={(e) => setForm({ ...form, body: e.target.value })}
                      placeholder="e.g. Stay hydrated!"
                      className="mt-1"
                      data-testid="reminder-body-input"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Time</Label>
                    <Input
                      type="time"
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                      className="mt-1"
                      data-testid="reminder-time-input"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Repeat on</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {WEEKDAYS.map((d) => (
                        <button
                          key={d.i}
                          type="button"
                          onClick={() => toggleDay(d.i)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            form.days.includes(d.i)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-transparent border-white/15 text-muted-foreground'
                          }`}
                          data-testid={`reminder-day-${d.i}`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Leave empty for every day.</p>
                  </div>
                  <div>
                    <Label className="text-xs">Opens</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {DEEP_LINKS.map((l) => (
                        <button
                          key={l.url}
                          type="button"
                          onClick={() => setForm({ ...form, url: l.url })}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            form.url === l.url
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-transparent border-white/15 text-muted-foreground'
                          }`}
                          data-testid={`reminder-link-${l.url.replace(/\//g, '-')}`}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button className="w-full" onClick={saveReminder} disabled={saving} data-testid="reminder-save-btn">
                    {saving ? 'Saving...' : 'Save reminder'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="glass-light border-white/5">
          <CardContent className="p-4 flex gap-3">
            <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Notification permission: <span className="text-foreground font-medium">{permission}</span>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
