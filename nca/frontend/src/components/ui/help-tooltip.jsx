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
    interpretation: "Use this to track roster size and ensure all athletes are being monitored."
  },
  avgReadiness: {
    title: "Average Readiness Score",
    description: "A composite measure of an athlete's preparedness for training, based on subjective wellness indicators.",
    calculation: "Mean of individual readiness scores (1-10 scale) across all athletes over the past 7 days. Derived from sleep quality, fatigue, muscle soreness, and stress levels.",
    interpretation: "Scores 7-10: Well-recovered, ready for high loads. Scores 4-6: Moderate readiness, consider load adjustments. Scores 1-3: Low readiness, prioritize recovery.",
    reference: "Based on wellness questionnaire protocols (Hooper & Mackinnon, 1995; McLean et al., 2010)"
  },
  teamTotalLoad: {
    title: "Team Total Load (AU)",
    description: "Cumulative internal training load for all athletes over the past 7 days, measured in Arbitrary Units (AU).",
    calculation: "Sum of all session-RPE values (Duration in minutes × RPE) across all athletes and sessions in the 7-day period.",
    interpretation: "Useful for comparing total team workload across training blocks. Higher values indicate greater cumulative training stress.",
    reference: "Session-RPE method (Foster et al., 2001)"
  },
  avgLoadPerAthlete: {
    title: "Average Load per Athlete (AU)",
    description: "Mean individual training load per athlete over the past 7 days.",
    calculation: "Team Total Load ÷ Number of athletes with recorded sessions.",
    interpretation: "Allows comparison of individual loads to team average. Large deviations may indicate under/over-training relative to the group.",
    reference: "Internal load monitoring (Impellizzeri et al., 2004)"
  },
  activeAlerts: {
    title: "Active Alerts",
    description: "Number of flagged conditions requiring staff attention.",
    calculation: "Count of unresolved alerts triggered by: low readiness (<5), high load spikes (>1.5x average), persistent pain, or missing check-ins.",
    interpretation: "Review alerts daily. Prioritize red (high severity) alerts. Address underlying causes rather than just resolving alerts."
  },
  
  // Charts
  dailyReadiness: {
    title: "Daily Readiness Score",
    description: "Subjective measure of athlete preparedness collected via morning wellness questionnaire. The chart includes a visual risk threshold to help identify athletes who may need attention.",
    calculation: "Composite score (1-10) derived from sleep quality, fatigue level, muscle soreness, and perceived stress. Each factor weighted equally.",
    interpretation: "Track individual trends over time. Sudden drops may indicate accumulated fatigue, illness, or external stressors. Values below the risk threshold (5) are highlighted with larger red markers. Compare individual patterns to team average.",
    reference: "Wellness monitoring in team sports (Saw et al., 2016)",
    caution: "The risk threshold is a warning indicator, not a diagnosis. Use it to support early decision-making for load adjustment and recovery strategies."
  },
  dailyInternalLoad: {
    title: "Daily Internal Load (AU)",
    description: "Internal training load quantified using the session-RPE method, representing the psychophysiological stress of training.",
    calculation: "Session duration (minutes) × RPE (1-10 scale), summed for all sessions in a day. Expressed in Arbitrary Units (AU).",
    interpretation: "Higher values indicate greater training stress. Consider both absolute values and day-to-day changes. Spikes without adequate recovery may increase injury risk.",
    reference: "Session-RPE method validated across multiple sports (Foster et al., 2001; Impellizzeri et al., 2004)"
  },
  acwrOverview: {
    title: "ACWR Overview (Acute:Chronic Workload Ratio)",
    description: "Ratio comparing recent training load (acute) to longer-term training load (chronic), used to monitor load progression.",
    calculation: "Acute load (7-day sum) ÷ Chronic load (28-day rolling average). Based on the coupled ACWR model.",
    interpretation: "0.8-1.3: Generally considered a 'sweet spot' for load progression. <0.8: Possible undertraining or detraining. >1.5: Rapid load increases, monitor closely.",
    reference: "Acute:Chronic Workload Ratio framework (Gabbett, 2016; Blanch & Gabbett, 2016)",
    caution: "ACWR is one tool among many. Individual responses vary. Do not use as sole decision-making criterion."
  },
  painAfterSessions: {
    title: "Pain After Sessions",
    description: "Self-reported pain levels following training sessions, tracked by body region.",
    calculation: "Pain intensity rated 0-10 by athletes post-session. Values plotted per athlete over time.",
    interpretation: "Monitor for persistent or increasing pain patterns. Pain >5/10 or pain persisting >48 hours warrants clinical attention. Track body region patterns.",
    reference: "Pain monitoring in athlete surveillance (Drew et al., 2017)"
  },
  
  // Long Term Metrics
  monthlyLoad: {
    title: "Monthly Cumulative Load",
    description: "Total internal training load aggregated by month for long-term periodization analysis.",
    calculation: "Sum of all session-RPE values per month per athlete.",
    interpretation: "Use for mesocycle and macrocycle planning. Compare training blocks. Identify seasonal patterns and plan recovery periods."
  },
  chronicLoadTrend: {
    title: "Chronic Load Trend (28-day Rolling)",
    description: "Rolling 28-day average of daily training load, representing fitness or training tolerance.",
    calculation: "Sum of internal load over past 28 days ÷ 28. Recalculated daily.",
    interpretation: "Gradual increases suggest progressive overload. Stable values indicate maintenance. Declines may indicate planned taper or unplanned detraining.",
    reference: "Chronic workload as proxy for fitness (Hulin et al., 2014)"
  },
  readinessTrend: {
    title: "Readiness Trend",
    description: "Long-term pattern of subjective readiness scores.",
    calculation: "Rolling average of daily readiness scores over extended periods.",
    interpretation: "Downward trends may indicate accumulated fatigue or overreaching. Correlate with training load patterns."
  },
  painByRegion: {
    title: "Pain Distribution by Body Region",
    description: "Frequency and intensity of pain reports aggregated by anatomical region.",
    calculation: "Count of pain reports per body region, with average intensity. Risk score = frequency × intensity × severity factor.",
    interpretation: "Identify common injury sites for targeted prevention. High-frequency regions may indicate technique issues, equipment problems, or sport-specific demands.",
    reference: "Injury surveillance methods (Bahr et al., 2020)"
  },
  compliance: {
    title: "Check-in Compliance",
    description: "Percentage of expected wellness check-ins completed by each athlete.",
    calculation: "(Completed check-ins ÷ Expected check-ins) × 100, calculated daily, weekly, and monthly.",
    interpretation: "Target >80% compliance for reliable data. Low compliance reduces monitoring effectiveness. Address barriers to completion."
  },
  
  // Workload Metrics
  monotony: {
    title: "Training Monotony",
    description: "Measure of day-to-day variability in training load within a week. Lower monotony indicates more varied training.",
    calculation: "Weekly mean daily load ÷ Standard deviation of daily loads. Requires ≥2 training days.",
    interpretation: "Values <1.5: Good variation (green). 1.5-2.0: Moderate variation (yellow). >2.0: Low variation, consider diversifying loads (red).",
    reference: "Training monotony concept (Foster, 1998)",
    caution: "High monotony is not inherently negative but combined with high load may increase fatigue."
  },
  strain: {
    title: "Training Strain",
    description: "Composite measure of total training stress accounting for both load and monotony.",
    calculation: "Weekly Load × Monotony.",
    interpretation: "Track trends rather than absolute values. Rising strain with stable monotony indicates load progression. Rising strain with rising monotony may warrant attention.",
    reference: "Training strain as fatigue indicator (Foster, 1998)"
  },
  
  // Female Team Wellness
  menstrualTracking: {
    title: "Menstrual Cycle Monitoring",
    description: "Tracking menstrual cycle status to understand potential impacts on training and recovery.",
    calculation: "Count of athletes reporting current menstruation, with associated symptoms and pain levels.",
    interpretation: "Some athletes may experience performance variations across cycle phases. Use data for individual support, not exclusion. Severe symptoms warrant medical attention.",
    reference: "Menstrual cycle in athletic performance (McNulty et al., 2020)"
  },
  menstrualPain: {
    title: "Menstrual Pain Alerts",
    description: "Flags for severe menstrual symptoms that may affect training tolerance.",
    calculation: "Alerts triggered when: menstrual pain is 'Severe' or 'Very Severe', or menstrual pain combined with high general soreness (>5/10).",
    interpretation: "Consider training modifications for affected athletes. Severe or persistent symptoms should be referred for medical evaluation."
  },
  
  // Radar Charts
  teamReadinessRadar: {
    title: "Team Daily Readiness Profile",
    description: "A radar visualization showing the team's average wellness profile for a specific day. Each axis represents a key readiness dimension.",
    calculation: "Team average of each wellness dimension (Sleep, Energy, Muscle Recovery, Mental Wellness, Readiness to Train) from all athletes who completed their check-in on the selected day.",
    interpretation: "Use this to quickly identify which wellness dimension is most affected at the team level. Compare shapes across days to spot patterns. This is a daily snapshot, not a trend indicator.",
    caution: "Higher values (closer to edge) indicate better wellness. This radar should be used alongside trends and alerts, not as a standalone decision tool."
  },
  athleteReadinessRadar: {
    title: "Individual Daily Readiness Profile",
    description: "A radar visualization showing an individual athlete's wellness profile for a specific day.",
    calculation: "The athlete's self-reported values for Sleep Quality, Energy Level (inverted fatigue), Muscle Recovery (inverted soreness), Mental Wellness (inverted stress), and Readiness to Train.",
    interpretation: "Compare the athlete's profile shape across days to identify patterns. Flat or small shapes indicate overall low wellness. Asymmetric shapes highlight specific problem areas.",
    caution: "This shows individual data only - no team comparison. Use for personalized load adjustments and recovery planning."
  },
  
  // Daily Pain Chart (Short Term)
  dailyPain: {
    title: "Daily Pain by Body Region",
    description: "Shows pain reports from training sessions aggregated by body region for the selected day.",
    calculation: "Count and average intensity of pain reports per body region from all training sessions on the selected date.",
    interpretation: "Identify which body regions are most affected. Use the day selector to track patterns over time. High frequency or severity in specific regions may warrant intervention.",
    caution: "This is self-reported data from athletes. Pain perception varies between individuals."
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
