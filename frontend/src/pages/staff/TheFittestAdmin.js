import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Flame, Plus, Trophy, Users, Camera, ShieldCheck, Dumbbell,
  Flag, Trash2, EyeOff, Medal, Loader2, CheckCircle2, Archive, Pencil, Download, MessageSquare,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TEAMS = ['Brazil Lacrosse Men', 'Brazil Lacrosse Women'];
const EMOJIS = ['🔥', '💪', '👏', '⚡', '✅', '🏆', '🙌', '🇧🇷', '🥍', '❗'];
const teamShort = (t) => (t || '').replace('Brazil Lacrosse ', '') || '—';
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function TheFittestAdmin() {
  const { user, getAuthHeaders, token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [overview, setOverview] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [feed, setFeed] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [reported, setReported] = useState([]);
  const [engagement, setEngagement] = useState(null);
  const [settings, setSettings] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null); // leaderboard row

  const loadEngagement = async () => {
    if (!selectedId) return;
    try { const res = await axios.get(`${API}/fittest/admin/engagement?challenge_id=${selectedId}`, getAuthHeaders()); setEngagement(res.data); } catch (e) { setEngagement(null); }
  };
  const loadSettings = async () => {
    try { const res = await axios.get(`${API}/fittest/admin/settings`, getAuthHeaders()); setSettings(res.data); } catch (e) { /* */ }
  };
  const saveSetting = async (patch) => {
    try {
      const res = await axios.put(`${API}/fittest/admin/settings`, patch, getAuthHeaders());
      setSettings(res.data);
      toast.success('Settings updated');
    } catch (e) { toast.error('Could not save settings'); }
  };
  const exportCsv = async () => {
    if (!selectedId) return;
    try {
      const res = await axios.get(`${API}/fittest/admin/leaderboard/export?challenge_id=${selectedId}`, { ...getAuthHeaders(), responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `the_fittest_${(selected?.title || 'challenge').replace(/\s+/g, '_')}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error('Could not export CSV'); }
  };

  const photoUrl = (id) => `${API}/fittest/photo/${id}?auth=${token}`;

  const loadChallenges = useCallback(async () => {
    const res = await axios.get(`${API}/fittest/admin/challenges`, getAuthHeaders());
    const list = res.data.challenges || [];
    setChallenges(list);
    setSelectedId((cur) => cur || (list.find((c) => c.status === 'active') || list[0])?.id || null);
    return list;
  }, [getAuthHeaders]);

  const loadOverview = useCallback(async (cid) => {
    const res = await axios.get(`${API}/fittest/admin/overview${cid ? `?challenge_id=${cid}` : ''}`, getAuthHeaders());
    setOverview(res.data);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (user && user.role !== 'Admin') { navigate('/staff'); return; }
    (async () => {
      setLoading(true);
      const list = await loadChallenges();
      const cid = (list.find((c) => c.status === 'active') || list[0])?.id;
      if (cid) await loadOverview(cid);
      setLoading(false);
    })();
  }, [user, navigate, loadChallenges, loadOverview]);

  const selectChallenge = async (cid) => {
    setSelectedId(cid);
    await loadOverview(cid);
  };

  const loadFeed = async () => {
    if (!selectedId) return;
    const res = await axios.get(`${API}/fittest/feed?challenge_id=${selectedId}`, getAuthHeaders());
    setFeed(res.data.posts || []);
  };
  const loadLeaderboard = async () => {
    if (!selectedId) return;
    const res = await axios.get(`${API}/fittest/leaderboard?challenge_id=${selectedId}`, getAuthHeaders());
    setLeaderboard(res.data.leaderboard || []);
  };
  const loadReported = async () => {
    const res = await axios.get(`${API}/fittest/admin/reported`, getAuthHeaders());
    setReported(res.data.reports || []);
  };

  const moderate = async (postId, action) => {
    const reason = action === 'restore' ? '' : (window.prompt(`Reason for ${action}?`) ?? '');
    try {
      await axios.post(`${API}/fittest/admin/posts/${postId}/moderate`, { action, reason }, getAuthHeaders());
      toast.success(`Post ${action}d`);
      await Promise.all([loadFeed(), loadReported(), loadOverview(selectedId)]);
    } catch (e) { toast.error('Action failed'); }
  };

  const finishChallenge = async (cid) => {
    if (!window.confirm('Finish this challenge and lock the winner?')) return;
    const res = await axios.post(`${API}/fittest/admin/challenges/${cid}/finish`, {}, getAuthHeaders());
    toast.success(res.data.winner ? `Winner: ${res.data.winner.name} (${res.data.winner.points} pts)` : 'Challenge finished');
    await loadChallenges();
    await loadOverview(cid);
  };
  const archiveChallenge = async (cid) => {
    if (!window.confirm('Archive this challenge?')) return;
    await axios.post(`${API}/fittest/admin/challenges/${cid}/archive`, {}, getAuthHeaders());
    toast.success('Archived');
    await loadChallenges();
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-400" /></div>;
  }

  const selected = challenges.find((c) => c.id === selectedId);

  return (
    <div className="min-h-screen bg-background pb-16" data-testid="the-fittest-admin-page">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/staff')} data-testid="admin-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Flame className="w-6 h-6 text-orange-400" />
          <div className="flex-1">
            <h1 className="font-heading font-black text-lg text-foreground leading-none">The Fittest Management</h1>
            <p className="text-[11px] text-muted-foreground">Challenges · Feed · Leaderboard · Moderation</p>
          </div>
          <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => { setEditing(null); setShowForm(true); }} data-testid="new-challenge-btn">
            <Plus className="w-4 h-4 mr-1" /> New Challenge
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* challenge selector */}
        {challenges.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={selectedId || ''} onValueChange={selectChallenge}>
              <SelectTrigger className="w-full sm:w-96" data-testid="challenge-selector"><SelectValue placeholder="Select a challenge" /></SelectTrigger>
              <SelectContent>
                {challenges.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title} · {c.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {challenges.length === 0 ? (
          <Card className="glass-light border-white/5"><CardContent className="p-10 text-center space-y-2">
            <Flame className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="font-semibold text-foreground">No challenges yet.</p>
            <p className="text-sm text-muted-foreground">Create your first The Fittest challenge to get athletes competing.</p>
            <Button className="bg-orange-500 hover:bg-orange-600 mt-2" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4 mr-1" /> New Challenge</Button>
          </CardContent></Card>
        ) : (
          <Tabs defaultValue="overview" onValueChange={(v) => { if (v === 'feed') loadFeed(); if (v === 'leaderboard') loadLeaderboard(); if (v === 'reported') loadReported(); if (v === 'engagement') loadEngagement(); if (v === 'settings') loadSettings(); }}>
            <TabsList className="flex w-full overflow-x-auto justify-start" data-testid="admin-tabs">
              <TabsTrigger value="overview" className="shrink-0" data-testid="admin-tab-overview">Overview</TabsTrigger>
              <TabsTrigger value="challenges" className="shrink-0" data-testid="admin-tab-challenges">Challenges</TabsTrigger>
              <TabsTrigger value="feed" className="shrink-0" data-testid="admin-tab-feed">Feed</TabsTrigger>
              <TabsTrigger value="leaderboard" className="shrink-0" data-testid="admin-tab-leaderboard">Ranking</TabsTrigger>
              <TabsTrigger value="engagement" className="shrink-0" data-testid="admin-tab-engagement">Engagement</TabsTrigger>
              <TabsTrigger value="reported" className="shrink-0" data-testid="admin-tab-reported">Reports</TabsTrigger>
              <TabsTrigger value="settings" className="shrink-0" data-testid="admin-tab-settings">Settings</TabsTrigger>
            </TabsList>

            {/* OVERVIEW */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {overview?.challenge ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Days left" value={overview.days_left} icon={Trophy} color="text-amber-400" />
                    <StatCard label="Posts today" value={overview.posts_today} icon={Camera} color="text-sky-400" />
                    <StatCard label="Total posts" value={overview.posts_total} icon={Flame} color="text-orange-400" />
                    <StatCard label="Active today" value={overview.active_today} icon={Users} color="text-emerald-400" />
                    <StatCard label="Training pts" value={overview.training_checkins} icon={Dumbbell} color="text-sky-400" />
                    <StatCard label="Recovery pts" value={overview.complete_recoveries} icon={ShieldCheck} color="text-emerald-400" />
                    <StatCard label="Participants" value={overview.total_participants} icon={Users} color="text-foreground/80" />
                    <StatCard label="Open reports" value={overview.reported_open} icon={Flag} color="text-red-400" />
                  </div>
                  <Card className="glass-light border-white/5">
                    <CardContent className="p-4">
                      <p className="text-sm font-semibold text-foreground mb-3">Top 10 — Overall (both teams)</p>
                      <div className="space-y-2">
                        {(overview.top10 || []).map((r) => (
                          <div key={r.athlete_id} className="flex items-center gap-3">
                            <span className={`w-6 text-center font-heading font-black ${r.rank <= 3 ? 'text-orange-400' : 'text-muted-foreground'}`}>{r.rank}</span>
                            <span className="flex-1 text-sm text-foreground truncate">{r.name} <span className="text-muted-foreground text-xs">· {teamShort(r.team)}</span></span>
                            <span className="text-xs text-muted-foreground">{r.training_checkins}🏋️ {r.recoveries}🛡️</span>
                            <span className="font-heading font-bold text-orange-400 w-10 text-right">{r.points}</span>
                          </div>
                        ))}
                        {(overview.top10 || []).length === 0 && <p className="text-sm text-muted-foreground">No points yet.</p>}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : <p className="text-sm text-muted-foreground">No active challenge selected.</p>}
            </TabsContent>

            {/* CHALLENGES */}
            <TabsContent value="challenges" className="mt-4 space-y-3">
              {challenges.map((c) => (
                <Card key={c.id} className="glass-light border-white/5" data-testid={`challenge-item-${c.id}`}>
                  <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground truncate">{c.title}</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">{c.start_date} → {c.end_date} · {(c.included_teams || []).length ? c.included_teams.map(teamShort).join(' + ') : 'Both teams'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setShowForm(true); }} data-testid={`edit-challenge-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                      {c.status !== 'finished' && c.status !== 'archived' && (
                        <Button variant="ghost" size="sm" className="text-emerald-400" onClick={() => finishChallenge(c.id)} data-testid={`finish-challenge-${c.id}`}><CheckCircle2 className="w-4 h-4 mr-1" />Finish</Button>
                      )}
                      {c.status !== 'archived' && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => archiveChallenge(c.id)} data-testid={`archive-challenge-${c.id}`}><Archive className="w-4 h-4" /></Button>
                      )}
                    </div>
                    {c.winner_athlete_id && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]"><Trophy className="w-3 h-3 mr-1" />Winner locked</Badge>}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* FEED MODERATION */}
            <TabsContent value="feed" className="mt-4 space-y-3">
              {feed.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No posts to moderate.</p> : feed.map((p) => (
                <AdminFeedPost key={p.id} post={p} photoUrl={photoUrl} getAuthHeaders={getAuthHeaders} onModerate={moderate} />
              ))}
            </TabsContent>

            {/* LEADERBOARD */}
            <TabsContent value="leaderboard" className="mt-4 space-y-2" data-testid="admin-leaderboard">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="border-white/10" onClick={exportCsv} data-testid="export-csv-btn"><Download className="w-4 h-4 mr-1" />Export CSV</Button>
              </div>
              {leaderboard.map((r) => (
                <div key={r.athlete_id} className="flex items-center gap-3 rounded-xl p-3 border border-white/5 bg-white/[0.02]">
                  <div className={`w-7 text-center font-heading font-black ${r.rank <= 3 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                    {r.rank <= 3 ? <Medal className="w-5 h-5 mx-auto" /> : r.rank}
                  </div>
                  <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-foreground shrink-0">{initials(r.name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{teamShort(r.team)} · {r.training_checkins}🏋️ · {r.recoveries}🛡️</p>
                  </div>
                  <div className="text-right"><p className="font-heading font-black text-orange-400">{r.points}</p><p className="text-[10px] text-muted-foreground">pts</p></div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-orange-400" onClick={() => setAdjustFor(r)} data-testid={`adjust-points-${r.athlete_id}`}><Pencil className="w-4 h-4" /></Button>
                </div>
              ))}
              {leaderboard.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No points yet.</p>}
            </TabsContent>

            {/* ENGAGEMENT */}
            <TabsContent value="engagement" className="mt-4 space-y-4" data-testid="admin-engagement">
              {!engagement ? <p className="text-sm text-muted-foreground text-center py-6">Loading engagement...</p> : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="Posts" value={engagement.totals.posts} icon={Camera} color="text-sky-400" />
                    <StatCard label="Comments" value={engagement.totals.comments} icon={Flag} color="text-emerald-400" />
                    <StatCard label="Reactions" value={engagement.totals.reactions} icon={Flame} color="text-orange-400" />
                  </div>
                  <Card className="glass-light border-white/5"><CardContent className="p-4">
                    <p className="text-sm font-semibold text-foreground mb-3">Activity (last 14 days)</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={engagement.series} margin={{ left: -20, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(d) => d.slice(5)} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <RTooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="posts" stroke="#38bdf8" strokeWidth={2} dot={false} name="Posts" />
                        <Line type="monotone" dataKey="comments" stroke="#34d399" strokeWidth={2} dot={false} name="Comments" />
                        <Line type="monotone" dataKey="reactions" stroke="#fb923c" strokeWidth={2} dot={false} name="Reactions" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent></Card>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card className="glass-light border-white/5"><CardContent className="p-4">
                      <p className="text-sm font-semibold text-foreground mb-2">Top posters</p>
                      {engagement.top_posters.length === 0 ? <p className="text-xs text-muted-foreground">No posts yet.</p> :
                        engagement.top_posters.map((t, i) => (
                          <div key={t.athlete_id} className="flex items-center justify-between py-1 text-sm">
                            <span className="text-foreground truncate">{i + 1}. {t.name} <span className="text-muted-foreground text-xs">· {teamShort(t.team)}</span></span>
                            <span className="text-orange-400 font-semibold">{t.posts}</span>
                          </div>
                        ))}
                    </CardContent></Card>
                    <Card className="glass-light border-white/5"><CardContent className="p-4">
                      <p className="text-sm font-semibold text-foreground mb-2">No posts yet ({engagement.no_posts.length})</p>
                      <div className="max-h-40 overflow-y-auto">
                        {engagement.no_posts.length === 0 ? <p className="text-xs text-emerald-400">Everyone has posted! 🎉</p> :
                          engagement.no_posts.map((a) => (
                            <p key={a.athlete_id} className="text-xs text-muted-foreground py-0.5">{a.name} · {teamShort(a.team)}</p>
                          ))}
                      </div>
                    </CardContent></Card>
                  </div>
                  <Card className="glass-light border-white/5"><CardContent className="p-4">
                    <p className="text-sm font-semibold text-foreground mb-2">Participation by team</p>
                    {engagement.participation_by_team.map((t) => (
                      <div key={t.team} className="flex items-center justify-between text-sm py-1">
                        <span className="text-foreground">{teamShort(t.team)}</span>
                        <span className="text-muted-foreground">{t.posts} posts</span>
                      </div>
                    ))}
                  </CardContent></Card>
                </>
              )}
            </TabsContent>

            {/* SETTINGS */}
            <TabsContent value="settings" className="mt-4 space-y-3" data-testid="admin-settings">
              {!settings ? <p className="text-sm text-muted-foreground text-center py-6">Loading settings...</p> : (
                <>
                  <SettingRow label="Enable The Fittest" hint="Master switch — turns the feature on/off for all athletes." checked={settings.is_enabled} onChange={(v) => saveSetting({ is_enabled: v })} testid="setting-enabled" />
                  <SettingRow label="Require photo to publish" hint="Athletes must attach a photo to post (recommended)." checked={settings.require_photo_to_publish} onChange={(v) => saveSetting({ require_photo_to_publish: v })} testid="setting-require-photo" />
                  <SettingRow label="Watermark photos" hint="Adds a discreet 'AMS Brasil Lacrosse' mark to posted photos." checked={settings.watermark_enabled} onChange={(v) => saveSetting({ watermark_enabled: v })} testid="setting-watermark" />
                  <SettingRow label="Allow gallery upload" hint="Let athletes pick photos from their gallery." checked={settings.allow_gallery_upload} onChange={(v) => saveSetting({ allow_gallery_upload: v })} testid="setting-gallery" />
                  <SettingRow label="Allow camera" hint="Let athletes take a photo with the camera." checked={settings.allow_camera_upload} onChange={(v) => saveSetting({ allow_camera_upload: v })} testid="setting-camera" />
                  <Card className="glass-light border-white/5"><CardContent className="p-4 flex items-center justify-between gap-3">
                    <div><p className="text-sm font-medium text-foreground">Badge counter</p><p className="text-[11px] text-muted-foreground">What the number on the athlete's card shows.</p></div>
                    <Select value={settings.badge_count_type} onValueChange={(v) => saveSetting({ badge_count_type: v })}>
                      <SelectTrigger className="w-40" data-testid="setting-badge-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New since last visit</SelectItem>
                        <SelectItem value="today">Posts today</SelectItem>
                      </SelectContent>
                    </Select>
                  </CardContent></Card>
                </>
              )}
            </TabsContent>

            {/* REPORTED */}
            <TabsContent value="reported" className="mt-4 space-y-3">
              {reported.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No open reports.</p> : reported.map(({ report, post }) => (
                <Card key={report.id} className="border-red-500/20" data-testid={`report-${report.id}`}>
                  <CardContent className="p-3 flex gap-3">
                    {post && <img src={photoUrl(post.photo_id)} alt="reported" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-20 h-20 rounded-lg object-cover bg-black select-none" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-red-300 font-semibold">Reported: {report.reason}</p>
                      {report.details && <p className="text-xs text-muted-foreground">{report.details}</p>}
                      {post && <p className="text-xs text-muted-foreground mt-1">{post.athlete_name} · {post.post_type}</p>}
                      <div className="flex gap-1 mt-2">
                        <Button variant="ghost" size="sm" className="h-7 text-red-400" onClick={() => moderate(report.post_id, 'remove')}><Trash2 className="w-3.5 h-3.5 mr-1" />Remove post</Button>
                        <Button variant="ghost" size="sm" className="h-7 text-emerald-400" onClick={() => moderate(report.post_id, 'restore')}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Dismiss</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </div>

      {showForm && (
        <ChallengeForm
          getAuthHeaders={getAuthHeaders}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); const list = await loadChallenges(); const cid = editing?.id || list[0]?.id; if (cid) await loadOverview(cid); }}
        />
      )}

      {adjustFor && (
        <AdjustPointsModal
          row={adjustFor}
          challengeId={selectedId}
          getAuthHeaders={getAuthHeaders}
          onClose={() => setAdjustFor(null)}
          onSaved={async () => { setAdjustFor(null); await Promise.all([loadLeaderboard(), loadOverview(selectedId)]); }}
        />
      )}
    </div>
  );
}

function AdminFeedPost({ post, photoUrl, getAuthHeaders, onModerate }) {
  const [reactions, setReactions] = useState(post.reactions || {});
  const [myReaction, setMyReaction] = useState(post.my_reaction || null);
  const [showPicker, setShowPicker] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [text, setText] = useState('');
  const [count, setCount] = useState(post.comment_count || 0);

  const react = async (emoji) => {
    setShowPicker(false);
    try {
      const res = await axios.post(`${API}/fittest/posts/${post.id}/reactions`, { emoji }, getAuthHeaders());
      setReactions(res.data.reactions); setMyReaction(res.data.my_reaction);
    } catch (e) { toast.error('Could not react'); }
  };
  const loadComments = async () => {
    try { const res = await axios.get(`${API}/fittest/posts/${post.id}/comments`, getAuthHeaders()); setComments(res.data.comments || []); setCount((res.data.comments || []).length); } catch (e) { setComments([]); }
  };
  const toggleComments = () => { const n = !showComments; setShowComments(n); if (n && comments === null) loadComments(); };
  const addComment = async () => {
    if (!text.trim()) return;
    try { const res = await axios.post(`${API}/fittest/posts/${post.id}/comments`, { body: text.trim() }, getAuthHeaders()); setComments((c) => [...(c || []), res.data]); setCount((n) => n + 1); setText(''); } catch (e) { toast.error('Could not comment'); }
  };
  const removeComment = async (id) => {
    try { await axios.delete(`${API}/fittest/comments/${id}`, getAuthHeaders()); setComments((c) => (c || []).filter((x) => x.id !== id)); setCount((n) => Math.max(0, n - 1)); } catch (e) { toast.error('Could not delete'); }
  };
  const top = Object.entries(reactions).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="glass-light border-white/5" data-testid={`mod-post-${post.id}`}>
      <CardContent className="p-3">
        <div className="flex gap-3">
          <img src={photoUrl(post.photo_id)} alt="post" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-20 h-20 rounded-lg object-cover bg-black select-none" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{post.athlete_name} <span className="text-xs text-muted-foreground">· {teamShort(post.team)}</span></p>
            <p className="text-xs text-muted-foreground">{post.post_type} · {post.posted_at} · {post.points_awarded} pts</p>
            {post.caption && <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{post.caption}</p>}
            <div className="flex gap-1 mt-2">
              <Button variant="ghost" size="sm" className="h-7 text-amber-400" onClick={() => onModerate(post.id, 'hide')} data-testid={`hide-post-${post.id}`}><EyeOff className="w-3.5 h-3.5 mr-1" />Hide</Button>
              <Button variant="ghost" size="sm" className="h-7 text-red-400" onClick={() => onModerate(post.id, 'remove')} data-testid={`remove-post-${post.id}`}><Trash2 className="w-3.5 h-3.5 mr-1" />Remove</Button>
            </div>
          </div>
        </div>

        <div className="mt-2 border-t border-white/5 pt-2">
          {top.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-2">
              {top.map(([emoji, n]) => (<span key={emoji} className="text-xs rounded-full px-2 py-0.5 border bg-white/5 border-white/10">{emoji} {n}</span>))}
            </div>
          )}
          <div className="flex items-center gap-1 relative">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => setShowPicker((s) => !s)} data-testid={`admin-react-btn-${post.id}`}>
              <span className="text-base mr-1">{myReaction || '🔥'}</span> React
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={toggleComments} data-testid={`admin-comment-btn-${post.id}`}>
              <MessageSquare className="w-4 h-4 mr-1" /> {count}
            </Button>
            {showPicker && (
              <div className="absolute bottom-9 left-0 z-10 flex gap-1 flex-wrap max-w-[280px] rounded-xl bg-card border border-white/10 p-2 shadow-xl">
                {EMOJIS.map((e) => (<button key={e} onClick={() => react(e)} className="text-xl hover:scale-125 transition-transform p-1">{e}</button>))}
              </div>
            )}
          </div>
          {showComments && (
            <div className="space-y-2 mt-2" data-testid={`admin-comments-${post.id}`}>
              {comments === null ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" /> : comments.length === 0 ? <p className="text-xs text-muted-foreground">No comments yet.</p> : comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 group">
                  <p className="text-xs flex-1"><span className="font-semibold text-foreground">{c.athlete_name}</span>{c.from_staff && <span className="ml-1 text-[9px] uppercase font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 rounded px-1">Staff</span>} <span className="text-foreground/80">{c.body}</span></p>
                  <button onClick={() => removeComment(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }} placeholder="Comment as staff..." data-testid={`admin-comment-input-${post.id}`} className="flex-1 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50" />
                <Button size="sm" className="h-7 rounded-full bg-cyan-600 hover:bg-cyan-700" onClick={addComment} data-testid={`admin-comment-send-${post.id}`}>Send</Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <Card className="glass-light border-white/5"><CardContent className="p-3">
      <div className="flex items-center gap-1.5 mb-1"><Icon className={`w-4 h-4 ${color}`} /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span></div>
      <p className="text-2xl font-heading font-black text-foreground">{value ?? 0}</p>
    </CardContent></Card>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    draft: 'bg-white/10 text-muted-foreground border-white/20',
    finished: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    archived: 'bg-white/5 text-muted-foreground border-white/10',
  };
  return <Badge className={`text-[10px] border ${map[status] || map.draft}`}>{status}</Badge>;
}

function SettingRow({ label, hint, checked, onChange, testid }) {
  return (
    <Card className="glass-light border-white/5"><CardContent className="p-4 flex items-center justify-between gap-3">
      <div><p className="text-sm font-medium text-foreground">{label}</p><p className="text-[11px] text-muted-foreground">{hint}</p></div>
      <Switch checked={!!checked} onCheckedChange={onChange} data-testid={testid} />
    </CardContent></Card>
  );
}

function AdjustPointsModal({ row, challengeId, getAuthHeaders, onClose, onSaved }) {
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const n = parseInt(points, 10);
    if (!n || Number.isNaN(n)) { toast.error('Enter a non-zero number (can be negative)'); return; }
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    setSaving(true);
    try {
      const res = await axios.post(`${API}/fittest/admin/points/adjust`, { challenge_id: challengeId, athlete_id: row.athlete_id, points: n, reason: reason.trim() }, getAuthHeaders());
      toast.success(`Adjusted. ${row.name} now has ${res.data.new_total} pts`);
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not adjust'); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="adjust-points-modal">
        <DialogHeader><DialogTitle>Adjust points — {row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Current: {row.points} pts. Use a negative number to subtract. This is logged with your reason.</p>
          <div><Label>Points (+/-)</Label><Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 2 or -1" data-testid="adjust-points-input" /></div>
          <div><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this adjustment?" data-testid="adjust-reason-input" /></div>
          <Button className="w-full bg-orange-500 hover:bg-orange-600" disabled={saving} onClick={save} data-testid="save-adjust-btn">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Apply adjustment</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChallengeForm({ getAuthHeaders, editing, onClose, onSaved }) {
  const [form, setForm] = useState(() => editing ? {
    title: editing.title || '', description: editing.description || '',
    event_name: editing.event_name || '',
    start_date: editing.start_date, end_date: editing.end_date,
    included_teams: editing.included_teams || [],
    status: editing.status || 'active',
    allow_comments: editing.allow_comments !== false,
    allow_reactions: editing.allow_reactions !== false,
  } : {
    title: '', description: '', event_name: '',
    start_date: todayStr(), end_date: addDays(14),
    included_teams: [], status: 'active', allow_comments: true, allow_reactions: true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleTeam = (t) => set('included_teams', form.included_teams.includes(t) ? form.included_teams.filter((x) => x !== t) : [...form.included_teams, t]);

  const save = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (form.start_date > form.end_date) { toast.error('Start date must be before end date'); return; }
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`${API}/fittest/admin/challenges/${editing.id}`, form, getAuthHeaders());
        toast.success('Challenge updated');
      } else {
        await axios.post(`${API}/fittest/admin/challenges`, form, getAuthHeaders());
        toast.success('Challenge created');
      }
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="challenge-form">
        <DialogHeader><DialogTitle>{editing ? 'Edit Challenge' : 'New Challenge'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="The Fittest Camp Challenge" data-testid="challenge-title-input" /></div>
          <div><Label>Linked event (optional)</Label><Input value={form.event_name} onChange={(e) => set('event_name', e.target.value)} placeholder="September Training Camp" data-testid="challenge-event-input" /></div>
          <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Post your training check-ins and complete 100/100 recovery with a photo to earn points." className="resize-none" data-testid="challenge-desc-input" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start date</Label><Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} data-testid="challenge-start-input" /></div>
            <div><Label>End date</Label><Input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} data-testid="challenge-end-input" /></div>
          </div>
          <div>
            <Label>Teams included</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Leave both selected (or none) for a combined ranking of both teams.</p>
            <div className="flex gap-2">
              {TEAMS.map((t) => (
                <button key={t} onClick={() => toggleTeam(t)} data-testid={`team-toggle-${teamShort(t)}`}
                  className={`flex-1 rounded-lg p-2 text-sm border transition-colors ${form.included_teams.includes(t) ? 'border-orange-500/50 bg-orange-500/10 text-orange-300' : 'border-white/10 bg-white/[0.02] text-muted-foreground'}`}>
                  {teamShort(t)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/5 p-3">
            <Label className="cursor-pointer">Allow comments</Label>
            <Switch checked={form.allow_comments} onCheckedChange={(v) => set('allow_comments', v)} data-testid="allow-comments-switch" />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/5 p-3">
            <Label className="cursor-pointer">Allow reactions</Label>
            <Switch checked={form.allow_reactions} onCheckedChange={(v) => set('allow_reactions', v)} data-testid="allow-reactions-switch" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger data-testid="challenge-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft (hidden from athletes)</SelectItem>
                <SelectItem value="active">Active (live now)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 text-[11px] text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Scoring rules</p>
            <p>• Training check-in with photo = 1 point</p>
            <p>• 100/100 recovery with photo = 1 point</p>
            <p>• No photo = no post & no points · Logs without a feed post = no points</p>
          </div>
          <Button className="w-full bg-orange-500 hover:bg-orange-600" disabled={saving} onClick={save} data-testid="save-challenge-btn">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editing ? 'Save changes' : 'Create challenge'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
