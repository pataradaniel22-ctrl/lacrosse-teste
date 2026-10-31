#!/usr/bin/env python3
"""
Focused test for Radar Chart functionality as requested in the review.
Tests the specific endpoints and scenarios mentioned.
"""

import requests
import json
from datetime import datetime

class RadarChartTester:
    def __init__(self):
        self.base_url = "https://performance-fueling.preview.emergentagent.com/api"
        self.admin_token = None
        self.athlete_id = None
        
    def login_admin(self):
        """Login as admin"""
        response = requests.post(f"{self.base_url}/auth/login", json={
            "email": "pataradaniel@gmail.com",
            "password": "123456"
        })
        if response.status_code == 200:
            data = response.json()
            self.admin_token = data['token']
            print(f"✅ Admin login successful")
            return True
        else:
            print(f"❌ Admin login failed: {response.status_code}")
            return False
    
    def get_athlete_id(self):
        """Get an athlete ID for testing"""
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        response = requests.get(f"{self.base_url}/staff/athletes", headers=headers)
        if response.status_code == 200:
            athletes = response.json()
            if athletes:
                self.athlete_id = athletes[0]['id']
                print(f"✅ Got athlete ID: {self.athlete_id} ({athletes[0]['name']})")
                return True
        print("❌ Failed to get athlete ID")
        return False
    
    def test_endpoint(self, name, endpoint, expected_fields=None, expected_dimensions=None):
        """Test a specific endpoint"""
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        response = requests.get(f"{self.base_url}/{endpoint}", headers=headers)
        
        print(f"\n🔍 Testing {name}")
        print(f"   URL: {endpoint}")
        print(f"   Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed with status {response.status_code}")
            try:
                print(f"   Error: {response.json()}")
            except:
                print(f"   Error: {response.text}")
            return False
        
        try:
            data = response.json()
            print(f"✅ Success")
            
            # Check required fields
            if expected_fields:
                for field in expected_fields:
                    if field not in data:
                        print(f"❌ Missing field: {field}")
                        return False
                print(f"   ✅ All required fields present: {expected_fields}")
            
            # Check radar data structure
            if 'radar_data' in data:
                radar_data = data['radar_data']
                print(f"   📊 Radar data: {len(radar_data)} dimensions")
                
                if expected_dimensions and radar_data:
                    actual_dims = [item['dimension'] for item in radar_data]
                    if set(actual_dims) != set(expected_dimensions):
                        print(f"❌ Wrong dimensions. Expected: {expected_dimensions}")
                        print(f"   Got: {actual_dims}")
                        return False
                    print(f"   ✅ Correct dimensions: {actual_dims}")
                    
                    # Check value ranges
                    for item in radar_data:
                        if not (0 <= item['value'] <= 10):
                            print(f"❌ Value out of range: {item['dimension']} = {item['value']}")
                            return False
                    print(f"   ✅ All values in range 0-10")
            
            # Print key data
            if 'athletes_count' in data:
                print(f"   👥 Athletes: {data['athletes_count']}")
            if 'has_data' in data:
                print(f"   📈 Has data: {data['has_data']}")
            if 'available_dates' in data:
                print(f"   📅 Available dates: {len(data['available_dates'])}")
                
            return True
            
        except Exception as e:
            print(f"❌ Error parsing response: {e}")
            return False
    
    def test_auth_failure(self, name, endpoint):
        """Test that endpoint fails without proper auth"""
        print(f"\n🔒 Testing {name} (Auth Test)")
        response = requests.get(f"{self.base_url}/{endpoint}")
        
        if response.status_code == 403:
            print(f"✅ Correctly returned 403 (Forbidden)")
            return True
        else:
            print(f"❌ Expected 403, got {response.status_code}")
            return False

def main():
    print("🎯 Focused Radar Chart API Testing")
    print("=" * 50)
    
    tester = RadarChartTester()
    
    # Login
    if not tester.login_admin():
        print("❌ Cannot proceed without admin login")
        return 1
    
    # Get athlete ID
    if not tester.get_athlete_id():
        print("❌ Cannot proceed without athlete ID")
        return 1
    
    # Expected fields and dimensions
    expected_fields = ['date', 'radar_data', 'available_dates']
    expected_dimensions = ['Sleep Quality', 'Energy Level', 'Muscle Recovery', 'Mental Wellness', 'Readiness to Train']
    
    # Test cases from review request
    tests = [
        # 1. GET /api/staff/dashboard/readiness-radar?days_ago=0 - Team radar data for today
        ("Team Radar - Today", "staff/dashboard/readiness-radar?days_ago=0", expected_fields + ['athletes_count'], expected_dimensions),
        
        # 2. GET /api/staff/dashboard/readiness-radar?days_ago=2 - Team radar data for 2 days ago
        ("Team Radar - 2 Days Ago", "staff/dashboard/readiness-radar?days_ago=2", expected_fields + ['athletes_count'], expected_dimensions),
        
        # 3. GET /api/staff/dashboard/readiness-radar?team=Brazil%20Lacrosse%20Men&days_ago=2 - Team filter
        ("Team Radar - Men's Team Filter", "staff/dashboard/readiness-radar?team=Brazil%20Lacrosse%20Men&days_ago=2", expected_fields + ['athletes_count'], expected_dimensions),
        
        # 4. GET /api/staff/athlete/{athlete_id}/readiness-radar?days_ago=2 - Individual athlete radar
        ("Individual Athlete Radar", f"staff/athlete/{tester.athlete_id}/readiness-radar?days_ago=2", expected_fields + ['athlete_name', 'has_data'], expected_dimensions),
    ]
    
    results = []
    for name, endpoint, fields, dims in tests:
        success = tester.test_endpoint(name, endpoint, fields, dims)
        results.append((name, success))
    
    # Auth tests
    auth_tests = [
        ("Team Radar Auth", "staff/dashboard/readiness-radar"),
        ("Individual Radar Auth", f"staff/athlete/{tester.athlete_id}/readiness-radar"),
    ]
    
    for name, endpoint in auth_tests:
        success = tester.test_auth_failure(name, endpoint)
        results.append((name, success))
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 RADAR CHART TEST RESULTS")
    print("=" * 50)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {name}")
    
    print(f"\n📈 Results: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 ALL RADAR CHART TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} tests failed")
        return 1

if __name__ == "__main__":
    exit(main())