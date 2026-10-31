import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

// Updated body regions with precise coordinates based on segmented anatomical model
// Coordinates are based on a 100x140 viewBox with clearer body proportions
const BODY_REGIONS = {
  // Backend enum values (primary keys) - FRONT VIEW
  'Neck': { view: 'front', x: 45, y: 18, width: 10, height: 8 },
  'Shoulder': { view: 'front', x: 28, y: 28, width: 14, height: 10, mirror: true },
  'Elbow': { view: 'front', x: 18, y: 50, width: 10, height: 10, mirror: true },
  'WristHand': { view: 'front', x: 10, y: 72, width: 12, height: 14, mirror: true },
  'HipGroin': { view: 'front', x: 40, y: 68, width: 20, height: 12, mirror: true },
  'Knee': { view: 'front', x: 38, y: 95, width: 10, height: 10, mirror: true },
  'AnkleFoot': { view: 'front', x: 36, y: 122, width: 12, height: 14, mirror: true },
  'Other': { view: 'front', x: 50, y: 55, width: 12, height: 12 },
  
  // Backend enum values - BACK VIEW
  'LowBack': { view: 'back', x: 40, y: 50, width: 20, height: 14 },
  
  // Extended front view mappings
  'Head': { view: 'front', x: 42, y: 4, width: 16, height: 16 },
  'Chest': { view: 'front', x: 36, y: 32, width: 28, height: 18 },
  'Abdomen': { view: 'front', x: 38, y: 50, width: 24, height: 16 },
  'Upper Arm': { view: 'front', x: 22, y: 36, width: 10, height: 16, mirror: true },
  'Forearm': { view: 'front', x: 16, y: 56, width: 10, height: 16, mirror: true },
  'Thigh': { view: 'front', x: 38, y: 78, width: 12, height: 18, mirror: true },
  'Shin': { view: 'front', x: 38, y: 105, width: 10, height: 16, mirror: true },
  
  // Back view mappings
  'Upper Back': { view: 'back', x: 36, y: 32, width: 28, height: 16 },
  'Glutes': { view: 'back', x: 38, y: 64, width: 24, height: 14, mirror: true },
  'Hamstring': { view: 'back', x: 38, y: 78, width: 12, height: 18, mirror: true },
  'Calf': { view: 'back', x: 38, y: 105, width: 10, height: 16, mirror: true },
};

// Get severity color
const getSeverityColor = (severity, opacity = 0.6) => {
  switch (severity) {
    case 'severe':
      return `rgba(239, 68, 68, ${opacity})`; // red
    case 'moderate':
      return `rgba(245, 158, 11, ${opacity})`; // amber
    case 'mild':
      return `rgba(34, 197, 94, ${opacity})`; // green
    default:
      return `rgba(148, 163, 184, ${opacity})`; // gray
  }
};

// Determine which side(s) to highlight based on laterality
const shouldShowLeft = (laterality) => {
  return laterality === 'Left' || laterality === 'Both' || !laterality;
};

const shouldShowRight = (laterality) => {
  return laterality === 'Right' || laterality === 'Both' || !laterality;
};

// Get laterality badge text
const getLateralityBadge = (laterality) => {
  if (laterality === 'Left') return 'L';
  if (laterality === 'Right') return 'R';
  if (laterality === 'Both') return 'B';
  return null;
};

// New improved human body outline - FRONT VIEW
const HumanBodyFront = ({ painLocations }) => {
  const frontPain = painLocations.filter(p => {
    const region = BODY_REGIONS[p.region];
    return region && region.view === 'front';
  });

  return (
    <svg viewBox="0 0 100 140" className="w-full h-full">
      {/* Anatomical body outline - segmented style matching provided image */}
      <g fill="none" stroke="rgba(148, 163, 184, 0.4)" strokeWidth="1.5">
        {/* Head */}
        <ellipse cx="50" cy="12" rx="12" ry="11" />
        {/* Face division line */}
        <line x1="50" y1="1" x2="50" y2="23" strokeDasharray="2,2" strokeWidth="0.5" />
        
        {/* Neck */}
        <rect x="45" y="21" width="10" height="8" rx="2" />
        
        {/* Torso - segmented */}
        <path d="M32 29 L68 29 L70 50 L68 66 L32 66 L30 50 Z" />
        {/* Torso segments */}
        <line x1="50" y1="29" x2="50" y2="66" strokeDasharray="2,2" strokeWidth="0.5" />
        <line x1="30" y1="48" x2="70" y2="48" strokeDasharray="2,2" strokeWidth="0.5" />
        
        {/* Left shoulder/arm */}
        <path d="M32 29 L24 32 L18 50 L14 68 L10 82" strokeLinecap="round" strokeWidth="1.5" />
        {/* Right shoulder/arm */}
        <path d="M68 29 L76 32 L82 50 L86 68 L90 82" strokeLinecap="round" strokeWidth="1.5" />
        
        {/* Arm segments */}
        <ellipse cx="24" cy="33" rx="6" ry="5" strokeWidth="1" />
        <ellipse cx="76" cy="33" rx="6" ry="5" strokeWidth="1" />
        
        {/* Hip/pelvis */}
        <path d="M32 66 L32 76 L42 80 L50 78 L58 80 L68 76 L68 66" />
        
        {/* Left leg */}
        <path d="M42 80 L40 100 L38 120 L36 135" strokeLinecap="round" strokeWidth="1.5" />
        {/* Right leg */}
        <path d="M58 80 L60 100 L62 120 L64 135" strokeLinecap="round" strokeWidth="1.5" />
        
        {/* Knee markers */}
        <ellipse cx="40" cy="100" rx="5" ry="4" strokeWidth="1" />
        <ellipse cx="60" cy="100" rx="5" ry="4" strokeWidth="1" />
        
        {/* Hand outlines */}
        <ellipse cx="10" cy="84" rx="5" ry="6" strokeWidth="1" />
        <ellipse cx="90" cy="84" rx="5" ry="6" strokeWidth="1" />
        
        {/* Foot outlines */}
        <ellipse cx="36" cy="135" rx="5" ry="4" strokeWidth="1" />
        <ellipse cx="64" cy="135" rx="5" ry="4" strokeWidth="1" />
      </g>
      
      {/* Pain highlights */}
      {frontPain.map((pain, index) => {
        const region = BODY_REGIONS[pain.region];
        if (!region) return null;
        
        const showLeft = shouldShowLeft(pain.laterality);
        const showRight = shouldShowRight(pain.laterality);
        const badge = getLateralityBadge(pain.laterality);
        
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        const mirrorX = 100 - centerX;
        
        return (
          <TooltipProvider key={index}>
            <Tooltip>
              <TooltipTrigger asChild>
                <g className="cursor-pointer">
                  {/* Left side or center highlight */}
                  {(showLeft || !region.mirror) && (
                    <>
                      {/* Pulsating outer ring */}
                      <circle
                        cx={centerX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 4}
                        fill="none"
                        stroke={getSeverityColor(pain.severity, 0.8)}
                        strokeWidth="2"
                        className="animate-ping"
                        style={{ animationDuration: '2s' }}
                      />
                      {/* Main pain marker */}
                      <circle
                        cx={centerX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 2}
                        fill={getSeverityColor(pain.severity, 0.5)}
                        stroke={getSeverityColor(pain.severity, 1)}
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                      {/* Laterality badge */}
                      {badge && region.mirror && (
                        <text 
                          x={centerX} 
                          y={centerY + 4} 
                          textAnchor="middle" 
                          className="text-[8px] font-bold fill-white"
                          style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
                        >
                          {pain.laterality === 'Left' ? 'L' : badge}
                        </text>
                      )}
                    </>
                  )}
                  {/* Right side highlight (mirrored regions only) */}
                  {region.mirror && showRight && (
                    <>
                      <circle
                        cx={mirrorX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 4}
                        fill="none"
                        stroke={getSeverityColor(pain.severity, 0.8)}
                        strokeWidth="2"
                        className="animate-ping"
                        style={{ animationDuration: '2s' }}
                      />
                      <circle
                        cx={mirrorX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 2}
                        fill={getSeverityColor(pain.severity, 0.5)}
                        stroke={getSeverityColor(pain.severity, 1)}
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                      {badge && (
                        <text 
                          x={mirrorX} 
                          y={centerY + 4} 
                          textAnchor="middle" 
                          className="text-[8px] font-bold fill-white"
                          style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
                        >
                          {pain.laterality === 'Right' ? 'R' : badge}
                        </text>
                      )}
                    </>
                  )}
                </g>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{pain.region}</p>
                <p className="text-xs">Pain Level: {pain.pain_level}/10</p>
                <p className="text-xs capitalize">Severity: {pain.severity}</p>
                {pain.laterality && pain.laterality !== 'N/A' && (
                  <p className="text-xs">Side: {pain.laterality}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
      
      {/* Label */}
      <text x="50" y="138" textAnchor="middle" className="text-[8px] fill-muted-foreground font-medium">FRONT</text>
    </svg>
  );
};

// New improved human body outline - BACK VIEW
const HumanBodyBack = ({ painLocations }) => {
  const backPain = painLocations.filter(p => {
    const region = BODY_REGIONS[p.region];
    return region && region.view === 'back';
  });

  return (
    <svg viewBox="0 0 100 140" className="w-full h-full">
      {/* Anatomical body outline - back view */}
      <g fill="none" stroke="rgba(148, 163, 184, 0.4)" strokeWidth="1.5">
        {/* Head */}
        <ellipse cx="50" cy="12" rx="12" ry="11" />
        
        {/* Neck */}
        <rect x="45" y="21" width="10" height="8" rx="2" />
        
        {/* Back/Torso - segmented */}
        <path d="M32 29 L68 29 L70 50 L68 66 L32 66 L30 50 Z" />
        {/* Back segments - spine line */}
        <line x1="50" y1="29" x2="50" y2="66" strokeDasharray="2,2" strokeWidth="0.5" />
        {/* Upper/lower back division */}
        <line x1="30" y1="48" x2="70" y2="48" strokeDasharray="2,2" strokeWidth="0.5" />
        
        {/* Left arm (from behind) */}
        <path d="M32 29 L24 32 L18 50 L14 68 L10 82" strokeLinecap="round" strokeWidth="1.5" />
        {/* Right arm */}
        <path d="M68 29 L76 32 L82 50 L86 68 L90 82" strokeLinecap="round" strokeWidth="1.5" />
        
        {/* Shoulder segments */}
        <ellipse cx="24" cy="33" rx="6" ry="5" strokeWidth="1" />
        <ellipse cx="76" cy="33" rx="6" ry="5" strokeWidth="1" />
        
        {/* Glutes/pelvis area */}
        <path d="M32 66 L32 76 L42 80 L50 78 L58 80 L68 76 L68 66" />
        {/* Glutes division */}
        <line x1="50" y1="66" x2="50" y2="80" strokeDasharray="2,2" strokeWidth="0.5" />
        
        {/* Left leg */}
        <path d="M42 80 L40 100 L38 120 L36 135" strokeLinecap="round" strokeWidth="1.5" />
        {/* Right leg */}
        <path d="M58 80 L60 100 L62 120 L64 135" strokeLinecap="round" strokeWidth="1.5" />
        
        {/* Calf/knee markers */}
        <ellipse cx="40" cy="100" rx="5" ry="4" strokeWidth="1" />
        <ellipse cx="60" cy="100" rx="5" ry="4" strokeWidth="1" />
        
        {/* Hand outlines */}
        <ellipse cx="10" cy="84" rx="5" ry="6" strokeWidth="1" />
        <ellipse cx="90" cy="84" rx="5" ry="6" strokeWidth="1" />
        
        {/* Heel/foot outlines */}
        <ellipse cx="36" cy="135" rx="5" ry="4" strokeWidth="1" />
        <ellipse cx="64" cy="135" rx="5" ry="4" strokeWidth="1" />
      </g>
      
      {/* Pain highlights */}
      {backPain.map((pain, index) => {
        const region = BODY_REGIONS[pain.region];
        if (!region) return null;
        
        const showLeft = shouldShowLeft(pain.laterality);
        const showRight = shouldShowRight(pain.laterality);
        const badge = getLateralityBadge(pain.laterality);
        
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        const mirrorX = 100 - centerX;
        
        return (
          <TooltipProvider key={index}>
            <Tooltip>
              <TooltipTrigger asChild>
                <g className="cursor-pointer">
                  {/* Left side or center highlight */}
                  {(showLeft || !region.mirror) && (
                    <>
                      <circle
                        cx={centerX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 4}
                        fill="none"
                        stroke={getSeverityColor(pain.severity, 0.8)}
                        strokeWidth="2"
                        className="animate-ping"
                        style={{ animationDuration: '2s' }}
                      />
                      <circle
                        cx={centerX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 2}
                        fill={getSeverityColor(pain.severity, 0.5)}
                        stroke={getSeverityColor(pain.severity, 1)}
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                      {badge && region.mirror && (
                        <text 
                          x={centerX} 
                          y={centerY + 4} 
                          textAnchor="middle" 
                          className="text-[8px] font-bold fill-white"
                          style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
                        >
                          {pain.laterality === 'Left' ? 'L' : badge}
                        </text>
                      )}
                    </>
                  )}
                  {/* Right side highlight (mirrored regions only) */}
                  {region.mirror && showRight && (
                    <>
                      <circle
                        cx={mirrorX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 4}
                        fill="none"
                        stroke={getSeverityColor(pain.severity, 0.8)}
                        strokeWidth="2"
                        className="animate-ping"
                        style={{ animationDuration: '2s' }}
                      />
                      <circle
                        cx={mirrorX}
                        cy={centerY}
                        r={Math.max(region.width, region.height) / 2 + 2}
                        fill={getSeverityColor(pain.severity, 0.5)}
                        stroke={getSeverityColor(pain.severity, 1)}
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                      {badge && (
                        <text 
                          x={mirrorX} 
                          y={centerY + 4} 
                          textAnchor="middle" 
                          className="text-[8px] font-bold fill-white"
                          style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
                        >
                          {pain.laterality === 'Right' ? 'R' : badge}
                        </text>
                      )}
                    </>
                  )}
                </g>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{pain.region}</p>
                <p className="text-xs">Pain Level: {pain.pain_level}/10</p>
                <p className="text-xs capitalize">Severity: {pain.severity}</p>
                {pain.laterality && pain.laterality !== 'N/A' && (
                  <p className="text-xs">Side: {pain.laterality}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
      
      {/* Label */}
      <text x="50" y="138" textAnchor="middle" className="text-[8px] fill-muted-foreground font-medium">BACK</text>
    </svg>
  );
};

// Main Anatomical Pain Viewer Component
export const AnatomicalPainViewer = ({ painLocations = [] }) => {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 w-full">
      <div className="w-32 sm:w-40 h-48 sm:h-56">
        <HumanBodyFront painLocations={painLocations} />
      </div>
      <div className="w-32 sm:w-40 h-48 sm:h-56">
        <HumanBodyBack painLocations={painLocations} />
      </div>
    </div>
  );
};

export default AnatomicalPainViewer;
