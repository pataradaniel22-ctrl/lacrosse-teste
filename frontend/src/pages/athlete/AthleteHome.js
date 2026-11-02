import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { toast } from 'sonner';
import axios from 'axios';
import InstallAppModal from '../../components/InstallAppModal';
import HubRequestsBanner from '../../components/hub/HubRequestsBanner';
import { ThemeToggle } from '../../components/ThemeToggle';
import { 
  Sun, 
  Dumbbell, 
  Moon, 
  History, 
  LogOut, 
  Bell,
  Activity,
  TrendingUp,
  User,
  ShieldCheck,
  Flame,
  Trophy,
  Apple,
  HeartPulse,
  Stethoscope,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Settings,
  BellRing,
  ClipboardList,
  Smartphone,
  X
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AthleteHome() {
  const { user, logout, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [recovery, setRecovery] = useState(null);
  const [health, setHealth] = useState(null);
  const [msgUnread, setMsgUnread] = useState(0);
  const [fittest, setFittest] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  // Push notification opt-in banner
  const [pushSubscribed, setPushSubscribed] = useState(true); // assume true to avoid banner flash on load
  const [pushDismissed, setPushDismissed] = useState(() => localStorage.getItem('bl_push_banner_dismissed') === 'true');
  const pushSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !window.MSStream;
  const isStandalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const permissionDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  const dismissPushBanner = () => { localStorage.setItem('bl_push_banner_dismissed', 'true'); setPushDismissed(true); };

  // Pending quick survey (must be answered before daily entries)
  const [pendingSurveys, setPendingSurveys] = useState([]);
  useEffect(() => {
    axios.get(`${API}/surveys/pending`, getAuthHeaders())
      .then((r) => setPendingSurveys(r.data?.surveys || []))
      .catch(() => {});
  }, [getAuthHeaders]);
  const [msgOpen, setMsgOpen] = useState(() => {
    const v = localStorage.getItem('bl_msg_open');
    return v === null ? true : v === 'true';
  });
  const toggleMsg = () => setMsgOpen((prev) => { localStorage.setItem('bl_msg_open', String(!prev)); return !prev; });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, notifRes, recoveryRes, healthRes, msgRes] = await Promise.all([
        axios.get(`${API}/athlete/summary`, getAuthHeaders()),
        axios.get(`${API}/notifications`, getAuthHeaders()),
        axios.get(`${API}/recovery/today`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/health/status`, getAuthHeaders()).catch(() => ({ data: null })),
        axios.get(`${API}/health/athlete/messages`, getAuthHeaders()).catch(() => ({ data: { messages: [] } }))
      ]);
      setSummary(summaryRes.data);
      setNotifications(notifRes.data);
      setUnreadCount(notifRes.data.filter(n => !n.read).length);
      setRecovery(recoveryRes.data);
      setHealth(healthRes.data);
      setMessages((msgRes.data && msgRes.data.messages) || []);
      axios.get(`${API}/messages/athlete/unread-count`, getAuthHeaders())
        .then((r) => setMsgUnread(r.data?.unread || 0)).catch(() => {});
      axios.get(`${API}/fittest/unread-count`, getAuthHeaders())
        .then((r) => setFittest(r.data || null)).catch(() => {});
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Check push subscription state to decide whether to show the opt-in banner
  useEffect(() => {
    axios.get(`${API}/push/preferences`, getAuthHeaders())
      .then((r) => setPushSubscribed(!!(r.data?.subscribed && r.data?.enabled)))
      .catch(() => {});
  }, [getAuthHeaders]);

  // Poll notifications so new staff messages/alerts appear in the bell without a reload
  useEffect(() => {
    const iv = setInterval(() => {
      axios.get(`${API}/notifications`, getAuthHeaders())
        .then((r) => { setNotifications(r.data); setUnreadCount(r.data.filter((n) => !n.read).length); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, [getAuthHeaders]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const markMessageRead = async (noteId) => {
    try {
      await axios.post(`${API}/health/athlete/messages/${noteId}/read`, {}, getAuthHeaders());
      fetchData();
    } catch (e) { /* silent */ }
  };

  const markAllNotificationsRead = async () => {
    const unread = notifications.filter((n) => !n.read && n.id);
    if (unread.length === 0) return;
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await Promise.all(unread.map((n) => axios.put(`${API}/notifications/${n.id}/read`, {}, getAuthHeaders())));
    } catch (e) { /* silent */ }
  };

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text) return;
    const submissionId = messages.find((m) => !m.from_athlete)?.submission_id;
    setSendingReply(true);
    try {
      await axios.post(`${API}/health/athlete/messages/reply`, { text, submission_id: submissionId }, getAuthHeaders());
      setReplyText('');
      toast.success('Reply sent to the medical team');
      fetchData();
    } catch (e) {
      toast.error('Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const healthMandatory = health?.is_mandatory === true;
  // Daily check-in is locked every week until the weekly OSTRC health check is completed
  const healthBlocksDaily = !!health && health.state !== 'completed';
  // "in X days" label for the next weekly health check (Boston day boundary)
  const daysUntilLabel = (dateStr) => {
    if (!dateStr) return '';
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T00:00:00');
    const target = new Date(dateStr + 'T00:00:00');
    const d = Math.round((target - today) / 86400000);
    if (d <= 0) return 'available now';
    if (d === 1) return 'in 1 day';
    return `in ${d} days`;
  };

  const menuItems = [
    {
      title: 'Morning Check-In',
      description: 'Log your readiness and wellness',
      icon: Sun,
      path: '/athlete/morning-check-in',
      color: 'from-amber-500/20 to-orange-500/20',
      iconColor: 'text-amber-400',
      group: 'primary'
    },
    {
      title: 'Training Session',
      description: 'Log load & RPE after each training',
      icon: Dumbbell,
      path: '/athlete/post-training',
      color: 'from-blue-500/20 to-indigo-500/20',
      iconColor: 'text-blue-400',
      group: 'primary'
    },
    {
      title: 'Recovery Points',
      description: 'Earn points & build recovery habits',
      icon: ShieldCheck,
      path: '/athlete/recovery',
      color: 'from-emerald-500/20 to-teal-500/20',
      iconColor: 'text-emerald-400',
      group: 'primary'
    },
    {
      title: 'Nutrition & Hydration',
      shortTitle: 'Nutrition',
      description: 'Calculate your macros & hydration plan',
      icon: Apple,
      path: '/athlete/nutrition',
      color: 'from-lime-500/20 to-green-500/20',
      iconColor: 'text-lime-400',
      group: 'secondary'
    },
    {
      title: 'Messages',
      shortTitle: 'Messages',
      description: 'Ask staff, report pain & get feedback',
      icon: MessageSquare,
      path: '/athlete/messages',
      color: 'from-sky-500/20 to-cyan-500/20',
      iconColor: 'text-sky-400',
      group: 'secondary'
    },
    {
      title: 'My History',
      shortTitle: 'History',
      description: 'View your progress over time',
      icon: History,
      path: '/athlete/history',
      color: 'from-emerald-500/20 to-teal-500/20',
      iconColor: 'text-emerald-400',
      group: 'secondary'
    },
    {
      title: 'Reminders & Notifications',
      shortTitle: 'Reminders',
      description: 'Schedule daily check-in reminders on your phone',
      icon: BellRing,
      path: '/athlete/notifications',
      color: 'from-fuchsia-500/20 to-purple-500/20',
      iconColor: 'text-fuchsia-400',
      group: 'secondary'
    }
  ];
  const primaryItems = menuItems.filter((m) => m.group === 'primary');
  const secondaryItems = menuItems.filter((m) => m.group === 'secondary');

  return (
    <div className="min-h-screen bg-background" data-testid="athlete-home">
      <InstallAppModal />
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/brazil-lacrosse-logo.png" 
              alt="Brasil Lacrosse"
              className="w-10 h-10 object-contain"
            />
            <div>
              <h1 className="font-heading font-bold text-lg">{user?.name}</h1>
              <p className="text-xs text-muted-foreground">{user?.team}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => navigate('/athlete/the-fittest')}
              data-testid="the-fittest-top-btn"
              aria-label="The Fittest"
            >
              <Flame className="w-5 h-5 text-orange-400" />
              {fittest?.count > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-orange-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {fittest.count > 9 ? '9+' : fittest.count}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => navigate('/athlete/messages')}
              data-testid="messages-btn"
            >
              <MessageSquare className="w-5 h-5" />
              {msgUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                  {msgUnread}
                </span>
              )}
            </Button>
            <Popover onOpenChange={(o) => { if (o) markAllNotificationsRead(); }}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  data-testid="notifications-btn"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-[10px] flex items-center justify-center font-bold">
                      {unreadCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0" data-testid="notifications-popover">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <p className="font-semibold text-sm">Notifications</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => navigate('/athlete/notifications')}
                    data-testid="notifications-settings-link"
                  >
                    <Settings className="w-3.5 h-3.5 mr-1" /> Settings
                  </Button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">
                      You're all caught up.
                    </div>
                  ) : (
                    notifications.map((n, i) => (
                      <div
                        key={n.id || i}
                        className={`px-4 py-3 border-b border-white/5 last:border-0 ${n.url ? 'cursor-pointer hover:bg-white/5' : ''}`}
                        onClick={() => { if (n.url) navigate(n.url); }}
                        data-testid={`notification-item-${i}`}
                      >
                        <p className="text-sm font-medium">{n.title || n.type || 'Notification'}</p>
                        {(n.message || n.description) && (
                          <p className="text-xs text-muted-foreground mt-0.5">{n.message || n.description}</p>
                        )}
                        {n.created_at && (
                          <p className="text-[11px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Link to="/athlete/profile">
              {user?.profile_photo ? (
                <img 
                  src={user.profile_photo.startsWith('http') ? user.profile_photo : `${process.env.REACT_APP_BACKEND_URL}${user.profile_photo}`}
                  alt={user.name}
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/20 hover:border-primary/50 transition-colors"
                />
              ) : (
                <Button variant="ghost" size="icon" data-testid="profile-btn">
                  <User className="w-5 h-5" />
                </Button>
              )}
            </Link>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleLogout}
              data-testid="logout-btn"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        <HubRequestsBanner getAuthHeaders={getAuthHeaders} />
        {/* Pending quick survey */}
        {pendingSurveys.length > 0 && (
          <Card className="border-fuchsia-500/40 bg-fuchsia-500/10 animate-fade-in" data-testid="pending-survey-banner">
            <CardContent className="p-4 flex items-start gap-3">
              <ClipboardList className="w-5 h-5 text-fuchsia-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-heading font-bold text-sm">Quick survey to complete</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingSurveys[0].title}. Please answer it — it's required before your daily check-in and training log.
                </p>
                <Button
                  size="sm"
                  className="h-7 text-xs mt-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                  onClick={() => navigate('/athlete/survey')}
                  data-testid="answer-survey-btn"
                >
                  Answer now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Enable phone notifications banner */}
        {pushSupported && !pushSubscribed && !pushDismissed && !permissionDenied && (
          <Card className="border-primary/30 bg-primary/5 animate-fade-in" data-testid="enable-push-banner">
            <CardContent className="p-4 flex items-start gap-3">
              <BellRing className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-heading font-bold text-sm">Turn on phone notifications</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get check-in reminders and messages from the staff delivered to your phone.
                </p>
                {isIOS && !isStandalone && (
                  <p className="text-[11px] text-amber-400 mt-1.5 flex items-start gap-1" data-testid="ios-push-hint">
                    <Smartphone className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>On iPhone: first add the app to your Home Screen (Share → &quot;Add to Home Screen&quot;), then open it from there to enable notifications.</span>
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => navigate('/athlete/notifications')}
                    data-testid="enable-push-banner-btn"
                  >
                    Enable notifications
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={dismissPushBanner}
                    data-testid="dismiss-push-banner-btn"
                  >
                    Not now
                  </Button>
                </div>
              </div>
              <button
                onClick={dismissPushBanner}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                data-testid="close-push-banner-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </CardContent>
          </Card>
        )}

        {/* Medical team messages */}
        {messages.length > 0 && (
          <Card className="border-cyan-500/30 bg-cyan-500/5 animate-fade-in" data-testid="medical-messages-card">
            <CardContent className="p-4">
              <button
                type="button"
                onClick={toggleMsg}
                className="w-full flex items-center gap-2 mb-1"
                data-testid="medical-messages-toggle"
                aria-expanded={msgOpen}
              >
                <Stethoscope className="w-5 h-5 text-cyan-400 shrink-0" />
                <h3 className="font-heading font-bold text-foreground text-sm">Messages from the Medical Team</h3>
                {(() => {
                  const unread = messages.filter((m) => !m.from_athlete && !m.read_at).length;
                  return unread > 0 ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500 text-white" data-testid="medical-messages-unread">{unread}</span>
                  ) : null;
                })()}
                <span className="ml-auto text-muted-foreground">
                  {msgOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>
              {!msgOpen && (
                <p className="text-[11px] text-muted-foreground">
                  {messages.length} message{messages.length > 1 ? 's' : ''} · tap to open
                </p>
              )}
              {msgOpen && (<>
              <div className="space-y-2 mt-2">
                {[...messages].reverse().map((m) => (
                  <div
                    className={`p-3 rounded-lg border ${m.from_athlete ? 'bg-emerald-500/10 border-emerald-500/20 ml-6' : 'bg-background/40 border-cyan-500/15 mr-6'}`}
                    key={m.id}
                    data-testid={`medical-message-${m.id}`}
                  >
                    <p className="text-sm text-foreground">{m.text}</p>
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        {m.from_athlete ? 'You' : `— ${m.from}`} · {m.date?.slice(0, 10)}
                      </p>
                      {!m.from_athlete && (
                        m.read_at ? (
                          <span className="text-[10px] text-emerald-400" data-testid={`message-read-${m.id}`}>✓ Read</span>
                        ) : (
                          <button
                            onClick={() => markMessageRead(m.id)}
                            className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                            data-testid={`message-confirm-read-${m.id}`}
                          >
                            Confirm read
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply or ask the medical team a question…"
                  className="min-h-[60px] text-sm bg-background/40"
                  data-testid="message-reply-input"
                />
                <Button
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-700 self-end"
                  disabled={sendingReply || !replyText.trim()}
                  onClick={sendReply}
                  data-testid="message-reply-send"
                >
                  Send reply
                </Button>
              </div>
              </>)}
            </CardContent>
          </Card>
        )}

        {/* The Fittest — social challenge */}
        <Link to="/athlete/the-fittest" className="block animate-fade-in" data-testid="the-fittest-home-card">
          <Card className="border-orange-500/30 hover:border-orange-500/50 transition-all hover:scale-[1.01] active:scale-[0.99] overflow-hidden">
            <CardContent className="p-4 relative">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/15 to-amber-500/5" />
              <div className="relative flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
                  <Flame className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-heading font-bold text-foreground">The Fittest</h3>
                    {fittest?.count > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center" data-testid="the-fittest-badge">
                        {fittest.count > 99 ? '99+' : fittest.count}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {fittest?.has_active_challenge
                      ? 'Post your check-ins and climb the leaderboard'
                      : 'Team check-ins & recovery challenge'}
                  </p>
                </div>
                <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Recovery Points Hero */}
        {recovery && (
          <Link to="/athlete/recovery" className="block animate-fade-in" data-testid="recovery-hero-card">
            <Card className="glass-light border-emerald-500/20 hover:border-emerald-500/40 transition-all hover:scale-[1.01] active:scale-[0.99] overflow-hidden">
              <CardContent className="p-4 relative">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-teal-500/5" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Recovery Points
                    </span>
                    {recovery.goal_achieved ? (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                        <Trophy className="w-3 h-3 mr-1" /> Goal Achieved
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{recovery.remaining} to goal</span>
                    )}
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="flex items-end gap-1.5">
                      <span className="text-3xl font-heading font-black text-emerald-400">{recovery.points}</span>
                      <span className="text-base text-muted-foreground mb-0.5">/ {recovery.target}</span>
                    </div>
                    <div className="flex items-center gap-1 text-orange-400">
                      <Flame className="w-4 h-4" />
                      <span className="font-bold">{recovery.streak}</span>
                      <span className="text-xs text-muted-foreground">day streak</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden mt-2.5">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                      style={{ width: `${Math.min(100, Math.round((recovery.points / recovery.target) * 100))}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Weekly Health Check */}
        {health && (
          <Link
            to="/athlete/health-check"
            className="block animate-fade-in"
            data-testid="weekly-health-card"
            onClick={(e) => { if (health.state === 'completed') { e.preventDefault(); navigate('/athlete/health-check'); } }}
          >
            <Card className={`glass-light overflow-hidden ${
              health.state === 'overdue' ? 'border-orange-500/40'
                : health.state === 'ready' ? 'border-cyan-500/40'
                : health.state === 'postponed' ? 'border-yellow-500/30'
                : 'border-white/5'}`}>
              <CardContent className="p-4 relative">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center ${
                    health.state === 'overdue' ? 'text-orange-400' : health.state === 'completed' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                    <HeartPulse className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading font-bold text-foreground">Weekly Health Check</h3>
                      {health.state === 'overdue' && <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40 text-[10px]">Required</Badge>}
                      {health.state === 'ready' && <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-[10px]">Ready</Badge>}
                      {health.state === 'completed' && <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">Completed</Badge>}
                      {health.state === 'postponed' && <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40 text-[10px]">Postponed</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {health.state === 'completed'
                        ? (health.next_available_date
                            ? `Done ✓ Daily check-in unlocked · next health check ${daysUntilLabel(health.next_available_date)} (${health.next_available_date})`
                            : 'All done for this week · daily check-in unlocked')
                        : health.state === 'overdue'
                          ? 'Complete this to unlock your daily check-in'
                          : 'Takes less than 2 minutes'}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Stats Cards */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Readiness</span>
                </div>
                <p className="text-2xl font-heading font-bold text-foreground">
                  {summary.last_7_days_avg_readiness.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">7-day average</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Recovery</span>
                </div>
                <p className="text-2xl font-heading font-bold text-foreground">
                  {recovery?.streak ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(recovery?.streak ?? 0) === 1 ? 'day streak' : 'day streak'}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recovery Points Hero (moved above Weekly Health Check) */}

        {/* Primary actions — large cards */}
        <div className="space-y-3">
          {primaryItems.map((item, index) => {
            const gated = (healthBlocksDaily && item.path === '/athlete/morning-check-in')
              || (healthMandatory && item.path === '/athlete/post-training');
            const handleClick = (e) => {
              if (gated) {
                e.preventDefault();
                toast.warning('Please complete your Weekly Health Check first.');
                navigate('/athlete/health-check');
              }
            };
            return (
            <Link 
              key={item.path} 
              to={gated ? '/athlete/health-check' : item.path}
              onClick={handleClick}
              className="block animate-fade-in"
              style={{ animationDelay: `${index * 100}ms` }}
              data-testid={`menu-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Card className={`glass-light border-white/5 hover:border-primary/30 transition-all hover:scale-[1.02] active:scale-[0.98] ${gated ? 'opacity-50' : ''}`}>
                <CardContent className="p-4">
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-br ${item.color} opacity-50`} />
                  <div className="relative flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center ${item.iconColor}`}>
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-heading font-bold text-foreground">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{gated ? 'Locked until Weekly Health Check is complete' : item.description}</p>
                    </div>
                    <div className="text-muted-foreground">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
            );
          })}
        </div>

        {/* Secondary actions — compact icon tiles */}
        <div className="pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">More</p>
          <div className="grid grid-cols-4 gap-2.5">
            {secondaryItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="block animate-fade-in"
                data-testid={`menu-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Card className="glass-light border-white/5 hover:border-primary/30 transition-all hover:scale-[1.03] active:scale-[0.97] h-full">
                  <CardContent className="p-3 flex flex-col items-center justify-center gap-1.5 text-center">
                    <div className={`w-10 h-10 rounded-xl bg-background/50 flex items-center justify-center ${item.iconColor}`}>
                      <item.icon className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-medium text-foreground leading-tight">{item.shortTitle || item.title}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Team Badge */}
        <div className="text-center pt-6">
          <Badge variant="outline" className="px-4 py-2 border-primary/30 text-primary">
            {user?.team}
          </Badge>
        </div>
      </main>
    </div>
  );
}
