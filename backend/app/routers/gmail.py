import base64
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import GmailCredential, User

router = APIRouter(prefix="/auth/gmail", tags=["gmail"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
]


def _create_state(clerk_id: str) -> str:
    payload = {
        "sub": clerk_id,
        "jti": secrets.token_hex(8),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.clerk_secret_key, algorithm="HS256")


def _verify_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.clerk_secret_key, algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")


@router.get("/start")
async def gmail_start(current_user: User = Depends(get_current_user)):
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    state = _create_state(current_user.clerk_id)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return {"url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}


@router.get("/callback")
async def gmail_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    clerk_id = _verify_state(state)

    result = await db.execute(select(User).where(User.clerk_id == clerk_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    # Decode id_token payload without verification — trust comes from the HTTPS code exchange
    raw_payload = tokens["id_token"].split(".")[1]
    raw_payload += "=" * (-len(raw_payload) % 4)  # fix base64 padding
    id_token_payload = json.loads(base64.urlsafe_b64decode(raw_payload))
    gmail_email = id_token_payload.get("email", "")
    expiry = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))

    cred_result = await db.execute(
        select(GmailCredential).where(GmailCredential.user_id == user.id)
    )
    cred = cred_result.scalar_one_or_none()

    if cred:
        cred.access_token = tokens["access_token"]
        cred.refresh_token = tokens.get("refresh_token", cred.refresh_token)
        cred.token_expiry = expiry
        cred.gmail_email = gmail_email
    else:
        cred = GmailCredential(
            user_id=user.id,
            gmail_email=gmail_email,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expiry=expiry,
        )
        db.add(cred)

    if not user.email:
        user.email = gmail_email

    await db.commit()

    return RedirectResponse(
        url=f"{settings.frontend_url}/dashboard/integrations?gmail=connected"
    )


@router.get("/status")
async def gmail_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GmailCredential).where(GmailCredential.user_id == current_user.id)
    )
    cred = result.scalar_one_or_none()
    if not cred:
        return {"connected": False, "email": None}
    return {"connected": True, "email": cred.gmail_email}


@router.delete("")
async def gmail_disconnect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GmailCredential).where(GmailCredential.user_id == current_user.id)
    )
    cred = result.scalar_one_or_none()
    if cred:
        await db.delete(cred)
        await db.commit()
    return {"disconnected": True}
