from datetime import datetime
from datetime import timezone
from datetime import UTC
from typing import Any
from typing import Generic
from typing import TypeVar
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field

from onyx.configs.app_configs import MASK_CREDENTIAL_PREFIX
from onyx.configs.constants import DocumentSource
from onyx.connectors.models import InputType
from onyx.db.enums import AccessType
from onyx.db.enums import ConnectorCredentialPairStatus
from onyx.db.models import Connector
from onyx.db.models import ConnectorCredentialPair
from onyx.db.models import Credential
from onyx.db.models import Document as DbDocument
from onyx.db.models import IndexAttempt
from onyx.db.models import IndexingStatus
from onyx.db.models import TaskStatus
from onyx.server.utils import mask_credential_dict
from onyx.utils.variable_functionality import fetch_ee_implementation_or_noop


class DocumentSyncStatus(BaseModel):
    doc_id: str
    last_synced: datetime | None
    last_modified: datetime | None

    @classmethod
    def from_model(cls, doc: DbDocument) -> "DocumentSyncStatus":
        return DocumentSyncStatus(
            doc_id=doc.id,
            last_synced=doc.last_synced,
            last_modified=doc.last_modified,
        )


class DocumentInfo(BaseModel):
    num_chunks: int
    num_tokens: int


class ChunkInfo(BaseModel):
    content: str
    num_tokens: int


class DeletionAttemptSnapshot(BaseModel):
    connector_id: int
    credential_id: int
    status: TaskStatus


class ConnectorBase(BaseModel):
    name: str
    source: DocumentSource
    input_type: InputType
    connector_specific_config: dict[str, Any]
    # In seconds, None for one time index with no refresh
    refresh_freq: int | None = None
    prune_freq: int | None = None
    indexing_start: datetime | None = None


class ConnectorUpdateRequest(ConnectorBase):
    access_type: AccessType
    groups: list[int] = Field(default_factory=list)

    def to_connector_base(self) -> ConnectorBase:
        return ConnectorBase(**self.model_dump(exclude={"access_type", "groups"}))


class ConnectorSnapshot(ConnectorBase):
    id: int
    credential_ids: list[int]
    time_created: datetime
    time_updated: datetime
    source: DocumentSource

    @classmethod
    def from_connector_db_model(
        cls, connector: Connector, credential_ids: list[int] | None = None
    ) -> "ConnectorSnapshot":
        return ConnectorSnapshot(
            id=connector.id,
            name=connector.name,
            source=connector.source,
            input_type=connector.input_type,
            connector_specific_config=connector.connector_specific_config,
            refresh_freq=connector.refresh_freq,
            prune_freq=connector.prune_freq,
            credential_ids=(
                credential_ids
                or [association.credential.id for association in connector.credentials]
            ),
            indexing_start=connector.indexing_start,
            time_created=connector.time_created,
            time_updated=connector.time_updated,
        )


class CredentialSwapRequest(BaseModel):
    new_credential_id: int
    connector_id: int


class CredentialDataUpdateRequest(BaseModel):
    name: str
    credential_json: dict[str, Any]


class CredentialBase(BaseModel):
    credential_json: dict[str, Any]
    # if `true`, then all Admins will have access to the credential
    admin_public: bool
    source: DocumentSource
    name: str | None = None
    curator_public: bool = False
    groups: list[int] = Field(default_factory=list)
    is_user_file: bool = False


class CredentialSnapshot(CredentialBase):
    id: int
    user_id: UUID | None
    user_email: str | None = None
    time_created: datetime
    time_updated: datetime

    @classmethod
    def from_credential_db_model(cls, credential: Credential) -> "CredentialSnapshot":
        return CredentialSnapshot(
            id=credential.id,
            credential_json=(
                mask_credential_dict(credential.credential_json)
                if MASK_CREDENTIAL_PREFIX and credential.credential_json
                else credential.credential_json
            ),
            user_id=credential.user_id,
            user_email=credential.user.email if credential.user else None,
            admin_public=credential.admin_public,
            time_created=credential.time_created,
            time_updated=credential.time_updated,
            source=credential.source or DocumentSource.NOT_APPLICABLE,
            name=credential.name,
            curator_public=credential.curator_public,
        )


class IndexAttemptSnapshot(BaseModel):
    id: int
    status: IndexingStatus | None
    from_beginning: bool
    new_docs_indexed: int  # only includes completely new docs
    total_docs_indexed: int  # includes docs that are updated
    docs_removed_from_index: int
    error_msg: str | None
    error_count: int
    full_exception_trace: str | None
    time_started: str | None
    time_updated: str
    poll_range_start: datetime | None = None
    poll_range_end: datetime | None = None

    @classmethod
    def from_index_attempt_db_model(
        cls, index_attempt: IndexAttempt
    ) -> "IndexAttemptSnapshot":
        return IndexAttemptSnapshot(
            id=index_attempt.id,
            status=index_attempt.status,
            from_beginning=index_attempt.from_beginning,
            new_docs_indexed=index_attempt.new_docs_indexed or 0,
            total_docs_indexed=index_attempt.total_docs_indexed or 0,
            docs_removed_from_index=index_attempt.docs_removed_from_index or 0,
            error_msg=index_attempt.error_msg,
            error_count=len(index_attempt.error_rows),
            full_exception_trace=index_attempt.full_exception_trace,
            time_started=(
                index_attempt.time_started.isoformat()
                if index_attempt.time_started
                else None
            ),
            time_updated=index_attempt.time_updated.isoformat(),
            poll_range_start=index_attempt.poll_range_start,
            poll_range_end=index_attempt.poll_range_end,
        )


# These are the types currently supported by the pagination hook
# More api endpoints can be refactored and be added here for use with the pagination hook
PaginatedType = TypeVar("PaginatedType", bound=BaseModel)


class PaginatedReturn(BaseModel, Generic[PaginatedType]):
    items: list[PaginatedType]
    total_items: int


class CCPairFullInfo(BaseModel):
    id: int
    name: str
    status: ConnectorCredentialPairStatus
    in_repeated_error_state: bool
    num_docs_indexed: int
    connector: ConnectorSnapshot
    credential: CredentialSnapshot
    number_of_index_attempts: int
    last_index_attempt_status: IndexingStatus | None
    latest_deletion_attempt: DeletionAttemptSnapshot | None
    access_type: AccessType
    is_editable_for_current_user: bool
    deletion_failure_message: str | None
    indexing: bool
    creator: UUID | None
    creator_email: str | None

    # information on syncing/indexing
    last_indexed: datetime | None
    last_pruned: datetime | None
    # accounts for both doc sync and group sync
    last_full_permission_sync: datetime | None
    overall_indexing_speed: float | None
    latest_checkpoint_description: str | None

    @classmethod
    def _get_last_full_permission_sync(
        cls, cc_pair_model: ConnectorCredentialPair
    ) -> datetime | None:
        check_if_source_requires_external_group_sync = fetch_ee_implementation_or_noop(
            "onyx.external_permissions.sync_params",
            "source_requires_external_group_sync",
            noop_return_value=False,
        )
        check_if_source_requires_doc_sync = fetch_ee_implementation_or_noop(
            "onyx.external_permissions.sync_params",
            "source_requires_doc_sync",
            noop_return_value=False,
        )

        needs_group_sync = check_if_source_requires_external_group_sync(
            cc_pair_model.connector.source
        )
        needs_doc_sync = check_if_source_requires_doc_sync(
            cc_pair_model.connector.source
        )

        last_group_sync = (
            cc_pair_model.last_time_external_group_sync
            if needs_group_sync
            else datetime.now(UTC)
        )
        last_doc_sync = (
            cc_pair_model.last_time_perm_sync if needs_doc_sync else datetime.now(UTC)
        )

        # if either is still None at this point, it means sync is necessary but
        # has never completed.
        if last_group_sync is None or last_doc_sync is None:
            return None

        return min(last_group_sync, last_doc_sync)

    @classmethod
    def from_models(
        cls,
        cc_pair_model: ConnectorCredentialPair,
        latest_deletion_attempt: DeletionAttemptSnapshot | None,
        number_of_index_attempts: int,
        last_index_attempt: IndexAttempt | None,
        num_docs_indexed: int,  # not ideal, but this must be computed separately
        is_editable_for_current_user: bool,
        indexing: bool,
    ) -> "CCPairFullInfo":
        # figure out if we need to artificially deflate the number of docs indexed.
        # This is required since the total number of docs indexed by a CC Pair is
        # updated before the new docs for an indexing attempt. If we don't do this,
        # there is a mismatch between these two numbers which may confuse users.
        last_indexing_status = last_index_attempt.status if last_index_attempt else None
        if (
            # only need to do this if the last indexing attempt is still in progress
            last_indexing_status == IndexingStatus.IN_PROGRESS
            and number_of_index_attempts == 1
            and last_index_attempt
            and last_index_attempt.new_docs_indexed
        ):
            num_docs_indexed = (
                last_index_attempt.new_docs_indexed if last_index_attempt else 0
            )

        overall_indexing_speed = num_docs_indexed / (
            (
                datetime.now(tz=timezone.utc) - cc_pair_model.connector.time_created
            ).total_seconds()
            / 60
        )

        return cls(
            id=cc_pair_model.id,
            name=cc_pair_model.name,
            status=cc_pair_model.status,
            in_repeated_error_state=cc_pair_model.in_repeated_error_state,
            num_docs_indexed=num_docs_indexed,
            connector=ConnectorSnapshot.from_connector_db_model(
                cc_pair_model.connector
            ),
            credential=CredentialSnapshot.from_credential_db_model(
                cc_pair_model.credential
            ),
            number_of_index_attempts=number_of_index_attempts,
            last_index_attempt_status=last_indexing_status,
            latest_deletion_attempt=latest_deletion_attempt,
            access_type=cc_pair_model.access_type,
            is_editable_for_current_user=is_editable_for_current_user,
            deletion_failure_message=cc_pair_model.deletion_failure_message,
            indexing=indexing,
            creator=cc_pair_model.creator_id,
            creator_email=(
                cc_pair_model.creator.email if cc_pair_model.creator else None
            ),
            last_indexed=(
                last_index_attempt.time_started if last_index_attempt else None
            ),
            last_pruned=cc_pair_model.last_pruned,
            last_full_permission_sync=cls._get_last_full_permission_sync(cc_pair_model),
            overall_indexing_speed=overall_indexing_speed,
            latest_checkpoint_description=None,
        )


class CeleryTaskStatus(BaseModel):
    id: str
    name: str
    status: TaskStatus
    start_time: datetime | None
    register_time: datetime | None


class FailedConnectorIndexingStatus(BaseModel):
    """Simplified version of ConnectorIndexingStatus for failed indexing attempts"""

    cc_pair_id: int
    name: str | None
    error_msg: str | None
    is_deletable: bool
    connector_id: int
    credential_id: int


class ConnectorStatus(BaseModel):
    """
    Represents the status of a connector,
    including indexing status elated information
    """

    cc_pair_id: int
    name: str | None
    connector: ConnectorSnapshot
    credential: CredentialSnapshot
    access_type: AccessType
    groups: list[int]


class ConnectorIndexingStatus(ConnectorStatus):
    """Represents the full indexing status of a connector"""

    cc_pair_status: ConnectorCredentialPairStatus
    # this is separate from the `status` above, since a connector can be `INITIAL_INDEXING`, `ACTIVE`,
    # or `PAUSED` and still be in a repeated error state.
    in_repeated_error_state: bool
    owner: str
    last_finished_status: IndexingStatus | None
    last_status: IndexingStatus | None
    last_success: datetime | None
    latest_index_attempt: IndexAttemptSnapshot | None
    docs_indexed: int
    in_progress: bool


class ConnectorCredentialPairIdentifier(BaseModel):
    connector_id: int
    credential_id: int


class ConnectorCredentialPairMetadata(BaseModel):
    name: str | None = None
    access_type: AccessType
    auto_sync_options: dict[str, Any] | None = None
    groups: list[int] = Field(default_factory=list)


class CCStatusUpdateRequest(BaseModel):
    status: ConnectorCredentialPairStatus


class ConnectorCredentialPairDescriptor(BaseModel):
    id: int
    name: str | None = None
    connector: ConnectorSnapshot
    credential: CredentialSnapshot
    access_type: AccessType


class RunConnectorRequest(BaseModel):
    connector_id: int
    credential_ids: list[int] | None = None
    from_beginning: bool = False


class CCPropertyUpdateRequest(BaseModel):
    name: str
    value: str


"""Connectors Models"""


class GoogleAppWebCredentials(BaseModel):
    client_id: str
    project_id: str
    auth_uri: str
    token_uri: str
    auth_provider_x509_cert_url: str
    client_secret: str
    redirect_uris: list[str]
    javascript_origins: list[str]


class GoogleAppCredentials(BaseModel):
    web: GoogleAppWebCredentials


class GoogleServiceAccountKey(BaseModel):
    type: str
    project_id: str
    private_key_id: str
    private_key: str
    client_email: str
    client_id: str
    auth_uri: str
    token_uri: str
    auth_provider_x509_cert_url: str
    client_x509_cert_url: str
    universe_domain: str


class GoogleServiceAccountCredentialRequest(BaseModel):
    google_primary_admin: str | None = None  # email of user to impersonate


class FileUploadResponse(BaseModel):
    file_paths: list[str]
    zip_metadata: dict[str, Any]


class ObjectCreationIdResponse(BaseModel):
    id: int
    credential: CredentialSnapshot | None = None


class AuthStatus(BaseModel):
    authenticated: bool


class AuthUrl(BaseModel):
    auth_url: str


class GmailCallback(BaseModel):
    state: str
    code: str


class GDriveCallback(BaseModel):
    state: str
    code: str
