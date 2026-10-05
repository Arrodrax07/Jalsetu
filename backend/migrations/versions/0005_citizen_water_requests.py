"""citizen water requests (public portal, offline queue)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('water_requests', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source', sa.String(length=16), nullable=False, server_default='staff'))
        batch_op.add_column(sa.Column('people_affected', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('language', sa.String(length=8), nullable=False, server_default='en'))
        batch_op.add_column(sa.Column('input_mode', sa.String(length=8), nullable=False, server_default='typed'))
        batch_op.add_column(sa.Column('client_ref', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('queued_at', sa.DateTime(), nullable=True))
        batch_op.create_unique_constraint(batch_op.f('uq_water_requests_client_ref'), ['client_ref'])


def downgrade() -> None:
    with op.batch_alter_table('water_requests', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('uq_water_requests_client_ref'), type_='unique')
        batch_op.drop_column('queued_at')
        batch_op.drop_column('client_ref')
        batch_op.drop_column('input_mode')
        batch_op.drop_column('language')
        batch_op.drop_column('people_affected')
        batch_op.drop_column('source')
