import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import MobileBottomNav from "./components/MobileBottomNav";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StaffRegister from "./pages/StaffRegister";
import ProfileSettings from "./pages/ProfileSettings";
import AthleteHome from "./pages/athlete/AthleteHome";
import MorningCheckIn from "./pages/athlete/MorningCheckIn";
import PostTrainingLog from "./pages/athlete/PostTrainingLog";
import SurveyGate from "./components/SurveyGate";
import UpdatePrompt from "./components/UpdatePrompt";
import WeeklyHealthCheck from "./pages/athlete/WeeklyHealthCheck";
import EveningRecovery from "./pages/athlete/EveningRecovery";
import MyHistory from "./pages/athlete/MyHistory";
import NotificationSettings from "./pages/athlete/NotificationSettings";
import AthleteMessages from "./pages/athlete/AthleteMessages";
import RecoveryPoints from "./pages/athlete/RecoveryPoints";
import Nutrition from "./pages/athlete/Nutrition";
import StaffDashboard from "./pages/staff/StaffDashboard";
import PainManagement from "./pages/staff/PainManagement";
import MentalHealth from "./pages/staff/MentalHealth";
import AthleteDetail from "./pages/staff/AthleteDetail";
import AlertsPage from "./pages/staff/AlertsPage";
import AdminPanel from "./pages/staff/AdminPanel";
import SurveyAdmin from "./pages/staff/SurveyAdmin";
import RecoveryConfig from "./pages/staff/RecoveryConfig";
import RecoveryIntelligence from "./pages/staff/RecoveryIntelligence";
import EventReport from "./pages/staff/EventReport";
import HealthSurveillance from "./pages/staff/HealthSurveillance";
import Methodology from "./pages/staff/Methodology";
import Rankings from "./pages/staff/Rankings";
import StaffNotifications from "./pages/staff/StaffNotifications";
import StaffMessages from "./pages/staff/StaffMessages";
import InjuryIllness from "./pages/staff/InjuryIllness";
import TheFittest from "./pages/athlete/TheFittest";
import TheFittestAdmin from "./pages/staff/TheFittestAdmin";
import ResearchData from "./pages/staff/ResearchData";

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
      <Route path="/athlete/morning-check-in" element={<ProtectedRoute allowedType="athlete"><SurveyGate><MorningCheckIn /></SurveyGate></ProtectedRoute>} />
      <Route path="/athlete/post-training" element={<ProtectedRoute allowedType="athlete"><SurveyGate><PostTrainingLog /></SurveyGate></ProtectedRoute>} />
      <Route path="/athlete/survey" element={<ProtectedRoute allowedType="athlete"><SurveyGate><Navigate to="/athlete" replace /></SurveyGate></ProtectedRoute>} />
      <Route path="/athlete/health-check" element={<ProtectedRoute allowedType="athlete"><WeeklyHealthCheck /></ProtectedRoute>} />
      <Route path="/athlete/evening-recovery" element={<ProtectedRoute allowedType="athlete"><EveningRecovery /></ProtectedRoute>} />
      <Route path="/athlete/history" element={<ProtectedRoute allowedType="athlete"><MyHistory /></ProtectedRoute>} />
      <Route path="/athlete/notifications" element={<ProtectedRoute allowedType="athlete"><NotificationSettings /></ProtectedRoute>} />
      <Route path="/athlete/messages" element={<ProtectedRoute allowedType="athlete"><AthleteMessages /></ProtectedRoute>} />
      <Route path="/athlete/messages/:id" element={<ProtectedRoute allowedType="athlete"><AthleteMessages /></ProtectedRoute>} />
      <Route path="/athlete/recovery" element={<ProtectedRoute allowedType="athlete"><RecoveryPoints /></ProtectedRoute>} />
      <Route path="/athlete/nutrition" element={<ProtectedRoute allowedType="athlete"><Nutrition /></ProtectedRoute>} />
      <Route path="/athlete/profile" element={<ProtectedRoute allowedType="athlete"><ProfileSettings /></ProtectedRoute>} />
      <Route path="/athlete/the-fittest" element={<ProtectedRoute allowedType="athlete"><TheFittest /></ProtectedRoute>} />
      
      {/* Staff Routes */}
      <Route path="/staff" element={<ProtectedRoute allowedType="staff"><StaffDashboard /></ProtectedRoute>} />
      <Route path="/staff/athlete/:athleteId" element={<ProtectedRoute allowedType="staff"><AthleteDetail /></ProtectedRoute>} />
      <Route path="/staff/alerts" element={<ProtectedRoute allowedType="staff"><AlertsPage /></ProtectedRoute>} />
      <Route path="/staff/admin" element={<ProtectedRoute allowedType="staff" requireAdmin><AdminPanel /></ProtectedRoute>} />
      <Route path="/staff/surveys" element={<ProtectedRoute allowedType="staff" requireAdmin><SurveyAdmin /></ProtectedRoute>} />
      <Route path="/staff/the-fittest" element={<ProtectedRoute allowedType="staff" requireAdmin><TheFittestAdmin /></ProtectedRoute>} />
      <Route path="/staff/research-data" element={<ProtectedRoute allowedType="staff" requireAdmin><ResearchData /></ProtectedRoute>} />
      <Route path="/staff/recovery" element={<ProtectedRoute allowedType="staff"><RecoveryConfig /></ProtectedRoute>} />
      <Route path="/staff/recovery-intelligence" element={<ProtectedRoute allowedType="staff"><RecoveryIntelligence /></ProtectedRoute>} />
      <Route path="/staff/event-report" element={<ProtectedRoute allowedType="staff"><EventReport /></ProtectedRoute>} />
      <Route path="/staff/health" element={<ProtectedRoute allowedType="staff"><HealthSurveillance /></ProtectedRoute>} />
      <Route path="/staff/pain-management" element={<ProtectedRoute allowedType="staff"><PainManagement /></ProtectedRoute>} />
      <Route path="/staff/mental-health" element={<ProtectedRoute allowedType="staff"><MentalHealth /></ProtectedRoute>} />
      <Route path="/staff/methodology" element={<ProtectedRoute allowedType="staff"><Methodology /></ProtectedRoute>} />
      <Route path="/staff/rankings" element={<ProtectedRoute allowedType="staff"><Rankings /></ProtectedRoute>} />
      <Route path="/staff/notifications" element={<ProtectedRoute allowedType="staff"><StaffNotifications /></ProtectedRoute>} />
      <Route path="/staff/messages" element={<ProtectedRoute allowedType="staff"><StaffMessages /></ProtectedRoute>} />
      <Route path="/staff/injury-illness" element={<ProtectedRoute allowedType="staff"><InjuryIllness /></ProtectedRoute>} />
      <Route path="/staff/messages/:id" element={<ProtectedRoute allowedType="staff"><StaffMessages /></ProtectedRoute>} />
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
        <UpdatePrompt />
        <Toaster position="bottom-center" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
