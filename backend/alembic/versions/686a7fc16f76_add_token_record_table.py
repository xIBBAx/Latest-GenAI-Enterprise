"""add token_record table

Revision ID: 686a7fc16f76
Revises: a7688ab35c45
Create Date: 2025-07-15 12:30:14.556945

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "686a7fc16f76"
down_revision = "a7688ab35c45"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "token_record",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("user_group_id", sa.Integer(), nullable=True),
        sa.Column("chat_session_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column(
            "message_type",
            sa.Enum("USER", "ASSISTANT", name="messagetypeenum"),
            nullable=False,
        ),
        sa.Column("model_used", sa.String(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["user_group_id"], ["user_group.id"]),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_session.id"]),
        sa.ForeignKeyConstraint(["message_id"], ["chat_message.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ### end Alembic commands ###
