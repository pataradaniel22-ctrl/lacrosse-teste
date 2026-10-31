"""
Script to seed realistic athlete data for presentation
and create new admin user
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone, timedelta
from uuid import uuid4
import random
import bcrypt

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "brazil_lacrosse")

# New admin user
NEW_ADMIN = {
    "email": "cristina.velez@brasillacrosse.com",
    "password": "123456",
    "name": "Cristina Velez",
    "role": "Admin"
}

# Session types and RPE ranges for realistic data
SESSION_TYPES = ["Field Training", "Gym", "Technical", "Match", "Recovery", "Rehab", "Conditioning"]
BODY_REGIONS = ["Shoulder", "Knee", "AnkleFoot", "HipGroin", "LowBack", "Quadriceps", "Hamstring", "Calf", "WristHand", "Neck"]
LATERALITIES = ["Left", "Right", "Both", "N/A"]

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    print("=" * 60)
    print("SEEDING PRESENTATION DATA")
    print("=" * 60)
    
    # 1. Create new admin user
    print("\n1. Creating new admin user...")
    hashed_password = bcrypt.hashpw(NEW_ADMIN["password"].encode(), bcrypt.gensalt()).decode()
    
    existing_admin = await db.staff_users.find_one({"email": NEW_ADMIN["email"]})
    if existing_admin:
        await db.staff_users.update_one(
            {"email": NEW_ADMIN["email"]},
            {"$set": {"role": "Admin", "password": hashed_password, "name": NEW_ADMIN["name"]}}
        )
        print(f"   ✅ Admin user updated: {NEW_ADMIN['email']}")
    else:
        await db.staff_users.insert_one({
            "id": str(uuid4()),
            "email": NEW_ADMIN["email"],
            "password": hashed_password,
            "name": NEW_ADMIN["name"],
            "role": "Admin",
            "team": None,  # Admin can see all teams
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        print(f"   ✅ Admin user created: {NEW_ADMIN['email']}")
    
    # 2. Get all athletes
    athletes = await db.athletes.find({"status": {"$in": ["approved", None]}}).to_list(100)
    print(f"\n2. Found {len(athletes)} athletes")
    
    # 3. Generate realistic data for the last 30 days
    print("\n3. Generating realistic data for last 30 days...")
    
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Clear old seeded data (keep only the most recent to avoid duplicates)
    thirty_days_ago = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    
    readiness_count = 0
    session_count = 0
    
    for athlete in athletes:
        athlete_id = athlete["id"]
        athlete_name = athlete["name"]
        team = athlete.get("team", "")
        is_female = "Women" in team
        
        # Base wellness profile for this athlete (some variation per athlete)
        base_sleep = random.uniform(6, 8)
        base_fatigue = random.uniform(3, 5)
        base_soreness = random.uniform(2, 4)
        base_stress = random.uniform(2, 4)
        
        # Training phase simulation (periodization)
        # Week 1-2: Base building (moderate load)
        # Week 3: Intensification (high load)
        # Week 4: Recovery/Taper (low load)
        
        for days_ago in range(30, -1, -1):
            date = today - timedelta(days=days_ago)
            date_str = date.strftime("%Y-%m-%d")
            
            # Determine training phase based on day
            week_of_cycle = (30 - days_ago) // 7
            
            # Skip some days randomly (realistic compliance ~80-95%)
            if random.random() > 0.88:  # 12% chance of missing
                continue
            
            # 3a. Daily Readiness (Morning Check-in)
            existing_readiness = await db.daily_readiness.find_one({
                "athlete_id": athlete_id,
                "date": date_str
            })
            
            if not existing_readiness:
                # Wellness variation based on training phase
                if week_of_cycle == 2:  # High intensity week
                    fatigue_mod = random.uniform(1, 3)
                    soreness_mod = random.uniform(1, 2)
                elif week_of_cycle == 3:  # Recovery week
                    fatigue_mod = random.uniform(-2, 0)
                    soreness_mod = random.uniform(-1, 0)
                else:  # Base weeks
                    fatigue_mod = random.uniform(-0.5, 1)
                    soreness_mod = random.uniform(-0.5, 1)
                
                sleep_quality = max(1, min(10, round(base_sleep + random.uniform(-1.5, 1.5))))
                fatigue_level = max(1, min(10, round(base_fatigue + fatigue_mod + random.uniform(-1, 1))))
                muscle_soreness = max(1, min(10, round(base_soreness + soreness_mod + random.uniform(-1, 1))))
                stress_level = max(1, min(10, round(base_stress + random.uniform(-1.5, 1.5))))
                
                # Calculate readiness score
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
                
                # Add menstrual data for female athletes (randomly ~25% of days)
                if is_female and random.random() < 0.25:
                    flow_levels = ["None", "Spotting", "Light", "Moderate", "Heavy"]
                    pain_levels = ["None", "Mild", "Moderate", "Severe", "Very Severe"]
                    symptoms = ["Cramps", "Low back pain", "Abdominal bloating", "Headache", "Breast tenderness", "Fatigue"]
                    
                    readiness_data["menstrual_cycle"] = {
                        "is_on_period": True,
                        "flow_level": random.choice(flow_levels[1:]),  # Not "None"
                        "pain_level": random.choice(pain_levels),
                        "symptoms": random.sample(symptoms, k=random.randint(1, 3))
                    }
                
                await db.daily_readiness.insert_one(readiness_data)
                readiness_count += 1
            
            # 3b. Training Sessions (skip some weekend days)
            day_of_week = date.weekday()
            
            # Training schedule: Mon-Fri training, Sat optional, Sun rest
            if day_of_week == 6:  # Sunday - rest
                continue
            if day_of_week == 5 and random.random() > 0.3:  # Saturday - 30% train
                continue
            
            existing_session = await db.training_sessions.find_one({
                "athlete_id": athlete_id,
                "date_time_start": {"$regex": f"^{date_str}"}
            })
            
            if not existing_session:
                # Session type based on day
                if day_of_week == 0:  # Monday
                    session_type = random.choice(["Field Training", "Conditioning"])
                elif day_of_week == 1:  # Tuesday
                    session_type = random.choice(["Gym", "Technical"])
                elif day_of_week == 2:  # Wednesday
                    session_type = random.choice(["Field Training", "Match"])
                elif day_of_week == 3:  # Thursday
                    session_type = random.choice(["Recovery", "Technical"])
                elif day_of_week == 4:  # Friday
                    session_type = random.choice(["Field Training", "Conditioning", "Match"])
                else:
                    session_type = random.choice(["Recovery", "Rehab"])
                
                # Intensity based on session type and training phase
                if session_type in ["Match", "Conditioning"]:
                    base_rpe = random.uniform(7, 9)
                    base_duration = random.randint(75, 120)
                elif session_type in ["Field Training"]:
                    base_rpe = random.uniform(6, 8)
                    base_duration = random.randint(60, 90)
                elif session_type in ["Gym"]:
                    base_rpe = random.uniform(5, 7)
                    base_duration = random.randint(45, 75)
                elif session_type in ["Technical"]:
                    base_rpe = random.uniform(4, 6)
                    base_duration = random.randint(60, 90)
                else:  # Recovery, Rehab
                    base_rpe = random.uniform(2, 4)
                    base_duration = random.randint(30, 60)
                
                # Adjust for training phase
                if week_of_cycle == 2:  # High intensity
                    base_rpe = min(10, base_rpe + random.uniform(0.5, 1.5))
                elif week_of_cycle == 3:  # Recovery
                    base_rpe = max(1, base_rpe - random.uniform(1, 2))
                
                rpe = round(min(10, max(1, base_rpe + random.uniform(-0.5, 0.5))))
                duration = max(20, base_duration + random.randint(-10, 10))
                internal_load = rpe * duration
                
                session_time = date.replace(
                    hour=random.choice([9, 10, 14, 15, 16]),
                    minute=random.choice([0, 15, 30])
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
                
                # Add pain data randomly (~15% of sessions)
                if random.random() < 0.15:
                    pain_level = random.randint(3, 8)
                    region = random.choice(BODY_REGIONS)
                    laterality = "N/A" if region in ["Neck", "LowBack"] else random.choice(["Left", "Right", "Both"])
                    
                    session_data["pain_after"] = pain_level
                    session_data["body_region"] = region
                    session_data["laterality"] = laterality
                    session_data["pain_reports"] = [{
                        "body_region": region,
                        "laterality": laterality,
                        "pain_level": pain_level
                    }]
                    
                    # Sometimes add second pain location
                    if random.random() < 0.3:
                        region2 = random.choice([r for r in BODY_REGIONS if r != region])
                        laterality2 = "N/A" if region2 in ["Neck", "LowBack"] else random.choice(["Left", "Right", "Both"])
                        session_data["pain_reports"].append({
                            "body_region": region2,
                            "laterality": laterality2,
                            "pain_level": random.randint(2, 6)
                        })
                
                await db.training_sessions.insert_one(session_data)
                session_count += 1
    
    print(f"   ✅ Created {readiness_count} readiness check-ins")
    print(f"   ✅ Created {session_count} training sessions")
    
    # 4. Summary
    print("\n" + "=" * 60)
    print("SEEDING COMPLETE!")
    print("=" * 60)
    print(f"\n📧 New Admin Login:")
    print(f"   Email: {NEW_ADMIN['email']}")
    print(f"   Password: {NEW_ADMIN['password']}")
    print(f"\n📊 Data Generated:")
    print(f"   - {readiness_count} morning check-ins")
    print(f"   - {session_count} training sessions")
    print(f"   - Menstrual data for female athletes")
    print(f"   - Pain reports (~15% of sessions)")
    print(f"\n🏃 Athletes with data: {len(athletes)}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(main())
