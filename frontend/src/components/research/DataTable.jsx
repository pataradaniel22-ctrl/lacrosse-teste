const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

export const DataTable = ({ columns, rows, testid = 'data-table', maxHeight = 'max-h-[420px]' }) => {
  if (!rows?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center" data-testid={`${testid}-empty`}>No records for the selected filters.</p>;
  }
  return (
    <div className={`overflow-auto ${maxHeight} rounded-lg border border-white/5`} data-testid={testid}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
          <tr>
            {columns.map((c) => (
              <th key={c} className="text-left font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap border-b border-white/10">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap max-w-[260px] truncate" title={fmt(r[c])}>{fmt(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
