import uuid
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Job, User
from ..schemas import JobCreate, JobUpdate, JobResponse
from ..services.dedup import find_duplicate
from ..auth import get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/", response_model=JobResponse)
async def create_job(
    payload: JobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()

    if not data["domain"] and data["url"]:
        data["domain"] = urlparse(data["url"]).hostname

    duplicate = await find_duplicate(data["title"], data["domain"], db, current_user.id)
    if duplicate:
        response = JobResponse.model_validate(duplicate).model_dump(mode="json")
        response["duplicate"] = True
        return JSONResponse(status_code=200, content=response)

    job = Job(**data, user_id=current_user.id)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return JSONResponse(
        status_code=201,
        content=JobResponse.model_validate(job).model_dump(mode="json"),
    )


@router.patch("/{job_id}")
async def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if payload.status is not None:
        job.status = payload.status
    await db.commit()
    await db.refresh(job)
    return JSONResponse(
        content=JobResponse.model_validate(job).model_dump(mode="json")
    )


@router.get("/", response_model=list[JobResponse])
async def list_jobs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Job)
        .where(Job.user_id == current_user.id)
        .order_by(Job.created_at.desc())
    )
    return result.scalars().all()
