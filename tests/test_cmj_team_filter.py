"""
CMJ Evaluation Day Team Filtering Bug Fix Tests
Tests for the fix that updated dropdown values from short names ('men', 'women') 
to full team names ('Brazil Lacrosse Men', 'Brazil Lacrosse Women')
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://performance-fueling.preview.emergentagent.com').rstrip('/')

# Test credentials
ADMIN_EMAIL = "pataradaniel@gmail.com"
ADMIN_PASSWORD = "123456"


class TestTeamFiltering:
    """Team filtering tests for CMJ Evaluation Day bug fix"""
    
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
    
    def test_all_teams_filter(self, auth_token):
        """Test that no filter returns all 6 athletes"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(f"{BASE_URL}/api/staff/athletes", headers=headers)
        
        assert response.status_code == 200
        athletes = response.json()
        print(f"All teams: {len(athletes)} athletes")
        
        # Should have 6 athletes total
        assert len(athletes) == 6
        
        # Verify we have both teams
        men_count = sum(1 for a in athletes if a.get('team') == 'Brazil Lacrosse Men')
        women_count = sum(1 for a in athletes if a.get('team') == 'Brazil Lacrosse Women')
        
        assert men_count == 3, f"Expected 3 men, got {men_count}"
        assert women_count == 3, f"Expected 3 women, got {women_count}"
    
    def test_mens_team_filter_full_name(self, auth_token):
        """Test Men's Team filter using full team name (the fix)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/staff/athletes?team=Brazil Lacrosse Men", 
            headers=headers
        )
        
        assert response.status_code == 200
        athletes = response.json()
        print(f"Men's team (full name): {len(athletes)} athletes")
        
        # Should have exactly 3 male athletes
        assert len(athletes) == 3
        
        # Verify all are from Men's team
        for athlete in athletes:
            assert athlete.get('team') == 'Brazil Lacrosse Men', f"{athlete['name']} is not from Men's team"
        
        # Verify expected athletes
        names = [a['name'] for a in athletes]
        assert 'Lucas Silva' in names
        assert 'Pedro Santos' in names
        assert 'Gabriel Costa' in names
    
    def test_womens_team_filter_full_name(self, auth_token):
        """Test Women's Team filter using full team name (the fix)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/staff/athletes?team=Brazil Lacrosse Women", 
            headers=headers
        )
        
        assert response.status_code == 200
        athletes = response.json()
        print(f"Women's team (full name): {len(athletes)} athletes")
        
        # Should have exactly 3 female athletes
        assert len(athletes) == 3
        
        # Verify all are from Women's team
        for athlete in athletes:
            assert athlete.get('team') == 'Brazil Lacrosse Women', f"{athlete['name']} is not from Women's team"
        
        # Verify expected athletes
        names = [a['name'] for a in athletes]
        assert 'Ana Oliveira' in names
        assert 'Julia Pereira' in names
        assert 'Maria Souza' in names
    
    def test_old_short_name_men_returns_empty(self, auth_token):
        """Test that old short name 'men' returns empty (confirms bug existed)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/staff/athletes?team=men", 
            headers=headers
        )
        
        assert response.status_code == 200
        athletes = response.json()
        print(f"Old 'men' filter: {len(athletes)} athletes")
        
        # Should return empty because no athletes have team='men'
        assert len(athletes) == 0, "Old short name 'men' should return empty"
    
    def test_old_short_name_women_returns_empty(self, auth_token):
        """Test that old short name 'women' returns empty (confirms bug existed)"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = requests.get(
            f"{BASE_URL}/api/staff/athletes?team=women", 
            headers=headers
        )
        
        assert response.status_code == 200
        athletes = response.json()
        print(f"Old 'women' filter: {len(athletes)} athletes")
        
        # Should return empty because no athletes have team='women'
        assert len(athletes) == 0, "Old short name 'women' should return empty"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
