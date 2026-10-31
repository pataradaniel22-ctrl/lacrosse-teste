import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Home, Sun, ShieldCheck, History, User, LayoutDashboard, Bell, Shield, HeartPulse } from 'lucide-react';

export default function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { userType, user } = useAuth();
  
  // Don't show on login/register pages
  if (location.pathname.includes('/login') || location.pathname.includes('/register')) {
    return null;
  }
  
  const athleteNavItems = [
    { icon: Home, label: 'Home', path: '/athlete' },
    { icon: Sun, label: 'Check-in', path: '/athlete/morning-check-in' },
    { icon: ShieldCheck, label: 'Recovery', path: '/athlete/recovery' },
    { icon: History, label: 'History', path: '/athlete/history' },
    { icon: User, label: 'Profile', path: '/athlete/profile' },
  ];
  
  const staffNavItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/staff' },
    { icon: HeartPulse, label: 'Recovery', path: '/staff/recovery-intelligence' },
    { icon: Bell, label: 'Alerts', path: '/staff/alerts' },
    ...(user?.role === 'Admin' ? [{ icon: Shield, label: 'Admin', path: '/staff/admin' }] : []),
    { icon: User, label: 'Profile', path: '/staff/profile' },
  ];
  
  const navItems = userType === 'athlete' ? athleteNavItems : staffNavItems;
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-white/10 safe-area-bottom md:hidden">
      <div className="flex items-center justify-around h-16 px-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path === '/athlete' && location.pathname === '/athlete') ||
            (item.path === '/staff' && location.pathname === '/staff');
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all duration-200 ${
                isActive 
                  ? 'text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
