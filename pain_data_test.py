#!/usr/bin/env python3

import requests
import json
from datetime import datetime, timedelta

def create_pain_test_data():
    """Create training sessions with pain data for testing"""
    base_url = "https://performance-fueling.preview.emergentagent.com/api"
    
    # Login as athlete
    athlete_login = requests.post(f"{base_url}/auth/login", 
                                 json={"email": "lucas@brazillacrosse.com", "password": "demo123"})
    
    if athlete_login.status_code != 200:
        print("Failed to login as athlete")
        return False
    
    athlete_token = athlete_login.json()['token']
    print("✅ Logged in as athlete")
    
    # Create training sessions with pain data
    today = datetime.now()
    sessions_data = [
        {
            "date_time_start": (today - timedelta(days=0)).isoformat(),
            "session_type": "Technical",
            "duration_min": 90,
            "rpe": 7,
            "pain_during": 2,
            "pain_after": 5,  # Moderate pain
            "end_fatigue": 6,
            "body_region": "Knee",
            "session_notes": "Knee pain after training"
        },
        {
            "date_time_start": (today - timedelta(days=0, hours=2)).isoformat(),
            "session_type": "Strength",
            "duration_min": 60,
            "rpe": 8,
            "pain_during": 1,
            "pain_after": 7,  # Severe pain
            "end_fatigue": 7,
            "body_region": "Shoulder",
            "session_notes": "Shoulder pain from weights"
        },
        {
            "date_time_start": (today - timedelta(days=2)).isoformat(),
            "session_type": "Conditioning",
            "duration_min": 75,
            "rpe": 6,
            "pain_during": 0,
            "pain_after": 4,  # Mild pain
            "end_fatigue": 5,
            "body_region": "LowBack",
            "session_notes": "Lower back tightness"
        },
        {
            "date_time_start": (today - timedelta(days=2, hours=3)).isoformat(),
            "session_type": "Technical",
            "duration_min": 80,
            "rpe": 5,
            "pain_during": 3,
            "pain_after": 6,  # Moderate pain
            "end_fatigue": 4,
            "body_region": "Knee",
            "session_notes": "Knee pain persisting"
        }
    ]
    
    created_sessions = 0
    for session_data in sessions_data:
        response = requests.post(f"{base_url}/sessions", 
                               json=session_data,
                               headers={'Authorization': f'Bearer {athlete_token}'})
        if response.status_code == 200:
            created_sessions += 1
            print(f"✅ Created session with {session_data['body_region']} pain (level {session_data['pain_after']})")
        else:
            print(f"❌ Failed to create session: {response.status_code}")
    
    print(f"\n📊 Created {created_sessions} training sessions with pain data")
    return created_sessions > 0

def test_pain_endpoints_with_data():
    """Test the pain endpoints with actual pain data"""
    base_url = "https://performance-fueling.preview.emergentagent.com/api"
    
    # Login as admin
    admin_login = requests.post(f"{base_url}/auth/login", 
                               json={"email": "pataradaniel@gmail.com", "password": "123456"})
    
    if admin_login.status_code != 200:
        print("Failed to login as admin")
        return False
    
    admin_token = admin_login.json()['token']
    print("✅ Logged in as admin")
    
    # Get athlete ID
    athletes_resp = requests.get(f"{base_url}/staff/athletes",
                                headers={'Authorization': f'Bearer {admin_token}'})
    if athletes_resp.status_code != 200:
        print("Failed to get athletes")
        return False
    
    athletes = athletes_resp.json()
    lucas_athlete = next((a for a in athletes if "Lucas" in a['name']), None)
    if not lucas_athlete:
        print("Lucas athlete not found")
        return False
    
    athlete_id = lucas_athlete['id']
    print(f"✅ Found athlete: {lucas_athlete['name']} (ID: {athlete_id})")
    
    # Test daily pain endpoint for today
    print("\n🔍 Testing Daily Pain by Region - Today...")
    daily_pain_resp = requests.get(f"{base_url}/staff/dashboard/daily-pain?days_ago=0",
                                  headers={'Authorization': f'Bearer {admin_token}'})
    
    if daily_pain_resp.status_code == 200:
        data = daily_pain_resp.json()
        print(f"✅ Date: {data['date']}")
        print(f"✅ Total sessions: {data['total_sessions']}")
        print(f"✅ Sessions with pain: {data['sessions_with_pain']}")
        print(f"✅ Pain regions: {len(data['pain_regions'])}")
        
        for region in data['pain_regions']:
            print(f"   - {region['region']}: {region['count']} reports, avg pain {region['avg_pain']}")
    else:
        print(f"❌ Failed: {daily_pain_resp.status_code}")
    
    # Test daily pain endpoint for 2 days ago
    print("\n🔍 Testing Daily Pain by Region - 2 Days Ago...")
    daily_pain_2_resp = requests.get(f"{base_url}/staff/dashboard/daily-pain?days_ago=2",
                                    headers={'Authorization': f'Bearer {admin_token}'})
    
    if daily_pain_2_resp.status_code == 200:
        data = daily_pain_2_resp.json()
        print(f"✅ Date: {data['date']}")
        print(f"✅ Total sessions: {data['total_sessions']}")
        print(f"✅ Sessions with pain: {data['sessions_with_pain']}")
        print(f"✅ Pain regions: {len(data['pain_regions'])}")
        
        for region in data['pain_regions']:
            print(f"   - {region['region']}: {region['count']} reports, avg pain {region['avg_pain']}")
    else:
        print(f"❌ Failed: {daily_pain_2_resp.status_code}")
    
    # Test athlete pain map for today
    print(f"\n🔍 Testing Athlete Pain Map - Today...")
    pain_map_resp = requests.get(f"{base_url}/staff/athlete/{athlete_id}/pain-map?days_ago=0",
                                headers={'Authorization': f'Bearer {admin_token}'})
    
    if pain_map_resp.status_code == 200:
        data = pain_map_resp.json()
        print(f"✅ Date: {data['date']}")
        print(f"✅ Athlete: {data['athlete_name']}")
        print(f"✅ Has pain: {data['has_pain']}")
        print(f"✅ Pain locations: {len(data['pain_locations'])}")
        
        for location in data['pain_locations']:
            print(f"   - {location['region']}: Level {location['pain_level']}/10 ({location['severity']})")
    else:
        print(f"❌ Failed: {pain_map_resp.status_code}")
    
    # Test athlete pain map for 2 days ago
    print(f"\n🔍 Testing Athlete Pain Map - 2 Days Ago...")
    pain_map_2_resp = requests.get(f"{base_url}/staff/athlete/{athlete_id}/pain-map?days_ago=2",
                                  headers={'Authorization': f'Bearer {admin_token}'})
    
    if pain_map_2_resp.status_code == 200:
        data = pain_map_2_resp.json()
        print(f"✅ Date: {data['date']}")
        print(f"✅ Athlete: {data['athlete_name']}")
        print(f"✅ Has pain: {data['has_pain']}")
        print(f"✅ Pain locations: {len(data['pain_locations'])}")
        
        for location in data['pain_locations']:
            print(f"   - {location['region']}: Level {location['pain_level']}/10 ({location['severity']})")
    else:
        print(f"❌ Failed: {pain_map_2_resp.status_code}")
    
    return True

def main():
    print("🏃‍♂️ Pain Data Testing Suite")
    print("=" * 50)
    
    print("📝 Creating test data with pain...")
    if create_pain_test_data():
        print("\n🔍 Testing pain endpoints with real data...")
        test_pain_endpoints_with_data()
    else:
        print("❌ Failed to create test data")
    
    print("\n✅ Pain data testing complete!")

if __name__ == "__main__":
    main()