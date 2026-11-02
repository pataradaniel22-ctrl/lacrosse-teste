import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const { userType } = await login(email, password);
      toast.success('Welcome back!');
      navigate(userType === 'athlete' ? '/athlete' : '/staff');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async (credential) => {
    setIsLoading(true);
    try {
      const { userType } = await loginWithGoogle(credential);
      toast.success('Welcome back!');
      navigate(userType === 'athlete' ? '/athlete' : '/staff');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Google sign-in failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-20"
        style={{ 
          backgroundImage: "url('https://images.unsplash.com/photo-1575049159608-99f2b7e789d9?w=1920')"
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
      
      {/* Content */}
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo Section */}
        <div className="text-center -mb-2 mt-16">
          <img 
            src="/ams-logo.png" 
            alt="AMS Brasil Lacrosse"
            className="w-full h-auto mx-auto object-contain -translate-x-3"
          />
        </div>
        
        <Card className="glass-heavy border-white/10">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-heading text-center">Sign In</CardTitle>
            <CardDescription className="text-center">
              Enter your credentials to access your dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 bg-background/50 border-white/10 focus:border-primary"
                  data-testid="login-email-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 bg-background/50 border-white/10 focus:border-primary"
                  data-testid="login-password-input"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 font-bold uppercase tracking-wider neon-shadow hover:scale-[1.02] transition-transform"
                disabled={isLoading}
                data-testid="login-submit-btn"
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-4">
              <GoogleSignInButton onCredential={handleGoogle} disabled={isLoading} />
            </div>
            
            {/* Register Links */}
            <div className="mt-6 pt-6 border-t border-white/10 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                New to Brasil Lacrosse?
              </p>
              <div className="flex flex-col gap-2">
                <Link to="/register/athlete">
                  <Button variant="outline" className="w-full border-primary/30 hover:bg-primary/10">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Register as Athlete
                  </Button>
                </Link>
                <Link to="/register/staff">
                  <Button variant="outline" className="w-full border-blue-500/30 hover:bg-blue-500/10 text-blue-400 hover:text-blue-300">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Register as Staff
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2024 Brasil Lacrosse National Teams
        </p>
        <p className="text-center text-xs text-muted-foreground mt-2 space-x-3">
          <Link to="/privacy" className="underline hover:text-foreground" data-testid="login-privacy-link">Privacy Policy</Link>
          <Link to="/terms" className="underline hover:text-foreground" data-testid="login-terms-link">Terms of Use</Link>
        </p>
      </div>
    </div>
  );
}
