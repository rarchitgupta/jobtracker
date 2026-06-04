"""consolidate interview statuses

Revision ID: 7dc7f6b19656
Revises: 52f4ccf420dd
Create Date: 2026-06-02 22:12:00.251919

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7dc7f6b19656'
down_revision: Union[str, Sequence[str], None] = '52f4ccf420dd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE jobs
        SET status = 'interview'
        WHERE status IN ('phone_screen', 'technical', 'final')
    """)


def downgrade() -> None:
    pass
