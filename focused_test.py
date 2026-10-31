#!/usr/bin/env python3

import requests
import json
from datetime import datetime

class FocusedAPITester:
    def __init__(self, base_url="https://performance-fueling.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.admin_token = None
        self.athlete_id = None
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, token=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return success, response.json()
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"   Response: {response.json()}")
                except:
                    print(f"   Response: {response.text}")

            return success, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_admin_login(self):
        """Test admin login"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "pataradaniel@gmail.com", "password": "123456"}
        )
        if success and 'token' in response:
            self.admin_token = response['token']
            print(f"   Admin Role: {response['user'].get('role', 'Unknown')}")
            return True
        return False

    def test_get_athletes(self):
        """Get athletes list to get valid athlete ID"""
        success, response = self.run_test("Get Athletes", "GET", "staff/athletes", 200, token=self.admin_token)
        if success and response:
            athletes = response
            if athletes:
                self.athlete_id = athletes[0]['id']
                print(f"   Using athlete: {athletes[0]['name']} (ID: {self.athlete_id})")
                return True
        return False

    def test_daily_pain_today(self):
        """Test GET /api/staff/dashboard/daily-pain?days_ago=0"""
        success, response = self.run_test(
            "Daily Pain by Region - Today", 
            "GET", 
            "staff/dashboard/daily-pain?days_ago=0", 
            200, 
            token=self.admin_token
        )
        if success:
            # Validate response structure
            required_fields = ['date', 'total_sessions', 'sessions_with_pain', 'pain_regions']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field: {field}")
                    return False
            
            print(f"   ✅ Date: {response['date']}")
            print(f"   ✅ Total sessions: {response['total_sessions']}")
            print(f"   ✅ Sessions with pain: {response['sessions_with_pain']}")
            print(f"   ✅ Pain regions count: {len(response['pain_regions'])}")
            
            # Validate pain_regions structure if present
            if response['pain_regions']:
                for region in response['pain_regions']:
                    required_region_fields = ['region', 'count', 'avg_pain', 'severe_count', 'athletes']
                    for field in required_region_fields:
                        if field not in region:
                            print(f"❌ Missing region field: {field}")
                            return False
                print(f"   ✅ Pain regions structure validated")
        return success

    def test_daily_pain_2_days_ago(self):
        """Test GET /api/staff/dashboard/daily-pain?days_ago=2"""
        success, response = self.run_test(
            "Daily Pain by Region - 2 Days Ago", 
            "GET", 
            "staff/dashboard/daily-pain?days_ago=2", 
            200, 
            token=self.admin_token
        )
        if success:
            # Validate response structure
            required_fields = ['date', 'total_sessions', 'sessions_with_pain', 'pain_regions']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field: {field}")
                    return False
            
            print(f"   ✅ Date: {response['date']}")
            print(f"   ✅ Total sessions: {response['total_sessions']}")
            print(f"   ✅ Sessions with pain: {response['sessions_with_pain']}")
            print(f"   ✅ Pain regions count: {len(response['pain_regions'])}")
        return success

    def test_athlete_pain_map_today(self):
        """Test GET /api/staff/athlete/{athlete_id}/pain-map?days_ago=0"""
        if not self.athlete_id:
            print("❌ No athlete ID available for testing")
            return False
        
        success, response = self.run_test(
            "Athlete Pain Map - Today", 
            "GET", 
            f"staff/athlete/{self.athlete_id}/pain-map?days_ago=0", 
            200, 
            token=self.admin_token
        )
        if success:
            # Validate response structure
            required_fields = ['date', 'athlete_name', 'has_pain', 'pain_locations']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field: {field}")
                    return False
            
            print(f"   ✅ Date: {response['date']}")
            print(f"   ✅ Athlete: {response['athlete_name']}")
            print(f"   ✅ Has pain: {response['has_pain']}")
            print(f"   ✅ Pain locations count: {len(response['pain_locations'])}")
            
            # Validate pain_locations structure if present
            if response['pain_locations']:
                for location in response['pain_locations']:
                    required_location_fields = ['region', 'pain_level', 'severity']
                    for field in required_location_fields:
                        if field not in location:
                            print(f"❌ Missing location field: {field}")
                            return False
                    
                    # Validate severity values
                    if location['severity'] not in ['mild', 'moderate', 'severe']:
                        print(f"❌ Invalid severity value: {location['severity']}")
                        return False
                    
                    # Validate pain_level range
                    if not (0 <= location['pain_level'] <= 10):
                        print(f"❌ Pain level out of range (0-10): {location['pain_level']}")
                        return False
                
                print(f"   ✅ Pain locations structure validated")
        return success

    def test_athlete_pain_map_2_days_ago(self):
        """Test GET /api/staff/athlete/{athlete_id}/pain-map?days_ago=2"""
        if not self.athlete_id:
            print("❌ No athlete ID available for testing")
            return False
        
        success, response = self.run_test(
            "Athlete Pain Map - 2 Days Ago", 
            "GET", 
            f"staff/athlete/{self.athlete_id}/pain-map?days_ago=2", 
            200, 
            token=self.admin_token
        )
        if success:
            # Validate response structure
            required_fields = ['date', 'athlete_name', 'has_pain', 'pain_locations']
            for field in required_fields:
                if field not in response:
                    print(f"❌ Missing field: {field}")
                    return False
            
            print(f"   ✅ Date: {response['date']}")
            print(f"   ✅ Athlete: {response['athlete_name']}")
            print(f"   ✅ Has pain: {response['has_pain']}")
            print(f"   ✅ Pain locations count: {len(response['pain_locations'])}")
        return success

def main():
    print("🏃‍♂️ Focused API Testing - Daily Pain & Pain Map Endpoints")
    print("=" * 60)
    
    tester = FocusedAPITester()
    
    # Test sequence
    tests = [
        ("Admin Login", tester.test_admin_login),
        ("Get Athletes", tester.test_get_athletes),
        ("Daily Pain - Today", tester.test_daily_pain_today),
        ("Daily Pain - 2 Days Ago", tester.test_daily_pain_2_days_ago),
        ("Athlete Pain Map - Today", tester.test_athlete_pain_map_today),
        ("Athlete Pain Map - 2 Days Ago", tester.test_athlete_pain_map_2_days_ago),
    ]
    
    failed_tests = []
    
    for test_name, test_func in tests:
        try:
            success = test_func()
            if not success:
                failed_tests.append(test_name)
        except Exception as e:
            print(f"❌ {test_name} - Exception: {str(e)}")
            failed_tests.append(test_name)
    
    # Print results
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if failed_tests:
        print(f"\n❌ Failed tests:")
        for test in failed_tests:
            print(f"   - {test}")
    else:
        print("\n✅ All tests passed!")
    
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"📈 Success rate: {success_rate:.1f}%")
    
    return 0 if len(failed_tests) == 0 else 1

if __name__ == "__main__":
    exit(main())