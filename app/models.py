from sqlalchemy import Column, Integer, String, Float, Date, Text, DateTime, JSON, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db import Base

class Role(Base):
    __tablename__ = 'roles'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255), nullable=True)

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_manager = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    project_scope = Column(String(20), default='all', nullable=False)
    project_assignments_json = Column(Text, default='[]', nullable=False)
    role_id = Column(Integer, ForeignKey('roles.id'), nullable=True)
    role = relationship('Role')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class InviteToken(Base):
    __tablename__ = 'invite_tokens'
    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_used = Column(Boolean, default=False)

class LinkControl(Base):
    __tablename__ = 'link_controls'
    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), unique=True, nullable=False)
    permission = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

class CrmRecord(Base):
    __tablename__ = 'crm_records'
    id = Column(Integer, primary_key=True, index=True)
    company = Column(String(255), nullable=False)
    contact = Column(String(255), nullable=False)
    status = Column(String(50), default='No Contact', nullable=False)
    township = Column(Integer, nullable=False)
    range = Column(Integer, nullable=False)
    section = Column(Integer, nullable=False)
    trscode = Column(String(32), nullable=False, index=True)
    extra_data = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Lease fields
    lease_agent = Column(String(255), nullable=True)
    lease_agent_notes = Column(Text, nullable=True)
    lessor_owner = Column(String(255), nullable=True)
    lessee = Column(String(255), nullable=True)
    lease_date = Column(Date, nullable=True)
    vol = Column(String(50), nullable=True)
    pg = Column(String(50), nullable=True)
    tract_description = Column(Text, nullable=True)
    gross_acres = Column(Float, nullable=True)
    net_acres = Column(Float, nullable=True)
    royalty = Column(String(50), nullable=True)
    bonus_agreed = Column(String(50), nullable=True)
    term_months = Column(Integer, nullable=True)
    extension_months = Column(Integer, nullable=True)
    mailed_date = Column(Date, nullable=True)
