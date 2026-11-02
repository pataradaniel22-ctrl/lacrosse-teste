import GroupBadges from '../../components/groups/GroupBadges';
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import axios from 'axios';
import {
  ArrowLeft, Trophy, TrendingUp, TrendingDown, HeartPulse,
  AlertTriangle, Flame, ChevronRight, ArrowDownWideNarrow,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TEAMS = [
  { k: 'all', label: 'All Teams' },
  { k: 'Brazil Lacrosse Men', label: "Men's" },
  { k: 'Brazil Lacrosse Women', label: "Women's" },
];
const WINDOWS = [7, 30, 90];

const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

const RankCard = ({ title, icon: Icon, accent, rows, unit, suffix, emptyText, onOpen, testid }) => (
  <Card className="glass-light border-white/5 animate-fade-in" data-testid={testid}>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        <Icon className={`w-4 h-4 ${accent}`} />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      {!rows || rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <button
              key={r.athlete_id}
              type="button"
              onClick={() => onOpen(r.athlete_id)}
              className="w-full flex items-center justify-between gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-accent transition-colors text-left"
              data-testid={`${testid}-row-${i}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm w-6 text-center shrink-0">{medal(i)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">{(r.team || '').includes('Men') ? "Men's" : "Women's"}</p>
                  <GroupBadges athleteId={r.athlete_id} size="xs" className="mt-0.5" />
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className={`text-xs ${accent} border-current/30`}>
                  {r[unit]}{suffix || ''}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

export default function Rankings() {
  const { getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [team, setTeam] = useState('all');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    try {
      const teamP = team !== 'all' ? `?team=${team}&days=${days}` : `?days=${days}`;
      const res = await axios.get(`${API}/staff/rankings${teamP}`, getAuthHeaders());
      setData(res.data);
    } catch (e) {
      console.error('Failed to load rankings');
    } finally {
      setLoading(false);
    }
  }, [team, days, getAuthHeaders]);

  useEffect(() => { fetchRankings(); }, [fetchRankings]);

  const open = (id) => navigate(`/staff/athlete/${id}`);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link to="/staff" className="text-muted-foreground hover:text-foreground" data-testid="rankings-back"><ArrowLeft className="w-5 h-5" /></Link>
          <Trophy className="w-5 h-5 text-amber-400" />
          <div className="mr-auto">
            <h1 className="font-heading font-bold text-lg leading-none">Athlete Rankings</h1>
            <p className="text-xs text-muted-foreground">Leaderboards over the selected period</p>
          </div>
          <div className="flex items-center gap-1" data-testid="rankings-team-filter">
            {TEAMS.map((t) => (
              <button key={t.k} type="button" onClick={() => setTeam(t.k)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${team === t.k ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                data-testid={`rankings-team-${t.k === 'all' ? 'all' : (t.k.includes('Men') ? 'men' : 'women')}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" data-testid="rankings-window">
            {WINDOWS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${days === d ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 font-medium' : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'}`}
                data-testid={`rankings-window-${d}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <p className="text-center text-muted-foreground py-16">Loading rankings…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RankCard testid="rank-top-adherence" title="Top Adherence" icon={TrendingUp} accent="text-emerald-400"
              rows={data?.top_adherence} unit="adherence_pct" suffix="%" emptyText="No data" onOpen={open} />
            <RankCard testid="rank-low-adherence" title="Lowest Adherence" icon={ArrowDownWideNarrow} accent="text-red-400"
              rows={data?.low_adherence} unit="adherence_pct" suffix="%" emptyText="No data" onOpen={open} />
            <RankCard testid="rank-best-readiness" title="Best Readiness Average" icon={HeartPulse} accent="text-emerald-400"
              rows={data?.best_readiness} unit="readiness_avg" emptyText="No readiness data" onOpen={open} />
            <RankCard testid="rank-worst-readiness" title="Worst Readiness Average" icon={TrendingDown} accent="text-amber-400"
              rows={data?.worst_readiness} unit="readiness_avg" emptyText="No readiness data" onOpen={open} />
            <RankCard testid="rank-most-pain" title="Most Days with Pain Reports" icon={AlertTriangle} accent="text-red-400"
              rows={data?.most_pain_days} unit="pain_days" suffix="d" emptyText="No pain reported 🎉" onOpen={open} />
            <RankCard testid="rank-highest-load" title="Highest Accumulated Load" icon={Flame} accent="text-orange-400"
              rows={data?.highest_load} unit="total_load" suffix=" AU" emptyText="No load data" onOpen={open} />
          </div>
        )}
      </main>
    </div>
  );
}
