import { FlaskConical, LogOut } from 'lucide-react';
import { isDemo, demoAs, exitDemo } from './demoMode';

/** Always-visible strip while the session is in Demo mode. */
export default function DemoBanner() {
  if (!isDemo()) return null;
  const as = demoAs() === 'athlete' ? 'test athlete' : 'staff (demo data only)';
  return (
    <>
      <div className="fixed top-0 inset-x-0 z-[100] bg-fuchsia-700 text-white text-xs flex items-center justify-center gap-3 px-3 py-1.5 shadow-lg" data-testid="demo-banner">
        <FlaskConical className="w-4 h-4 shrink-0" />
        <span className="truncate"><b>DEMO MODE</b> — viewing as {as}. Nothing here is counted in real data.</span>
        <button type="button" onClick={exitDemo} className="ml-2 inline-flex items-center gap-1 rounded bg-white/20 hover:bg-white/30 px-2 py-0.5 font-semibold" data-testid="demo-exit-btn">
          <LogOut className="w-3 h-3" /> Exit demo
        </button>
      </div>
      <div className="h-8" aria-hidden="true" />
    </>
  );
}
