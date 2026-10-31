import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { ClipboardList, Check } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function SurveyRunner({ survey, onDone }) {
  const { getAuthHeaders } = useAuth();
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const setSingle = (qid, opt) => setAnswers((s) => ({ ...s, [qid]: { ...s[qid], selected: [opt] } }));
  const toggleMulti = (qid, opt) => setAnswers((s) => {
    const cur = new Set(s[qid]?.selected || []);
    cur.has(opt) ? cur.delete(opt) : cur.add(opt);
    return { ...s, [qid]: { ...s[qid], selected: [...cur] } };
  });
  const setOther = (qid, v) => setAnswers((s) => ({ ...s, [qid]: { ...s[qid], other_text: v } }));
  const setText = (qid, v) => setAnswers((s) => ({ ...s, [qid]: { ...s[qid], text: v } }));

  const submit = async () => {
    // client-side required check
    for (const q of survey.questions) {
      if (!q.required) continue;
      const a = answers[q.id] || {};
      const ok = (a.selected && a.selected.length) || (a.other_text && a.other_text.trim()) || (a.text && a.text.trim());
      if (!ok) { toast.error(`Please answer: ${q.text}`); return; }
    }
    setSubmitting(true);
    try {
      const payload = { answers: survey.questions.map((q) => ({
        question_id: q.id,
        selected: answers[q.id]?.selected || [],
        other_text: answers[q.id]?.other_text || null,
        text: answers[q.id]?.text || null,
      })) };
      await axios.post(`${API}/surveys/${survey.id}/respond`, payload, getAuthHeaders());
      toast.success('Thanks! Your answers were saved.');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 py-10" data-testid="survey-runner">
      <Card className="glass-light border-primary/30 w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">{survey.title}</CardTitle>
          </div>
          {survey.description && <p className="text-sm text-muted-foreground">{survey.description}</p>}
          <p className="text-xs text-amber-400 mt-1">
            Please complete this quick survey before your daily entries.{survey.anonymous ? ' Your answers are anonymous.' : ''}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {survey.questions.map((q, qi) => {
            const a = answers[q.id] || {};
            return (
              <div key={q.id} className="space-y-2" data-testid={`survey-q-${qi}`}>
                <Label className="text-sm font-medium">
                  {qi + 1}. {q.text} {q.required && <span className="text-red-400">*</span>}
                </Label>
                {q.type === 'text' ? (
                  <Textarea
                    value={a.text || ''} onChange={(e) => setText(q.id, e.target.value)}
                    className="bg-background/50 border-white/10" rows={3}
                    data-testid={`survey-q-${qi}-text`}
                  />
                ) : (
                  <div className="space-y-1.5">
                    {q.options.map((opt) => {
                      const active = (a.selected || []).includes(opt);
                      return (
                        <button
                          key={opt} type="button"
                          onClick={() => (q.type === 'multi' ? toggleMulti(q.id, opt) : setSingle(q.id, opt))}
                          className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border transition-colors ${active ? 'border-primary bg-primary/15 text-foreground' : 'border-white/10 text-muted-foreground hover:border-white/20'}`}
                          data-testid={`survey-q-${qi}-opt-${opt.replace(/\s+/g, '-').toLowerCase()}`}
                        >
                          <span className={`w-4 h-4 shrink-0 flex items-center justify-center ${q.type === 'multi' ? 'rounded' : 'rounded-full'} border ${active ? 'bg-primary border-primary' : 'border-white/30'}`}>
                            {active && <Check className="w-3 h-3 text-primary-foreground" />}
                          </span>
                          <span className="text-sm">{opt}</span>
                        </button>
                      );
                    })}
                    {q.allow_other && (
                      <input
                        type="text" placeholder="Other..."
                        value={a.other_text || ''} onChange={(e) => setOther(q.id, e.target.value)}
                        className="w-full mt-1 px-3 py-2 rounded-lg bg-background/50 border border-white/10 text-sm"
                        data-testid={`survey-q-${qi}-other`}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Button onClick={submit} disabled={submitting} className="w-full" data-testid="survey-submit">
            {submitting ? 'Submitting...' : 'Submit & continue'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SurveyGate({ children }) {
  const { getAuthHeaders } = useAuth();
  const [pending, setPending] = useState(null); // null=loading, []=none

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/surveys/pending`, getAuthHeaders());
      setPending(r.data?.surveys || []);
    } catch (e) {
      setPending([]); // fail open so daily entries are never blocked by an error
    }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  if (pending === null) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-primary animate-pulse">Loading...</div>;
  }
  if (pending.length > 0) {
    return <SurveyRunner survey={pending[0]} onDone={load} />;
  }
  return children;
}
