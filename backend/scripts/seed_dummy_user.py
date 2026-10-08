"""
Seed dummy user accounts for development and testing.

Usage:
    uv run python scripts/seed_dummy_user.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to sys.path so scripts can run standalone
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from src.data.clients.session import SessionLocal, init_db
from src.data.models.postgres.user import User
from src.utils.auth_utils import get_password_hash


DUMMY_USERS = [
    {
        "name": "Demo Administrator",
        "email": "admin@example.com",
        "password": "admin123",
        "role": "administrator",
        "phone": "9876543210",
    },
    {
        "name": "Demo Project Manager",
        "email": "manager@example.com",
        "password": "manager123",
        "role": "project_manager",
        "phone": "9876543211",
    },
]


def seed_dummy_users():
    init_db()
    db = SessionLocal()
    try:
        print("--- Seeding Dummy Users ---")
        for u_data in DUMMY_USERS:
            email = u_data["email"].lower().strip()
            existing_user = db.query(User).filter(User.email.ilike(email)).first()
            hashed_pw = get_password_hash(u_data["password"])

            if existing_user:
                existing_user.name = u_data["name"]
                existing_user.password_hash = hashed_pw
                existing_user.role = u_data["role"]
                existing_user.is_active = True
                existing_user.phone = u_data["phone"]
                existing_user.updated_on = datetime.now(timezone.utc)
                db.commit()
                print(f"✔ Updated existing user: {u_data['email']} (Role: {u_data['role']}, Password: {u_data['password']})")
            else:
                new_user = User(
                    name=u_data["name"],
                    email=email,
                    password_hash=hashed_pw,
                    role=u_data["role"],
                    is_active=True,
                    phone=u_data["phone"],
                    updated_on=datetime.now(timezone.utc),
                )
                db.add(new_user)
                db.commit()
                db.refresh(new_user)
                print(f"✔ Created dummy user: {u_data['email']} (ID: {new_user.id}, Role: {u_data['role']}, Password: {u_data['password']})")

        print("\nAll dummy users seeded successfully!")
    finally:
        db.close()


if __name__ == "__main__":
    seed_dummy_users()
