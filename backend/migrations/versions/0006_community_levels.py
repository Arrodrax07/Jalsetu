"""community levels: areas inside cities (parent_id, level)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-06 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('communities', schema=None) as batch_op:
        batch_op.add_column(sa.Column('level', sa.String(length=12), nullable=False, server_default='settlement'))
        batch_op.add_column(sa.Column('parent_id', sa.String(length=40), nullable=True))
        batch_op.create_index(batch_op.f('ix_communities_parent_id'), ['parent_id'], unique=False)
        batch_op.create_foreign_key('fk_communities_parent_id', 'communities', ['parent_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('communities', schema=None) as batch_op:
        batch_op.drop_constraint('fk_communities_parent_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_communities_parent_id'))
        batch_op.drop_column('parent_id')
        batch_op.drop_column('level')
