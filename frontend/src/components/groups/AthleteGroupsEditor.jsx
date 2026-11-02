import { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { colorOf, useAthleteGroups } from '../../lib/athleteGroups';
import GroupBadges from './GroupBadges';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/** Group labels on the athlete page; Admin/Coach can change them in place. */
export default function AthleteGroupsEditor({ athlete, canEdit, getAuthHeaders, onChange }) {
  const defs = useAthleteGroups();
  const [groups, setGroups] = useState(athlete.groups || []);
  const [busy, setBusy] = useState(false);

  const toggle = async (gid) => {
    const next = groups.includes(gid) ? groups.filter((g) => g !== gid) : [...groups, gid];
    const prev = groups;
    setGroups(next);
    setBusy(true);
    try {
      await axios.put(`${API}/staff/athletes/${athlete.id}/groups`, { groups: next }, getAuthHeaders());
      onChange?.(next);
    } catch (e) {
      setGroups(prev);
      toast.error(e?.response?.data?.detail || 'Could not update groups');
    } finally { setBusy(false); }
  };

  if (!defs.length) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap" data-testid="athlete-groups-editor">
      <GroupBadges groups={groups} />
      {canEdit && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed border-white/20 text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="athlete-groups-edit-btn">
              <Pencil className="w-2.5 h-2.5" />{groups.length ? 'Groups' : 'Add to group'}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 space-y-1">
            {defs.map((g) => {
              const on = groups.includes(g.id);
              return (
                <button
                  key={g.id} type="button" disabled={busy} onClick={() => toggle(g.id)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md border transition-colors ${on ? colorOf(g.color).solid : 'border-white/10 hover:bg-white/5'}`}
                  data-testid={`athlete-group-toggle-${g.id}`}
                >{on ? '✓ ' : ''}{g.name}</button>
              );
            })}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
