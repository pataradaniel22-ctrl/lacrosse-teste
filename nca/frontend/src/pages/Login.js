import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const { userType } = await login(email, password);
      toast.success('Bem-vindo(a) de volta!');
      navigate(userType === 'athlete' ? '/athlete' : '/staff');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Falha no login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-black to-black" />
      
      {/* Content */}
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo Section */}
        <div className="text-center mb-8">
          <img 
            src="/nca-logo.png" 
            alt="NCA"
            className="w-32 h-32 mx-auto mb-4 object-contain"
          />
          <h1 className="text-3xl font-heading font-black text-white mb-2">
            NCA
          </h1>
          <p className="text-zinc-400">Núcleo de Cuidado ao Atleta</p>
        </div>
        
        <Card className="bg-zinc-900/80 border-zinc-800 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-heading text-center text-white">Entrar</CardTitle>
            <CardDescription className="text-center text-zinc-400">
              Digite suas credenciais para acessar o sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 bg-zinc-800/50 border-zinc-700 focus:border-white text-white placeholder:text-zinc-500"
                  data-testid="login-email-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-300">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 bg-zinc-800/50 border-zinc-700 focus:border-white text-white"
                  data-testid="login-password-input"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 font-bold uppercase tracking-wider bg-white text-black hover:bg-zinc-200 transition-all"
                disabled={isLoading}
                data-testid="login-submit-btn"
              >
                {isLoading ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
            
            {/* Register Links */}
            <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
              <p className="text-sm text-zinc-500 mb-3">
                Novo no NCA?
              </p>
              <div className="flex flex-col gap-2">
                <Link to="/register/athlete">
                  <Button variant="outline" className="w-full border-zinc-700 hover:bg-zinc-800 text-white">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Cadastrar como Atleta
                  </Button>
                </Link>
                <Link to="/register/staff">
                  <Button variant="outline" className="w-full border-zinc-700 hover:bg-zinc-800 text-zinc-400 hover:text-white">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Cadastrar como Profissional
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Footer */}
        <p className="text-center text-xs text-zinc-600 mt-6">
          © 2024 NCA - Núcleo de Cuidado ao Atleta
        </p>
      </div>
    </div>
  );
}
