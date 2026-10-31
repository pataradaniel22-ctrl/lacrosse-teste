import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, HeartPulse, AlertTriangle, Phone, Activity, TrendingUp, Download } from 'lucide-react';
import { HelpTooltip, ChartCaption } from '../../components/ui/help-tooltip';
import { HealthPeriodExplorer } from '../../components/health/HealthPeriodExplorer';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const bandColor = (band) => ({
  high: 'text-red-400 border-red-500/40 bg-red-500/10',
  moderate: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  minimal: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  none: 'text-muted-foreground border-white/10 bg-muted/20',
}[band] || 'text-muted-foreground border-white/10');

const availLabel = { full: 'Full', modified: 'Modified', unavailable: 'Unavailable', not_updated: 'Not updated' };
const availColor = { full: 'text-emerald-400', modified: 'text-amber-400', unavailable: 'text-red-400', not_updated: 'text-muted-foreground' };

const Sparkline = ({ values }) => {
  if (!values || values.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(100, ...values);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {values.map((v, i) => (
        <div key={i} className="w-2 rounded-sm bg-cyan-500/70" style={{ height: `${Math.max(8, (v / max) * 100)}%` }} title={`${v}`} />
      ))}
    </div>
  );
};

export default function HealthSurveillance() {
  const { getAuthHeaders } = useAuth();
  const [overview, setOverview] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [substantial, setSubstantial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewVisible, setReviewVisible] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, a, s, al] = await Promise.all([
        axios.get(`${API}/health/staff/overview`, getAuthHeaders()),
        axios.get(`${API}/health/staff/athletes`, getAuthHeaders()),
        axios.get(`${API}/health/staff/substantial`, getAuthHeaders()),
        axios.get(`${API}/health/staff/alerts`, getAuthHeaders()),
      ]);
      setOverview(o.data); setAthletes(a.data); setSubstantial(s.data); setAlerts(al.data.alerts || []);
    } catch (e) {
      toast.error('Failed to load health surveillance data');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  const openProfile = async (athleteId) => {
    setProfileLoading(true); setProfile({ loading: true });
    try {
      const res = await axios.get(`${API}/health/staff/athlete/${athleteId}`, getAuthHeaders());
      setProfile(res.data);
    } catch (e) {
      toast.error('Failed to load athlete health profile'); setProfile(null);
    } finally { setProfileLoading(false); }
  };

  const downloadReport = async (url, fallbackName) => {
    try {
      toast.info('Generating report…');
      const res = await axios.get(url, { ...getAuthHeaders(), responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      link.download = match ? match[1] : fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      toast.error('Failed to generate the report');
    }
  };

  const latestSubmission = (p) => {
    if (!p?.submissions?.length) return null;
    return [...p.submissions].sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))[0];
  };

  const submitReview = async (submissionId, markReviewed) => {
    if (!submissionId) return;
    if (!reviewNote.trim() && !markReviewed) { toast.error('Write a note or mark as reviewed'); return; }
    setSavingReview(true);
    try {
      await axios.post(`${API}/health/staff/review/${submissionId}`, {
        note: reviewNote.trim(),
        visible_to_athlete: reviewVisible,
        mark_reviewed: markReviewed,
      }, getAuthHeaders());
      toast.success(markReviewed ? 'Marked as reviewed' : 'Note added');
      setReviewNote(''); setReviewVisible(false);
      if (profile?.athlete?.id) await openProfile(profile.athlete.id);
      load();
    } catch (e) {
      toast.error('Failed to save review');
    } finally {
      setSavingReview(false);
    }
  };

  const alertMeta = {
    substantial: { label: 'Substantial problem', color: 'border-red-500/40 bg-red-500/10 text-red-300' },
    contact: { label: 'Contact requested', color: 'border-orange-500/40 bg-orange-500/10 text-orange-300' },
    worsening: { label: 'Worsening 2+ weeks', color: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    correction: { label: 'Correction requested', color: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300' },
  };

  const deleteSubmission = async (submissionId) => {
    if (!submissionId) return;
    if (!window.confirm('Delete this health check submission? This removes it and any health problems it created, and recalculates metrics. This cannot be undone.')) return;
    setSavingReview(true);
    try {
      await axios.delete(`${API}/health/staff/submission/${submissionId}`, getAuthHeaders());
      toast.success('Submission deleted');
      if (profile?.athlete?.id) await openProfile(profile.athlete.id);
      load();
    } catch (e) {
      toast.error('Failed to delete submission');
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/staff" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <HeartPulse className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="font-heading font-bold text-lg leading-none">Health Surveillance</h1>
            <p className="text-xs text-muted-foreground">Weekly OSTRC-H2 health monitoring</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
            onClick={() => downloadReport(`${API}/health/staff/report/team`, 'team_health_report.pdf')}
            data-testid="team-health-report-btn"
          >
            <Download className="w-4 h-4 mr-1.5" /> Team Report
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <p className="text-center text-muted-foreground py-20">Loading…</p>
        ) : (
          <>
            {/* Health Alerts */}
            {alerts.length > 0 && (
              <Card className="glass-light border-red-500/20" data-testid="health-alerts-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" /> Health Alerts
                    <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px]">
                      {alerts.filter((a) => !a.handled).length} active
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.map((al) => {
                    const meta = alertMeta[al.type] || { label: al.type, color: 'border-white/10 bg-muted/20 text-foreground' };
                    return (
                      <div
                        key={al.id}
                        className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border ${al.handled ? 'border-white/5 bg-muted/10 opacity-60' : meta.color}`}
                        data-testid={`health-alert-${al.athlete_id}-${al.type}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{al.athlete_name}</span>
                            <Badge variant="outline" className="text-[9px] border-current/40">{meta.label}</Badge>
                            {al.handled && <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300">Reviewed</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{al.message}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`mailto:${al.athlete_email}`}
                            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                            data-testid={`alert-contact-${al.athlete_id}`}
                          >
                            <Phone className="w-3.5 h-3.5" /> Contact
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => openProfile(al.athlete_id)}
                            data-testid={`alert-review-${al.athlete_id}`}
                          >
                            Review
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="health-kpis">
              {[
                { l: 'Response rate', v: `${overview.response_rate}%`, sub: `${overview.submitted_this_week}/${overview.total_athletes} this week`, c: 'text-cyan-400' },
                { l: 'With problems', v: overview.athletes_with_problems, sub: 'athletes', c: 'text-amber-400' },
                { l: 'Substantial', v: overview.substantial_problems, sub: 'health problems', c: 'text-red-400' },
                { l: 'Contact requests', v: overview.contact_requests, sub: 'awaiting follow-up', c: 'text-orange-400' },
              ].map((k) => (
                <Card key={k.l} className="glass-light border-white/5">
                  <CardContent className="p-4">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.l}</p>
                    <p className={`text-3xl font-bold ${k.c}`}>{k.v}</p>
                    <p className="text-xs text-muted-foreground">{k.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <ChartCaption metricKey="healthResponseRate" className="mt-0" />

            <HealthPeriodExplorer teams={[...new Set(athletes.map((a) => a.team).filter(Boolean))].sort()} />

            {/* Distributions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">Severity distribution (athletes with problems)<HelpTooltip metricKey="ostrcSeverity" /></CardTitle></CardHeader>
                <CardContent className="flex gap-2 flex-wrap">
                  {[['high', 'High (50-100)'], ['moderate', 'Moderate (17-49)'], ['minimal', 'Minimal (1-16)']].map(([band, label]) => (
                    <Badge key={band} variant="outline" className={`${bandColor(band)} text-xs`}>
                      {label}: {overview.severity_distribution[band] || 0}
                    </Badge>
                  ))}
                </CardContent>
                <CardContent className="pt-0"><ChartCaption metricKey="ostrcSeverity" className="mt-0 border-0 pt-0" />
                </CardContent>
              </Card>
              <Card className="glass-light border-white/5">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">Availability<HelpTooltip metricKey="healthAvailability" /></CardTitle></CardHeader>
                <CardContent className="flex gap-2 flex-wrap">
                  {Object.entries(overview.availability_distribution).map(([k, v]) => (
                    <Badge key={k} variant="outline" className={`border-white/10 text-xs ${availColor[k]}`}>{availLabel[k]}: {v}</Badge>
                  ))}
                </CardContent>
                <CardContent className="pt-0"><ChartCaption metricKey="healthAvailability" className="mt-0 border-0 pt-0" />
                </CardContent>
              </Card>
            </div>

            {/* Substantial problems */}
            <Card className="glass-light border-red-500/20" data-testid="substantial-section">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-4 h-4" /> Substantial Health Problems
                  <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px]">{substantial.length}</Badge>
                  <HelpTooltip metricKey="substantialProblem" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {substantial.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No substantial health problems this week.</p>
                ) : (
                  <div className="space-y-2">
                    {substantial.map((p) => (
                      <button key={p.id} onClick={() => openProfile(p.athlete_id)}
                        className="w-full flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/15 hover:bg-red-500/10 transition-colors text-left"
                        data-testid={`substantial-${p.id}`}>
                        <div>
                          <p className="font-medium text-sm">{p.athlete_name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {p.problem_category}{p.body_region ? ` · ${p.body_region}` : ''}{p.body_side && p.body_side !== 'na' ? ` (${p.body_side})` : ''} · {p.total_weeks_reported}w
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.requested_medical_contact && <Phone className="w-4 h-4 text-orange-400" />}
                          <Badge variant="outline" className={`${bandColor(p.current_severity_score >= 50 ? 'high' : 'moderate')} text-xs`}>{p.current_severity_score}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <ChartCaption metricKey="substantialProblem" />
              </CardContent>
            </Card>

            {/* Athlete table */}
            <Card className="glass-light border-white/5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">All athletes</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="health-athletes-table">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-white/5">
                        <th className="text-left py-2 font-medium">Athlete</th>
                        <th className="text-left py-2 font-medium">Status</th>
                        <th className="text-left py-2 font-medium">Problems</th>
                        <th className="text-left py-2 font-medium">Severity</th>
                        <th className="text-left py-2 font-medium">Availability</th>
                        <th className="text-left py-2 font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {athletes.map((a) => (
                        <tr key={a.athlete_id} onClick={() => openProfile(a.athlete_id)}
                          className="border-b border-white/5 cursor-pointer hover:bg-white/5" data-testid={`health-row-${a.athlete_id}`}>
                          <td className="py-2.5">
                            <span className="font-medium">{a.name}</span>
                            {a.substantial && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-red-500" title="Substantial" />}
                            {a.contact_requested && <Phone className="w-3 h-3 text-orange-400 inline ml-1.5" />}
                          </td>
                          <td className="py-2.5">
                            <Badge variant="outline" className={`text-[10px] ${a.status === 'completed' ? 'border-emerald-500/40 text-emerald-400' : a.status === 'overdue' ? 'border-orange-500/40 text-orange-400' : 'border-white/10 text-muted-foreground'}`}>
                              {a.status}
                            </Badge>
                          </td>
                          <td className="py-2.5">{a.active_problems || <span className="text-muted-foreground">0</span>}</td>
                          <td className="py-2.5">
                            {a.active_problems > 0 ? <Badge variant="outline" className={`${bandColor(a.severity_band)} text-xs`}>{a.current_severity}</Badge> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={`py-2.5 text-xs ${availColor[a.availability]}`}>{availLabel[a.availability]}</td>
                          <td className="py-2.5"><Sparkline values={a.trend} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Athlete health profile modal */}
      <Dialog open={!!profile} onOpenChange={(o) => !o && setProfile(null)}>
        <DialogContent className="bg-background border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="health-profile-modal">
          {profileLoading || profile?.loading ? (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>Athlete health profile</DialogTitle>
                <DialogDescription>Loading health profile</DialogDescription>
              </DialogHeader>
              <p className="py-10 text-center text-muted-foreground">Loading profile…</p>
            </>
          ) : profile?.athlete ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-cyan-400" /> {profile.athlete.name}
                </DialogTitle>
                <DialogDescription>{profile.athlete.team} · {profile.athlete.position || '—'}</DialogDescription>
              </DialogHeader>
              <Button
                variant="outline"
                size="sm"
                className="w-full border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                onClick={() => downloadReport(`${API}/health/staff/report/athlete/${profile.athlete.id}`, 'athlete_health_report.pdf')}
                data-testid="athlete-health-report-btn"
              >
                <Download className="w-4 h-4 mr-1.5" /> Download Athlete Health Report (PDF)
              </Button>
              {(() => {
                const latest = latestSubmission(profile);
                if (!latest) return null;
                const notes = latest.medical_notes || [];
                return (
                  <Card className="glass-light border-white/5 my-3" data-testid="medical-review-panel">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        Medical Review
                        {latest.review_status === 'reviewed' ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">Reviewed</Badge>
                        ) : latest.review_status === 'in_review' ? (
                          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">In review</Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px]">Not reviewed</Badge>
                        )}
                      </CardTitle>
                      {latest.reviewed_by && (
                        <p className="text-[11px] text-muted-foreground">Reviewed by {latest.reviewed_by} · {latest.reviewed_at?.slice(0, 10)}</p>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {latest.correction_requested && (
                        <div className="p-2 rounded bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 text-xs" data-testid="correction-banner">
                          ⚠ Athlete reported an error in this submission{latest.correction_reason ? `: "${latest.correction_reason}"` : ''}. Review and delete if incorrect.
                        </div>
                      )}
                      {notes.length > 0 && (
                        <div className="space-y-2">
                          {notes.map((n) => (
                            <div key={n.id} className={`text-xs p-2 rounded border ${n.from_athlete ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-muted/30 border-white/5'}`} data-testid={`review-note-${n.id}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{n.author}{n.from_athlete ? ' (athlete)' : ''}</span>
                                <div className="flex items-center gap-1">
                                  {n.from_athlete
                                    ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[9px]">Athlete reply</Badge>
                                    : (n.visible_to_athlete
                                      ? <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 text-[9px]">Visible to athlete</Badge>
                                      : <Badge variant="outline" className="border-white/20 text-muted-foreground text-[9px]">Private</Badge>)}
                                  <span className="text-muted-foreground">{n.created_at?.slice(0, 10)}</span>
                                </div>
                              </div>
                              <p className="text-muted-foreground mt-1">{n.text}</p>
                              {!n.from_athlete && n.visible_to_athlete && (
                                <p className="text-[10px] mt-1 text-emerald-400">{n.read_at ? `✓ Read by athlete on ${n.read_at.slice(0, 10)}` : 'Not read yet'}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <Textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="Add a medical note for this athlete…"
                        className="min-h-[70px] text-sm"
                        data-testid="review-note-input"
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reviewVisible}
                          onChange={(e) => setReviewVisible(e.target.checked)}
                          className="accent-cyan-500 w-4 h-4"
                          data-testid="review-visible-checkbox"
                        />
                        Make this note visible to the athlete
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingReview}
                          onClick={() => submitReview(latest.id, false)}
                          data-testid="review-add-note-btn"
                        >
                          Add note
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={savingReview || latest.review_status === 'reviewed'}
                          onClick={() => submitReview(latest.id, true)}
                          data-testid="review-mark-reviewed-btn"
                        >
                          Mark as reviewed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-500/40 text-red-300 hover:bg-red-500/10 ml-auto"
                          disabled={savingReview}
                          onClick={() => deleteSubmission(latest.id)}
                          data-testid="review-delete-submission-btn"
                        >
                          Delete submission
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
              <div className="space-y-5">
                {/* Problems with longitudinal history */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Health problems ({profile.problems.length})</p>
                  {profile.problems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No health problems recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {profile.problems.map((p) => (
                        <div key={p.id} className="p-3 rounded-lg bg-muted/30 border border-white/5">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm capitalize">{p.problem_category}{p.body_region ? ` · ${p.body_region}` : ''}{p.body_side && p.body_side !== 'na' ? ` (${p.body_side})` : ''}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.first_reported_date} → {p.last_reported_date} · {p.total_weeks_reported} week(s) · <span className="capitalize">{p.status}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              {p.substantial_problem && <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px] mb-1">Substantial</Badge>}
                              <Badge variant="outline" className={`${bandColor(p.current_severity_score >= 50 ? 'high' : p.current_severity_score >= 17 ? 'moderate' : 'minimal')} text-xs block`}>Now: {p.current_severity_score}</Badge>
                            </div>
                          </div>
                          {p.athlete_description && <p className="text-xs italic text-muted-foreground mt-2">"{p.athlete_description}"</p>}
                          {/* Longitudinal severity */}
                          {p.observations?.length > 0 && (
                            <div className="mt-3 flex items-end gap-1 h-10 border-t border-white/5 pt-2">
                              {p.observations.map((o, i) => (
                                <div key={i} className="flex flex-col items-center gap-0.5" title={`${o.reporting_period_end}: ${o.severity_score}`}>
                                  <div className={`w-4 rounded-sm ${o.substantial_problem ? 'bg-red-500/70' : 'bg-cyan-500/60'}`} style={{ height: `${Math.max(6, (o.severity_score / 100) * 32)}px` }} />
                                </div>
                              ))}
                              <span className="text-[10px] text-muted-foreground ml-2 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> weekly severity</span>
                            </div>
                          )}
                          {p.requested_medical_contact && <p className="text-xs text-orange-400 mt-2 flex items-center gap-1"><Phone className="w-3 h-3" /> Contact requested</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Submission timeline */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Weekly submissions ({profile.submissions.length})</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {profile.submissions.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
                        <span>{s.reporting_period_end || s.submitted_at?.slice(0, 10)}</span>
                        <div className="flex items-center gap-2">
                          {s.submitted_late && <Badge variant="outline" className="border-orange-500/30 text-orange-400 text-[9px]">late</Badge>}
                          {s.has_health_problem ? (
                            <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[9px]">{s.number_of_reported_problems} problem(s) · sev {s.highest_severity_score}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[9px]">no problem</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
