import { colorOf, useAthleteGroupMap, useAthleteGroups } from '../../lib/athleteGroups';

/**
 * Small coloured labels with the athlete's groups (e.g. "Competition").
 * Pass `groups` (list of ids) when the athlete object has them, otherwise
 * `athleteId` or `athleteName` and they are looked up.
 */
export default function GroupBadges({ groups: ids, athleteId, athleteName, size = 'sm', className = '' }) {
  const defs = useAthleteGroups();
  const map = useAthleteGroupMap();
  let list = ids;
  if (!list && map) list = (athleteId && map.byId[athleteId]) || (athleteName && map.byName[String(athleteName).trim()]) || [];
  if (!list || !list.length || !defs.length) return null;
  const items = defs.filter((d) => list.includes(d.id));
  if (!items.length) return null;
  const cls = size === 'xs' ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-1.5 py-0.5';
  return (
    <span className={`inline-flex flex-wrap gap-1 align-middle ${className}`} data-testid="group-badges">
      {items.map((g) => (
        <span key={g.id} className={`rounded-full border font-medium leading-tight whitespace-nowrap ${cls} ${colorOf(g.color).chip}`}>
          {g.name}
        </span>
      ))}
    </span>
  );
}
