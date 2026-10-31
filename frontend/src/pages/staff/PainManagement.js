import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import axios from 'axios';
import { ArrowLeft, Activity, Save, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_OPTIONS = ['Not reviewed', 'Monitoring', 'Rest prescribed', 'Referred to physio', 'Cleared'];
const STATUS_STYLE = {
  'Not reviewed': 'text-muted-foreground border-white/10 bg-muted/20',
  'Monitoring': 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  'Rest prescribed': 'text-blue-400 border-blue-500/40 bg-blue-500/10',
  'Referred to physio': 'text-purple-400 border-purple-500/40 bg-purple-500/10',
  'Cleared': 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
};
const intensityColor = (v) => (v >= 8 ? 'text-red-400' : v >= 5 ? 'text-amber-400' : 'text-muted-foreground');
const keyOf = (c) => `${c.athlete_id}|${c.region}|${c.side}`;

export default function PainManagement() {
  const { getAuthHeaders } = useAuth();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('21');
  const [team, setTeam] = useState('all');
  const [hideCleared, setHideCleared] = useState(true);
  const [edits, setEdits] = useState({}); // key -> {status, note}
  const [saving, setSaving] = useState({}); // key -> bool

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const teamP = team !== 'all' ? `&team=${team}` : '';
      const res = await axios.get(`${API}/staff/pain-management?days=${days}${teamP}`, getAuthHeaders());
      setCases(res.data.cases || []);
      const e = {};
      (res.data.cases || []).forEach((c) => { e[keyOf(c)] = { status: c.follow_up_status, note: c.follow_up_note || '' }; });
      setEdits(e);
    } catch (err) {
      toast.error('Failed to load pain cases.');
    } finally {
      setLoading(false);
    }
  }, [days, team, getAuthHeaders]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const save = async (c) => {
    const k = keyOf(c);
    const edit = edits[k] || { status: 'Not reviewed', note: '' };
    setSaving((s) => ({ ...s, [k]: true }));
    try {
      const res = await axios.post(`${API}/staff/pain-followup`, {
        athlete_id: c.athlete_id, region: c.region, side: c.side, status: edit.status, note: edit.note,
      }, getAuthHeaders());
      const fu = res.data.follow_up;
      setCases((prev) => prev.map((x) => (keyOf(x) === k
        ? { ...x, follow_up_status: fu.status, follow_up_note: fu.note || '', follow_up_updated_by: fu.updated_by, follow_up_updated_at: fu.updated_at }
        : x)));
      toast.success('Follow-up saved.');
    } catch (err) {
      toast.error('Could not save follow-up.');
    } finally {
      setSaving((s) => ({ ...s, [k]: false }));
    }
  };

  const visible = cases.filter((c) => !(hideCleared && (edits[keyOf(c)]?.status || c.follow_up_status) === 'Cleared'));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-white/10 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 flex items-center gap-3">
          <Link to="/staff"><Button variant="ghost" size="icon" className="h-9 w-9" data-testid="pain-back-btn"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-red-400" />
            <div>
              <h1 className="text-lg font-bold leading-tight">Pain Management</h1>
              <p className="text-xs text-muted-foreground">Review reported pain and record staff follow-up</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="w-40 h-9" data-testid="pain-team-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              <SelectItem value="Brazil Lacrosse Men">Men</SelectItem>
              <SelectItem value="Brazil Lacrosse Women">Women</SelectItem>
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36 h-9" data-testid="pain-window-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="21">Last 21 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={hideCleared ? 'default' : 'outline'} size="sm" className="h-9" onClick={() => setHideCleared((v) => !v)} data-testid="pain-hide-cleared">
            {hideCleared ? 'Hiding cleared' : 'Show cleared'}
          </Button>
          <span className="text-sm text-muted-foreground ml-auto" data-testid="pain-count">{visible.length} case(s)</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
        ) : visible.length === 0 ? (
          <Card className="glass-light border-white/5"><CardContent className="py-10 text-center text-muted-foreground" data-testid="pain-empty">No pain cases in this window.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {visible.map((c) => {
              const k = keyOf(c);
              const edit = edits[k] || { status: 'Not reviewed', note: '' };
              const style = STATUS_STYLE[edit.status] || STATUS_STYLE['Not reviewed'];
              return (
                <Card key={k} className="glass-light border-white/5" data-testid={`pain-case-${k}`}>
                  <CardContent className="p-3 flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex items-center gap-3 min-w-0 lg:w-72">
                      <div className={`text-2xl font-bold tabular-nums ${intensityColor(c.latest_intensity)}`}>{c.latest_intensity}</div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{c.athlete}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.region} · {c.side}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs lg:w-72">
                      <div><p className="text-muted-foreground">Context</p><p className="font-medium truncate">{c.latest_context}</p></div>
                      <div><p className="text-muted-foreground">Last</p><p className="font-medium">{c.latest_date}</p></div>
                      <div><p className="text-muted-foreground">Consec.</p><p className="font-medium">{c.consecutive_days}d · {c.reports_count} rep</p></div>
                    </div>
                    <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <Select value={edit.status} onValueChange={(v) => setEdits((e) => ({ ...e, [k]: { ...edit, status: v } }))}>
                        <SelectTrigger className={`h-9 sm:w-44 border ${style}`} data-testid={`pain-status-${k}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input
                        value={edit.note}
                        onChange={(ev) => setEdits((e) => ({ ...e, [k]: { ...edit, note: ev.target.value } }))}
                        placeholder="Staff note (optional)"
                        className="h-9 flex-1"
                        data-testid={`pain-note-${k}`}
                      />
                      <Button size="sm" className="h-9" onClick={() => save(c)} disabled={saving[k]} data-testid={`pain-save-${k}`}>
                        {saving[k] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span className="ml-1 hidden sm:inline">Save</span>
                      </Button>
                    </div>
                  </CardContent>
                  {c.follow_up_updated_at && (
                    <div className="px-3 pb-2 -mt-1 text-[10px] text-muted-foreground" data-testid={`pain-updated-${k}`}>
                      Last updated {c.follow_up_updated_at.slice(0, 16).replace('T', ' ')}{c.follow_up_updated_by ? ` by ${c.follow_up_updated_by}` : ''}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
