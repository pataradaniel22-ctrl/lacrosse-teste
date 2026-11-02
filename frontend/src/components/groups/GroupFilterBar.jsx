import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useLocation } from 'react-router-dom';
import { Users, Settings2, X } from 'lucide-react';
import { colorOf, useAthleteGroups, useGroupFilter } from '../../lib/athleteGroups';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Quick group filter: "All · Competition 12 · Training Camp 20 ...".
 * The choice applies to every staff page until it is changed.
 */
export default function GroupFilterBar({ getAuthHeaders, isAdmin }) {
  const groups = useAthleteGroups();
  const [group, setGroup] = useGroupFilter();
  const [counts, setCounts] = useState(null);
  const auth = useRef(getAuthHeaders);
  auth.current = getAuthHeaders;

  useEffect(() => {
    axios.get(`${API}/staff/athletes`, { ...auth.current(), skipGroupFilter: true })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.athletes || []);
        const c = { __all: list.length };
        list.forEach((a) => (a.groups || []).forEach((g) => { c[g] = (c[g] || 0) + 1; }));
        setCounts(c);
      })
      .catch(() => {});
  }, [groups]);

  if (!groups.length) return null;
  const chip = 'text-xs sm:text-sm px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 whitespace-nowrap';

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="group-filter-bar">
      <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1"><Users className="w-3.5 h-3.5" />Group</span>
      <button
        type="button" onClick={() => setGroup('')} data-testid="group-filter-all"
        className={`${chip} ${!group ? 'bg-primary border-primary text-primary-foreground' : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25'}`}
      >
        All<span className="opacity-70">{counts?.__all ?? ''}</span>
      </button>
      {groups.map((g) => {
        const active = group === g.id;
        const c = colorOf(g.color);
        return (
          <button
            key={g.id} type="button" onClick={() => setGroup(active ? '' : g.id)} data-testid={`group-filter-${g.id}`}
            className={`${chip} ${active ? c.solid : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/25'}`}
          >
            {!active && <span className={`w-2 h-2 rounded-full ${c.dot}`} />}
            {g.name}<span className="opacity-70">{counts ? (counts[g.id] || 0) : ''}</span>
            {active && <X className="w-3.5 h-3.5 opacity-80" />}
          </button>
        );
      })}
      {isAdmin && (
        <Link to="/staff/admin?tab=groups" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-1" data-testid="group-filter-manage">
          <Settings2 className="w-3.5 h-3.5" />Manage
        </Link>
      )}
    </div>
  );
}

/** Thin reminder shown on other staff pages while a group filter is on. */
export function GroupFilterNotice() {
  const groups = useAthleteGroups();
  const [group, setGroup] = useGroupFilter();
  const { pathname } = useLocation();
  const g = groups.find((x) => x.id === group);
  if (!g || !pathname.startsWith('/staff') || pathname === '/staff' || pathname.startsWith('/staff/admin')) return null;
  return (
    <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-40" data-testid="group-filter-notice">
      <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur ${colorOf(g.color).solid}`}>
        Showing only: <b>{g.name}</b>
        <button type="button" onClick={() => setGroup('')} className="ml-1 rounded-full hover:opacity-70" aria-label="Clear group filter" data-testid="group-filter-notice-clear">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
