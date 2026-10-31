/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { PainReportInput } from '../../components/PainReportInput';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import {
  ArrowLeft, Flame, Plus, Trophy, CheckCircle2, Clock, Upload, X,
  ShieldCheck, Award, Sparkles, Target, Trash2,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PROGRESS_COLOR = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-500',
};
const TEXT_COLOR = {
  red: 'text-red-400',
  orange: 'text-orange-400',
  yellow: 'text-amber-400',
  green: 'text-emerald-400',
};
const CAT_STYLE = {
  Gold: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
  Silver: 'bg-slate-400/20 text-slate-700 border-slate-400/50',
  Bronze: 'bg-orange-600/15 text-orange-700 border-orange-700/40',
};
const catStyle = (c) => CAT_STYLE[c] || 'bg-primary/15 text-primary border-primary/40';

export default function RecoveryPoints() {
  const { token, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [summary, setSummary] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/recovery/logs/${delTarget.id}`, getAuthHeaders());
      toast.success('Submission removed. You can log it again.');
      setDelTarget(null);
      await fetchAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not delete this submission');
    } finally {
      setDeleting(false);
    }
  };

  const fetchAll = useCallback(async () => {
    try {
      const [t, s, c] = await Promise.all([
        axios.get(`${API}/recovery/today`, getAuthHeaders()),
        axios.get(`${API}/recovery/my-summary`, getAuthHeaders()),
        axios.get(`${API}/recovery/catalog`, getAuthHeaders()),
      ]);
      setToday(t.data);
      setSummary(s.data);
      setCatalog(c.data);
    } catch (e) {
      toast.error('Failed to load recovery data');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading || !today) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-primary">Loading Recovery...</div>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((today.points / today.target) * 100));
  const earnedBadges = (summary?.badges || []).filter((b) => b.earned);

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="recovery-points-page">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/athlete')} data-testid="recovery-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading font-bold text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> Recovery Points
            </h1>
            <p className="text-xs text-muted-foreground">Consistency over perfection</p>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 space-y-4">
        {/* Today's points */}
        <Card className="glass-light border-white/5 overflow-hidden animate-fade-in">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" /> Today&apos;s Recovery
              </span>
              {today.goal_achieved && (
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40" data-testid="goal-achieved-badge">
                  <Trophy className="w-3 h-3 mr-1" /> Goal Achieved
                </Badge>
              )}
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className={`text-5xl font-heading font-black ${TEXT_COLOR[today.color]}`} data-testid="today-points">
                {today.points}
              </span>
              <span className="text-xl text-muted-foreground mb-1">/ {today.target}</span>
            </div>
            {/* Progress bar */}
            <div className="h-3 rounded-full bg-white/5 overflow-hidden" data-testid="recovery-progress">
              <div
                className={`h-full rounded-full transition-all duration-700 ${PROGRESS_COLOR[today.color]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>{today.goal_achieved ? 'Great consistency today!' : `${today.remaining} points to your goal`}</span>
              {today.pending_points > 0 && (
                <span className="text-amber-400">+{today.pending_points} pending</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Streak + Compliance */}
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
          <Card className="glass-light border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Flame className="w-4 h-4 text-orange-400" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Streak</span>
              </div>
              <p className="text-2xl font-heading font-bold" data-testid="recovery-streak">
                {summary?.streak ?? 0} <span className="text-sm text-muted-foreground">days</span>
              </p>
            </CardContent>
          </Card>
          <Card className="glass-light border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Compliance</span>
              </div>
              <p className="text-2xl font-heading font-bold" data-testid="recovery-compliance">
                {summary?.compliance?.compliance_pct ?? 0}%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 14-day mini history */}
        {summary?.series_14d && (
          <Card className="glass-light border-white/5 animate-fade-in">
            <CardContent className="p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Last 14 days</span>
              <div className="flex items-end justify-between gap-1 mt-3 h-16">
                {summary.series_14d.map((d, i) => {
                  const h = Math.max(6, Math.min(100, (d.points / (today.target * 1.5)) * 100));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.points} pts`}>
                      <div className={`w-full rounded-sm ${PROGRESS_COLOR[d.color]}`} style={{ height: `${h}%` }} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Badges */}
        {earnedBadges.length > 0 && (
          <Card className="glass-light border-white/5 animate-fade-in">
            <CardContent className="p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-400" /> Achievements
              </span>
              <div className="flex flex-wrap gap-2 mt-3">
                {earnedBadges.map((b) => (
                  <Badge key={b.id} className="bg-amber-500/15 text-amber-300 border-amber-500/30" data-testid={`badge-${b.id}`}>
                    <Sparkles className="w-3 h-3 mr-1" /> {b.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Today's logs */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground px-1">Today&apos;s Activities</h2>
          {today.logs.length === 0 && (
            <Card className="glass-light border-white/5">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No recovery logged yet today. Tap below to start.
              </CardContent>
            </Card>
          )}
          {today.logs.map((log) => (
            <Card key={log.id} className="glass-light border-white/5" data-testid={`recovery-log-${log.id}`}>
              <CardContent className="p-3 flex items-center gap-3">
                {log.has_proof ? (
                  <img
                    src={`${API}/recovery/files/${log.file_id}?auth=${token}`}
                    alt="proof"
                    className="w-12 h-12 rounded-lg object-cover border border-white/10 flex-shrink-0 bg-white/5"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg border border-white/10 flex items-center justify-center text-muted-foreground flex-shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{log.activity_name}</span>
                    <Badge variant="outline" className={`text-[10px] ${catStyle(log.category)}`}>{log.category}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs">
                    <span className="text-emerald-400 font-semibold">+{log.points} pts</span>
                    <span className="text-muted-foreground">· {log.time}</span>
                    {log.status === 'pending' && <span className="text-amber-400 flex items-center gap-0.5"><Clock className="w-3 h-3" /> pending</span>}
                    {log.status === 'approved' && <span className="text-emerald-400 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> approved</span>}
                    {log.status === 'rejected' && <span className="text-red-400 flex items-center gap-0.5"><X className="w-3 h-3" /> rejected</span>}
                  </div>
                  {log.feedback && <p className="text-[11px] text-muted-foreground mt-1 italic">&ldquo;{log.feedback}&rdquo;</p>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0 text-muted-foreground hover:text-red-400"
                  onClick={() => setDelTarget(log)}
                  data-testid={`recovery-log-delete-${log.id}`}
                  aria-label="Delete submission"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      {/* Delete confirmation */}
      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <DialogContent data-testid="recovery-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete this submission?</DialogTitle>
            <DialogDescription>
              This will remove &ldquo;{delTarget?.activity_name}&rdquo; (+{delTarget?.points} pts)
              {delTarget?.has_proof ? ' and its photo' : ''} from today. You can submit it again
              if it was a mistake. Submissions can only be deleted on the same day.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)} disabled={deleting} data-testid="recovery-delete-cancel">
              Cancel
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={doDelete}
              disabled={deleting}
              data-testid="recovery-delete-confirm"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Log button */}
      <div className="fixed bottom-20 left-0 right-0 z-40 px-4 md:bottom-6">
        <div className="max-w-md mx-auto">
          <Button
            className="w-full h-12 text-base font-semibold shadow-lg shadow-primary/20"
            onClick={() => setOpen(true)}
            data-testid="open-recovery-submit-btn"
          >
            <Plus className="w-5 h-5 mr-1" /> Log Recovery
          </Button>
        </div>
      </div>

      <RecoverySubmitDialog
        open={open}
        onOpenChange={setOpen}
        catalog={catalog}
        getAuthHeaders={getAuthHeaders}
        onSubmitted={() => { setOpen(false); fetchAll(); }}
      />
    </div>
  );
}

function RecoverySubmitDialog({ open, onOpenChange, catalog, getAuthHeaders, onSubmitted }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(null);
  const [activity, setActivity] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notes, setNotes] = useState('');
  const [pain, setPain] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setCategory(null); setActivity(null); setFile(null); setPreview(null); setNotes(''); setPain([]); };

  useEffect(() => { if (!open) reset(); }, [open]);

  const cats = catalog?.categories || [];
  const acts = (catalog?.activities || []).filter((a) => !category || a.category === category);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
      toast.error('Only JPG, PNG or PDF allowed');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)');
      return;
    }
    setFile(f);
    if (f.type.startsWith('image/')) setPreview(URL.createObjectURL(f));
    else setPreview(null);
  };

  const submit = async () => {
    if (!activity) { toast.error('Select an activity'); return; }
    if (!file) { toast.warning('Submitting without a photo. Proof is strongly recommended.'); }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('activity_id', activity.id);
      if (notes.trim()) fd.append('notes', notes.trim());
      if (pain.length > 0) fd.append('pain_reports', JSON.stringify(pain));
      if (file) fd.append('file', file);
      const res = await axios.post(`${API}/recovery/logs`, fd, getAuthHeaders());
      if (res.data.awarded) {
        toast.success(`+${activity.points} points! ${res.data.goal_achieved ? '🏆 Goal achieved!' : ''}`);
      } else {
        toast.success('Submitted! Awaiting staff approval.');
      }
      if (res.data.goal_achieved) {
        toast('Recovery complete 100/100 🔥', {
          description: 'Share it on The Fittest to earn a point.',
          action: { label: 'Postar no The Fittest', onClick: () => navigate('/athlete/the-fittest?compose=recovery') },
          duration: 8000,
        });
      }
      onSubmitted();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="recovery-submit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" /> Log Recovery
          </DialogTitle>
          <DialogDescription>
            Choose an activity to earn recovery points. A photo proof is strongly recommended.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category chips */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Category</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setCategory(null); setActivity(null); }}
                className={`px-3 py-1.5 rounded-full text-xs border transition-all ${!category ? 'bg-primary/20 border-primary/50 text-primary' : 'border-white/10 text-muted-foreground'}`}
                data-testid="cat-all"
              >All</button>
              {cats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCategory(c.name); setActivity(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-all ${category === c.name ? catStyle(c.name) : 'border-white/10 text-muted-foreground'}`}
                  data-testid={`cat-${c.name}`}
                >{c.name} · {c.default_points}</button>
              ))}
            </div>
          </div>

          {/* Activity grid */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Activity</p>
            <div className="grid grid-cols-2 gap-2">
              {acts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActivity(a)}
                  className={`text-left p-3 rounded-xl border transition-all ${activity?.id === a.id ? 'bg-primary/15 border-primary/50' : 'border-white/10 hover:border-white/20'}`}
                  data-testid={`activity-${a.id}`}
                >
                  <p className="text-sm font-medium leading-tight">{a.name}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <Badge variant="outline" className={`text-[9px] ${catStyle(a.category)}`}>{a.category}</Badge>
                    <span className="text-xs text-emerald-400 font-semibold">+{a.points}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Proof upload (required, but submission not blocked) */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Proof <span className="text-red-500">*</span> <span className="text-[10px] normal-case text-muted-foreground">(strongly recommended)</span>
            </p>
            <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-white/15 cursor-pointer hover:border-primary/40 transition-all" data-testid="proof-upload-label">
              <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={onFile} data-testid="proof-file-input" />
              {preview ? (
                <img src={preview} alt="preview" className="w-12 h-12 rounded-lg object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center text-muted-foreground">
                  <Upload className="w-5 h-5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm">{file ? file.name : 'Upload screenshot / photo / PDF'}</p>
                <p className="text-xs text-muted-foreground">JPG, PNG or PDF · max 10MB</p>
              </div>
            </label>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Notes (optional)</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Slept 8h30, hydrated 3L..."
              className="resize-none"
              rows={2}
              data-testid="recovery-notes-input"
            />
          </div>

          {/* Pain report (optional) */}
          <div className="pt-1 border-t border-white/5">
            <PainReportInput
              value={pain}
              onChange={setPain}
              subtitle="Optional — report any pain you feel right now."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            className="w-full h-11"
            onClick={submit}
            disabled={submitting || !activity}
            data-testid="submit-recovery-btn"
          >
            {submitting ? 'Submitting...' : activity ? `Submit · +${activity.points} points` : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
