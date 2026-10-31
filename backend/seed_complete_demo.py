"""
Complete seeding script for presentation demo
Creates athletes, staff, and realistic training data
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

# Staff users to create
STAFF_USERS = [
    {"name": "Cristina Velez", "email": "cristina.velez@brasillacrosse.com", "role": "Admin", "password": "123456"},
    {"name": "Daniel Patara", "email": "pataradaniel@gmail.com", "role": "Admin", "password": "123456"},
    {"name": "Coach Roberto", "email": "coach@brazillacrosse.com", "role": "Coach", "password": "staff123"},
    {"name": "Fisio Mariana", "email": "fisio@brazillacrosse.com", "role": "Physio", "password": "staff123"},
]

# Athletes - Men's Team
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

# Athletes - Women's Team
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
BODY_REGIONS = ["Shoulder", "Knee", "AnkleFoot", "HipGroin", "LowBack", "Quadriceps", "Hamstring", "Calf", "WristHand", "Neck"]

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    print("=" * 70)
    print("🏆 BRAZIL LACROSSE - PRESENTATION DATA SEEDING")
    print("=" * 70)
    
    # 1. Create Staff Users
    print("\n📋 1. Creating Staff Users...")
    for staff in STAFF_USERS:
        hashed_password = bcrypt.hashpw(staff["password"].encode(), bcrypt.gensalt()).decode()
        existing = await db.staff_users.find_one({"email": staff["email"]})
        
        if existing:
            await db.staff_users.update_one(
                {"email": staff["email"]},
                {"$set": {"role": staff["role"], "password": hashed_password, "name": staff["name"]}}
            )
            print(f"   ✓ Updated: {staff['email']} ({staff['role']})")
        else:
            await db.staff_users.insert_one({
                "id": str(uuid4()),
                "email": staff["email"],
                "password": hashed_password,
                "name": staff["name"],
                "role": staff["role"],
                "team": None if staff["role"] == "Admin" else "All",
                "created_at": datetime.now(timezone.utc).isoformat()
            })
            print(f"   ✓ Created: {staff['email']} ({staff['role']})")
    
    # 2. Create Athletes
    print("\n🏃 2. Creating Athletes...")
    all_athletes = []
    default_password = bcrypt.hashpw("demo123".encode(), bcrypt.gensalt()).decode()
    
    # Men's Team
    for athlete in MEN_ATHLETES:
        existing = await db.athletes.find_one({"email": athlete["email"]})
        if existing:
            all_athletes.append(existing)
            print(f"   ✓ Exists: {athlete['name']} (Men)")
        else:
            athlete_data = {
                "id": str(uuid4()),
                "name": athlete["name"],
                "email": athlete["email"],
                "password": default_password,
                "team": "Brazil Lacrosse Men",
                "position": athlete["position"],
                "status": "approved",
                "active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.athletes.insert_one(athlete_data)
            all_athletes.append(athlete_data)
            print(f"   ✓ Created: {athlete['name']} (Men)")
    
    # Women's Team
    for athlete in WOMEN_ATHLETES:
        existing = await db.athletes.find_one({"email": athlete["email"]})
        if existing:
            all_athletes.append(existing)
            print(f"   ✓ Exists: {athlete['name']} (Women)")
        else:
            athlete_data = {
                "id": str(uuid4()),
                "name": athlete["name"],
                "email": athlete["email"],
                "password": default_password,
                "team": "Brazil Lacrosse Women",
                "position": athlete["position"],
                "status": "approved",
                "active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.athletes.insert_one(athlete_data)
            all_athletes.append(athlete_data)
            print(f"   ✓ Created: {athlete['name']} (Women)")
    
    # 3. Generate Realistic Training Data
    print("\n📊 3. Generating Realistic Training Data (Last 45 days)...")
    
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    readiness_count = 0
    session_count = 0
    
    for athlete in all_athletes:
        athlete_id = athlete["id"]
        athlete_name = athlete["name"]
        team = athlete.get("team", "")
        is_female = "Women" in team
        
        # Each athlete has a unique wellness profile
        base_sleep = random.uniform(6.5, 8.5)
        base_fatigue = random.uniform(3, 5)
        base_soreness = random.uniform(2, 4)
        base_stress = random.uniform(2, 4)
        injury_prone_region = random.choice(BODY_REGIONS)
        
        for days_ago in range(45, -1, -1):
            date = today - timedelta(days=days_ago)
            date_str = date.strftime("%Y-%m-%d")
            
            # Training periodization
            week_of_cycle = (45 - days_ago) // 7
            phase = week_of_cycle % 4  # 0-1: base, 2: intensity, 3: recovery
            
            # Skip some days for realistic compliance (85-95%)
            if random.random() > 0.92:
                continue
            
            # 3a. Daily Readiness Check-in
            existing_readiness = await db.daily_readiness.find_one({
                "athlete_id": athlete_id,
                "date": date_str
            })
            
            if not existing_readiness:
                # Phase modifiers
                if phase == 2:  # Intensity
                    fatigue_mod = random.uniform(1, 2.5)
                    soreness_mod = random.uniform(0.5, 2)
                elif phase == 3:  # Recovery
                    fatigue_mod = random.uniform(-2, -0.5)
                    soreness_mod = random.uniform(-1.5, -0.5)
                else:  # Base
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
                
                # Menstrual data for female athletes (~25% of days when on period)
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
                    
                    # Training pain if menstrual pain is high
                    if pain_choice in ["Severe", "Very Severe"]:
                        readiness_data["menstrual_cycle"]["training_pain"] = random.randint(5, 8)
                
                await db.daily_readiness.insert_one(readiness_data)
                readiness_count += 1
            
            # 3b. Training Sessions
            day_of_week = date.weekday()
            
            # Schedule: Mon-Fri, optional Sat, rest Sun
            if day_of_week == 6:
                continue
            if day_of_week == 5 and random.random() > 0.35:
                continue
            
            existing_session = await db.training_sessions.find_one({
                "athlete_id": athlete_id,
                "date_time_start": {"$regex": f"^{date_str}"}
            })
            
            if not existing_session:
                # Session type based on day and phase
                if phase == 3:  # Recovery week
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
                
                # RPE and duration based on session type
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
                else:  # Recovery, Rehab
                    base_rpe = random.uniform(2, 4)
                    base_duration = random.randint(30, 60)
                
                # Phase adjustment
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
                
                # Pain data (~18% of sessions)
                if random.random() < 0.18:
                    # Higher chance of pain in injury-prone region
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
                    
                    # Sometimes multiple pain locations
                    if random.random() < 0.25:
                        region2 = random.choice([r for r in BODY_REGIONS if r != region])
                        laterality2 = "N/A" if region2 in ["Neck", "LowBack"] else random.choice(["Left", "Right"])
                        session_data["pain_reports"].append({
                            "body_region": region2,
                            "laterality": laterality2,
                            "pain_level": random.randint(2, 6)
                        })
                
                # Session notes occasionally
                if random.random() < 0.1:
                    notes = [
                        "Feeling strong today",
                        "Good session, worked on stick skills",
                        "Heavy legs from yesterday",
                        "Focus on defensive positioning",
                        "Great team energy",
                        "Need more hydration",
                        "Worked on shooting accuracy"
                    ]
                    session_data["session_notes"] = random.choice(notes)
                
                await db.training_sessions.insert_one(session_data)
                session_count += 1
    
    # 4. Summary
    print(f"\n   ✓ Created {readiness_count} morning check-ins")
    print(f"   ✓ Created {session_count} training sessions")
    
    # Final counts
    total_athletes = await db.athletes.count_documents({})
    total_staff = await db.staff_users.count_documents({})
    total_readiness = await db.daily_readiness.count_documents({})
    total_sessions = await db.training_sessions.count_documents({})
    
    print("\n" + "=" * 70)
    print("✅ SEEDING COMPLETE!")
    print("=" * 70)
    
    print("\n📧 ADMIN LOGIN CREDENTIALS:")
    print("   ┌─────────────────────────────────────────────────────┐")
    print("   │ Email: cristina.velez@brasillacrosse.com            │")
    print("   │ Password: 123456                                    │")
    print("   └─────────────────────────────────────────────────────┘")
    
    print("\n📊 DATABASE SUMMARY:")
    print(f"   • Staff Users: {total_staff}")
    print(f"   • Athletes: {total_athletes} (8 Men + 8 Women)")
    print(f"   • Morning Check-ins: {total_readiness}")
    print(f"   • Training Sessions: {total_sessions}")
    
    print("\n🔐 OTHER LOGINS:")
    print("   • Admin: pataradaniel@gmail.com / 123456")
    print("   • Coach: coach@brazillacrosse.com / staff123")
    print("   • Athlete: lucas.silva@email.com / demo123")
    
    print("\n🎯 FEATURES TO DEMONSTRATE:")
    print("   1. Staff Dashboard - KPIs, Charts, Alerts")
    print("   2. Team Filtering - Men's vs Women's Team")
    print("   3. Athlete Profiles - Workload, Pain, Compliance")
    print("   4. Workload Analysis - Load / Monotony / Strain zones")
    print("   5. Pain Monitoring - Body Region Analysis")
    print("   6. Female Wellness - Menstrual Cycle Tracking")
    print("   7. CMJ Module - Jump Performance Testing")
    print("   8. Admin Controls - Delete Sessions/Check-ins")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(main())
