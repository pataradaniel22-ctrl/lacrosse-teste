import { colorOf, useAthleteGroups } from '../../lib/athleteGroups';

/** Small coloured labels with the athlete's groups (e.g. "Competition"). */
export default function GroupBadges({ groups: ids, size = 'sm', className = '' }) {
  const defs = useAthleteGroups();
  if (!ids || !ids.length || !defs.length) return null;
  const items = defs.filter((d) => ids.includes(d.id));
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
