/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import {
  Search, Calendar, ChevronDown, ChevronRight, ImageIcon, X, Download, Users, Filter,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TEAMS = [
  { value: 'all', label: 'All teams' },
  { value: 'Brazil Lacrosse Men', label: 'Men' },
  { value: 'Brazil Lacrosse Women', label: 'Women' },
];
const CATEGORIES = ['all', 'Gold', 'Silver', 'Bronze'];
const PAGE = 60; // proofs rendered per "load more" step

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDay(iso) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export default function RecoveryProofsGallery() {
  const { token, getAuthHeaders } = useAuth();

  const [startDate, setStartDate] = useState(isoDaysAgo(14));
  const [endDate, setEndDate] = useState(todayIso());
  const [team, setTeam] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [collapsed, setCollapsed] = useState({});
  const [lightbox, setLightbox] = useState(null);

  const fileUrl = (id) => `${API}/recovery/files/${id}?auth=${token}`;
  const thumbUrl = (id) => `${API}/recovery/files/${id}?thumb=1&auth=${token}`;

  const fetchProofs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (team !== 'all') params.append('team', team);
      if (category !== 'all') params.append('category', category);
      const res = await axios.get(`${API}/recovery/proofs?${params.toString()}`, getAuthHeaders());
      setProofs(res.data.proofs || []);
      setVisibleCount(PAGE);
    } catch (e) {
      toast.error('Failed to load proofs');
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, team, category, getAuthHeaders]);

  useEffect(() => { fetchProofs(); }, [fetchProofs]);

  // Client-side search by athlete name
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return proofs;
    return proofs.filter((p) => (p.athlete_name || '').toLowerCase().includes(q));
  }, [proofs, search]);

  const visible = filtered.slice(0, visibleCount);

  // Group visible proofs by day (descending)
  const groups = useMemo(() => {
    const map = {};
    visible.forEach((p) => {
      const d = p.date || 'Unknown';
      if (!map[d]) map[d] = [];
      map[d].push(p);
    });
    return Object.keys(map).sort((a, b) => (a < b ? 1 : -1)).map((d) => ({ date: d, items: map[d] }));
  }, [visible]);

  const setQuickRange = (days) => {
    setStartDate(isoDaysAgo(days));
    setEndDate(todayIso());
  };

  const toggleDay = (d) => setCollapsed((s) => ({ ...s, [d]: !s[d] }));

  return (
    <div className="space-y-4" data-testid="recovery-proofs-gallery">
      {/* Filters */}
      <Card className="glass-light border-white/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="w-4 h-4 text-primary" /> Filters
            <Badge variant="outline" className="ml-auto border-white/10 text-xs">{filtered.length} proofs</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> From</Label>
              <Input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 h-9" data-testid="proofs-start-date" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> To</Label>
              <Input type="date" value={endDate} min={startDate} max={todayIso()} onChange={(e) => setEndDate(e.target.value)} className="mt-1 h-9" data-testid="proofs-end-date" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Team</Label>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="mt-1 h-9" data-testid="proofs-team-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEAMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-9" data-testid="proofs-category-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c === 'all' ? 'All categories' : c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search athlete by name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" data-testid="proofs-search" />
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setQuickRange(6)} data-testid="proofs-range-6d">Event (6 days)</Button>
              <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setQuickRange(14)}>14d</Button>
              <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setQuickRange(30)}>30d</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gallery grouped by day */}
      {loading ? (
        <div className="py-12 text-center text-primary text-sm animate-pulse">Loading proofs...</div>
      ) : filtered.length === 0 ? (
        <Card className="glass-light border-white/5">
          <CardContent className="p-10 text-center text-muted-foreground">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
            No proofs found for these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.date];
            return (
              <div key={g.date} data-testid={`proofs-day-${g.date}`}>
                <button
                  onClick={() => toggleDay(g.date)}
                  className="w-full flex items-center gap-2 py-2 px-1 sticky top-0 z-10 bg-background/80 backdrop-blur"
                  data-testid={`proofs-day-toggle-${g.date}`}
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <Calendar className="w-4 h-4 text-primary" />
                  <span className="text-sm font-heading font-bold">{fmtDay(g.date)}</span>
                  <Badge variant="outline" className="ml-2 border-white/10 text-[10px]">{g.items.length} photos</Badge>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-2">
                    {g.items.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setLightbox(p)}
                        className="group relative rounded-lg overflow-hidden border border-white/10 bg-muted/30 aspect-square hover:border-primary/50 transition-colors"
                        data-testid={`proof-${p.id}`}
                      >
                        <img
                          src={thumbUrl(p.file_id)}
                          alt={`${p.athlete_name} proof`}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                          <p className="text-[11px] font-medium text-white truncate">{p.athlete_name}</p>
                          <div className="flex items-center gap-1">
                            {p.category && <span className="text-[9px] text-white/80">{p.category}</span>}
                            {p.activity_name && <span className="text-[9px] text-white/60 truncate">· {p.activity_name}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {visibleCount < filtered.length && (
            <div className="text-center pt-2">
              <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE)} data-testid="proofs-load-more">
                Load more ({filtered.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null); }}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden" data-testid="proof-lightbox">
          <DialogTitle className="sr-only">Proof Details</DialogTitle>
          {lightbox && (
            <div>
              <img src={fileUrl(lightbox.file_id)} alt="proof full" className="w-full max-h-[70vh] object-contain bg-black" />
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{lightbox.athlete_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDay(lightbox.date)}{lightbox.time ? ` · ${lightbox.time}` : ''}
                    {lightbox.activity_name ? ` · ${lightbox.activity_name}` : ''}
                    {lightbox.category ? ` · ${lightbox.category}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={fileUrl(lightbox.file_id)} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" /> Open</Button>
                  </a>
                  <Button variant="ghost" size="icon" onClick={() => setLightbox(null)}><X className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
