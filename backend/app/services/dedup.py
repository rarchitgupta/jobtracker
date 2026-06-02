import re
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import Job

SIMILARITY_THRESHOLD = 85

# Noise patterns to strip before comparing titles
_NOISE = re.compile(
    r"\b(your application (to|for)|application for|re:|fwd:|new grad|–|—)\b",
    re.IGNORECASE,
)
_PUNCTUATION = re.compile(r"[^\w\s]")
_WHITESPACE = re.compile(r"\s+")


def normalize(title: str) -> str:
    title = _NOISE.sub(" ", title)
    title = _PUNCTUATION.sub(" ", title)
    title = _WHITESPACE.sub(" ", title)
    return title.lower().strip()


async def find_duplicate(
    title: str, domain: str | None, db: AsyncSession, user_id=None
) -> Job | None:
    """Return an existing Job if one matches title+domain above the threshold."""
    if not domain:
        return None

    query = select(Job).where(Job.domain == domain)
    if user_id is not None:
        query = query.where(Job.user_id == user_id)
    result = await db.execute(query)
    existing = result.scalars().all()
    if not existing:
        return None

    normalized_input = normalize(title)

    for job in existing:
        score = fuzz.token_sort_ratio(normalized_input, normalize(job.title))
        if score >= SIMILARITY_THRESHOLD:
            return job

    return None
