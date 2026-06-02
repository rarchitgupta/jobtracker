from fastapi import APIRouter, Request, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from svix.webhooks import Webhook, WebhookVerificationError

from ..database import get_db
from ..models import User
from ..config import settings
from fastapi import Depends

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/clerk")
async def clerk_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    headers = dict(request.headers)

    if settings.clerk_webhook_secret:
        try:
            wh = Webhook(settings.clerk_webhook_secret)
            wh.verify(payload, headers)
        except WebhookVerificationError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    event = await request.json()
    event_type = event.get("type")
    data = event.get("data", {})

    if event_type == "user.created":
        email = (data.get("email_addresses") or [{}])[0].get("email_address", "")
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip() or None
        user = User(clerk_id=data["id"], email=email, name=name)
        db.add(user)
        await db.commit()

    elif event_type == "user.updated":
        result = await db.execute(select(User).where(User.clerk_id == data["id"]))
        user = result.scalar_one_or_none()
        if user:
            email = (data.get("email_addresses") or [{}])[0].get("email_address", "")
            user.email = email or user.email
            user.name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip() or user.name
            await db.commit()

    elif event_type == "user.deleted":
        result = await db.execute(select(User).where(User.clerk_id == data["id"]))
        user = result.scalar_one_or_none()
        if user:
            await db.delete(user)
            await db.commit()

    return {"status": "ok"}
