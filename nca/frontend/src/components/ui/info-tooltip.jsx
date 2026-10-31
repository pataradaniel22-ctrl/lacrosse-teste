import * as React from "react"
import { Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover"

/**
 * InfoTooltip - Mobile-friendly info tooltip component
 * Uses Popover (click-based) which works on both desktop and mobile
 * Tap/click to open, tap outside or X button to close
 */
const InfoTooltip = React.forwardRef(({ 
  className,
  children,
  title,
  iconClassName = "w-3.5 h-3.5",
  side = "top",
  align = "center",
  ...props 
}, ref) => {
  const [open, setOpen] = React.useState(false);
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button 
          ref={ref}
          type="button"
          className={cn(
            "inline-flex items-center justify-center cursor-help touch-manipulation",
            "rounded-full p-0.5 -m-0.5",
            "hover:bg-muted/50 active:bg-muted/70 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            className
          )}
          aria-label="More information"
          {...props}
        >
          <Info className={cn("text-muted-foreground hover:text-foreground transition-colors", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side={side}
        align={align}
        className={cn(
          "w-[calc(100vw-2rem)] max-w-sm p-0 shadow-lg",
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
          <div className="p-3 pr-8 sm:pr-3 text-xs">
            {title && (
              <p className="font-semibold mb-2 text-sm">{title}</p>
            )}
            {children}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

InfoTooltip.displayName = "InfoTooltip";

/**
 * InfoContent - Helper component for structured tooltip content
 */
const InfoContent = ({ children, className }) => (
  <div className={cn("text-muted-foreground", className)}>
    {children}
  </div>
);

/**
 * InfoSection - Helper for sections within tooltip
 */
const InfoSection = ({ label, children, className }) => (
  <p className={cn("mb-1", className)}>
    {label && <strong>{label}:</strong>} {children}
  </p>
);

/**
 * InfoList - Helper for color-coded lists
 */
const InfoList = ({ items, className }) => (
  <div className={cn("space-y-1 mt-2", className)}>
    {items.map((item, index) => (
      <p key={index} className="flex items-center gap-1.5">
        <span className={cn("w-2 h-2 rounded-full shrink-0", item.colorClass)} />
        <span>{item.text}</span>
      </p>
    ))}
  </div>
);

/**
 * InfoWarning - Helper for warning notes
 */
const InfoWarning = ({ children, className }) => (
  <p className={cn("text-[10px] text-amber-400 mt-2 flex items-start gap-1", className)}>
    <span className="shrink-0">⚠️</span>
    <span>{children}</span>
  </p>
);

export { InfoTooltip, InfoContent, InfoSection, InfoList, InfoWarning };
