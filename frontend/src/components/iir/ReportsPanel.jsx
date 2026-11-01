export default function ReportsPanel({ compact }) {
  if (compact) return null;
  return (
    <div className="rounded-lg border border-white/10 p-6 text-sm text-muted-foreground">
      This section is being built and will be published in the next update.
    </div>
  );
}
