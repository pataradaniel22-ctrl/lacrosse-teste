import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { toast } from 'sonner';
import {
  ArrowLeft, Flame, Trophy, Plus, Camera, MessageCircle, Trash2, Flag,
  Dumbbell, ShieldCheck, ChevronUp, Medal, Loader2, X,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const EMOJIS = ['🔥', '💪', '👏', '⚡', '✅', '🏆', '🙌', '🇧🇷', '🥍', '❗'];
// Athlete's device timezone — anchors "today" logic to each athlete's local day
const DEVICE_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
})();

const TYPE_META = {
  training_checkin: { label: 'Training check-in', icon: Dumbbell, color: 'text-sky-400', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  recovery: { label: 'Recovery', icon: ShieldCheck, color: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  training_and_recovery: { label: 'Training + Recovery', icon: Flame, color: 'text-orange-400', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  admin_announcement: { label: 'Announcement', icon: Trophy, color: 'text-amber-400', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
};

const teamShort = (t) => (t || '').replace('Brazil Lacrosse ', '') || '—';
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function TheFittest() {
  const { user, getAuthHeaders, token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composeType, setComposeType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState(null);
  const [my, setMy] = useState(null);
  const [daysLeft, setDaysLeft] = useState(0);
  const [preview, setPreview] = useState([]);
  const [participants, setParticipants] = useState(0);
  const [feed, setFeed] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [winner, setWinner] = useState(null);
  const [settings, setSettings] = useState(null);

  const photoUrl = (id, thumb) => `${API}/fittest/photo/${id}${thumb ? '?thumb=1&' : '?'}auth=${token}`;

  const loadHeader = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/fittest/active-challenge`, getAuthHeaders());
      setChallenge(res.data.challenge);
      setMy(res.data.my);
      setDaysLeft(res.data.days_left || 0);
      setPreview(res.data.leaderboard_preview || []);
      setParticipants(res.data.total_participants || 0);
      return res.data.challenge;
    } catch (e) { return null; }
  }, [getAuthHeaders]);

  const loadFeed = useCallback(async (f) => {
    try {
      const res = await axios.get(`${API}/fittest/feed?filter=${f}`, getAuthHeaders());
      setFeed(res.data.posts || []);
    } catch (e) { setFeed([]); }
  }, [getAuthHeaders]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/fittest/leaderboard`, getAuthHeaders());
      setLeaderboard(res.data.leaderboard || []);
      setMyRank(res.data.my_rank);
    } catch (e) { /* noop */ }
  }, [getAuthHeaders]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ch = await loadHeader();
      await loadFeed('all');
      setLoading(false);
      if (ch) axios.post(`${API}/fittest/mark-viewed`, {}, getAuthHeaders()).catch(() => {});
      axios.get(`${API}/fittest/settings`, getAuthHeaders()).then((r) => setSettings(r.data)).catch(() => {});
      const compose = searchParams.get('compose');
      if (ch && compose) {
        setComposeType(['training_checkin', 'recovery', 'training_and_recovery'].includes(compose) ? compose : 'training_checkin');
        setShowCreate(true);
        setSearchParams({}, { replace: true });
      }
      axios.get(`${API}/fittest/recent-winner`, getAuthHeaders()).then((r) => {
        const w = r.data.winner;
        if (w && localStorage.getItem(`tf_winner_dismissed_${w.challenge_id}`) !== 'true') setWinner(w);
      }).catch(() => {});
    })();
  }, [loadHeader, loadFeed, getAuthHeaders]);

  const dismissWinner = () => {
    if (winner) localStorage.setItem(`tf_winner_dismissed_${winner.challenge_id}`, 'true');
    setWinner(null);
  };

  const onFilter = (f) => { setFilter(f); loadFeed(f); };

  const refreshAll = async () => {
    await Promise.all([loadHeader(), loadFeed(filter), loadLeaderboard()]);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="the-fittest-loading">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24 overflow-x-hidden" data-testid="the-fittest-page">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/athlete')} data-testid="the-fittest-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Flame className="w-6 h-6 text-orange-400" />
            <div>
              <h1 className="font-heading font-black text-lg text-foreground leading-none">The Fittest</h1>
              <p className="text-[11px] text-muted-foreground">Train. Recover. Prove it.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-4">
        {winner && (
          <Card className="border-amber-500/40 overflow-hidden animate-fade-in" data-testid="winner-banner">
            <CardContent className="p-4 relative">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-orange-500/10" />
              <button onClick={dismissWinner} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground z-10" data-testid="dismiss-winner-btn"><X className="w-4 h-4" /></button>
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-amber-300/80">{winner.challenge_title} · Winner</p>
                  <p className="font-heading font-black text-foreground">
                    {winner.is_me ? '🏆 You won! Congratulations!' : `🏆 ${winner.winner_name}`}
                  </p>
                  {!winner.is_me && <p className="text-xs text-muted-foreground">{teamShort(winner.winner_team)} took the crown. New challenge soon!</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {!challenge ? (
          <Card className="glass-light border-white/5" data-testid="the-fittest-empty">
            <CardContent className="p-8 text-center space-y-2">
              <Flame className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="font-semibold text-foreground">No active challenge right now.</p>
              <p className="text-sm text-muted-foreground">When the staff starts a challenge, it will show up here.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Challenge card */}
            <Card className="border-orange-500/30 overflow-hidden" data-testid="the-fittest-challenge-card">
              <CardContent className="p-4 relative">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-amber-500/5" />
                <div className="relative space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-heading font-bold text-foreground">{challenge.title}</h2>
                      {challenge.event_name && <p className="text-xs text-muted-foreground">{challenge.event_name}</p>}
                    </div>
                    <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/40 text-[10px] shrink-0">
                      {daysLeft === 0 ? 'Last day' : `Ends in ${daysLeft}d`}
                    </Badge>
                  </div>
                  {challenge.description && <p className="text-xs text-muted-foreground">{challenge.description}</p>}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="rounded-lg bg-background/40 p-2 text-center">
                      <p className="text-2xl font-heading font-black text-orange-400" data-testid="my-score">{my?.points ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Points</p>
                    </div>
                    <div className="rounded-lg bg-background/40 p-2 text-center">
                      <p className="text-2xl font-heading font-black text-foreground" data-testid="my-rank">#{my?.rank ?? '—'}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Your rank</p>
                    </div>
                    <div className="rounded-lg bg-background/40 p-2 text-center">
                      <p className="text-2xl font-heading font-black text-foreground">{participants}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">Athletes</p>
                    </div>
                  </div>
                  {my?.points_to_next != null && my.points_to_next > 0 && (
                    <p className="text-xs text-center text-muted-foreground">
                      <span className="text-orange-300 font-semibold">{my.points_to_next} pts</span> behind #{(my.rank || 2) - 1} {my.next_name ? `(${my.next_name})` : ''}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="feed" onValueChange={(v) => { if (v === 'leaderboard') loadLeaderboard(); }}>
              <TabsList className="grid grid-cols-2 w-full" data-testid="the-fittest-tabs">
                <TabsTrigger value="feed" data-testid="tab-feed">Feed</TabsTrigger>
                <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Leaderboard</TabsTrigger>
              </TabsList>

              {/* FEED */}
              <TabsContent value="feed" className="mt-4 space-y-4">
                <div className="flex gap-2 overflow-x-auto flex-nowrap pb-1 px-0.5 -mx-0.5">
                  {[['all', 'All'], ['training', 'Training'], ['recovery', 'Recovery'], ['my_team', 'My team'], ['today', 'Today'], ['top', 'Top']].map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => onFilter(k)}
                      data-testid={`feed-filter-${k}`}
                      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === k ? 'bg-orange-500 text-white' : 'bg-white/5 text-muted-foreground hover:bg-white/10'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {feed.length === 0 ? (
                  <Card className="glass-light border-white/5" data-testid="feed-empty">
                    <CardContent className="p-8 text-center space-y-1">
                      <Camera className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                      <p className="text-sm text-muted-foreground">No posts yet. Be the first to post a check-in.</p>
                    </CardContent>
                  </Card>
                ) : (
                  feed.map((p) => (
                    <PostCard key={p.id} post={p} photoUrl={photoUrl} getAuthHeaders={getAuthHeaders} onChanged={refreshAll} />
                  ))
                )}
              </TabsContent>

              {/* LEADERBOARD */}
              <TabsContent value="leaderboard" className="mt-4 space-y-2" data-testid="leaderboard-list">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No points yet.</p>
                ) : (
                  leaderboard.map((r) => (
                    <div
                      key={r.athlete_id}
                      data-testid={`leaderboard-row-${r.rank}`}
                      className={`flex items-center gap-3 rounded-xl p-3 border ${r.athlete_id === user?.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-white/5 bg-white/[0.02]'}`}
                    >
                      <div className={`w-7 text-center font-heading font-black ${r.rank <= 3 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                        {r.rank <= 3 ? <Medal className="w-5 h-5 mx-auto" /> : r.rank}
                      </div>
                      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-foreground shrink-0">
                        {initials(r.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{r.name}{r.athlete_id === user?.id ? ' (You)' : ''}</p>
                        <p className="text-[11px] text-muted-foreground">{teamShort(r.team)} · {r.training_checkins}🏋️ · {r.recoveries}🛡️</p>
                      </div>
                      <div className="text-right">
                        <p className="font-heading font-black text-orange-400">{r.points}</p>
                        <p className="text-[10px] text-muted-foreground">pts</p>
                      </div>
                    </div>
                  ))
                )}
                {myRank && myRank > 10 && (
                  <p className="text-xs text-center text-muted-foreground pt-2">You are #{myRank} overall.</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* Floating create button */}
      {challenge && (
        <button
          onClick={() => setShowCreate(true)}
          data-testid="open-create-post-btn"
          className="fixed bottom-6 right-1/2 translate-x-[calc(50%+140px)] sm:right-6 sm:translate-x-0 z-30 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/30 flex items-center justify-center transition-transform active:scale-95"
          aria-label="Post check-in"
        >
          <Plus className="w-7 h-7 text-white" />
        </button>
      )}

      {showCreate && (
        <CreatePostModal
          challenge={challenge}
          settings={settings}
          initialType={composeType}
          getAuthHeaders={getAuthHeaders}
          onClose={() => { setShowCreate(false); setComposeType(null); }}
          onCreated={async () => { setShowCreate(false); setComposeType(null); await refreshAll(); }}
        />
      )}
    </div>
  );
}

function PostCard({ post, photoUrl, getAuthHeaders, onChanged }) {
  const { user } = useAuth();
  const [reactions, setReactions] = useState(post.reactions || {});
  const [myReaction, setMyReaction] = useState(post.my_reaction || null);
  const [showReactions, setShowReactions] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const meta = TYPE_META[post.post_type] || TYPE_META.training_checkin;
  const TypeIcon = meta.icon;

  const react = async (emoji) => {
    setShowReactions(false);
    try {
      const res = await axios.post(`${API}/fittest/posts/${post.id}/reactions`, { emoji }, getAuthHeaders());
      setReactions(res.data.reactions);
      setMyReaction(res.data.my_reaction);
    } catch (e) { toast.error('Could not react'); }
  };

  const loadComments = async () => {
    try {
      const res = await axios.get(`${API}/fittest/posts/${post.id}/comments`, getAuthHeaders());
      setComments(res.data.comments || []);
      setCommentCount((res.data.comments || []).length);
    } catch (e) { setComments([]); }
  };

  const toggleComments = () => {
    const next = !showComments;
    setShowComments(next);
    if (next && comments === null) loadComments();
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await axios.post(`${API}/fittest/posts/${post.id}/comments`, { body: commentText.trim() }, getAuthHeaders());
      setComments((c) => [...(c || []), res.data]);
      setCommentCount((n) => n + 1);
      setCommentText('');
    } catch (e) { toast.error('Could not comment'); }
  };

  const removeComment = async (id) => {
    try {
      await axios.delete(`${API}/fittest/comments/${id}`, getAuthHeaders());
      setComments((c) => (c || []).filter((x) => x.id !== id));
      setCommentCount((n) => Math.max(0, n - 1));
    } catch (e) { toast.error('Could not delete'); }
  };

  const deletePost = async () => {
    if (!window.confirm('Delete this post? Any points from it will be removed.')) return;
    try {
      await axios.delete(`${API}/fittest/posts/${post.id}`, getAuthHeaders());
      toast.success('Post deleted');
      onChanged();
    } catch (e) { toast.error('Could not delete post'); }
  };

  const reportPost = async () => {
    const reason = window.prompt('Why are you reporting this post?');
    if (!reason) return;
    try {
      await axios.post(`${API}/fittest/posts/${post.id}/report`, { reason }, getAuthHeaders());
      toast.success('Thanks — staff will review this post.');
    } catch (e) { toast.error('Could not report'); }
  };

  const topReactions = Object.entries(reactions).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="glass-light border-white/5 overflow-hidden" data-testid={`post-card-${post.id}`}>
      {/* header */}
      <div className="flex items-center gap-3 p-3">
        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-foreground shrink-0">
          {initials(post.athlete_name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{post.athlete_name}</p>
          <p className="text-[11px] text-muted-foreground">{teamShort(post.team)} · {post.posted_at}</p>
        </div>
        <Badge className={`text-[10px] border ${meta.badge}`}>
          <TypeIcon className="w-3 h-3 mr-1" />{meta.label}
        </Badge>
      </div>

      {/* photo */}
      <div className="relative bg-black select-none">
        <img
          src={photoUrl(post.photo_id, false)}
          alt="check-in"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full max-h-[420px] object-contain pointer-events-none select-none"
          data-testid={`post-photo-${post.id}`}
        />
        {post.points_awarded > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-orange-500/90 text-white text-xs font-bold px-2.5 py-1 shadow-lg">
            <Flame className="w-3.5 h-3.5" /> +{post.points_awarded}
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-3">
        {post.caption && <p className="text-sm text-foreground">{post.caption}</p>}

        {/* reactions summary */}
        {topReactions.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {topReactions.map(([emoji, n]) => (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                className={`text-xs rounded-full px-2 py-0.5 border ${myReaction === emoji ? 'bg-orange-500/20 border-orange-500/40' : 'bg-white/5 border-white/10'}`}
              >
                {emoji} {n}
              </button>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-1 relative">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => setShowReactions((s) => !s)} data-testid={`react-btn-${post.id}`}>
            <span className="text-base mr-1">{myReaction || '🔥'}</span> React
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={toggleComments} data-testid={`comment-btn-${post.id}`}>
            <MessageCircle className="w-4 h-4 mr-1" /> {commentCount}
          </Button>
          <div className="flex-1" />
          {post.is_mine ? (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400" onClick={deletePost} data-testid={`delete-post-${post.id}`}>
              <Trash2 className="w-4 h-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-amber-400" onClick={reportPost} data-testid={`report-post-${post.id}`}>
              <Flag className="w-4 h-4" />
            </Button>
          )}

          {showReactions && (
            <div className="absolute bottom-10 left-0 z-10 flex gap-1 flex-wrap max-w-[280px] rounded-xl bg-card border border-white/10 p-2 shadow-xl" data-testid={`reaction-picker-${post.id}`}>
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => react(e)} className="text-xl hover:scale-125 transition-transform p-1">{e}</button>
              ))}
            </div>
          )}
        </div>

        {/* comments */}
        {showComments && (
          <div className="space-y-2 border-t border-white/5 pt-3" data-testid={`comments-${post.id}`}>
            {comments === null ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-1">No comments yet.</p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 group">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold text-foreground shrink-0 mt-0.5">
                    {initials(c.athlete_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-semibold text-foreground">{c.athlete_name}</span>
                      {c.from_staff && <span className="ml-1 text-[9px] uppercase font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 rounded px-1 py-0.5">Staff</span>}
                      {' '}<span className="text-foreground/80">{c.body}</span>
                    </p>
                  </div>
                  {(c.is_mine || c.can_moderate) && (
                    <button onClick={() => removeComment(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
            <div className="flex items-center gap-2 pt-1">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }}
                placeholder="Add a comment..."
                data-testid={`comment-input-${post.id}`}
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-orange-500/50"
              />
              <Button size="sm" className="h-8 rounded-full bg-orange-500 hover:bg-orange-600" onClick={addComment} data-testid={`comment-send-${post.id}`}>Send</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreatePostModal({ challenge, settings, initialType, getAuthHeaders, onClose, onCreated }) {
  const [postType, setPostType] = useState(initialType || 'training_checkin');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [trainings, setTrainings] = useState([]);
  const [selectedTraining, setSelectedTraining] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const tzq = `tz=${encodeURIComponent(DEVICE_TZ)}`;
    axios.get(`${API}/fittest/eligibility?${tzq}`, getAuthHeaders())
      .then((res) => setEligibility(res.data)).catch(() => {});
    axios.get(`${API}/fittest/my-trainings-today?${tzq}`, getAuthHeaders())
      .then((res) => {
        const list = res.data.trainings || [];
        setTrainings(list);
        const firstOpen = list.find((t) => !t.posted);
        if (firstOpen) setSelectedTraining(firstOpen.id);
      }).catch(() => {});
  }, [getAuthHeaders]);

  const wantsTraining = postType === 'training_checkin' || postType === 'training_and_recovery';
  const wantsRecovery = postType === 'recovery' || postType === 'training_and_recovery';

  // eligibility per type based on today's logs
  const canTraining = !!eligibility?.has_training_today;
  const canRecovery = !!eligibility?.has_recovery_today;
  const typeEligible = (t) => t === 'training_checkin' ? canTraining : t === 'recovery' ? canRecovery : (canTraining && canRecovery);
  const nothingLogged = eligibility && !canTraining && !canRecovery;
  const selectedEligible = eligibility ? typeEligible(postType) : true;

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const publish = async () => {
    if (!selectedEligible) { toast.error('Log the matching training/recovery today before posting.'); return; }
    if (wantsTraining && !selectedTraining) { toast.error('Select which training session to post.'); return; }
    if (!file) { toast.error('A photo is required to publish on The Fittest.'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await axios.post(`${API}/fittest/photo`, fd, {
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'multipart/form-data' },
      });
      const photo_id = up.data.photo_id;
      const res = await axios.post(`${API}/fittest/posts`, {
        challenge_id: challenge.id, post_type: postType, caption, photo_id,
        linked_training_session_id: wantsTraining ? selectedTraining : null,
        tz: DEVICE_TZ,
      }, getAuthHeaders());
      const earned = res.data.points_earned || 0;
      if (earned > 0) toast.success(`Published! +${earned} point${earned > 1 ? 's' : ''} 🔥`);
      else toast.info((res.data.messages || ['Published to The Fittest.'])[0]);
      onCreated();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Could not publish');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="create-post-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Flame className="w-5 h-5 text-orange-400" /> Post to The Fittest</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {nothingLogged && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200" data-testid="no-log-warning">
              You need to log a training session or recovery today before posting. Log it first, then come back to publish your photo.
            </div>
          )}
          {/* type */}
          <div className="grid grid-cols-3 gap-2">
            {[['training_checkin', 'Training', Dumbbell], ['recovery', 'Recovery', ShieldCheck], ['training_and_recovery', 'Both', Flame]].map(([k, label, Icon]) => {
              const ok = eligibility ? typeEligible(k) : true;
              return (
                <button
                  key={k}
                  onClick={() => ok && setPostType(k)}
                  disabled={!ok}
                  data-testid={`post-type-${k}`}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 border transition-colors ${postType === k ? 'border-orange-500/50 bg-orange-500/10 text-orange-300' : 'border-white/10 bg-white/[0.02] text-muted-foreground'} ${!ok ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              );
            })}
          </div>

          {/* eligibility hints */}
          {eligibility && (
            <div className="text-[11px] text-muted-foreground space-y-1 rounded-lg bg-white/[0.02] border border-white/5 p-2">
              <p className={eligibility.has_training_today ? 'text-emerald-400' : ''}>
                {eligibility.has_training_today ? '✓ Training logged today' : '• No training logged today — log it to post a training check-in'}
              </p>
              <p className={eligibility.recovery_complete ? 'text-emerald-400' : (eligibility.has_recovery_today ? 'text-foreground/80' : '')}>
                {eligibility.recovery_complete
                  ? '✓ Recovery complete 100/100 (+1 possible)'
                  : eligibility.has_recovery_today
                    ? `• Recovery logged (${eligibility.recovery_points_today}/${eligibility.recovery_target}) — needs 100 for the point`
                    : '• No recovery logged today — log it to post a recovery'}
              </p>
            </div>
          )}

          {/* training session picker */}
          {wantsTraining && (
            <div className="space-y-2" data-testid="training-picker">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Which training?</p>
              {trainings.length === 0 ? (
                <p className="text-xs text-muted-foreground">No training logged today yet.</p>
              ) : (
                trainings.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => !t.posted && setSelectedTraining(t.id)}
                    disabled={t.posted}
                    data-testid={`training-option-${t.id}`}
                    className={`w-full flex items-center gap-3 rounded-xl p-2.5 border text-left transition-colors ${
                      t.posted ? 'opacity-50 cursor-not-allowed border-white/5 bg-white/[0.02]'
                        : selectedTraining === t.id ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}
                  >
                    <Dumbbell className={`w-4 h-4 shrink-0 ${selectedTraining === t.id && !t.posted ? 'text-orange-400' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.session_type}{t.time ? ` · ${t.time}` : ''}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[t.duration_min ? `${t.duration_min} min` : null, t.rpe ? `RPE ${t.rpe}` : null, t.internal_load ? `Load ${t.internal_load}` : null].filter(Boolean).join(' · ') || 'Session'}
                      </p>
                    </div>
                    {t.posted && <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5">Posted</span>}
                    {!t.posted && selectedTraining === t.id && <span className="text-orange-400 text-xs">✓</span>}
                  </button>
                ))
              )}
              {trainings.length > 0 && trainings.every((t) => t.posted) && (
                <p className="text-[11px] text-emerald-400" data-testid="all-trainings-posted">All of today's sessions have been posted. 🎉</p>
              )}
            </div>
          )}

          {/* recovery summary */}
          {wantsRecovery && eligibility && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2" data-testid="recovery-summary">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Today's recovery
                </span>
                {eligibility.recovery_complete ? (
                  <span className="text-[10px] uppercase font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5">Complete</span>
                ) : (
                  <span className="text-[10px] uppercase font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">Incomplete</span>
                )}
              </div>
              <div className="flex items-end gap-1.5">
                <span className={`text-2xl font-heading font-black ${eligibility.recovery_complete ? 'text-emerald-400' : 'text-foreground'}`}>{eligibility.recovery_points_today}</span>
                <span className="text-sm text-muted-foreground mb-0.5">/ {eligibility.recovery_target}</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${eligibility.recovery_complete ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.round((eligibility.recovery_points_today / (eligibility.recovery_target || 100)) * 100))}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {eligibility.recovery_complete
                  ? 'Recovery complete — this post earns +1 recovery point 🔥'
                  : 'Recovery must reach 100/100 to earn the recovery point. You can still post it.'}
              </p>
            </div>
          )}

          {/* photo picker */}
          <div>
            <input ref={fileRef} type="file" accept="image/*" {...(settings && settings.allow_gallery_upload === false && settings.allow_camera_upload ? { capture: 'environment' } : {})} className="hidden" onChange={onPick} data-testid="post-photo-input" />
            {previewUrl ? (
              <div className="relative">
                <img src={previewUrl} alt="preview" className="w-full max-h-64 object-contain rounded-xl bg-black" />
                <Button variant="secondary" size="sm" className="absolute top-2 right-2 h-7" onClick={() => fileRef.current?.click()}>Change</Button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={nothingLogged}
                data-testid="pick-photo-btn"
                className={`w-full flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-white/15 hover:border-orange-500/40 p-8 text-muted-foreground transition-colors ${nothingLogged ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <Camera className="w-8 h-8" />
                <span className="text-sm font-medium">Add a photo (required)</span>
                <span className="text-[11px]">Your photo is the proof of your check-in</span>
              </button>
            )}
          </div>

          <Textarea
            placeholder="Add a caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="resize-none"
            rows={2}
            data-testid="post-caption-input"
          />

          <p className="text-[11px] text-muted-foreground">Your post will be visible to athletes and staff in this challenge.</p>

          <Button
            className="w-full bg-orange-500 hover:bg-orange-600 font-semibold"
            disabled={!file || uploading || !selectedEligible || (wantsTraining && !selectedTraining)}
            onClick={publish}
            data-testid="publish-post-btn"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {uploading ? 'Publishing...' : 'Publish'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
