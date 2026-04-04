from pydantic import BaseModel, validator, EmailStr
from typing import Optional, Dict
import re
from email_validator import validate_email, EmailNotValidError

class CrmRecordBase(BaseModel):
    company: str
    contact: str
    status: Optional[str] = 'new'
    township: int
    range: int
    section: int
    extra_data: Optional[Dict] = {}

    @validator('status')
    def status_enum(cls, v):
        valid = {'new', 'in-progress', 'closed'}
        if v not in valid:
            raise ValueError(f"status must be one of {valid}")
        return v

    @validator('township', 'range', 'section')
    def non_negative(cls, v):
        if v < 0:
            raise ValueError('township/range/section must be non-negative')
        return v

class CrmRecordCreate(CrmRecordBase):
    pass

class CrmRecordRead(CrmRecordBase):
    id: int
    trscode: str
    created_at: Optional[str]

    class Config:
        orm_mode = True

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: Optional[str] = 'employee'

    @validator('email')
    def validate_email_format(cls, v):
        try:
            validate_email(v)
            return v
        except EmailNotValidError as e:
            raise ValueError(f'Invalid email: {str(e)}')

class UserRead(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    is_manager: bool
    is_admin: bool
    role: Optional[str]

    class Config:
        orm_mode = True

class InviteCreate(BaseModel):
    email: EmailStr
    role: str

class InviteAccept(BaseModel):
    token: str
    password: str

class LinkControlCreate(BaseModel):
    permission: str
    expires_in_hours: Optional[int] = 24


class ForgotCredentialsRequest(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    message: Optional[str] = None

    @validator('username')
    def normalize_username(cls, v):
        if v is None:
            return v
        value = v.strip()
        return value or None

    @validator('message')
    def validate_message(cls, v):
        if v is None:
            return v
        value = v.strip()
        if len(value) > 1000:
            raise ValueError('message must be 1000 characters or less')
        return value or None


class ExcelSecondTabImportResult(BaseModel):
    table_name: str
    sheet_name: str
    headers_detected: int
    columns_created: int
    rows_imported: int
    created_columns: list[str]


class WorkbookTabSummary(BaseModel):
    tab_key: str
    sheet_name: str
    table_name: str
    row_count: int
    headers: list[str]


class WorkbookImportResult(BaseModel):
    workbook_name: str
    tabs_imported: int
    total_rows_imported: int
    crm_records_imported: int
    tabs: list[WorkbookTabSummary]


class WorkbookTabRowsResult(BaseModel):
    tab_key: str
    sheet_name: str
    headers: list[str]
    rows: list[dict]

