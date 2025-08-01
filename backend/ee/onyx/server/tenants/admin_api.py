from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Response

from ee.onyx.auth.users import current_cloud_superuser
from ee.onyx.server.tenants.models import ImpersonateRequest
from ee.onyx.server.tenants.user_mapping import get_tenant_id_for_email
from onyx.auth.users import auth_backend
from onyx.auth.users import get_redis_strategy
from onyx.auth.users import User
from onyx.db.engine import get_session_with_tenant
from onyx.db.users import get_user_by_email
from onyx.utils.logger import setup_logger

logger = setup_logger()

router = APIRouter(prefix="/tenants")


@router.post("/impersonate")
async def impersonate_user(
    impersonate_request: ImpersonateRequest,
    _: User = Depends(current_cloud_superuser),
) -> Response:
    """Allows a cloud superuser to impersonate another user by generating an impersonation JWT token"""
    tenant_id = get_tenant_id_for_email(impersonate_request.email)

    with get_session_with_tenant(tenant_id=tenant_id) as tenant_session:
        user_to_impersonate = get_user_by_email(
            impersonate_request.email, tenant_session
        )
        if user_to_impersonate is None:
            raise HTTPException(status_code=404, detail="User not found")
        token = await get_redis_strategy().write_token(user_to_impersonate)

    response = await auth_backend.transport.get_login_response(token)
    response.set_cookie(
        key="fastapiusersauth",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response
