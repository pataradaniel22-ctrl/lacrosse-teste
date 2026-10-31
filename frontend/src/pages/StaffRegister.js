import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { UserPlus, ArrowLeft, CheckCircle2, Shield, Camera, X } from 'lucide-react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function StaffRegister() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const fileInputRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: '',
    team: ''
  });
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [availableTeams, setAvailableTeams] = useState([]);

  useEffect(() => {
    // Fetch available roles and teams
    const fetchOptions = async () => {
      try {
        const response = await axios.get(`${API}/auth/public-staff-roles`);
        setAvailableRoles(response.data.roles);
        setAvailableTeams(response.data.teams);
      } catch (error) {
        // Fallback values
        setAvailableRoles(['Coach', 'Physio', 'Research']);
        setAvailableTeams(['Brazil Lacrosse Men', 'Brazil Lacrosse Women']);
      }
    };
    fetchOptions();
  }, []);

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Please select a valid image file (JPEG, PNG, GIF, or WebP)');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size must be less than 5MB');
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
      toast.error('Passwords do not match');
      return;
    }
    
    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    
    if (!formData.role) {
      toast.error('Please select your role');
      return;
    }
    
    if (!formData.team) {
      toast.error('Please select your team');
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Upload photo first if provided
      let photoUrl = null;
      if (profilePhoto) {
        const photoFormData = new FormData();
        photoFormData.append('file', profilePhoto);
        const uploadRes = await axios.post(`${API}/upload/profile-photo`, photoFormData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        photoUrl = uploadRes.data.url;
      }
      
      // Register staff with optional photo
      const response = await axios.post(`${API}/auth/register/staff`, {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        team: formData.team,
        profile_photo: photoUrl
      });
      
      // Staff registration gives immediate access
      if (response.data.token) {
        await login(formData.email, formData.password);
        toast.success('Registration successful! Welcome to Brasil Lacrosse.');
        navigate('/staff');
      } else {
        setIsSuccess(true);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
        
        <Card className="relative z-10 w-full max-w-md glass-heavy border-white/10 animate-fade-in">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-blue-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-blue-400" />
            </div>
            <h2 className="text-2xl font-heading font-bold mb-2">Registration Complete!</h2>
            <p className="text-muted-foreground mb-6">
              Your staff account has been created. You can now log in.
            </p>
            <Button 
              onClick={() => navigate('/login')}
              className="w-full"
              data-testid="back-to-login-btn"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <div className="text-center mb-8">
          <img 
            src="/brazil-lacrosse-logo.png" 
            alt="Brasil Lacrosse"
            className="w-20 h-20 mx-auto mb-4 object-contain"
          />
          <h1 className="text-3xl font-heading font-black text-foreground mb-2">
            Staff Registration
          </h1>
          <p className="text-muted-foreground">Join Brasil Lacrosse as Staff</p>
        </div>
        
        <Card className="glass-heavy border-white/10">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl font-heading text-center flex items-center justify-center gap-2">
              <Shield className="w-5 h-5 text-blue-400" />
              Create Staff Account
            </CardTitle>
            <CardDescription className="text-center">
              Register as a coach or staff member
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Profile Photo Upload */}
              <div className="flex flex-col items-center mb-4">
                <Label className="mb-2 text-sm text-muted-foreground">Profile Photo (Optional)</Label>
                <div className="relative">
                  {photoPreview ? (
                    <div className="relative">
                      <img 
                        src={photoPreview} 
                        alt="Profile preview" 
                        className="w-24 h-24 rounded-full object-cover border-2 border-blue-400/30"
                      />
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/80"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-24 h-24 rounded-full bg-muted/50 border-2 border-dashed border-white/20 flex flex-col items-center justify-center hover:border-blue-400/50 transition-colors"
                    >
                      <Camera className="w-6 h-6 text-muted-foreground mb-1" />
                      <span className="text-[10px] text-muted-foreground">Add Photo</span>
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

              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your full name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  className="h-12 bg-background/50 border-white/10 focus:border-blue-400"
                  data-testid="staff-register-name-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  required
                  className="h-12 bg-background/50 border-white/10 focus:border-blue-400"
                  data-testid="staff-register-email-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <div className="flex flex-wrap gap-2" data-testid="staff-register-role-select">
                  {availableRoles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, role }))}
                      className={`px-4 py-2.5 rounded-lg text-sm border transition-colors ${
                        formData.role === role
                          ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                          : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                      }`}
                      data-testid={`staff-register-role-${role}`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="team">Team</Label>
                <div className="flex flex-wrap gap-2" data-testid="staff-register-team-select">
                  {availableTeams.map((team) => (
                    <button
                      key={team}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, team }))}
                      className={`px-4 py-2.5 rounded-lg text-sm border transition-colors ${
                        formData.team === team
                          ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                          : 'bg-background/50 border-white/10 text-muted-foreground hover:border-white/30'
                      }`}
                      data-testid={`staff-register-team-${team}`}
                    >
                      {team}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  required
                  minLength={6}
                  className="h-12 bg-background/50 border-white/10 focus:border-blue-400"
                  data-testid="staff-register-password-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  required
                  className="h-12 bg-background/50 border-white/10 focus:border-blue-400"
                  data-testid="staff-register-confirm-password-input"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] transition-transform"
                disabled={isLoading}
                data-testid="staff-register-submit-btn"
              >
                {isLoading ? 'Creating Account...' : 'Register as Staff'}
              </Button>
            </form>
            
            {/* Info */}
            <div className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-muted-foreground">
                <strong className="text-blue-400">Note:</strong> Staff accounts have access to team dashboards and analytics. Admin functions (approving athletes, managing users) require Admin access.
              </p>
            </div>
            
            {/* Back to login */}
            <div className="mt-6 text-center">
              <Link 
                to="/login" 
                className="text-sm text-muted-foreground hover:text-blue-400 transition-colors inline-flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
