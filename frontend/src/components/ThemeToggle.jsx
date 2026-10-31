import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

// Toggles between the dark-blue and light themes. Default is dark (set in index.html).
export const ThemeToggle = ({ className = '' }) => {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('bl_theme', next ? 'dark' : 'light');
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-card/60 text-foreground hover:bg-accent transition-colors ${className}`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};

export default ThemeToggle;
