import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { PERIOD_PRESETS, presetRange } from './exportUtils';

export const PeriodFilter = ({ value, onChange, teams = [], showGroup = false, testPrefix = 'period' }) => {
  const set = (patch) => onChange({ ...value, ...patch });
  const pickPreset = (preset) => set(preset === 'custom' ? { preset } : { preset, ...presetRange(preset) });

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={`${testPrefix}-filter`}>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Period</p>
        <Select value={value.preset} onValueChange={pickPreset}>
          <SelectTrigger className="w-[150px] h-9" data-testid={`${testPrefix}-preset-select`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIOD_PRESETS.map((p) => <SelectItem key={p.key} value={p.key} data-testid={`${testPrefix}-preset-${p.key}`}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">From</p>
        <Input type="date" className="h-9 w-[150px]" value={value.start}
          onChange={(e) => set({ preset: 'custom', start: e.target.value })} data-testid={`${testPrefix}-start`} />
      </div>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">To</p>
        <Input type="date" className="h-9 w-[150px]" value={value.end}
          onChange={(e) => set({ preset: 'custom', end: e.target.value })} data-testid={`${testPrefix}-end`} />
      </div>
      {teams.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Team</p>
          <Select value={value.team} onValueChange={(team) => set({ team })}>
            <SelectTrigger className="w-[190px] h-9" data-testid={`${testPrefix}-team-select`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all-teams">All teams</SelectItem>
              {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {showGroup && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Group by</p>
          <Select value={value.group} onValueChange={(group) => set({ group })}>
            <SelectTrigger className="w-[120px] h-9" data-testid={`${testPrefix}-group-select`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
};
