from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, model_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from app_time import local_now
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
from alerts_util import create_severe_pain_alerts
from recovery_storage import (
    put_object as _store_put_object,
    get_object as _store_get_object,
    make_lowres as _store_make_lowres,
    make_screenshot as _store_make_screenshot,
)

from pdf_export_service import (
    create_readiness_trend_chart,
    create_radar_chart,
    create_workload_bar_chart,
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
app = FastAPI(title="Brazil Lacrosse Athlete Monitoring")

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

# Enums
class TeamEnum(str, Enum):
    MEN = "Brazil Lacrosse Men"
    WOMEN = "Brazil Lacrosse Women"

class StaffRoleEnum(str, Enum):
    ADMIN = "Admin"
    COACH = "Coach"
    PHYSIO = "Physio"
    RESEARCH = "Research"

# Public roles that can be selected during registration (Admin is NOT included)
PUBLIC_STAFF_ROLES = ["Coach", "Physio", "Research"]

# Admin configuration - single predefined admin
ADMIN_EMAIL = "pataradaniel@gmail.com"
ADMIN_INITIAL_PASSWORD = os.environ.get('ADMIN_INITIAL_PASSWORD', '123456')

class SessionTypeEnum(str, Enum):
    STRENGTH = "Strength"
    CONDITIONING = "Conditioning"
    TECHNICAL = "Technical"
    TACTICAL = "Tactical"
    MATCH = "Match"
    REHAB = "Rehab"
    RECOVERY = "Recovery"
    OTHER = "Other"

class BodyRegionEnum(str, Enum):
    NECK = "Neck"
    SHOULDER = "Shoulder"
    ELBOW = "Elbow"
    WRIST_HAND = "WristHand"
    LOW_BACK = "LowBack"
    HIP_GROIN = "HipGroin"
    KNEE = "Knee"
    ANKLE_FOOT = "AnkleFoot"
    OTHER = "Other"

class LateralityEnum(str, Enum):
    LEFT = "Left"
    RIGHT = "Right"
    BOTH = "Both"
    NA = "N/A"  # For regions like Lower Back that don't have laterality

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
    NONE = "None"
    SPOTTING = "Spotting"
    LIGHT = "Light"
    MODERATE = "Moderate"
    HEAVY = "Heavy"

class MenstrualPainEnum(str, Enum):
    NONE = "None"
    MILD = "Mild"
    MODERATE = "Moderate"
    SEVERE = "Severe"
    VERY_SEVERE = "Very Severe"

# Analysis Context Enums
class AnalysisContextEnum(str, Enum):
    SEASON = "season"
    EVENT = "event"

class EventTypeEnum(str, Enum):
    TRAINING_CAMP = "training_camp"
    TOURNAMENT = "tournament"
    OTHER = "other"

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
    team: TeamEnum
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
    status: str = "approved"  # approved | pending | rejected (new self-registrations start pending)
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
# Pain Report Item for multiple pain locations (shared by sessions, readiness & recovery)
class PainReportItem(BaseModel):
    body_region: BodyRegionEnum
    laterality: Optional[LateralityEnum] = None
    pain_level: int = Field(ge=0, le=10, default=5)
    # Required free-text when body_region == "Other" (what/where exactly).
    region_note: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _require_other_note(self):
        if self.body_region == BodyRegionEnum.OTHER and not (self.region_note and self.region_note.strip()):
            raise ValueError('Please describe the "Other" pain location.')
        if self.region_note:
            self.region_note = self.region_note.strip()[:200]
        return self


def _pr_region(pr: dict):
    """Display label for a pain-report dict — expands 'Other' with the athlete's
    free-text so it reads e.g. 'Other — Jaw' on every staff/dashboard screen."""
    region = pr.get("body_region")
    note = pr.get("region_note")
    if region == "Other" and note and str(note).strip():
        return f"Other — {str(note).strip()}"
    return region

class DailyReadinessCreate(BaseModel):
    sleep_quality: int = Field(ge=0, le=10)
    morning_fatigue: int = Field(ge=0, le=10)
    muscle_soreness: int = Field(ge=0, le=10)
    stress: int = Field(ge=0, le=10)
    readiness: int = Field(ge=0, le=10)
    notes: Optional[str] = None
    # Optional pain report (same structure as Post Training Log)
    pain_reports: Optional[List[PainReportItem]] = None
    # Menstrual cycle fields (for female athletes)
    is_menstruating: Optional[bool] = None
    menstrual_flow: Optional[MenstrualFlowEnum] = None
    menstrual_pain: Optional[MenstrualPainEnum] = None
    menstrual_symptoms: Optional[List[str]] = None  # cramps, low_back_pain, abdominal_pain, headache, breast_tenderness
    # Optional hydration self-check (urine color 1..8)
    hydration_level: Optional[int] = Field(default=None, ge=1, le=8)
    # Optional device screenshot (Whoop/Garmin/Apple Health etc.), id from /device-screenshot
    screenshot_id: Optional[str] = None

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

# Training Session (Post Training Log)
class TrainingSessionCreate(BaseModel):
    date_time_start: str
    session_type: str = Field(min_length=1, max_length=80)
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
    # Optional session photo (stored low-res); id returned by /sessions/photo
    photo_id: Optional[str] = None

class TrainingSession(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    athlete_id: str
    date_time_start: str
    session_type: str
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
    photo_id: Optional[str] = None
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
            raise HTTPException(status_code=401, detail="User not found")
        
        # Staff access control: block revoked/rejected/pending accounts even if they hold a token
        if user_type == "staff":
            if not user.get('active', True):
                raise HTTPException(status_code=403, detail="Your staff access has been revoked. Please contact an administrator.")
            staff_status = user.get('status', 'approved')
            if staff_status == 'rejected':
                raise HTTPException(status_code=403, detail="Your staff registration was not approved.")
            if staff_status == 'pending':
                raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
        
        return {"user": user, "user_type": user_type}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Auth routes
@api_router.post("/auth/register/athlete", response_model=dict)
async def register_athlete(data: AthleteCreate):
    existing = await db.athletes.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    athlete_dict = data.model_dump()
    password = athlete_dict.pop('password')
    athlete = Athlete(**athlete_dict)
    athlete.status = AthleteStatusEnum.PENDING  # New athletes are pending approval
    
    doc = athlete.model_dump()
    doc['password_hash'] = hash_password(password)
    
    await db.athletes.insert_one(doc)
    
    # Don't return token for pending athletes - they can't login yet
    return {
        "success": True, 
        "message": "Registration submitted! Please wait for admin approval.",
        "status": "pending"
    }

@api_router.post("/auth/register/staff", response_model=dict)
async def register_staff(data: StaffUserCreate):
    # Prevent registration with Admin role
    if data.role == StaffRoleEnum.ADMIN:
        raise HTTPException(status_code=403, detail="Admin role cannot be registered. Contact system administrator.")
    
    # Ensure team is provided for non-admin staff
    if not data.team:
        raise HTTPException(status_code=400, detail="Team selection is required for staff registration")
    
    existing = await db.staff_users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    staff_dict = data.model_dump()
    password = staff_dict.pop('password')
    staff = StaffUser(**staff_dict)
    
    doc = staff.model_dump()
    doc['status'] = 'pending'  # New staff must be approved by an Admin before they can log in
    doc['active'] = True
    doc['password_hash'] = hash_password(password)
    
    await db.staff_users.insert_one(doc)
    
    # No token returned: the account is pending admin approval
    return {
        "status": "pending",
        "user_type": "staff",
        "message": "Your staff account was created and is pending administrator approval. You'll be able to log in once approved."
    }

@api_router.post("/auth/login", response_model=dict)
async def login(data: LoginRequest):
    # Check athletes first
    athlete = await db.athletes.find_one({"email": data.email}, {"_id": 0})
    if athlete:
        stored_hash = athlete.get('password_hash', '')
        if stored_hash and verify_password(data.password, stored_hash):
            # Check if athlete is approved
            status = athlete.get('status', 'approved')  # Default approved for legacy data
            if status == 'pending':
                raise HTTPException(status_code=403, detail="Your account is pending approval. Please wait for admin confirmation.")
            if status == 'rejected':
                raise HTTPException(status_code=403, detail="Your registration was not approved. Please contact the team administrator.")
            
            user_data = {k: v for k, v in athlete.items() if k != 'password_hash'}
            token = create_token(athlete['id'], "athlete")
            return {"token": token, "user_type": "athlete", "user": user_data}
    
    # Check staff
    staff = await db.staff_users.find_one({"email": data.email}, {"_id": 0})
    if staff:
        stored_hash = staff.get('password_hash', '')
        if stored_hash and verify_password(data.password, stored_hash):
            # Approval / access-control checks (legacy staff default to approved + active)
            staff_status = staff.get('status', 'approved')
            if staff_status == 'pending':
                raise HTTPException(status_code=403, detail="Your account is pending approval. Please wait for admin confirmation.")
            if staff_status == 'rejected':
                raise HTTPException(status_code=403, detail="Your registration was not approved. Please contact an administrator.")
            if not staff.get('active', True):
                raise HTTPException(status_code=403, detail="Your access has been revoked. Please contact an administrator.")
            
            user_data = {k: v for k, v in staff.items() if k != 'password_hash'}
            token = create_token(staff['id'], "staff")
            return {"token": token, "user_type": "staff", "user": user_data}
    
    raise HTTPException(status_code=401, detail="Invalid credentials")

@api_router.get("/auth/public-staff-roles")
async def get_public_staff_roles():
    """Get list of staff roles available for public registration"""
    return {"roles": PUBLIC_STAFF_ROLES, "teams": [e.value for e in TeamEnum]}

# Profile Photo Upload (persisted in object storage (MongoDB GridFS) so it survives
# container restarts and works across multiple production replicas)
from recovery_storage import put_object as _put_profile_object, get_object as _get_profile_object, APP_NAME as _STORAGE_APP  # noqa: E402

_PROFILE_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_PROFILE_EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}


async def _store_profile_photo(file: UploadFile, contents: bytes) -> str:
    """Upload a profile photo to object storage and return its served URL."""
    file_id = str(uuid.uuid4())
    ext = _PROFILE_EXT_BY_TYPE.get(file.content_type, "jpg")
    content_type = file.content_type or "image/jpeg"
    storage_path = f"{_STORAGE_APP}/profiles/{file_id}.{ext}"
    try:
        await _put_profile_object(storage_path, contents, content_type)
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to upload photo. Please try again.")
    await db.profile_files.insert_one({
        "id": file_id,
        "storage_path": storage_path,
        "content_type": content_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return f"/api/profile-photo/{file_id}"


@api_router.post("/upload/profile-photo")
async def upload_profile_photo(file: UploadFile = File(...)):
    """Upload a profile photo and return the URL"""
    if file.content_type not in _PROFILE_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size too large. Maximum size is 5MB.")
    photo_url = await _store_profile_photo(file, contents)
    return {"url": photo_url, "filename": photo_url.rsplit("/", 1)[-1]}


@api_router.put("/profile/photo")
async def update_profile_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Update profile photo for authenticated user"""
    if file.content_type not in _PROFILE_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size too large. Maximum size is 5MB.")
    photo_url = await _store_profile_photo(file, contents)

    user_type = current_user['user_type']
    user_id = current_user['user']['id']
    if user_type == 'athlete':
        await db.athletes.update_one({"id": user_id}, {"$set": {"profile_photo": photo_url}})
    else:
        await db.staff_users.update_one({"id": user_id}, {"$set": {"profile_photo": photo_url}})

    return {"url": photo_url, "message": "Profile photo updated successfully"}


@api_router.get("/profile-photo/{file_id}")
async def get_profile_photo(file_id: str):
    """Serve a profile photo from object storage (public read by opaque id)."""
    record = await db.profile_files.find_one({"id": file_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        data, ctype = await _get_profile_object(record["storage_path"])
    except Exception:
        raise HTTPException(status_code=404, detail="Photo not available")
    return Response(
        content=data,
        media_type=record.get("content_type", ctype),
        headers={"Cache-Control": "public, max-age=86400"},
    )

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
        raise HTTPException(status_code=400, detail="No data to update")
    
    if user_type == 'athlete':
        await db.athletes.update_one({"id": user_id}, {"$set": update_data})
    else:
        await db.staff_users.update_one({"id": user_id}, {"$set": update_data})
    
    return {"message": "Profile updated successfully"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


PASSWORD_MIN_LENGTH = 8


@api_router.put("/auth/change-password")
async def change_password(data: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Let the logged-in user (athlete or staff) change their own password."""
    user_type = current_user['user_type']
    user_id = current_user['user']['id']
    collection = db.athletes if user_type == 'athlete' else db.staff_users

    record = await collection.find_one({"id": user_id}, {"_id": 0, "password_hash": 1})
    stored_hash = (record or {}).get('password_hash', '')
    if not stored_hash or not verify_password(data.current_password, stored_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    new_password = data.new_password
    if len(new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"New password must be at least {PASSWORD_MIN_LENGTH} characters")
    if len(new_password.encode('utf-8')) > 72:
        # bcrypt only uses the first 72 bytes; refuse rather than silently truncate.
        raise HTTPException(status_code=400, detail="New password is too long (max 72 characters)")
    if new_password == data.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current one")

    await collection.update_one(
        {"id": user_id},
        {"$set": {
            "password_hash": hash_password(new_password),
            "password_changed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"message": "Password changed successfully"}


@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

# Morning Check-In routes
@api_router.post("/readiness", response_model=dict)
async def create_readiness(data: DailyReadinessCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can submit readiness")
    
    athlete_id = current_user['user']['id']
    athlete_team = current_user['user'].get('team', '')
    today = local_now().strftime("%Y-%m-%d")
    
    # Check if already submitted today
    existing = await db.daily_readiness.find_one({"athlete_id": athlete_id, "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Already submitted today")
    
    # Hard-block if there is a mandatory survey to answer first
    _pending = await pending_mandatory_surveys(db, athlete_id, athlete_team, today)
    if _pending:
        raise HTTPException(status_code=428, detail={
            "code": "survey_required",
            "message": "Please answer the required survey before your check-in.",
            "survey_title": _pending[0].get("title"),
        })
    
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

    # Optional pain report (Morning Check-in)
    if data.pain_reports:
        readiness_data["pain_reports"] = [
            {
                "body_region": pr.body_region.value,
                "laterality": pr.laterality.value if pr.laterality else None,
                "pain_level": pr.pain_level,
                "region_note": (pr.region_note or None),
            }
            for pr in data.pain_reports
        ]

    # Optional hydration self-check (urine color scale 1..8)
    if data.hydration_level is not None:
        readiness_data["hydration_level"] = data.hydration_level

    # Optional device screenshot (Whoop/Garmin/Apple Health, etc.)
    if data.screenshot_id:
        readiness_data["screenshot_id"] = data.screenshot_id

    await db.daily_readiness.insert_one(readiness_data)
    # Auto-create severe pain alerts (Active Alerts) from morning check-in (best-effort)
    if readiness_data.get("pain_reports"):
        try:
            await create_severe_pain_alerts(
                db, athlete_id, readiness_data["pain_reports"], "Morning Check-in", readiness_data.get("date")
            )
        except Exception as e:
            logger.error(f"Failed to create pain alert from morning check-in: {e}")
    # Remove _id if MongoDB added it
    readiness_data.pop('_id', None)
    return readiness_data

@api_router.get("/readiness/history")
async def get_readiness_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can view their history")
    
    athlete_id = current_user['user']['id']
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
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
_TRAINING_PHOTO_APP = "brazil-lacrosse-recovery"
_TRAINING_PHOTO_MAX_BYTES = 15 * 1024 * 1024  # 15 MB raw upload cap (compressed after)


@api_router.post("/sessions/photo")
async def upload_session_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload an optional training-session photo. Stored low-resolution/compressed
    (no original kept) to minimise storage. Returns the photo id."""
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can upload session photos")
    athlete_id = current_user['user']['id']
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
        raise HTTPException(status_code=400, detail="Unsupported image type. Use JPG, PNG, WEBP or HEIC.")
    data = await file.read()
    if len(data) > _TRAINING_PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 15MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    lowres = await _store_make_lowres(data)
    if not lowres:
        raise HTTPException(status_code=400, detail="Could not process image")

    file_id = str(uuid.uuid4())
    storage_path = f"{_TRAINING_PHOTO_APP}/training/{athlete_id}/{file_id}.jpg"
    try:
        result = await _store_put_object(storage_path, lowres, "image/jpeg")
    except Exception:
        logger.exception("Session photo upload failed")
        raise HTTPException(status_code=502, detail="Failed to upload photo. Please try again.")

    await db.training_files.insert_one({
        "id": file_id,
        "athlete_id": athlete_id,
        "storage_path": result.get("path", storage_path),
        "content_type": "image/jpeg",
        "size": len(lowres),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"photo_id": file_id, "url": f"/api/sessions/photo/{file_id}"}


@api_router.post("/device-screenshot")
async def upload_device_screenshot(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload an optional device screenshot (Whoop/Garmin/Apple Health, etc.) attached
    to a morning check-in or training log. Stored at higher quality than session photos
    so numbers/text stay legible. Returns the screenshot id (served via /sessions/photo)."""
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can upload screenshots")
    athlete_id = current_user['user']['id']
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
        raise HTTPException(status_code=400, detail="Unsupported image type. Use JPG, PNG, WEBP or HEIC.")
    data = await file.read()
    if len(data) > _TRAINING_PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 15MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    processed = await _store_make_screenshot(data)
    if not processed:
        raise HTTPException(status_code=400, detail="Could not process image")

    file_id = str(uuid.uuid4())
    storage_path = f"{_TRAINING_PHOTO_APP}/screenshots/{athlete_id}/{file_id}.jpg"
    try:
        result = await _store_put_object(storage_path, processed, "image/jpeg")
    except Exception:
        logger.exception("Device screenshot upload failed")
        raise HTTPException(status_code=502, detail="Failed to upload screenshot. Please try again.")

    await db.training_files.insert_one({
        "id": file_id,
        "athlete_id": athlete_id,
        "storage_path": result.get("path", storage_path),
        "content_type": "image/jpeg",
        "size": len(processed),
        "kind": "device_screenshot",
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"photo_id": file_id, "url": f"/api/sessions/photo/{file_id}"}


@api_router.get("/sessions/photo/{file_id}")
async def get_session_photo(file_id: str, authorization: str = Header(None), auth: str = Query(None)):
    """Serve a training-session photo (auth via header or ?auth= token for <img>)."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    elif auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_type = payload.get("user_type")
    user_id = payload.get("user_id")

    record = await db.training_files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Photo not found")
    if user_type == "athlete" and record["athlete_id"] != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        data, ctype = await _store_get_object(record["storage_path"])
    except Exception:
        raise HTTPException(status_code=404, detail="Photo unavailable")
    return Response(
        content=data,
        media_type=record.get("content_type", "image/jpeg"),
        headers={"Cache-Control": "private, max-age=86400", "ETag": f'"{file_id}"'},
    )


@api_router.post("/sessions", response_model=dict)
async def create_session(data: TrainingSessionCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can submit sessions")
    
    athlete_id = current_user['user']['id']
    internal_load = data.duration_min * data.rpe
    
    # Hard-block if there is a mandatory survey to answer first
    _sess_today = local_now().strftime("%Y-%m-%d")
    _pending = await pending_mandatory_surveys(db, athlete_id, current_user['user'].get('team', ''), _sess_today)
    if _pending:
        raise HTTPException(status_code=428, detail={
            "code": "survey_required",
            "message": "Please answer the required survey before logging training.",
            "survey_title": _pending[0].get("title"),
        })
    
    # Process pain reports - convert to list of dicts
    pain_reports_data = None
    if data.pain_reports:
        pain_reports_data = [
            {
                "body_region": pr.body_region.value,
                "laterality": pr.laterality.value if pr.laterality else None,
                "pain_level": pr.pain_level,
                "region_note": (pr.region_note or None),
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
        photo_id=data.photo_id,
        internal_load=internal_load,
        created_at=datetime.now(timezone.utc).isoformat()
    )
    
    await db.training_sessions.insert_one(session.model_dump())
    # Auto-create severe pain alerts (Active Alerts) from training pain reports
    session_date = (data.date_time_start or "")[:10]
    pain_for_alerts = list(pain_reports_data or [])
    if data.body_region and data.pain_after is not None:
        pain_for_alerts.append({
            "body_region": data.body_region.value if hasattr(data.body_region, "value") else data.body_region,
            "laterality": data.laterality.value if (data.laterality and hasattr(data.laterality, "value")) else data.laterality,
            "pain_level": data.pain_after,
        })
    if pain_for_alerts:
        try:
            await create_severe_pain_alerts(db, athlete_id, pain_for_alerts, "Training", session_date)
        except Exception as e:
            logger.error(f"Failed to create pain alert from training session: {e}")
    return session.model_dump()

@api_router.get("/sessions/history")
async def get_sessions_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can view their history")
    
    athlete_id = current_user['user']['id']
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date}},
        {"_id": 0, "staff_note": 0, "staff_note_author": 0, "staff_note_updated_at": 0}
    ).sort("date_time_start", -1).to_list(100)
    
    return sessions

# Recovery Check routes
@api_router.post("/recovery", response_model=dict)
async def create_recovery(data: RecoveryCheckCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can submit recovery")
    
    athlete_id = current_user['user']['id']
    today = local_now().strftime("%Y-%m-%d")
    
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
        raise HTTPException(status_code=403, detail="Only athletes can view their history")
    
    athlete_id = current_user['user']['id']
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
    entries = await db.recovery_checks.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    
    return entries

# Athlete history summary
@api_router.get("/athlete/summary")
async def get_athlete_summary(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes can view their summary")
    
    athlete_id = current_user['user']['id']
    start_date_7 = (local_now() - timedelta(days=7)).strftime("%Y-%m-%d")
    
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
        raise HTTPException(status_code=403, detail="Only athletes have notifications")
    
    athlete_id = current_user['user']['id']
    notifications = await db.notifications.find(
        {"athlete_id": athlete_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    return notifications

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'athlete':
        raise HTTPException(status_code=403, detail="Only athletes have notifications")
    
    result = await db.notifications.update_one(
        {"id": notification_id, "athlete_id": current_user['user']['id']},
        {"$set": {"read": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    return {"success": True}

# Staff routes
@api_router.get("/staff/athletes")
async def get_all_athletes(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    query = {"active": True, "status": {"$in": ["approved", None]}}  # Include legacy athletes without status
    if team:
        query["team"] = team
    
    athletes = await db.athletes.find(query, {"_id": 0, "password_hash": 0}).to_list(100)
    return athletes

# Admin routes for user management
@api_router.get("/admin/pending-athletes")
async def get_pending_athletes(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    pending = await db.athletes.find(
        {"status": "pending"},
        {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).to_list(100)
    
    return pending

@api_router.get("/admin/all-athletes")
async def get_all_athletes_admin(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    query = {}
    if status:
        query["status"] = status
    
    athletes = await db.athletes.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(100)
    return athletes

@api_router.put("/admin/athlete/{athlete_id}/approve")
async def approve_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    result = await db.athletes.update_one(
        {"id": athlete_id},
        {"$set": {"status": "approved", "active": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    return {"success": True, "message": "Athlete approved"}

@api_router.put("/admin/athlete/{athlete_id}/reject")
async def reject_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    result = await db.athletes.update_one(
        {"id": athlete_id},
        {"$set": {"status": "rejected", "active": False}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    return {"success": True, "message": "Athlete rejected"}

@api_router.delete("/admin/athlete/{athlete_id}")
async def delete_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    result = await db.athletes.delete_one({"id": athlete_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    return {"success": True, "message": "Athlete deleted"}

@api_router.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    pending_count = await db.athletes.count_documents({"status": "pending"})
    approved_count = await db.athletes.count_documents({"status": {"$in": ["approved", None]}})
    rejected_count = await db.athletes.count_documents({"status": "rejected"})
    staff_count = await db.staff_users.count_documents({})
    pending_staff_count = await db.staff_users.count_documents({"status": "pending"})
    
    return {
        "pending_athletes": pending_count,
        "approved_athletes": approved_count,
        "rejected_athletes": rejected_count,
        "total_staff": staff_count,
        "pending_staff": pending_staff_count
    }


# ====== Admin: Staff Account Management ======

def _require_admin(current_user: dict):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")


async def _get_staff_or_404(staff_id: str) -> dict:
    target = await db.staff_users.find_one({"id": staff_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Staff account not found")
    return target


def _guard_destructive_staff_action(target: dict, current_user: dict):
    """Protect Admin accounts and prevent acting on your own account."""
    if target.get('role') == 'Admin':
        raise HTTPException(status_code=403, detail="Administrator accounts are protected and cannot be modified.")
    if target.get('id') == current_user['user']['id']:
        raise HTTPException(status_code=403, detail="You cannot modify your own account.")


@api_router.get("/admin/staff")
async def get_all_staff_admin(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    query = {}
    if status:
        query["status"] = status
    staff = await db.staff_users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(200)
    # Normalize legacy docs missing status/active for the UI
    for s in staff:
        s.setdefault('status', 'approved')
        s.setdefault('active', True)
        s['is_protected'] = s.get('role') == 'Admin'
        s['is_self'] = s.get('id') == current_user['user']['id']
    return staff


@api_router.get("/admin/pending-staff")
async def get_pending_staff(current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    pending = await db.staff_users.find(
        {"status": "pending"}, {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).to_list(200)
    return pending


@api_router.put("/admin/staff/{staff_id}/approve")
async def approve_staff(staff_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    await _get_staff_or_404(staff_id)
    await db.staff_users.update_one({"id": staff_id}, {"$set": {"status": "approved", "active": True}})
    return {"success": True, "message": "Staff account approved"}


@api_router.put("/admin/staff/{staff_id}/reject")
async def reject_staff(staff_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    target = await _get_staff_or_404(staff_id)
    _guard_destructive_staff_action(target, current_user)
    await db.staff_users.update_one({"id": staff_id}, {"$set": {"status": "rejected", "active": False}})
    return {"success": True, "message": "Staff account rejected"}


@api_router.put("/admin/staff/{staff_id}/deactivate")
async def deactivate_staff(staff_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    target = await _get_staff_or_404(staff_id)
    _guard_destructive_staff_action(target, current_user)
    await db.staff_users.update_one({"id": staff_id}, {"$set": {"active": False}})
    return {"success": True, "message": "Staff access revoked"}


@api_router.put("/admin/staff/{staff_id}/activate")
async def activate_staff(staff_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    await _get_staff_or_404(staff_id)
    # Re-activating also clears a rejected status so the account can log in again
    await db.staff_users.update_one({"id": staff_id}, {"$set": {"active": True, "status": "approved"}})
    return {"success": True, "message": "Staff access restored"}


@api_router.delete("/admin/staff/{staff_id}")
async def delete_staff(staff_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    target = await _get_staff_or_404(staff_id)
    _guard_destructive_staff_action(target, current_user)
    await db.staff_users.delete_one({"id": staff_id})
    return {"success": True, "message": "Staff account deleted"}

# ====== Admin Data Deletion (Critical Data Integrity) ======

@api_router.delete("/admin/check-in/{check_in_id}")
async def delete_check_in(check_in_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a daily check-in (wellness response) - Admin only
    
    This only deletes the wellness check-in data without affecting training sessions.
    Use case: Athlete submitted incorrect wellness data that needs to be removed.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only - This action requires administrator privileges")
    
    # Find the check-in first to verify it exists
    check_in = await db.daily_readiness.find_one({"id": check_in_id})
    if not check_in:
        raise HTTPException(status_code=404, detail="Check-in not found")
    
    # Delete the check-in
    result = await db.daily_readiness.delete_one({"id": check_in_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=500, detail="Failed to delete check-in")
    
    logger.info(f"Admin {current_user['user']['email']} deleted check-in {check_in_id} for athlete {check_in.get('athlete_id')}")
    
    return {
        "message": "Check-in deleted successfully",
        "deleted_check_in_id": check_in_id,
        "athlete_id": check_in.get("athlete_id"),
        "date": check_in.get("date"),
        "note": "Only the wellness check-in was deleted. Training sessions are not affected."
    }


@api_router.delete("/admin/training-session/{session_id}")
async def delete_training_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a training session and atomically recalculate derived metrics - Admin only
    
    This deletes the training session and all its derived analytics are automatically
    recalculated on the next request since Monotony and Strain are computed
    dynamically from the training_sessions collection.
    
    Use case: Athlete submitted incorrect training data that needs to be removed,
    ensuring workload metrics (Monotony, Strain) remain accurate.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only - This action requires administrator privileges")
    
    # Find the session first to verify it exists and get details
    session = await db.training_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Training session not found")
    
    athlete_id = session.get("athlete_id")
    session_date = session.get("date_time_start", session.get("date"))
    internal_load = session.get("internal_load", 0)
    
    # Delete the training session
    result = await db.training_sessions.delete_one({"id": session_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=500, detail="Failed to delete training session")
    
    logger.info(f"Admin {current_user['user']['email']} deleted training session {session_id} for athlete {athlete_id}, load: {internal_load}")
    
    return {
        "message": "Training session deleted successfully. Workload metrics (Monotony, Strain) will be automatically recalculated.",
        "deleted_session_id": session_id,
        "athlete_id": athlete_id,
        "session_date": session_date,
        "deleted_load": internal_load,
        "note": "All derived analytics (Acute Load, Chronic Load, Monotony, Strain) will reflect this deletion on next refresh."
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
        raise HTTPException(status_code=403, detail="Staff only")
    
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
        today = local_now().strftime("%Y-%m-%d")
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    return event

@api_router.post("/staff/events")
async def create_event(event_data: EventCreate, current_user: dict = Depends(get_current_user)):
    """Create a new event for analysis context"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Validate dates
    try:
        start = datetime.strptime(event_data.start_date, "%Y-%m-%d")
        end = datetime.strptime(event_data.end_date, "%Y-%m-%d")
        if end < start:
            raise HTTPException(status_code=400, detail="End date must be after start date")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
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
    return {"message": "Event created successfully", "event": event.model_dump()}

@api_router.put("/staff/events/{event_id}")
async def update_event(event_id: str, event_data: EventCreate, current_user: dict = Depends(get_current_user)):
    """Update an existing event"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    existing = await db.events.find_one({"id": event_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Validate dates
    try:
        start = datetime.strptime(event_data.start_date, "%Y-%m-%d")
        end = datetime.strptime(event_data.end_date, "%Y-%m-%d")
        if end < start:
            raise HTTPException(status_code=400, detail="End date must be after start date")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
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
    
    return {"message": "Event updated successfully"}

@api_router.delete("/staff/events/{event_id}")
async def delete_event(event_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an event"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    result = await db.events.delete_one({"id": event_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    
    return {"message": "Event deleted successfully"}

@api_router.get("/staff/events/{event_id}/dashboard")
async def get_event_dashboard(event_id: str, day: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    """
    Get event-specific dashboard data focused on daily snapshots.
    day parameter: 1 = Day 1 of event, 2 = Day 2, etc. If None, returns latest day.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Calculate target date based on day number
    start_date = datetime.strptime(event['start_date'], "%Y-%m-%d")
    end_date = datetime.strptime(event['end_date'], "%Y-%m-%d")
    today = local_now().date()
    
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
                "avg_fatigue": sum(r.get('morning_fatigue', r.get('fatigue_level', 5)) for r in athlete_baseline_data) / len(athlete_baseline_data),
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
            summary["fatigue"] = readiness_entry.get('morning_fatigue', readiness_entry.get('fatigue_level', 5))
            
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "password_hash": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    return athlete

@api_router.get("/staff/athlete/{athlete_id}/readiness")
async def get_athlete_readiness(athlete_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Get athlete info to determine team
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    team = athlete.get('team')
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
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
            "id": entry.get('id'),  # Include ID for admin deletion
            "date": date,
            "athlete_score": entry['readiness_score'],
            "team_average": team_avg,
            "sleep_quality": entry.get('sleep_quality', 0),
            "morning_fatigue": entry.get('morning_fatigue', entry.get('fatigue_level', 0)),
            "muscle_soreness": entry.get('muscle_soreness', 0),
            "stress": entry.get('stress', entry.get('stress_level', 0)),
            "notes": entry.get('notes'),  # Include notes if present
            "pain_reports": entry.get('pain_reports', []),  # Pain reported during morning check-in
            "screenshot_id": entry.get('screenshot_id'),  # Optional device screenshot (Whoop/Garmin/etc.)
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    start_dt = (datetime.now(timezone.utc) - timedelta(days=days))
    start_iso = start_dt.isoformat()
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # ---- Gather pain events from ALL sources into a unified list ----
    # event: {date, region, laterality, pain_level, source}
    events = []

    def add_event(date, region, laterality, level, source):
        if not region or region == 'None':
            region = 'Unspecified'
        try:
            lvl = int(level or 0)
        except (TypeError, ValueError):
            lvl = 0
        events.append({
            "date": date,
            "region": region,
            "laterality": laterality or "N/A",
            "pain_level": lvl,
            "source": source,
        })

    # 1) Training sessions
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_iso}},
        {"_id": 0}
    ).sort("date_time_start", 1).to_list(1000)
    for s in sessions:
        date = s['date_time_start'][:10]
        prs = s.get('pain_reports') or []
        if prs:
            for pr in prs:
                add_event(date, _pr_region(pr), pr.get('laterality'), pr.get('pain_level', 0), "Training")
        elif s.get('pain_after', 0):
            add_event(date, s.get('body_region'), s.get('laterality'), s.get('pain_after', 0), "Training")

    # 2) Morning check-ins (daily_readiness)
    readiness = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date", 1).to_list(1000)
    for rd in readiness:
        for pr in (rd.get('pain_reports') or []):
            add_event(rd.get('date'), _pr_region(pr), pr.get('laterality'), pr.get('pain_level', 0), "Morning Check-in")

    # 3) Recovery submissions (recovery_logs)
    rec_logs = await db.recovery_logs.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    for rl in rec_logs:
        for pr in (rl.get('pain_reports') or []):
            add_event(rl.get('date'), _pr_region(pr), pr.get('laterality'), pr.get('pain_level', 0), "Recovery")

    # 4) Pain reported via the Messages / Feedback Center
    pain_msgs = await db.message_pain_details.find(
        {"athlete_id": athlete_id, "created_at": {"$gte": start_iso}},
        {"_id": 0}
    ).to_list(1000)
    for pm in pain_msgs:
        add_event((pm.get('created_at') or '')[:10], pm.get('body_region'), pm.get('side'), pm.get('pain_intensity', 0), "Message")

    # ---- Aggregate by region ----
    pain_by_region = {}
    high_pain_sessions = []
    for ev in events:
        if ev["pain_level"] <= 0:
            continue
        region = ev["region"]
        if region not in pain_by_region:
            pain_by_region[region] = {"count": 0, "total_intensity": 0, "high_pain_count": 0}
        pain_by_region[region]["count"] += 1
        pain_by_region[region]["total_intensity"] += ev["pain_level"]
        if ev["pain_level"] >= 5:
            pain_by_region[region]["high_pain_count"] += 1
            high_pain_sessions.append({
                "date": ev["date"],
                "intensity": ev["pain_level"],
                "region": region,
                "laterality": ev["laterality"],
                "session_type": ev["source"],
            })

    region_analysis = []
    most_affected = None
    max_count = 0
    for region, data in pain_by_region.items():
        avg_intensity = round(data["total_intensity"] / data["count"], 1) if data["count"] > 0 else 0
        region_analysis.append({
            "region": region,
            "frequency": data["count"],
            "avg_intensity": avg_intensity,
            "high_pain_count": data["high_pain_count"],
        })
        if data["count"] > max_count:
            max_count = data["count"]
            most_affected = region

    # ---- Persistent pain: same region with pain>=5 across 3+ days (<=2 day gaps) ----
    persistent_pain_alerts = []
    region_streak = {}
    for ev in sorted([e for e in events if e["pain_level"] >= 5], key=lambda x: x["date"]):
        region = ev["region"]
        date = ev["date"]
        st = region_streak.get(region)
        if not st:
            region_streak[region] = {"count": 1, "start_date": date, "dates": [date]}
            continue
        if st["dates"][-1] == date:
            continue  # already counted this day for this region
        try:
            gap = (datetime.fromisoformat(date) - datetime.fromisoformat(st["dates"][-1])).days
        except Exception:
            gap = 99
        if gap <= 2:
            st["count"] += 1
            st["dates"].append(date)
            if st["count"] == 3:
                persistent_pain_alerts.append({
                    "region": region,
                    "consecutive_days": st["count"],
                    "start_date": st["start_date"],
                    "dates": list(st["dates"]),
                })
            elif st["count"] > 3:
                for a in persistent_pain_alerts:
                    if a["region"] == region and a["start_date"] == st["start_date"]:
                        a["consecutive_days"] = st["count"]
                        a["dates"] = list(st["dates"])
        else:
            region_streak[region] = {"count": 1, "start_date": date, "dates": [date]}

    # Detailed recent reports (most recent first) WITH source
    recent_reports = sorted(
        [e for e in events if e["pain_level"] > 0],
        key=lambda x: x["date"], reverse=True
    )[:50]

    pain_events = [e for e in events if e["pain_level"] > 0]
    pain_history = [
        {
            "date": e["date"],
            "pain_after": e["pain_level"],
            "region": e["region"],
            "laterality": e["laterality"],
            "session_type": e["source"],
        }
        for e in sorted(pain_events, key=lambda x: x["date"])
    ][-30:]

    return {
        "total_sessions": len(sessions),
        "sessions_with_pain": len(pain_events),
        "high_pain_sessions_count": len(high_pain_sessions),
        "most_affected_region": most_affected,
        "region_analysis": sorted(region_analysis, key=lambda x: -x["frequency"]),
        "pain_history": pain_history,
        "high_pain_sessions": high_pain_sessions[-10:],
        "persistent_pain_alerts": persistent_pain_alerts,
        "recent_reports": recent_reports,
    }

@api_router.get("/staff/athlete/{athlete_id}/compliance")
async def get_athlete_compliance(athlete_id: str, month: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Detailed compliance metrics for an athlete. Optional month=YYYY-MM selects the calendar month."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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

    # Build FULL selected-month check-in calendar (app timezone)
    from datetime import date as _date
    today_local = local_now()
    _today_str = today_local.strftime("%Y-%m-%d")
    # Selected month (defaults to current app-local month)
    _year, _month = today_local.year, today_local.month
    if month:
        try:
            _parts = month.split("-")
            _year, _month = int(_parts[0]), int(_parts[1])
        except Exception:
            _year, _month = today_local.year, today_local.month
    _first = _date(_year, _month, 1)
    _next_first = _date(_year + 1, 1, 1) if _month == 12 else _date(_year, _month + 1, 1)
    _last_day = (_next_first - timedelta(days=1)).day
    _month_start = _first.strftime("%Y-%m-%d")
    _month_end = _next_first.strftime("%Y-%m-%d")  # exclusive
    readiness_month = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": _month_start, "$lt": _month_end}},
        {"_id": 0, "date": 1}
    ).to_list(200)
    _month_dates = set(r['date'] for r in readiness_month)
    month_days = []
    for _d in range(1, _last_day + 1):
        _ds = _date(_year, _month, _d).strftime("%Y-%m-%d")
        month_days.append({
            "date": _ds,
            "day": _d,
            "checked_in": _ds in _month_dates,
            "is_future": _ds > _today_str,
        })
    month_calendar = {
        "year": _year,
        "month": _month,
        "month_str": f"{_year:04d}-{_month:02d}",
        "month_name": _first.strftime("%B"),
        "days": month_days,
    }

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
        "calendar": calendar[::-1],  # Chronological order
        "month_calendar": month_calendar
    }

@api_router.get("/staff/team-pain-analysis")
async def get_team_pain_analysis(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Team-wide pain analysis for long-term view"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).sort("date_time_start", 1).to_list(200)
    
    return sessions

class StaffSessionNote(BaseModel):
    note: str = ""

@api_router.put("/staff/athlete/{athlete_id}/session/{session_id}/note")
async def update_session_staff_note(athlete_id: str, session_id: str, data: StaffSessionNote, current_user: dict = Depends(get_current_user)):
    """Staff-only private note on a training session. NEVER exposed to the athlete."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    note = (data.note or "").strip()
    u = current_user.get('user') or {}
    author = u.get('name') or u.get('email') or 'Staff'
    now_iso = datetime.now(timezone.utc).isoformat()

    update = {
        "staff_note": note,
        "staff_note_author": author if note else None,
        "staff_note_updated_at": now_iso if note else None,
    }
    result = await db.training_sessions.update_one(
        {"id": session_id, "athlete_id": athlete_id},
        {"$set": update}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "success": True,
        "staff_note": note,
        "staff_note_author": update["staff_note_author"],
        "staff_note_updated_at": update["staff_note_updated_at"],
    }


@api_router.get("/staff/athlete/{athlete_id}/workload-readiness")
async def get_workload_readiness(athlete_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Daily training load (TRIMP = summed internal_load) aligned with daily readiness_score. Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    start = datetime.now(timezone.utc) - timedelta(days=days)
    start_iso = start.isoformat()
    start_date_str = start.strftime("%Y-%m-%d")

    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_iso}},
        {"_id": 0, "date_time_start": 1, "internal_load": 1}
    ).to_list(5000)
    load_map = {}
    for s in sessions:
        d = (s.get('date_time_start') or '')[:10]
        if d:
            load_map[d] = load_map.get(d, 0) + (s.get('internal_load') or 0)

    readiness_docs = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date_str}},
        {"_id": 0, "date": 1, "readiness_score": 1}
    ).to_list(3000)
    r_map = {d['date']: d.get('readiness_score') for d in readiness_docs}

    dates = sorted(set(load_map.keys()) | set(r_map.keys()))
    points = [{"date": d, "load": load_map.get(d, 0), "readiness": r_map.get(d)} for d in dates]
    return {"points": points, "has_data": len(points) > 0}



@api_router.get("/staff/athlete/{athlete_id}/workload")
async def get_athlete_workload(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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
        "weekly_monotony": weekly_monotony,
        "weekly_strain": weekly_strain
    }

# Dashboard stats
@api_router.get("/staff/dashboard/stats")
async def get_dashboard_stats(team: Optional[str] = None, athlete_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    athlete_ids = [a['id'] for a in athletes]
    
    today = local_now().strftime("%Y-%m-%d")
    start_7 = (local_now() - timedelta(days=7)).strftime("%Y-%m-%d")
    
    # Count missing check-ins today
    today_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": today},
        {"_id": 0, "athlete_id": 1, "readiness_score": 1}
    ).to_list(100)
    checked_in_ids = [r['athlete_id'] for r in today_readiness]
    missing_check_ins = len(athlete_ids) - len(checked_in_ids)

    # Low readiness today (risk threshold: readiness_score < 5)
    low_readiness_today = sum(1 for r in today_readiness if (r.get('readiness_score') or 10) < 5)
    
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

    # Overload alerts: athletes whose latest training-day load is >30% above their own 28d training-day average
    overload_alerts = 0
    try:
        from collections import defaultdict as _dd
        ov_start = (datetime.now(timezone.utc) - timedelta(days=28)).isoformat()
        ov_sessions = await db.training_sessions.find(
            {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": ov_start}},
            {"_id": 0, "athlete_id": 1, "date_time_start": 1, "internal_load": 1}
        ).to_list(20000)
        ov_by_athlete = _dd(dict)
        for s in ov_sessions:
            d = (s.get('date_time_start') or '')[:10]
            if d:
                ov_by_athlete[s['athlete_id']][d] = ov_by_athlete[s['athlete_id']].get(d, 0) + (s.get('internal_load') or 0)
        for aid, adays in ov_by_athlete.items():
            if not adays:
                continue
            avg_daily = sum(adays.values()) / len(adays)
            latest = max(adays.keys())
            if avg_daily > 0 and adays[latest] > 0 and (100 * (adays[latest] - avg_daily) / avg_daily) > 30:
                overload_alerts += 1
    except Exception:
        pass

    return {
        "total_athletes": len(athletes),
        "missing_check_ins": missing_check_ins,
        "checkin_compliance_today": round(100 * len(checked_in_ids) / len(athlete_ids)) if athlete_ids else 0,
        "low_readiness_today": low_readiness_today,
        "avg_readiness_7_days": avg_readiness,
        "team_total_load_7_days": total_load_7,
        "avg_load_per_athlete_7_days": avg_load_per_athlete,
        "athletes_with_sessions": athletes_with_sessions,
        "active_alerts": active_alerts,
        "overload_alerts": overload_alerts
    }


@api_router.get("/staff/dashboard/persistent-pain")
async def get_persistent_pain(team: Optional[str] = None, days: int = 21, current_user: dict = Depends(get_current_user)):
    """Athletes reporting pain (>=5) in the same body region across 3+ days (<=2 day gaps),
    aggregated across all pain sources (training, check-ins, recovery, messages). Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(200)
    ids = [a['id'] for a in athletes]
    name_map = {a['id']: a['name'] for a in athletes}
    team_map = {a['id']: a.get('team') for a in athletes}

    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # athlete_id -> region -> set(dates) with pain >= 5
    from collections import defaultdict
    events = defaultdict(lambda: defaultdict(set))

    def add(aid, date, region, level):
        try:
            lvl = int(level or 0)
        except (TypeError, ValueError):
            lvl = 0
        if lvl < 5 or not date:
            return
        events[aid][region or 'Unspecified'].add(date[:10])

    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}}, {"_id": 0}
    ).to_list(20000)
    for s in sessions:
        d = (s.get('date_time_start') or '')[:10]
        prs = s.get('pain_reports') or []
        if prs:
            for pr in prs:
                add(s['athlete_id'], d, _pr_region(pr), pr.get('pain_level', 0))
        elif s.get('pain_after', 0):
            add(s['athlete_id'], d, s.get('body_region'), s.get('pain_after', 0))

    for coll, dfield in [("daily_readiness", "date"), ("recovery_logs", "date")]:
        rows = await db[coll].find({"athlete_id": {"$in": ids}, "date": {"$gte": start_date}}, {"_id": 0}).to_list(20000)
        for r in rows:
            for pr in (r.get('pain_reports') or []):
                add(r['athlete_id'], r.get(dfield), _pr_region(pr), pr.get('pain_level', 0))

    pmsgs = await db.message_pain_details.find(
        {"athlete_id": {"$in": ids}, "created_at": {"$gte": start_iso}}, {"_id": 0}
    ).to_list(20000)
    for pm in pmsgs:
        add(pm['athlete_id'], (pm.get('created_at') or '')[:10], pm.get('body_region'), pm.get('pain_intensity', 0))

    # Compute longest consecutive streak (<=2 day gaps) per athlete/region
    def longest_streak(dates):
        ds = sorted(dates)
        best = 1; cur = 1; start = ds[0]; best_start = ds[0]; best_end = ds[0]; cur_start = ds[0]
        for i in range(1, len(ds)):
            gap = (datetime.fromisoformat(ds[i]) - datetime.fromisoformat(ds[i - 1])).days
            if gap <= 2:
                cur += 1
            else:
                cur = 1; cur_start = ds[i]
            if cur > best:
                best = cur; best_start = cur_start; best_end = ds[i]
        return best, best_start, best_end

    result = []
    for aid, regions in events.items():
        for region, dates in regions.items():
            if len(dates) < 3:
                continue
            streak, s_start, s_end = longest_streak(dates)
            if streak >= 3:
                result.append({
                    "athlete_id": aid,
                    "athlete_name": name_map.get(aid, 'Unknown'),
                    "team": team_map.get(aid),
                    "region": region,
                    "consecutive_days": streak,
                    "start_date": s_start,
                    "last_date": s_end,
                })
    result.sort(key=lambda x: x['consecutive_days'], reverse=True)
    return {"count": len(result), "athletes": result}


@api_router.get("/staff/dashboard/kpi-athletes")
async def get_kpi_athletes(metric: str, team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Athletes behind a dashboard KPI. metric = 'overload' | 'low_readiness'. Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(200)
    ids = [a['id'] for a in athletes]
    name_map = {a['id']: a['name'] for a in athletes}
    team_map = {a['id']: a.get('team') for a in athletes}

    if metric == "low_readiness":
        today = local_now().strftime("%Y-%m-%d")
        rows = await db.daily_readiness.find(
            {"athlete_id": {"$in": ids}, "date": today}, {"_id": 0, "athlete_id": 1, "readiness_score": 1}
        ).to_list(200)
        out = [{
            "athlete_id": r['athlete_id'], "athlete_name": name_map.get(r['athlete_id'], 'Unknown'),
            "team": team_map.get(r['athlete_id']), "value": r.get('readiness_score'),
        } for r in rows if (r.get('readiness_score') or 10) < 5]
        out.sort(key=lambda x: (x['value'] if x['value'] is not None else 99))
        return {"metric": metric, "count": len(out), "athletes": out}

    if metric == "overload":
        from collections import defaultdict as _dd
        ov_start = (datetime.now(timezone.utc) - timedelta(days=28)).isoformat()
        ov_sessions = await db.training_sessions.find(
            {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": ov_start}},
            {"_id": 0, "athlete_id": 1, "date_time_start": 1, "internal_load": 1}
        ).to_list(20000)
        by_athlete = _dd(dict)
        for s in ov_sessions:
            d = (s.get('date_time_start') or '')[:10]
            if d:
                by_athlete[s['athlete_id']][d] = by_athlete[s['athlete_id']].get(d, 0) + (s.get('internal_load') or 0)
        out = []
        for aid, adays in by_athlete.items():
            if not adays:
                continue
            avg_daily = sum(adays.values()) / len(adays)
            latest = max(adays.keys())
            if avg_daily > 0 and adays[latest] > 0:
                pct = round(100 * (adays[latest] - avg_daily) / avg_daily)
                if pct > 30:
                    out.append({
                        "athlete_id": aid, "athlete_name": name_map.get(aid, 'Unknown'), "team": team_map.get(aid),
                        "value": pct, "latest_load": round(adays[latest]), "avg_load": round(avg_daily), "date": latest,
                    })
        out.sort(key=lambda x: x['value'], reverse=True)
        return {"metric": metric, "count": len(out), "athletes": out}

    if metric == "not_checked_in":
        today = local_now().strftime("%Y-%m-%d")
        rows = await db.daily_readiness.find(
            {"athlete_id": {"$in": ids}, "date": today}, {"_id": 0, "athlete_id": 1}
        ).to_list(500)
        checked_in = {r['athlete_id'] for r in rows}
        out = [{
            "athlete_id": aid, "athlete_name": name_map.get(aid, 'Unknown'),
            "team": team_map.get(aid), "value": None,
        } for aid in ids if aid not in checked_in]
        out.sort(key=lambda x: x['athlete_name'])
        return {"metric": metric, "count": len(out), "athletes": out}

    raise HTTPException(status_code=400, detail="Unknown metric")
@api_router.get("/staff/dashboard/menstrual-stats")
async def get_menstrual_stats(team: Optional[str] = None, athlete_id: Optional[str] = None, days: int = 7, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """Get menstrual cycle statistics for female athletes"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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
            "severe_symptoms_today": [],
            "athletes_in_period_details": [],
            "selected_date": None
        }
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    # Calculate target date based on days_ago
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    start_date = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
    # Get target date's readiness data with menstrual info
    today_readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": target_date, "is_menstruating": True},
        {"_id": 0}
    ).to_list(100)
    
    athletes_on_period_today = len(today_readiness)
    
    # Get training sessions for the target date to include pain data
    start_of_day = f"{target_date}T00:00:00"
    end_of_day = f"{target_date}T23:59:59"
    
    target_date_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_of_day, "$lte": end_of_day}},
        {"_id": 0}
    ).to_list(200)
    
    # Group sessions by athlete
    sessions_by_athlete = {}
    for s in target_date_sessions:
        aid = s['athlete_id']
        if aid not in sessions_by_athlete:
            sessions_by_athlete[aid] = []
        sessions_by_athlete[aid].append(s)
    
    # Build detailed list of athletes in period
    athletes_in_period_details = []
    severe_symptoms_today = []
    high_pain_alerts = []
    
    for r in today_readiness:
        athlete_id = r['athlete_id']
        athlete_name = athlete_names.get(athlete_id, 'Unknown')
        menstrual_pain = r.get('menstrual_pain', 'None')
        menstrual_flow = r.get('menstrual_flow', 'None')
        menstrual_symptoms = r.get('menstrual_symptoms', [])
        general_soreness = r.get('muscle_soreness', 0)
        
        # Get pain reports from training sessions for this athlete on target date
        athlete_sessions = sessions_by_athlete.get(athlete_id, [])
        pain_reports = []
        
        for session in athlete_sessions:
            # Check pain_reports array first
            session_pain_reports = session.get('pain_reports', [])
            if session_pain_reports:
                for pr in session_pain_reports:
                    pain_reports.append({
                        "intensity": pr.get('pain_level', 0),
                        "region": pr.get('body_region', 'Unspecified'),
                        "laterality": pr.get('laterality', 'N/A'),
                        "session_type": session.get('session_type', 'Unknown')
                    })
            else:
                # Fallback to legacy format
                pain_after = session.get('pain_after', 0)
                if pain_after > 0:
                    pain_reports.append({
                        "intensity": pain_after,
                        "region": session.get('body_region', 'Unspecified'),
                        "laterality": session.get('laterality', 'N/A'),
                        "session_type": session.get('session_type', 'Unknown')
                    })
        
        athlete_detail = {
            "athlete_id": athlete_id,
            "athlete_name": athlete_name,
            "is_in_period": True,
            "menstrual_flow": menstrual_flow,
            "menstrual_pain": menstrual_pain,
            "menstrual_symptoms": menstrual_symptoms,
            "general_soreness": general_soreness,
            "readiness_score": r.get('readiness_score', None),
            "pain_reports": pain_reports,
            "has_pain_today": len(pain_reports) > 0
        }
        
        athletes_in_period_details.append(athlete_detail)
        
        # Track severe symptoms
        if menstrual_pain in ['Severe', 'Very Severe']:
            severe_symptoms_today.append({
                "athlete_id": athlete_id,
                "athlete_name": athlete_name,
                "menstrual_pain": menstrual_pain,
                "flow": menstrual_flow,
                "symptoms": menstrual_symptoms,
                "general_soreness": general_soreness
            })
            
            high_pain_alerts.append({
                "athlete_id": athlete_id,
                "athlete_name": athlete_name,
                "alert_type": "SEVERE_MENSTRUAL_PAIN",
                "severity": "Red" if menstrual_pain == 'Very Severe' else "Yellow",
                "message": f"Severe menstrual pain reported: {menstrual_pain}",
                "date": target_date
            })
        
        # Check for combined high pain
        if menstrual_pain in ['Moderate', 'Severe', 'Very Severe'] and general_soreness > 5:
            high_pain_alerts.append({
                "athlete_id": athlete_id,
                "athlete_name": athlete_name,
                "alert_type": "COMBINED_HIGH_PAIN",
                "severity": "Red",
                "message": f"High menstrual pain ({menstrual_pain}) combined with high general soreness ({general_soreness}/10)",
                "date": target_date
            })
    
    # Sort by pain severity (most severe first)
    pain_order = {'Very Severe': 0, 'Severe': 1, 'Moderate': 2, 'Mild': 3, 'None': 4}
    athletes_in_period_details.sort(key=lambda x: pain_order.get(x['menstrual_pain'], 5))
    
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
    available_dates = []
    for i in range(days):
        date = (local_now() - timedelta(days=days-1-i)).strftime("%Y-%m-%d")
        count = len(period_by_date.get(date, set()))
        weekly_period_count.append({"date": date, "count": count})
        if count > 0:
            available_dates.append(date)
    
    available_dates = sorted(available_dates, reverse=True)
    
    return {
        "selected_date": target_date,
        "athletes_on_period_today": athletes_on_period_today,
        "total_female_athletes": len(athletes),
        "period_rate": round(athletes_on_period_today / len(athletes) * 100, 1) if athletes else 0,
        "high_pain_alerts": high_pain_alerts,
        "weekly_period_count": weekly_period_count,
        "severe_symptoms_today": severe_symptoms_today,
        "athletes_in_period_details": athletes_in_period_details,
        "available_dates": available_dates
    }

# Enhanced Pain Analytics by Body Region
@api_router.get("/staff/dashboard/pain-analytics")
async def get_pain_analytics(team: Optional[str] = None, athlete_id: Optional[str] = None, days: int = 90, current_user: dict = Depends(get_current_user)):
    """Comprehensive pain analytics by body region for long-term analysis"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    start_date_str = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Pain sources: training sessions + Morning Check-in + Recovery Points
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_date}},
        {"_id": 0}
    ).to_list(2000)
    readiness_docs = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_date_str}},
        {"_id": 0}
    ).to_list(3000)
    recovery_docs = await db.recovery_logs.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": start_date_str}},
        {"_id": 0}
    ).to_list(5000)

    # Aggregate pain by body region
    region_stats = {}
    athlete_region_stats = {}  # For individual athlete breakdown
    total_sessions = len(sessions) + len(readiness_docs) + len(recovery_docs)
    sessions_with_pain = 0

    def _record_pain(region, pain, athlete_id):
        if not region or region in ('None', 'Unspecified') or pain <= 0:
            return False
        athlete_name = athlete_names.get(athlete_id, 'Unknown')
        if region not in region_stats:
            region_stats[region] = {
                "region": region, "total_reports": 0, "total_intensity": 0,
                "high_pain_count": 0, "severe_pain_count": 0, "affected_athletes": set()
            }
        region_stats[region]["total_reports"] += 1
        region_stats[region]["total_intensity"] += pain
        region_stats[region]["affected_athletes"].add(athlete_id)
        if pain >= 5:
            region_stats[region]["high_pain_count"] += 1
        if pain >= 7:
            region_stats[region]["severe_pain_count"] += 1
        if athlete_id not in athlete_region_stats:
            athlete_region_stats[athlete_id] = {"name": athlete_name, "regions": {}}
        if region not in athlete_region_stats[athlete_id]["regions"]:
            athlete_region_stats[athlete_id]["regions"][region] = {"count": 0, "total_intensity": 0}
        athlete_region_stats[athlete_id]["regions"][region]["count"] += 1
        athlete_region_stats[athlete_id]["regions"][region]["total_intensity"] += pain
        return True

    def _process_entry(athlete_id, pain_items):
        nonlocal sessions_with_pain
        had = False
        for region, pain in pain_items:
            if _record_pain(region, pain, athlete_id):
                had = True
        if had:
            sessions_with_pain += 1

    for s in sessions:
        items = [(_pr_region(pr), pr.get('pain_level', 0)) for pr in (s.get('pain_reports') or [])]
        if s.get('body_region') and s.get('pain_after', 0) > 0:
            items.append((s.get('body_region'), s.get('pain_after', 0)))
        _process_entry(s['athlete_id'], items)
    for rd in readiness_docs:
        _process_entry(rd['athlete_id'], [(_pr_region(pr), pr.get('pain_level', 0)) for pr in (rd.get('pain_reports') or [])])
    for rl in recovery_docs:
        _process_entry(rl['athlete_id'], [(_pr_region(pr), pr.get('pain_level', 0)) for pr in (rl.get('pain_reports') or [])])
    
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
async def get_workload_metrics(team: Optional[str] = None, athlete_id: Optional[str] = None, weeks: int = 4, current_user: dict = Depends(get_current_user)):
    """
    Calculate weekly Monotony and Strain metrics based on session-RPE data.
    
    Monotony = Mean daily sRPE / Standard Deviation of daily sRPE
    Strain = Weekly Load × Monotony
    
    These metrics are for workload monitoring and decision support only.
    They should not be interpreted as injury risk indicators or medical diagnoses.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
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
async def get_dashboard_charts(team: Optional[str] = None, athlete_id: Optional[str] = None, days: int = 7, start_date: Optional[str] = None, end_date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    # Date window: an explicit start_date/end_date (custom range) overrides the days preset.
    if start_date:
        readiness_start = start_date
        try:
            start_date_iso = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            start_date_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    else:
        readiness_start = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
        start_date_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Get readiness data (date is a YYYY-MM-DD string; end_date is inclusive)
    readiness_date_filter = {"$gte": readiness_start}
    if end_date:
        readiness_date_filter["$lte"] = end_date
    readiness_data = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": readiness_date_filter},
        {"_id": 0}
    ).to_list(500)
    
    # Build per-athlete readiness data for individual lines
    # Structure: {date: {athlete_name: score, ...}, ...}
    dates_set = set()
    athlete_readiness_by_date = {}
    for r in readiness_data:
        if r.get('readiness_score') is None:
            continue  # skip partial docs without a readiness score
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

    # Per-athlete latest + previous readiness (used for the single-day snapshot list
    # with an up/down trend vs the athlete's previous check-in).
    readiness_latest = []
    for a in athletes:
        last_two = await db.daily_readiness.find(
            {"athlete_id": a['id']},
            {"_id": 0, "date": 1, "readiness_score": 1}
        ).sort("date", -1).limit(2).to_list(2)
        if not last_two:
            continue
        latest = last_two[0]
        prev = last_two[1] if len(last_two) > 1 else None
        delta = round(latest['readiness_score'] - prev['readiness_score'], 1) if prev else None
        readiness_latest.append({
            "id": a['id'],
            "name": a['name'],
            "score": latest['readiness_score'],
            "date": latest['date'],
            "prev_score": prev['readiness_score'] if prev else None,
            "prev_date": prev['date'] if prev else None,
            "delta": delta,
        })

    return {
        "readiness": readiness_chart,
        "readiness_latest": readiness_latest,
        "load": load_chart,
        "pain": pain_chart,
        "athletes": athlete_name_list,
        "athlete_map": {a['name']: a['id'] for a in athletes}
    }

@api_router.get("/staff/dashboard/daily-report")
async def get_daily_report(team: Optional[str] = None, days_ago: int = 0, load_days: int = 7, current_user: dict = Depends(get_current_user)):
    """Consolidated, date-accurate data for the Daily Monitoring Report PDF.
    All "today" values belong strictly to the selected date; previous values use the
    athlete's last valid check-in before that date. Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    from collections import defaultdict

    RISK = 5
    SHARP = -1.5
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(300)
    ids = [a['id'] for a in athletes]
    name_map = {a['id']: a['name'] for a in athletes}
    team_map = {a['id']: a.get('team') for a in athletes}

    # ---------- Readiness (selected date + previous valid) ----------
    today_entries = await db.daily_readiness.find(
        {"athlete_id": {"$in": ids}, "date": target_date}, {"_id": 0}
    ).to_list(500)
    today_by_athlete = {e['athlete_id']: e for e in today_entries}

    def status_from(score, delta):
        if score is None:
            return 'no_response'
        if score < RISK:
            return 'at_risk'
        if delta is not None and delta <= SHARP:
            return 'sharp_drop'
        if delta is not None and delta < 0 and score < 6:
            return 'trending_down'
        if delta is not None and delta > 0.2:
            return 'improving'
        return 'stable'

    readiness_rows = []
    for a in athletes:
        aid = a['id']
        te = today_by_athlete.get(aid)
        today_score = te.get('readiness_score') if te else None
        prev = await db.daily_readiness.find_one(
            {"athlete_id": aid, "date": {"$lt": target_date}},
            sort=[("date", -1)], projection={"_id": 0, "date": 1, "readiness_score": 1}
        )
        prev_score = prev.get('readiness_score') if prev else None
        prev_date = prev.get('date') if prev else None
        change = round(today_score - prev_score, 1) if (today_score is not None and prev_score is not None) else None
        status = status_from(today_score, change)
        if te:
            last_resp, days_without = target_date, 0
        else:
            last = await db.daily_readiness.find_one(
                {"athlete_id": aid}, sort=[("date", -1)], projection={"_id": 0, "date": 1, "readiness_score": 1}
            )
            last_resp = last.get('date') if last else None
            days_without = (datetime.fromisoformat(target_date) - datetime.fromisoformat(last_resp)).days if last_resp else None
        readiness_rows.append({
            "athlete_id": aid, "name": a['name'], "team": team_map.get(aid),
            "responded_today": te is not None,
            "today_readiness": today_score,
            "previous_readiness": prev_score,
            "previous_date": prev_date,
            "change": change,
            "status": status,
            "last_response": last_resp,
            "days_without_response": days_without,
        })

    order = {"sharp_drop": 0, "at_risk": 1, "trending_down": 2, "stable": 3, "improving": 4, "no_response": 5}
    readiness_rows.sort(key=lambda r: (order.get(r['status'], 9), (r['today_readiness'] if r['today_readiness'] is not None else 99)))

    responders = [r for r in readiness_rows if r['responded_today']]
    resp_scores = [r['today_readiness'] for r in responders if r['today_readiness'] is not None]
    team_avg = round(sum(resp_scores) / len(resp_scores), 1) if resp_scores else None
    summary = {
        "athletes": len(athletes),
        "responded_today": len(responders),
        "response_rate": round(100 * len(responders) / len(athletes)) if athletes else 0,
        "team_readiness_avg": team_avg,
        "at_risk": sum(1 for r in responders if r['status'] == 'at_risk'),
        "sharp_drops": sum(1 for r in responders if r['status'] == 'sharp_drop'),
    }

    # ---------- Training load (valid sessions only, no zero-load days) ----------
    start_iso = (datetime.now(timezone.utc) - timedelta(days=load_days)).isoformat()
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}}, {"_id": 0}
    ).to_list(20000)
    per = defaultdict(lambda: {"total": 0, "sessions": 0})
    athlete_day = defaultdict(int)
    for s in sessions:
        load = int(s.get('internal_load', 0) or 0)
        if load <= 0:
            continue
        aid = s['athlete_id']
        per[aid]["total"] += load
        per[aid]["sessions"] += 1
        d = (s.get('date_time_start') or '')[:10]
        if d:
            athlete_day[(aid, d)] += load
    per_athlete_days = defaultdict(dict)
    day_loads = defaultdict(list)
    day_peak = {}
    for (aid, d), v in athlete_day.items():
        per_athlete_days[aid][d] = v
        day_loads[d].append(v)
        if d not in day_peak or v > day_peak[d][1]:
            day_peak[d] = (aid, v)
    loads = [per[a]["total"] for a in per if per[a]["total"] > 0]
    n = len(loads)
    team_mean = sum(loads) / n if n else 0
    if n >= 3:
        variance = sum((x - team_mean) ** 2 for x in loads) / n
        threshold = team_mean + variance ** 0.5
    elif n >= 1:
        threshold = team_mean * 1.3
    else:
        threshold = None
    elevated = []
    for a in athletes:
        aid = a['id']
        adays = per_athlete_days.get(aid, {})
        if not adays:
            continue
        tl = per[aid]["total"]
        latest = max(adays.keys())
        day_load = adays[latest]
        tdays = len(adays)
        avg_daily = round(tl / tdays) if tdays else 0
        pct = round(100 * (day_load - avg_daily) / avg_daily) if avg_daily else None
        if threshold is not None and tl > threshold:
            elevated.append({
                "name": a['name'], "latest_load": day_load, "personal_avg": avg_daily,
                "pct_diff": pct, "sessions": per[aid]["sessions"], "latest_date": latest,
            })
    elevated.sort(key=lambda x: (x["pct_diff"] if x["pct_diff"] is not None else -999), reverse=True)
    daily = []
    for d in sorted(day_loads.keys()):
        vals = day_loads[d]
        paid = day_peak[d][0]
        daily.append({"date": d, "avg": round(sum(vals) / len(vals)), "peak": max(vals), "peak_athlete": name_map.get(paid, '-')})
    all_day_vals = list(athlete_day.values())
    training_load = {
        "avg_training_day": round(sum(all_day_vals) / len(all_day_vals)) if all_day_vals else None,
        "latest_training_day_date": daily[-1]["date"] if daily else None,
        "latest_training_day_avg": daily[-1]["avg"] if daily else None,
        "team_avg_per_day": round(sum(d["avg"] for d in daily) / len(daily)) if daily else None,
        "elevated_count": len(elevated),
        "elevated_athletes": elevated,
        "daily_team_load": daily,
        "window_days": load_days,
    }

    # ---------- Pain (selected date, per athlete/region) ----------
    win_start = (local_now() - timedelta(days=21)).strftime("%Y-%m-%d")
    win_start_iso = (datetime.now(timezone.utc) - timedelta(days=21)).isoformat()
    hist = defaultdict(dict)  # (aid, region) -> {date: level}

    def hadd(aid, region, date, level):
        try:
            lvl = int(level or 0)
        except (TypeError, ValueError):
            lvl = 0
        if not region or region == 'None' or not date:
            return
        d = date[:10]
        hist[(aid, region)][d] = max(hist[(aid, region)].get(d, 0), lvl)

    hist_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": win_start_iso}}, {"_id": 0}
    ).to_list(20000)
    for s in hist_sessions:
        d = (s.get('date_time_start') or '')[:10]
        prs = s.get('pain_reports') or []
        if prs:
            for pr in prs:
                hadd(s['athlete_id'], _pr_region(pr), d, pr.get('pain_level', 0))
        elif s.get('pain_after', 0):
            hadd(s['athlete_id'], s.get('body_region'), d, s.get('pain_after', 0))
    for coll in ["daily_readiness", "recovery_logs"]:
        rows = await db[coll].find({"athlete_id": {"$in": ids}, "date": {"$gte": win_start}}, {"_id": 0}).to_list(20000)
        for r in rows:
            for pr in (r.get('pain_reports') or []):
                hadd(r['athlete_id'], _pr_region(pr), r.get('date'), pr.get('pain_level', 0))

    def streak_ending(dates_set, end_date):
        # consecutive distinct report days ending at end_date, allowing <=2 day gaps
        ds = sorted(dates_set)
        if end_date not in dates_set:
            return 0
        cnt = 1
        cur = end_date
        for i in range(len(ds) - 1, 0, -1):
            if ds[i] != cur:
                continue
            gap = (datetime.fromisoformat(cur) - datetime.fromisoformat(ds[i - 1])).days
            if gap <= 2:
                cnt += 1
                cur = ds[i - 1]
            else:
                break
        return cnt

    def collect_today_pain():
        events = []  # (aid, region, laterality, level, source, note)
        for s in hist_sessions:
            if (s.get('date_time_start') or '')[:10] != target_date:
                continue
            aid = s['athlete_id']
            note = s.get('notes') or s.get('session_notes')
            src = s.get('session_type') or 'Training'
            prs = s.get('pain_reports') or []
            if prs:
                for pr in prs:
                    if (pr.get('pain_level') or 0) > 0:
                        events.append((aid, _pr_region(pr), pr.get('laterality') or 'N/A', pr.get('pain_level', 0), src, note))
            elif s.get('pain_after', 0):
                events.append((aid, s.get('body_region'), s.get('laterality') or 'N/A', s.get('pain_after', 0), src, note))
        return events

    today_pain_events = collect_today_pain()
    for e in today_entries:
        note = e.get('notes')
        for pr in (e.get('pain_reports') or []):
            if (pr.get('pain_level') or 0) > 0:
                today_pain_events.append((e['athlete_id'], _pr_region(pr), pr.get('laterality') or 'N/A', pr.get('pain_level', 0), 'Morning Check-in', note))
    today_recovery = await db.recovery_logs.find({"athlete_id": {"$in": ids}, "date": target_date}, {"_id": 0}).to_list(2000)
    for rl in today_recovery:
        for pr in (rl.get('pain_reports') or []):
            if (pr.get('pain_level') or 0) > 0:
                today_pain_events.append((rl['athlete_id'], _pr_region(pr), pr.get('laterality') or 'N/A', pr.get('pain_level', 0), 'Recovery', None))

    # Staff follow-up records (per athlete/region/side) to enrich pain rows
    fu_docs = await db.pain_followups.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(3000)
    fu_exact = {}
    fu_region = {}
    for f in fu_docs:
        fu_exact[(f['athlete_id'], f.get('region'), f.get('side'))] = f
        fu_region[(f['athlete_id'], f.get('region'))] = f

    def fu_text(aid, region, side):
        f = fu_exact.get((aid, region, side)) or fu_region.get((aid, region))
        if not f:
            return 'Not reviewed'
        return f['status'] + (f" — {f['note']}" if f.get('note') else '')

    pain_rows = []
    pain_athletes = set()
    for (aid, region, laterality, level, source, note) in today_pain_events:
        key = (aid, region)
        dates = set(hist.get(key, {}).keys())
        prev_dates = sorted([d for d in dates if d < target_date])
        prev_date = prev_dates[-1] if prev_dates else None
        prev_score = hist[key].get(prev_date) if prev_date else None
        change = (level - prev_score) if (prev_score is not None) else None
        strong_dates = {d for d, lv in hist.get(key, {}).items() if lv >= 5}
        consecutive = streak_ending(strong_dates, target_date) if level >= 5 else (1 if level >= 5 else 0)
        if consecutive >= 3:
            recurrence = 'Persistent'
        elif prev_date:
            recurrence = 'Recurrent'
        else:
            recurrence = 'New'
        side_map = {'Left': 'Left', 'Right': 'Right', 'Both': 'Bilateral', 'N/A': 'Unspecified'}
        side = side_map.get(laterality, 'Unspecified')
        pain_rows.append({
            "athlete_id": aid,
            "athlete": name_map.get(aid, 'Unknown'),
            "region": region or 'Unspecified',
            "side": side,
            "intensity": level,
            "duration_type": 'Long-term' if consecutive >= 3 else 'Short-term',
            "recurrence": recurrence,
            "consecutive_days": consecutive,
            "previous_score": prev_score,
            "change": change,
            "context": source,
            "note": (note or "Not provided"),
            "follow_up": fu_text(aid, region or 'Unspecified', side),
        })
        pain_athletes.add(aid)
    pain_rows.sort(key=lambda r: r["intensity"], reverse=True)
    from collections import Counter as _Counter
    region_counter = _Counter(r["region"] for r in pain_rows)
    pain_summary = {
        "athletes_reporting_pain": len(pain_athletes),
        "total_reports": len(pain_rows),
        "severe_reports": sum(1 for r in pain_rows if r["intensity"] >= 8),
        "persistent_cases": sum(1 for r in pain_rows if r["consecutive_days"] >= 3),
        "most_reported_region": region_counter.most_common(1)[0][0] if region_counter else None,
    }

    # ---------- Persistent pain (3+ consecutive days, window) ----------
    persistent_rows = []
    for (aid, region), dm in hist.items():
        strong = sorted([d for d, lv in dm.items() if lv >= 5])
        if len(strong) < 3:
            continue
        best = 1; cur = 1; bs = strong[0]; be = strong[0]; cs = strong[0]
        for i in range(1, len(strong)):
            gap = (datetime.fromisoformat(strong[i]) - datetime.fromisoformat(strong[i - 1])).days
            if gap <= 2:
                cur += 1
            else:
                cur = 1; cs = strong[i]
            if cur > best:
                best = cur; bs = cs; be = strong[i]
        if best >= 3:
            latest_score = dm.get(be)
            first_score = dm.get(bs)
            trend = 'Stable'
            if latest_score is not None and first_score is not None:
                if latest_score > first_score:
                    trend = 'Worsening'
                elif latest_score < first_score:
                    trend = 'Improving'
            persistent_rows.append({
                "athlete": name_map.get(aid, 'Unknown'),
                "region": region or 'Unspecified',
                "side": "Unspecified",
                "current_score": latest_score,
                "consecutive_days": best,
                "first_date": bs,
                "latest_date": be,
                "trend": trend,
                "follow_up": (fu_region.get((aid, region or 'Unspecified'))['status'] if fu_region.get((aid, region or 'Unspecified')) else 'Not reviewed'),
            })
    persistent_rows.sort(key=lambda r: r["consecutive_days"], reverse=True)

    # ---------- Non-responders (not today AND >3 days) ----------
    non_responders = []
    for r in readiness_rows:
        if r['responded_today']:
            continue
        dw = r['days_without_response']
        if dw is None or dw > 3:
            non_responders.append({
                "athlete": r['name'],
                "last_check_in": r['last_response'],
                "days_without_response": dw,
                "last_known_readiness": r['previous_readiness'],
                "follow_up": "Not provided",
            })
    non_responders.sort(key=lambda x: (x["days_without_response"] if x["days_without_response"] is not None else 999), reverse=True)

    # ---------- Active alerts (derived, consistent with tables) ----------
    active_alerts = []
    for r in responders:
        if r['status'] == 'sharp_drop':
            active_alerts.append({"athlete": r['name'], "type": "Sharp readiness drop", "current": r['today_readiness'],
                                  "previous": r['previous_readiness'], "change": r['change'], "date": target_date,
                                  "explanation": f"Dropped {abs(r['change'])} pts vs {r['previous_date']}"})
    for r in responders:
        if r['status'] == 'at_risk':
            active_alerts.append({"athlete": r['name'], "type": "Low readiness", "current": r['today_readiness'],
                                  "previous": r['previous_readiness'], "change": r['change'], "date": target_date,
                                  "explanation": f"Readiness below {RISK}"})
    for p in pain_rows:
        if p['intensity'] >= 8:
            active_alerts.append({"athlete": p['athlete'], "type": "Severe pain", "current": p['intensity'],
                                  "previous": p['previous_score'], "change": p['change'], "date": target_date,
                                  "explanation": f"{p['region']} ({p['side']}) {p['intensity']}/10"})
    for p in persistent_rows:
        active_alerts.append({"athlete": p['athlete'], "type": "Persistent pain", "current": p['current_score'],
                              "previous": None, "change": None, "date": p['latest_date'],
                              "explanation": f"{p['region']} for {p['consecutive_days']} days"})
    for e in elevated:
        active_alerts.append({"athlete": e['name'], "type": "Elevated training load", "current": e['latest_load'],
                              "previous": e['personal_avg'], "change": (f"+{e['pct_diff']}%" if e['pct_diff'] is not None else None),
                              "date": e['latest_date'], "explanation": "Latest load above personal average"})
    for nr in non_responders:
        active_alerts.append({"athlete": nr['athlete'], "type": "No response >3 days", "current": None,
                              "previous": nr['last_known_readiness'], "change": None, "date": nr['last_check_in'],
                              "explanation": f"{nr['days_without_response']} days without check-in" if nr['days_without_response'] is not None else "Never responded"})

    # ---------- Radar (selected date only) ----------
    radar = []
    if today_entries:
        m = len(today_entries)
        radar = [
            {"dimension": "Sleep Quality", "value": round(sum(e['sleep_quality'] for e in today_entries) / m, 1)},
            {"dimension": "Energy Level", "value": round(sum(e.get('fatigue_score_10', 10 - e.get('morning_fatigue', 5)) for e in today_entries) / m, 1)},
            {"dimension": "Muscle Recovery", "value": round(sum(e.get('soreness_score_10', 10 - e.get('muscle_soreness', 5)) for e in today_entries) / m, 1)},
            {"dimension": "Mental Wellness", "value": round(sum(e.get('stress_score_10', 10 - e.get('stress', 5)) for e in today_entries) / m, 1)},
            {"dimension": "Readiness to Train", "value": round(sum(e.get('readiness', e.get('readiness_score', 5)) for e in today_entries) / m, 1)},
        ]

    return {
        "date": target_date,
        "team": team or "All athletes",
        "summary": summary,
        "readiness_report": readiness_rows,
        "active_alerts": active_alerts,
        "training_load": training_load,
        "pain_summary": pain_summary,
        "pain_report": pain_rows,
        "persistent_pain": persistent_rows,
        "non_responders": non_responders,
        "radar": {"responders_count": len(today_entries), "dimensions": radar},
    }


class PainFollowupUpsert(BaseModel):
    athlete_id: str
    region: str
    side: str = "Unspecified"
    status: str
    note: Optional[str] = None


@api_router.get("/staff/pain-management")
async def get_pain_management(team: Optional[str] = None, days: int = 21, current_user: dict = Depends(get_current_user)):
    """Open pain cases (per athlete/region/side) over the window, with latest intensity,
    context (session type/source), consecutive days and the staff follow-up record."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    from collections import defaultdict

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(300)
    ids = [a['id'] for a in athletes]
    name_map = {a['id']: a['name'] for a in athletes}
    team_map = {a['id']: a.get('team') for a in athletes}

    win_start = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    win_start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    side_map = {'Left': 'Left', 'Right': 'Right', 'Both': 'Bilateral', 'N/A': 'Unspecified'}

    cases = defaultdict(lambda: {"events": []})

    def add(aid, region, laterality, date, level, source):
        try:
            lvl = int(level or 0)
        except (TypeError, ValueError):
            lvl = 0
        if lvl <= 0 or not region or not date:
            return
        side = side_map.get(laterality, 'Unspecified')
        cases[(aid, region, side)]["events"].append({"date": date[:10], "level": lvl, "source": source})

    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": win_start_iso}}, {"_id": 0}
    ).to_list(20000)
    for s in sessions:
        d = (s.get('date_time_start') or '')[:10]
        src = s.get('session_type') or 'Training'
        prs = s.get('pain_reports') or []
        if prs:
            for pr in prs:
                add(s['athlete_id'], _pr_region(pr), pr.get('laterality') or 'N/A', d, pr.get('pain_level', 0), src)
        elif s.get('pain_after', 0):
            add(s['athlete_id'], s.get('body_region'), s.get('laterality') or 'N/A', d, s.get('pain_after', 0), src)
    for coll, label in [("daily_readiness", "Morning Check-in"), ("recovery_logs", "Recovery")]:
        rows = await db[coll].find({"athlete_id": {"$in": ids}, "date": {"$gte": win_start}}, {"_id": 0}).to_list(20000)
        for r in rows:
            for pr in (r.get('pain_reports') or []):
                add(r['athlete_id'], _pr_region(pr), pr.get('laterality') or 'N/A', r.get('date'), pr.get('pain_level', 0), label)

    fu_docs = await db.pain_followups.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(3000)
    fu_map = {(f['athlete_id'], f.get('region'), f.get('side')): f for f in fu_docs}

    def streak(dates):
        ds = sorted(dates)
        if not ds:
            return 0
        best = 1; cur = 1
        for i in range(1, len(ds)):
            gap = (datetime.fromisoformat(ds[i]) - datetime.fromisoformat(ds[i - 1])).days
            cur = cur + 1 if gap <= 2 else 1
            best = max(best, cur)
        return best

    result = []
    for (aid, region, side), v in cases.items():
        evs = sorted(v["events"], key=lambda e: e["date"])
        latest = evs[-1]
        strong = [e["date"] for e in evs if e["level"] >= 5]
        consecutive = streak(set(strong))
        fu = fu_map.get((aid, region, side))
        result.append({
            "athlete_id": aid,
            "athlete": name_map.get(aid, 'Unknown'),
            "team": team_map.get(aid),
            "region": region,
            "side": side,
            "latest_intensity": latest["level"],
            "latest_date": latest["date"],
            "latest_context": latest["source"],
            "reports_count": len(evs),
            "consecutive_days": consecutive,
            "follow_up_status": fu['status'] if fu else 'Not reviewed',
            "follow_up_note": fu.get('note') if fu else '',
            "follow_up_updated_by": fu.get('updated_by') if fu else None,
            "follow_up_updated_at": fu.get('updated_at') if fu else None,
        })
    result.sort(key=lambda x: (x["latest_intensity"], x["consecutive_days"]), reverse=True)
    return {"count": len(result), "cases": result}


@api_router.post("/staff/pain-followup")
async def upsert_pain_followup(body: PainFollowupUpsert, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    doc = {
        "athlete_id": body.athlete_id,
        "region": body.region,
        "side": body.side or "Unspecified",
        "status": body.status,
        "note": (body.note or "").strip() or None,
        "updated_by": current_user.get('name') or current_user.get('email'),
        "updated_at": local_now().isoformat(),
    }
    await db.pain_followups.update_one(
        {"athlete_id": doc["athlete_id"], "region": doc["region"], "side": doc["side"]},
        {"$set": doc}, upsert=True
    )
    return {"success": True, "follow_up": doc}


class AthleteNoteCreate(BaseModel):
    body: str
    category: str = "General"
    related: Optional[str] = None


@api_router.get("/staff/athlete/{athlete_id}/notes")
async def get_athlete_notes(athlete_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    notes = await db.athlete_notes.find({"athlete_id": athlete_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"count": len(notes), "notes": notes}


@api_router.post("/staff/athlete/{athlete_id}/notes")
async def add_athlete_note(athlete_id: str, body: AthleteNoteCreate, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note body is required")
    doc = {
        "id": str(uuid.uuid4()),
        "athlete_id": athlete_id,
        "author": current_user['user'].get('name') or current_user['user'].get('email'),
        "author_role": current_user['user'].get('role'),
        "category": body.category or "General",
        "related": (body.related or None),
        "body": text,
        "created_at": local_now().isoformat(),
    }
    await db.athlete_notes.insert_one(dict(doc))
    return {"success": True, "note": doc}


@api_router.delete("/staff/athlete-note/{note_id}")
async def delete_athlete_note(note_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    res = await db.athlete_notes.delete_one({"id": note_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"success": True}


@api_router.get("/staff/mental-health")
async def get_mental_health(team: Optional[str] = None, days: int = 14, current_user: dict = Depends(get_current_user)):
    """Individual + team wellness metrics: sleep, energy, mental wellness, stress,
    readiness-to-train and pain — from the morning check-in, over the selected window."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    from collections import defaultdict

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(300)
    ids = [a['id'] for a in athletes]
    name_map = {a['id']: a['name'] for a in athletes}
    team_map = {a['id']: a.get('team') for a in athletes}

    win_days = max(0, days)
    start_date = (local_now() - timedelta(days=win_days)).strftime("%Y-%m-%d")
    entries = await db.daily_readiness.find(
        {"athlete_id": {"$in": ids}, "date": {"$gte": start_date}}, {"_id": 0}
    ).to_list(20000)

    def metrics(e):
        pains = [p.get('pain_level', 0) for p in (e.get('pain_reports') or []) if (p.get('pain_level') or 0) > 0]
        return {
            "sleep": e.get('sleep_quality'),
            "energy": e.get('fatigue_score_10', 10 - e.get('morning_fatigue', 5)),
            "recovery": e.get('soreness_score_10', 10 - e.get('muscle_soreness', 5)),
            "mental_wellness": e.get('stress_score_10', 10 - e.get('stress', 5)),
            "stress": e.get('stress'),
            "readiness": e.get('readiness', e.get('readiness_score')),
            "pain": max(pains) if pains else 0,
            "has_pain": 1 if pains else 0,
        }

    # ---- team daily series ----
    by_date = defaultdict(list)
    for e in entries:
        by_date[e['date']].append(metrics(e))
    KEYS = ["sleep", "energy", "mental_wellness", "stress", "readiness"]
    team_series = []
    for d in sorted(by_date.keys()):
        rows = by_date[d]
        n = len(rows)
        pt = {"date": d, "responders": n}
        for k in KEYS:
            vals = [r[k] for r in rows if r[k] is not None]
            pt[k] = round(sum(vals) / len(vals), 1) if vals else None
        pains = [r["pain"] for r in rows]
        pt["avg_pain"] = round(sum(pains) / len(pains), 1) if pains else 0
        pt["pain_incidence"] = sum(r["has_pain"] for r in rows)
        team_series.append(pt)

    # ---- per-athlete latest + window average ----
    per = defaultdict(list)
    for e in entries:
        per[e['athlete_id']].append(e)
    athlete_rows = []
    for a in athletes:
        rows = sorted(per.get(a['id'], []), key=lambda x: x['date'])
        if not rows:
            athlete_rows.append({"athlete_id": a['id'], "name": a['name'], "team": team_map.get(a['id']),
                                 "responded": False, "latest_date": None})
            continue
        latest = metrics(rows[-1])
        allm = [metrics(r) for r in rows]
        def avg(k):
            vals = [m[k] for m in allm if m[k] is not None]
            return round(sum(vals) / len(vals), 1) if vals else None
        athlete_rows.append({
            "athlete_id": a['id'], "name": a['name'], "team": team_map.get(a['id']),
            "responded": True, "latest_date": rows[-1]['date'], "entries": len(rows),
            **latest,
            "avg_sleep": avg("sleep"), "avg_energy": avg("energy"), "avg_mental_wellness": avg("mental_wellness"),
            "avg_stress": avg("stress"), "avg_readiness": avg("readiness"), "avg_pain": avg("pain"),
            "avg_recovery": avg("recovery"),
        })
    athlete_rows.sort(key=lambda r: (r.get('readiness') if r.get('readiness') is not None else 99))

    # ---- team summary (window responders) ----
    all_metrics = [metrics(e) for e in entries]
    def team_avg(k):
        vals = [m[k] for m in all_metrics if m[k] is not None]
        return round(sum(vals) / len(vals), 1) if vals else None
    responders_set = {e['athlete_id'] for e in entries}
    team_summary = {
        "athletes": len(athletes),
        "responders": len(responders_set),
        "sleep": team_avg("sleep"), "energy": team_avg("energy"),
        "mental_wellness": team_avg("mental_wellness"), "stress": team_avg("stress"),
        "readiness": team_avg("readiness"), "recovery": team_avg("recovery"),
        "avg_pain": round(sum(m["pain"] for m in all_metrics) / len(all_metrics), 1) if all_metrics else 0,
        "pain_athletes": len({e['athlete_id'] for e in entries if any((p.get('pain_level') or 0) > 0 for p in (e.get('pain_reports') or []))}),
    }

    return {
        "team": team or "All athletes",
        "window_days": win_days,
        "team_summary": team_summary,
        "team_series": team_series,
        "athletes": athlete_rows,
    }


@api_router.get("/staff/non-responders")
async def get_non_responders(team: Optional[str] = None, days: int = 3, current_user: dict = Depends(get_current_user)):
    """Athletes who have not submitted a daily check-in for more than `days` days.
    Meant as a compliance alert to pass to supervisors/coaches. Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    from datetime import date as _date

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(300)

    today = local_now().date()
    result = []
    for a in athletes:
        last = await db.daily_readiness.find_one(
            {"athlete_id": a['id']},
            sort=[("date", -1)],
            projection={"_id": 0, "date": 1}
        )
        last_date_str = last.get('date') if last else None
        days_since = None
        if last_date_str:
            try:
                ld = _date.fromisoformat(last_date_str[:10])
                days_since = (today - ld).days
            except Exception:
                days_since = None
        # Include if never responded OR last response is older than the threshold
        if last_date_str is None or (days_since is not None and days_since > days):
            result.append({
                "athlete_id": a['id'],
                "name": a['name'],
                "team": a.get('team'),
                "last_response": last_date_str,
                "days_since": days_since,
            })

    # Sort: never-responded first, then longest gap
    result.sort(key=lambda x: (x['days_since'] is not None, -(x['days_since'] or 0)))
    return {"threshold_days": days, "count": len(result), "athletes": result}



@api_router.get("/staff/rankings")
async def get_rankings(team: Optional[str] = None, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Athlete leaderboards over the window: adherence (top/low), readiness average
    (best/worst), most days with pain reports, and highest accumulated load. Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(300)
    ids = [a['id'] for a in athletes]
    meta = {a['id']: {"name": a['name'], "team": a.get('team')} for a in athletes}

    start = datetime.now(timezone.utc) - timedelta(days=days)
    start_date_str = start.strftime("%Y-%m-%d")
    start_iso = start.isoformat()

    readiness = await db.daily_readiness.find(
        {"athlete_id": {"$in": ids}, "date": {"$gte": start_date_str}},
        {"_id": 0, "athlete_id": 1, "date": 1, "readiness_score": 1, "pain_reports": 1}
    ).to_list(20000)
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}},
        {"_id": 0, "athlete_id": 1, "date_time_start": 1, "internal_load": 1, "pain_reports": 1}
    ).to_list(20000)

    agg = {aid: {"checkins": set(), "r_sum": 0.0, "r_n": 0, "pain_dates": set(), "load": 0.0} for aid in ids}

    for r in readiness:
        aid = r['athlete_id']
        if aid not in agg:
            continue
        d = r.get('date')
        if d:
            agg[aid]["checkins"].add(d)
        rs = r.get('readiness_score')
        if rs is not None:
            agg[aid]["r_sum"] += rs
            agg[aid]["r_n"] += 1
        if r.get('pain_reports') and d:
            agg[aid]["pain_dates"].add(d)

    for s in sessions:
        aid = s['athlete_id']
        if aid not in agg:
            continue
        d = (s.get('date_time_start') or '')[:10]
        agg[aid]["load"] += (s.get('internal_load') or 0)
        if s.get('pain_reports') and d:
            agg[aid]["pain_dates"].add(d)

    rows = []
    for aid, v in agg.items():
        rows.append({
            "athlete_id": aid,
            "name": meta[aid]["name"],
            "team": meta[aid]["team"],
            "adherence_pct": round(100 * len(v["checkins"]) / days) if days else 0,
            "checkins": len(v["checkins"]),
            "readiness_avg": round(v["r_sum"] / v["r_n"], 1) if v["r_n"] else None,
            "pain_days": len(v["pain_dates"]),
            "total_load": round(v["load"]),
        })

    def top(key, n=10, reverse=True, require=None):
        pool = [r for r in rows if (require is None or r.get(require) is not None)]
        return sorted(pool, key=lambda r: (r.get(key) if r.get(key) is not None else -1), reverse=reverse)[:n]

    with_readiness = [r for r in rows if r["readiness_avg"] is not None]
    return {
        "days": days,
        "top_adherence": top("adherence_pct", reverse=True),
        "low_adherence": sorted(rows, key=lambda r: r["adherence_pct"])[:10],
        "best_readiness": sorted(with_readiness, key=lambda r: r["readiness_avg"], reverse=True)[:10],
        "worst_readiness": sorted(with_readiness, key=lambda r: r["readiness_avg"])[:10],
        "most_pain_days": [r for r in top("pain_days", reverse=True) if r["pain_days"] > 0],
        "highest_load": [r for r in top("total_load", reverse=True) if r["total_load"] > 0],
    }



@api_router.get("/staff/dashboard/load-monitoring")
async def get_load_monitoring(team: Optional[str] = None, athlete_id: Optional[str] = None, days: int = 7, current_user: dict = Depends(get_current_user)):
    """Training-load monitoring: accumulated internal load per athlete over the
    window, the team mean, and a high-load threshold (mean + 1 SD, or mean*1.3
    when there are too few athletes to compute a reliable SD). Flags athletes
    whose accumulated load is above the threshold."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    from collections import defaultdict

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(200)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    ids = [a['id'] for a in athletes]

    start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}},
        {"_id": 0}
    ).to_list(5000)

    per = defaultdict(lambda: {"total_load": 0, "sessions": 0})
    athlete_day = defaultdict(int)
    for s in sessions:
        aid = s['athlete_id']
        load = int(s.get("internal_load", 0) or 0)
        per[aid]["total_load"] += load
        per[aid]["sessions"] += 1
        d = (s.get("date_time_start") or "")[:10]
        athlete_day[(aid, d)] += load

    # Daily team series (avg / max / total across athlete-day loads)
    day_loads = defaultdict(list)
    day_peak = {}  # d -> (aid, load)
    per_athlete_days = defaultdict(dict)
    for (aid, d), v in athlete_day.items():
        day_loads[d].append(v)
        per_athlete_days[aid][d] = v
        if d not in day_peak or v > day_peak[d][1]:
            day_peak[d] = (aid, v)
    name_map = {a['id']: a.get('name', '—') for a in athletes}
    daily = []
    for d in sorted(day_loads.keys()):
        vals = day_loads[d]
        peak_aid = day_peak[d][0] if d in day_peak else None
        daily.append({
            "date": d,
            "avg": round(sum(vals) / len(vals)),
            "max": max(vals),
            "total": sum(vals),
            "peak_athlete": name_map.get(peak_aid, '—'),
        })

    # Mean / SD across athletes who actually trained
    loads = [per[aid]["total_load"] for aid in per if per[aid]["total_load"] > 0]
    n = len(loads)
    team_mean = round(sum(loads) / n, 1) if n else None
    team_sd = None
    threshold = None
    method = None
    if n >= 3:
        mean_v = sum(loads) / n
        variance = sum((x - mean_v) ** 2 for x in loads) / n
        sd_v = variance ** 0.5
        team_sd = round(sd_v, 1)
        threshold = round(mean_v + sd_v, 1)
        method = "mean+1sd"
    elif n >= 1:
        threshold = round(team_mean * 1.3, 1)
        method = "mean*1.3"

    result_athletes = []
    for a in athletes:
        aid = a['id']
        tl = per[aid]["total_load"] if aid in per else 0
        sc = per[aid]["sessions"] if aid in per else 0
        high = bool(threshold is not None and tl > 0 and tl > threshold)
        pct_above = round(100 * (tl - team_mean) / team_mean) if (team_mean and tl > 0) else None
        # Latest training day's load vs the athlete's own average TRAINING-day load
        # (rest days are excluded so light/rest days don't deflate the baseline)
        adays = per_athlete_days.get(aid, {})
        latest_day = max(adays.keys()) if adays else None
        day_load = adays.get(latest_day, 0) if latest_day else 0
        training_days = len(adays)
        avg_daily = round(tl / training_days) if training_days else 0
        day_vs_avg_pct = round(100 * (day_load - avg_daily) / avg_daily) if avg_daily else None
        result_athletes.append({
            "id": aid, "name": a['name'], "team": a.get("team"),
            "total_load": tl, "sessions": sc,
            "avg_per_session": round(tl / sc) if sc else 0,
            "high": high, "pct_above": pct_above,
            "day_load": day_load, "day_date": latest_day,
            "avg_daily": avg_daily, "day_vs_avg_pct": day_vs_avg_pct,
        })
    result_athletes.sort(key=lambda x: x["total_load"], reverse=True)

    day_vals = [a["day_load"] for a in result_athletes if a["day_load"] > 0]
    team_day_mean = round(sum(day_vals) / len(day_vals)) if day_vals else None

    return {
        "days": days,
        "team_mean": team_mean,
        "team_sd": team_sd,
        "team_day_mean": team_day_mean,
        "threshold": threshold,
        "threshold_method": method,
        "total_team_load": sum(per[aid]["total_load"] for aid in per),
        "athletes_with_sessions": n,
        "high_count": sum(1 for a in result_athletes if a["high"]),
        "athletes": result_athletes,
        "daily": daily,
    }


@api_router.get("/staff/dashboard/session-type-distribution")
async def get_session_type_distribution(team: Optional[str] = None, athlete_id: Optional[str] = None, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Distribution of training session types (free-text) across the team over the window."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    from collections import defaultdict

    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1}).to_list(500)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    ids = [a['id'] for a in athletes]

    start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}},
        {"_id": 0, "session_type": 1}
    ).to_list(10000)

    counts = defaultdict(int)
    for s in sessions:
        t = (s.get("session_type") or "").strip() or "Unspecified"
        counts[t] += 1

    total = sum(counts.values())
    dist = sorted(
        [{"name": k, "value": v, "pct": round(100 * v / total, 1) if total else 0} for k, v in counts.items()],
        key=lambda x: x["value"], reverse=True
    )
    return {"days": days, "total": total, "distribution": dist}




# Team Readiness Radar Chart - Daily snapshot of team wellness dimensions
@api_router.get("/staff/dashboard/readiness-radar")
async def get_team_readiness_radar(team: Optional[str] = None, athlete_id: Optional[str] = None, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get team average daily readiness radar data for a specific day.
    Each axis represents a wellness dimension (Sleep, Fatigue, Soreness, Stress, Readiness).
    All values are normalized to 0-10 scale where higher = better.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Calculate the target date
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get athletes filter
    athlete_query = {"status": "approved"}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
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
    fourteen_days_ago = (local_now() - timedelta(days=14)).strftime("%Y-%m-%d")
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Verify athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    # Calculate the target date
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get readiness entry for the specific date
    readiness_entry = await db.daily_readiness.find_one(
        {"athlete_id": athlete_id, "date": target_date},
        {"_id": 0}
    )
    
    if readiness_entry:
        # Build radar data with consistent ordering (same as team radar)
        fatigue_val = readiness_entry.get('morning_fatigue', readiness_entry.get('fatigue_level', 5))
        stress_val = readiness_entry.get('stress', readiness_entry.get('stress_level', 5))
        radar_data = [
            {"dimension": "Sleep Quality", "value": readiness_entry['sleep_quality'], "fullMark": 10},
            {"dimension": "Energy Level", "value": readiness_entry.get('fatigue_score_10', 10 - fatigue_val), "fullMark": 10},
            {"dimension": "Muscle Recovery", "value": readiness_entry.get('soreness_score_10', 10 - readiness_entry['muscle_soreness']), "fullMark": 10},
            {"dimension": "Mental Wellness", "value": readiness_entry.get('stress_score_10', 10 - stress_val), "fullMark": 10},
            {"dimension": "Readiness to Train", "value": readiness_entry.get('readiness', readiness_entry.get('readiness_score', 5)), "fullMark": 10},
        ]
        has_data = True
    else:
        radar_data = []
        has_data = False
    
    # Get available dates (last 14 days with data for this athlete)
    fourteen_days_ago = (local_now() - timedelta(days=14)).strftime("%Y-%m-%d")
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
async def get_daily_pain_by_region(team: Optional[str] = None, athlete_id: Optional[str] = None, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get pain reports grouped by body region for a specific day.
    Returns frequency and severity of pain by body region for that day only.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Calculate target date
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get athletes filter
    athlete_query = {"status": "approved"}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
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
    
    def add_pain_to_region(region, pain, laterality, athlete_id, source="Training"):
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
                    "entries": [],
                    "left_count": 0,
                    "right_count": 0,
                    "both_count": 0
                }
            
            region_data[region]["count"] += 1
            region_data[region]["total_pain"] += pain
            region_data[region]["athletes"].add(athlete_names.get(athlete_id, 'Unknown'))
            region_data[region]["entries"].append({
                "athlete_id": athlete_id,
                "athlete_name": athlete_names.get(athlete_id, 'Unknown'),
                "laterality": laterality or "N/A",
                "pain_level": pain,
                "source": source,
            })
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
                region = _pr_region(pr)
                pain = pr.get('pain_level', 0)
                laterality = pr.get('laterality', 'N/A')
                if add_pain_to_region(region, pain, laterality, athlete_id, "Training"):
                    session_had_pain = True
        
        # Also check legacy single-pain format
        region = session.get('body_region', 'None')
        pain = session.get('pain_after', 0)
        laterality = session.get('laterality', 'N/A')
        if add_pain_to_region(region, pain, laterality, athlete_id, "Training"):
            session_had_pain = True
        
        if session_had_pain:
            sessions_with_pain += 1

    # Also include pain reported in Morning Check-in (daily_readiness) for that day
    readiness_today = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": target_date}, {"_id": 0}
    ).to_list(500)
    for rd in readiness_today:
        aid = rd.get('athlete_id')
        had = False
        for pr in (rd.get('pain_reports') or []):
            if add_pain_to_region(_pr_region(pr), pr.get('pain_level', 0), pr.get('laterality', 'N/A'), aid, "Morning Check-in"):
                had = True
        if had:
            sessions_with_pain += 1

    # Also include pain reported in Recovery Points logs for that day
    recovery_today = await db.recovery_logs.find(
        {"athlete_id": {"$in": athlete_ids}, "date": target_date}, {"_id": 0}
    ).to_list(2000)
    recovery_pain_athletes = set()
    for rl in recovery_today:
        aid = rl.get('athlete_id')
        for pr in (rl.get('pain_reports') or []):
            if add_pain_to_region(_pr_region(pr), pr.get('pain_level', 0), pr.get('laterality', 'N/A'), aid, "Recovery"):
                recovery_pain_athletes.add(aid)
    sessions_with_pain += len(recovery_pain_athletes)

    # Convert to list and calculate averages
    pain_regions = []
    for region, data in region_data.items():
        entries = sorted(data["entries"], key=lambda e: e["pain_level"], reverse=True)
        pain_regions.append({
            "region": region,
            "count": data["count"],
            "avg_pain": round(data["total_pain"] / data["count"], 1) if data["count"] > 0 else 0,
            "severe_count": data["severe_count"],
            "athletes": list(data["athletes"]),
            "entries": entries,
            "left_count": data["left_count"],
            "right_count": data["right_count"],
            "both_count": data["both_count"]
        })
    
    # Sort by count (most frequent first)
    pain_regions.sort(key=lambda x: x["count"], reverse=True)
    
    # Get available dates (last 14 days) from sessions + morning check-ins + recovery
    fourteen_days_ago = (local_now() - timedelta(days=14)).strftime("%Y-%m-%d")
    available_sessions = await db.training_sessions.find(
        {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": f"{fourteen_days_ago}T00:00:00"}},
        {"_id": 0, "date_time_start": 1}
    ).to_list(1000)
    avail = set(s['date_time_start'][:10] for s in available_sessions)
    rd_dates = await db.daily_readiness.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": fourteen_days_ago}},
        {"_id": 0, "date": 1}
    ).to_list(2000)
    avail.update(d['date'] for d in rd_dates if d.get('date'))
    rl_dates = await db.recovery_logs.find(
        {"athlete_id": {"$in": athlete_ids}, "date": {"$gte": fourteen_days_ago}},
        {"_id": 0, "date": 1}
    ).to_list(3000)
    avail.update(d['date'] for d in rl_dates if d.get('date'))
    available_dates = sorted(avail, reverse=True)
    
    return {
        "date": target_date,
        "total_sessions": len(sessions),
        "sessions_with_pain": sessions_with_pain,
        "pain_regions": pain_regions,
        "most_affected": pain_regions[0] if pain_regions else None,
        "laterality_totals": laterality_data,
        "available_dates": available_dates[:14]
    }

# Individual Athlete Menstrual Status - For Athlete Profile
@api_router.get("/staff/athlete/{athlete_id}/menstrual-status")
async def get_athlete_menstrual_status(athlete_id: str, days_ago: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Get menstrual status for an individual female athlete for a specific day.
    Returns menstrual details and pain reports for the same day.
    Only applicable for female athletes.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Verify athlete exists and is female
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    is_female = athlete.get('team') == 'Brazil Lacrosse Women' or athlete.get('sexo') == 'Feminino'
    if not is_female:
        return {
            "is_female_athlete": False,
            "message": "Menstrual tracking not applicable for this athlete"
        }
    
    # Calculate target date
    target_date = (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
    # Get readiness data for target date
    readiness = await db.daily_readiness.find_one(
        {"athlete_id": athlete_id, "date": target_date},
        {"_id": 0}
    )
    
    # Get training sessions for target date
    start_of_day = f"{target_date}T00:00:00"
    end_of_day = f"{target_date}T23:59:59"
    
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_of_day, "$lte": end_of_day}},
        {"_id": 0}
    ).to_list(50)
    
    # Build pain reports from sessions
    pain_reports = []
    for session in sessions:
        session_pain_reports = session.get('pain_reports', [])
        if session_pain_reports:
            for pr in session_pain_reports:
                pain_reports.append({
                    "intensity": pr.get('pain_level', 0),
                    "region": pr.get('body_region', 'Unspecified'),
                    "laterality": pr.get('laterality', 'N/A'),
                    "session_type": session.get('session_type', 'Unknown')
                })
        else:
            pain_after = session.get('pain_after', 0)
            if pain_after > 0:
                pain_reports.append({
                    "intensity": pain_after,
                    "region": session.get('body_region', 'Unspecified'),
                    "laterality": session.get('laterality', 'N/A'),
                    "session_type": session.get('session_type', 'Unknown')
                })
    
    # Get available dates with menstrual data (last 30 days)
    thirty_days_ago = (local_now() - timedelta(days=30)).strftime("%Y-%m-%d")
    menstrual_history = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": thirty_days_ago}, "is_menstruating": True},
        {"_id": 0, "date": 1}
    ).to_list(100)
    
    available_dates = sorted(list(set(r['date'] for r in menstrual_history)), reverse=True)
    
    # Build response
    if not readiness:
        return {
            "is_female_athlete": True,
            "date": target_date,
            "athlete_name": athlete['name'],
            "has_checkin": False,
            "is_in_period": False,
            "menstrual_data": None,
            "pain_reports": pain_reports,
            "available_dates": available_dates
        }
    
    is_in_period = readiness.get('is_menstruating', False)
    
    menstrual_data = None
    if is_in_period:
        menstrual_data = {
            "flow": readiness.get('menstrual_flow', 'Unknown'),
            "pain_level": readiness.get('menstrual_pain', 'None'),
            "symptoms": readiness.get('menstrual_symptoms', []),
            "general_soreness": readiness.get('muscle_soreness', 0),
            "fatigue_level": readiness.get('fatigue_level', 0),
            "readiness_score": readiness.get('readiness_score', None)
        }
    
    return {
        "is_female_athlete": True,
        "date": target_date,
        "athlete_name": athlete['name'],
        "has_checkin": True,
        "is_in_period": is_in_period,
        "menstrual_data": menstrual_data,
        "pain_reports": pain_reports,
        "available_dates": available_dates
    }

# Individual Athlete Pain Map - For Anatomical Viewer
@api_router.get("/staff/athlete/{athlete_id}/pain-map")
async def get_athlete_pain_map(athlete_id: str, days_ago: int = 0, date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """
    Get pain locations for an individual athlete for a specific day.
    Returns list of body regions with pain for anatomical visualization.
    Supports both legacy single pain and new multiple pain_reports format.
    """
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Verify athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
    # Calculate target date (explicit date wins over days_ago)
    target_date = date if date else (local_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    
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
                    _pr_region(pr),
                    pr.get('laterality'),
                    pr.get('pain_level', 0),
                    session_type
                )
        
        # Also check legacy single pain format
        region = session.get('body_region', 'None')
        pain = session.get('pain_after', 0)
        laterality = session.get('laterality', 'N/A')
        add_pain_location(region, laterality, pain, session_type)

    # Notes reported alongside pain (athlete comments)
    notes = []

    def add_note(source, text):
        if text and str(text).strip():
            notes.append({"source": source, "note": str(text).strip()})

    for session in sessions:
        if session.get('pain_reports') or session.get('pain_after', 0):
            add_note(session.get('session_type', 'Session'), session.get('session_notes'))

    # Morning check-in pain + notes (daily_readiness)
    readiness_day = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": target_date}, {"_id": 0}
    ).to_list(10)
    for r in readiness_day:
        prs = r.get('pain_reports') or []
        for pr in prs:
            add_pain_location(_pr_region(pr), pr.get('laterality'), pr.get('pain_level', 0), 'Morning Check-in')
        if prs:
            add_note('Morning Check-in', r.get('notes'))

    # Recovery pain + notes
    recovery_day = await db.recovery_logs.find(
        {"athlete_id": athlete_id, "date": target_date}, {"_id": 0}
    ).to_list(10)
    for r in recovery_day:
        prs = r.get('pain_reports') or []
        for pr in prs:
            add_pain_location(_pr_region(pr), pr.get('laterality'), pr.get('pain_level', 0), 'Recovery')
        if prs:
            add_note('Recovery', r.get('notes'))

    # Pain reported via the Messages / Feedback Center
    msg_pain = await db.message_pain_details.find(
        {"athlete_id": athlete_id, "created_at": {"$gte": start_of_day, "$lte": f"{target_date}T23:59:59.999999"}},
        {"_id": 0}
    ).to_list(20)
    for pm in msg_pain:
        add_pain_location(pm.get('body_region'), pm.get('side'), pm.get('pain_intensity', 0), 'Message')
        add_note('Message', pm.get('additional_notes') or pm.get('aggravating_movements'))

    # Get available dates from all pain sources (last 14 days)
    fourteen_days_ago = (local_now() - timedelta(days=14)).strftime("%Y-%m-%d")
    available_sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": f"{fourteen_days_ago}T00:00:00"}},
        {"_id": 0, "date_time_start": 1}
    ).to_list(200)
    available_readiness = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": fourteen_days_ago}, "pain_reports.0": {"$exists": True}},
        {"_id": 0, "date": 1}
    ).to_list(200)

    date_set = set(s['date_time_start'][:10] for s in available_sessions)
    date_set.update(r['date'] for r in available_readiness if r.get('date'))
    available_dates = sorted(list(date_set), reverse=True)
    
    return {
        "date": target_date,
        "athlete_name": athlete['name'],
        "has_pain": len(pain_locations) > 0,
        "pain_locations": pain_locations,
        "notes": notes,
        "total_sessions": len(sessions),
        "available_dates": available_dates[:14]
    }

# Alerts
@api_router.get("/staff/alerts")
async def get_alerts(team: Optional[str] = None, athlete_id: Optional[str] = None, resolved: bool = False, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
    athlete_ids = [a['id'] for a in athletes]
    athlete_names = {a['id']: a['name'] for a in athletes}
    
    alerts = await db.alerts.find(
        {"athlete_id": {"$in": athlete_ids}, "resolved": resolved},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    # Add athlete names
    for alert in alerts:
        alert['athlete_name'] = athlete_names.get(alert['athlete_id'], 'Unknown')

    # Dynamic OVERLOAD alerts: latest training-day load > +30% of the athlete's own daily average (28d)
    try:
        from collections import defaultdict as _dd
        start_iso = (datetime.now(timezone.utc) - timedelta(days=28)).isoformat()
        ov_sessions = await db.training_sessions.find(
            {"athlete_id": {"$in": athlete_ids}, "date_time_start": {"$gte": start_iso}},
            {"_id": 0, "athlete_id": 1, "date_time_start": 1, "internal_load": 1}
        ).to_list(20000)
        by_athlete = _dd(dict)  # aid -> {date: load}
        for s in ov_sessions:
            aid = s['athlete_id']
            d = (s.get('date_time_start') or '')[:10]
            if d:
                by_athlete[aid][d] = by_athlete[aid].get(d, 0) + (s.get('internal_load') or 0)
        for aid, adays in by_athlete.items():
            if not adays:
                continue
            total = sum(adays.values())
            # Average over TRAINING days only (exclude rest days) to avoid false positives
            avg_daily = total / len(adays)
            latest = max(adays.keys())
            day_load = adays[latest]
            if avg_daily > 0 and day_load > 0:
                pct = round(100 * (day_load - avg_daily) / avg_daily)
                if pct > 30:
                    alerts.insert(0, {
                        "id": f"overload-{aid}-{latest}",
                        "athlete_id": aid,
                        "athlete_name": athlete_names.get(aid, 'Unknown'),
                        "type": "HIGH_LOAD_SPIKE",
                        "severity": "Red" if pct > 60 else "Yellow",
                        "message": f"Training load {pct}% above own average on {latest[5:]} ({day_load} vs {round(avg_daily)} AU/day)",
                        "resolved": False,
                        "created_at": latest,
                        "auto": True,
                    })
    except Exception:
        pass

    return alerts

@api_router.put("/staff/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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
    
    return {"success": True}

# Long-term chronic workload management endpoints
@api_router.get("/staff/dashboard/longterm")
async def get_longterm_data(team: Optional[str] = None, athlete_id: Optional[str] = None, months: int = 3, current_user: dict = Depends(get_current_user)):
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    athlete_query = {"active": True, "status": {"$in": ["approved", None]}}
    if team:
        athlete_query["team"] = team
    
    athletes = await db.athletes.find(athlete_query, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    if athlete_id:
        athletes = [a for a in athletes if a['id'] == athlete_id]
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
            date = (local_now() - timedelta(days=day_offset)).strftime("%Y-%m-%d")
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
        raise HTTPException(status_code=404, detail="Athlete not found")
    
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

    if request.include_recovery:
        data["recovery"] = await db.recovery_checks.find({
            "athlete_id": athlete_id,
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).sort("date", -1).to_list(1000)

    # Collect pain reports from ALL sources: training sessions, morning check-ins
    # (daily_readiness) and recovery submissions (recovery_logs).
    if request.include_pain:
        # 1) Training sessions
        for session in data.get("sessions", []):
            for pain in (session.get('pain_reports') or []):
                data["pain_reports"].append({
                    "date": session.get('date_time_start', '')[:10],
                    "session_type": session.get('session_type', 'Training'),
                    "body_region": pain.get('body_region', ''),
                    "laterality": pain.get('laterality', 'N/A'),
                    "pain_level": pain.get('pain_level', 0)
                })
        # 2) Morning check-ins (daily_readiness)
        readiness_docs = data.get("readiness") or await db.daily_readiness.find({
            "athlete_id": athlete_id,
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).to_list(1000)
        for rd in readiness_docs:
            for pain in (rd.get('pain_reports') or []):
                data["pain_reports"].append({
                    "date": rd.get('date', ''),
                    "session_type": "Morning Check-in",
                    "body_region": pain.get('body_region', ''),
                    "laterality": pain.get('laterality', 'N/A'),
                    "pain_level": pain.get('pain_level', 0)
                })
        # 3) Recovery submissions (recovery_logs)
        rec_logs = await db.recovery_logs.find({
            "athlete_id": athlete_id,
            "date": {"$gte": start_date, "$lte": end_date}
        }, {"_id": 0}).to_list(1000)
        for rl in rec_logs:
            for pain in (rl.get('pain_reports') or []):
                data["pain_reports"].append({
                    "date": rl.get('date', ''),
                    "session_type": "Recovery",
                    "body_region": pain.get('body_region', ''),
                    "laterality": pain.get('laterality', 'N/A'),
                    "pain_level": pain.get('pain_level', 0)
                })
    
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    return {"baseline": baseline}

@api_router.post("/cmj/athlete/{athlete_id}/baseline")
async def set_cmj_baseline(athlete_id: str, data: CMJBaselineCreate, current_user: dict = Depends(get_current_user)):
    """Create or update athlete's CMJ baseline"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Check athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
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
        return {"message": "Baseline updated successfully"}
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
        raise HTTPException(status_code=403, detail="Staff only")
    
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
        raise HTTPException(status_code=403, detail="Staff only")
    
    # Check athlete exists
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found")
    
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
    
    return {"message": "CMJ test recorded successfully", "test": test.model_dump()}

# CMJ Batch Testing (Evaluation Day)
@api_router.post("/cmj/batch")
async def create_cmj_batch_tests(data: CMJBatchTestCreate, current_user: dict = Depends(get_current_user)):
    """Batch record CMJ tests for multiple athletes (Evaluation Day workflow)"""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    
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
        raise HTTPException(status_code=403, detail="Staff only")
    
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

@api_router.get("/cmj/athlete/{athlete_id}/neuromuscular")
async def get_cmj_neuromuscular(athlete_id: str, days: int = 90, current_user: dict = Depends(get_current_user)):
    """Neuromuscular readiness monitoring: CMJ jump height per test day aligned with
    same-day wellness/readiness and training load (TRIMP = internal_load). Staff only."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")

    start = datetime.now(timezone.utc) - timedelta(days=days)
    start_date_str = start.strftime("%Y-%m-%d")
    start_iso = start.isoformat()

    tests = await db.cmj_tests.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date_str}},
        {"_id": 0}
    ).sort("date", 1).to_list(300)

    baseline = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})

    readiness_docs = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": start_date_str}},
        {"_id": 0, "date": 1, "readiness_score": 1}
    ).to_list(2000)
    r_map = {d['date']: d.get('readiness_score') for d in readiness_docs}

    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": start_iso}},
        {"_id": 0, "date_time_start": 1, "internal_load": 1, "staff_note": 1}
    ).to_list(3000)
    load_map = {}
    note_days = set()
    for s in sessions:
        d = (s.get('date_time_start') or '')[:10]
        if d:
            load_map[d] = load_map.get(d, 0) + (s.get('internal_load') or 0)
            if (s.get('staff_note') or '').strip():
                note_days.add(d)

    points = []
    for t in tests:
        d = t.get('date')
        points.append({
            "date": d,
            "cmj_best": t.get('cmj_best') or t.get('cmj_mean'),
            "cmj_mean": t.get('cmj_mean'),
            "readiness": r_map.get(d),
            "load": load_map.get(d),
            "has_staff_note": d in note_days,
            "context": t.get('context'),
        })

    return {
        "points": points,
        "baseline": baseline.get('jump_height_cm') if baseline else None,
        "has_data": len(points) > 0,
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
        raise HTTPException(status_code=403, detail="Staff only")
    
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

# Simple seed endpoint - just open in browser
@api_router.get("/seed-demo")
@api_router.post("/seed-demo")
async def seed_demo():
    """Create demo data using bulk inserts (production-safe, fast)."""
    import random
    import traceback
    from datetime import timedelta
    from uuid import uuid4 as uid
    
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        
        # --- Staff ---
        staff_list = [
            ("Cristina Velez", "cristina.velez@brasillacrosse.com", "Admin", "123456"),
            ("Daniel Patara", "pataradaniel@gmail.com", "Admin", "123456"),
            ("Coach Roberto", "coach@brazillacrosse.com", "Coach", "staff123"),
        ]
        staff_emails = [s[1] for s in staff_list]
        existing_staff = await db.staff_users.find({"email": {"$in": staff_emails}}, {"email": 1, "_id": 0}).to_list(50)
        existing_staff_emails = {s["email"] for s in existing_staff}
        
        new_staff_docs = []
        staff_results = []
        for name, email, role, pwd in staff_list:
            if email in existing_staff_emails:
                staff_results.append(f"exists: {email}")
            else:
                new_staff_docs.append({
                    "id": str(uid()), "email": email, "name": name, "role": role,
                    "password_hash": hash_password(pwd), "team": None,
                    "created_at": now_iso
                })
                staff_results.append(f"✓ {email}")
        if new_staff_docs:
            await db.staff_users.insert_many(new_staff_docs, ordered=False)
        
        # --- Athletes ---
        athletes = [
            ("Lucas Silva", "lucas.silva@email.com", "Brazil Lacrosse Men"),
            ("Pedro Santos", "pedro.santos@email.com", "Brazil Lacrosse Men"),
            ("Gabriel Costa", "gabriel.costa@email.com", "Brazil Lacrosse Men"),
            ("Rafael Oliveira", "rafael.oliveira@email.com", "Brazil Lacrosse Men"),
            ("Bruno Ferreira", "bruno.ferreira@email.com", "Brazil Lacrosse Men"),
            ("Diego Almeida", "diego.almeida@email.com", "Brazil Lacrosse Men"),
            ("Felipe Rodrigues", "felipe.rodrigues@email.com", "Brazil Lacrosse Men"),
            ("Thiago Martins", "thiago.martins@email.com", "Brazil Lacrosse Men"),
            ("Ana Oliveira", "ana.oliveira@email.com", "Brazil Lacrosse Women"),
            ("Julia Pereira", "julia.pereira@email.com", "Brazil Lacrosse Women"),
            ("Maria Souza", "maria.souza@email.com", "Brazil Lacrosse Women"),
            ("Camila Lima", "camila.lima@email.com", "Brazil Lacrosse Women"),
            ("Beatriz Santos", "beatriz.santos@email.com", "Brazil Lacrosse Women"),
            ("Larissa Costa", "larissa.costa@email.com", "Brazil Lacrosse Women"),
            ("Fernanda Silva", "fernanda.silva@email.com", "Brazil Lacrosse Women"),
            ("Carolina Rocha", "carolina.rocha@email.com", "Brazil Lacrosse Women"),
        ]
        athlete_emails = [a[1] for a in athletes]
        existing_athletes = await db.athletes.find(
            {"email": {"$in": athlete_emails}}, {"email": 1, "id": 1, "_id": 0}
        ).to_list(100)
        existing_athlete_map = {a["email"]: a["id"] for a in existing_athletes}
        
        new_athlete_docs = []
        athlete_results = []
        athlete_id_by_email = {}
        for name, email, team in athletes:
            if email in existing_athlete_map:
                athlete_id_by_email[email] = existing_athlete_map[email]
                athlete_results.append(f"exists: {name}")
            else:
                aid = str(uid())
                new_athlete_docs.append({
                    "id": aid, "email": email, "name": name, "team": team,
                    "password_hash": hash_password("demo123"), "status": "approved",
                    "active": True, "position": "Player",
                    "created_at": now_iso
                })
                athlete_id_by_email[email] = aid
                athlete_results.append(f"✓ {name}")
        if new_athlete_docs:
            await db.athletes.insert_many(new_athlete_docs, ordered=False)
        
        all_athlete_ids = list(athlete_id_by_email.values())
        
        # --- Team mapping for menstrual / role-specific data ---
        team_by_id = {athlete_id_by_email[email]: team for (name, email, team) in athletes}
        female_ids = [aid for aid in all_athlete_ids if team_by_id.get(aid) == "Brazil Lacrosse Women"]
        female_rank = {aid: i for i, aid in enumerate(female_ids)}

        # --- FRESH RESEED: wipe demo athletes' historical data so the full dataset always appears ---
        await db.daily_readiness.delete_many({"athlete_id": {"$in": all_athlete_ids}})
        await db.training_sessions.delete_many({"athlete_id": {"$in": all_athlete_ids}})
        await db.recovery_checks.delete_many({"athlete_id": {"$in": all_athlete_ids}})
        await db.cmj_baselines.delete_many({"athlete_id": {"$in": all_athlete_ids}})
        await db.cmj_tests.delete_many({"athlete_id": {"$in": all_athlete_ids}})
        await db.alerts.delete_many({"athlete_id": {"$in": all_athlete_ids}})

        today = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)

        # Reference staff id for CMJ "recorded_by"
        any_staff = await db.staff_users.find_one({}, {"id": 1, "_id": 0})
        recorded_by = any_staff["id"] if any_staff and any_staff.get("id") else "system"

        # Reference data pools
        session_types = ["Strength", "Conditioning", "Technical", "Tactical", "Match", "Recovery"]
        body_regions = ["Neck", "Shoulder", "Elbow", "WristHand", "LowBack", "HipGroin", "Knee", "AnkleFoot"]
        no_side_regions = {"Neck", "LowBack"}
        flow_levels = ["Light", "Moderate", "Heavy"]
        pain_levels_m = ["Mild", "Moderate", "Severe"]
        symptom_pool = ["cramps", "low_back_pain", "abdominal_pain", "headache", "breast_tenderness"]

        # Athletes that should show concerning trends for the demo (flagged panel + trends)
        decline_ids = set()
        if len(all_athlete_ids) > 0:
            decline_ids.add(all_athlete_ids[0])      # first male
        if female_ids:
            decline_ids.add(female_ids[0])           # first female

        # --- Build docs in memory ---
        readiness_docs = []
        session_docs = []
        recovery_docs = []

        TOTAL_DAYS = 45  # ~6 weeks of history for medium/long term views

        for aid in all_athlete_ids:
            is_decline = aid in decline_ids
            for days_ago in range(TOTAL_DAYS, -1, -1):
                date = today - timedelta(days=days_ago)
                date_str = date.strftime("%Y-%m-%d")
                day_number = TOTAL_DAYS - days_ago

                # ---------- Morning readiness (90% of days; always today for demo) ----------
                if days_ago == 0 or random.random() < 0.90:
                    sleep_q = random.randint(5, 9)
                    fatigue = random.randint(2, 6)
                    soreness = random.randint(2, 5)
                    stress = random.randint(2, 5)
                    ready = random.randint(5, 9)

                    # Inject a declining pattern in the last 5 days for flagged athletes
                    if is_decline and days_ago <= 4:
                        sleep_q = max(2, 7 - (4 - days_ago))
                        fatigue = min(9, 5 + (4 - days_ago))
                        soreness = min(9, 4 + (4 - days_ago))
                        ready = max(2, 6 - (4 - days_ago))

                    fatigue_inv = 10 - fatigue
                    soreness_inv = 10 - soreness
                    stress_inv = 10 - stress
                    readiness_score = round((sleep_q + fatigue_inv + soreness_inv + stress_inv + ready) / 5, 1)

                    r_doc = {
                        "id": str(uid()), "athlete_id": aid, "date": date_str,
                        "sleep_quality": sleep_q,
                        "morning_fatigue": fatigue,
                        "fatigue_level": fatigue,
                        "muscle_soreness": soreness,
                        "stress": stress,
                        "stress_level": stress,
                        "readiness": ready,
                        "fatigue_score_10": fatigue_inv,
                        "soreness_score_10": soreness_inv,
                        "stress_score_10": stress_inv,
                        "readiness_score": readiness_score,
                        "notes": None,
                        "created_at": date.isoformat(),
                    }

                    # ---------- Menstrual data for female athletes ----------
                    if aid in female_rank:
                        rank = female_rank[aid]
                        # Force a clear "today" picture for the female wellness monitor
                        if days_ago == 0 and rank < 4:
                            preset = [
                                ("Heavy", "Severe", ["cramps", "low_back_pain", "headache"]),
                                ("Moderate", "Moderate", ["cramps", "abdominal_pain"]),
                                ("Light", "Mild", ["cramps"]),
                                ("Moderate", "Very Severe", ["cramps", "low_back_pain", "breast_tenderness"]),
                            ][rank]
                            r_doc["is_menstruating"] = True
                            r_doc["menstrual_flow"] = preset[0]
                            r_doc["menstrual_pain"] = preset[1]
                            r_doc["menstrual_symptoms"] = preset[2]
                        else:
                            cycle_len = 28
                            offset = (rank * 4) % cycle_len
                            phase = (offset + day_number) % cycle_len
                            if phase < 5:
                                r_doc["is_menstruating"] = True
                                r_doc["menstrual_flow"] = flow_levels[min(2, phase // 2)]
                                r_doc["menstrual_pain"] = random.choice(pain_levels_m)
                                r_doc["menstrual_symptoms"] = random.sample(symptom_pool, k=random.randint(1, 3))
                            else:
                                r_doc["is_menstruating"] = False

                    readiness_docs.append(r_doc)

                # ---------- Training session (weekdays, ~85%) ----------
                if date.weekday() < 5 and random.random() < 0.85:
                    rpe = random.randint(5, 9)
                    dur = random.randint(45, 100)
                    pain_reports = []
                    pain_after = 0
                    pain_during = 0

                    # ~35% of sessions report pain (escalating for decline athletes)
                    pain_chance = 0.7 if (is_decline and days_ago <= 6) else 0.35
                    if random.random() < pain_chance:
                        n_regions = random.randint(1, 2)
                        chosen = random.sample(body_regions, k=n_regions)
                        for reg in chosen:
                            base_pain = random.randint(2, 6)
                            if is_decline and days_ago <= 6:
                                base_pain = min(9, base_pain + (6 - days_ago) // 2 + 2)
                            lateral = "N/A" if reg in no_side_regions else random.choice(["Left", "Right", "Both"])
                            pain_reports.append({
                                "body_region": reg,
                                "laterality": lateral,
                                "pain_level": base_pain,
                            })
                        pain_after = max(p["pain_level"] for p in pain_reports)
                        pain_during = max(0, pain_after - random.randint(0, 2))

                    session_docs.append({
                        "id": str(uid()), "athlete_id": aid,
                        "date_time_start": date.isoformat(),
                        "date_time_end": (date + timedelta(minutes=dur)).isoformat(),
                        "session_type": random.choice(session_types),
                        "duration_min": dur, "rpe": rpe, "internal_load": rpe * dur,
                        "pain_during": pain_during, "pain_before": 0, "pain_after": pain_after,
                        "end_fatigue": random.randint(4, 8),
                        "pain_reports": pain_reports,
                        "session_notes": None,
                        "created_at": date.isoformat(),
                    })

                # ---------- Evening recovery (~55% of days) ----------
                if random.random() < 0.55:
                    overall = random.randint(5, 9)
                    rec_q = random.randint(5, 9)
                    sleep_a = random.randint(5, 9)
                    res_pain = random.randint(0, 4)
                    recovery_docs.append({
                        "id": str(uid()), "athlete_id": aid, "date": date_str,
                        "overall_feeling": overall,
                        "recovery_quality": rec_q,
                        "sleep_after": sleep_a,
                        "residual_pain": res_pain,
                        "recovery_score": round((overall + rec_q + sleep_a + (10 - res_pain)) / 4, 2),
                        "session_id": None,
                        "created_at": date.isoformat(),
                    })

        # --- CMJ baselines + monitoring tests ---
        cmj_baseline_docs = []
        cmj_test_docs = []
        cmj_contexts = ["testing_session", "pre_training", "post_training", "retest"]
        for aid in all_athlete_ids:
            is_female = team_by_id.get(aid) == "Brazil Lacrosse Women"
            base_h = round(random.uniform(26, 34) if is_female else random.uniform(34, 46), 1)
            base_date = (today - timedelta(days=40)).strftime("%Y-%m-%d")
            cmj_baseline_docs.append({
                "id": str(uid()), "athlete_id": aid, "date": base_date,
                "jump_height_cm": base_h, "arms_used": False, "footwear": "shoes",
                "notes": None, "recorded_by": recorded_by,
                "created_at": (today - timedelta(days=40)).isoformat(), "updated_at": None,
            })
            is_decline = aid in decline_ids
            for i, days_ago in enumerate(range(35, -1, -7)):  # ~6 tests
                tdate = today - timedelta(days=days_ago)
                # Decline athletes show a downward CMJ trend toward the present
                drift = -(i * 0.8) if is_decline else random.uniform(-1.0, 1.5)
                t1 = round(base_h + drift + random.uniform(-1.2, 1.2), 1)
                t2 = round(base_h + drift + random.uniform(-1.2, 1.2), 1)
                t3 = round(base_h + drift + random.uniform(-1.2, 1.2), 1)
                best = max(t1, t2, t3)
                mean = round((t1 + t2 + t3) / 3, 1)
                cv = round((float(np.std([t1, t2, t3], ddof=1)) / mean * 100) if mean else 0, 1)
                cmj_test_docs.append({
                    "id": str(uid()), "athlete_id": aid, "date": tdate.strftime("%Y-%m-%d"),
                    "context": random.choice(cmj_contexts), "event_id": None, "arms_used": False,
                    "trials": {"trial_1": t1, "trial_2": t2, "trial_3": t3},
                    "cmj_best": best, "cmj_mean": mean, "cv_percent": cv,
                    "delta_best_percent": round((best - base_h) / base_h * 100, 1),
                    "delta_mean_percent": round((mean - base_h) / base_h * 100, 1),
                    "time_of_day": "morning", "notes": None, "recorded_by": recorded_by,
                    "created_at": tdate.isoformat(),
                })

        # --- Alerts (a few, descriptive) ---
        alert_docs = []
        alert_specs = []
        if len(all_athlete_ids) > 0:
            alert_specs.append((all_athlete_ids[0], "LowReadiness", "Yellow", "Readiness declining over the last few days"))
        if len(all_athlete_ids) > 3:
            alert_specs.append((all_athlete_ids[3], "HighLoadSpike", "Red", "Acute load spike detected (>1.5x average)"))
        if female_ids:
            alert_specs.append((female_ids[0], "PersistentPain", "Yellow", "Pain reported in recent sessions"))
        for aid, atype, sev, msg in alert_specs:
            alert_docs.append({
                "id": str(uid()), "athlete_id": aid, "alert_type": atype, "severity": sev,
                "message": msg, "resolved": False, "resolved_by": None, "resolved_at": None,
                "created_at": now_iso,
            })

        # --- Demo event ---
        events_created = 0
        existing_event = await db.events.find_one({"name": "Pre-Season Camp 2026"})
        if not existing_event:
            ev_start = (today - timedelta(days=3)).strftime("%Y-%m-%d")
            ev_end = (today + timedelta(days=4)).strftime("%Y-%m-%d")
            await db.events.insert_one({
                "id": str(uid()), "name": "Pre-Season Camp 2026", "event_type": "training_camp",
                "start_date": ev_start, "end_date": ev_end, "team": None,
                "description": "Demonstration preparation camp", "created_by": recorded_by,
                "created_at": now_iso, "is_active": True,
            })
            events_created = 1

        # --- Bulk insert in batches of 500 ---
        async def bulk_insert(collection, docs, batch_size=500):
            inserted = 0
            for i in range(0, len(docs), batch_size):
                batch = docs[i:i + batch_size]
                if batch:
                    await collection.insert_many(batch, ordered=False)
                    inserted += len(batch)
            return inserted

        checkins_created = await bulk_insert(db.daily_readiness, readiness_docs)
        sessions_created = await bulk_insert(db.training_sessions, session_docs)
        recovery_created = await bulk_insert(db.recovery_checks, recovery_docs)
        cmj_base_created = await bulk_insert(db.cmj_baselines, cmj_baseline_docs)
        cmj_test_created = await bulk_insert(db.cmj_tests, cmj_test_docs)
        alerts_created = await bulk_insert(db.alerts, alert_docs)

        return {
            "success": True,
            "staff": staff_results,
            "athletes": athlete_results,
            "data_created": (
                f"{checkins_created} check-ins, {sessions_created} sessions, "
                f"{recovery_created} recovery checks, {cmj_base_created} CMJ baselines, "
                f"{cmj_test_created} CMJ tests, {alerts_created} alerts, {events_created} event"
            ),
            "login": "cristina.velez@brasillacrosse.com / 123456",
        }
    
    except Exception as e:
        logger.error(f"Seed demo error: {str(e)}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


# Clear demo data endpoint
@api_router.delete("/admin/clear-demo-data")
async def clear_demo_data(current_user: dict = Depends(get_current_user)):
    """Clear all demo data - Admin only. Use when starting real usage."""
    if current_user['user_type'] != 'staff':
        raise HTTPException(status_code=403, detail="Staff only")
    if current_user['user']['role'] != 'Admin':
        raise HTTPException(status_code=403, detail="Admin only")
    
    # Demo athlete emails to remove
    demo_emails = [
        "lucas.silva@email.com", "pedro.santos@email.com", "gabriel.costa@email.com",
        "rafael.oliveira@email.com", "bruno.ferreira@email.com", "diego.almeida@email.com",
        "felipe.rodrigues@email.com", "thiago.martins@email.com", "ana.oliveira@email.com",
        "julia.pereira@email.com", "maria.souza@email.com", "camila.lima@email.com",
        "beatriz.santos@email.com", "larissa.costa@email.com", "fernanda.silva@email.com",
        "carolina.rocha@email.com"
    ]
    
    # Demo staff emails to remove (keep the real admins)
    demo_staff_emails = ["coach@brazillacrosse.com", "fisio@brazillacrosse.com"]
    
    try:
        # Get demo athlete IDs
        demo_athletes = await db.athletes.find(
            {"email": {"$in": demo_emails}},
            {"id": 1}
        ).to_list(100)
        demo_athlete_ids = [a["id"] for a in demo_athletes]
        
        # Delete related data for demo athletes
        readiness_deleted = await db.daily_readiness.delete_many({"athlete_id": {"$in": demo_athlete_ids}})
        sessions_deleted = await db.training_sessions.delete_many({"athlete_id": {"$in": demo_athlete_ids}})
        cmj_deleted = await db.cmj_tests.delete_many({"athlete_id": {"$in": demo_athlete_ids}})
        
        # Delete demo athletes
        athletes_deleted = await db.athletes.delete_many({"email": {"$in": demo_emails}})
        
        # Delete demo staff (keep admins)
        staff_deleted = await db.staff_users.delete_many({"email": {"$in": demo_staff_emails}})
        
        logger.info(f"Demo data cleared by {current_user['user']['email']}")
        
        return {
            "success": True,
            "message": "Demo data removed successfully!",
            "deleted": {
                "athletes": athletes_deleted.deleted_count,
                "staff": staff_deleted.deleted_count,
                "check_ins": readiness_deleted.deleted_count,
                "sessions": sessions_deleted.deleted_count,
                "cmj_tests": cmj_deleted.deleted_count
            }
        }
    
    except Exception as e:
        logger.error(f"Error clearing demo data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Force seed endpoint (for production deployment)
@api_router.post("/admin/force-seed")
async def force_seed_data():
    """Force seed demo data - call this after deployment if data is missing"""
    import random
    from datetime import timedelta
    from uuid import uuid4 as gen_uuid
    
    try:
        # Staff users to create
        STAFF_USERS = [
            {"name": "Cristina Velez", "email": "cristina.velez@brasillacrosse.com", "role": "Admin", "password": "123456"},
            {"name": "Daniel Patara", "email": "pataradaniel@gmail.com", "role": "Admin", "password": "123456"},
            {"name": "Coach Roberto", "email": "coach@brazillacrosse.com", "role": "Coach", "password": "staff123"},
            {"name": "Fisio Mariana", "email": "fisio@brazillacrosse.com", "role": "Physio", "password": "staff123"},
        ]
        
        # Athletes
        MEN_ATHLETES = [
            {"name": "Lucas Silva", "email": "lucas.silva@email.com", "position": "Midfielder"},
            {"name": "Pedro Santos", "email": "pedro.santos@email.com", "position": "Attack"},
            {"name": "Gabriel Costa", "email": "gabriel.costa@email.com", "position": "Defense"},
            {"name": "Rafael Oliveira", "email": "rafael.oliveira@email.com", "position": "Goalie"},
            {"name": "Bruno Ferreira", "email": "bruno.ferreira@email.com", "position": "Midfielder"},
            {"name": "Diego Almeida", "email": "diego.almeida@email.com", "position": "Attack"},
            {"name": "Felipe Rodrigues", "email": "felipe.rodrigues@email.com", "position": "Defense"},
            {"name": "Thiago Martins", "email": "thiago.martins@email.com", "position": "Midfielder"},
        ]
        
        WOMEN_ATHLETES = [
            {"name": "Ana Oliveira", "email": "ana.oliveira@email.com", "position": "Midfielder"},
            {"name": "Julia Pereira", "email": "julia.pereira@email.com", "position": "Attack"},
            {"name": "Maria Souza", "email": "maria.souza@email.com", "position": "Defense"},
            {"name": "Camila Lima", "email": "camila.lima@email.com", "position": "Goalie"},
            {"name": "Beatriz Santos", "email": "beatriz.santos@email.com", "position": "Midfielder"},
            {"name": "Larissa Costa", "email": "larissa.costa@email.com", "position": "Attack"},
            {"name": "Fernanda Silva", "email": "fernanda.silva@email.com", "position": "Defense"},
            {"name": "Carolina Rocha", "email": "carolina.rocha@email.com", "position": "Midfielder"},
        ]
        
        SESSION_TYPES = ["Field Training", "Gym", "Technical", "Match", "Recovery", "Rehab", "Conditioning"]
        BODY_REGIONS = ["Shoulder", "Knee", "AnkleFoot", "HipGroin", "LowBack", "Quadriceps", "Hamstring", "Calf"]
        
        staff_created = 0
        athletes_created = 0
        
        # 1. Create Staff Users
        for staff in STAFF_USERS:
            existing = await db.staff_users.find_one({"email": staff["email"]})
            if not existing:
                await db.staff_users.insert_one({
                    "id": str(gen_uuid()),
                    "email": staff["email"],
                    "password_hash": hash_password(staff["password"]),
                    "name": staff["name"],
                    "role": staff["role"],
                    "team": None if staff["role"] == "Admin" else "All",
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                staff_created += 1
        
        # 2. Create Athletes
        all_athletes = []
        
        for athlete in MEN_ATHLETES + WOMEN_ATHLETES:
            team = "Brazil Lacrosse Men" if athlete in MEN_ATHLETES else "Brazil Lacrosse Women"
            existing = await db.athletes.find_one({"email": athlete["email"]})
            if not existing:
                athlete_data = {
                    "id": str(gen_uuid()),
                    "name": athlete["name"],
                    "email": athlete["email"],
                    "password_hash": hash_password("demo123"),
                    "team": team,
                    "position": athlete["position"],
                    "status": "approved",
                    "active": True,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                await db.athletes.insert_one(athlete_data)
                all_athletes.append(athlete_data)
                athletes_created += 1
            else:
                all_athletes.append(existing)
        
        # 3. Generate Training Data (last 30 days - simplified for faster execution)
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        readiness_count = 0
        session_count = 0
        
        for athlete in all_athletes:
            athlete_id = athlete["id"]
            team = athlete.get("team", "")
            is_female = "Women" in team
            
            for days_ago in range(30, -1, -1):
                date = today - timedelta(days=days_ago)
                date_str = date.strftime("%Y-%m-%d")
                
                if random.random() > 0.85:
                    continue
                
                # Daily Readiness
                existing_readiness = await db.daily_readiness.find_one({
                    "athlete_id": athlete_id,
                    "date": date_str
                })
                
                if not existing_readiness:
                    sleep_quality = random.randint(5, 9)
                    fatigue_level = random.randint(2, 7)
                    muscle_soreness = random.randint(2, 6)
                    stress_level = random.randint(2, 6)
                    readiness_score = round((sleep_quality + (10 - fatigue_level) + (10 - muscle_soreness) + (10 - stress_level)) / 4, 1)
                    
                    readiness_data = {
                        "id": str(gen_uuid()),
                        "athlete_id": athlete_id,
                        "date": date_str,
                        "sleep_quality": sleep_quality,
                        "fatigue_level": fatigue_level,
                        "morning_fatigue": fatigue_level,
                        "muscle_soreness": muscle_soreness,
                        "stress_level": stress_level,
                        "stress": stress_level,
                        "readiness_score": readiness_score,
                        "created_at": date.isoformat()
                    }
                    
                    if is_female and random.random() < 0.2:
                        readiness_data["menstrual_cycle"] = {
                            "is_on_period": True,
                            "flow_level": random.choice(["Light", "Moderate", "Heavy"]),
                            "pain_level": random.choice(["None", "Mild", "Moderate", "Severe"]),
                            "symptoms": random.sample(["Cramps", "Fatigue", "Headache"], k=random.randint(1, 2))
                        }
                    
                    await db.daily_readiness.insert_one(readiness_data)
                    readiness_count += 1
                
                # Training Sessions (skip weekends)
                if date.weekday() >= 5:
                    continue
                
                existing_session = await db.training_sessions.find_one({
                    "athlete_id": athlete_id,
                    "date_time_start": {"$regex": f"^{date_str}"}
                })
                
                if not existing_session:
                    session_type = random.choice(SESSION_TYPES)
                    rpe = random.randint(4, 9)
                    duration = random.randint(45, 90)
                    
                    session_time = date.replace(hour=random.choice([9, 10, 15, 16]))
                    
                    session_data = {
                        "id": str(gen_uuid()),
                        "athlete_id": athlete_id,
                        "date_time_start": session_time.isoformat(),
                        "date_time_end": (session_time + timedelta(minutes=duration)).isoformat(),
                        "session_type": session_type,
                        "duration_min": duration,
                        "rpe": rpe,
                        "internal_load": rpe * duration,
                        "pain_before": 0,
                        "pain_after": random.randint(0, 3) if random.random() < 0.15 else 0,
                        "pain_reports": [],
                        "created_at": session_time.isoformat()
                    }
                    
                    await db.training_sessions.insert_one(session_data)
                    session_count += 1
        
        return {
            "success": True,
            "message": "Demo data seeded successfully!",
            "staff_created": staff_created,
            "athletes_created": athletes_created,
            "readiness_created": readiness_count,
            "sessions_created": session_count,
            "credentials": {
                "admin": "cristina.velez@brasillacrosse.com / 123456",
                "coach": "coach@brazillacrosse.com / staff123",
                "athlete": "lucas.silva@email.com / demo123"
            }
        }
    
    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

# --- Push notifications (PWA) - register routes BEFORE include ---
from push_routes import register_push_routes, start_reminder_scheduler  # noqa: E402
register_push_routes(api_router, db, get_current_user)

# --- Clinical Intelligence (Phase 1) ---
from clinical_intelligence import register_clinical_intelligence_routes  # noqa: E402
register_clinical_intelligence_routes(api_router, db, get_current_user)

# --- Recovery Points Ecosystem (Phase 1) ---
from recovery_routes import register_recovery_routes, seed_recovery_catalog  # noqa: E402
from recovery_storage import init_storage as init_recovery_storage  # noqa: E402
register_recovery_routes(api_router, db, get_current_user)

# --- Nutrition & Hydration Calculator ---
from nutrition_routes import register_nutrition_routes  # noqa: E402
register_nutrition_routes(api_router, db, get_current_user)
from survey_routes import register_survey_routes, pending_mandatory_surveys  # noqa: E402
register_survey_routes(api_router, db, get_current_user)

# --- Event Report (AMS event analytics) ---
from event_report_routes import register_event_report_routes  # noqa: E402
register_event_report_routes(api_router, db, get_current_user)

from health_routes import register_health_routes  # noqa: E402
register_health_routes(api_router, db, get_current_user)

# --- Notification Center (custom reminders + staff notifications) ---
from notification_center_routes import (  # noqa: E402
    register_notification_center_routes,
    start_notification_center_scheduler,
)
register_notification_center_routes(api_router, db, get_current_user)

# --- Messages / Athlete Feedback Center ---
from messages_routes import register_messages_routes  # noqa: E402
register_messages_routes(api_router, db, get_current_user)

# --- The Fittest (social + consistency challenge) ---
from the_fittest_routes import register_the_fittest_routes, start_the_fittest_scheduler  # noqa: E402
register_the_fittest_routes(api_router, db, get_current_user)

from research_export_routes import register_research_routes  # noqa: E402
register_research_routes(api_router, db, get_current_user)

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
async def start_push_scheduler():
    """Start the push notification reminder scheduler."""
    try:
        start_reminder_scheduler(db)
    except Exception as e:
        logger.exception(f"Failed to start push scheduler: {e}")
    try:
        start_notification_center_scheduler(db)
    except Exception as e:
        logger.exception(f"Failed to start notification center scheduler: {e}")
    try:
        start_the_fittest_scheduler(db)
    except Exception as e:
        logger.exception(f"Failed to start The Fittest scheduler: {e}")

@app.on_event("startup")
async def init_recovery_module():
    """Seed recovery catalog and warm up object storage."""
    try:
        await seed_recovery_catalog(db)
    except Exception as e:
        logger.exception(f"Recovery catalog seed failed: {e}")
    try:
        init_recovery_storage()
    except Exception as e:
        logger.error(f"Recovery storage init failed (will retry on first upload): {e}")

@app.on_event("startup")
async def seed_admin_user():
    """Seed the predefined admin user on startup if it doesn't exist"""
    # First, check if admin email exists as an athlete and promote them
    existing_athlete = await db.athletes.find_one({"email": ADMIN_EMAIL})
    if existing_athlete:
        # Remove from athletes collection
        await db.athletes.delete_one({"email": ADMIN_EMAIL})
        logger.info(f"Removed {ADMIN_EMAIL} from athletes collection for admin promotion")
    
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

    # Backfill: grandfather all existing staff so nobody currently with an account
    # loses access when the approval/access-control workflow ships.
    await db.staff_users.update_many({"status": {"$exists": False}}, {"$set": {"status": "approved"}})
    await db.staff_users.update_many({"active": {"$exists": False}}, {"$set": {"active": True}})
    # Predefined Admins must always be approved + active
    await db.staff_users.update_many({"role": "Admin"}, {"$set": {"status": "approved", "active": True}})




@app.on_event("startup")
async def seed_presentation_data():
    """Seed presentation demo data on startup if database is empty"""
    import random
    from datetime import timedelta
    from uuid import uuid4
    
    logger.info("=== SEED PRESENTATION DATA STARTING ===")
    
    try:
        # Check if we already have athletes - if so, skip seeding
        athlete_count = await db.athletes.count_documents({})
        logger.info(f"Current athlete count: {athlete_count}")
        
        if athlete_count >= 10:
            logger.info(f"Database already has {athlete_count} athletes, skipping demo seed")
            return
        
        logger.info("Seeding presentation demo data...")
        
        # Staff users to create
        STAFF_USERS = [
            {"name": "Cristina Velez", "email": "cristina.velez@brasillacrosse.com", "role": "Admin", "password": "123456"},
            {"name": "Coach Roberto", "email": "coach@brazillacrosse.com", "role": "Coach", "password": "staff123"},
            {"name": "Fisio Mariana", "email": "fisio@brazillacrosse.com", "role": "Physio", "password": "staff123"},
        ]
        
        # Athletes
        MEN_ATHLETES = [
            {"name": "Lucas Silva", "email": "lucas.silva@email.com", "position": "Midfielder"},
            {"name": "Pedro Santos", "email": "pedro.santos@email.com", "position": "Attack"},
            {"name": "Gabriel Costa", "email": "gabriel.costa@email.com", "position": "Defense"},
            {"name": "Rafael Oliveira", "email": "rafael.oliveira@email.com", "position": "Goalie"},
            {"name": "Bruno Ferreira", "email": "bruno.ferreira@email.com", "position": "Midfielder"},
            {"name": "Diego Almeida", "email": "diego.almeida@email.com", "position": "Attack"},
            {"name": "Felipe Rodrigues", "email": "felipe.rodrigues@email.com", "position": "Defense"},
            {"name": "Thiago Martins", "email": "thiago.martins@email.com", "position": "Midfielder"},
        ]
        
        WOMEN_ATHLETES = [
            {"name": "Ana Oliveira", "email": "ana.oliveira@email.com", "position": "Midfielder"},
            {"name": "Julia Pereira", "email": "julia.pereira@email.com", "position": "Attack"},
            {"name": "Maria Souza", "email": "maria.souza@email.com", "position": "Defense"},
            {"name": "Camila Lima", "email": "camila.lima@email.com", "position": "Goalie"},
            {"name": "Beatriz Santos", "email": "beatriz.santos@email.com", "position": "Midfielder"},
            {"name": "Larissa Costa", "email": "larissa.costa@email.com", "position": "Attack"},
            {"name": "Fernanda Silva", "email": "fernanda.silva@email.com", "position": "Defense"},
            {"name": "Carolina Rocha", "email": "carolina.rocha@email.com", "position": "Midfielder"},
        ]
        
        SESSION_TYPES = ["Field Training", "Gym", "Technical", "Match", "Recovery", "Rehab", "Conditioning"]
        BODY_REGIONS = ["Shoulder", "Knee", "AnkleFoot", "HipGroin", "LowBack", "Quadriceps", "Hamstring", "Calf"]
        
        # 1. Create Staff Users
        for staff in STAFF_USERS:
            existing = await db.staff_users.find_one({"email": staff["email"]})
            if not existing:
                await db.staff_users.insert_one({
                    "id": str(uuid4()),
                    "email": staff["email"],
                    "password_hash": hash_password(staff["password"]),
                    "name": staff["name"],
                    "role": staff["role"],
                    "team": None if staff["role"] == "Admin" else "All",
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                logger.info(f"Created staff: {staff['email']}")
        
        # 2. Create Athletes
        all_athletes = []
        
        for athlete in MEN_ATHLETES:
            existing = await db.athletes.find_one({"email": athlete["email"]})
            if not existing:
                athlete_data = {
                    "id": str(uuid4()),
                    "name": athlete["name"],
                    "email": athlete["email"],
                    "password_hash": hash_password("demo123"),
                    "team": "Brazil Lacrosse Men",
                    "position": athlete["position"],
                    "status": "approved",
                    "active": True,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                await db.athletes.insert_one(athlete_data)
                all_athletes.append(athlete_data)
                logger.info(f"Created athlete: {athlete['name']} (Men)")
            else:
                all_athletes.append(existing)
        
        for athlete in WOMEN_ATHLETES:
            existing = await db.athletes.find_one({"email": athlete["email"]})
            if not existing:
                athlete_data = {
                    "id": str(uuid4()),
                    "name": athlete["name"],
                    "email": athlete["email"],
                    "password_hash": hash_password("demo123"),
                    "team": "Brazil Lacrosse Women",
                    "position": athlete["position"],
                    "status": "approved",
                    "active": True,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                await db.athletes.insert_one(athlete_data)
                all_athletes.append(athlete_data)
                logger.info(f"Created athlete: {athlete['name']} (Women)")
            else:
                all_athletes.append(existing)
        
        # 3. Generate Training Data (last 45 days)
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        readiness_count = 0
        session_count = 0
        
        for athlete in all_athletes:
            athlete_id = athlete["id"]
            team = athlete.get("team", "")
            is_female = "Women" in team
            
            base_sleep = random.uniform(6.5, 8.5)
            base_fatigue = random.uniform(3, 5)
            base_soreness = random.uniform(2, 4)
            base_stress = random.uniform(2, 4)
            injury_prone_region = random.choice(BODY_REGIONS)
            
            for days_ago in range(45, -1, -1):
                date = today - timedelta(days=days_ago)
                date_str = date.strftime("%Y-%m-%d")
                
                week_of_cycle = (45 - days_ago) // 7
                phase = week_of_cycle % 4
                
                if random.random() > 0.92:
                    continue
                
                # Daily Readiness
                existing_readiness = await db.daily_readiness.find_one({
                    "athlete_id": athlete_id,
                    "date": date_str
                })
                
                if not existing_readiness:
                    if phase == 2:
                        fatigue_mod = random.uniform(1, 2.5)
                        soreness_mod = random.uniform(0.5, 2)
                    elif phase == 3:
                        fatigue_mod = random.uniform(-2, -0.5)
                        soreness_mod = random.uniform(-1.5, -0.5)
                    else:
                        fatigue_mod = random.uniform(-0.5, 1)
                        soreness_mod = random.uniform(-0.5, 0.5)
                    
                    sleep_quality = max(1, min(10, round(base_sleep + random.uniform(-2, 2))))
                    fatigue_level = max(1, min(10, round(base_fatigue + fatigue_mod + random.uniform(-1, 1))))
                    muscle_soreness = max(1, min(10, round(base_soreness + soreness_mod + random.uniform(-1, 1))))
                    stress_level = max(1, min(10, round(base_stress + random.uniform(-1.5, 1.5))))
                    
                    readiness_score = round((sleep_quality + (10 - fatigue_level) + (10 - muscle_soreness) + (10 - stress_level)) / 4, 1)
                    
                    readiness_data = {
                        "id": str(uuid4()),
                        "athlete_id": athlete_id,
                        "date": date_str,
                        "sleep_quality": sleep_quality,
                        "fatigue_level": fatigue_level,
                        "morning_fatigue": fatigue_level,
                        "muscle_soreness": muscle_soreness,
                        "stress_level": stress_level,
                        "stress": stress_level,
                        "readiness_score": readiness_score,
                        "created_at": date.isoformat()
                    }
                    
                    if is_female and random.random() < 0.22:
                        flow_levels = ["Spotting", "Light", "Moderate", "Heavy"]
                        pain_levels = ["None", "Mild", "Moderate", "Severe", "Very Severe"]
                        symptoms = ["Cramps", "Low back pain", "Abdominal bloating", "Headache", "Breast tenderness", "Fatigue"]
                        
                        pain_choice = random.choice(pain_levels)
                        readiness_data["menstrual_cycle"] = {
                            "is_on_period": True,
                            "flow_level": random.choice(flow_levels),
                            "pain_level": pain_choice,
                            "symptoms": random.sample(symptoms, k=random.randint(1, 4))
                        }
                    
                    await db.daily_readiness.insert_one(readiness_data)
                    readiness_count += 1
                
                # Training Sessions
                day_of_week = date.weekday()
                
                if day_of_week == 6:
                    continue
                if day_of_week == 5 and random.random() > 0.35:
                    continue
                
                existing_session = await db.training_sessions.find_one({
                    "athlete_id": athlete_id,
                    "date_time_start": {"$regex": f"^{date_str}"}
                })
                
                if not existing_session:
                    if phase == 3:
                        session_type = random.choice(["Recovery", "Technical", "Rehab"])
                    elif day_of_week == 0:
                        session_type = random.choice(["Field Training", "Conditioning"])
                    elif day_of_week == 1:
                        session_type = random.choice(["Gym", "Technical"])
                    elif day_of_week == 2:
                        session_type = random.choice(["Field Training", "Match"] if phase == 2 else ["Field Training", "Technical"])
                    elif day_of_week == 3:
                        session_type = random.choice(["Recovery", "Technical", "Gym"])
                    elif day_of_week == 4:
                        session_type = random.choice(["Field Training", "Match", "Conditioning"])
                    else:
                        session_type = random.choice(["Recovery", "Technical"])
                    
                    if session_type == "Match":
                        base_rpe = random.uniform(7.5, 9.5)
                        base_duration = random.randint(80, 120)
                    elif session_type == "Conditioning":
                        base_rpe = random.uniform(7, 9)
                        base_duration = random.randint(45, 75)
                    elif session_type == "Field Training":
                        base_rpe = random.uniform(6, 8)
                        base_duration = random.randint(60, 100)
                    elif session_type == "Gym":
                        base_rpe = random.uniform(5, 7.5)
                        base_duration = random.randint(45, 75)
                    elif session_type == "Technical":
                        base_rpe = random.uniform(4, 6)
                        base_duration = random.randint(60, 90)
                    else:
                        base_rpe = random.uniform(2, 4)
                        base_duration = random.randint(30, 60)
                    
                    if phase == 2:
                        base_rpe = min(10, base_rpe + random.uniform(0.5, 1))
                    elif phase == 3:
                        base_rpe = max(1, base_rpe - random.uniform(1, 2))
                    
                    rpe = round(min(10, max(1, base_rpe)))
                    duration = max(20, base_duration + random.randint(-15, 15))
                    internal_load = rpe * duration
                    
                    session_time = date.replace(
                        hour=random.choice([8, 9, 10, 14, 15, 16, 17]),
                        minute=random.choice([0, 15, 30, 45])
                    )
                    
                    session_data = {
                        "id": str(uuid4()),
                        "athlete_id": athlete_id,
                        "date_time_start": session_time.isoformat(),
                        "date_time_end": (session_time + timedelta(minutes=duration)).isoformat(),
                        "session_type": session_type,
                        "duration_min": duration,
                        "rpe": rpe,
                        "internal_load": internal_load,
                        "pain_before": 0,
                        "pain_after": 0,
                        "pain_reports": [],
                        "created_at": session_time.isoformat()
                    }
                    
                    if random.random() < 0.18:
                        if random.random() < 0.6:
                            region = injury_prone_region
                        else:
                            region = random.choice(BODY_REGIONS)
                        
                        pain_level = random.randint(3, 8)
                        laterality = "N/A" if region in ["Neck", "LowBack"] else random.choice(["Left", "Right", "Both"])
                        
                        session_data["pain_after"] = pain_level
                        session_data["body_region"] = region
                        session_data["laterality"] = laterality
                        session_data["pain_reports"] = [{
                            "body_region": region,
                            "laterality": laterality,
                            "pain_level": pain_level
                        }]
                    
                    await db.training_sessions.insert_one(session_data)
                    session_count += 1
        
        logger.info(f"=== SEED COMPLETE: {readiness_count} check-ins, {session_count} sessions ===")
    
    except Exception as e:
        logger.error(f"=== SEED ERROR: {str(e)} ===")
        import traceback
        logger.error(traceback.format_exc())
