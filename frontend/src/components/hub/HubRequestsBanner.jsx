import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ClipboardList, ChevronRight } from 'lucide-react';
import { API } from '../../lib/hub';

/** Athlete home: reminder when the staff asked for info/documents (or something required is missing). */
export default function HubRequestsBanner({ getAuthHeaders }) {
  const auth = useRef(getAuthHeaders); auth.current = getAuthHeaders;
  const [info, setInfo] = useState(null);
  useEffect(() => {
    axios.get(`${API}/athlete/hub/me`, auth.current()).then((r) => setInfo(r.data)).catch(() => {});
  }, []);
  if (!info) return null;
  const requested = info.requests || [];
  const items = requested.length
    ? [...new Map(requested.flatMap((r) => r.remaining).map((i) => [i.key, i])).values()]
    : info.missing || [];
  if (!items.length) return null;
  return (
    <Link to="/athlete/my-info" className="block" data-testid="hub-requests-banner">
      <div className={`rounded-xl border p-3 flex items-center gap-3 ${requested.length ? 'border-amber-400/50 bg-amber-400/10' : 'border-white/10 bg-white/5'}`}>
        <ClipboardList className={`w-6 h-6 shrink-0 ${requested.length ? 'text-amber-300' : 'text-muted-foreground'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{requested.length ? 'The staff needs some information' : 'Complete your profile'}</p>
          <p className="text-xs text-muted-foreground truncate">{items.map((i) => i.label).join(' · ')}</p>
          {requested[0]?.message && <p className="text-xs mt-0.5 line-clamp-2">“{requested[0].message}”</p>}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
