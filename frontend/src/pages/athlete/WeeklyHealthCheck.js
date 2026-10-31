import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import axios from 'axios';
import { HeartPulse, ArrowLeft, Check, Plus, ShieldCheck, Phone, WifiOff, RefreshCw, CloudUpload } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PENDING_KEY = 'bl_health_pending';
const DRAFT_KEY = 'bl_health_draft';
const genId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const readQueue = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
const writeQueue = (q) => localStorage.setItem(PENDING_KEY, JSON.stringify(q));

const CATEGORIES = [
  { code: 'injury', label: 'Injury' },
  { code: 'illness', label: 'Illness' },
  { code: 'pain', label: 'Pain / physical complaint' },
  { code: 'psychological', label: 'Mental health concern' },
  { code: 'other', label: 'Other health problem' },
];
const BODY_REGIONS = ['Head/Neck', 'Shoulder', 'Arm/Elbow', 'Wrist/Hand', 'Chest/Back', 'Hip/Groin', 'Thigh', 'Knee', 'Lower leg', 'Ankle/Foot'];
const SIDES = [{ v: 'left', l: 'Left' }, { v: 'right', l: 'Right' }, { v: 'both', l: 'Both' }, { v: 'na', l: 'N/A' }];
const ONSET = [{ v: 'sudden', l: 'Sudden' }, { v: 'gradual', l: 'Gradual' }];

const emptyProblem = () => ({ ostrc: {}, category: null, body_region: null, body_side: null, onset_type: null, description: '', request_contact: false });

export default function WeeklyHealthCheck() {
  const { getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [phase, setPhase] = useState('intro'); // intro|ostrc|details|another|review|submitting|done
  const [qIndex, setQIndex] = useState(0);
  const [current, setCurrent] = useState(emptyProblem());
  const [problems, setProblems] = useState([]);
  const [result, setResult] = useState(null);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(readQueue().length);
  const [syncing, setSyncing] = useState(false);
  const startedAt = useRef(new Date().toISOString());
  const flushingRef = useRef(false);

  const flushPending = useCallback(async () => {
    if (flushingRef.current) return;
    const queue = readQueue();
    if (!queue.length) { setPendingCount(0); return; }
    flushingRef.current = true;
    setSyncing(true);
    const remaining = [];
    let synced = 0;
    for (const item of queue) {
      try {
        await axios.post(`${API}/health/submit`, item, getAuthHeaders());
        synced += 1;
      } catch (e) {
        if (e.response && e.response.status >= 400 && e.response.status < 500 && e.response.status !== 409) {
          // permanent client error (e.g., validation) — drop to avoid infinite retry
          synced += 0;
        } else {
          remaining.push(item);
        }
      }
    }
    writeQueue(remaining);
    setPendingCount(remaining.length);
    setSyncing(false);
    flushingRef.current = false;
    if (synced > 0) toast.success(`${synced} offline health check${synced > 1 ? 's' : ''} synced`);
  }, [getAuthHeaders]);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/health/questionnaire`, getAuthHeaders());
      setQuestions(res.data.questions);
    } catch (e) {
      toast.error('Failed to load the health check');
    }
  }, [getAuthHeaders]);
  useEffect(() => { load(); }, [load]);

  // Connectivity + background sync of offline submissions
  useEffect(() => {
    const goOnline = () => { setOnline(true); flushPending(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (navigator.onLine) flushPending();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flushPending]);

  const q = questions[qIndex];
  const QCODES = ['OSTRC_Q1_PARTICIPATION', 'OSTRC_Q2_MODIFICATION', 'OSTRC_Q3_PERFORMANCE', 'OSTRC_Q4_SYMPTOMS'];

  const finalizeNoProblem = async () => {
    await doSubmit([], true);
  };

  const handleAnswer = async (optionCode) => {
    const code = q.code;
    const ans = { ...current.ostrc, [code]: optionCode };
    setCurrent((c) => ({ ...c, ostrc: ans }));

    if (qIndex === 0) {
      if (optionCode === 'a') {
        // Full participation without health problems
        if (problems.length === 0) { await finalizeNoProblem(); return; }
        // Adding another but no problem -> skip this entry
        setPhase('another'); return;
      }
      if (optionCode === 'd') { setPhase('details'); return; } // could not participate -> skip Q2-4
      setQIndex(1); return;
    }
    if (qIndex < 3) { setQIndex(qIndex + 1); return; }
    // answered Q4
    setPhase('details');
  };

  const goBack = () => {
    if (phase === 'ostrc') {
      if (qIndex === 0) { setPhase('intro'); return; }
      setQIndex(qIndex - 1); return;
    }
    if (phase === 'details') {
      const a = current.ostrc;
      if (a.OSTRC_Q1_PARTICIPATION === 'd') { setPhase('ostrc'); setQIndex(0); return; }
      setPhase('ostrc'); setQIndex(3); return;
    }
    if (phase === 'another' || phase === 'review') { setPhase('details'); return; }
  };

  const saveProblem = () => {
    if (!current.category) { toast.error('Please select a problem category'); return; }
    setProblems((p) => [...p, current]);
    setCurrent(emptyProblem());
    setPhase('another');
  };

  const addAnother = () => { setCurrent(emptyProblem()); setQIndex(0); setPhase('ostrc'); };

  const doSubmit = async (probs, noProblem) => {
    setPhase('submitting');
    const payload = {
      client_submission_id: genId(),
      no_problem: noProblem,
      started_at: startedAt.current,
      completion_time_seconds: Math.round((Date.now() - new Date(startedAt.current).getTime()) / 1000),
      offline_submission: false,
      problems: (probs || []).map((p) => ({
        ostrc: p.ostrc,
        category: p.category,
        body_region: p.body_region,
        body_side: p.body_side,
        onset_type: p.onset_type,
        description: p.description,
        request_contact: p.request_contact,
      })),
    };

    const queueOffline = () => {
      const queue = readQueue();
      queue.push({ ...payload, offline_submission: true });
      writeQueue(queue);
      setPendingCount(queue.length);
      localStorage.removeItem(DRAFT_KEY);
      setResult({ no_problem: noProblem, offline: true, problems: payload.problems });
      setPhase('done');
      toast.success('Saved on your device. It will sync automatically when you are back online.');
    };

    if (!navigator.onLine) { queueOffline(); return; }
    try {
      const res = await axios.post(`${API}/health/submit`, payload, getAuthHeaders());
      setResult(res.data);
      localStorage.removeItem(DRAFT_KEY);
      setPhase('done');
    } catch (e) {
      if (!e.response) { queueOffline(); return; } // network failure -> save offline
      toast.error(e.response?.data?.detail || 'Could not submit your health check. Your answers have not been lost.');
      setPhase('review');
    }
  };

  const progressPct = phase === 'ostrc' ? ((qIndex + 1) / 4) * 100 : phase === 'details' ? 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Offline / sync status */}
      {(!online || pendingCount > 0) && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-center gap-2 ${online ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-500/15 text-amber-300'}`}
          data-testid="health-sync-status"
        >
          {!online ? (
            <><WifiOff className="w-3.5 h-3.5" /> Offline — your answers will be saved on this device and synced later</>
          ) : syncing ? (
            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Syncing {pendingCount} saved check{pendingCount > 1 ? 's' : ''}…</>
          ) : (
            <>
              <CloudUpload className="w-3.5 h-3.5" /> {pendingCount} saved check{pendingCount > 1 ? 's' : ''} waiting to sync
              <button onClick={flushPending} className="underline ml-1" data-testid="health-sync-retry">Retry now</button>
            </>
          )}
        </div>
      )}
      {/* Sticky progress */}
      {(phase === 'ostrc' || phase === 'details') && (
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5">
          <div className="h-1 bg-white/5">
            <div className="h-1 bg-cyan-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="px-4 py-2 flex items-center justify-between">
            <button onClick={goBack} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm" data-testid="health-back-btn">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <span className="text-xs text-muted-foreground">
              {problems.length > 0 ? `Problem ${problems.length + 1} • ` : ''}
              {phase === 'ostrc' ? `Question ${qIndex + 1} of 4` : 'Additional details'}
            </span>
          </div>
        </div>
      )}

      <main className="max-w-xl mx-auto px-4 py-6 pb-28">
        {/* INTRO */}
        {phase === 'intro' && (
          <div className="text-center animate-fade-in" data-testid="health-intro">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 flex items-center justify-center mx-auto mb-4">
              <HeartPulse className="w-8 h-8 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Weekly Health Check</h1>
            <p className="text-muted-foreground mb-4">Help us monitor your health over the last 7 days. Report ANY health problem.</p>
            <div className="text-left bg-muted/30 rounded-xl p-4 text-sm text-muted-foreground mb-4">
              This includes injuries, illnesses, pain, physical symptoms, mental health symptoms, overuse problems and medical conditions — even if you continued training.
              <p className="mt-2 text-xs">This questionnaire helps our medical staff support you better. It is NOT used to judge performance. Estimated time: 1–2 minutes.</p>
            </div>
            <Button className="w-full h-12 bg-cyan-600 hover:bg-cyan-700" onClick={() => { setPhase('ostrc'); setQIndex(0); }} data-testid="health-start-btn">
              Start
            </Button>
            <p className="text-[11px] text-muted-foreground mt-4">This questionnaire is not monitored continuously. In a medical emergency, contact local emergency services or follow your team's emergency plan.</p>
          </div>
        )}

        {/* OSTRC QUESTION */}
        {phase === 'ostrc' && q && (
          <div className="animate-fade-in" data-testid={`health-question-${qIndex + 1}`}>
            <h2 className="text-lg font-semibold mb-5 leading-snug">{q.text}</h2>
            <div className="space-y-3">
              {q.options.map((opt) => {
                const selected = current.ostrc[q.code] === opt.code;
                return (
                  <button
                    key={opt.code}
                    onClick={() => handleAnswer(opt.code)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${selected ? 'bg-cyan-500/20 border-cyan-500/60' : 'bg-background/50 border-white/10 hover:border-white/30'}`}
                    data-testid={`health-answer-${q.code}-${opt.code}`}
                  >
                    {opt.text}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ADDITIONAL DETAILS */}
        {phase === 'details' && (
          <div className="animate-fade-in space-y-5" data-testid="health-details">
            <div className="bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground">
              These details help the medical team understand and follow up on your report. They are not included in the OSTRC-H2 Severity Score.
            </div>
            <div>
              <Label className="text-sm">Problem category</Label>
              <div className="mt-2 flex flex-wrap gap-2" data-testid="health-category">
                {CATEGORIES.map((c) => (
                  <button key={c.code} onClick={() => setCurrent((x) => ({ ...x, category: c.code }))}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${current.category === c.code ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                    data-testid={`health-category-${c.code}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {(current.category === 'injury' || current.category === 'pain') && (
              <>
                <div>
                  <Label className="text-sm">Body region</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {BODY_REGIONS.map((r) => (
                      <button key={r} onClick={() => setCurrent((x) => ({ ...x, body_region: r }))}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${current.body_region === r ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Side</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SIDES.map((s) => (
                      <button key={s.v} onClick={() => setCurrent((x) => ({ ...x, body_side: s.v }))}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${current.body_side === s.v ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}>
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Onset</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ONSET.map((o) => (
                      <button key={o.v} onClick={() => setCurrent((x) => ({ ...x, onset_type: o.v }))}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${current.onset_type === o.v ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div>
              <Label className="text-sm">Short description {current.category === 'psychological' && '(optional — you may prefer not to describe)'}</Label>
              <Textarea className="mt-2 bg-background/50 border-white/10" rows={3}
                value={current.description} onChange={(e) => setCurrent((x) => ({ ...x, description: e.target.value }))}
                placeholder="Briefly describe the problem" data-testid="health-description" />
            </div>
            <button onClick={() => setCurrent((x) => ({ ...x, request_contact: !x.request_contact }))}
              className={`w-full flex items-center gap-2 p-3 rounded-xl border text-sm transition-colors ${current.request_contact ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-background/50 border-white/10 text-muted-foreground'}`}
              data-testid="health-request-contact">
              <Phone className="w-4 h-4" /> Request contact from medical staff
              {current.request_contact && <Check className="w-4 h-4 ml-auto" />}
            </button>
            <Button className="w-full h-12 bg-cyan-600 hover:bg-cyan-700" onClick={saveProblem} data-testid="health-save-problem">
              Save this problem
            </Button>
          </div>
        )}

        {/* ANOTHER */}
        {phase === 'another' && (
          <div className="animate-fade-in text-center" data-testid="health-another">
            <h2 className="text-lg font-semibold mb-2">Do you have another health problem to report from the past 7 days?</h2>
            <p className="text-sm text-muted-foreground mb-6">{problems.length} problem(s) recorded so far.</p>
            <div className="space-y-3">
              <Button variant="outline" className="w-full h-12 border-white/10" onClick={addAnother} data-testid="health-add-another">
                <Plus className="w-4 h-4 mr-2" /> Yes, add another problem
              </Button>
              <Button className="w-full h-12 bg-cyan-600 hover:bg-cyan-700" onClick={() => setPhase('review')} data-testid="health-continue">
                No, continue
              </Button>
            </div>
          </div>
        )}

        {/* REVIEW */}
        {phase === 'review' && (
          <div className="animate-fade-in" data-testid="health-review">
            <h2 className="text-lg font-semibold mb-4">Review your Weekly Health Check</h2>
            {problems.length === 0 ? (
              <p className="text-muted-foreground mb-4">No health problems reported this week.</p>
            ) : (
              <div className="space-y-3 mb-4">
                {problems.map((p, i) => (
                  <div key={i} className="p-3 rounded-xl bg-muted/30 border border-white/5">
                    <p className="font-medium capitalize">{CATEGORIES.find((c) => c.code === p.category)?.label || p.category}</p>
                    {p.body_region && <p className="text-xs text-muted-foreground">{p.body_region}{p.body_side && p.body_side !== 'na' ? ` · ${p.body_side}` : ''}</p>}
                    {p.request_contact && <p className="text-xs text-amber-400 mt-1">Contact requested</p>}
                  </div>
                ))}
              </div>
            )}
            <Button className="w-full h-12 bg-cyan-600 hover:bg-cyan-700" onClick={() => doSubmit(problems, problems.length === 0)} data-testid="health-submit-btn">
              Submit Weekly Health Check
            </Button>
          </div>
        )}

        {phase === 'submitting' && (
          <div className="text-center py-20 text-muted-foreground">Submitting…</div>
        )}

        {/* DONE */}
        {phase === 'done' && result && (
          <div className="text-center animate-fade-in" data-testid="health-done">
            <div className={`w-16 h-16 rounded-2xl ${result.offline ? 'bg-amber-500/15' : 'bg-emerald-500/15'} flex items-center justify-center mx-auto mb-4`}>
              {result.offline ? <CloudUpload className="w-8 h-8 text-amber-400" /> : <ShieldCheck className="w-8 h-8 text-emerald-400" />}
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {result.offline
                ? 'Saved on Your Device'
                : (result.no_problem ? 'Weekly Health Check Complete' : 'Weekly Health Check Submitted')}
            </h1>
            <p className="text-muted-foreground mb-6">
              {result.offline
                ? 'You appear to be offline. Your weekly health check has been saved securely on this device and will be sent automatically once you are back online.'
                : (result.no_problem
                  ? 'You reported no health problems during the past 7 days.'
                  : 'Your health information has been shared with the authorized medical team. The medical team will review your submission according to its priority.')}
            </p>
            {!result.no_problem && (
              <p className="text-sm text-muted-foreground mb-6">{result.problems?.length || 0} problem(s) reported.</p>
            )}
            <div className="space-y-3">
              <Button className="w-full h-12 bg-cyan-600 hover:bg-cyan-700" onClick={() => navigate('/athlete')} data-testid="health-return-home">
                Return to Home
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
