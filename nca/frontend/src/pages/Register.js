import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { UserPlus, ArrowLeft, CheckCircle2, Camera, X } from 'lucide-react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Modalidades disponíveis
const MODALIDADES = [
  'Futebol',
  'Futevôlei',
  'CrossFit',
  'Corrida',
  'Musculação',
  'Vôlei',
  'Basquete',
  'Handebol',
  'Tênis',
  'Natação',
  'Triathlon',
  'Outro'
];

export default function Register() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    team: '',
    customTeam: '',
    sexo: ''
  });
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Selecione um arquivo de imagem válido (JPEG, PNG, GIF ou WebP)');
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        toast.error('O tamanho da imagem deve ser menor que 5MB');
        return;
      }
      
      setProfilePhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const removePhoto = () => {
    setProfilePhoto(null);
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    
    if (formData.password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    
    if (!formData.team) {
      toast.error('Por favor, selecione sua modalidade');
      return;
    }

    if (formData.team === 'Outro' && !formData.customTeam.trim()) {
      toast.error('Por favor, especifique sua modalidade');
      return;
    }

    if (!formData.sexo) {
      toast.error('Por favor, selecione seu sexo');
      return;
    }
    
    setIsLoading(true);
    
    try {
      let photoUrl = null;
      if (profilePhoto) {
        const photoFormData = new FormData();
        photoFormData.append('file', profilePhoto);
        const uploadRes = await axios.post(`${API}/upload/profile-photo`, photoFormData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        photoUrl = uploadRes.data.url;
      }
      
      const modalidade = formData.team === 'Outro' ? formData.customTeam.trim() : formData.team;
      
      await axios.post(`${API}/auth/register/athlete`, {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        team: modalidade,
        sexo: formData.sexo,
        profile_photo: photoUrl
      });
      
      setIsSuccess(true);
      toast.success('Cadastro enviado com sucesso!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Falha no cadastro');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-black to-black" />
        
        <Card className="relative z-10 w-full max-w-md bg-zinc-900/80 border-zinc-800 backdrop-blur-sm animate-fade-in">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-heading font-bold mb-2 text-white">Cadastro Enviado!</h2>
            <p className="text-zinc-400 mb-6">
              Seu cadastro está aguardando aprovação. Você poderá fazer login assim que um administrador aprovar sua conta.
            </p>
            <p className="text-sm text-zinc-500 mb-6">
              Isso geralmente leva de 24 a 48 horas. Por favor, volte mais tarde.
            </p>
            <Button 
              onClick={() => navigate('/login')}
              className="w-full bg-white text-black hover:bg-zinc-200"
              data-testid="back-to-login-btn"
            >
              Voltar ao Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-black to-black" />
      
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        <div className="text-center mb-6">
          <img 
            src="/nca-logo.png" 
            alt="NCA"
            className="w-20 h-20 mx-auto mb-3 object-contain"
          />
          <h1 className="text-2xl font-heading font-black text-white mb-1">
            Cadastro de Atleta
          </h1>
          <p className="text-zinc-400 text-sm">NCA - Núcleo de Cuidado ao Atleta</p>
        </div>
        
        <Card className="bg-zinc-900/80 border-zinc-800 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-lg font-heading text-center flex items-center justify-center gap-2 text-white">
              <UserPlus className="w-5 h-5" />
              Criar Conta
            </CardTitle>
            <CardDescription className="text-center text-zinc-400 text-sm">
              Cadastre-se para acompanhar seus treinos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Profile Photo Upload */}
              <div className="flex flex-col items-center mb-3">
                <Label className="mb-2 text-xs text-zinc-500">Foto de Perfil (Opcional)</Label>
                <div className="relative">
                  {photoPreview ? (
                    <div className="relative">
                      <img 
                        src={photoPreview} 
                        alt="Preview" 
                        className="w-20 h-20 rounded-full object-cover border-2 border-zinc-700"
                      />
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-20 h-20 rounded-full bg-zinc-800 border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center hover:border-zinc-500 transition-colors"
                    >
                      <Camera className="w-5 h-5 text-zinc-500 mb-1" />
                      <span className="text-[9px] text-zinc-500">Adicionar</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="name" className="text-zinc-300 text-sm">Nome Completo</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome completo"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  className="h-10 bg-zinc-800/50 border-zinc-700 focus:border-white text-white placeholder:text-zinc-500"
                  data-testid="register-name-input"
                />
              </div>
              
              <div className="space-y-1">
                <Label htmlFor="email" className="text-zinc-300 text-sm">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  required
                  className="h-10 bg-zinc-800/50 border-zinc-700 focus:border-white text-white placeholder:text-zinc-500"
                  data-testid="register-email-input"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="sexo" className="text-zinc-300 text-sm">Sexo</Label>
                <Select
                  value={formData.sexo}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, sexo: value }))}
                >
                  <SelectTrigger className="h-10 bg-zinc-800/50 border-zinc-700 text-white" data-testid="register-sexo-select">
                    <SelectValue placeholder="Selecione seu sexo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Masculino">Masculino</SelectItem>
                    <SelectItem value="Feminino">Feminino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label htmlFor="team" className="text-zinc-300 text-sm">Modalidade</Label>
                <Select
                  value={formData.team}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, team: value }))}
                >
                  <SelectTrigger className="h-10 bg-zinc-800/50 border-zinc-700 text-white" data-testid="register-team-select">
                    <SelectValue placeholder="Selecione sua modalidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALIDADES.map((mod) => (
                      <SelectItem key={mod} value={mod}>{mod}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.team === 'Outro' && (
                <div className="space-y-1">
                  <Label htmlFor="customTeam" className="text-zinc-300 text-sm">Especifique a Modalidade</Label>
                  <Input
                    id="customTeam"
                    type="text"
                    placeholder="Digite sua modalidade"
                    value={formData.customTeam}
                    onChange={(e) => setFormData(prev => ({ ...prev, customTeam: e.target.value }))}
                    required
                    className="h-10 bg-zinc-800/50 border-zinc-700 focus:border-white text-white placeholder:text-zinc-500"
                  />
                </div>
              )}
              
              <div className="space-y-1">
                <Label htmlFor="password" className="text-zinc-300 text-sm">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  required
                  minLength={6}
                  className="h-10 bg-zinc-800/50 border-zinc-700 focus:border-white text-white"
                  data-testid="register-password-input"
                />
              </div>
              
              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="text-zinc-300 text-sm">Confirmar Senha</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  required
                  className="h-10 bg-zinc-800/50 border-zinc-700 focus:border-white text-white"
                  data-testid="register-confirm-password-input"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-10 font-bold uppercase tracking-wider bg-white text-black hover:bg-zinc-200 transition-all"
                disabled={isLoading}
                data-testid="register-submit-btn"
              >
                {isLoading ? 'Cadastrando...' : 'Cadastrar como Atleta'}
              </Button>
            </form>
            
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-zinc-400">
                <strong className="text-amber-400">Nota:</strong> Sua conta precisará de aprovação de um administrador antes que você possa fazer login.
              </p>
            </div>
            
            <div className="mt-4 text-center">
              <Link 
                to="/login" 
                className="text-sm text-zinc-500 hover:text-white transition-colors inline-flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar ao Login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
