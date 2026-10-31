import * as React from "react";
import { Info, X } from 'lucide-react';
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover';

/**
 * Evidence-based help tooltips for sports science metrics.
 * All explanations are aligned with accepted athlete monitoring literature.
 * 
 * Updated to use Popover (click-based) instead of Tooltip (hover-based)
 * to work on both desktop and mobile devices.
 */
export const METRIC_EXPLANATIONS = {
  // KPI Metrics
  totalAthletes: {
    title: "Total Athletes",
    description: "Number of active athletes currently being monitored in the system.",
    calculation: "Count of athletes with 'active' status in the selected team filter.",
    interpretation: "Use this to track roster size and ensure all athletes are being monitored.",
    expected: "All active athletes should appear and submit data.",
    caption: "Active athletes under monitoring."
  },
  avgReadiness: {
    title: "Average Readiness Score",
    description: "A composite measure of an athlete's preparedness for training, based on subjective wellness indicators.",
    calculation: "Mean of individual readiness scores (1-10 scale) across all athletes over the past 7 days. Derived from sleep quality, fatigue, muscle soreness, and stress levels.",
    interpretation: "Scores 7-10: Well-recovered, ready for high loads. Scores 4-6: Moderate readiness, consider load adjustments. Scores 1-3: Low readiness, prioritize recovery.",
    expected: "7–10 good · 4–6 monitor · 1–3 prioritize recovery.",
    reference: "Hooper & Mackinnon (1995); McLean et al. (2010)",
    caption: "Team subjective readiness to train (1–10 scale)."
  },
  teamTotalLoad: {
    title: "Team Total Load (AU)",
    description: "Cumulative internal training load for all athletes over the past 7 days, measured in Arbitrary Units (AU).",
    calculation: "Sum of all session-RPE values (Duration in minutes × RPE) across all athletes and sessions in the 7-day period.",
    interpretation: "Useful for comparing total team workload across training blocks. Higher values indicate greater cumulative training stress.",
    expected: "No fixed target — compare against previous weeks/blocks.",
    reference: "Session-RPE method (Foster et al., 2001)",
    caption: "Cumulative weekly internal load for the whole squad (AU)."
  },
  avgLoadPerAthlete: {
    title: "Average Load per Athlete (AU)",
    description: "Mean individual training load per athlete over the past 7 days.",
    calculation: "Team Total Load ÷ Number of athletes with recorded sessions.",
    interpretation: "Allows comparison of individual loads to team average. Large deviations may indicate under/over-training relative to the group.",
    expected: "Individuals within roughly ±1 SD of the team mean.",
    reference: "Internal load monitoring (Impellizzeri et al., 2004)",
    caption: "Mean weekly load per athlete (AU)."
  },
  activeAlerts: {
    title: "Active Alerts",
    description: "Number of flagged conditions requiring staff attention.",
    calculation: "Count of unresolved alerts triggered by: low readiness (<5), high load spikes, persistent pain, or missing check-ins.",
    interpretation: "Review alerts daily. Prioritize red (high severity) alerts. Address underlying causes rather than just resolving alerts.",
    expected: "0 is ideal; review and resolve all promptly.",
    caption: "Flagged conditions needing staff attention."
  },
  overloadAlerts: {
    title: "Overload Alerts",
    description: "Number of athletes whose most recent training-day load spiked well above their own habitual load.",
    calculation: "Athletes whose latest training-day internal load is >30% above their own 28-day training-day average (rest days excluded).",
    interpretation: "A sudden load spike relative to what the athlete is used to is associated with higher injury risk. Review these athletes' recent sessions and upcoming plan.",
    expected: "0 is ideal — avoid large week-to-week or day-to-day load jumps.",
    reference: "Acute:chronic workload & spikes (Gabbett, 2016)",
    caption: "Athletes with a load spike >30% above their own average."
  },
  lowReadinessToday: {
    title: "Low Readiness Today",
    description: "Number of athletes who checked in today with a readiness score below the risk threshold.",
    calculation: "Count of today's morning check-ins with readiness_score < 5. The subtitle also shows how many athletes have not checked in yet today.",
    interpretation: "Follow up with flagged athletes before training — consider modifying load, extra recovery, or a conversation. Missing check-ins can hide at-risk athletes.",
    expected: "0 flagged · everyone checked in.",
    reference: "Wellness monitoring (Saw et al., 2016)",
    caution: "A warning indicator, not a diagnosis.",
    caption: "Athletes below the readiness risk line today."
  },

  // Charts
  dailyReadiness: {
    title: "Daily Readiness Score",
    description: "Subjective measure of athlete preparedness collected via morning wellness questionnaire. The chart includes a visual risk threshold to help identify athletes who may need attention.",
    calculation: "Composite score (1-10) derived from sleep quality, fatigue level, muscle soreness, and perceived stress. Each factor weighted equally.",
    interpretation: "Track individual trends over time. Sudden drops may indicate accumulated fatigue, illness, or external stressors. Values below the risk threshold (5) are highlighted. Compare individual patterns to team average.",
    expected: "≥7 ready · <5 flagged (red risk line).",
    reference: "Wellness monitoring in team sports (Saw et al., 2016)",
    caution: "The risk threshold is a warning indicator, not a diagnosis.",
    caption: "Daily subjective readiness per athlete (1–10)."
  },
  dailyInternalLoad: {
    title: "Daily Internal Load (AU)",
    description: "Internal training load quantified using the session-RPE method, representing the psychophysiological stress of training.",
    calculation: "Session duration (minutes) × RPE (1-10 scale), summed for all sessions in a day. Expressed in Arbitrary Units (AU).",
    interpretation: "Higher values indicate greater training stress. Consider both absolute values and day-to-day changes. Spikes without adequate recovery may increase injury risk.",
    expected: "Avoid sudden spikes relative to recent days.",
    reference: "Session-RPE method (Foster et al., 2001; Impellizzeri et al., 2004)",
    caption: "Daily training stress via session-RPE (AU)."
  },
  painAfterSessions: {
    title: "Pain After Sessions",
    description: "Self-reported pain levels following training sessions, tracked by body region.",
    calculation: "Pain intensity rated 0-10 by athletes post-session. Values plotted per athlete over time.",
    interpretation: "Monitor for persistent or increasing pain patterns. Track body region patterns.",
    expected: "0–2 mild · >5/10 or lasting >48h → clinical review.",
    reference: "Pain monitoring in athlete surveillance (Drew et al., 2017)",
    caption: "Post-session pain reports per athlete (0–10)."
  },

  // Long Term Metrics
  monthlyLoad: {
    title: "Monthly Cumulative Load",
    description: "Total internal training load aggregated by month for long-term periodization analysis.",
    calculation: "Sum of all session-RPE values per month per athlete.",
    interpretation: "Use for mesocycle and macrocycle planning. Compare training blocks. Identify seasonal patterns and plan recovery periods.",
    expected: "Progressive, planned periodization (no fixed value).",
    reference: "Periodization of training load (Issurin, 2010)",
    caption: "Monthly accumulated internal load (AU)."
  },
  chronicLoadTrend: {
    title: "Chronic Load Trend (28-day Rolling)",
    description: "Rolling 28-day average of daily training load, representing fitness or training tolerance.",
    calculation: "Sum of internal load over past 28 days ÷ 28. Recalculated daily.",
    interpretation: "Gradual increases suggest progressive overload. Stable values indicate maintenance. Declines may indicate planned taper or unplanned detraining.",
    expected: "Gradual rise = building fitness; sharp drop = detraining.",
    reference: "Chronic workload as proxy for fitness (Hulin et al., 2014)",
    caption: "28-day rolling training load (fitness proxy)."
  },
  readinessTrend: {
    title: "Readiness Trend",
    description: "Long-term pattern of subjective readiness scores.",
    calculation: "Rolling average of daily readiness scores over extended periods.",
    interpretation: "Downward trends may indicate accumulated fatigue or overreaching. Correlate with training load patterns.",
    expected: "Stable or rising; sustained decline = fatigue risk.",
    reference: "Wellness monitoring (Saw et al., 2016)",
    caption: "Long-term readiness pattern (1–10)."
  },
  painByRegion: {
    title: "Pain Distribution by Body Region",
    description: "Frequency and intensity of pain reports aggregated by anatomical region.",
    calculation: "Count of pain reports per body region, with average intensity.",
    interpretation: "Identify common injury sites for targeted prevention. High-frequency regions may indicate technique, equipment, or sport-specific demands.",
    expected: "Low frequency; recurring sites need prevention.",
    reference: "Injury surveillance methods (Bahr et al., 2020)",
    caption: "Where pain is reported most across the squad."
  },
  compliance: {
    title: "Check-in Compliance",
    description: "Percentage of expected wellness check-ins completed by each athlete.",
    calculation: "(Completed check-ins ÷ Expected check-ins) × 100.",
    interpretation: "Low compliance reduces monitoring effectiveness. Address barriers to completion.",
    expected: "≥80% for reliable data.",
    reference: "Athlete self-report adherence (Saw et al., 2015)",
    caption: "Share of expected check-ins completed (%)."
  },

  // Workload Metrics
  monotony: {
    title: "Training Monotony",
    description: "Measure of day-to-day variability in training load within a week. Lower monotony indicates more varied training.",
    calculation: "Weekly mean daily load ÷ Standard deviation of daily loads. Requires ≥2 training days.",
    interpretation: "Values <1.5: good variation. 1.5-2.0: moderate. >2.0: low variation, consider diversifying loads.",
    expected: "<1.5 good · 1.5–2.0 moderate · >2.0 high.",
    reference: "Training monotony concept (Foster, 1998)",
    caution: "High monotony combined with high load may increase fatigue.",
    caption: "Day-to-day load variability within the week."
  },
  strain: {
    title: "Training Strain",
    description: "Composite measure of total training stress accounting for both load and monotony.",
    calculation: "Weekly Load × Monotony.",
    interpretation: "Track trends rather than absolute values. Rising strain with rising monotony may warrant attention.",
    expected: "No fixed value — watch for rising strain + monotony.",
    reference: "Training strain as fatigue indicator (Foster, 1998)",
    caption: "Weekly load × monotony (overall training stress)."
  },
  teamLoadMonitoring: {
    title: "Weekly Training Load Monitoring",
    description: "Accumulated internal load per athlete compared to the team, flagging those carrying elevated load.",
    calculation: "Sum of session-RPE over the window. High-load threshold = team mean + 1 SD (or mean × 1.3 for small squads).",
    interpretation: "Athletes above the threshold carry elevated load; interpret alongside recovery and health data.",
    expected: "Below team mean + 1 SD.",
    reference: "Session-RPE (Foster et al., 2001); load management (Soligard et al., 2016)",
    caption: "Weekly load per athlete vs team high-load threshold."
  },
  combinedRisk: {
    title: "Combined Load × Health Risk",
    description: "Cross-references high training load with substantial or elevated OSTRC-H2 health problems.",
    calculation: "Flags athletes who are BOTH above the team high-load threshold AND report a substantial problem or severity ≥17/100.",
    interpretation: "Associative only — a high load is NOT stated to cause the health problem. Use clinical judgement.",
    expected: "Ideally 0 athletes flagged.",
    reference: "OSTRC-H2 (Clarsen et al., 2020); load management (Soligard et al., 2016)",
    caution: "This is a descriptive/associative view, not a causal or predictive one.",
    caption: "Athletes both high-load and with an elevated health problem."
  },
  acuteChronicLoad: {
    title: "Acute & Chronic Load",
    description: "Acute load reflects the last 7 days; chronic load reflects the 28-day baseline of internal load.",
    calculation: "Sum of session-RPE over the last 7 days (acute) and 28 days (chronic).",
    interpretation: "Compare recent load against the athlete's own baseline to gauge sudden changes.",
    expected: "Acute close to the weekly chronic baseline.",
    reference: "Internal load monitoring (Impellizzeri et al., 2004)",
    caption: "Recent 7-day load vs 28-day baseline (AU)."
  },

  // Neuromuscular tests
  cmj: {
    title: "Countermovement Jump (CMJ)",
    description: "Vertical jump test used as a practical proxy for neuromuscular readiness and fatigue.",
    calculation: "Best jump height (cm) compared to the athlete's individual baseline.",
    interpretation: "Meaningful drops versus baseline may indicate neuromuscular fatigue.",
    expected: "Within ~5% of personal baseline.",
    reference: "CMJ for neuromuscular fatigue (Claudino et al., 2017)",
    caption: "Jump height vs personal baseline (neuromuscular readiness)."
  },
  rsi: {
    title: "Reactive Strength Index (RSI)",
    description: "Ability to rapidly switch from eccentric to concentric contraction during jumps.",
    calculation: "Jump height ÷ ground contact time (or flight time ÷ contact time).",
    interpretation: "Lower RSI versus baseline suggests reduced reactive strength / fatigue.",
    expected: "Within ~5–10% of personal baseline.",
    reference: "Reactive Strength Index (Flanagan & Comyns, 2008)",
    caption: "Reactive strength vs baseline (fatigue indicator)."
  },
  availabilityIndex: {
    title: "Training Availability Index",
    description: "Composite readiness-to-train score combining readiness, recovery, pain, compliance and load balance.",
    calculation: "Weighted 0–100% composite across factors; higher = more available.",
    interpretation: "Lower values indicate reduced availability; review the contributing factors.",
    expected: "≥80% available · <60% review.",
    reference: "Athlete availability & load (Gabbett, 2016; Windt & Gabbett, 2017)",
    caption: "Composite readiness-to-train score (0–100%)."
  },

  // Female Team Wellness
  menstrualTracking: {
    title: "Menstrual Cycle Monitoring",
    description: "Tracking menstrual cycle status to understand potential impacts on training and recovery.",
    calculation: "Count of athletes reporting current menstruation, with associated symptoms and pain levels.",
    interpretation: "Use data for individual support, not exclusion. Severe symptoms warrant medical attention.",
    expected: "Individualized support; severe symptoms → medical review.",
    reference: "Menstrual cycle and performance (McNulty et al., 2020)",
    caption: "Cycle status and symptoms for individualized support."
  },
  menstrualPain: {
    title: "Menstrual Pain Alerts",
    description: "Flags for severe menstrual symptoms that may affect training tolerance.",
    calculation: "Alerts when menstrual pain is 'Severe'/'Very Severe', or combined with high general soreness (>5/10).",
    interpretation: "Consider training modifications for affected athletes.",
    expected: "Severe/very severe → modify training & consider referral.",
    reference: "Menstrual cycle and performance (McNulty et al., 2020)",
    caption: "Severe menstrual symptoms flagged for support."
  },

  // Radar Charts
  teamReadinessRadar: {
    title: "Team Daily Readiness Profile",
    description: "Radar of the team's average wellness profile for a specific day. Each axis is a readiness dimension.",
    calculation: "Team average of Sleep, Energy, Muscle Recovery, Mental Wellness and Readiness to Train from all athletes who checked in that day.",
    interpretation: "Quickly identify which wellness dimension is most affected team-wide. Daily snapshot, not a trend.",
    expected: "Fuller shape (values near the edge) = better wellness.",
    reference: "Multidimensional wellness monitoring (Saw et al., 2016)",
    caution: "Use alongside trends and alerts, not as a standalone tool.",
    caption: "Team average wellness profile for the selected day."
  },
  athleteReadinessRadar: {
    title: "Individual Daily Readiness Profile",
    description: "Radar of an individual athlete's wellness profile for a specific day.",
    calculation: "Athlete's self-reported Sleep Quality, Energy (inverted fatigue), Muscle Recovery (inverted soreness), Mental Wellness (inverted stress) and Readiness to Train.",
    interpretation: "Compare shape across days. Flat/small shapes indicate low overall wellness.",
    expected: "Fuller shape = better wellness; small = low wellness.",
    reference: "Multidimensional wellness monitoring (Saw et al., 2016)",
    caution: "Individual data only — no team comparison.",
    caption: "One athlete's wellness profile for the selected day."
  },

  // Daily Pain Chart (Short Term)
  dailyPain: {
    title: "Daily Pain by Body Region",
    description: "Pain reports from training sessions aggregated by body region for the selected day.",
    calculation: "Count and average intensity of pain reports per body region on the selected date.",
    interpretation: "Identify which body regions are most affected. Use the day selector to track patterns.",
    expected: "Low counts; recurring regions warrant intervention.",
    reference: "Injury surveillance (Bahr et al., 2020)",
    caution: "Self-reported data; pain perception varies between individuals.",
    caption: "Pain reports by body region for the selected day."
  },

  // Health Surveillance (OSTRC-H2)
  ostrcSeverity: {
    title: "OSTRC-H2 Severity Score",
    description: "Standardized severity of health problems from the weekly OSTRC-H2 questionnaire.",
    calculation: "Sum of 4 items (participation, training modification, performance, symptoms), each scored 0/8/17/25 → 0–100.",
    interpretation: "Higher scores mean greater impact on participation and performance.",
    expected: "0 = none · higher = greater impact · ≥17 with participation impact = substantial.",
    reference: "OSTRC-H2 questionnaire (Clarsen et al., 2013; 2020)",
    caption: "Weekly health problem severity (0–100)."
  },
  substantialProblem: {
    title: "Substantial Health Problem",
    description: "OSTRC-H2 problems causing moderate/severe reductions in participation, training volume or performance — or complete inability to participate.",
    calculation: "Derived from OSTRC-H2 responses following the official 'substantial' definition.",
    interpretation: "These are the priority cases for medical review.",
    expected: "Fewer is better; each flagged case requires follow-up.",
    reference: "Substantial injury/illness definition (Clarsen et al., 2014; 2020)",
    caption: "Problems with substantial impact on participation."
  },
  persistentPain: {
    title: "Persistent Pain",
    description: "Athletes reporting pain in the same body region on 3+ consecutive days.",
    calculation: "Across all pain sources (training, morning check-ins, recovery, messages), counts the longest run of days (gaps ≤2 days) with pain ≥5/10 in the same region; flagged when the run is ≥3 days.",
    interpretation: "Repeated pain in the same area is an early warning of an overuse problem — prioritise these athletes for a physio/medical review.",
    expected: "0 is ideal; each flagged athlete needs follow-up.",
    reference: "Overuse injury surveillance (Clarsen et al., 2013)",
    caution: "A triage signal, not a diagnosis.",
    caption: "Same-region pain reported on 3+ days in a row."
  },
  healthResponseRate: {
    title: "Weekly Health Response Rate",
    description: "Share of athletes who completed the weekly OSTRC-H2 health check.",
    calculation: "Submitted this week ÷ total athletes × 100.",
    interpretation: "Higher completion gives more reliable surveillance.",
    expected: "≥80% for reliable surveillance.",
    reference: "Health surveillance methodology (Clarsen et al., 2013)",
    caption: "OSTRC-H2 weekly completion rate (%)."
  },
  healthAvailability: {
    title: "Health Availability Status",
    description: "Athlete availability derived from the weekly health check.",
    calculation: "Full / Modified / Unavailable based on the reported participation restriction.",
    interpretation: "Modified/Unavailable athletes need load or medical adjustments.",
    expected: "Full = no restriction.",
    reference: "OSTRC-H2 questionnaire (Clarsen et al., 2020)",
    caption: "Full / Modified / Unavailable from the health check."
  },
  trainingConsistency: {
    title: "Weekly Training Consistency",
    description: "Number of training sessions completed per week per athlete.",
    calculation: "Count of recorded training sessions per athlete per week.",
    interpretation: "Consistent weekly frequency supports adaptation; erratic patterns may reflect availability or scheduling issues.",
    expected: "Stable weekly frequency in line with the training plan.",
    reference: "Training load consistency (Gabbett, 2016)",
    caption: "Sessions completed per athlete each week."
  }
};

/**
 * Reusable help tooltip component for metrics and charts
 * Uses Popover (click-based) for mobile compatibility
 */
export function HelpTooltip({ metricKey, className = "" }) {
  const metric = METRIC_EXPLANATIONS[metricKey];
  const [open, setOpen] = React.useState(false);
  
  if (!metric) return null;
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button 
          type="button"
          className={cn(
            "inline-flex items-center justify-center cursor-help touch-manipulation",
            "rounded-full p-0.5 -m-0.5",
            "hover:bg-muted/50 active:bg-muted/70 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            className
          )}
          aria-label={`More information about ${metric.title}`}
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side="top"
        align="center"
        className={cn(
          "w-[calc(100vw-2rem)] max-w-sm p-0 shadow-lg z-50",
          "sm:w-80",
          "data-[side=top]:mb-2 data-[side=bottom]:mt-2",
          "data-[side=left]:mr-2 data-[side=right]:ml-2"
        )}
        sideOffset={8}
      >
        <div className="relative">
          {/* Close button for mobile */}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/50 active:bg-muted/70 transition-colors sm:hidden z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
          
          {/* Content */}
          <div className="p-3 pr-8 sm:pr-3 text-xs space-y-2">
            <p className="font-semibold text-sm text-foreground">{metric.title}</p>
            <p className="text-muted-foreground">{metric.description}</p>
            
            {metric.calculation && (
              <div className="pt-1">
                <p className="font-medium text-foreground text-[10px] uppercase tracking-wider mb-0.5">Calculation</p>
                <p className="text-muted-foreground">{metric.calculation}</p>
              </div>
            )}
            
            {metric.interpretation && (
              <div className="pt-1">
                <p className="font-medium text-foreground text-[10px] uppercase tracking-wider mb-0.5">Interpretation</p>
                <p className="text-muted-foreground">{metric.interpretation}</p>
              </div>
            )}

            {metric.expected && (
              <div className="pt-1">
                <p className="font-medium text-emerald-400 text-[10px] uppercase tracking-wider mb-0.5">Expected value</p>
                <p className="text-foreground/90">{metric.expected}</p>
              </div>
            )}
            
            {metric.reference && (
              <p className="text-[10px] text-muted-foreground/70 italic pt-1 border-t border-border/50">
                {metric.reference}
              </p>
            )}
            
            {metric.caution && (
              <p className="text-[10px] text-amber-400/90 pt-1 flex items-start gap-1">
                <span className="shrink-0">⚠️</span>
                <span>{metric.caution}</span>
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default HelpTooltip;

/**
 * Fixed, always-visible caption/legend rendered under a staff chart or metric.
 * Single source of truth: pulls from METRIC_EXPLANATIONS.
 * Shows: what it is · Expected value · scientific reference.
 */
export function ChartCaption({ metricKey, className = "" }) {
  const m = METRIC_EXPLANATIONS[metricKey];
  if (!m) return null;
  return (
    <p
      className={cn("text-[11px] leading-snug text-muted-foreground/80 mt-2 pt-2 border-t border-border/40", className)}
      data-testid={`chart-caption-${metricKey}`}
    >
      <span>{m.caption || m.description}</span>
      {m.expected && (
        <>
          {" "}·{" "}
          <span className="text-emerald-400/90 font-medium">Expected: {m.expected}</span>
        </>
      )}
      {m.reference && <span className="italic text-muted-foreground/60"> · {m.reference}</span>}
    </p>
  );
}
