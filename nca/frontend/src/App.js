import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StaffRegister from "./pages/StaffRegister";
import ProfileSettings from "./pages/ProfileSettings";
import AthleteHome from "./pages/athlete/AthleteHome";
import MorningCheckIn from "./pages/athlete/MorningCheckIn";
import PostTrainingLog from "./pages/athlete/PostTrainingLog";
import EveningRecovery from "./pages/athlete/EveningRecovery";
import MyHistory from "./pages/athlete/MyHistory";
import StaffDashboard from "./pages/staff/StaffDashboard";
import AthleteDetail from "./pages/staff/AthleteDetail";
import AlertsPage from "./pages/staff/AlertsPage";
import AdminPanel from "./pages/staff/AdminPanel";

const ProtectedRoute = ({ children, allowedType, requireAdmin }) => {
  const { user, userType, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-heading">Carregando...</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedType && userType !== allowedType) {
    return <Navigate to={userType === 'athlete' ? '/athlete' : '/staff'} replace />;
  }
  
  if (requireAdmin && user?.role !== 'Admin') {
    return <Navigate to="/staff" replace />;
  }
  
  return children;
};

function AppRoutes() {
  const { user, userType } = useAuth();
  
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={userType === 'athlete' ? '/athlete' : '/staff'} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={userType === 'athlete' ? '/athlete' : '/staff'} replace /> : <Register />} />
      <Route path="/register/athlete" element={user ? <Navigate to={userType === 'athlete' ? '/athlete' : '/staff'} replace /> : <Register />} />
      <Route path="/register/staff" element={user ? <Navigate to={userType === 'athlete' ? '/athlete' : '/staff'} replace /> : <StaffRegister />} />
      
      {/* Athlete Routes */}
      <Route path="/athlete" element={<ProtectedRoute allowedType="athlete"><AthleteHome /></ProtectedRoute>} />
      <Route path="/athlete/morning-check-in" element={<ProtectedRoute allowedType="athlete"><MorningCheckIn /></ProtectedRoute>} />
      <Route path="/athlete/post-training" element={<ProtectedRoute allowedType="athlete"><PostTrainingLog /></ProtectedRoute>} />
      <Route path="/athlete/evening-recovery" element={<ProtectedRoute allowedType="athlete"><EveningRecovery /></ProtectedRoute>} />
      <Route path="/athlete/history" element={<ProtectedRoute allowedType="athlete"><MyHistory /></ProtectedRoute>} />
      <Route path="/athlete/profile" element={<ProtectedRoute allowedType="athlete"><ProfileSettings /></ProtectedRoute>} />
      
      {/* Staff Routes */}
      <Route path="/staff" element={<ProtectedRoute allowedType="staff"><StaffDashboard /></ProtectedRoute>} />
      <Route path="/staff/athlete/:athleteId" element={<ProtectedRoute allowedType="staff"><AthleteDetail /></ProtectedRoute>} />
      <Route path="/staff/alerts" element={<ProtectedRoute allowedType="staff"><AlertsPage /></ProtectedRoute>} />
      <Route path="/staff/admin" element={<ProtectedRoute allowedType="staff" requireAdmin><AdminPanel /></ProtectedRoute>} />
      <Route path="/staff/profile" element={<ProtectedRoute allowedType="staff"><ProfileSettings /></ProtectedRoute>} />
      
      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
