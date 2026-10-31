from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
from enum import Enum
import numpy as np
import csv
import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# Import visual PDF export service
from pdf_export_service import (
    create_readiness_trend_chart,
    create_radar_chart,
    create_workload_bar_chart,
    create_acwr_gauge_chart,
    create_pain_heatmap,
    create_compliance_chart,
    create_empty_chart,
    get_styles,
    create_cover_page,
    create_key_metrics_section,
    add_chart_with_caption,
    create_simple_table,
    COLORS
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT settings
JWT_SECRET = os.environ.get('JWT_SECRET', 'brazil-lacrosse-secret-2024')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Create the main app
app = FastAPI(title="NCA - Núcleo de Cuidado ao Atleta")

# Create uploads directory for profile photos
UPLOAD_DIR = ROOT_DIR / "uploads" / "profiles"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Mount static files for serving uploaded images at both paths
# /uploads for local development and /api/uploads for production (through ingress)
app.mount("/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="uploads")
app.mount("/api/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="api-uploads")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Enums - Modalidades
class TeamEnum(str, Enum):
    FUTEBOL = "Futebol"
    FUTEVOLEI = "Futevôlei"
    CROSSFIT = "CrossFit"
    CORRIDA = "Corrida"
    MUSCULACAO = "Musculação"
    VOLEI = "Vôlei"
    BASQUETE = "Basquete"
    HANDEBOL = "Handebol"
    TENIS = "Tênis"
    NATACAO = "Natação"
    TRIATHLON = "Triathlon"
    OUTRO = "Outro"

class StaffRoleEnum(str, Enum):
    ADMIN = "Admin"
    COACH = "Treinador"
    PHYSIO = "Fisioterapeuta"
    RESEARCH = "Pesquisador"

# Public roles that can be selected during registration (Admin is NOT included)
PUBLIC_STAFF_ROLES = ["Treinador", "Fisioterapeuta", "Pesquisador"]

# Admin configuration - single predefined admin
ADMIN_EMAIL = "admin@nca.com.br"
ADMIN_INITIAL_PASSWORD = "admin123"

class SessionTypeEnum(str, Enum):
    STRENGTH = "Força"
    CONDITIONING = "Condicionamento"
    TECHNICAL = "Técnico"
    TACTICAL = "Tático"
    MATCH = "Jogo/Competição"
    REHAB = "Reabilitação"
    RECOVERY = "Recuperação"
    OTHER = "Outro"

class BodyRegionEnum(str, Enum):
    NECK = "Pescoço"
    SHOULDER = "Ombro"
    ELBOW = "Cotovelo"
    WRIST_HAND = "Punho/Mão"
    LOW_BACK = "Lombar"
    HIP_GROIN = "Quadril/Virilha"
    KNEE = "Joelho"
    ANKLE_FOOT = "Tornozelo/Pé"
    OTHER = "Outro"

class LateralityEnum(str, Enum):
    LEFT = "Esquerdo"
    RIGHT = "Direito"
    BOTH = "Ambos"
    NA = "N/A"

class AlertTypeEnum(str, Enum):
    LOW_READINESS = "LowReadiness"
    HIGH_LOAD_SPIKE = "HighLoadSpike"
    PERSISTENT_PAIN = "PersistentPain"
    MISSING_ENTRIES = "MissingEntries"

class AlertSeverityEnum(str, Enum):
    GREEN = "Green"
    YELLOW = "Yellow"
    RED = "Red"

class AthleteStatusEnum(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

class MenstrualFlowEnum(str, Enum):
    NONE = "Nenhum"
    SPOTTING = "Escape"
    LIGHT = "Leve"
    MODERATE = "Moderado"
    HEAVY = "Intenso"

class MenstrualPainEnum(str, Enum):
    NONE = "Nenhuma"
    MILD = "Leve"
    MODERATE = "Moderada"
    SEVERE = "Intensa"
    VERY_SEVERE = "Muito Intensa"

# Analysis Context Enums
class AnalysisContextEnum(str, Enum):
    SEASON = "season"
    EVENT = "event"

class EventTypeEnum(str, Enum):
    TRAINING_CAMP = "camp_treinamento"
    TOURNAMENT = "competicao"
    OTHER = "outro"

# Event Model for Analysis Context
class EventCreate(BaseModel):
    name: str
    event_type: EventTypeEnum
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    team: Optional[TeamEnum] = None
    description: Optional[str] = None

class Event(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    event_type: EventTypeEnum
    start_date: str
    end_date: str
    team: Optional[TeamEnum] = None
    description: Optional[str] = None
    created_by: str  # Staff user ID
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_active: bool = True

# Models
class AthleteBase(BaseModel):
    name: str
    email: EmailStr
    team: str  # Modalidade - can be enum value or custom text for "Outro"
    sexo: Optional[str] = None  # "Masculino" or "Feminino"
    preferred_training_time: str = "09:00"
    active: bool = True
    profile_photo: Optional[str] = None

class AthleteCreate(AthleteBase):
    password: str

class Athlete(AthleteBase):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: AthleteStatusEnum = AthleteStatusEnum.PENDING
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class StaffUserBase(BaseModel):
    name: str
    email: EmailStr
    role: StaffRoleEnum
    team: Optional[TeamEnum] = None  # Team assignment for Staff
    active: bool = True
    profile_photo: Optional[str] = None

class StaffUserCreate(StaffUserBase):
    password: str

class StaffUser(StaffUserBase):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    token: str
    user_type: str
    user: dict

# Daily Readiness (Morning Check-In)
class DailyReadinessCreate(BaseModel):
    sleep_quality: int = Field(ge=0, le=10)
    morning_fatigue: int = Field(ge=0, le=10)
    muscle_soreness: int = Field(ge=0, le=10)
    stress: int = Field(ge=0, le=10)
    readiness: int = Field(ge=0, le=10)
    notes: Optional[str] = None
    # Menstrual cycle fields (for female athletes)
    is_menstruating: Optional[bool] = None
    menstrual_flow: Optional[MenstrualFlowEnum] = None
    menstrual_pain: Optional[MenstrualPainEnum] = None
    menstrual_symptoms: Optional[List[str]] = None  # cramps, low_back_pain, abdominal_pain, headache, breast_tenderness

class DailyReadiness(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date: str
    sleep_quality: int
    morning_fatigue: int
    muscle_soreness: int
    stress: int
    readiness: int
    notes: Optional[str] = None
    fatigue_score_10: int
    soreness_score_10: int
    stress_score_10: int
    readiness_score: float
    # Menstrual cycle data
    is_menstruating: Optional[bool] = None
    menstrual_flow: Optional[str] = None
    menstrual_pain: Optional[str] = None
    menstrual_symptoms: Optional[List[str]] = None
    created_at: str

# Pain Report Item for multiple pain locations
class PainReportItem(BaseModel):
    body_region: BodyRegionEnum
    laterality: Optional[LateralityEnum] = None
    pain_level: int = Field(ge=0, le=10, default=5)

# Training Session (Post Training Log)
class TrainingSessionCreate(BaseModel):
    date_time_start: str
    session_type: SessionTypeEnum
    duration_min: int = Field(ge=0)
    rpe: int = Field(ge=0, le=10)
    pain_during: int = Field(ge=0, le=10)
    pain_after: int = Field(ge=0, le=10)
    end_fatigue: int = Field(ge=0, le=10)
    # Legacy single pain support (for backwards compatibility)
    body_region: Optional[BodyRegionEnum] = None
    laterality: Optional[LateralityEnum] = None
    # New: Multiple pain reports
    pain_reports: Optional[List[PainReportItem]] = None
    session_notes: Optional[str] = None

class TrainingSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date_time_start: str
    session_type: SessionTypeEnum
    duration_min: int
    rpe: int
    pain_during: int
    pain_after: int
    end_fatigue: int
    # Legacy single pain support
    body_region: Optional[BodyRegionEnum] = None
    laterality: Optional[LateralityEnum] = None
    # New: Multiple pain reports
    pain_reports: Optional[List[dict]] = None
    session_notes: Optional[str] = None
    internal_load: int
    created_at: str

# Recovery Check (Evening Recovery)
class RecoveryCheckCreate(BaseModel):
    overall_feeling: int = Field(ge=0, le=10)
    recovery_quality: int = Field(ge=0, le=10)
    sleep_after: int = Field(ge=0, le=10)
    residual_pain: int = Field(ge=0, le=10)
    session_id: Optional[str] = None

class RecoveryCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date: str
    overall_feeling: int
    recovery_quality: int
    sleep_after: int
    residual_pain: int
    recovery_score: float
    session_id: Optional[str] = None
    created_at: str

# Alert
class Alert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    alert_type: AlertTypeEnum
    severity: AlertSeverityEnum
    message: str
    resolved: bool = False
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    created_at: str

# Notification
class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    title: str
    message: str
    notification_type: str
    read: bool = False
    created_at: str

# Export Models
class ExportFormatEnum(str, Enum):
    CSV = "csv"
    PDF = "pdf"

class ExportScopeEnum(str, Enum):
    INDIVIDUAL = "individual"
    TEAM = "team"

class ExportRequest(BaseModel):
    format: ExportFormatEnum
    scope: ExportScopeEnum
    athlete_id: Optional[str] = None  # Required if scope is individual
    team: Optional[str] = None  # "men", "women", or "all"
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None  # YYYY-MM-DD
    event_id: Optional[str] = None  # If exporting for specific event
    include_readiness: bool = True
    include_training: bool = True
    include_pain: bool = True
    include_recovery: bool = True
    include_compliance: bool = True

# CMJ (Counter Movement Jump) Models
class CMJContextEnum(str, Enum):
    PRE_TRAINING = "pre_training"
    POST_TRAINING = "post_training"
    PRE_COMPETITION = "pre_competition"
    POST_COMPETITION = "post_competition"
    RETEST = "retest"
    TESTING_SESSION = "testing_session"

class CMJBaseline(BaseModel):
    """Baseline CMJ assessment - official reference value"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date: str  # YYYY-MM-DD
    jump_height_cm: float  # Baseline jump height
    arms_used: bool  # Arms used: Yes/No
    footwear: Optional[str] = None  # "shoes" or "barefoot"
    notes: Optional[str] = None
    recorded_by: str  # Staff user ID
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: Optional[str] = None

class CMJTrials(BaseModel):
    """Three trials for a CMJ test session"""
    trial_1: float  # Jump height in cm
    trial_2: float
    trial_3: float

class CMJTest(BaseModel):
    """CMJ monitoring test session with 3 trials"""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date: str  # YYYY-MM-DD
    context: CMJContextEnum
    event_id: Optional[str] = None  # Link to event if applicable
    arms_used: bool
    trials: CMJTrials
    # Computed values (stored after calculation)
    cmj_best: float = 0  # Max of 3 trials
    cmj_mean: float = 0  # Average of 3 trials
    cv_percent: float = 0  # Within-session CV%
    delta_best_percent: Optional[float] = None  # vs baseline
    delta_mean_percent: Optional[float] = None  # vs baseline
    # Metadata
    time_of_day: Optional[str] = None
    notes: Optional[str] = None
    recorded_by: str  # Staff user ID
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CMJBaselineCreate(BaseModel):
    """Request model for creating/updating baseline"""
    date: str
    jump_height_cm: float
    arms_used: bool
    footwear: Optional[str] = None
    notes: Optional[str] = None

class CMJTestCreate(BaseModel):
    """Request model for creating a CMJ test"""
    date: str
    context: CMJContextEnum
    event_id: Optional[str] = None
    arms_used: bool
    trial_1: float
    trial_2: float
    trial_3: float
    time_of_day: Optional[str] = None
    notes: Optional[str] = None

class CMJBatchTestCreate(BaseModel):
    """Request model for batch CMJ testing (evaluation day)"""
    date: str
    context: CMJContextEnum
    event_id: Optional[str] = None
    arms_used: bool
    tests: List[dict]  # List of {athlete_id, trial_1, trial_2, trial_3}

# Helper functions
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, user_type: str) -> str:
    payload = {
        "user_id": user_id,
        "user_type": user_type,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        user_type = payload.get("user_type")
        
        if user_type == "athlete":
            user = await db.athletes.find_one({"id": user_id}, {"_id": 0})
        else:
            user = await db.staff_users.find_one({"id": user_id}, {"_id": 0})
        
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        
        return {"user": user, "user_type": user_type}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

# Auth routes
@api_router.post("/auth/register/athlete", response_model=dict)
async def register_athlete(data: AthleteCreate):
    existing = await db.athletes.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    
    athlete_dict = data.model_dump()
    password = athlete_dict.pop('password')
    athlete = Athlete(**athlete_dict)
    athlete.status = AthleteStatusEnum.PENDING  # New athletes are pending approval
    
    doc = athlete.model_dump()
    doc['password_hash'] = hash_password(password)
    
    await db.athletes.insert_one(doc)
    
    # Don't return token for pending athletes - they can't login yet
    return {
        "sucesso": True, 
        "message": "Registration submitted! Please wait for admin approval.",
        "status": "pending"
    }

@api_router.post("/auth/register/staff", response_model=dict)
async def register_staff(data: StaffUserCreate):
    # Prevent registration with Admin role
    if data.role == StaffRoleEnum.ADMIN:
        raise HTTPException(status_code=403, detail="Função Admin não pode ser registrada. Contate o administrador.")
    
    # Ensure team is provided for non-admin staff
    if not data.team:
        raise HTTPException(status_code=400, detail="Seleção de modalidade é obrigatória")
    
    existing = await db.staff_users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    
    staff_dict = data.model_dump()
    password = staff_dict.pop('password')
    staff = StaffUser(**staff_dict)
    
    doc = staff.model_dump()
    doc['password_hash'] = hash_password(password)
    
    await db.staff_users.insert_one(doc)
    
    token = create_token(staff.id, "staff")
    return {"token": token, "user_type": "staff", "user": staff.model_dump()}

@api_router.post("/auth/login", response_model=dict)
async def login(data: LoginRequest):
    # Check athletes first
    athlete = await db.athletes.find_one({"email": data.email}, {"_id": 0})
    if athlete and verify_password(data.password, athlete.get('password_hash', '')):
        # Check if athlete is approved
        status = athlete.get('status', 'approved')  # Default approved for legacy data
        if status == 'pending':
            raise HTTPException(status_code=403, detail="Sua conta está aguardando aprovação. Aguarde a confirmação do administrador.")
        if status == 'rejected':
            raise HTTPException(status_code=403, detail="Seu cadastro não foi aprovado. Entre em contato com o administrador.")
        
        user_data = {k: v for k, v in athlete.items() if k != 'password_hash'}
        token = create_token(athlete['id'], "athlete")
        return {"token": token, "user_type": "athlete", "user": user_data}
    
    # Check staff
    staff = await db.staff_users.find_one({"email": data.email}, {"_id": 0})
    if staff and verify_password(data.password, staff.get('password_hash', '')):
        user_data = {k: v for k, v in staff.items() if k != 'password_hash'}
        token = create_token(staff['id'], "staff")
        return {"token": token, "user_type": "staff", "user": user_data}
    
    raise HTTPException(status_code=401, detail="Credenciais inválidas")

@api_router.get("/auth/public-staff-roles")
async def get_public_staff_roles():
    """Get list of staff roles available for public registration"""
    return {"roles": PUBLIC_STAFF_ROLES, "teams": [e.value for e in TeamEnum]}

# Profile Photo Upload
@api_router.post("/upload/profile-photo")
async def upload_profile_photo(file: UploadFile = File(...)):
    """Upload a profile photo and return the URL"""
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Tipo de arquivo inválido. Apenas JPEG, PNG, GIF e WebP são permitidos.")
    
    # Validate file size (max 5MB)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo muito grande. Tamanho máximo: 5MB.")
    
    # Generate unique filename
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = UPLOAD_DIR / filename
    
    # Save file
    with open(filepath, "wb") as f:
        f.write(contents)
    
    # Return the URL path
    photo_url = f"/api/uploads/profiles/{filename}"
    return {"url": photo_url, "filename": filename}

@api_router.put("/profile/photo")
async def update_profile_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Update profile photo for authenticated user"""
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Tipo de arquivo inválido. Apenas JPEG, PNG, GIF e WebP são permitidos.")
    
    # Validate file size (max 5MB)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo muito grande. Tamanho máximo: 5MB.")
    
    # Generate unique filename
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = UPLOAD_DIR / filename
    
    # Save file
    with open(filepath, "wb") as f:
        f.write(contents)
    
    photo_url = f"/api/uploads/profiles/{filename}"
    
    # Update user's profile photo in database
    user_type = current_user['user_type']
    user_id = current_user['user']['id']
    
    if user_type == 'athlete':
        await db.athletes.update_one({"id": user_id}, {"$set": {"profile_photo": photo_url}})
    else:
        await db.staff_users.update_one({"id": user_id}, {"$set": {"profile_photo": photo_url}})
    
    return {"url": photo_url, "message": "Profile photo updated successfully"}

@api_router.get("/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    """Get current user's profile"""
    return current_user

@api_router.put("/profile")
async def update_profile(name: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Update current user's profile (name only for now)"""
    user_type = current_user['user_type']
    user_id = current_user['user']['id']
    
    update_data = {}
    if name:
        update_data["name"] = name
    
    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")
    
    if user_type == 'athlete':
        await db.athletes.update_one({"id": user_id}, {"$set": update_data})
    else:
        await db.staff_users.update_one({"id": user_id}, {"$set": update_data})
    
    return {"message": "Profile updated successfully"}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

# Morning Check-In routes
@api_router.post("/readiness", response_model=dict)
async def create_readiness(data: DailyReadinessCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem enviar check-in")
    
    athlete_id = current_user['user']['id']
    athlete_team = current_user['user'].get('team', '')
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Check if already submitted today
    existing = await db.daily_readiness.find_one({"athlete_id": athlete_id, "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Já enviado hoje")
    
    # Calculate scores
    fatigue_score_10 = 10 - data.morning_fatigue
    soreness_score_10 = 10 - data.muscle_soreness
    stress_score_10 = 10 - data.stress
    readiness_score = round((data.sleep_quality + fatigue_score_10 + soreness_score_10 + stress_score_10 + data.readiness) / 5, 2)
    
    readiness_data = {
        "athlete_id": athlete_id,
        "date": today,
        "sleep_quality": data.sleep_quality,
        "morning_fatigue": data.morning_fatigue,
        "muscle_soreness": data.muscle_soreness,
        "stress": data.stress,
        "readiness": data.readiness,
        "notes": data.notes,
        "fatigue_score_10": fatigue_score_10,
        "soreness_score_10": soreness_score_10,
        "stress_score_10": stress_score_10,
        "readiness_score": readiness_score,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "id": str(uuid.uuid4())
    }
    
    # Add menstrual data only for female team
    if 'Women' in athlete_team and data.is_menstruating is not None:
        readiness_data["is_menstruating"] = data.is_menstruating
        if data.is_menstruating:
            readiness_data["menstrual_flow"] = data.menstrual_flow.value if data.menstrual_flow else None
            readiness_data["menstrual_pain"] = data.menstrual_pain.value if data.menstrual_pain else None
            readiness_data["menstrual_symptoms"] = data.menstrual_symptoms or []
    
    await db.daily_readiness.insert_one(readiness_data)
    # Remove _id if MongoDB added it
    readiness_data.pop('_id', None)
    return readiness_data

@api_router.get("/readiness/history")
async def get_readiness_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem ver seu histórico")
    
    athlete_id = current_user['user']['id']
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    entries = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    
    # Calculate readiness variation compared to previous days
    for i, entry in enumerate(entries):
        if i < len(entries) - 1:
            prev_score = entries[i + 1].get('readiness_score', 0)
            if prev_score > 0:
                variation = round(((entry['readiness_score'] - prev_score) / prev_score) * 100, 1)
                entry['readiness_variation'] = variation
            else:
                entry['readiness_variation'] = 0
        else:
            entry['readiness_variation'] = 0
    
    return entries

# Training Session routes
@api_router.post("/sessions", response_model=dict)
async def create_session(data: TrainingSessionCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem registrar treinos")
    
    athlete_id = current_user['user']['id']
    internal_load = data.duration_min * data.rpe
    
    # Process pain reports - convert to list of dicts
    pain_reports_data = None
    if data.pain_reports:
        pain_reports_data = [
            {
                "body_region": pr.body_region.value,
                "laterality": pr.laterality.value if pr.laterality else None,
                "pain_level": pr.pain_level
            }
            for pr in data.pain_reports
        ]
    
    session = TrainingSession(
        athlete_id=athlete_id,
        date_time_start=data.date_time_start,
        session_type=data.session_type,
        duration_min=data.duration_min,
        rpe=data.rpe,
        pain_during=data.pain_during,
        pain_after=data.pain_after,
        end_fatigue=data.end_fatigue,
        body_region=data.body_region,
        laterality=data.laterality,
        pain_reports=pain_reports_data,
        session_notes=data.session_notes,
        internal_load=internal_load,
        created_at=datetime.now(timezone.utc).isoformat()
    )
    
    await db.training_sessions.insert_one(session.model_dump())
    return session.model_dump()

@api_router.get("/sessions/history")
async def get_sessions_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem ver seu histórico")
    
    athlete_id = current_user['user']['id']
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date_time_start", -1).to_list(100)
    
    return sessions

# Recovery Check routes
@api_router.post("/recovery", response_model=dict)
async def create_recovery(data: RecoveryCheckCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem registrar recuperação")
    
    athlete_id = current_user['user']['id']
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Calculate recovery score
    recovery_score = round((data.overall_feeling + data.recovery_quality + data.sleep_after + (10 - data.residual_pain)) / 4, 2)
    
    recovery = RecoveryCheck(
        athlete_id=athlete_id,
        date=today,
        overall_feeling=data.overall_feeling,
        recovery_quality=data.recovery_quality,
        sleep_after=data.sleep_after,
        residual_pain=data.residual_pain,
        recovery_score=recovery_score,
        session_id=data.session_id,
        created_at=datetime.now(timezone.utc).isoformat()
    )
    
    await db.recovery_checks.insert_one(recovery.model_dump())
    return recovery.model_dump()

@api_router.get("/recovery/history")
async def get_recovery_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem ver seu histórico")
    
    athlete_id = current_user['user']['id']
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    entries = await db.recovery_checks.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    
    return entries

# Athlete history summary
@api_router.get("/athlete/summary")
async def get_athlete_summary(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas podem ver seu resumo")
    
    athlete_id = current_user['user']['id']
    start_date_7 = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    
    # Get last 7 days readiness
    readiness_entries = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date_7}},
        {"_id": 0}
    ).to_list(100)
    
    avg_readiness = 0
    if readiness_entries:
        avg_readiness = round(sum(e['readiness_score'] for e in readiness_entries) / len(readiness_entries), 2)
    
    # Get last 7 days sessions
    start_date_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date_iso}},
        {"_id": 0}
    ).to_list(100)
    
    total_load = sum(s['internal_load'] for s in sessions)
    
    return {
        "last_7_days_avg_readiness": avg_readiness,
        "last_7_days_total_load": total_load,
        "readiness_entries_count": len(readiness_entries),
        "sessions_count": len(sessions)
    }

# Notifications
@api_router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas têm notificações")
    
    athlete_id = current_user['user']['id']
    notifications = await db.notifications.find(
        {"athlete_id": athlete_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    return notifications

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Apenas atletas têm notificações")
    
    result = await db.notifications.update_one(
        {"id": notification_id, "athlete_id": current_user['user']['id']},
        {"$set": {"read": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    
    return {"sucesso": True}

# Staff routes
@api_router.get("/staff/athletes")
async def get_all_athletes(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    query = {"active": True, "status": {"$in": ["approved", None]}}  # Include legacy athletes without status
    if team:
        query["team"] = team
    
    athletes = await db.athletes.find(query, {"_id": 0, "password_hash": 0}).to_list(100)
    return athletes

# Admin routes for user management
@api_router.get("/admin/pending-athletes")
async def get_pending_athletes(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    pending = await db.athletes.find(
        {"status": "pending"},
        {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).to_list(100)
    
    return pending

@api_router.get("/admin/all-athletes")
async def get_all_athletes_admin(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    query = {}
    if status:
        query["status"] = status
    
    athletes = await db.athletes.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(100)
    return athletes

@api_router.put("/admin/athlete/{athlete_id}/approve")
async def approve_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    result = await db.athletes.update_one(
        {"id": athlete_id},
        {"$set": {"status": "approved", "active": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    return {"sucesso": True, "message": "Atleta aprovado"}

@api_router.put("/admin/athlete/{athlete_id}/reject")
async def reject_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    result = await db.athletes.update_one(
        {"id": athlete_id},
        {"$set": {"status": "rejected", "active": False}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    return {"sucesso": True, "message": "Atleta rejeitado"}

@api_router.delete("/admin/athlete/{athlete_id}")
async def delete_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    result = await db.athletes.delete_one({"id": athlete_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    return {"sucesso": True, "message": "Atleta excluído"}

@api_router.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador")
    
    pending_count = await db.athletes.count_documents({"status": "pending"})
    approved_count = await db.athletes.count_documents({"status": {"$in": ["approved", None]}})
    rejected_count = await db.athletes.count_documents({"status": "rejected"})
    staff_count = await db.staff_users.count_documents({})
    
    return {
        "pending_athletes": pending_count,
        "approved_athletes": approved_count,
        "rejected_athletes": rejected_count,
        "total_staff": staff_count
    }

# ====== Event Management (Analysis Context) ======

@api_router.get("/staff/events")
async def get_events(team: Optional[str] = None, include_past: bool = False, current_user: dict = Depends(get_current_user)):
    """Get all events for analysis context
    
    Event visibility rules:
    - When team="men": Show events with team="men" OR team=None (all athletes)
    - When team="women": Show events with team="women" OR team=None (all athletes)
    - When team=None or "all": Show all events
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    query = {}
    
    # Build team filter - include team-specific AND all-athletes events
    if team and team != "all":
        # Map short team name to full enum value
        team_value = TeamEnum.MEN.value if team == "men" else TeamEnum.WOMEN.value
        # Show events for the specific team OR events for all athletes (team=None)
        query["$or"] = [
            {"team": team_value},
            {"team": None},
            {"team": {"$exists": False}}  # Handle legacy events without team field
        ]
    # If team is None or "all", show all events (no team filter)
    
    if not include_past:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if "$or" in query:
            # Wrap existing query with date filter
            query = {"$and": [{"$or": query["$or"]}, {"end_date": {"$gte": today}}]}
        else:
            query["end_date"] = {"$gte": today}
    
    events = await db.events.find(query, {"_id": 0}).sort("start_date", -1).to_list(100)
    return events

@api_router.get("/staff/events/{event_id}")
async def get_event(event_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific event"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    
    return event

@api_router.post("/staff/events")
async def create_event(event_data: EventCreate, current_user: dict = Depends(get_current_user)):
    """Create a new event for analysis context"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Validate dates
    try:
        start = datetime.strptime(event_data.start_date, "%Y-%m-%d")
        end = datetime.strptime(event_data.end_date, "%Y-%m-%d")
        if end < start:
            raise HTTPException(status_code=400, detail="Data final deve ser após data inicial")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use AAAA-MM-DD")
    
    event = Event(
        name=event_data.name,
        event_type=event_data.event_type,
        start_date=event_data.start_date,
        end_date=event_data.end_date,
        team=event_data.team,
        description=event_data.description,
        created_by=current_user['user']['id']
    )
    
    await db.events.insert_one(event.model_dump())
    return {"message": "Evento criado com sucesso", "event": event.model_dump()}

@api_router.put("/staff/events/{event_id}")
async def update_event(event_id: str, event_data: EventCreate, current_user: dict = Depends(get_current_user)):
    """Update an existing event"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    existing = await db.events.find_one({"id": event_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    
    # Validate dates
    try:
        start = datetime.strptime(event_data.start_date, "%Y-%m-%d")
        end = datetime.strptime(event_data.end_date, "%Y-%m-%d")
        if end < start:
            raise HTTPException(status_code=400, detail="Data final deve ser após data inicial")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use AAAA-MM-DD")
    
    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "name": event_data.name,
            "event_type": event_data.event_type,
            "start_date": event_data.start_date,
            "end_date": event_data.end_date,
            "team": event_data.team,
            "description": event_data.description
        }}
    )
    
    return {"message": "Evento atualizado com sucesso"}

@api_router.delete("/staff/events/{event_id}")
async def delete_event(event_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an event"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    result = await db.events.delete_one({"id": event_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    
    return {"message": "Evento excluído com sucesso"}

@api_router.get("/staff/events/{event_id}/dashboard")
async def get_event_dashboard(event_id: str, day: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    """
    Get event-specific dashboard data focused on daily snapshots.
    day parameter: 1 = Day 1 of event, 2 = Day 2, etc. If None, returns latest day.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    
    # Calculate target date based on day number
    start_date = datetime.strptime(event['start_date'], "%Y-%m-%d")
    end_date = datetime.strptime(event['end_date'], "%Y-%m-%d")
    today = datetime.now(timezone.utc).date()
    
    # Calculate total days in event
    total_days = (end_date - start_date).days + 1
    
    # Determine which day to show
    if day is not None and 1 <= day <= total_days:
        target_date = start_date + timedelta(days=day - 1)
    else:
        # Show today if within event, otherwise latest event day
        if start_date.date() <= today <= end_date.date():
            target_date = datetime.combine(today, datetime.min.time())
        else:
            target_date = min(end_date, datetime.combine(today, datetime.min.time()))
    
    target_date_str = target_date.strftime("%Y-%m-%d")
    current_day_num = (target_date - start_date).days + 1
    
    # Get athletes for the event team
    athlete_query = {"status": "approved"}
    if event.get('team'):
        athlete_query["team"] = event['team']
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    # Get pre-event baseline (2 weeks before event start)
    baseline_start = (start_date - timedelta(days=14)).strftime("%Y-%m-%d")
    baseline_end = (start_date - timedelta(days=1)).strftime("%Y-%m-%d")
    
    baseline_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": baseline_start, "$lte": baseline_end}},
        {"_id": 0}
    ).to_list(500)
    
    # Calculate baseline averages per athlete
    athlete_baselines = {}
    for athlete_id in athlete_ids:
        athlete_baseline_data = [r for r in baseline_readiness if r['athlete_id'] == athlete_id]
        if athlete_baseline_data:
            athlete_baselines[athlete_id] = {
                "avg_readiness": sum(r.get('readiness', r.get('readiness_score', 5)) for r in athlete_baseline_data) / len(athlete_baseline_data),
                "avg_sleep": sum(r['sleep_quality'] for r in athlete_baseline_data) / len(athlete_baseline_data),
                "avg_fatigue": sum(r['morning_fatigue'] for r in athlete_baseline_data) / len(athlete_baseline_data),
                "data_points": len(athlete_baseline_data)
            }
    
    # Get daily readiness for target date
    daily_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": target_date_str},
        {"_id": 0}
    ).to_list(100)
    
    # Get training sessions for target date
    day_start = f"{target_date_str}T00:00:00"
    day_end = f"{target_date_str}T23:59:59"
    
    daily_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": day_start, "$lte": day_end}},
        {"_id": 0}
    ).to_list(200)
    
    # Calculate cumulative load during event
    event_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": f"{event['start_date']}T00:00:00", "$lte": day_end}},
        {"_id": 0}
    ).to_list(500)
    
    cumulative_load = {}
    daily_load = {}
    for session in event_sessions:
        aid = session['athlete_id']
        load = session.get('internal_load', 0)
        cumulative_load[aid] = cumulative_load.get(aid, 0) + load
        if session['date_time_start'][:10] == target_date_str:
            daily_load[aid] = daily_load.get(aid, 0) + load
    
    # Build athlete summaries with baseline comparison
    athlete_summaries = []
    for athlete_id in athlete_ids:
        readiness_entry = next((r for r in daily_readiness if r['athlete_id'] == athlete_id), None)
        baseline = athlete_baselines.get(athlete_id, {})
        
        summary = {
            "athlete_id": athlete_id,
            "name": athlete_names[athlete_id],
            "has_checkin": readiness_entry is not None,
            "daily_load": daily_load.get(athlete_id, 0),
            "cumulative_event_load": cumulative_load.get(athlete_id, 0)
        }
        
        if readiness_entry:
            current_readiness = readiness_entry.get('readiness', readiness_entry.get('readiness_score', 5))
            summary["readiness"] = current_readiness
            summary["sleep"] = readiness_entry['sleep_quality']
            summary["fatigue"] = readiness_entry['morning_fatigue']
            
            # Compare to baseline
            if baseline:
                summary["vs_baseline_readiness"] = round(current_readiness - baseline['avg_readiness'], 1)
                summary["vs_baseline_sleep"] = round(readiness_entry['sleep_quality'] - baseline['avg_sleep'], 1)
        
        athlete_summaries.append(summary)
    
    # Daily pain summary
    pain_locations = {}
    for session in daily_sessions:
        if session.get('pain_after', 0) > 0 and session.get('body_region'):
            region = session['body_region']
            if region not in pain_locations:
                pain_locations[region] = {"count": 0, "athletes": set()}
            pain_locations[region]["count"] += 1
            pain_locations[region]["athletes"].add(athlete_names.get(session['athlete_id'], 'Unknown'))
    
    pain_summary = [{"region": k, "count": v["count"], "athletes": list(v["athletes"])} for k, v in pain_locations.items()]
    pain_summary.sort(key=lambda x: x["count"], reverse=True)
    
    return {
        "event": event,
        "target_date": target_date_str,
        "current_day": current_day_num,
        "total_days": total_days,
        "athletes_checked_in": len(daily_readiness),
        "total_athletes": len(athletes),
        "team_avg_readiness": round(sum(r.get('readiness', r.get('readiness_score', 5)) for r in daily_readiness) / len(daily_readiness), 1) if daily_readiness else None,
        "team_daily_load": sum(daily_load.values()),
        "team_cumulative_load": sum(cumulative_load.values()),
        "athlete_summaries": athlete_summaries,
        "pain_summary": pain_summary,
        "available_days": list(range(1, total_days + 1))
    }

@api_router.get("/staff/athlete/{athlete_id}")
async def get_athlete_detail(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "password_hash": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    return athlete

@api_router.get("/staff/athlete/{athlete_id}/readiness")
async def get_athlete_readiness(athlete_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    entries = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", 1).to_list(100)
    
    # Add readiness variation
    for i, entry in enumerate(entries):
        if i > 0:
            prev_score = entries[i - 1].get('readiness_score', 0)
            if prev_score > 0:
                variation = round(((entry['readiness_score'] - prev_score) / prev_score) * 100, 1)
                entry['readiness_variation'] = variation
            else:
                entry['readiness_variation'] = 0
        else:
            entry['readiness_variation'] = 0
    
    return entries

@api_router.get("/staff/athlete/{athlete_id}/readiness-with-team-avg")
async def get_athlete_readiness_with_team_avg(athlete_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Get athlete readiness data with team average for comparison"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Get athlete info to determine team
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    team = athlete.get('team')
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    # Get all team athletes
    team_athletes = await db.athletes.find(
        {"team": team, "status": {"$in": ["approved", None]}, "active": True},
        {"_id": 0, "id": 1}
    ).to_list(100)
    team_ids = [a['id'] for a in team_athletes]
    
    # Get athlete's readiness
    athlete_entries = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", 1).to_list(100)
    
    # Get all team readiness for averages
    team_entries = await db.daily_readiness.find(
        {"athlete_id": {"$in": team_ids}, "date": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(1000)
    
    # Calculate daily team averages
    team_avg_by_date = {}
    for entry in team_entries:
        date = entry['date']
        if date not in team_avg_by_date:
            team_avg_by_date[date] = []
        team_avg_by_date[date].append(entry['readiness_score'])
    
    # Build comparison data
    comparison_data = []
    for entry in athlete_entries:
        date = entry['date']
        team_scores = team_avg_by_date.get(date, [])
        team_avg = round(sum(team_scores) / len(team_scores), 2) if team_scores else None
        
        comparison_data.append({
            "date": date,
            "athlete_score": entry['readiness_score'],
            "team_average": team_avg,
            "sleep_quality": entry['sleep_quality'],
            "morning_fatigue": entry['morning_fatigue'],
            "muscle_soreness": entry['muscle_soreness'],
            "stress": entry['stress']
        })
    
    return {
        "athlete_name": athlete.get('name'),
        "team": team,
        "data": comparison_data
    }

@api_router.get("/staff/athlete/{athlete_id}/pain-report")
async def get_athlete_pain_report(athlete_id: str, days: int = 90, current_user: dict = Depends(get_current_user)):
    """Detailed pain report for an athlete"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date_time_start", 1).to_list(500)
    
    # Analyze pain data
    pain_by_region = {}
    pain_intensity_history = []
    high_pain_sessions = []
    consecutive_pain = {}  # Track consecutive days with pain by region
    
    for s in sessions:
        pain_after = s.get('pain_after', 0)
        region = s.get('body_region') or 'Unspecified'
        date = s['date_time_start'][:10]
        
        pain_intensity_history.append({
            "date": date,
            "pain_after": pain_after,
            "pain_during": s.get('pain_during', 0),
            "region": region,
            "session_type": s.get('session_type')
        })
        
        if pain_after > 0:
            if region not in pain_by_region:
                pain_by_region[region] = {"count": 0, "total_intensity": 0, "high_pain_count": 0}
            pain_by_region[region]["count"] += 1
            pain_by_region[region]["total_intensity"] += pain_after
            if pain_after >= 5:
                pain_by_region[region]["high_pain_count"] += 1
                high_pain_sessions.append({
                    "date": date,
                    "intensity": pain_after,
                    "region": region,
                    "session_type": s.get('session_type')
                })
    
    # Calculate averages and identify most affected region
    region_analysis = []
    most_affected = None
    max_count = 0
    
    for region, data in pain_by_region.items():
        avg_intensity = round(data["total_intensity"] / data["count"], 1) if data["count"] > 0 else 0
        region_analysis.append({
            "region": region,
            "frequency": data["count"],
            "avg_intensity": avg_intensity,
            "high_pain_count": data["high_pain_count"]
        })
        if data["count"] > max_count:
            max_count = data["count"]
            most_affected = region
    
    # Check for persistent pain (same region for 3+ consecutive days)
    persistent_pain_alerts = []
    sorted_sessions = sorted(sessions, key=lambda x: x['date_time_start'])
    region_streak = {}
    
    for s in sorted_sessions:
        region = s.get('body_region') or 'Unspecified'
        pain = s.get('pain_after', 0)
        date = s['date_time_start'][:10]
        
        if pain >= 5:
            if region not in region_streak:
                region_streak[region] = {"count": 1, "start_date": date, "dates": [date]}
            else:
                last_date = region_streak[region]["dates"][-1]
                # Check if consecutive (within 2 days)
                last_dt = datetime.fromisoformat(last_date)
                curr_dt = datetime.fromisoformat(date)
                if (curr_dt - last_dt).days <= 2:
                    region_streak[region]["count"] += 1
                    region_streak[region]["dates"].append(date)
                    if region_streak[region]["count"] >= 3:
                        persistent_pain_alerts.append({
                            "region": region,
                            "consecutive_days": region_streak[region]["count"],
                            "start_date": region_streak[region]["start_date"],
                            "dates": region_streak[region]["dates"]
                        })
                else:
                    region_streak[region] = {"count": 1, "start_date": date, "dates": [date]}
        else:
            if region in region_streak:
                del region_streak[region]
    
    return {
        "total_sessions": len(sessions),
        "sessions_with_pain": sum(1 for s in sessions if s.get('pain_after', 0) > 0),
        "high_pain_sessions_count": len(high_pain_sessions),
        "most_affected_region": most_affected,
        "region_analysis": sorted(region_analysis, key=lambda x: -x["frequency"]),
        "pain_history": pain_intensity_history[-30:],  # Last 30 entries
        "high_pain_sessions": high_pain_sessions[-10:],  # Last 10 high pain sessions
        "persistent_pain_alerts": persistent_pain_alerts
    }

@api_router.get("/staff/athlete/{athlete_id}/acwr-gabbett")
async def get_athlete_acwr_gabbett(athlete_id: str, current_user: dict = Depends(get_current_user)):
    """ACWR calculation using Gabbett (2016) framework"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    now = datetime.now(timezone.utc)
    start_5_weeks = (now - timedelta(days=35)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_5_weeks}},
        {"_id": 0}
    ).to_list(200)
    
    # Calculate weekly loads for last 5 weeks
    weekly_loads = {}
    for s in sessions:
        date_str = s['date_time_start']
        # Handle both ISO format with and without timezone
        if 'Z' in date_str:
            date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        elif '+' in date_str or date_str.endswith('00'):
            date = datetime.fromisoformat(date_str)
        else:
            date = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        week_num = (now - date).days // 7
        if week_num not in weekly_loads:
            weekly_loads[week_num] = 0
        weekly_loads[week_num] += s['internal_load']
    
    # Acute load = current week (week 0)
    acute_load = weekly_loads.get(0, 0)
    
    # Chronic load = rolling average of previous 4 weeks (weeks 1-4)
    chronic_weeks = [weekly_loads.get(i, 0) for i in range(1, 5)]
    chronic_load = sum(chronic_weeks) / 4 if chronic_weeks else 0
    
    # ACWR calculation
    acwr = round(acute_load / chronic_load, 2) if chronic_load > 0 else 0
    
    # Risk zone classification (Gabbett 2016)
    if acwr < 0.8:
        risk_zone = "UNDERTRAINING"
        risk_color = "blue"
        risk_description = "Training load may be insufficient for adaptation"
    elif 0.8 <= acwr <= 1.3:
        risk_zone = "SWEET SPOT"
        risk_color = "green"
        risk_description = "Optimal training zone - good balance of load and recovery"
    elif 1.3 < acwr <= 1.5:
        risk_zone = "CAUTION"
        risk_color = "yellow"
        risk_description = "Increased injury risk - monitor closely"
    else:
        risk_zone = "DANGER"
        risk_color = "red"
        risk_description = "High injury risk - consider reducing load"
    
    # Weekly load trend
    weekly_trend = []
    for i in range(4, -1, -1):
        week_label = f"Week -{i}" if i > 0 else "Current"
        weekly_trend.append({
            "week": week_label,
            "load": weekly_loads.get(i, 0)
        })
    
    return {
        "acute_load": acute_load,
        "chronic_load": round(chronic_load, 0),
        "acwr": acwr,
        "risk_zone": risk_zone,
        "risk_color": risk_color,
        "risk_description": risk_description,
        "weekly_trend": weekly_trend,
        "week_loads": {
            "week_0": weekly_loads.get(0, 0),
            "week_1": weekly_loads.get(1, 0),
            "week_2": weekly_loads.get(2, 0),
            "week_3": weekly_loads.get(3, 0),
            "week_4": weekly_loads.get(4, 0)
        }
    }

@api_router.get("/staff/athlete/{athlete_id}/compliance")
async def get_athlete_compliance(athlete_id: str, current_user: dict = Depends(get_current_user)):
    """Detailed compliance metrics for an athlete"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    now = datetime.now(timezone.utc)
    
    # Daily compliance (last 7 days)
    start_7 = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    readiness_7 = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_7}},
        {"_id": 0, "date": 1}
    ).to_list(100)
    daily_compliance = round((len(readiness_7) / 7) * 100, 1)
    
    # Weekly compliance (last 4 weeks)
    start_28 = (now - timedelta(days=28)).strftime("%Y-%m-%d")
    readiness_28 = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_28}},
        {"_id": 0, "date": 1}
    ).to_list(100)
    weekly_compliance = round((len(readiness_28) / 28) * 100, 1)
    
    # Monthly compliance (last 90 days)
    start_90 = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    readiness_90 = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_90}},
        {"_id": 0, "date": 1}
    ).to_list(100)
    monthly_compliance = round((len(readiness_90) / 90) * 100, 1)
    
    # Build daily check-in calendar for last 14 days
    checkin_dates = set(r['date'] for r in readiness_28)
    calendar = []
    for i in range(14):
        date = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        calendar.append({
            "date": date,
            "checked_in": date in checkin_dates
        })
    
    return {
        "daily_compliance": daily_compliance,
        "daily_expected": 7,
        "daily_completed": len(readiness_7),
        "weekly_compliance": weekly_compliance,
        "weekly_expected": 28,
        "weekly_completed": len(readiness_28),
        "monthly_compliance": monthly_compliance,
        "monthly_expected": 90,
        "monthly_completed": len(readiness_90),
        "calendar": calendar[::-1]  # Chronological order
    }

@api_router.get("/staff/team-pain-analysis")
async def get_team_pain_analysis(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Team-wide pain analysis for long-term view"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"status": {"$in": ["approved", None]}, "active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    
    # Aggregate pain by body region (sessions with pain >= 3)
    pain_by_region = {}
    pain_by_athlete = {}
    
    for s in sessions:
        pain = s.get('pain_after', 0)
        if pain >= 3:
            region = s.get('body_region') or 'Unspecified'
            athlete_name = athlete_names.get(s['athlete_id'], 'Unknown')
            
            if region not in pain_by_region:
                pain_by_region[region] = {"count": 0, "total_intensity": 0, "athletes": set()}
            pain_by_region[region]["count"] += 1
            pain_by_region[region]["total_intensity"] += pain
            pain_by_region[region]["athletes"].add(athlete_name)
            
            if athlete_name not in pain_by_athlete:
                pain_by_athlete[athlete_name] = {"count": 0, "high_pain": 0}
            pain_by_athlete[athlete_name]["count"] += 1
            if pain >= 5:
                pain_by_athlete[athlete_name]["high_pain"] += 1
    
    # Format pain distribution
    pain_distribution = []
    for region, data in pain_by_region.items():
        pain_distribution.append({
            "region": region,
            "count": data["count"],
            "avg_intensity": round(data["total_intensity"] / data["count"], 1) if data["count"] > 0 else 0,
            "athletes_affected": len(data["athletes"])
        })
    
    # Sort by count descending
    pain_distribution = sorted(pain_distribution, key=lambda x: -x["count"])
    most_affected_region = pain_distribution[0] if pain_distribution else None
    
    # Athletes with most pain
    athletes_pain_ranking = [
        {"name": name, "pain_sessions": data["count"], "high_pain": data["high_pain"]}
        for name, data in sorted(pain_by_athlete.items(), key=lambda x: -x[1]["count"])
    ]
    
    return {
        "pain_distribution": pain_distribution,
        "most_affected_region": most_affected_region,
        "athletes_pain_ranking": athletes_pain_ranking[:10],
        "total_pain_sessions": sum(d["count"] for d in pain_distribution)
    }

@api_router.get("/staff/athlete/{athlete_id}/sessions")
async def get_athlete_sessions(athlete_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date_time_start", 1).to_list(200)
    
    return sessions

@api_router.get("/staff/athlete/{athlete_id}/workload")
async def get_athlete_workload(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    now = datetime.now(timezone.utc)
    start_28 = (now - timedelta(days=28)).isoformat()
    start_7 = (now - timedelta(days=7)).isoformat()
    
    # Get all sessions for 28 days
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_28}},
        {"_id": 0}
    ).to_list(200)
    
    # Calculate loads
    sessions_7 = [s for s in sessions if s['date_time_start'] >= start_7]
    
    acute_load_7 = sum(s['internal_load'] for s in sessions_7)
    chronic_load_28 = sum(s['internal_load'] for s in sessions)
    
    # ACWR calculation
    acwr = 0
    if chronic_load_28 > 0:
        acwr = round(acute_load_7 / (chronic_load_28 / 4), 2) if chronic_load_28 > 0 else 0
    
    # Weekly Monotony and Strain
    # Group by day for last 7 days
    daily_loads = {}
    for s in sessions_7:
        day = s['date_time_start'][:10]
        daily_loads[day] = daily_loads.get(day, 0) + s['internal_load']
    
    loads_list = list(daily_loads.values())
    weekly_monotony = None
    weekly_strain = None
    
    if len(loads_list) > 1:
        mean_load = np.mean(loads_list)
        std_load = np.std(loads_list)
        if std_load > 0:
            weekly_monotony = round(mean_load / std_load, 2)
            weekly_strain = round(acute_load_7 * weekly_monotony, 2)
    
    return {
        "acute_load_7": acute_load_7,
        "chronic_load_28": chronic_load_28,
        "acwr": acwr,
        "weekly_monotony": weekly_monotony,
        "weekly_strain": weekly_strain
    }

# Dashboard stats
@api_router.get("/staff/dashboard/stats")
async def get_dashboard_stats(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_7 = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    
    # Count missing check-ins today
    today_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": today},
        {"_id": 0, "athlete_id": 1}
    ).to_list(100)
    checked_in_ids = [r['athlete_id'] for r in today_readiness]
    missing_check_ins = len(athlete_ids) - len(checked_in_ids)
    
    # Get last 7 days readiness for avg
    readiness_7 = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_7}},
        {"_id": 0}
    ).to_list(500)
    
    avg_readiness = 0
    if readiness_7:
        avg_readiness = round(sum(r['readiness_score'] for r in readiness_7) / len(readiness_7), 2)
    
    # Get total load last 7 days
    start_7_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    sessions_7 = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_7_iso}},
        {"_id": 0}
    ).to_list(500)
    
    total_load_7 = sum(s['internal_load'] for s in sessions_7)
    
    # Calculate average load per athlete (only for athletes with sessions)
    athletes_with_sessions = len(set(s['athlete_id'] for s in sessions_7))
    avg_load_per_athlete = round(total_load_7 / athletes_with_sessions, 0) if athletes_with_sessions > 0 else 0
    
    # Active alerts
    active_alerts = await db.alerts.count_documents(
        {"athlete_id": {"$in": athlete_ids}, "resolved": False}
    )
    
    return {
        "total_athletes": len(athletes),
        "missing_check_ins": missing_check_ins,
        "avg_readiness_7_days": avg_readiness,
        "team_total_load_7_days": total_load_7,
        "avg_load_per_athlete_7_days": avg_load_per_athlete,
        "athletes_with_sessions": athletes_with_sessions,
        "active_alerts": active_alerts
    }

# Menstrual Cycle Stats (Female Team Only)
@api_router.get("/staff/dashboard/menstrual-stats")
async def get_menstrual_stats(team: Optional[str] = None, days: int = 7, current_user: dict = Depends(get_current_user)):
    """Get menstrual cycle statistics for female athletes"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Only include female team athletes
    athlete_query = {"active": True, "team": "Brazil Lacrosse Women"}
    if team and team != "Brazil Lacrosse Women":
        # If filtering by men's team, return empty stats
        return {
            "athletes_on_period_today": 0,
            "total_female_athletes": 0,
            "period_rate": 0,
            "high_pain_alerts": [],
            "weekly_period_count": [],
            "severe_symptoms_today": []
        }
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    # Get today's readiness data with menstrual info
    today_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": today, "is_menstruating": True},
        {"_id": 0}
    ).to_list(100)
    
    athletes_on_period_today = len(today_readiness)
    
    # Get severe menstrual pain cases today
    severe_symptoms_today = []
    high_pain_alerts = []
    
    for r in today_readiness:
        athlete_name = athlete_names.get(r['athlete_id'], 'Unknown')
        menstrual_pain = r.get('menstrual_pain', 'None')
        
        if menstrual_pain in ['Severe', 'Very Severe']:
            severe_symptoms_today.append({
                "athlete_id": r['athlete_id'],
                "athlete_name": athlete_name,
                "menstrual_pain": menstrual_pain,
                "flow": r.get('menstrual_flow', 'Unknown'),
                "symptoms": r.get('menstrual_symptoms', []),
                "general_soreness": r.get('muscle_soreness', 0)
            })
            
            # Create alert for severe menstrual pain
            high_pain_alerts.append({
                "athlete_id": r['athlete_id'],
                "athlete_name": athlete_name,
                "alert_type": "SEVERE_MENSTRUAL_PAIN",
                "severity": "Red" if menstrual_pain == 'Very Severe' else "Yellow",
                "message": f"Severe menstrual pain reported: {menstrual_pain}",
                "date": today
            })
        
        # Check for combined high pain (menstrual + general)
        general_soreness = r.get('muscle_soreness', 0)
        if menstrual_pain in ['Moderate', 'Severe', 'Very Severe'] and general_soreness > 5:
            high_pain_alerts.append({
                "athlete_id": r['athlete_id'],
                "athlete_name": athlete_name,
                "alert_type": "COMBINED_HIGH_PAIN",
                "severity": "Red",
                "message": f"High menstrual pain ({menstrual_pain}) combined with high general soreness ({general_soreness}/10)",
                "date": today
            })
    
    # Get weekly period count by day
    weekly_data = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_date}, "is_menstruating": True},
        {"_id": 0, "date": 1, "athlete_id": 1}
    ).to_list(500)
    
    period_by_date = {}
    for r in weekly_data:
        date = r['date']
        if date not in period_by_date:
            period_by_date[date] = set()
        period_by_date[date].add(r['athlete_id'])
    
    weekly_period_count = []
    for i in range(days):
        date = (datetime.now(timezone.utc) - timedelta(days=days-1-i)).strftime("%Y-%m-%d")
        count = len(period_by_date.get(date, set()))
        weekly_period_count.append({"date": date, "count": count})
    
    return {
        "athletes_on_period_today": athletes_on_period_today,
        "total_female_athletes": len(athletes),
        "period_rate": round(athletes_on_period_today / len(athletes) * 100, 1) if athletes else 0,
        "high_pain_alerts": high_pain_alerts,
        "weekly_period_count": weekly_period_count,
        "severe_symptoms_today": severe_symptoms_today
    }

# Enhanced Pain Analytics by Body Region
@api_router.get("/staff/dashboard/pain-analytics")
async def get_pain_analytics(team: Optional[str] = None, days: int = 90, current_user: dict = Depends(get_current_user)):
    """Comprehensive pain analytics by body region for long-term analysis"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Get all training sessions with pain data
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    
    # Aggregate pain by body region
    region_stats = {}
    athlete_region_stats = {}  # For individual athlete breakdown
    total_sessions = len(sessions)
    sessions_with_pain = 0
    
    for s in sessions:
        pain_after = s.get('pain_after', 0)
        region = s.get('body_region') or 'Unspecified'
        athlete_id = s['athlete_id']
        athlete_name = athlete_names.get(athlete_id, 'Unknown')
        
        if pain_after > 0:
            sessions_with_pain += 1
            
            # Team-level stats
            if region not in region_stats:
                region_stats[region] = {
                    "region": region,
                    "total_reports": 0,
                    "total_intensity": 0,
                    "high_pain_count": 0,  # pain >= 5
                    "severe_pain_count": 0,  # pain >= 7
                    "affected_athletes": set()
                }
            
            region_stats[region]["total_reports"] += 1
            region_stats[region]["total_intensity"] += pain_after
            region_stats[region]["affected_athletes"].add(athlete_id)
            
            if pain_after >= 5:
                region_stats[region]["high_pain_count"] += 1
            if pain_after >= 7:
                region_stats[region]["severe_pain_count"] += 1
            
            # Individual athlete stats
            if athlete_id not in athlete_region_stats:
                athlete_region_stats[athlete_id] = {"name": athlete_name, "regions": {}}
            
            if region not in athlete_region_stats[athlete_id]["regions"]:
                athlete_region_stats[athlete_id]["regions"][region] = {"count": 0, "total_intensity": 0}
            
            athlete_region_stats[athlete_id]["regions"][region]["count"] += 1
            athlete_region_stats[athlete_id]["regions"][region]["total_intensity"] += pain_after
    
    # Calculate averages and format results
    region_ranking = []
    for region, stats in region_stats.items():
        avg_intensity = round(stats["total_intensity"] / stats["total_reports"], 1) if stats["total_reports"] > 0 else 0
        region_ranking.append({
            "region": region,
            "total_reports": stats["total_reports"],
            "avg_intensity": avg_intensity,
            "high_pain_count": stats["high_pain_count"],
            "severe_pain_count": stats["severe_pain_count"],
            "affected_athletes_count": len(stats["affected_athletes"]),
            "risk_score": round(stats["total_reports"] * avg_intensity * (1 + stats["severe_pain_count"] / max(stats["total_reports"], 1)), 1)
        })
    
    # Sort by risk score (frequency * intensity * severity factor)
    region_ranking.sort(key=lambda x: x["risk_score"], reverse=True)
    
    # Identify most affected region
    most_affected_region = region_ranking[0] if region_ranking else None
    
    # Get top affected athletes per region
    athlete_breakdown = []
    for athlete_id, data in athlete_region_stats.items():
        most_affected = max(data["regions"].items(), key=lambda x: x[1]["count"]) if data["regions"] else None
        if most_affected:
            athlete_breakdown.append({
                "athlete_id": athlete_id,
                "athlete_name": data["name"],
                "most_affected_region": most_affected[0],
                "pain_count": most_affected[1]["count"],
                "avg_intensity": round(most_affected[1]["total_intensity"] / most_affected[1]["count"], 1)
            })
    
    athlete_breakdown.sort(key=lambda x: x["pain_count"], reverse=True)
    
    # Heatmap data: region x intensity distribution
    heatmap_data = []
    for region, stats in region_stats.items():
        heatmap_data.append({
            "region": region,
            "frequency": stats["total_reports"],
            "intensity": round(stats["total_intensity"] / stats["total_reports"], 1) if stats["total_reports"] > 0 else 0,
            "severity_ratio": round(stats["severe_pain_count"] / stats["total_reports"] * 100, 1) if stats["total_reports"] > 0 else 0
        })
    
    return {
        "total_sessions": total_sessions,
        "sessions_with_pain": sessions_with_pain,
        "pain_rate": round(sessions_with_pain / total_sessions * 100, 1) if total_sessions > 0 else 0,
        "region_ranking": region_ranking[:10],  # Top 10 regions
        "most_affected_region": most_affected_region,
        "athlete_breakdown": athlete_breakdown[:10],  # Top 10 affected athletes
        "heatmap_data": heatmap_data,
        "period_days": days
    }

# Weekly Monotony and Strain Metrics (Staff/Admin only)
@api_router.get("/staff/dashboard/workload-metrics")
async def get_workload_metrics(team: Optional[str] = None, weeks: int = 4, current_user: dict = Depends(get_current_user)):
    """
    Calculate weekly Monotony and Strain metrics based on session-RPE data.
    
    Monotony = Mean daily sRPE / Standard Deviation of daily sRPE
    Strain = Weekly Load × Monotony
    
    These metrics are for workload monitoring and decision support only.
    They should not be interpreted as injury risk indicators or medical diagnoses.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_info = {a['id']: {"name": a['name'], "team": a['team']} for a in athletes}
    
    now = datetime.now(timezone.utc)
    start_date = (now - timedelta(weeks=weeks)).isoformat()
    
    # Get all training sessions for the period
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    
    # Group sessions by athlete and week
    athlete_weekly_data = {}
    
    for s in sessions:
        athlete_id = s['athlete_id']
        date_str = s['date_time_start']
        
        # Parse date
        if 'Z' in date_str:
            session_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        elif '+' in date_str or date_str.endswith('00'):
            session_date = datetime.fromisoformat(date_str)
        else:
            session_date = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        
        # Get ISO week number (year, week)
        year_week = session_date.strftime("%Y-W%V")
        
        if athlete_id not in athlete_weekly_data:
            athlete_weekly_data[athlete_id] = {}
        
        if year_week not in athlete_weekly_data[athlete_id]:
            athlete_weekly_data[athlete_id][year_week] = {"daily_loads": {}, "total_load": 0}
        
        # Get the day of the week
        day_key = session_date.strftime("%Y-%m-%d")
        internal_load = s.get('internal_load', 0)
        
        if day_key not in athlete_weekly_data[athlete_id][year_week]["daily_loads"]:
            athlete_weekly_data[athlete_id][year_week]["daily_loads"][day_key] = 0
        
        athlete_weekly_data[athlete_id][year_week]["daily_loads"][day_key] += internal_load
        athlete_weekly_data[athlete_id][year_week]["total_load"] += internal_load
    
    # Calculate Monotony and Strain for each athlete per week
    athlete_metrics = []
    weekly_team_data = {}  # For team averages
    
    for athlete_id, weeks_data in athlete_weekly_data.items():
        athlete_name = athlete_info.get(athlete_id, {}).get("name", "Unknown")
        athlete_team = athlete_info.get(athlete_id, {}).get("team", "Unknown")
        
        athlete_weeks = []
        
        for year_week, data in sorted(weeks_data.items()):
            daily_loads = list(data["daily_loads"].values())
            weekly_load = data["total_load"]
            training_days = len(daily_loads)
            
            # Calculate Monotony (only if more than 1 training day)
            monotony = None
            strain = None
            monotony_status = "unavailable"
            
            if training_days > 1:
                mean_load = np.mean(daily_loads)
                std_load = np.std(daily_loads, ddof=1)  # Sample std deviation
                
                if std_load > 0:
                    monotony = round(mean_load / std_load, 2)
                    strain = round(weekly_load * monotony, 0)
                    
                    # Determine color status based on monotony
                    if monotony < 1.5:
                        monotony_status = "green"
                    elif monotony <= 2.0:
                        monotony_status = "yellow"
                    else:
                        monotony_status = "red"
                else:
                    # All days had the same load, infinite monotony
                    monotony_status = "unavailable"
            
            week_entry = {
                "week": year_week,
                "weekly_load": weekly_load,
                "training_days": training_days,
                "monotony": monotony,
                "strain": strain,
                "monotony_status": monotony_status
            }
            
            athlete_weeks.append(week_entry)
            
            # Aggregate for team averages
            if year_week not in weekly_team_data:
                weekly_team_data[year_week] = {
                    "monotony_values": [],
                    "strain_values": [],
                    "load_values": []
                }
            
            if monotony is not None:
                weekly_team_data[year_week]["monotony_values"].append(monotony)
            if strain is not None:
                weekly_team_data[year_week]["strain_values"].append(strain)
            weekly_team_data[year_week]["load_values"].append(weekly_load)
        
        # Get latest week's metrics for summary
        latest_week = athlete_weeks[-1] if athlete_weeks else None
        
        athlete_metrics.append({
            "athlete_id": athlete_id,
            "athlete_name": athlete_name,
            "team": athlete_team,
            "weeks": athlete_weeks,
            "latest_monotony": latest_week["monotony"] if latest_week else None,
            "latest_strain": latest_week["strain"] if latest_week else None,
            "latest_status": latest_week["monotony_status"] if latest_week else "unavailable"
        })
    
    # Calculate team averages per week
    team_averages = []
    for year_week in sorted(weekly_team_data.keys()):
        data = weekly_team_data[year_week]
        
        avg_monotony = round(np.mean(data["monotony_values"]), 2) if data["monotony_values"] else None
        avg_strain = round(np.mean(data["strain_values"]), 0) if data["strain_values"] else None
        avg_load = round(np.mean(data["load_values"]), 0) if data["load_values"] else 0
        
        # Team monotony status
        team_status = "unavailable"
        if avg_monotony is not None:
            if avg_monotony < 1.5:
                team_status = "green"
            elif avg_monotony <= 2.0:
                team_status = "yellow"
            else:
                team_status = "red"
        
        team_averages.append({
            "week": year_week,
            "avg_monotony": avg_monotony,
            "avg_strain": avg_strain,
            "avg_load": avg_load,
            "status": team_status,
            "athletes_count": len(data["load_values"])
        })
    
    # Sort athlete metrics by latest monotony (highest first, nulls last)
    athlete_metrics.sort(key=lambda x: (x["latest_monotony"] is None, -(x["latest_monotony"] or 0)))
    
    return {
        "athlete_metrics": athlete_metrics,
        "team_averages": team_averages,
        "weeks_analyzed": weeks,
        "disclaimer": "These metrics are for workload monitoring and decision support only. Values are comparative and individual-based. They should not be interpreted as injury risk indicators or medical diagnoses."
    }

@api_router.get("/staff/dashboard/charts")
async def get_dashboard_charts(team: Optional[str] = None, days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    start_date_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Get readiness data
    readiness_data = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(500)
    
    # Build per-athlete readiness data for individual lines
    # Structure: {date: {athlete_name: score, ...}, ...}
    dates_set = set()
    athlete_readiness_by_date = {}
    for r in readiness_data:
        date = r['date']
        dates_set.add(date)
        athlete_name = athlete_names.get(r['athlete_id'], 'Unknown')
        if date not in athlete_readiness_by_date:
            athlete_readiness_by_date[date] = {}
        athlete_readiness_by_date[date][athlete_name] = r['readiness_score']
    
    # Create chart data with each athlete as a separate field
    readiness_chart = []
    for date in sorted(dates_set):
        row = {"date": date}
        for athlete in athletes:
            name = athlete['name']
            row[name] = athlete_readiness_by_date.get(date, {}).get(name, None)
        readiness_chart.append(row)
    
    # Get session data
    sessions_data = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date_iso}},
        {"_id": 0}
    ).to_list(500)
    
    # Build per-athlete load data
    dates_load_set = set()
    athlete_load_by_date = {}
    athlete_pain_by_date = {}
    for s in sessions_data:
        date = s['date_time_start'][:10]
        dates_load_set.add(date)
        athlete_name = athlete_names.get(s['athlete_id'], 'Unknown')
        if date not in athlete_load_by_date:
            athlete_load_by_date[date] = {}
            athlete_pain_by_date[date] = {}
        athlete_load_by_date[date][athlete_name] = athlete_load_by_date[date].get(athlete_name, 0) + s['internal_load']
        if athlete_name not in athlete_pain_by_date[date]:
            athlete_pain_by_date[date][athlete_name] = []
        athlete_pain_by_date[date][athlete_name].append(s['pain_after'])
    
    # Create load chart with each athlete as a separate field
    load_chart = []
    for date in sorted(dates_load_set):
        row = {"date": date}
        for athlete in athletes:
            name = athlete['name']
            row[name] = athlete_load_by_date.get(date, {}).get(name, None)
        load_chart.append(row)
    
    # Create pain chart with each athlete as a separate field
    pain_chart = []
    for date in sorted(dates_load_set):
        row = {"date": date}
        for athlete in athletes:
            name = athlete['name']
            pains = athlete_pain_by_date.get(date, {}).get(name, None)
            if pains:
                row[name] = round(sum(pains) / len(pains), 2)
            else:
                row[name] = None
        pain_chart.append(row)
    
    # Return athlete names list for the frontend to know which lines to render
    athlete_name_list = [a['name'] for a in athletes]
    
    return {
        "readiness": readiness_chart,
        "load": load_chart,
        "pain": pain_chart,
        "athletes": athlete_name_list
    }

# Team Readiness Radar Chart - Daily snapshot of team wellness dimensions
@api_router.get("/staff/dashboard/readiness-radar")
async def get_team_readiness_radar(team: Optional[str] = None, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get team average daily readiness radar data for a specific day.
    Each axis represents a wellness dimension (Sleep, Fatigue, Soreness, Stress, Readiness).
    All values are normalized to 0-10 scale where higher = better.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Calculate the target date
    target_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get athletes filter
    athlete_query = {"status": "approved"}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    
    if not athlete_ids:
        return {
            "date": target_date,
            "athletes_count": 0,
            "radar_data": [],
            "available_dates": []
        }
    
    # Get readiness entries for the specific date
    readiness_entries = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": target_date},
        {"_id": 0}
    ).to_list(100)
    
    # Calculate team averages for each dimension
    if readiness_entries:
        avg_sleep = round(sum(e['sleep_quality'] for e in readiness_entries) / len(readiness_entries), 2)
        # Fatigue, Soreness, Stress are inverted (lower original = better, so we use 10 - value)
        avg_fatigue = round(sum(e.get('fatigue_score_10', 10 - e['morning_fatigue']) for e in readiness_entries) / len(readiness_entries), 2)
        avg_soreness = round(sum(e.get('soreness_score_10', 10 - e['muscle_soreness']) for e in readiness_entries) / len(readiness_entries), 2)
        avg_stress = round(sum(e.get('stress_score_10', 10 - e['stress']) for e in readiness_entries) / len(readiness_entries), 2)
        avg_readiness = round(sum(e.get('readiness', e.get('readiness_score', 5)) for e in readiness_entries) / len(readiness_entries), 2)
        
        # Build radar data with consistent ordering
        radar_data = [
            {"dimension": "Sleep Quality", "value": avg_sleep, "fullMark": 10},
            {"dimension": "Energy Level", "value": avg_fatigue, "fullMark": 10},
            {"dimension": "Muscle Recovery", "value": avg_soreness, "fullMark": 10},
            {"dimension": "Mental Wellness", "value": avg_stress, "fullMark": 10},
            {"dimension": "Readiness to Train", "value": avg_readiness, "fullMark": 10},
        ]
    else:
        radar_data = []
    
    # Get available dates (last 14 days with data)
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    available_entries = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": fourteen_days_ago}},
        {"_id": 0, "date": 1}
    ).to_list(500)
    
    available_dates = sorted(list(set(e['date'] for e in available_entries)), reverse=True)
    
    return {
        "date": target_date,
        "athletes_count": len(readiness_entries),
        "total_athletes": len(athlete_ids),
        "radar_data": radar_data,
        "available_dates": available_dates[:14]  # Last 14 days with data
    }

# Individual Athlete Readiness Radar Chart - Daily snapshot of individual wellness
@api_router.get("/staff/athlete/{athlete_id}/readiness-radar")
async def get_athlete_readiness_radar(athlete_id: str, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get individual athlete's daily readiness radar data for a specific day.
    Each axis represents a wellness dimension (Sleep, Fatigue, Soreness, Stress, Readiness).
    All values are normalized to 0-10 scale where higher = better.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Verify athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    # Calculate the target date
    target_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get readiness entry for the specific date
    readiness_entry = await db.daily_readiness.find_one(
        {"athlete_id": athlete_id, "date": target_date},
        {"_id": 0}
    )
    
    if readiness_entry:
        # Build radar data with consistent ordering (same as team radar)
        radar_data = [
            {"dimension": "Sleep Quality", "value": readiness_entry['sleep_quality'], "fullMark": 10},
            {"dimension": "Energy Level", "value": readiness_entry.get('fatigue_score_10', 10 - readiness_entry['morning_fatigue']), "fullMark": 10},
            {"dimension": "Muscle Recovery", "value": readiness_entry.get('soreness_score_10', 10 - readiness_entry['muscle_soreness']), "fullMark": 10},
            {"dimension": "Mental Wellness", "value": readiness_entry.get('stress_score_10', 10 - readiness_entry['stress']), "fullMark": 10},
            {"dimension": "Readiness to Train", "value": readiness_entry.get('readiness', readiness_entry.get('readiness_score', 5)), "fullMark": 10},
        ]
        has_data = True
    else:
        radar_data = []
        has_data = False
    
    # Get available dates (last 14 days with data for this athlete)
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    available_entries = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": fourteen_days_ago}},
        {"_id": 0, "date": 1}
    ).to_list(100)
    
    available_dates = sorted(list(set(e['date'] for e in available_entries)), reverse=True)
    
    return {
        "date": target_date,
        "athlete_name": athlete['name'],
        "has_data": has_data,
        "radar_data": radar_data,
        "available_dates": available_dates[:14]  # Last 14 days with data
    }

# Daily Pain by Body Region - For Short Term view
@api_router.get("/staff/dashboard/daily-pain")
async def get_daily_pain_by_region(team: Optional[str] = None, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get pain reports grouped by body region for a specific day.
    Returns frequency and severity of pain by body region for that day only.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Calculate target date
    target_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get athletes filter
    athlete_query = {"status": "approved"}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    if not athlete_ids:
        return {
            "date": target_date,
            "total_sessions": 0,
            "sessions_with_pain": 0,
            "pain_regions": [],
            "available_dates": []
        }
    
    # Get training sessions for that specific day
    start_of_day = f"{target_date}T00:00:00"
    end_of_day = f"{target_date}T23:59:59"
    
    sessions = await db.training_sessions.find(
        {
            "athlete_id": {"$in": athlete_ids},
            "date_time_start": {"$gte": start_of_day, "$lte": end_of_day}
        },
        {"_id": 0}
    ).to_list(500)
    
    # Aggregate pain by body region AND laterality
    # Supports both legacy single-pain format and new pain_reports array
    region_data = {}
    laterality_data = {"Left": 0, "Right": 0, "Both": 0, "N/A": 0}
    sessions_with_pain = 0
    
    def add_pain_to_region(region, pain, laterality, athlete_id):
        """Helper function to add pain data to region aggregation"""
        nonlocal sessions_with_pain
        
        if pain > 0 and region and region != 'None':
            # Track laterality totals
            if laterality in laterality_data:
                laterality_data[laterality] += 1
            
            if region not in region_data:
                region_data[region] = {
                    "region": region,
                    "count": 0,
                    "total_pain": 0,
                    "severe_count": 0,
                    "athletes": set(),
                    "left_count": 0,
                    "right_count": 0,
                    "both_count": 0
                }
            
            region_data[region]["count"] += 1
            region_data[region]["total_pain"] += pain
            region_data[region]["athletes"].add(athlete_names.get(athlete_id, 'Unknown'))
            if pain >= 7:
                region_data[region]["severe_count"] += 1
            
            # Track laterality per region
            if laterality == 'Left':
                region_data[region]["left_count"] += 1
            elif laterality == 'Right':
                region_data[region]["right_count"] += 1
            elif laterality == 'Both':
                region_data[region]["both_count"] += 1
            
            return True
        return False
    
    for session in sessions:
        session_had_pain = False
        athlete_id = session.get('athlete_id')
        
        # Check new pain_reports array format first
        pain_reports = session.get('pain_reports', [])
        if pain_reports:
            for pr in pain_reports:
                region = pr.get('body_region')
                pain = pr.get('pain_level', 0)
                laterality = pr.get('laterality', 'N/A')
                if add_pain_to_region(region, pain, laterality, athlete_id):
                    session_had_pain = True
        
        # Also check legacy single-pain format
        region = session.get('body_region', 'None')
        pain = session.get('pain_after', 0)
        laterality = session.get('laterality', 'N/A')
        if add_pain_to_region(region, pain, laterality, athlete_id):
            session_had_pain = True
        
        if session_had_pain:
            sessions_with_pain += 1
    
    # Convert to list and calculate averages
    pain_regions = []
    for region, data in region_data.items():
        pain_regions.append({
            "region": region,
            "count": data["count"],
            "avg_pain": round(data["total_pain"] / data["count"], 1) if data["count"] > 0 else 0,
            "severe_count": data["severe_count"],
            "athletes": list(data["athletes"]),
            "left_count": data["left_count"],
            "right_count": data["right_count"],
            "both_count": data["both_count"]
        })
    
    # Sort by count (most frequent first)
    pain_regions.sort(key=lambda x: x["count"], reverse=True)
    
    # Get available dates (last 14 days with sessions)
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    available_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": f"{fourteen_days_ago}T00:00:00"}},
        {"_id": 0, "date_time_start": 1}
    ).to_list(1000)
    
    available_dates = sorted(list(set(s['date_time_start'][:10] for s in available_sessions)), reverse=True)
    
    return {
        "date": target_date,
        "total_sessions": len(sessions),
        "sessions_with_pain": sessions_with_pain,
        "pain_regions": pain_regions,
        "most_affected": pain_regions[0] if pain_regions else None,
        "laterality_totals": laterality_data,
        "available_dates": available_dates[:14]
    }

# Individual Athlete Pain Map - For Anatomical Viewer
@api_router.get("/staff/athlete/{athlete_id}/pain-map")
async def get_athlete_pain_map(athlete_id: str, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get pain locations for an individual athlete for a specific day.
    Returns list of body regions with pain for anatomical visualization.
    Supports both legacy single pain and new multiple pain_reports format.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Verify athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    # Calculate target date
    target_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get training sessions for that specific day
    start_of_day = f"{target_date}T00:00:00"
    end_of_day = f"{target_date}T23:59:59"
    
    sessions = await db.training_sessions.find(
        {
            "athlete_id": athlete_id,
            "date_time_start": {"$gte": start_of_day, "$lte": end_of_day}
        },
        {"_id": 0}
    ).to_list(50)
    
    # Collect pain locations with laterality - handles both formats
    pain_locations = []
    
    def add_pain_location(region, laterality, pain_level, session_type):
        """Helper to add or update pain location"""
        if pain_level > 0 and region and region != 'None':
            existing = next((p for p in pain_locations if p['region'] == region and p.get('laterality') == laterality), None)
            if existing:
                if pain_level > existing['pain_level']:
                    existing['pain_level'] = pain_level
                    existing['severity'] = 'severe' if pain_level >= 7 else 'moderate' if pain_level >= 4 else 'mild'
            else:
                pain_locations.append({
                    "region": region,
                    "laterality": laterality or 'N/A',
                    "pain_level": pain_level,
                    "severity": 'severe' if pain_level >= 7 else 'moderate' if pain_level >= 4 else 'mild',
                    "session_type": session_type
                })
    
    for session in sessions:
        session_type = session.get('session_type', 'Unknown')
        
        # Check for new pain_reports array format (multiple pains)
        pain_reports = session.get('pain_reports', [])
        if pain_reports:
            for pr in pain_reports:
                add_pain_location(
                    pr.get('body_region'),
                    pr.get('laterality'),
                    pr.get('pain_level', 0),
                    session_type
                )
        
        # Also check legacy single pain format
        region = session.get('body_region', 'None')
        pain = session.get('pain_after', 0)
        laterality = session.get('laterality', 'N/A')
        add_pain_location(region, laterality, pain, session_type)
    
    # Get available dates (last 14 days with sessions)
    fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    available_sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": f"{fourteen_days_ago}T00:00:00"}},
        {"_id": 0, "date_time_start": 1}
    ).to_list(100)
    
    available_dates = sorted(list(set(s['date_time_start'][:10] for s in available_sessions)), reverse=True)
    
    return {
        "date": target_date,
        "athlete_name": athlete['name'],
        "has_pain": len(pain_locations) > 0,
        "pain_locations": pain_locations,
        "total_sessions": len(sessions),
        "available_dates": available_dates[:14]
    }

# Alerts
@api_router.get("/staff/alerts")
async def get_alerts(team: Optional[str] = None, resolved: bool = False, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    alerts = await db.alerts.find(
        {"athlete_id": {"$in": athlete_ids}, "resolved": resolved},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    # Add athlete names
    for alert in alerts:
        alert['athlete_name'] = athlete_names.get(alert['athlete_id'], 'Unknown')
    
    return alerts

@api_router.put("/staff/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    result = await db.alerts.update_one(
        {"id": alert_id},
        {"$set": {
            "resolved": True,
            "resolved_by": current_user['user']['id'],
            "resolved_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    return {"sucesso": True}

# ACWR chart data for medium term
@api_router.get("/staff/dashboard/acwr")
async def get_acwr_chart(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    
    acwr_data = []
    for athlete in athletes:
        workload = await get_athlete_workload_internal(athlete['id'])
        acwr_data.append({
            "name": athlete['name'],
            "acwr": workload['acwr'],
            "acute": workload['acute_load_7'],
            "chronic": workload['chronic_load_28']
        })
    
    return acwr_data

async def get_athlete_workload_internal(athlete_id: str):
    now = datetime.now(timezone.utc)
    start_28 = (now - timedelta(days=28)).isoformat()
    start_7 = (now - timedelta(days=7)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_28}},
        {"_id": 0}
    ).to_list(200)
    
    sessions_7 = [s for s in sessions if s['date_time_start'] >= start_7]
    
    acute_load_7 = sum(s['internal_load'] for s in sessions_7)
    chronic_load_28 = sum(s['internal_load'] for s in sessions)
    
    acwr = 0
    if chronic_load_28 > 0:
        acwr = round(acute_load_7 / (chronic_load_28 / 4), 2)
    
    return {
        "acute_load_7": acute_load_7,
        "chronic_load_28": chronic_load_28,
        "acwr": acwr
    }

# Long-term chronic workload management endpoints
@api_router.get("/staff/dashboard/longterm")
async def get_longterm_data(team: Optional[str] = None, months: int = 3, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    athlete_query = {"active": True, "status": {"$in": ["approved", None]}}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    # Calculate date range (last N months)
    now = datetime.now(timezone.utc)
    start_date = (now - timedelta(days=months * 30)).isoformat()
    start_date_str = (now - timedelta(days=months * 30)).strftime("%Y-%m-%d")
    
    # Get all sessions for the period
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    
    # Get all readiness data for the period
    readiness_data = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_date_str}},
        {"_id": 0}
    ).to_list(2000)
    
    # 1. Monthly Cumulative Load by Athlete
    monthly_load = {}
    for s in sessions:
        month = s['date_time_start'][:7]  # YYYY-MM
        athlete_name = athlete_names.get(s['athlete_id'], 'Unknown')
        if month not in monthly_load:
            monthly_load[month] = {}
        monthly_load[month][athlete_name] = monthly_load[month].get(athlete_name, 0) + s['internal_load']
    
    monthly_load_chart = []
    for month in sorted(monthly_load.keys()):
        row = {"month": month}
        for athlete in athletes:
            row[athlete['name']] = monthly_load[month].get(athlete['name'], 0)
        monthly_load_chart.append(row)
    
    # 2. Rolling 7-day Average Readiness (weekly snapshots)
    # Group readiness by week
    weekly_readiness = {}
    for r in readiness_data:
        # Get week number
        date_obj = datetime.fromisoformat(r['date'])
        week_key = f"{date_obj.year}-W{date_obj.isocalendar()[1]:02d}"
        athlete_name = athlete_names.get(r['athlete_id'], 'Unknown')
        
        if week_key not in weekly_readiness:
            weekly_readiness[week_key] = {}
        if athlete_name not in weekly_readiness[week_key]:
            weekly_readiness[week_key][athlete_name] = []
        weekly_readiness[week_key][athlete_name].append(r['readiness_score'])
    
    readiness_trend_chart = []
    for week in sorted(weekly_readiness.keys()):
        row = {"week": week}
        for athlete in athletes:
            scores = weekly_readiness[week].get(athlete['name'], [])
            row[athlete['name']] = round(sum(scores) / len(scores), 2) if scores else None
        readiness_trend_chart.append(row)
    
    # 3. Pain Frequency and Body Region Distribution
    pain_by_region = {}
    high_pain_count = {}  # Pain >= 5
    for s in sessions:
        if s.get('pain_after', 0) >= 5:
            athlete_name = athlete_names.get(s['athlete_id'], 'Unknown')
            high_pain_count[athlete_name] = high_pain_count.get(athlete_name, 0) + 1
            
            region = s.get('body_region') or 'Unspecified'
            pain_by_region[region] = pain_by_region.get(region, 0) + 1
    
    pain_distribution = [
        {"region": region, "count": count}
        for region, count in sorted(pain_by_region.items(), key=lambda x: -x[1])
    ]
    
    # 4. Training Consistency (sessions per week per athlete)
    sessions_per_week = {}
    for s in sessions:
        date_obj = datetime.fromisoformat(s['date_time_start'].replace('Z', '+00:00'))
        week_key = f"{date_obj.year}-W{date_obj.isocalendar()[1]:02d}"
        athlete_name = athlete_names.get(s['athlete_id'], 'Unknown')
        
        if week_key not in sessions_per_week:
            sessions_per_week[week_key] = {}
        sessions_per_week[week_key][athlete_name] = sessions_per_week[week_key].get(athlete_name, 0) + 1
    
    consistency_chart = []
    for week in sorted(sessions_per_week.keys()):
        row = {"week": week}
        for athlete in athletes:
            row[athlete['name']] = sessions_per_week[week].get(athlete['name'], 0)
        consistency_chart.append(row)
    
    # 5. Check-in Compliance (% of days with morning check-in)
    total_days = months * 30
    compliance_data = []
    for athlete in athletes:
        athlete_readiness = [r for r in readiness_data if r['athlete_id'] == athlete['id']]
        compliance_pct = round((len(athlete_readiness) / total_days) * 100, 1) if total_days > 0 else 0
        compliance_data.append({
            "name": athlete['name'],
            "checkins": len(athlete_readiness),
            "compliance": compliance_pct,
            "high_pain_sessions": high_pain_count.get(athlete['name'], 0)
        })
    
    # 6. Chronic Load Trend (28-day rolling sum, calculated weekly)
    # Calculate for each week what the 28-day load was
    chronic_trend = []
    weeks_in_range = sorted(set(
        f"{datetime.fromisoformat(s['date_time_start'].replace('Z', '+00:00')).year}-W{datetime.fromisoformat(s['date_time_start'].replace('Z', '+00:00')).isocalendar()[1]:02d}"
        for s in sessions
    ))
    
    for week in weeks_in_range[-8:]:  # Last 8 weeks
        row = {"week": week}
        # Parse week to get end date using ISO week format
        year, week_num = int(week.split('-W')[0]), int(week.split('-W')[1])
        # Use ISO calendar - week ends on Sunday (day 7)
        try:
            week_end = datetime.strptime(f'{year}-W{week_num:02d}-7', '%G-W%V-%u').replace(tzinfo=timezone.utc)
        except ValueError:
            # Fallback: approximate by calculating from year start
            jan1 = datetime(year, 1, 1, tzinfo=timezone.utc)
            week_end = jan1 + timedelta(weeks=week_num, days=-jan1.weekday())
        
        week_start_28 = (week_end - timedelta(days=28)).isoformat()
        
        for athlete in athletes:
            athlete_sessions = [s for s in sessions 
                              if s['athlete_id'] == athlete['id'] 
                              and s['date_time_start'] >= week_start_28
                              and s['date_time_start'] <= week_end.isoformat()]
            row[athlete['name']] = sum(s['internal_load'] for s in athlete_sessions)
        chronic_trend.append(row)
    
    return {
        "monthly_load": monthly_load_chart,
        "readiness_trend": readiness_trend_chart,
        "pain_distribution": pain_distribution,
        "consistency": consistency_chart,
        "compliance": compliance_data,
        "chronic_trend": chronic_trend,
        "athletes": [a['name'] for a in athletes]
    }

# Seed demo data
@api_router.post("/seed")
async def seed_demo_data():
    # Clear existing data
    await db.athletes.delete_many({})
    await db.staff_users.delete_many({})
    await db.daily_readiness.delete_many({})
    await db.training_sessions.delete_many({})
    await db.recovery_checks.delete_many({})
    await db.alerts.delete_many({})
    await db.notifications.delete_many({})
    
    # Create demo athletes
    demo_athletes = [
        {"name": "Lucas Silva", "email": "lucas@brazillacrosse.com", "team": TeamEnum.MEN, "password": "demo123"},
        {"name": "Pedro Santos", "email": "pedro@brazillacrosse.com", "team": TeamEnum.MEN, "password": "demo123"},
        {"name": "Gabriel Costa", "email": "gabriel@brazillacrosse.com", "team": TeamEnum.MEN, "password": "demo123"},
        {"name": "Ana Oliveira", "email": "ana@brazillacrosse.com", "team": TeamEnum.WOMEN, "password": "demo123"},
        {"name": "Julia Pereira", "email": "julia@brazillacrosse.com", "team": TeamEnum.WOMEN, "password": "demo123"},
        {"name": "Maria Souza", "email": "maria@brazillacrosse.com", "team": TeamEnum.WOMEN, "password": "demo123"},
    ]
    
    athlete_ids = []
    for a in demo_athletes:
        athlete = Athlete(
            name=a['name'],
            email=a['email'],
            team=a['team'],
            preferred_training_time="09:00",
            status=AthleteStatusEnum.APPROVED  # Demo athletes are pre-approved
        )
        doc = athlete.model_dump()
        doc['password_hash'] = hash_password(a['password'])
        await db.athletes.insert_one(doc)
        athlete_ids.append(athlete.id)
    
    # Create demo staff
    demo_staff = [
        {"name": "Coach Ricardo", "email": "coach@brazillacrosse.com", "role": StaffRoleEnum.COACH, "password": "staff123"},
        {"name": "Dr. Fernanda", "email": "physio@brazillacrosse.com", "role": StaffRoleEnum.PHYSIO, "password": "staff123"},
        {"name": "Admin Carlos", "email": "admin@brazillacrosse.com", "role": StaffRoleEnum.ADMIN, "password": "staff123"},
    ]
    
    for s in demo_staff:
        staff = StaffUser(
            name=s['name'],
            email=s['email'],
            role=s['role']
        )
        doc = staff.model_dump()
        doc['password_hash'] = hash_password(s['password'])
        await db.staff_users.insert_one(doc)
    
    # Generate demo data for last 14 days
    import random
    session_types = list(SessionTypeEnum)
    
    for athlete_id in athlete_ids:
        for day_offset in range(14, -1, -1):
            date = (datetime.now(timezone.utc) - timedelta(days=day_offset)).strftime("%Y-%m-%d")
            date_iso = (datetime.now(timezone.utc) - timedelta(days=day_offset)).isoformat()
            
            # Morning readiness (80% chance)
            if random.random() < 0.8:
                sleep_q = random.randint(5, 10)
                fatigue = random.randint(2, 7)
                soreness = random.randint(1, 6)
                stress = random.randint(1, 6)
                ready = random.randint(5, 10)
                
                fatigue_score_10 = 10 - fatigue
                soreness_score_10 = 10 - soreness
                stress_score_10 = 10 - stress
                readiness_score = round((sleep_q + fatigue_score_10 + soreness_score_10 + stress_score_10 + ready) / 5, 2)
                
                readiness = DailyReadiness(
                    athlete_id=athlete_id,
                    date=date,
                    sleep_quality=sleep_q,
                    morning_fatigue=fatigue,
                    muscle_soreness=soreness,
                    stress=stress,
                    readiness=ready,
                    fatigue_score_10=fatigue_score_10,
                    soreness_score_10=soreness_score_10,
                    stress_score_10=stress_score_10,
                    readiness_score=readiness_score,
                    created_at=date_iso
                )
                await db.daily_readiness.insert_one(readiness.model_dump())
            
            # Training session (70% chance)
            if random.random() < 0.7:
                duration = random.randint(45, 120)
                rpe = random.randint(4, 9)
                
                session = TrainingSession(
                    athlete_id=athlete_id,
                    date_time_start=date_iso,
                    session_type=random.choice(session_types),
                    duration_min=duration,
                    rpe=rpe,
                    pain_during=random.randint(0, 4),
                    pain_after=random.randint(0, 5),
                    end_fatigue=random.randint(4, 8),
                    internal_load=duration * rpe,
                    created_at=date_iso
                )
                await db.training_sessions.insert_one(session.model_dump())
            
            # Evening recovery (50% chance)
            if random.random() < 0.5:
                overall = random.randint(5, 10)
                rec_q = random.randint(5, 10)
                sleep_a = random.randint(5, 10)
                pain = random.randint(0, 4)
                
                recovery = RecoveryCheck(
                    athlete_id=athlete_id,
                    date=date,
                    overall_feeling=overall,
                    recovery_quality=rec_q,
                    sleep_after=sleep_a,
                    residual_pain=pain,
                    recovery_score=round((overall + rec_q + sleep_a + (10 - pain)) / 4, 2),
                    created_at=date_iso
                )
                await db.recovery_checks.insert_one(recovery.model_dump())
    
    # Create some demo alerts
    demo_alerts = [
        {"athlete_id": athlete_ids[0], "type": AlertTypeEnum.LOW_READINESS, "severity": AlertSeverityEnum.YELLOW, "msg": "Low readiness score for 2 consecutive days"},
        {"athlete_id": athlete_ids[2], "type": AlertTypeEnum.HIGH_LOAD_SPIKE, "severity": AlertSeverityEnum.RED, "msg": "Acute load spike detected (>1.8x average)"},
        {"athlete_id": athlete_ids[4], "type": AlertTypeEnum.PERSISTENT_PAIN, "severity": AlertSeverityEnum.YELLOW, "msg": "Pain reported in 2 sessions within 3 days"},
    ]
    
    for a in demo_alerts:
        alert = Alert(
            athlete_id=a['athlete_id'],
            alert_type=a['type'],
            severity=a['severity'],
            message=a['msg'],
            created_at=datetime.now(timezone.utc).isoformat()
        )
        await db.alerts.insert_one(alert.model_dump())
    
    return {"message": "Demo data seeded successfully", "athletes": len(athlete_ids), "staff": len(demo_staff)}

# ==================== EXPORT FUNCTIONALITY ====================

# Helper function to get date range from event or custom dates
async def get_export_date_range(start_date: Optional[str], end_date: Optional[str], event_id: Optional[str]):
    """Get date range for export, either from custom dates or event"""
    if event_id:
        event = await db.events.find_one({"id": event_id}, {"_id": 0})
        if event:
            return event['start_date'], event['end_date']
    
    if start_date and end_date:
        return start_date, end_date
    
    # Default to last 30 days
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30)
    return start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')

# Helper to filter by team
def get_team_filter(team: Optional[str]):
    if team == "men":
        return TeamEnum.MEN.value
    elif team == "women":
        return TeamEnum.WOMEN.value
    return None

# CSV Export Helper Functions
def generate_csv_content(rows: List[dict], headers: List[str]) -> str:
    """Generate CSV content from data rows"""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction='ignore')
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue()

# PDF Export Helper Functions
def create_pdf_header(story, title: str, subtitle: str, date_range: str):
    """Create a professional PDF header"""
    styles = getSampleStyleSheet()
    
    # Title style
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontSize=24,
        textColor=colors.HexColor('#1a365d'),
        spaceAfter=6,
        alignment=TA_CENTER
    )
    
    # Subtitle style
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.HexColor('#4a5568'),
        spaceAfter=4,
        alignment=TA_CENTER
    )
    
    # Date range style
    date_style = ParagraphStyle(
        'DateRange',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#718096'),
        spaceAfter=20,
        alignment=TA_CENTER
    )
    
    story.append(Paragraph("Brazil Lacrosse", title_style))
    story.append(Paragraph(title, subtitle_style))
    story.append(Paragraph(f"Period: {date_range}", date_style))
    story.append(Spacer(1, 0.3*inch))

def create_section_header(story, title: str):
    """Create a section header in the PDF"""
    styles = getSampleStyleSheet()
    section_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#2d3748'),
        spaceBefore=15,
        spaceAfter=10,
        borderPadding=5
    )
    story.append(Paragraph(title, section_style))

def create_data_table(story, headers: List[str], data: List[List], col_widths=None):
    """Create a formatted data table for PDF"""
    if not data:
        styles = getSampleStyleSheet()
        story.append(Paragraph("No data available for this section.", styles['Normal']))
        story.append(Spacer(1, 0.2*inch))
        return
    
    table_data = [headers] + data
    
    if col_widths is None:
        col_widths = [1.2*inch] * len(headers)
    
    table = Table(table_data, colWidths=col_widths)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2d3748')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f7fafc')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#ffffff'), colors.HexColor('#f7fafc')]),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.3*inch))

def create_summary_box(story, metrics: dict):
    """Create a summary metrics box"""
    styles = getSampleStyleSheet()
    
    summary_style = ParagraphStyle(
        'Summary',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#2d3748'),
        spaceBefore=5,
        spaceAfter=5
    )
    
    for key, value in metrics.items():
        story.append(Paragraph(f"<b>{key}:</b> {value}", summary_style))
    story.append(Spacer(1, 0.2*inch))

# Individual Athlete Export
@api_router.post("/export/athlete/{athlete_id}")
async def export_athlete_data(
    athlete_id: str,
    request: ExportRequest,
    current_user: dict = Depends(get_current_user)
):
    """Export individual athlete data in CSV or PDF format"""
    # Check staff/admin permission
    if current_user['user_type'] == 'athlete':
        raise HTTPException(status_code=403, detail="Only staff can export data")
    
    # Get athlete info
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    # Get date range
    start_date, end_date = await get_export_date_range(request.start_date, request.end_date, request.event_id)
    
    # Fetch all data for the athlete
    data = {
        "athlete": athlete,
        "readiness": [],
        "sessions": [],
        "recovery": [],
        "pain_reports": []
    }
    
    if request.include_readiness:
        data["readiness"] = await db.daily_readiness.find({
            "athlete_id": athlete_id,
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).sort("date", -1).to_list(1000)
    
    if request.include_training:
        sessions = await db.training_sessions.find({
            "athlete_id": athlete_id,
            "date_time_start": {"$gte": start_date, "$lte": end_date + "T23:59:59"}
        }, {"_id": 0}).sort("date_time_start", -1).to_list(1000)
        data["sessions"] = sessions
        
        # Extract pain reports from sessions
        if request.include_pain:
            for session in sessions:
                pain_reports = session.get('pain_reports') or []
                if pain_reports:
                    for pain in pain_reports:
                        data["pain_reports"].append({
                            "date": session['date_time_start'][:10],
                            "session_type": session.get('session_type', ''),
                            "body_region": pain.get('body_region', ''),
                            "laterality": pain.get('laterality', 'N/A'),
                            "pain_level": pain.get('pain_level', 0)
                        })
    
    if request.include_recovery:
        data["recovery"] = await db.recovery_checks.find({
            "athlete_id": athlete_id,
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Generate export based on format
    if request.format == ExportFormatEnum.CSV:
        return await generate_athlete_csv(data, athlete, start_date, end_date)
    else:
        return await generate_athlete_pdf(data, athlete, start_date, end_date, request.event_id)

async def generate_athlete_csv(data: dict, athlete: dict, start_date: str, end_date: str):
    """Generate CSV export for individual athlete"""
    output = io.StringIO()
    
    # Write athlete info header
    output.write(f"# Athlete Export Report\n")
    output.write(f"# Name: {athlete['name']}\n")
    output.write(f"# Team: {athlete['team']}\n")
    output.write(f"# Period: {start_date} to {end_date}\n")
    output.write(f"# Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
    
    # Readiness Data
    if data["readiness"]:
        output.write("## DAILY READINESS\n")
        readiness_headers = ["Date", "Sleep Quality", "Morning Fatigue", "Muscle Soreness", "Stress", "Readiness Score", "Notes"]
        output.write(",".join(readiness_headers) + "\n")
        for r in data["readiness"]:
            notes = (r.get('notes') or '').replace(',', ';').replace('\n', ' ')
            row = [
                r.get('date', ''),
                str(r.get('sleep_quality', '')),
                str(r.get('morning_fatigue', '')),
                str(r.get('muscle_soreness', '')),
                str(r.get('stress', '')),
                str(r.get('readiness_score', '')),
                notes
            ]
            output.write(",".join(row) + "\n")
        output.write("\n")
    
    # Training Sessions
    if data["sessions"]:
        output.write("## TRAINING SESSIONS\n")
        session_headers = ["Date", "Session Type", "Duration (min)", "RPE", "Internal Load", "Pain During", "Pain After", "End Fatigue", "Notes"]
        output.write(",".join(session_headers) + "\n")
        for s in data["sessions"]:
            notes = (s.get('session_notes') or '').replace(',', ';').replace('\n', ' ')
            row = [
                s.get('date_time_start', '')[:10],
                s.get('session_type', ''),
                str(s.get('duration_min', '')),
                str(s.get('rpe', '')),
                str(s.get('internal_load', '')),
                str(s.get('pain_during', '')),
                str(s.get('pain_after', '')),
                str(s.get('end_fatigue', '')),
                notes
            ]
            output.write(",".join(row) + "\n")
        output.write("\n")
    
    # Pain Reports
    if data["pain_reports"]:
        output.write("## PAIN REPORTS\n")
        pain_headers = ["Date", "Session Type", "Body Region", "Laterality", "Pain Level"]
        output.write(",".join(pain_headers) + "\n")
        for p in data["pain_reports"]:
            row = [
                p.get('date', ''),
                p.get('session_type', ''),
                p.get('body_region', ''),
                p.get('laterality', ''),
                str(p.get('pain_level', ''))
            ]
            output.write(",".join(row) + "\n")
        output.write("\n")
    
    # Recovery Data
    if data["recovery"]:
        output.write("## RECOVERY CHECKS\n")
        recovery_headers = ["Date", "Overall Feeling", "Recovery Quality", "Sleep After Training", "Residual Pain", "Recovery Score", "Notes"]
        output.write(",".join(recovery_headers) + "\n")
        for r in data["recovery"]:
            notes = (r.get('notes') or '').replace(',', ';').replace('\n', ' ')
            row = [
                r.get('date', ''),
                str(r.get('overall_feeling', '')),
                str(r.get('recovery_quality', '')),
                str(r.get('sleep_after', '')),
                str(r.get('residual_pain', '')),
                str(r.get('recovery_score', '')),
                notes
            ]
            output.write(",".join(row) + "\n")
    
    # Create response
    csv_content = output.getvalue()
    filename = f"{athlete['name'].replace(' ', '_')}_export_{start_date}_{end_date}.csv"
    
    return StreamingResponse(
        io.BytesIO(csv_content.encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

async def generate_athlete_pdf(data: dict, athlete: dict, start_date: str, end_date: str, event_id: Optional[str]):
    """Generate visual PDF export for individual athlete - STABLE VERSION"""
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=0.6*inch, leftMargin=0.6*inch, 
                               topMargin=0.6*inch, bottomMargin=0.6*inch)
        story = []
        styles = get_styles()
        
        # Get event name if applicable
        event_name = None
        if event_id:
            event = await db.events.find_one({"id": event_id}, {"_id": 0})
            if event:
                event_name = event.get('name')
        
        date_range_text = f"{start_date} to {end_date}"
        if event_name:
            date_range_text = f"{event_name} ({start_date} - {end_date})"
        
        generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        
        # === COVER PAGE ===
        create_cover_page(
            story, styles,
            title="Individual Athlete Report",
            subtitle=f"{athlete['name']} - {athlete['team']}",
            date_range=date_range_text,
            generated_at=generated_at
        )
        
        # === KEY METRICS SUMMARY ===
        total_sessions = len(data.get("sessions", []))
        total_load = sum(s.get('internal_load', 0) for s in data.get("sessions", []))
        readiness_list = data.get("readiness", [])
        avg_readiness = sum(r.get('readiness_score', 0) for r in readiness_list) / len(readiness_list) if readiness_list else 0
        total_pain_reports = len(data.get("pain_reports", []))
        checkins = len(readiness_list)
        
        metrics = {
            "Sessions": str(total_sessions),
            "Total Load": f"{total_load:,}",
            "Readiness": f"{avg_readiness:.1f}",
            "Pain Reports": str(total_pain_reports),
            "Check-ins": str(checkins),
        }
        
        create_key_metrics_section(story, styles, metrics)
        
        # === READINESS SECTION ===
        if readiness_list:
            story.append(Paragraph("Readiness Trend", styles['SectionTitle']))
            
            try:
                readiness_chart = create_readiness_trend_chart(readiness_list)
                min_score = min(r.get('readiness_score', 0) for r in readiness_list)
                max_score = max(r.get('readiness_score', 0) for r in readiness_list)
                add_chart_with_caption(
                    story, styles, readiness_chart,
                    f"Daily readiness scores. Average: {avg_readiness:.1f} | Range: {min_score:.1f} - {max_score:.1f}",
                    None,
                    width=6*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph(f"Chart generation error", styles['ChartCaption']))
            
            # Latest wellness radar
            try:
                latest = sorted(readiness_list, key=lambda x: x.get('date', ''))[-1]
                story.append(Paragraph("Latest Wellness Profile", styles['SectionTitle']))
                radar_chart = create_radar_chart(latest)
                add_chart_with_caption(
                    story, styles, radar_chart,
                    f"Wellness profile from {latest.get('date', 'N/A')}",
                    None,
                    width=3*inch, height=3*inch
                )
            except Exception as e:
                pass
        
        story.append(PageBreak())
        
        # === WORKLOAD SECTION ===
        sessions = data.get("sessions", [])
        if sessions:
            story.append(Paragraph("Training Workload", styles['SectionTitle']))
            
            try:
                workload_chart = create_workload_bar_chart(sessions)
                avg_per_session = total_load / total_sessions if total_sessions > 0 else 0
                add_chart_with_caption(
                    story, styles, workload_chart,
                    f"Daily training load. Total: {total_load:,} AU | Avg per session: {avg_per_session:.0f} AU",
                    None,
                    width=6*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Workload chart could not be generated", styles['ChartCaption']))
            
            # ACWR if enough data
            if len(sessions) >= 7:
                try:
                    loads_by_date = {}
                    for s in sessions:
                        date = s.get('date_time_start', '')[:10]
                        loads_by_date[date] = loads_by_date.get(date, 0) + s.get('internal_load', 0)
                    
                    daily_loads = list(loads_by_date.values())
                    if len(daily_loads) >= 7:
                        acute = sum(daily_loads[-7:])
                        chronic = sum(daily_loads) / (len(daily_loads) / 7) if len(daily_loads) > 0 else 1
                        if chronic > 0:
                            acwr_value = acute / chronic
                            story.append(Paragraph("ACWR (Workload Ratio)", styles['SectionTitle']))
                            acwr_chart = create_acwr_gauge_chart(acwr_value)
                            risk_text = "Optimal" if 0.8 <= acwr_value <= 1.3 else "Monitor closely"
                            add_chart_with_caption(
                                story, styles, acwr_chart,
                                f"ACWR: {acwr_value:.2f} - {risk_text}. Optimal range: 0.8-1.3",
                                None,
                                width=3.5*inch, height=2*inch
                            )
                except Exception as e:
                    pass
        
        # === PAIN SECTION ===
        pain_reports = data.get("pain_reports", [])
        if pain_reports:
            story.append(Paragraph("Pain Analysis", styles['SectionTitle']))
            
            pain_by_region = {}
            for p in pain_reports:
                region = p.get('body_region', 'Other')
                if region not in pain_by_region:
                    pain_by_region[region] = {'count': 0, 'total_level': 0}
                pain_by_region[region]['count'] += 1
                pain_by_region[region]['total_level'] += p.get('pain_level', 0)
            
            for region in pain_by_region:
                cnt = pain_by_region[region]['count']
                pain_by_region[region]['avg_level'] = pain_by_region[region]['total_level'] / cnt if cnt > 0 else 0
            
            try:
                pain_chart = create_pain_heatmap(pain_by_region)
                add_chart_with_caption(
                    story, styles, pain_chart,
                    f"Pain by body region. Total reports: {total_pain_reports}",
                    None,
                    width=5*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Pain chart could not be generated", styles['ChartCaption']))
        
        # === FOOTER ===
        story.append(Spacer(1, 0.3*inch))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e2e8f0')))
        story.append(Spacer(1, 0.1*inch))
        story.append(Paragraph(
            f"Generated: {generated_at} | Brazil Lacrosse",
            styles['Footer']
        ))
        
        doc.build(story)
        buffer.seek(0)
        
        filename = f"{athlete['name'].replace(' ', '_')}_report_{start_date}_{end_date}.pdf"
        
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logging.error(f"PDF generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

# Team Export
@api_router.post("/export/team")
async def export_team_data(
    request: ExportRequest,
    current_user: dict = Depends(get_current_user)
):
    """Export team-level aggregated data in CSV or PDF format"""
    # Check staff/admin permission
    if current_user['user_type'] == 'athlete':
        raise HTTPException(status_code=403, detail="Only staff can export data")
    
    # Get date range
    start_date, end_date = await get_export_date_range(request.start_date, request.end_date, request.event_id)
    
    # Build athlete query
    athlete_query = {"status": "approved"}
    team_filter = get_team_filter(request.team)
    if team_filter:
        athlete_query["team"] = team_filter
    
    # Get all athletes
    athletes = await db.athletes.find(athlete_query, {"_id": 0}).to_list(1000)
    athlete_ids = [a['id'] for a in athletes]
    athlete_map = {a['id']: a for a in athletes}
    
    if not athletes:
        raise HTTPException(status_code=404, detail="No athletes found for the selected criteria")
    
    # Fetch aggregated data
    data = {
        "athletes": athletes,
        "readiness": [],
        "sessions": [],
        "pain_summary": {},
        "compliance": {}
    }
    
    # Readiness data
    if request.include_readiness:
        readiness_records = await db.daily_readiness.find({
            "athlete_id": {"$in": athlete_ids},
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).to_list(10000)
        
        # Aggregate by athlete
        for r in readiness_records:
            athlete_name = athlete_map.get(r['athlete_id'], {}).get('name', 'Unknown')
            r['athlete_name'] = athlete_name
            r['team'] = athlete_map.get(r['athlete_id'], {}).get('team', '')
        data["readiness"] = readiness_records
    
    # Training sessions
    if request.include_training:
        sessions = await db.training_sessions.find({
            "athlete_id": {"$in": athlete_ids},
            "date_time_start": {"$gte": start_date, "$lte": end_date + "T23:59:59"}
        }, {"_id": 0}).to_list(10000)
        
        for s in sessions:
            athlete_name = athlete_map.get(s['athlete_id'], {}).get('name', 'Unknown')
            s['athlete_name'] = athlete_name
            s['team'] = athlete_map.get(s['athlete_id'], {}).get('team', '')
        data["sessions"] = sessions
        
        # Pain summary by region
        if request.include_pain:
            pain_by_region = {}
            for session in sessions:
                pain_reports = session.get('pain_reports') or []
                for pain in pain_reports:
                    region = pain.get('body_region', 'Other')
                    if region not in pain_by_region:
                        pain_by_region[region] = {'count': 0, 'total_level': 0, 'athletes': set()}
                    pain_by_region[region]['count'] += 1
                    pain_by_region[region]['total_level'] += pain.get('pain_level', 0)
                    pain_by_region[region]['athletes'].add(session['athlete_id'])
            
            # Convert to serializable format
            data["pain_summary"] = {
                region: {
                    'count': info['count'],
                    'avg_level': round(info['total_level'] / info['count'], 1) if info['count'] > 0 else 0,
                    'athletes_affected': len(info['athletes'])
                }
                for region, info in pain_by_region.items()
            }
    
    # Compliance data
    if request.include_compliance:
        days_in_range = (datetime.strptime(end_date, '%Y-%m-%d') - datetime.strptime(start_date, '%Y-%m-%d')).days + 1
        for athlete in athletes:
            checkins = sum(1 for r in data["readiness"] if r['athlete_id'] == athlete['id'])
            data["compliance"][athlete['id']] = {
                'name': athlete['name'],
                'team': athlete['team'],
                'checkins': checkins,
                'expected': days_in_range,
                'rate': round((checkins / days_in_range) * 100, 1) if days_in_range > 0 else 0
            }
    
    # Generate export based on format
    if request.format == ExportFormatEnum.CSV:
        return await generate_team_csv(data, start_date, end_date, request.team)
    else:
        return await generate_team_pdf(data, start_date, end_date, request.team, request.event_id)

async def generate_team_csv(data: dict, start_date: str, end_date: str, team_filter: Optional[str]):
    """Generate CSV export for team data"""
    output = io.StringIO()
    
    team_name = "All Teams" if not team_filter else ("Men's Team" if team_filter == "men" else "Women's Team")
    
    # Write header
    output.write(f"# Team Export Report\n")
    output.write(f"# Team: {team_name}\n")
    output.write(f"# Period: {start_date} to {end_date}\n")
    output.write(f"# Athletes: {len(data['athletes'])}\n")
    output.write(f"# Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
    
    # Athlete Summary
    output.write("## ATHLETE ROSTER\n")
    output.write("Name,Team,Email\n")
    for a in data["athletes"]:
        output.write(f"{a['name']},{a['team']},{a['email']}\n")
    output.write("\n")
    
    # Readiness Data
    if data["readiness"]:
        output.write("## DAILY READINESS (All Athletes)\n")
        headers = "Date,Athlete,Team,Sleep Quality,Morning Fatigue,Muscle Soreness,Stress,Readiness Score\n"
        output.write(headers)
        for r in sorted(data["readiness"], key=lambda x: (x['date'], x['athlete_name']), reverse=True):
            row = f"{r.get('date', '')},{r.get('athlete_name', '')},{r.get('team', '')},{r.get('sleep_quality', '')},{r.get('morning_fatigue', '')},{r.get('muscle_soreness', '')},{r.get('stress', '')},{r.get('readiness_score', '')}\n"
            output.write(row)
        output.write("\n")
    
    # Training Sessions
    if data["sessions"]:
        output.write("## TRAINING SESSIONS (All Athletes)\n")
        headers = "Date,Athlete,Team,Session Type,Duration (min),RPE,Internal Load,Pain After\n"
        output.write(headers)
        for s in sorted(data["sessions"], key=lambda x: x['date_time_start'], reverse=True):
            row = f"{s.get('date_time_start', '')[:10]},{s.get('athlete_name', '')},{s.get('team', '')},{s.get('session_type', '')},{s.get('duration_min', '')},{s.get('rpe', '')},{s.get('internal_load', '')},{s.get('pain_after', '')}\n"
            output.write(row)
        output.write("\n")
    
    # Pain Summary
    if data["pain_summary"]:
        output.write("## PAIN SUMMARY BY BODY REGION\n")
        output.write("Body Region,Reports,Avg Pain Level,Athletes Affected\n")
        for region, info in sorted(data["pain_summary"].items(), key=lambda x: x[1]['count'], reverse=True):
            output.write(f"{region},{info['count']},{info['avg_level']},{info['athletes_affected']}\n")
        output.write("\n")
    
    # Compliance
    if data["compliance"]:
        output.write("## COMPLIANCE SUMMARY\n")
        output.write("Athlete,Team,Check-ins,Expected,Compliance Rate (%)\n")
        for athlete_id, info in sorted(data["compliance"].items(), key=lambda x: x[1]['rate'], reverse=True):
            output.write(f"{info['name']},{info['team']},{info['checkins']},{info['expected']},{info['rate']}\n")
    
    csv_content = output.getvalue()
    filename = f"team_export_{team_filter or 'all'}_{start_date}_{end_date}.csv"
    
    return StreamingResponse(
        io.BytesIO(csv_content.encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

async def generate_team_pdf(data: dict, start_date: str, end_date: str, team_filter: Optional[str], event_id: Optional[str]):
    """Generate visual PDF export for team data - STABLE VERSION"""
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=0.6*inch, leftMargin=0.6*inch, 
                               topMargin=0.6*inch, bottomMargin=0.6*inch)
        story = []
        styles = get_styles()
        
        team_name = "All Teams" if not team_filter else ("Men's Team" if team_filter == "men" else "Women's Team")
        
        # Get event name if applicable
        event_name = None
        if event_id:
            event = await db.events.find_one({"id": event_id}, {"_id": 0})
            if event:
                event_name = event.get('name')
        
        date_range_text = f"{start_date} to {end_date}"
        if event_name:
            date_range_text = f"{event_name} ({start_date} - {end_date})"
        
        generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        
        # === COVER PAGE ===
        create_cover_page(
            story, styles,
            title="Team Performance Report",
            subtitle=team_name,
            date_range=date_range_text,
            generated_at=generated_at
        )
        
        # === KEY METRICS SUMMARY ===
        athletes = data.get("athletes", [])
        sessions = data.get("sessions", [])
        readiness_list = data.get("readiness", [])
        compliance = data.get("compliance", {})
        pain_summary = data.get("pain_summary", {})
        
        total_sessions = len(sessions)
        total_load = sum(s.get('internal_load', 0) for s in sessions)
        avg_readiness = sum(r.get('readiness_score', 0) for r in readiness_list) / len(readiness_list) if readiness_list else 0
        avg_compliance = sum(c['rate'] for c in compliance.values()) / len(compliance) if compliance else 0
        total_pain = sum(info['count'] for info in pain_summary.values()) if pain_summary else 0
        
        metrics = {
            "Athletes": str(len(athletes)),
            "Sessions": str(total_sessions),
            "Total Load": f"{total_load:,}",
            "Readiness": f"{avg_readiness:.1f}",
            "Compliance": f"{avg_compliance:.0f}%",
        }
        
        create_key_metrics_section(story, styles, metrics)
        
        # === TEAM READINESS ===
        if readiness_list:
            story.append(Paragraph("Team Readiness Trend", styles['SectionTitle']))
            
            try:
                readiness_chart = create_readiness_trend_chart(readiness_list)
                low_count = sum(1 for r in readiness_list if r.get('readiness_score', 10) < 5)
                add_chart_with_caption(
                    story, styles, readiness_chart,
                    f"Team readiness over time. Average: {avg_readiness:.1f} | Low instances: {low_count}",
                    None,
                    width=6*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Readiness chart unavailable", styles['ChartCaption']))
        
        # === WORKLOAD ===
        if sessions:
            story.append(Paragraph("Team Workload", styles['SectionTitle']))
            
            try:
                workload_chart = create_workload_bar_chart(sessions)
                avg_per_session = total_load / total_sessions if total_sessions > 0 else 0
                add_chart_with_caption(
                    story, styles, workload_chart,
                    f"Daily training load. Total: {total_load:,} AU | Avg/session: {avg_per_session:.0f} AU",
                    None,
                    width=6*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Workload chart unavailable", styles['ChartCaption']))
            
            # Top athletes table
            story.append(Paragraph("Top Athletes by Load", styles['SectionTitle']))
            athlete_loads = {}
            for s in sessions:
                aid = s.get('athlete_id', '')
                if aid not in athlete_loads:
                    athlete_loads[aid] = {'name': s.get('athlete_name', 'Unknown'), 'load': 0, 'sessions': 0}
                athlete_loads[aid]['load'] += s.get('internal_load', 0)
                athlete_loads[aid]['sessions'] += 1
            
            top_athletes = sorted(athlete_loads.items(), key=lambda x: x[1]['load'], reverse=True)[:5]
            load_table_data = []
            for aid, info in top_athletes:
                avg = info['load'] / info['sessions'] if info['sessions'] > 0 else 0
                load_table_data.append([info['name'][:15], f"{info['load']:,}", f"{avg:.0f}"])
            
            create_simple_table(story, styles, ["Athlete", "Total Load", "Avg"], load_table_data)
        
        story.append(PageBreak())
        
        # === PAIN ANALYSIS ===
        if pain_summary:
            story.append(Paragraph("Pain Analysis", styles['SectionTitle']))
            
            try:
                pain_chart = create_pain_heatmap(pain_summary)
                most_affected = max(pain_summary.items(), key=lambda x: x[1]['count'])[0] if pain_summary else "N/A"
                add_chart_with_caption(
                    story, styles, pain_chart,
                    f"Pain by body region. Most affected: {most_affected} | Total: {total_pain} reports",
                    None,
                    width=5*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Pain chart unavailable", styles['ChartCaption']))
        
        # === COMPLIANCE ===
        if compliance:
            story.append(Paragraph("Compliance Overview", styles['SectionTitle']))
            
            try:
                compliance_chart = create_compliance_chart(compliance)
                good_count = sum(1 for c in compliance.values() if c['rate'] >= 80)
                add_chart_with_caption(
                    story, styles, compliance_chart,
                    f"Check-in compliance. {good_count} athletes above 80% target",
                    None,
                    width=5*inch, height=2.2*inch
                )
            except Exception as e:
                story.append(Paragraph("Compliance chart unavailable", styles['ChartCaption']))
        
        # === FOOTER ===
        story.append(Spacer(1, 0.3*inch))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e2e8f0')))
        story.append(Spacer(1, 0.1*inch))
        story.append(Paragraph(
            f"Generated: {generated_at} | Brazil Lacrosse",
            styles['Footer']
        ))
        
        doc.build(story)
        buffer.seek(0)
        
        filename = f"team_report_{team_filter or 'all'}_{start_date}_{end_date}.pdf"
        
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logging.error(f"Team PDF generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

# ==================== CMJ (COUNTER MOVEMENT JUMP) MODULE ====================

def calculate_cmj_metrics(trial_1: float, trial_2: float, trial_3: float, baseline_height: Optional[float] = None) -> dict:
    """Calculate CMJ session metrics from 3 trials"""
    trials = [trial_1, trial_2, trial_3]
    cmj_best = max(trials)
    cmj_mean = sum(trials) / 3
    
    # CV% = (SD / Mean) * 100
    std_dev = np.std(trials, ddof=0)  # Population std dev for 3 trials
    cv_percent = (std_dev / cmj_mean) * 100 if cmj_mean > 0 else 0
    
    # Delta vs baseline
    delta_best_percent = None
    delta_mean_percent = None
    if baseline_height and baseline_height > 0:
        delta_best_percent = ((cmj_best - baseline_height) / baseline_height) * 100
        delta_mean_percent = ((cmj_mean - baseline_height) / baseline_height) * 100
    
    return {
        "cmj_best": round(cmj_best, 1),
        "cmj_mean": round(cmj_mean, 1),
        "cv_percent": round(cv_percent, 1),
        "delta_best_percent": round(delta_best_percent, 1) if delta_best_percent is not None else None,
        "delta_mean_percent": round(delta_mean_percent, 1) if delta_mean_percent is not None else None
    }

def calculate_typical_error(session_means: List[float]) -> Optional[float]:
    """Calculate individual Typical Error from repeated session means
    
    TE is estimated as the standard deviation of differences between consecutive sessions
    divided by sqrt(2). Requires at least 3 sessions.
    """
    if len(session_means) < 3:
        return None
    
    # Calculate differences between consecutive sessions
    differences = [session_means[i+1] - session_means[i] for i in range(len(session_means) - 1)]
    
    if len(differences) < 2:
        return None
    
    # TE = SD of differences / sqrt(2)
    sd_diff = np.std(differences, ddof=1)
    te = sd_diff / np.sqrt(2)
    
    return round(te, 2) if te > 0 else None

# CMJ Baseline Endpoints
@api_router.get("/cmj/athlete/{athlete_id}/baseline")
async def get_cmj_baseline(athlete_id: str, current_user: dict = Depends(get_current_user)):
    """Get athlete's CMJ baseline"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    return {"baseline": baseline}

@api_router.post("/cmj/athlete/{athlete_id}/baseline")
async def set_cmj_baseline(athlete_id: str, data: CMJBaselineCreate, current_user: dict = Depends(get_current_user)):
    """Create or update athlete's CMJ baseline"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Check athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    # Check if baseline exists
    existing = await db.cmj_baselines.find_one({"athlete_id": athlete_id})
    
    if existing:
        # Update existing baseline
        await db.cmj_baselines.update_one(
            {"athlete_id": athlete_id},
            {"$set": {
                "date": data.date,
                "jump_height_cm": data.jump_height_cm,
                "arms_used": data.arms_used,
                "footwear": data.footwear,
                "notes": data.notes,
                "recorded_by": current_user['user']['id'],
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        return {"message": "Baseline atualizado com sucesso"}
    else:
        # Create new baseline
        baseline = CMJBaseline(
            athlete_id=athlete_id,
            date=data.date,
            jump_height_cm=data.jump_height_cm,
            arms_used=data.arms_used,
            footwear=data.footwear,
            notes=data.notes,
            recorded_by=current_user['user']['id']
        )
        await db.cmj_baselines.insert_one(baseline.model_dump())
        return {"message": "Baseline created successfully", "baseline": baseline.model_dump()}

# CMJ Test Endpoints
@api_router.get("/cmj/athlete/{athlete_id}/tests")
async def get_cmj_tests(
    athlete_id: str, 
    context: Optional[str] = None,
    event_id: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get athlete's CMJ test history"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    query = {"athlete_id": athlete_id}
    if context:
        query["context"] = context
    if event_id:
        query["event_id"] = event_id
    
    tests = await db.cmj_tests.find(query, {"_id": 0}).sort("date", -1).to_list(limit)
    
    # Get baseline for reference
    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    
    # Calculate typical error if enough data
    session_means = [t['cmj_mean'] for t in tests if t.get('cmj_mean')]
    typical_error = calculate_typical_error(session_means[-8:])  # Use last 8 sessions
    
    return {
        "tests": tests,
        "baseline": baseline,
        "typical_error": typical_error,
        "total_tests": len(tests)
    }

@api_router.post("/cmj/athlete/{athlete_id}/test")
async def create_cmj_test(athlete_id: str, data: CMJTestCreate, current_user: dict = Depends(get_current_user)):
    """Record a new CMJ test for an athlete"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Check athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
    
    # Get baseline for delta calculations
    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    baseline_height = baseline.get('jump_height_cm') if baseline else None
    
    # Calculate metrics
    metrics = calculate_cmj_metrics(data.trial_1, data.trial_2, data.trial_3, baseline_height)
    
    # Create test record
    test = CMJTest(
        athlete_id=athlete_id,
        date=data.date,
        context=data.context,
        event_id=data.event_id,
        arms_used=data.arms_used,
        trials=CMJTrials(trial_1=data.trial_1, trial_2=data.trial_2, trial_3=data.trial_3),
        cmj_best=metrics['cmj_best'],
        cmj_mean=metrics['cmj_mean'],
        cv_percent=metrics['cv_percent'],
        delta_best_percent=metrics['delta_best_percent'],
        delta_mean_percent=metrics['delta_mean_percent'],
        time_of_day=data.time_of_day,
        notes=data.notes,
        recorded_by=current_user['user']['id']
    )
    
    await db.cmj_tests.insert_one(test.model_dump())
    
    return {"message": "Teste CMJ registrado com sucesso", "test": test.model_dump()}

# CMJ Batch Testing (Evaluation Day)
@api_router.post("/cmj/batch")
async def create_cmj_batch_tests(data: CMJBatchTestCreate, current_user: dict = Depends(get_current_user)):
    """Batch record CMJ tests for multiple athletes (Evaluation Day workflow)"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    results = []
    errors = []
    
    for test_data in data.tests:
        athlete_id = test_data.get('athlete_id')
        if not athlete_id:
            continue
        
        try:
            # Get baseline
            baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
            baseline_height = baseline.get('jump_height_cm') if baseline else None
            
            # Calculate metrics
            metrics = calculate_cmj_metrics(
                test_data.get('trial_1', 0),
                test_data.get('trial_2', 0),
                test_data.get('trial_3', 0),
                baseline_height
            )
            
            # Create test record
            test = CMJTest(
                athlete_id=athlete_id,
                date=data.date,
                context=data.context,
                event_id=data.event_id,
                arms_used=data.arms_used,
                trials=CMJTrials(
                    trial_1=test_data.get('trial_1', 0),
                    trial_2=test_data.get('trial_2', 0),
                    trial_3=test_data.get('trial_3', 0)
                ),
                cmj_best=metrics['cmj_best'],
                cmj_mean=metrics['cmj_mean'],
                cv_percent=metrics['cv_percent'],
                delta_best_percent=metrics['delta_best_percent'],
                delta_mean_percent=metrics['delta_mean_percent'],
                recorded_by=current_user['user']['id']
            )
            
            await db.cmj_tests.insert_one(test.model_dump())
            results.append({"athlete_id": athlete_id, "status": "success", "test_id": test.id})
        except Exception as e:
            errors.append({"athlete_id": athlete_id, "error": str(e)})
    
    return {
        "message": f"Batch CMJ tests completed: {len(results)} successful, {len(errors)} errors",
        "results": results,
        "errors": errors
    }

# CMJ Analytics
@api_router.get("/cmj/athlete/{athlete_id}/analytics")
async def get_cmj_analytics(athlete_id: str, current_user: dict = Depends(get_current_user)):
    """Get CMJ analytics for an athlete including trends and thresholds"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Get baseline
    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    
    # Get all tests
    tests = await db.cmj_tests.find(
        {"athlete_id": athlete_id}, 
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    
    if not tests:
        return {
            "baseline": baseline,
            "tests": [],
            "typical_error": None,
            "thresholds": None,
            "latest_status": None,
            "has_data": False
        }
    
    # Calculate typical error from last 8 sessions
    session_means = [t['cmj_mean'] for t in tests if t.get('cmj_mean')]
    typical_error = calculate_typical_error(session_means[:8])  # Most recent 8
    
    # Calculate thresholds if TE available
    thresholds = None
    if typical_error and baseline:
        baseline_height = baseline.get('jump_height_cm', 0)
        thresholds = {
            "yellow_threshold": round(baseline_height - typical_error, 1),
            "red_threshold": round(baseline_height - (2 * typical_error), 1),
            "typical_error": typical_error
        }
    
    # Analyze latest test
    latest_status = None
    if tests and baseline and thresholds:
        latest = tests[0]
        latest_mean = latest.get('cmj_mean', 0)
        baseline_height = baseline.get('jump_height_cm', 0)
        
        if latest_mean < thresholds['red_threshold']:
            latest_status = {
                "level": "red",
                "message": "CMJ significantly below baseline (>2x TE drop)",
                "recommendation": "Consider load reduction and further assessment"
            }
        elif latest_mean < thresholds['yellow_threshold']:
            latest_status = {
                "level": "yellow",
                "message": "CMJ below baseline (>1x TE drop)",
                "recommendation": "Monitor closely, consider training modification"
            }
        else:
            latest_status = {
                "level": "green",
                "message": "CMJ within normal range",
                "recommendation": "Continue normal training"
            }
    
    # Average CV% for data quality assessment
    cv_values = [t.get('cv_percent', 0) for t in tests if t.get('cv_percent')]
    avg_cv = sum(cv_values) / len(cv_values) if cv_values else 0
    
    return {
        "baseline": baseline,
        "tests": tests[:20],  # Return last 20 tests
        "typical_error": typical_error,
        "thresholds": thresholds,
        "latest_status": latest_status,
        "average_cv": round(avg_cv, 1),
        "total_tests": len(tests),
        "has_data": True
    }

# CMJ Team Overview
@api_router.get("/cmj/team")
async def get_cmj_team_overview(
    team: Optional[str] = None,
    event_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get CMJ overview for team (for dashboard integration)"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Acesso restrito a profissionais")
    
    # Build athlete query
    athlete_query = {"status": "approved"}
    if team and team != "all":
        team_value = TeamEnum.MEN.value if team == "men" else TeamEnum.WOMEN.value
        athlete_query["team"] = team_value
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(1000)
    athlete_ids = [a['id'] for a in athletes]
    
    # Get recent CMJ tests
    test_query = {"athlete_id": {"$in": athlete_ids}}
    if event_id:
        test_query["event_id"] = event_id
    
    tests = await db.cmj_tests.find(test_query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Get baselines
    baselines = await db.cmj_baselines.find({"athlete_id": {"$in": athlete_ids}}, {"_id": 0}).to_list(1000)
    baseline_map = {b['athlete_id']: b for b in baselines}
    
    # Build athlete summary
    athlete_summary = []
    for athlete in athletes:
        athlete_tests = [t for t in tests if t['athlete_id'] == athlete['id']]
        athlete_baseline = baseline_map.get(athlete['id'])
        
        latest_test = athlete_tests[0] if athlete_tests else None
        
        summary = {
            "athlete_id": athlete['id'],
            "name": athlete['name'],
            "team": athlete['team'],
            "has_baseline": athlete_baseline is not None,
            "baseline_height": athlete_baseline.get('jump_height_cm') if athlete_baseline else None,
            "total_tests": len(athlete_tests),
            "latest_test": latest_test,
            "status": "no_data"
        }
        
        # Calculate status
        if latest_test and athlete_baseline:
            delta = latest_test.get('delta_mean_percent', 0)
            if delta is not None:
                if delta < -10:
                    summary["status"] = "red"
                elif delta < -5:
                    summary["status"] = "yellow"
                else:
                    summary["status"] = "green"
        
        athlete_summary.append(summary)
    
    return {
        "athletes": athlete_summary,
        "total_athletes": len(athletes),
        "with_baseline": sum(1 for a in athlete_summary if a['has_baseline']),
        "with_recent_tests": sum(1 for a in athlete_summary if a['total_tests'] > 0)
    }

# CMJ Info/Explanations
@api_router.get("/cmj/info")
async def get_cmj_info():
    """Get evidence-based explanations for CMJ metrics"""
    return {
        "cmj_overview": {
            "title": "Counter Movement Jump (CMJ)",
            "description": "CMJ is an objective measure of lower-body neuromuscular function. Changes in jump performance can indicate accumulated fatigue, incomplete recovery, or readiness to train.",
            "reference": "Claudino et al., 2017; Taylor et al., 2012"
        },
        "three_trials": {
            "title": "Why 3 Trials?",
            "description": "Three trials balance reliability with practical time constraints. This allows calculation of both best performance and within-session consistency (CV%).",
            "reference": "Cormack et al., 2008"
        },
        "best_vs_mean": {
            "title": "Best vs Mean",
            "description": "CMJ Best reflects peak neuromuscular capacity. CMJ Mean is more stable and preferred for monitoring fatigue over time as it reduces the influence of single outlier jumps.",
            "reference": "Gathercole et al., 2015"
        },
        "cv_percent": {
            "title": "Coefficient of Variation (CV%)",
            "description": "CV% indicates within-session consistency. High CV% (>10%) may suggest poor focus, technique issues, or fatigue affecting motor control. Individual CV% norms vary.",
            "interpretation": {
                "good": "CV% < 5%: Excellent consistency",
                "acceptable": "CV% 5-10%: Normal variation",
                "flag": "CV% > 10%: Review technique or consider fatigue"
            }
        },
        "typical_error": {
            "title": "Typical Error (TE)",
            "description": "TE represents the normal day-to-day variation for an individual athlete. Changes exceeding 1x TE warrant attention; changes exceeding 2x TE are likely meaningful.",
            "reference": "Hopkins, 2000",
            "note": "Requires at least 3 prior tests to calculate individual TE"
        },
        "interpretation_note": {
            "title": "Important Note",
            "description": "CMJ data should be interpreted alongside readiness scores, pain reports, training load, and athlete feedback. No single metric should drive decisions in isolation.",
            "type": "warning"
        }
    }

# Get export options (events list for frontend)
@api_router.get("/export/options")
async def get_export_options(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get available options for export (events, teams, etc.)
    
    Event visibility follows the same rules as the events endpoint:
    - When team="men": Show events with team="Brazil Lacrosse Men" OR team=None
    - When team="women": Show events with team="Brazil Lacrosse Women" OR team=None
    - When team=None or "all": Show all events
    """
    if current_user['user_type'] == 'athlete':
        raise HTTPException(status_code=403, detail="Only staff can access export options")
    
    # Build event query based on team filter
    event_query = {}
    if team and team != "all":
        # Map short team name to full enum value
        team_value = TeamEnum.MEN.value if team == "men" else TeamEnum.WOMEN.value
        event_query["$or"] = [
            {"team": team_value},
            {"team": None},
            {"team": {"$exists": False}}
        ]
    
    # Get events
    events = await db.events.find(event_query, {"_id": 0}).sort("start_date", -1).to_list(100)
    
    # Add team scope label to each event for UI clarity
    for event in events:
        if event.get('team') == TeamEnum.MEN.value:
            event['scope_label'] = "Men's Team"
        elif event.get('team') == TeamEnum.WOMEN.value:
            event['scope_label'] = "Women's Team"
        else:
            event['scope_label'] = "All Athletes"
    
    # Get athlete counts by team
    men_count = await db.athletes.count_documents({"team": TeamEnum.MEN.value, "status": "approved"})
    women_count = await db.athletes.count_documents({"team": TeamEnum.WOMEN.value, "status": "approved"})
    
    return {
        "events": events,
        "teams": [
            {"value": "all", "label": "All Teams", "count": men_count + women_count},
            {"value": "men", "label": "Men's Team", "count": men_count},
            {"value": "women", "label": "Women's Team", "count": women_count}
        ],
        "formats": [
            {"value": "csv", "label": "CSV (Spreadsheet)", "description": "For data analysis and spreadsheets"},
            {"value": "pdf", "label": "PDF (Report)", "description": "For sharing and documentation"}
        ]
    }

# Health check
@api_router.get("/")
async def root():
    return {"message": "Brazil Lacrosse API", "status": "healthy"}

# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

@app.on_event("startup")
async def seed_admin_user():
    """Seed the predefined admin user on startup if it doesn't exist"""
    existing_admin = await db.staff_users.find_one({"email": ADMIN_EMAIL})
    if not existing_admin:
        admin_user = StaffUser(
            name="Admin",
            email=ADMIN_EMAIL,
            role=StaffRoleEnum.ADMIN,
            team=None,  # Admin can see all teams
            active=True
        )
        doc = admin_user.model_dump()
        doc['password_hash'] = hash_password(ADMIN_INITIAL_PASSWORD)
        await db.staff_users.insert_one(doc)
        logger.info(f"Admin user seeded: {ADMIN_EMAIL}")
    else:
        # Ensure the admin user has the Admin role
        if existing_admin.get('role') != 'Admin':
            await db.staff_users.update_one(
                {"email": ADMIN_EMAIL},
                {"$set": {"role": "Admin"}}
            )
            logger.info(f"Admin role restored for: {ADMIN_EMAIL}")
