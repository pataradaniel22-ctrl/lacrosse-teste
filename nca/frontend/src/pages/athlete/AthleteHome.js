import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Sun, 
  Dumbbell, 
  Moon, 
  History, 
  LogOut, 
  Bell,
  Activity,
  TrendingUp,
  Zap,
  User
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AthleteHome() {
  const { user, logout, getAuthHeaders } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, notifRes] = await Promise.all([
        axios.get(`${API}/athlete/summary`, getAuthHeaders()),
        axios.get(`${API}/notifications`, getAuthHeaders())
      ]);
      setSummary(summaryRes.data);
      setNotifications(notifRes.data.filter(n => !n.read));
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const menuItems = [
    {
      title: 'Morning Check-In',
      description: 'Log your readiness and wellness',
      icon: Sun,
      path: '/athlete/morning-check-in',
      color: 'from-amber-500/20 to-orange-500/20',
      iconColor: 'text-amber-400'
    },
    {
      title: 'Post Training Log',
      description: 'Record your session details',
      icon: Dumbbell,
      path: '/athlete/post-training',
      color: 'from-blue-500/20 to-indigo-500/20',
      iconColor: 'text-blue-400'
    },
    {
      title: 'Evening Recovery',
      description: 'Track your recovery status',
      icon: Moon,
      path: '/athlete/evening-recovery',
      color: 'from-purple-500/20 to-pink-500/20',
      iconColor: 'text-purple-400'
    },
    {
      title: 'My History',
      description: 'View your progress over time',
      icon: History,
      path: '/athlete/history',
      color: 'from-emerald-500/20 to-teal-500/20',
      iconColor: 'text-emerald-400'
    }
  ];

  return (
    <div className="min-h-screen bg-background" data-testid="athlete-home">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-heavy border-b border-white/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/brazil-lacrosse-logo.png" 
              alt="Brazil Lacrosse"
              className="w-10 h-10 object-contain"
            />
            <div>
              <h1 className="font-heading font-bold text-lg">{user?.name}</h1>
              <p className="text-xs text-muted-foreground">{user?.team}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="relative"
              data-testid="notifications-btn"
            >
              <Bell className="w-5 h-5" />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-[10px] flex items-center justify-center font-bold">
                  {notifications.length}
                </span>
              )}
            </Button>
            <Link to="/athlete/profile">
              {user?.profile_photo ? (
                <img 
                  src={user.profile_photo.startsWith('http') ? user.profile_photo : `${process.env.REACT_APP_BACKEND_URL}${user.profile_photo}`}
                  alt={user.name}
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/20 hover:border-primary/50 transition-colors"
                />
              ) : (
                <Button variant="ghost" size="icon" data-testid="profile-btn">
                  <User className="w-5 h-5" />
                </Button>
              )}
            </Link>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleLogout}
              data-testid="logout-btn"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Stats Cards */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Readiness</span>
                </div>
                <p className="text-2xl font-heading font-bold text-foreground">
                  {summary.last_7_days_avg_readiness.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">7-day average</p>
              </CardContent>
            </Card>
            <Card className="glass-light border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Load</span>
                </div>
                <p className="text-2xl font-heading font-bold text-foreground">
                  {summary.last_7_days_total_load.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">7-day total</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Menu Items */}
        <div className="space-y-3">
          {menuItems.map((item, index) => (
            <Link 
              key={item.path} 
              to={item.path}
              className="block animate-fade-in"
              style={{ animationDelay: `${index * 100}ms` }}
              data-testid={`menu-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Card className="glass-light border-white/5 hover:border-primary/30 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className={`absolute inset-0 rounded-xl bg-gradient-to-br ${item.color} opacity-50`} />
                  <div className="relative flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center ${item.iconColor}`}>
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-heading font-bold text-foreground">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <div className="text-muted-foreground">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Team Badge */}
        <div className="text-center pt-6">
          <Badge variant="outline" className="px-4 py-2 border-primary/30 text-primary">
            {user?.team}
          </Badge>
        </div>
      </main>
    </div>
  );
}
