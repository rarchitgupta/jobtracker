import uuid
from datetime import datetime
from pydantic import BaseModel


class JobUpdate(BaseModel):
    status: str | None = None


class JobCreate(BaseModel):
    title: str
    company: str
    url: str | None = None
    domain: str | None = None
    source: str = "extension"
    status: str = "applied"


class JobResponse(BaseModel):
    id: uuid.UUID
    title: str
    company: str
    url: str | None
    domain: str | None
    source: str
    status: str
    confirmed: bool
    duplicate: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
