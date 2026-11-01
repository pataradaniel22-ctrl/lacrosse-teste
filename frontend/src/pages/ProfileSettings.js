import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { ArrowLeft, Camera, User, Save, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { user, userType, getAuthHeaders, refreshUser } = useAuth();
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Get the full photo URL
  const getPhotoUrl = (photoPath) => {
    if (!photoPath) return null;
    if (photoPath.startsWith('http')) return photoPath;
    return `${BACKEND_URL}${photoPath}`;
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
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
    
    setIsUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      await axios.put(`${API}/profile/photo`, formData, {
        ...getAuthHeaders(),
        headers: {
          ...getAuthHeaders().headers,
          'Content-Type': 'multipart/form-data'
        }
      });
      
      toast.success('Profile photo updated successfully!');
      
      // Refresh user data
      if (refreshUser) {
        await refreshUser();
      }
      
      // Force page reload to see the new photo
      window.location.reload();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upload photo');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveName = async () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    
    setIsSaving(true);
    
    try {
      await axios.put(`${API}/profile?name=${encodeURIComponent(name)}`, {}, getAuthHeaders());
      toast.success('Profile updated successfully!');
      
      // Refresh user data
      if (refreshUser) {
        await refreshUser();
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('New password must be different from the current one');
      return;
    }

    setIsChangingPassword(true);
    try {
      await axios.put(
        `${API}/auth/change-password`,
        { current_password: currentPassword, new_password: newPassword },
        getAuthHeaders()
      );
      toast.success('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const goBack = () => {
    if (userType === 'athlete') {
      navigate('/athlete');
    } else {
      navigate('/staff');
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-heading font-bold">Profile Settings</h1>
        </div>
        
        <Card className="glass-light border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Your Profile
            </CardTitle>
            <CardDescription>
              Update your profile information and photo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Profile Photo */}
            <div className="flex flex-col items-center">
              <Label className="mb-3 text-sm text-muted-foreground">Profile Photo</Label>
              <div className="relative">
                {user?.profile_photo ? (
                  <img 
                    src={getPhotoUrl(user.profile_photo)} 
                    alt="Profile" 
                    className="w-32 h-32 rounded-full object-cover border-4 border-primary/30"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-muted/50 border-4 border-white/20 flex items-center justify-center">
                    <span className="text-4xl font-bold text-muted-foreground">
                      {user?.name?.charAt(0) || '?'}
                    </span>
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/80 transition-colors disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Camera className="w-5 h-5" />
                  )}
                </button>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Click the camera icon to change your photo
              </p>
            </div>
            
            {/* User Info (Read-only) */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="flex gap-2">
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 bg-background/50 border-white/10"
                  />
                  <Button 
                    onClick={handleSaveName} 
                    disabled={isSaving || name === user?.name}
                    className="h-12"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={user?.email || ''}
                  disabled
                  className="h-12 bg-background/30 border-white/5 text-muted-foreground"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Role</Label>
                <Input
                  value={userType === 'athlete' ? 'Athlete' : (user?.role || 'Staff')}
                  disabled
                  className="h-12 bg-background/30 border-white/5 text-muted-foreground"
                />
              </div>
              
              {user?.team && (
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Input
                    value={user.team}
                    disabled
                    className="h-12 bg-background/30 border-white/5 text-muted-foreground"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-light border-white/10 mt-6" data-testid="change-password-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              Change Password
            </CardTitle>
            <CardDescription>
              Use at least 8 characters. You will stay logged in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="h-12 bg-background/50 border-white/10"
                  data-testid="current-password-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-12 bg-background/50 border-white/10"
                  data-testid="new-password-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-12 bg-background/50 border-white/10"
                  data-testid="confirm-password-input"
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                data-testid="toggle-password-visibility"
              >
                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </button>
              <Button
                type="submit"
                disabled={isChangingPassword}
                className="w-full h-12"
                data-testid="change-password-submit"
              >
                {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
