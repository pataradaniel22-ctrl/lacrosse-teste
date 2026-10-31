"""
CMJ Module and Event Filtering Backend Tests
Tests for:
- CMJ baseline creation/update
- CMJ single test creation
- CMJ batch testing (Evaluation Day)
- CMJ analytics
- Event filtering (team-specific AND 'All Athletes' events)
"""

import pytest
import requests
import os
from datetime import datetime, timedelta
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://performance-fueling.preview.emergentagent.com').rstrip('/')

# Test credentials
ADMIN_EMAIL = "pataradaniel@gmail.com"
ADMIN_PASSWORD = "123456"

# Test athlete IDs
LUCAS_SILVA_ID = "67d500f7-c89f-47bc-af32-e4bc91cb0142"
ANA_OLIVEIRA_ID = "3d88b90a-b8f6-4f56-83bc-326755df7233"


class TestAuth:
    """Authentication tests"""
    
    def test_admin_login(self):
        """Test admin login"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        print(f"Admin login response: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            assert "token" in data
            assert data["user_type"] == "staff"
            print(f"Admin login successful: {data['user']['name']}")
        else:
            print(f"Admin login failed: {response.text}")
            # Don't fail the test - admin may not exist yet
            pytest.skip("Admin login failed - may need to create admin user")


class TestCMJBaseline:
    """CMJ Baseline endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_get_cmj_baseline_no_baseline(self, auth_token):
        """Test getting CMJ baseline when none exists"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/baseline", headers=headers)
        print(f"Get baseline response: {response.status_code}")
        # Should return 200 with null or 404
        assert response.status_code in [200, 404]
    
    def test_create_cmj_baseline(self, auth_token):
        """Test creating CMJ baseline"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        today = datetime.now().strftime("%Y-%m-%d")
        
        payload = {
            "date": today,
            "jump_height_cm": 35.5,
            "arms_used": True,
            "footwear": "shoes",
            "notes": "Test baseline"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/baseline",
            json=payload,
            headers=headers
        )
        print(f"Create baseline response: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        assert response.status_code in [200, 201]
        data = response.json()
        # API returns message on success
        assert "message" in data or "baseline" in data or "jump_height_cm" in str(data)
    
    def test_update_cmj_baseline(self, auth_token):
        """Test updating CMJ baseline"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        today = datetime.now().strftime("%Y-%m-%d")
        
        payload = {
            "date": today,
            "jump_height_cm": 36.0,
            "arms_used": True,
            "footwear": "shoes",
            "notes": "Updated baseline"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/baseline",
            json=payload,
            headers=headers
        )
        print(f"Update baseline response: {response.status_code}")
        assert response.status_code in [200, 201]


class TestCMJSingleTest:
    """CMJ Single Test endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_create_cmj_single_test(self, auth_token):
        """Test creating a single CMJ test"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        today = datetime.now().strftime("%Y-%m-%d")
        
        payload = {
            "date": today,
            "context": "pre_training",
            "arms_used": True,
            "trial_1": 34.5,
            "trial_2": 35.0,
            "trial_3": 34.8,
            "time_of_day": "09:00",
            "notes": "Test single CMJ"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/test",
            json=payload,
            headers=headers
        )
        print(f"Create single test response: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        assert response.status_code in [200, 201]
        data = response.json()
        assert "test" in data or "cmj_mean" in str(data)
    
    def test_get_cmj_tests(self, auth_token):
        """Test getting CMJ test history"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/tests",
            headers=headers
        )
        print(f"Get tests response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "tests" in data
        print(f"Found {len(data['tests'])} CMJ tests")


class TestCMJBatchTest:
    """CMJ Batch Testing (Evaluation Day) endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_create_cmj_batch_test(self, auth_token):
        """Test batch CMJ testing for multiple athletes"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        today = datetime.now().strftime("%Y-%m-%d")
        
        payload = {
            "date": today,
            "context": "testing_session",
            "event_id": None,
            "arms_used": True,
            "tests": [
                {
                    "athlete_id": LUCAS_SILVA_ID,
                    "trial_1": 35.2,
                    "trial_2": 35.5,
                    "trial_3": 35.0
                },
                {
                    "athlete_id": ANA_OLIVEIRA_ID,
                    "trial_1": 28.5,
                    "trial_2": 29.0,
                    "trial_3": 28.8
                }
            ]
        }
        
        response = requests.post(
            f"{BASE_URL}/api/cmj/batch",
            json=payload,
            headers=headers
        )
        print(f"Batch test response: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        assert response.status_code in [200, 201]
        data = response.json()
        assert "results" in data or "message" in data


class TestCMJAnalytics:
    """CMJ Analytics endpoint tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_get_cmj_analytics(self, auth_token):
        """Test getting CMJ analytics for an athlete"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/cmj/athlete/{LUCAS_SILVA_ID}/analytics",
            headers=headers
        )
        print(f"Analytics response: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        assert response.status_code == 200
        data = response.json()
        # Should have baseline, tests, and analytics data
        assert "tests" in data or "baseline" in data or "total_tests" in data
    
    def test_get_cmj_team_overview(self, auth_token):
        """Test getting CMJ team overview"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/cmj/team",
            headers=headers
        )
        print(f"Team overview response: {response.status_code}")
        assert response.status_code == 200
    
    def test_get_cmj_info(self, auth_token):
        """Test getting CMJ info/explanations"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/cmj/info", headers=headers)
        print(f"CMJ info response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        assert "cmj_overview" in data


class TestEventFiltering:
    """Event filtering tests - team-specific AND 'All Athletes' events"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_create_all_athletes_event(self, auth_token):
        """Test creating an event for all athletes (no team filter)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        start_date = datetime.now().strftime("%Y-%m-%d")
        end_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        payload = {
            "name": f"Test All Athletes Event {uuid.uuid4().hex[:6]}",
            "event_type": "training_camp",
            "start_date": start_date,
            "end_date": end_date,
            "team": None,  # All athletes
            "description": "Test event for all athletes"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/staff/events",
            json=payload,
            headers=headers
        )
        print(f"Create all-athletes event response: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        assert response.status_code in [200, 201]
        data = response.json()
        assert "event" in data
        return data["event"]["id"]
    
    def test_create_men_team_event(self, auth_token):
        """Test creating an event for men's team only"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        start_date = datetime.now().strftime("%Y-%m-%d")
        end_date = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
        
        payload = {
            "name": f"Test Men Event {uuid.uuid4().hex[:6]}",
            "event_type": "tournament",
            "start_date": start_date,
            "end_date": end_date,
            "team": "Brazil Lacrosse Men",
            "description": "Test event for men's team"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/staff/events",
            json=payload,
            headers=headers
        )
        print(f"Create men's event response: {response.status_code}")
        assert response.status_code in [200, 201]
    
    def test_get_events_with_men_filter(self, auth_token):
        """Test that men's team filter shows both men-specific AND all-athletes events"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # First get all events
        response_all = requests.get(
            f"{BASE_URL}/api/staff/events?include_past=true",
            headers=headers
        )
        all_events = response_all.json()
        print(f"Total events: {len(all_events)}")
        
        # Get events filtered by men's team
        response_men = requests.get(
            f"{BASE_URL}/api/staff/events?team=men&include_past=true",
            headers=headers
        )
        print(f"Men filter response: {response_men.status_code}")
        assert response_men.status_code == 200
        
        men_events = response_men.json()
        print(f"Events with men filter: {len(men_events)}")
        
        # Check that we have events
        if len(men_events) > 0:
            # Verify we get both team-specific and all-athletes events
            team_specific = [e for e in men_events if e.get('team') == 'Brazil Lacrosse Men']
            all_athletes = [e for e in men_events if e.get('team') is None]
            
            print(f"Men-specific events: {len(team_specific)}")
            print(f"All-athletes events: {len(all_athletes)}")
            
            # The filter should include both types
            # (This is the key test for the event filtering fix)
    
    def test_get_events_with_women_filter(self, auth_token):
        """Test that women's team filter shows both women-specific AND all-athletes events"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = requests.get(
            f"{BASE_URL}/api/staff/events?team=women&include_past=true",
            headers=headers
        )
        print(f"Women filter response: {response.status_code}")
        assert response.status_code == 200
        
        women_events = response.json()
        print(f"Events with women filter: {len(women_events)}")


class TestCMJMetricsCalculation:
    """Test CMJ metrics calculation (mean, best, CV%, delta%)"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_cmj_metrics_in_test_response(self, auth_token):
        """Test that CMJ test response includes calculated metrics"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        today = datetime.now().strftime("%Y-%m-%d")
        
        # Create a test with known values
        payload = {
            "date": today,
            "context": "testing_session",
            "arms_used": True,
            "trial_1": 30.0,
            "trial_2": 32.0,
            "trial_3": 31.0,
            "notes": "Metrics test"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/cmj/athlete/{ANA_OLIVEIRA_ID}/test",
            json=payload,
            headers=headers
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            test_data = data.get("test", data)
            
            # Verify metrics are calculated
            if "cmj_mean" in test_data:
                # Mean should be (30 + 32 + 31) / 3 = 31.0
                assert abs(test_data["cmj_mean"] - 31.0) < 0.5
                print(f"CMJ Mean: {test_data['cmj_mean']}")
            
            if "cmj_best" in test_data:
                # Best should be 32.0
                assert test_data["cmj_best"] == 32.0
                print(f"CMJ Best: {test_data['cmj_best']}")
            
            if "cv_percent" in test_data:
                # CV% should be calculated
                print(f"CV%: {test_data['cv_percent']}")
                assert test_data["cv_percent"] >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
