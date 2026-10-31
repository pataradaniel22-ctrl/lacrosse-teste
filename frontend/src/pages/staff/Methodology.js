import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { METRIC_EXPLANATIONS } from '../../components/ui/help-tooltip';

const CATEGORIES = [
  {
    name: 'Readiness & Wellness',
    keys: ['avgReadiness', 'dailyReadiness', 'readinessTrend', 'teamReadinessRadar', 'athleteReadinessRadar', 'availabilityIndex'],
  },
  {
    name: 'Training Load',
    keys: ['teamTotalLoad', 'avgLoadPerAthlete', 'dailyInternalLoad', 'monthlyLoad', 'chronicLoadTrend', 'acuteChronicLoad', 'teamLoadMonitoring', 'monotony', 'strain', 'trainingConsistency'],
  },
  {
    name: 'Neuromuscular Tests',
    keys: ['cmj', 'rsi'],
  },
  {
    name: 'Pain & Injury',
    keys: ['painAfterSessions', 'painByRegion', 'dailyPain'],
  },
  {
    name: 'Health Surveillance (OSTRC-H2)',
    keys: ['ostrcSeverity', 'substantialProblem', 'healthResponseRate', 'healthAvailability', 'combinedRisk'],
  },
  {
    name: 'Female Team Wellness',
    keys: ['menstrualTracking', 'menstrualPain'],
  },
  {
    name: 'General & Compliance',
    keys: ['totalAthletes', 'activeAlerts', 'compliance'],
  },
];

const Field = ({ label, value, accent }) => {
  if (!value) return null;
  return (
    <div className="pt-1">
      <p className={`font-medium text-[10px] uppercase tracking-wider mb-0.5 ${accent || 'text-foreground'}`}>{label}</p>
      <p className={accent === 'text-emerald-400' ? 'text-foreground/90 text-sm' : 'text-muted-foreground text-sm'}>{value}</p>
    </div>
  );
};

export default function Methodology() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/5 print:hidden">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/staff" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="font-heading font-bold text-lg leading-none">Methodology & Metrics Glossary</h1>
            <p className="text-xs text-muted-foreground">Definitions, expected values and scientific references</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
            onClick={() => window.print()}
            data-testid="methodology-print-btn"
          >
            <Printer className="w-4 h-4 mr-1.5" /> Print / Save PDF
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8" data-testid="methodology-page">
        <p className="text-sm text-muted-foreground">
          This reference documents every metric and test used across the staff dashboards. Each entry states what it measures,
          how it is calculated, how to interpret it, the expected/target value, and the supporting scientific reference so it can be cited in reports.
        </p>

        {CATEGORIES.map((cat) => {
          const items = cat.keys.map((k) => [k, METRIC_EXPLANATIONS[k]]).filter(([, m]) => m);
          if (items.length === 0) return null;
          return (
            <section key={cat.name} data-testid={`methodology-section-${cat.name.replace(/\s+/g, '-').toLowerCase()}`}>
              <h2 className="text-lg font-heading font-bold text-cyan-400 mb-3 border-b border-cyan-500/20 pb-1">{cat.name}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map(([key, m]) => (
                  <Card key={key} className="glass-light border-white/5" data-testid={`methodology-metric-${key}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{m.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      <Field label="What it is" value={m.description} />
                      <Field label="Calculation" value={m.calculation} />
                      <Field label="Interpretation" value={m.interpretation} />
                      <Field label="Expected value" value={m.expected} accent="text-emerald-400" />
                      <Field label="Reference" value={m.reference} accent="text-muted-foreground" />
                      {m.caution && <Field label="Caution" value={m.caution} accent="text-amber-400" />}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}

        <p className="text-[11px] text-muted-foreground/70 pt-4 border-t border-white/5">
          Note: ACWR (Acute:Chronic Workload Ratio) has been intentionally removed from this platform in favour of internal load,
          monotony, strain and the OSTRC-H2 health surveillance framework.
        </p>
      </main>
    </div>
  );
}
